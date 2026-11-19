<?php
/**
 * Checks of the import of a dump as far as the temporary tables (SyncPilot_Import::ajax_import_start(), _step(), _cancel()):
 * a real dump of the test site is scanned and loaded in many short requests, every table is the same as the original
 * (checksum), the log has the entries of the migration; and what must stop the import does: a statement that is not
 * allowed, a collation the database does not know, another prefix, a file that is cut off, a statement that the database
 * refuses, a name that is no dump, a state that is gone. Nothing of the real tables is touched.
 *
 * Run on a TEST installation only:   wp eval-file wp-content/plugins/sync-pilot/tests/import-load.php
 */

error_reporting( E_ALL ); global $syncpilot, $syncpilot_import, $wpdb; $ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };
$L     = 'SyncPilot_Logger';
$I     = $syncpilot_import;

if ( ! defined( 'DOING_SYNCPILOT_TESTS' ) )
	define( 'DOING_SYNCPILOT_TESTS', true );

$base   = sys_get_temp_dir() . '/syncpilot-import-load-' . uniqid();
$folder = $base . '/imports';
$logs   = $base . '/logs';
mkdir( $folder, 0755, true ); mkdir( $logs, 0755, true );

add_filter( 'syncpilot_import_dir', fn() => $folder );
add_filter( 'syncpilot_log_dir', fn() => $logs );
add_filter( 'syncpilot_log_level', fn() => 'verbose' );
$set = function ( $prop, $value ) use ( $L ) { $p = new ReflectionProperty( $L, $prop ); $p->setAccessible( true ); $p->setValue( null, $value ); };
$set( 'dir', null ); $L::clear(); SyncPilot_Import::reset();

$temp = ( new ReflectionProperty( 'SyncPilot_Base', 'temp_prefix' ) )->getValue( $I );
// every call is a request of its own: a new connection, so the settings of the session of the one before are gone
$call = function ( $method, $post = array() ) use ( $I, $wpdb ) { if ( 'ajax_import_step' === $method ) { $wpdb->close(); $wpdb->db_connect( false ); } $_POST = $post; $answer = json_decode( (string) $I->$method(), true ); return is_array( $answer ) ? $answer : array(); };
$entries   = fn() => $L::entries();
$messages  = fn() => array_map( fn( $e ) => $e['message'], $L::entries() );
$errors    = fn() => array_values( array_filter( $L::entries(), fn( $e ) => 'error' === ( $e['level'] ?? '' ) ) );
$tables_like = fn( $prefix ) => $wpdb->get_col( $wpdb->prepare( 'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_NAME LIKE %s', DB_NAME, $wpdb->esc_like( $prefix ) . '%' ) );
$run = function ( $name, $post = array(), $seconds = 0.001, $max = 5000 ) use ( $call ) {
	add_filter( 'syncpilot_import_step_seconds', $f = fn() => $seconds );
	$answer = $call( 'ajax_import_start', array( 'file' => $name ) + $post );
	$steps  = 0; $last = $answer;
	while ( isset( $answer['migration_id'] ) && empty( $last['syncpilot_error'] ) && $steps < $max ) {
		$last = $call( 'ajax_import_step' ); $steps++;
		if ( ! empty( $last['done'] ) ) break;
	}
	remove_filter( 'syncpilot_import_step_seconds', $f );
	return array( $answer, $last, $steps );
};

echo "-- a dump of this site, scanned and loaded in short requests\n";
$real = $folder . '/real.sql';
$out  = array(); $status = 1;
@exec( 'wp --path=' . escapeshellarg( ABSPATH ) . ' db export ' . escapeshellarg( $real ) . ' --quiet 2>&1', $out, $status );
$check( 'the dump could be made with wp db export', 0 === $status && is_file( $real ), implode( ' ', $out ) );

$names = $wpdb->get_col( $wpdb->prepare( 'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_NAME NOT LIKE %s', DB_NAME, $wpdb->esc_like( $temp ) . '%' ) );

// the file is used as it is, and as a gzip file: the same
file_put_contents( $folder . '/real.sql.gz', gzencode( file_get_contents( $real ) ) );

