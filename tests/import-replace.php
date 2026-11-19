<?php
/**
 * Checks of the find and replace of the import (SyncPilot_Import::import_replace(), the steps after the load) and of the
 * unpacking of a gzip dump: tables with a primary key, with a key of two columns and without a key; values that are plain,
 * serialized, JSON, in capitals, with quotes and a backslash, with multibyte characters and NULL; the GUID that stays unless
 * asked; a replacement that holds the text it looks for; many short requests with a new connection each. And a real dump of
 * the test site: every row is what the function of a push or a pull gives for it, and nothing of the old address is left.
 *
 * Run on a TEST installation only:   wp eval-file wp-content/plugins/sync-pilot/tests/import-replace.php
 */

error_reporting( E_ALL ); global $syncpilot, $syncpilot_import, $wpdb; $ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };
$L     = 'SyncPilot_Logger';
$I     = $syncpilot_import;

if ( ! defined( 'DOING_SYNCPILOT_TESTS' ) )
	define( 'DOING_SYNCPILOT_TESTS', true );

$base   = sys_get_temp_dir() . '/syncpilot-import-replace-' . uniqid();
$folder = $base . '/imports';
$logs   = $base . '/logs';
mkdir( $folder, 0755, true ); mkdir( $logs, 0755, true );

add_filter( 'syncpilot_import_dir', fn() => $folder );
add_filter( 'syncpilot_log_dir', fn() => $logs );
add_filter( 'syncpilot_log_level', fn() => 'verbose' );
$set = function ( $prop, $value ) use ( $L ) { $p = new ReflectionProperty( $L, $prop ); $p->setAccessible( true ); $p->setValue( null, $value ); };
$set( 'dir', null ); $L::clear(); SyncPilot_Import::reset();

$temp = ( new ReflectionProperty( 'SyncPilot_Base', 'temp_prefix' ) )->getValue( $I );
$call = function ( $method, $post = array() ) use ( $I, $wpdb ) { if ( 'ajax_import_step' === $method ) { $wpdb->close(); $wpdb->db_connect( false ); } $_POST = $post; $answer = json_decode( (string) $I->$method(), true ); return is_array( $answer ) ? $answer : array(); };
$errors   = fn() => array_values( array_filter( $L::entries(), fn( $e ) => 'error' === ( $e['level'] ?? '' ) ) );
$messages = fn() => array_map( fn( $e ) => $e['message'], $L::entries() );
$tables_like = fn( $prefix ) => $wpdb->get_col( $wpdb->prepare( 'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_NAME LIKE %s', DB_NAME, $wpdb->esc_like( $prefix ) . '%' ) );

// the import to the end: every request is one of 1 ms (or $seconds) and has a new connection
$import = function ( $name, $form = '', $seconds = 0.001 ) use ( $call, $L ) {
	add_filter( 'syncpilot_import_step_seconds', $f = fn() => $seconds );
	$answer = $call( 'ajax_import_start', array( 'file' => $name, 'form_data' => $form ) );
	$steps  = 0; $phases = array();
	do { $answer = $call( 'ajax_import_step' ); $steps++; $phases[ $answer['phase'] ?? '?' ] = ( $phases[ $answer['phase'] ?? '?' ] ?? 0 ) + 1; }
	while ( empty( $answer['syncpilot_error'] ) && 'replaced' !== ( $answer['phase'] ?? '' ) && $steps < 30000 );
	remove_filter( 'syncpilot_import_step_seconds', $f );
	return array( $answer, $steps, $phases );
};
$form = fn( $old, $new, $guids = false ) => 'replace_old[0]=&replace_new[0]=&replace_old[1]=' . rawurlencode( $old ) . '&replace_new[1]=' . rawurlencode( $new ) . ( $guids ? '&replace_guids=1' : '' );

$prefix = $wpdb->base_prefix;
$esc    = fn( $v ) => null === $v ? 'NULL' : "'" . $wpdb->dbh->real_escape_string( $v ) . "'";

echo "-- a dump that has every kind of value\n";

