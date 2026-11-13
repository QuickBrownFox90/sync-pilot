<?php
/**
 * Checks of the log (SyncPilot_Logger): one JSON line per entry, metadata only, bounded by rotation, a protected folder,
 * levels, the fallback when the folder cannot be written, the import of the log of the versions before 0.3.0.
 * It writes into the real log folder and the options of the site and puts them back at the end.
 *
 * Run on a TEST installation only:   wp eval-file wp-content/plugins/sync-pilot/tests/logger.php
 */

error_reporting( E_ALL ); global $syncpilot, $wpdb; $ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };
$L     = 'SyncPilot_Logger';
$set   = function ( $prop, $value ) use ( $L ) { $p = new ReflectionProperty( $L, $prop ); $p->setAccessible( true ); $p->setValue( null, $value ); };
$last  = function () use ( $L ) { $lines = $L::lines(); return $lines ? json_decode( end( $lines ), true ) : null; };
$files = function () use ( $L ) { $f = $L::file(); return $f ? array_values( array_filter( array( $f, $f . '.1', $f . '.2', $f . '.3' ), 'file_exists' ) ) : array(); };

$settings_before = get_option( 'syncpilot_settings' );
$legacy_before   = $wpdb->get_row( "SELECT * FROM {$wpdb->options} WHERE option_name = 'syncpilot_error_log'", ARRAY_A );
// the real folder (uploads/sync-pilot/logs) may belong to the web server user; the test writes into its own folder
$tmp = wp_upload_dir( null, false )['basedir'] . '/syncpilot-logger-test-' . uniqid();
add_filter( 'syncpilot_log_dir', function () use ( $tmp ) { return $tmp; } );
$set( 'dir', null );
$L::clear();
$secret = 'S3CR3T-KEY-VALUE-abc123'; $sql = str_repeat( "INSERT INTO t VALUES ('PRIVATE-ROW');\n", 60000 );