foreach ( array( 'real.sql', 'real.sql.gz' ) as $name ) {

	$L::clear();
	list( $started, $scanned, $steps ) = $run( $name );

	$check( "$name: the import starts with an ID of the migration and the size of the text (a gzip file is unpacked first)", ! empty( $started['migration_id'] ) && $started['total'] === SyncPilot_Import::text_size( $folder . '/' . $name ) && ( '.gz' === substr( $name, -3 ) ? 'unpack' : 'scan' ) === $started['phase'], json_encode( $started ) );
	$check( "$name: the scan needs several requests of 1 ms, and ends with the list of the tables", $steps > 5 && 'scanned' === ( $scanned['phase'] ?? '' ) && true === ( $scanned['done'] ?? false ) && count( $names ) === count( $scanned['table_names'] ?? array() ), "$steps requests; " . json_encode( array_diff_key( $scanned, array( 'table_names' => 1 ) ) ) );
	$check( "$name: the scan wrote nothing: no temporary table yet", array() === $tables_like( $temp ) );
	$check( "$name: the offset at the end of the scan is the size of the text", ( $scanned['offset'] ?? 0 ) === ( $scanned['total'] ?? -1 ), json_encode( array( $scanned['offset'] ?? null, $scanned['total'] ?? null ) ) );
	$check( "$name: the prefix is found", $wpdb->base_prefix === ( $scanned['prefix'] ?? null ), (string) ( $scanned['prefix'] ?? '' ) );

	$id = $L::migration_id();
	add_filter( 'syncpilot_import_step_seconds', $f = fn() => 0.001 );
	$steps = 0; $loaded = array(); $progress = array();
	do { $loaded = $call( 'ajax_import_step' ); $steps++; $progress[] = $loaded['offset'] ?? -1; } while ( empty( $loaded['syncpilot_error'] ) && 'loaded' !== ( $loaded['phase'] ?? '' ) && $steps < 20000 );
	remove_filter( 'syncpilot_import_step_seconds', $f );

	$check( "$name: the load needs many requests and ends with phase loaded", $steps > 20 && 'loaded' === ( $loaded['phase'] ?? '' ) && true === ( $loaded['done'] ?? false ), "$steps requests; " . json_encode( array_diff_key( $loaded, array( 'table_names' => 1 ) ) ) );
	$sorted = $progress; sort( $sorted );
	$check( "$name: the place only moves forward and ends at the end of the text", $progress === $sorted && end( $progress ) === $loaded['total'] );
	$check( "$name: as many tables were made as the dump has", ( $loaded['tables_done'] ?? -1 ) === count( $names ), (string) ( $loaded['tables_done'] ?? '' ) );

	$temp_tables = $tables_like( $temp );
	$check( "$name: every table is there under the temporary prefix (and the table for the ALTER queries is not counted)", count( $names ) === count( array_filter( $temp_tables, fn( $t ) => 0 === strpos( $t, $temp ) ) ), count( $temp_tables ) . ' tables' );

	$different = array();
	foreach ( $names as $table ) {
		$a = $wpdb->get_row( 'CHECKSUM TABLE `' . $table . '`', ARRAY_N ); $b = $wpdb->get_row( 'CHECKSUM TABLE `' . $temp . $table . '`', ARRAY_N );
		if ( ! $a || ! $b || $a[1] !== $b[1] ) $different[] = $table;
	}
	$check( "$name: every temporary table is the same as its table (checksum), loaded in $steps requests that each begin at a place of the file", array() === $different && count( $names ) > 0, implode( ', ', $different ) );

	$m = $messages();
	$check( "$name: the log has Migration started, Import scanned, Import loaded and the steps (verbose)", 'Migration started' === $m[0] && in_array( 'Import scanned', $m, true ) && in_array( 'Import loaded', $m, true ) && count( array_filter( $m, fn( $x ) => 'Import step' === $x ) ) > 40 && array() === $errors(), implode( ',', array_unique( $m ) ) );
	$loaded_entry = current( array_filter( $entries(), fn( $e ) => 'Import loaded' === $e['message'] ) );
	$check( "$name: Import loaded has the tables, the statements and the bytes", $loaded_entry && $loaded_entry['context']['tables'] === count( $names ) && $loaded_entry['context']['bytes'] === $loaded['total'] && $loaded_entry['context']['statements'] > count( $names ), json_encode( $loaded_entry['context'] ?? null ) );

	$check( "$name: the unpacked copy of a gzip file is removed when the load is over", array() === glob( $folder . '/.work/*' ) );

	$again = $call( 'ajax_import_step' );
	$check( "$name: the request after the load is the replace: with nothing to find it is over at once", 'replaced' === ( $again['phase'] ?? '' ) && 0 === $again['rows_changed'] && 1 === count( array_filter( $messages(), fn( $x ) => 'Import loaded' === $x ) ) && 1 === count( array_filter( $messages(), fn( $x ) => 'Import replaced' === $x ) ) );

	$cancelled = $call( 'ajax_import_cancel' );
	$check( "$name: cancel removes the temporary tables and the state, and the log has the end", 1 === ( $cancelled['cancelled'] ?? 0 ) && array() === $tables_like( $temp ) && array() === glob( $logs . '/import-*.json' ) && in_array( 'Migration cancelled', $messages(), true ), implode( ',', $tables_like( $temp ) ) );
}