$rows = array(); // table => rows of array( value of the dump, value that is expected )
$plain      = fn( $i ) => array( "see http://old.test/x/$i here", "see http://new.test/x/$i here" );
$serialized = function ( $i ) { $o = 'http://old.test/p' . $i; $n = 'http://new.test/p' . $i; return array( sprintf( 'a:2:{s:3:"url";s:%d:"%s";s:1:"k";i:5;}', strlen( $o ), $o ), sprintf( 'a:2:{s:3:"url";s:%d:"%s";s:1:"k";i:5;}', strlen( $n ), $n ) ); };
$json       = fn( $i ) => array( '{"u":"http:\/\/old.test\/j' . $i . '","n":1}', '{"u":"http:\/\/new.test\/j' . $i . '","n":1}' );
$capitals   = fn( $i ) => array( "HTTP://OLD.TEST/UP$i", "http://new.test/UP$i" );
$quotes     = fn( $i ) => array( "it's \\ \"q\" http://old.test/q$i\nline", "it's \\ \"q\" http://new.test/q$i\nline" );
$multibyte  = fn( $i ) => array( "Grüße 日本 http://old.test/ü$i", "Grüße 日本 http://new.test/ü$i" );
$untouched  = fn( $i ) => array( "nothing to find $i", "nothing to find $i" );
$kinds      = array( $plain, $serialized, $json, $capitals, $quotes, $multibyte, $untouched );

$dump = "SET NAMES utf8mb4;\n";
$expect = array(); $should_change = 0;

$dump .= "DROP TABLE IF EXISTS `{$prefix}options`;\nCREATE TABLE `{$prefix}options` (`option_id` bigint(20) unsigned NOT NULL AUTO_INCREMENT, `option_name` varchar(191) NOT NULL DEFAULT '', `option_value` longtext NOT NULL, PRIMARY KEY (`option_id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\nINSERT INTO `{$prefix}options` VALUES (1,'siteurl','http://old.test'),(2,'home','http://old.test');\n";
$expect[ $prefix . 'options' ] = array( '1' => array( 'http://new.test' ), '2' => array( 'http://new.test' ) ); $should_change += 2;

// a key of one column, 1400 rows (more than a batch of 100, several requests)
$dump .= "DROP TABLE IF EXISTS `{$prefix}t_pk`;\nCREATE TABLE `{$prefix}t_pk` (`id` int(11) NOT NULL AUTO_INCREMENT, `a` text, `b` longtext, `c` varchar(40) DEFAULT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n";
$values = array();
for ( $i = 1; $i <= 1400; $i++ ) {
	$kind = $kinds[ $i % count( $kinds ) ]; list( $d, $e ) = $kind( $i );
	$c = 0 === $i % 5 ? null : "c$i";
	$values[] = "($i," . $esc( $d ) . ',' . ( 0 === $i % 7 ? 'NULL' : $esc( $d ) ) . ',' . $esc( $c ) . ')';
	$expect[ $prefix . 't_pk' ][ (string) $i ] = array( $e, 0 === $i % 7 ? null : $e, $c );
	if ( $d !== $e ) $should_change++;
}
$dump .= "INSERT INTO `{$prefix}t_pk` VALUES " . implode( ',', $values ) . ";\n";

// a key of two columns
$dump .= "DROP TABLE IF EXISTS `{$prefix}t_comp`;\nCREATE TABLE `{$prefix}t_comp` (`a` int(11) NOT NULL, `b` varchar(10) NOT NULL, `c` text, PRIMARY KEY (`a`,`b`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n";
$values = array();
for ( $i = 1; $i <= 260; $i++ ) {
	$kind = $kinds[ $i % count( $kinds ) ]; list( $d, $e ) = $kind( $i );
	$a = intdiv( $i, 7 ); $b = 'k' . ( $i % 7 );
	$values[] = "($a," . $esc( $b ) . ',' . $esc( $d ) . ')';
	$expect[ $prefix . 't_comp' ][ "$a|$b" ] = array( $e );
	if ( $d !== $e ) $should_change++;
}
$dump .= "INSERT INTO `{$prefix}t_comp` VALUES " . implode( ',', $values ) . ";\n";

// no key; equal rows are two rows
$dump .= "DROP TABLE IF EXISTS `{$prefix}t_nopk`;\nCREATE TABLE `{$prefix}t_nopk` (`x` text, `y` int(11) DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n";
$values = array();
for ( $i = 1; $i <= 230; $i++ ) {
	$kind = $kinds[ $i % count( $kinds ) ]; list( $d, $e ) = $kind( intdiv( $i, 2 ) );   // two rows of the same value
	$y = 0 === $i % 11 ? null : intdiv( $i, 2 );
	$values[] = '(' . $esc( $d ) . ',' . ( null === $y ? 'NULL' : $y ) . ')';
	$expect[ $prefix . 't_nopk' ][] = array( $e, $y );
	if ( $d !== $e ) $should_change++;
}
$dump .= "INSERT INTO `{$prefix}t_nopk` VALUES " . implode( ',', $values ) . ";\n";