echo "-- one entry from a public endpoint with a 2.4 MB body\n";
$_SERVER['CONTENT_LENGTH'] = 2400000;
$syncpilot->log_error( SyncPilot_HelpCode::InvalidSignature, array( 'request' => array( 'action' => 'syncpilot_process_chunk', 'table' => 'wp_posts', 'chunk' => $sql, 'sig' => '123.' . $secret, 'key' => $secret, 'form_data' => 'auth_password=' . $secret ) ), site: 3 );
$raw = implode( "\n", $L::lines() ); $e = $last();
$check( 'one line, valid JSON', 1 === count( $L::lines() ) && is_array( $e ), $raw === '' ? 'empty' : '' );
$check( 'entry is small', strlen( $raw ) <= $L::ENTRY_MAX_BYTES, strlen( $raw ) . ' bytes' );
$check( 'no row data, no signature, no key in the log', false === strpos( $raw, 'PRIVATE-ROW' ) && false === strpos( $raw, $secret ) );
$check( 'fields: time, level, source, message', preg_match( '/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $e['t'] ) && 'error' === $e['level'] && 'cli' === $e['src'] && 'Invalid content signature' === $e['message'] );
$check( 'help code, site and the function that reported it', 130 === $e['help'] && 3 === $e['site'] && preg_match( '/^[A-Za-z_]+(::[A-Za-z_]+)?:\d+$/', $e['at'] ) === 1, json_encode( array( $e['help'], $e['site'], $e['at'] ) ) );
$check( 'no site: the field is not there', ! isset( json_decode( ( function () use ( $syncpilot, $L ) { $syncpilot->log_error( SyncPilot_HelpCode::ChunkMissing ); $a = $L::lines(); return end( $a ); } )(), true )['site'] ) );
$check( 'names and sizes are there', 'syncpilot_process_chunk' === $e['context']['request']['action'] && 'wp_posts' === $e['context']['request']['table'] && '[not logged, ' . strlen( $sql ) . ' bytes]' === $e['context']['request']['chunk'] && 2400000 === $e['context']['request_bytes'] );
$check( 'sig, key and form_data are only sizes', 0 === strpos( $e['context']['request']['sig'], '[not logged, ' ) && 0 === strpos( $e['context']['request']['key'], '[not logged, ' ) && 0 === strpos( $e['context']['request']['form_data'], '[not logged, ' ) );

echo "\n-- a remote answer (HTML error page of 3 MB, cookies), a WP_Error, an object, invalid UTF-8\n";
$syncpilot->log_error( SyncPilot_HelpCode::RemoteHttpError, array( 'response' => array( 'headers' => new ArrayObject(), 'body' => '<html>' . str_repeat( 'x', 3000000 ), 'response' => array( 'code' => 502, 'message' => 'Bad Gateway' ), 'cookies' => array( 'wordpress_logged_in' => 'COOKIEVALUE' ) ) ), site: 1 );
$raw = implode( "\n", $L::lines() ); $e = $last();
$check( 'body is shortened with its size, cookie not logged', false !== strpos( $e['context']['response']['body'], '... (3000006 bytes)' ) && false === strpos( $raw, 'COOKIEVALUE' ) && 502 === $e['context']['response']['response']['code'] );
$check( 'object is its class name', 'ArrayObject' === $e['context']['response']['headers'] );
$syncpilot->log_error( SyncPilot_HelpCode::RemoteTimeout, array( 'response' => new WP_Error( 'http_request_failed', 'cURL error 28: Operation timed out after 30001 milliseconds' ) ), site: 1 );
$check( 'WP_Error is described', false !== strpos( $last()['context']['response'], 'cURL error 28' ) );
$L::error( "broken \xB1\x31 text with a\nline break and <b>tags</b>" );
$e = $last();
$all = $L::lines(); $raw = end( $all );
$check( 'invalid UTF-8 does not lose the entry, tags are gone, the entry is one line', is_array( $e ) && false === strpos( $raw, "\n" ) && false === strpos( $e['message'], '<b>' ) && false !== strpos( $e['message'], 'tags' ), json_encode( $e ) );
$huge = array(); for ( $i = 0; $i < 200; $i++ ) $huge[ 'name' . $i ] = 'value';
$L::error( 'wide context', $huge ); $all = $L::lines(); $raw = end( $all );
$check( 'wide context is cut to 20 items', false !== strpos( $raw, '180 more' ) && strlen( $raw ) <= $L::ENTRY_MAX_BYTES, strlen( $raw ) . ' bytes' );
$huge = array(); for ( $i = 0; $i < 20; $i++ ) $huge[ 'name' . $i ] = str_repeat( 'v', 280 );
$L::error( 'context too long for one entry', $huge ); $all = $L::lines(); $raw = end( $all ); $e = json_decode( $raw, true );
$check( 'context above the entry limit is dropped, the message stays', strlen( $raw ) <= $L::ENTRY_MAX_BYTES && 'context too long for one entry' === $e['message'] && isset( $e['context']['cut'] ), strlen( $raw ) . ' bytes' );
$check( 'an enormous message stays under the entry limit', strlen( $L::build_line( 'error', str_repeat( 'm', 500000 ), array( 'a' => 1 ) ) ) <= $L::ENTRY_MAX_BYTES );

echo "\n-- migration ID, phase, action\n";
$L::set_migration_id( 'ab12/../CD-34 ' ); $L::set_phase( 'tables' ); $_POST['action'] = 'syncpilot_migrate_table';
$L::error( 'with a context' ); $e = $last();
$check( 'migration ID is cleaned, phase and action are written', 'ab12CD-34' === $e['migration'] && 'tables' === $e['phase'] && 'syncpilot_migrate_table' === $e['action'], json_encode( $e ) );
$L::set_migration_id( '' ); $L::set_phase( '' ); unset( $_POST['action'] );
$e = json_decode( $L::build_line( 'error', 'x' ), true );
$check( 'without them the fields are not there', ! isset( $e['migration'], $e['phase'], $e['action'] ) );

echo "\n-- levels\n";
$n = count( $L::lines() );
$L::info( 'only verbose' );                          $check( 'errors (the default): info is not written', $n === count( $L::lines() ) );
update_option( 'syncpilot_settings', array_merge( (array) $settings_before, array( 'log_level' => 'verbose' ) ) );
$L::info( 'only verbose' );                          $check( 'verbose: info is written', $n + 1 === count( $L::lines() ) && 'info' === $last()['level'] );
update_option( 'syncpilot_settings', array_merge( (array) $settings_before, array( 'log_level' => 'off' ) ) );
$L::error( 'off' );                                  $check( 'off: nothing is written', $n + 1 === count( $L::lines() ) );
update_option( 'syncpilot_settings', array_merge( (array) $settings_before, array( 'log_level' => 'nonsense' ) ) );
$L::info( 'x' ); $L::error( 'default again' );       $check( 'a wrong level is the default (errors)', $n + 2 === count( $L::lines() ) );
update_option( 'syncpilot_settings', $settings_before );

echo "\n-- the ID of a migration, events, the environment\n";
$id = $L::new_migration_id();
$check( 'a new ID: date, time and six hex characters; two IDs differ', 1 === preg_match( '/^\d{6}-\d{6}-[0-9a-f]{6}$/', $id ) && $id !== $L::new_migration_id(), $id );
$n = count( $L::lines() );
$L::event( 'Migration started', array( 'intent' => 'push' ) );
$check( 'an event is written at the level errors (the default)', $n + 1 === count( $L::lines() ) && 'event' === $last()['level'] );
update_option( 'syncpilot_settings', array_merge( (array) $settings_before, array( 'log_level' => 'off' ) ) );
$L::event( 'Migration started' ); $check( 'and not at off', $n + 1 === count( $L::lines() ) );
update_option( 'syncpilot_settings', array_merge( (array) $settings_before, array( 'log_level' => 'verbose' ) ) );
$L::event( 'Migration started' ); $check( 'and at verbose', $n + 2 === count( $L::lines() ) );
update_option( 'syncpilot_settings', $settings_before );
$env = $L::environment(); $json = wp_json_encode( $env );
$wanted = array( 'plugin', 'wordpress', 'multisite', 'php', 'sapi', 'os', 'server', 'ssl', 'memory_limit', 'max_execution_time', 'post_max_size', 'upload_max_filesize', 'gzip', 'db', 'db_charset', 'db_collate', 'sql_mode', 'max_allowed_packet', 'free_disk_bytes' );
$check( 'the environment names versions and limits', array() === array_diff( $wanted, array_keys( $env ) ) && PHP_VERSION === $env['php'] && $env['max_allowed_packet'] > 0 && '' !== $env['db'], implode( ', ', array_diff( $wanted, array_keys( $env ) ) ) );
$check( 'and nothing that identifies the site: no path, no address, no key', false === strpos( $json, ABSPATH ) && false === strpos( $json, wp_parse_url( home_url(), PHP_URL_HOST ) ) && false === strpos( $json, (string) $settings_before['key'] ) );
$check( 'an entry with two environments fits into one entry', strlen( $L::build_line( 'event', 'Migration started', array( 'intent' => 'push', 'environment' => $env ) ) ) < $L::ENTRY_MAX_BYTES / 2 );

echo "\n-- 12000 requests with a 2.4 MB body each (6 MB of log): the files stay within their size\n";
$L::clear();
for ( $i = 0; $i < 12000; $i++ ) $L::error( "Invalid signature #$i", array( 'action' => 'syncpilot_process_chunk', 'chunk' => $sql, 'pad' => str_repeat( 'p', 250 ) ) );
$f = $files(); $sizes = array_map( 'filesize', $f ); $lines = $L::lines();
$check( 'at most ' . $L::FILES_KEPT . ' files', count( $f ) >= 2 && count( $f ) <= $L::FILES_KEPT, count( $f ) . ' files' );
$check( 'every file is within its size', max( $sizes ) <= $L::FILE_MAX_BYTES, implode( ', ', $sizes ) );
$check( 'newest entries stay, oldest are gone', false !== strpos( end( $lines ), 'Invalid signature #11999' ) && false === strpos( implode( "\n", $lines ), 'Invalid signature #0"' ), count( $lines ) . ' lines' );
$check( 'every line is whole JSON', count( array_filter( $lines, function ( $l ) { return is_array( json_decode( $l, true ) ); } ) ) === count( $lines ) );
$check( 'lines are in the order they were written', (int) preg_replace( '/\D/', '', json_decode( $lines[0], true )['message'] ) < (int) preg_replace( '/\D/', '', json_decode( end( $lines ), true )['message'] ) );

echo "\n-- the folder is protected\n";
$dir = $L::dir();
$check( 'folder is the one of the filter', $tmp === $dir, (string) $dir );
remove_all_filters( 'syncpilot_log_dir' ); $set( 'dir', null ); $real = $L::dir();
$check( 'without the filter it is uploads/sync-pilot/logs' . ( false === $real ? ' (not writable for this user: only the path is checked)' : '' ), false === $real || ( 'logs' === basename( $real ) && 'sync-pilot' === basename( dirname( $real ) ) ), (string) $real );
add_filter( 'syncpilot_log_dir', function () use ( $tmp ) { return $tmp; } ); $set( 'dir', null );
$check( '.htaccess denies, index.php and web.config exist', false !== strpos( (string) @file_get_contents( $dir . '/.htaccess' ), 'Require all denied' ) && file_exists( $dir . '/index.php' ) && false !== strpos( (string) @file_get_contents( $dir . '/web.config' ), 'deny users' ) );
$check( 'file name is random (20 hex), not the same as another site would make', preg_match( '/^syncpilot-log-[0-9a-f]{20}\.jsonl$/', basename( $L::file() ) ) === 1, basename( $L::file() ) );

echo "\n-- the folder cannot be written: the entries go to the option\n";
$L::error( 'written before' ); $set( 'dir', false );
$check( 'reading the log does not need the right to write (the web server writes it, a command line reads it)', false !== strpos( implode( "\n", $L::lines() ), 'written before' ) );
$set( 'dir', null );
$L::clear();
$set( 'dir', false );
$L::error( 'to the option' );
$check( 'entry is in the option, not autoloaded', false !== strpos( (string) get_option( $L::FALLBACK_OPTION ), 'to the option' ) && in_array( $wpdb->get_var( "SELECT autoload FROM {$wpdb->options} WHERE option_name = '" . $L::FALLBACK_OPTION . "'" ), array( 'no', 'off', 'auto-off' ), true ) );
for ( $i = 0; $i < 500; $i++ ) $L::error( "fallback #$i", array( 'pad' => str_repeat( 'p', 250 ) ) );
$opt = (string) get_option( $L::FALLBACK_OPTION );
$check( 'the option stays within its size and starts with a whole entry', strlen( $opt ) <= $L::FALLBACK_BYTES && is_array( json_decode( strtok( $opt, "\n" ), true ) ), strlen( $opt ) . ' bytes' );
$all = $L::lines(); $check( 'lines() reads it', false !== strpos( end( $all ), 'fallback #499' ) );
$set( 'dir', null );
$L::clear(); $check( 'clear() empties files and option', array() === $L::lines() && false === get_option( $L::FALLBACK_OPTION ) );

echo "\n-- the log of the versions before 0.3.0 (an option, text)\n";
$old = ''; for ( $i = 0; $i < 3000; $i++ ) $old .= "********************************************\n******  Log date: 2026/01/01 00:00:00 ******\n********************************************\n\nSyncPilot Error: old entry $i\n\n" . str_repeat( 'z', 900 ) . "\n\n";
add_option( 'syncpilot_error_log', $old, '', 'yes' ); wp_cache_delete( 'alloptions', 'options' ); wp_cache_delete( 'notoptions', 'options' );
$q = $wpdb->num_queries; $syncpilot->import_autoloaded_log();
$check( 'autoloaded and big: moved into the log on init, the option is gone', false === get_option( 'syncpilot_error_log' ) && 1 === count( $L::lines() ) );
$e = $last();
$check( 'one entry, its size is bounded, the end of the old log is in it', strlen( implode( '', $L::lines() ) ) <= $L::ENTRY_MAX_BYTES && false !== strpos( $e['message'], 'older version' ) );
$L::clear();
$q = $wpdb->num_queries; $syncpilot->import_autoloaded_log(); $check( 'second run on init costs no query', $wpdb->num_queries === $q );
update_option( 'syncpilot_error_log', "SyncPilot Error: not autoloaded old entry\n", false );
$entries = $L::entries();
$check( 'not autoloaded: moved when the log is read, and in the entries', 1 === count( $entries ) && false !== strpos( $entries[0]['message'], 'not autoloaded old entry' ) && false === get_option( 'syncpilot_error_log' ) );
$L::clear();
$check( 'empty log: no entries', array() === $L::entries() );
$L::error( 'last', array( 'n' => 1 ) ); $entries = $L::entries();
$check( 'entries(): one array per entry, parsed', 1 === count( $entries ) && 'last' === $entries[0]['message'] && 1 === $entries[0]['context']['n'] );

echo "\n-- what is known about a request to the other site\n";
$token = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';
$html  = "<html><head><style>body{x:1}</style><script>var k='$token';</script></head><body><h1>502 Bad Gateway</h1>\n<p>nginx says: upstream failed\n(key $token)</p>" . str_repeat( 'z ', 600 ) . '</body></html>';
$resp  = array( 'headers' => new WpOrg\Requests\Utility\CaseInsensitiveDictionary( array( 'content-type' => 'text/html', 'server' => 'nginx', 'location' => 'https://user:secret@example.test/x' ) ), 'body' => $html, 'response' => array( 'code' => 502, 'message' => 'Bad Gateway' ), 'cookies' => array(), 'http_response' => null );
$facts = $syncpilot->describe_remote_response( $resp, microtime( true ) - 1.5, 1234 );
$check( 'an HTML error page: status, sizes, duration, a few headers', 502 === $facts['status'] && 'Bad Gateway' === $facts['status_text'] && strlen( $html ) === $facts['received_bytes'] && 1234 === $facts['sent_bytes'] && $facts['duration_ms'] >= 1500 && $facts['duration_ms'] < 2500 && 'nginx' === $facts['header_server'] && 'text/html' === $facts['header_content_type'], json_encode( array_diff_key( $facts, array( 'excerpt' => 1 ) ) ) );
$check( 'the address in a header has no user name and password', 'https://example.test/x' === $facts['header_location'], $facts['header_location'] );
$check( 'the excerpt: no tags, no script, no line breaks, no key, cut and says how long', false === strpos( $facts['excerpt'], '<' ) && false === strpos( $facts['excerpt'], 'var k' ) && false === strpos( $facts['excerpt'], "\n" ) && false === strpos( $facts['excerpt'], $token ) && false !== strpos( $facts['excerpt'], '502 Bad Gateway nginx says: upstream failed' ) && strlen( $facts['excerpt'] ) < 360 && false !== strpos( $facts['excerpt'], 'bytes)' ), $facts['excerpt'] );
$facts = $syncpilot->describe_remote_response( array( 'headers' => array(), 'body' => 'a:2:{s:6:"tables";a:1:{i:0;s:8:"wp_users";}}', 'response' => array( 'code' => 200, 'message' => 'OK' ) ), microtime( true ), 10 );
$check( 'serialized data (rows of the database): not even its beginning', '[serialized data]' === $facts['excerpt'] );
$notice = "<br />\n<b>Notice</b>: Undefined variable: x in <b>/var/www/other.php</b> on line <b>12</b><br />\na:2:{s:6:\"tables\";a:1:{i:0;s:8:\"wp_users\";}}";
$sql    = "Warning: something\nINSERT INTO `wp_users` VALUES (1,'admin','hash');";
$check( 'a message in front of serialized data or SQL: the message stays, the data does not', 'Notice: Undefined variable: x in /var/www/other.php on line 12 [data]' === $L::excerpt( $notice ) && 'Warning: something [data]' === $L::excerpt( $sql ), $L::excerpt( $notice ) . ' | ' . $L::excerpt( $sql ) );
$check( 'tags are gaps between words', '502 Bad Gateway nginx' === $L::excerpt( '<title>502 Bad Gateway</title><center>nginx</center>' ) || false !== strpos( $L::excerpt( '<h1>502 Bad Gateway</h1><center>nginx</center>' ), '502 Bad Gateway nginx' ), $L::excerpt( '<h1>502 Bad Gateway</h1><center>nginx</center>' ) );
$facts = $syncpilot->describe_remote_response( new WP_Error( 'http_request_failed', 'cURL error 28: Operation timed out after 10001 milliseconds with 0 bytes received' ), microtime( true ) - 10, 99 );
$check( 'a request that failed: the message and the number of cURL, no status', 28 === $facts['curl_errno'] && false !== strpos( $facts['error'], 'timed out' ) && ! isset( $facts['status'] ) && $facts['duration_ms'] >= 10000, json_encode( $facts ) );
$property = new ReflectionProperty( $syncpilot, 'attempting_to_connect_to' ); $property->setAccessible( true ); $property->setValue( $syncpilot, 'https://user:pw@host.test/wp-admin/admin-ajax.php' );
$syncpilot->log_error( SyncPilot_HelpCode::RemoteTimeout, array(), site: 1 ); $e = $last(); $property->setValue( $syncpilot, null );
$check( 'the address of the other site in an entry has no user name and password', 'https://host.test/wp-admin/admin-ajax.php' === $e['context']['connecting_to'], json_encode( $e['context'] ) );
$L::clear(); $L::error( 'last', array( 'n' => 1 ) );
$check( 'strip_credentials(): user:password@ is gone, an address without them is not changed', 'http://host.test/a' === $L::strip_credentials( 'http://user:pw@host.test/a' ) && 'https://host.test:8443/a?b=c' === $L::strip_credentials( 'https://host.test:8443/a?b=c' ) );

echo "\n-- the answers of the two requests of the diagnostics tab\n";
$_POST['nonce'] = wp_create_nonce( 'get-log' ); $_REQUEST['nonce'] = $_POST['nonce'];
define( 'DOING_SYNCPILOT_TESTS', true );
$L::error( 'second' );
$answer = $syncpilot->ajax_get_log(); $data = json_decode( (string) $answer, true );
$check( 'get_log answers JSON and nothing else: { entries : [...] } with the entries parsed', is_array( $data ) && array( 'entries' ) === array_keys( $data ) && 2 === count( $data['entries'] ) && 'second' === $data['entries'][1]['message'], substr( (string) $answer, 0, 120 ) );
$file = $L::file(); file_put_contents( $file, "this line was cut {\n", FILE_APPEND );
$data = json_decode( (string) $syncpilot->ajax_get_log(), true );
$check( 'a line that is not JSON is an entry with the field raw, nothing is lost', 3 === count( $data['entries'] ) && 'this line was cut {' === $data['entries'][2]['raw'] );
$text = (string) $syncpilot->ajax_get_diagnostics();
$check( 'get_diagnostics answers the text of the diagnostic info, without the log', false !== strpos( $text, 'site_url(): ' ) && false !== strpos( $text, 'PHP: ' ) && false === strpos( $text, '"message"' ) && null === json_decode( $text ) );

// a query of a chunk that fails: what is logged, and no value of the database in it
$wpdb->suppress_errors( true );
$wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}sp_test_dup" );
$wpdb->query( "CREATE TABLE {$wpdb->prefix}sp_test_dup ( id int PRIMARY KEY )" );
$wpdb->query( "INSERT INTO {$wpdb->prefix}sp_test_dup VALUES ( 7 )" );
$wpdb->query( "INSERT INTO {$wpdb->prefix}sp_test_dup VALUES ( 7 )" );
$facts = $syncpilot->describe_failed_query( "INSERT INTO `{$wpdb->prefix}sp_test_dup` VALUES ( 7 )", 3 );
$check( 'a failed query: the kind, the table, the place in the chunk, the size and the number of the error', 'INSERT INTO' === $facts['query'] && $wpdb->prefix . 'sp_test_dup' === $facts['table'] && 3 === $facts['number'] && $facts['query_bytes'] > 20 && 1062 === $facts['db_errno'], json_encode( $facts ) );
$check( 'the error of the database has no quoted value (Duplicate entry \'7\')', false === strpos( $facts['db_error'], "'7'" ) && false !== strpos( $facts['db_error'], "'[value]'" ), $facts['db_error'] );
$facts = $syncpilot->describe_failed_query( "SELECT 'secret value' FROM nowhere_at_all", 1 );
$check( 'the value in the query itself is not in the facts', false === strpos( json_encode( $facts ), 'secret value' ) );
$L::clear();
$result = $syncpilot->process_chunk( "INSERT INTO `{$wpdb->prefix}sp_test_dup` VALUES ( 8 );\nINSERT INTO `{$wpdb->prefix}sp_test_dup` VALUES ( 8 );\n" );
$entries = $L::entries(); $e = end( $entries );
$check( 'process_chunk() logs the failing query with help code 152 and its place', true !== $result && 152 === $e['help'] && 2 === $e['context']['number'] && $wpdb->prefix . 'sp_test_dup' === $e['context']['table'], json_encode( $e ) );
$check( 'and no value in the entry', false === strpos( json_encode( $e ), "'8'" ) );
$wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}sp_test_dup" );
$wpdb->suppress_errors( false );