// the same table names, nothing changed: the real tables are as they were
$check( 'the real tables are untouched: the same tables as before', $names === $wpdb->get_col( $wpdb->prepare( 'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_NAME NOT LIKE %s', DB_NAME, $wpdb->esc_like( $temp ) . '%' ) ) );

echo "-- what stops the import\n";
unlink( $real ); unlink( $folder . '/real.sql.gz' );
$bad_dump = function ( $name, $sql ) use ( $folder ) { file_put_contents( $folder . '/' . $name, $sql ); return $name; };
$prefix   = $wpdb->base_prefix;
$good     = "SET NAMES utf8mb4;\nDROP TABLE IF EXISTS `{$prefix}options`;\nCREATE TABLE `{$prefix}options` (`a` int) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\nINSERT INTO `{$prefix}options` VALUES (1);\n";

// a statement that is not allowed, found by the scan before anything is made
$L::clear();
list( $started, $last ) = $run( $bad_dump( 'update.sql', $good . "UPDATE {$prefix}users SET user_pass='secret';\n" ), array(), 10 );
$e = $errors();
$check( 'a statement that is not allowed stops the scan, with its kind and reason in the answer', ! empty( $last['syncpilot_error'] ) && false !== strpos( $last['body'], 'UPDATE' ) && false !== strpos( $last['body'], '#302' ) && false === strpos( $last['body'], 'secret' ), (string) ( $last['body'] ?? '' ) );
$check( 'the log has the error 302 with the place, no value, and the migration is stopped', 1 === count( $e ) && 302 === $e[0]['help'] && 'UPDATE' === $e[0]['context']['kind'] && 'scan' === $e[0]['context']['phase'] && false === strpos( json_encode( $e ), 'secret' ) && in_array( 'Migration stopped', $messages(), true ) );
$check( 'nothing was made, the state is gone', array() === $tables_like( $temp ) && array() === glob( $logs . '/import-*.json' ) );

// a collation that the database does not know
$L::clear();
list( , $last ) = $run( $bad_dump( 'collation.sql', "CREATE TABLE `{$prefix}options` (`a` varchar(10) COLLATE klingon_ci) ENGINE=InnoDB;\n" ), array(), 10 );
$e = $errors();
$check( 'a collation that this database does not know stops the import before the first table', ! empty( $last['syncpilot_error'] ) && false !== strpos( $last['body'], 'klingon_ci' ) && 1 === count( $e ) && 303 === $e[0]['help'] && array( 'klingon_ci' ) === $e[0]['context']['collations'] && array() === $tables_like( $temp ) );

// a collation that this database does not know: a similar one is used, or the import stops when the form says so
$L::clear();
$klingon = $bad_dump( 'unknown-collation.sql', "SET NAMES utf8mb4;\nDROP TABLE IF EXISTS `{$prefix}options`;\nCREATE TABLE `{$prefix}options` (`option_id` int(11) NOT NULL, `option_value` varchar(20) COLLATE utf8mb4_klingon_ai_ci DEFAULT NULL, PRIMARY KEY (`option_id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_klingon_ai_ci;\nINSERT INTO `{$prefix}options` VALUES (1,'Qapla');\n" );
list( , $last, ) = $run( $klingon, array( 'strict_collations' => 1 ), 10 );
$e = $errors();
$check( 'with strict_collations an unknown collation stops the import (303), the name is said', ! empty( $last['syncpilot_error'] ) && false !== strpos( $last['body'], 'utf8mb4_klingon_ai_ci' ) && 1 === count( $e ) && 303 === $e[0]['help'] && true === $e[0]['context']['strict'] && array() === $tables_like( $temp ) );
$L::clear();
list( , $last, ) = $run( $klingon, array(), 10 );
$check( 'otherwise it is scanned to the end, and the log says which collation was used instead', 'scanned' === ( $last['phase'] ?? '' ) && array() === $errors() && 'utf8mb4_unicode_520_ci' === ( current( array_filter( $L::entries(), fn( $e ) => 'Import scanned' === $e['message'] ) )['context']['collations_mapped']['collations']['utf8mb4_klingon_ai_ci'] ?? '' ) );
add_filter( 'syncpilot_import_step_seconds', $f = fn() => 10 );
$loaded = $call( 'ajax_import_step' );
remove_filter( 'syncpilot_import_step_seconds', $f );
$create = (string) $wpdb->get_var( "SHOW CREATE TABLE `{$temp}{$prefix}options`", 1 );
$check( 'the table was made with the collation that this database knows, and the row is there', 'loaded' === ( $loaded['phase'] ?? '' ) && false !== stripos( $create, 'utf8mb4_unicode_520_ci' ) && false === stripos( $create, 'klingon' ) && 'Qapla' === $wpdb->get_var( "SELECT option_value FROM `{$temp}{$prefix}options` WHERE option_id = 1" ), $create );
$call( 'ajax_import_cancel' );