// the GUID of a post stays unless asked
$dump .= "DROP TABLE IF EXISTS `{$prefix}posts`;\nCREATE TABLE `{$prefix}posts` (`ID` bigint(20) unsigned NOT NULL, `post_content` longtext NOT NULL, `guid` varchar(255) NOT NULL DEFAULT '', PRIMARY KEY (`ID`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\nINSERT INTO `{$prefix}posts` VALUES (1,'<a href=\"http://old.test/a\">a</a>','http://old.test/?p=1'),(2,'text','http://old.test/?p=2');\n";

$should_change++;   // the post with the address in its content
file_put_contents( $folder . '/values.sql', $dump );
file_put_contents( $folder . '/values.sql.gz', gzencode( $dump ) );

foreach ( array( 'values.sql', 'values.sql.gz' ) as $name ) {

	$L::clear();
	list( $answer, $steps, $phases ) = $import( $name, $form( 'http://old.test', 'http://new.test' ) );

	$check( "$name: the import goes through unpack/scan, load and replace in many requests, and ends with replaced", 'replaced' === ( $answer['phase'] ?? '' ) && $steps > 15 && ( $phases['scan'] ?? 0 ) === ( '.gz' === substr( $name, -3 ) ? 2 : 1 ), json_encode( $phases ) . ' ' . $steps . ' requests; ' . json_encode( $answer ) );
	$check( "$name: nothing went wrong in the log", array() === $errors(), json_encode( $errors() ) );

	$wrong = array(); $found_rows = 0;
	foreach ( array( 't_pk' => array( 'id' ), 't_comp' => array( 'a', 'b' ) ) as $t => $key ) {
		foreach ( $wpdb->get_results( "SELECT * FROM `{$temp}{$prefix}$t`", ARRAY_A ) as $row ) {
			$k      = implode( '|', array_map( fn( $c ) => $row[ $c ], $key ) );
			$values = array_values( array_diff_key( $row, array_flip( $key ) ) );
			$found_rows++;
			if ( ! isset( $expect[ $prefix . $t ][ $k ] ) || $expect[ $prefix . $t ][ $k ] !== $values ) $wrong[] = "$t $k";
		}
	}
	$check( "$name: every row of the tables with a key is what it should be (plain, serialized, JSON, capitals, quotes, multibyte, NULL, untouched)", array() === $wrong && 1400 + 260 === $found_rows, count( $wrong ) . ' wrong; first: ' . implode( ', ', array_slice( $wrong, 0, 4 ) ) );

	// a serialized value is a valid serialized value after it, with the new length
	$bad_serial = (int) $wpdb->get_var( "SELECT COUNT(*) FROM `{$temp}{$prefix}t_pk` WHERE `a` LIKE 'a:2:{%' AND `a` NOT LIKE 'a:2:{s:3:\"url\";s:19:\"http://new.test/p%'" );
	$unserialized = 0; foreach ( $wpdb->get_col( "SELECT `a` FROM `{$temp}{$prefix}t_pk` WHERE `a` LIKE 'a:2:{%'" ) as $v ) if ( is_array( @unserialize( $v ) ) ) $unserialized++;
	$total_serial = (int) $wpdb->get_var( "SELECT COUNT(*) FROM `{$temp}{$prefix}t_pk` WHERE `a` LIKE 'a:2:{%'" );
	$check( "$name: the serialized values can be unserialized and have the new length", $total_serial > 100 && $unserialized === $total_serial, "$unserialized / $total_serial" );

	$got = $wpdb->get_results( "SELECT `x`, `y` FROM `{$temp}{$prefix}t_nopk`", ARRAY_N ); $want = array_map( fn( $r ) => array( $r[0], null === $r[1] ? null : (string) $r[1] ), $expect[ $prefix . 't_nopk' ] );
	$sort = function ( $rows ) { usort( $rows, fn( $a, $b ) => strcmp( json_encode( $a ), json_encode( $b ) ) ); return $rows; };
	$check( "$name: the table without a key: every row is changed, equal rows too", $sort( $got ) === $sort( $want ) && 230 === count( $got ) );

	$check( "$name: the options and the GUID: the address is new, the GUID of the post is not", array( 'http://new.test', 'http://new.test' ) === $wpdb->get_col( "SELECT option_value FROM `{$temp}{$prefix}options` ORDER BY option_id" ) && array( '<a href="http://new.test/a">a</a>', 'http://old.test/?p=1' ) === array( $wpdb->get_var( "SELECT post_content FROM `{$temp}{$prefix}posts` WHERE ID = 1" ), $wpdb->get_var( "SELECT guid FROM `{$temp}{$prefix}posts` WHERE ID = 1" ) ) );

	$e = current( array_filter( $L::entries(), fn( $e ) => 'Import replaced' === $e['message'] ) );
	$check( "$name: the log has Import replaced with the number of rows that were looked at and changed ($should_change)", $e && $e['context']['rows_changed'] === $should_change && $e['context']['rows_checked'] >= $should_change && $e['context']['tables'] === 5, json_encode( $e['context'] ?? null ) );
	$check( "$name: the unpacked copy of the gzip file is gone", array() === glob( $folder . '/.work/*' ) );

	$again = $call( 'ajax_import_step' );
	$check( "$name: a request after the end gives the same answer", 'replaced' === ( $again['phase'] ?? '' ) && 1 === count( array_filter( $messages(), fn( $x ) => 'Import replaced' === $x ) ) );
	$call( 'ajax_import_cancel' );
	$check( "$name: cancel removes the temporary tables", array() === $tables_like( $temp ) );
}

