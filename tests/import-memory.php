<?php
/**
 * The memory of the import: a table with big values (3 MB each) is loaded and replaced with a memory limit that 100 of its rows
 * do not fit into. The replace reads a batch of rows only as far as its budget goes, so the limit is not reached. Run it alone:
 * it sets the limit of PHP for itself, and a limit that is reached ends the script (no "ok" lines at the end).
 *
 * Run on a TEST installation only:   wp eval-file wp-content/plugins/sync-pilot/tests/import-memory.php
 */

error_reporting( E_ALL ); global $syncpilot, $syncpilot_import, $wpdb; $ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };
$L     = 'SyncPilot_Logger';
$I     = $syncpilot_import;

if ( ! defined( 'DOING_SYNCPILOT_TESTS' ) )
	define( 'DOING_SYNCPILOT_TESTS', true );

$rows   = 40;
$bytes  = 3 * 1048576;
$base   = sys_get_temp_dir() . '/syncpilot-import-memory-' . uniqid();
$folder = $base . '/imports';
mkdir( $folder, 0755, true ); mkdir( $base . '/logs', 0755, true );
add_filter( 'syncpilot_import_dir', fn() => $folder );
add_filter( 'syncpilot_log_dir', fn() => $base . '/logs' );
add_filter( 'syncpilot_import_step_seconds', fn() => 20 );
$set = function ( $prop, $value ) use ( $L ) { $p = new ReflectionProperty( $L, $prop ); $p->setAccessible( true ); $p->setValue( null, $value ); };
$set( 'dir', null ); SyncPilot_Import::reset();

$temp   = ( new ReflectionProperty( 'SyncPilot_Base', 'temp_prefix' ) )->getValue( $I );
$prefix = $wpdb->base_prefix;

// the dump is written row by row: the test itself must not need the memory that it takes away from the import
$handle = fopen( $folder . '/big.sql', 'w' );
fwrite( $handle, "SET NAMES utf8mb4;\nDROP TABLE IF EXISTS `{$prefix}options`;\nCREATE TABLE `{$prefix}options` (`option_id` int(11) NOT NULL, `option_value` longtext, PRIMARY KEY (`option_id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n" );
$filler = str_repeat( 'A', $bytes - 100 );
for ( $i = 1; $i <= $rows; $i++ )
	fwrite( $handle, "INSERT INTO `{$prefix}options` VALUES ($i,'start http://old.test/$i $filler end');\n" );
fclose( $handle );
unset( $filler );

$limit = 96 * 1048576;
ini_set( 'memory_limit', '96M' );

$call = function ( $method, $post = array() ) use ( $I, $wpdb ) { if ( 'ajax_import_step' === $method ) { $wpdb->close(); $wpdb->db_connect( false ); } $_POST = $post; $answer = json_decode( (string) $I->$method(), true ); return is_array( $answer ) ? $answer : array(); };

$call( 'ajax_import_start', array( 'file' => 'big.sql', 'form_data' => 'replace_old[0]=&replace_new[0]=&replace_old[1]=' . rawurlencode( 'http://old.test' ) . '&replace_new[1]=' . rawurlencode( 'http://new.test' ) ) );
$steps = 0;
do { $answer = $call( 'ajax_import_step' ); $steps++; } while ( empty( $answer['syncpilot_error'] ) && 'replaced' !== ( $answer['phase'] ?? '' ) && $steps < 500 );
$peak = memory_get_peak_usage( true );

$check( 'the import goes to the end with a memory limit of 96 MB although the table has ' . $rows . ' rows of 3 MB', 'replaced' === ( $answer['phase'] ?? '' ), json_encode( $answer ) );
$check( 'every row was changed', $rows === ( $answer['rows_changed'] ?? 0 ) && $rows === (int) $wpdb->get_var( "SELECT COUNT(*) FROM `{$temp}{$prefix}options` WHERE option_value LIKE '%http://new.test/%' AND option_value NOT LIKE '%http://old.test%'" ), json_encode( $answer ) );
$check( 'the peak of the memory is below the limit (' . round( $peak / 1048576 ) . ' MB)', $peak < $limit, (string) $peak );

$call( 'ajax_import_cancel' );
ini_set( 'memory_limit', '512M' );
remove_all_filters( 'syncpilot_import_dir' ); remove_all_filters( 'syncpilot_log_dir' ); remove_all_filters( 'syncpilot_import_step_seconds' );
$set( 'dir', null ); SyncPilot_Import::reset();
$syncpilot->delete_temporary_tables( $temp );
$remove = function ( $p ) use ( &$remove ) { if ( is_file( $p ) ) { @unlink( $p ); return; } if ( is_dir( $p ) ) { foreach ( scandir( $p ) as $n ) if ( '.' !== $n && '..' !== $n ) $remove( $p . '/' . $n ); @rmdir( $p ); } };
$remove( $base );
$check( 'no test folder is left', ! file_exists( $base ) );

printf( "\n%d ok, %d failed\n", $ok, $bad );
exit( $bad ? 1 : 0 );