// the block page of a firewall: the reference numbers stay, the address of the visitor does not
$page = '<html><head><title>The URL you requested has been blocked</title></head><body><h3>Web Page Blocked!</h3><p>URL: www.example.test/wp-admin/admin-ajax.php<br /><br/>Client IP: 80.153.24.194<br/>Attack ID: 20000008<br/>Message ID: 000186991602<br/>Reference: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8 Ray ID: 8a1f2b3c4d5e6f70</p></body></html>';
$ids  = $L::block_ids( $page );
$check( 'block_ids(): the numbers of the page, with their names, also behind a <br>', array( 'Attack ID' => '20000008', 'Message ID' => '000186991602', 'Ray ID' => '8a1f2b3c4d5e6f70' ) === $ids, json_encode( $ids ) );
$check( 'a run of 32 letters and digits is not a reference number (it can be a key)', ! in_array( 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8', $ids, true ) );
$check( 'words like "Reference documentation" are not numbers (a number has a digit)', array() === $L::block_ids( '<p>Reference documentation Request identifier</p>' ) );
$text = $L::excerpt( $page );
$check( 'excerpt(): the address of the visitor is [ip]', false === strpos( $text, '80.153' ) && false !== strpos( $text, 'Client IP: [ip]' ), $text );
$check( 'and the numbers of the page are still in it', false !== strpos( $text, 'Attack ID: 20000008' ), $text );
$mixed = $L::excerpt( 'Server Apache/2.4.69 at 12:30:45, from 2001:db8:85a3::8a2e:370:7334 and ::1, PHP 8.4.27' );
$check( 'IPv6 is [ip]; a version, a time and ::1 are not', false !== strpos( $mixed, 'Apache/2.4.69' ) && false !== strpos( $mixed, '12:30:45' ) && false === strpos( $mixed, '2001:db8' ) && false !== strpos( $mixed, '[ip]' ) && false !== strpos( $mixed, 'PHP 8.4.27' ), $mixed );
$fromwp = $syncpilot->describe_remote_response( array( 'headers' => new WpOrg\Requests\Utility\CaseInsensitiveDictionary( array( 'x-robots-tag' => 'noindex' ) ), 'body' => 'x', 'response' => array( 'code' => 500, 'message' => 'Internal Server Error' ), 'cookies' => array(), 'http_response' => null ), microtime( true ), 10 );
$other  = $syncpilot->describe_remote_response( array( 'headers' => new WpOrg\Requests\Utility\CaseInsensitiveDictionary( array( 'server' => 'Apache' ) ), 'body' => $page, 'response' => array( 'code' => 500, 'message' => 'Internal Server Error' ), 'cookies' => array(), 'http_response' => null ), microtime( true ), 10 );
$check( 'describe_remote_response(): the header of admin-ajax.php says it came from WordPress, no block numbers', true === $fromwp['from_wordpress'] && ! isset( $fromwp['block_ids'] ) );
$check( 'an answer without it: not from WordPress, with the numbers of the page', false === $other['from_wordpress'] && '20000008' === ( $other['block_ids']['Attack ID'] ?? '' ), json_encode( array( $other['from_wordpress'], $other['block_ids'] ?? null ) ) );

// put it back as it was: the test folder goes, the log of the real folder and the options stay as they were
$L::clear(); foreach ( glob( $tmp . '/{,.}*', GLOB_BRACE ) as $f ) is_file( $f ) && unlink( $f ); @rmdir( $tmp );
remove_all_filters( 'syncpilot_log_dir' ); $set( 'dir', null );
if ( $legacy_before ) $wpdb->insert( $wpdb->options, array( 'option_name' => $legacy_before['option_name'], 'option_value' => $legacy_before['option_value'], 'autoload' => $legacy_before['autoload'] ) );
update_option( 'syncpilot_settings', $settings_before ); wp_cache_flush();
echo "\n$ok ok, $bad failed\n";