// the GUIDs, when asked
$L::clear();
list( $answer ) = $import( 'values.sql', $form( 'http://old.test', 'http://new.test', true ), 10 );
$check( 'with replace_guids the GUID of a post is new as well', 'http://new.test/?p=1' === $wpdb->get_var( "SELECT guid FROM `{$temp}{$prefix}posts` WHERE ID = 1" ) && 'replaced' === ( $answer['phase'] ?? '' ) );
$call( 'ajax_import_cancel' );

// a replacement that holds what is looked for: every value is changed once
$L::clear();
list( $answer ) = $import( 'values.sql', $form( 'http://old.test', 'http://old.test/sub' ), 10 );
$check( 'a replacement that holds the text it looks for is applied once, to the rows with a key', 'replaced' === ( $answer['phase'] ?? '' ) && 'see http://old.test/sub/x/7 here' === $wpdb->get_var( "SELECT a FROM `{$temp}{$prefix}t_pk` WHERE id = 7" ) );
$sub = $wpdb->get_results( "SELECT x FROM `{$temp}{$prefix}t_nopk` WHERE x LIKE 'see %'", ARRAY_N );
$check( 'also in the table without a key (no row is changed twice)', count( $sub ) > 20 && 0 === count( array_filter( $sub, fn( $r ) => false !== strpos( $r[0], '/sub/sub' ) ) ) && 0 === (int) $wpdb->get_var( "SELECT COUNT(*) FROM `{$temp}{$prefix}t_pk` WHERE a LIKE '%/sub/sub%'" ) );
$call( 'ajax_import_cancel' );

// nothing to find: the values are the dump's
$L::clear();
list( $answer ) = $import( 'values.sql', '', 10 );
$check( 'without a find and replace row the replace is over at once and changes nothing', 'replaced' === ( $answer['phase'] ?? '' ) && 0 === $answer['rows_changed'] && 0 === (int) $wpdb->get_var( "SELECT COUNT(*) FROM `{$temp}{$prefix}t_pk` WHERE a LIKE '%new.test%'" ) );
$call( 'ajax_import_cancel' );

// -- the gzip file is read by itself when the disk has no room for the copy
echo "-- a gzip dump when the disk has no room to unpack it\n";
$L::clear();
add_filter( 'syncpilot_import_free_bytes', $low = fn() => 1000 );
list( $answer, , $phases ) = $import( 'values.sql.gz', $form( 'http://old.test', 'http://new.test' ), 10 );
remove_filter( 'syncpilot_import_free_bytes', $low );
$info = current( array_filter( $L::entries(), fn( $e ) => 'Import reads the gzip file itself' === $e['message'] ) );
$check( 'without room there is no unpacking: the file is read as it is, and the import works', 'replaced' === ( $answer['phase'] ?? '' ) && 0 === ( $phases['unpack'] ?? 0 ) && $info && 1000 === $info['context']['free_bytes'] && array() === glob( $folder . '/.work/*' ) && array() === $errors(), json_encode( $phases ) );
$check( 'and its rows are the same', 'http://new.test' === $wpdb->get_var( "SELECT option_value FROM `{$temp}{$prefix}options` WHERE option_id = 1" ) && 1400 === (int) $wpdb->get_var( "SELECT COUNT(*) FROM `{$temp}{$prefix}t_pk`" ) );
$call( 'ajax_import_cancel' );

// a gzip file that is damaged
$L::clear();
file_put_contents( $folder . '/broken.sql.gz', substr( gzencode( str_repeat( "INSERT INTO `{$prefix}t` VALUES (1);\n", 50000 ) ), 0, 400 ) );
list( $answer ) = $import( 'broken.sql.gz', '', 10 );
$e = $errors();
$check( 'a gzip file that is cut off stops the import with 304, nothing is left', ! empty( $answer['syncpilot_error'] ) && 1 === count( $e ) && 304 === $e[0]['help'] && in_array( $e[0]['context']['reason'], array( 'gzip_corrupt', 'unterminated' ), true ) && array() === glob( $folder . '/.work/*' ) && array() === glob( $logs . '/import-*.json' ), json_encode( $e ) );

