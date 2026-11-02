<?php
/**
 * Checks of the error log: bounded, not autoloaded, describes request data instead of copying it, an old big log is
 * cut once. It writes into the option syncpilot_error_log and puts the old content back at the end.
 *
 * Run on a TEST installation only:   wp eval-file wp-content/plugins/sync-pilot/tests/error-log.php
 */

error_reporting( E_ALL ); global $syncpilot, $wpdb; $ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };
$row  = function () use ( $wpdb ) { return $wpdb->get_row( "SELECT autoload, LENGTH(option_value) AS bytes FROM {$wpdb->options} WHERE option_name = 'syncpilot_error_log'", ARRAY_A ); };
$saved = $wpdb->get_row( "SELECT * FROM {$wpdb->options} WHERE option_name = 'syncpilot_error_log'", ARRAY_A );
delete_option( 'syncpilot_error_log' );
$secret = 'S3CR3T-KEY-VALUE-abc123'; $sql = str_repeat( "INSERT INTO t VALUES ('PRIVATE-ROW');\n", 60000 );

echo "-- one entry from a public endpoint with a 2.4 MB body\n";
$_SERVER['CONTENT_LENGTH'] = 2400000;
$syncpilot->log_error( 'Invalid content verification signature (#130)', array( 'action' => 'syncpilot_process_chunk', 'table' => 'wp_posts', 'chunk' => $sql, 'sig' => '123.' . $secret, 'key' => $secret, 'form_data' => 'auth_password=' . $secret ) );
$log = get_option( 'syncpilot_error_log' ); $r = $row();
$check( 'entry is small', strlen( $log ) <= SyncPilot_Base::LOG_ENTRY_MAX_BYTES, strlen( $log ) . ' bytes' );
$check( 'no row data, no signature, no key in the log', false === strpos( $log, 'PRIVATE-ROW' ) && false === strpos( $log, $secret ) );
$check( 'names and sizes are there', false !== strpos( $log, 'action: syncpilot_process_chunk' ) && false !== strpos( $log, 'table: wp_posts' ) && preg_match( '/chunk: \[not logged, ' . strlen( $sql ) . ' bytes\]/', $log ) && false !== strpos( $log, 'Size of the request: 2400000 bytes' ), '' );
$check( 'stored without autoload', in_array( $r['autoload'], array( 'no', 'off', 'auto-off' ), true ), $r['autoload'] );

echo "\n-- a remote answer (HTML error page of 3 MB, cookies) and a WP_Error\n";
$syncpilot->log_error( 'The connection failed', array( 'headers' => array( 'content-type' => 'text/html' ), 'body' => '<html>' . str_repeat( 'x', 3000000 ), 'response' => array( 'code' => 502, 'message' => 'Bad Gateway' ), 'cookies' => array( 'wordpress_logged_in' => 'COOKIEVALUE' ) ) );
$syncpilot->log_error( 'curl failed', new WP_Error( 'http_request_failed', 'cURL error 28: Operation timed out after 30001 milliseconds' ) );
$log = get_option( 'syncpilot_error_log' );
$check( 'body is shortened with its size, cookie not logged', false !== strpos( $log, '... (3000006 bytes)' ) && false === strpos( $log, 'COOKIEVALUE' ) && false !== strpos( $log, 'code: 502' ) );
$check( 'WP_Error is described', false !== strpos( $log, 'cURL error 28' ) );

echo "\n-- 1000 requests with a 2.4 MB body each\n";
for ( $i = 0; $i < 1000; $i++ ) $syncpilot->log_error( "Invalid signature #$i", array( 'action' => 'syncpilot_process_chunk', 'chunk' => $sql ) );
$log = get_option( 'syncpilot_error_log' ); $r = $row();
$check( 'log stays within its size', strlen( $log ) <= SyncPilot_Base::LOG_MAX_BYTES, $r['bytes'] . ' bytes of ' . SyncPilot_Base::LOG_MAX_BYTES );
$check( 'newest entries stay, log starts with a whole entry', false !== strpos( $log, 'Invalid signature #999' ) && 0 === strpos( $log, '****' ) );
$check( 'oldest entries are gone', false === strpos( $log, 'Invalid signature #0' ) && false === strpos( $log, 'The connection failed' ) );

echo "\n-- an old log (3 MB, autoloaded) is trimmed once\n";
delete_option( 'syncpilot_error_log' ); $old = ''; for ( $i = 0; $i < 3000; $i++ ) $old .= "********************************************\n******  Log date: 2026/01/01 00:00:00 ******\n********************************************\n\nSyncPilot Error: old entry $i\n\n" . str_repeat( 'z', 900 ) . "\n\n";
add_option( 'syncpilot_error_log', $old, '', 'yes' ); wp_cache_delete( 'alloptions', 'options' ); wp_cache_delete( 'notoptions', 'options' );
$before = $row(); $syncpilot->trim_error_log(); $after = $row();
$check( 'before: big and autoloaded', $before['bytes'] > 2000000 && in_array( $before['autoload'], array( 'yes', 'on', 'auto', 'auto-on' ), true ), json_encode( $before ) );
$check( 'after: within the size, no autoload, newest entry kept', $after['bytes'] <= SyncPilot_Base::LOG_MAX_BYTES && in_array( $after['autoload'], array( 'no', 'off', 'auto-off' ), true ) && false !== strpos( get_option( 'syncpilot_error_log' ), 'old entry 2999' ), json_encode( $after ) );
$q = $wpdb->num_queries; $syncpilot->trim_error_log(); $check( 'second run does nothing (no query)', $wpdb->num_queries === $q );

echo "\n-- clearing and reading still work\n";
delete_option( 'syncpilot_error_log' ); ob_start(); $syncpilot->output_log_file(); $out = ob_get_clean(); $check( 'empty log prints nothing', '' === $out );
$syncpilot->log_error( 'last' ); ob_start(); $syncpilot->output_log_file(); $out = ob_get_clean(); $check( 'log prints', false !== strpos( $out, 'SyncPilot Error: last' ) );

// restore the log as it was
delete_option( 'syncpilot_error_log' ); if ( $saved ) $wpdb->insert( $wpdb->options, array( 'option_name' => $saved['option_name'], 'option_value' => $saved['option_value'], 'autoload' => $saved['autoload'] ) ); wp_cache_flush();
echo "\n$ok ok, $bad failed\n";