// another prefix
$L::clear();
list( , $last ) = $run( $bad_dump( 'prefix.sql', "CREATE TABLE `zz_options` (`a` int);\nCREATE TABLE `zz_posts` (`a` int);\n" ), array(), 10 );
$e = $errors();
$check( 'tables with another prefix stop the import, the names are said', ! empty( $last['syncpilot_error'] ) && false !== strpos( $last['body'], 'zz_' ) && false !== strpos( $last['body'], $prefix ) && 1 === count( $e ) && 305 === $e[0]['help'] && array() === $tables_like( $temp ) );
$L::clear();
list( , $last, ) = $run( 'prefix.sql', array( 'other_prefix' => 1 ), 10 );
$check( 'with other_prefix the same file is scanned to the end', 'scanned' === ( $last['phase'] ?? '' ) && 'zz_' === $last['prefix'] && array() === $errors() );
$call( 'ajax_import_cancel' );

// a file that is cut off
$L::clear();
list( , $last ) = $run( $bad_dump( 'cut.sql', $good . "INSERT INTO `{$prefix}options` VALUES ('abc" ), array(), 10 );
$e = $errors();
$check( 'a file that ends inside a text stops the import with error 304', ! empty( $last['syncpilot_error'] ) && false !== strpos( $last['body'], '#304' ) && 1 === count( $e ) && 304 === $e[0]['help'] && 'unterminated' === $e[0]['context']['reason'] && 'scan' === $e[0]['context']['phase'] );

// a statement that the scan lets through and the database refuses: the temporary tables are removed again
$L::clear();
list( , $last ) = $run( $bad_dump( 'refused.sql', $good . "INSERT INTO `{$prefix}missing_table` VALUES (1);\n" ), array(), 10 );
$check( 'the scan lets it through: it is a plain INSERT', 'scanned' === ( $last['phase'] ?? '' ) && array() === $errors() );
add_filter( 'syncpilot_import_step_seconds', fn() => 10 );
$last = $call( 'ajax_import_step' );
$e    = $errors();
$check( 'a statement that the database refuses stops the loading, error 152 with the kind and table but no value', ! empty( $last['syncpilot_error'] ) && false !== strpos( $last['body'], '#152' ) && 1 === count( $e ) && 152 === $e[0]['help'] && 'INSERT INTO' === $e[0]['context']['query'] && false === strpos( json_encode( $e ), 'VALUES' ), json_encode( $e ) );
$check( 'the tables that were made are removed, the state is gone, the log has Migration stopped', array() === $tables_like( $temp ) && array() === glob( $logs . '/import-*.json' ) && in_array( 'Migration stopped', $messages(), true ), implode( ',', $tables_like( $temp ) ) );

// a name that is no dump, and a state that is gone
$L::clear();
$answer = $call( 'ajax_import_start', array( 'file' => '../etc/passwd' ) );
$e = $errors();
$check( 'a name that is no dump is refused (301)', ! empty( $answer['syncpilot_error'] ) && 1 === count( $e ) && 301 === $e[0]['help'] );
$L::set_migration_id( 'no-such-migration' );
$answer = $call( 'ajax_import_step' );
$e = $errors();
$check( 'a request without a state is answered with 306', ! empty( $answer['syncpilot_error'] ) && false !== strpos( $answer['body'], '#306' ) && 306 === end( $e )['help'] );

// -- clean up
remove_all_filters( 'syncpilot_import_dir' ); remove_all_filters( 'syncpilot_log_dir' ); remove_all_filters( 'syncpilot_log_level' );
$set( 'dir', null ); SyncPilot_Import::reset();
$syncpilot->delete_temporary_tables( $temp );
$remove = function ( $p ) use ( &$remove ) { if ( is_file( $p ) ) { @unlink( $p ); return; } if ( is_dir( $p ) ) { foreach ( scandir( $p ) as $n ) if ( '.' !== $n && '..' !== $n ) $remove( $p . '/' . $n ); @rmdir( $p ); } };
$remove( $base );
$check( 'no temporary table and no test folder is left', array() === $tables_like( $temp ) && ! file_exists( $base ) );

printf( "\n%d ok, %d failed\n", $ok, $bad );
exit( $bad ? 1 : 0 );