// -- a real dump of this site
echo "-- a dump of the database of this site: every row as the function of a push or a pull gives it\n";
$L::clear();
$real = $folder . '/real.sql';
$out  = array(); $status = 1;
@exec( 'wp --path=' . escapeshellarg( ABSPATH ) . ' db export ' . escapeshellarg( $real ) . ' --quiet 2>&1', $out, $status );
$host = parse_url( home_url(), PHP_URL_HOST );

if ( 0 !== $status ) {
	$check( 'the dump could be made with wp db export', false, implode( ' ', $out ) );
}

else {

	list( $answer, $steps ) = $import( 'real.sql', $form( $host, 'replaced-host.test' ), 0.5 );
	$check( "the replace of $host to replaced-host.test ends: " . ( $answer['rows_checked'] ?? '?' ) . ' rows looked at, ' . ( $answer['rows_changed'] ?? '?' ) . ' changed', 'replaced' === ( $answer['phase'] ?? '' ) && ( $answer['rows_changed'] ?? 0 ) > 20 && array() === $errors(), json_encode( $answer ) . json_encode( $errors() ) );

	$syncpilot->set_migration_form_data( $form( $host, 'replaced-host.test' ) );
	$names = $wpdb->get_col( $wpdb->prepare( 'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_NAME NOT LIKE %s', DB_NAME, $wpdb->esc_like( $temp ) . '%' ) );
	$different = array(); $left = array(); $changed = 0;

	foreach ( $names as $table ) {

		$columns = $wpdb->get_results( "SHOW COLUMNS FROM `$table`", ARRAY_A );
		$strings = array_map( fn( $c ) => $c['Field'], array_filter( $columns, fn( $c ) => preg_match( '/^(?:char|varchar|tinytext|text|mediumtext|longtext|tinyblob|blob|mediumblob|longblob|json)\b/i', $c['Type'] ) ) );
		$want = array(); $got = array();

		foreach ( (array) $wpdb->get_results( "SELECT * FROM `$table`", ARRAY_A ) as $row ) {
			foreach ( $strings as $c )
				if ( null !== $row[ $c ] && '' !== $row[ $c ] && 'guid' !== $c ) { $n = $syncpilot->recursive_unserialize_replace( $row[ $c ] ); if ( is_string( $n ) ) $row[ $c ] = $n; }
			$want[] = md5( json_encode( $row ) );
		}
		foreach ( (array) $wpdb->get_results( "SELECT * FROM `{$temp}$table`", ARRAY_A ) as $row ) $got[] = md5( json_encode( $row ) );
		sort( $want ); sort( $got );
		if ( $want !== $got ) $different[] = $table;

		if ( $strings ) {
			$cond = implode( ' OR ', array_map( fn( $c ) => '`' . $c . '` LIKE ' . "'%" . $wpdb->esc_like( $host ) . "%'", $strings ) );
			$n = (int) $wpdb->get_var( "SELECT COUNT(*) FROM `{$temp}$table` WHERE $cond" );
			if ( $n ) $left[ $table ] = $n;
		}
	}

	$check( 'every row of every table is the same as the function of a push or a pull gives for the row of the table', array() === $different && count( $names ) > 50, count( $names ) . ' tables; different: ' . implode( ', ', $different ) );
	$check( 'no value has the old host any more (but the GUIDs, which a push or a pull leaves too)', array() === array_diff_key( $left, array( $prefix . 'posts' => 1 ) ), json_encode( $left ) );
}

// -- clean up
$call( 'ajax_import_cancel' );
remove_all_filters( 'syncpilot_import_dir' ); remove_all_filters( 'syncpilot_log_dir' ); remove_all_filters( 'syncpilot_log_level' );
$set( 'dir', null ); SyncPilot_Import::reset();
$syncpilot->delete_temporary_tables( $temp );
$remove = function ( $p ) use ( &$remove ) { if ( is_file( $p ) ) { @unlink( $p ); return; } if ( is_dir( $p ) ) { foreach ( scandir( $p ) as $n ) if ( '.' !== $n && '..' !== $n ) $remove( $p . '/' . $n ); @rmdir( $p ); } };
$remove( $base );
$check( 'no temporary table and no test folder is left', array() === $tables_like( $temp ) && ! file_exists( $base ) );

printf( "\n%d ok, %d failed\n", $ok, $bad );
exit( $bad ? 1 : 0 );
