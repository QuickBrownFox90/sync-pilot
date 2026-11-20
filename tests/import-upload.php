<?php
/**
 * The upload of a dump (SyncPilot_Import): the name that the upload gives a file, the way to tell an uploaded file from one that
 * was put into the folder, the parts of uploads that were not finished, the removal of a dump (the link of the list), and the
 * removal after the import (only after the tables are replaced, never after a cancel). The parts that the page sends are
 * checked by tests/browser/import.mjs --upload (a request with a file of the form cannot be made here).
 *
 * Run on a TEST installation only:   wp eval-file wp-content/plugins/sync-pilot/tests/import-upload.php
 */

error_reporting( E_ALL ); global $syncpilot, $syncpilot_import; $ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };
$I     = 'SyncPilot_Import';

if ( ! defined( 'DOING_SYNCPILOT_TESTS' ) )
	define( 'DOING_SYNCPILOT_TESTS', true );

$base = sys_get_temp_dir() . '/syncpilot-import-upload-test-' . uniqid();

add_filter( 'syncpilot_import_dir', fn() => $base . '/imports' );
$I::reset();

SyncPilot_Logger::set_migration_id( SyncPilot_Logger::new_migration_id() );

$dir = $I::dir();
$check( 'the folder is made', is_dir( $dir ) );

// -- the name of an upload
$name = $I::uploaded_name( 'Kunde Müller (2026).sql' );
$check( 'the name keeps what is allowed, the rest becomes a dash, and -u and eight characters come before the extension', 1 === preg_match( '/^Kunde-M-ller-\(2026\)-u[0-9a-f]{8}\.sql$/', $name ) && $I::is_valid_name( $name ), $name );
$check( 'a gzip file stays .sql.gz, and the browser compressing a .sql file makes it .sql.gz', 1 === preg_match( '/-u[0-9a-f]{8}\.sql\.gz$/', $I::uploaded_name( 'a.sql.gz' ) ) && 1 === preg_match( '/-u[0-9a-f]{8}\.sql\.gz$/', $I::uploaded_name( 'a.sql', true ) ) );
$check( 'two uploads of the same file get two names', $I::uploaded_name( 'a.sql' ) !== $I::uploaded_name( 'a.sql' ) );
$check( 'another extension is refused', false === $I::uploaded_name( 'a.txt' ) && false === $I::uploaded_name( 'a.zip' ) && false === $I::uploaded_name( '' ) && false === $I::uploaded_name( 'sql' ) );
$check( 'a folder in the name is cut off, also with backslashes', 1 === preg_match( '/^evil-u[0-9a-f]{8}\.sql$/', $I::uploaded_name( '../../evil.sql' ) ) && 1 === preg_match( '/^evil-u[0-9a-f]{8}\.sql$/', $I::uploaded_name( 'C:\\temp\\evil.sql' ) ) );
$check( 'a second extension that a server runs does not stay one (.php is followed by something that is no dot)', ( function () use ( $I ) { $n = $I::uploaded_name( 'shell.php.sql' ); return $I::is_valid_name( $n ) && ! preg_match( '/\.php(\.|$)/i', $n ); } )(), $I::uploaded_name( 'shell.php.sql' ) );
$check( 'a name without letters becomes "dump", a very long name is cut', 1 === preg_match( '/^dump-u[0-9a-f]{8}\.sql$/', $I::uploaded_name( '...sql' ) ) && strlen( $I::uploaded_name( str_repeat( 'a', 400 ) . '.sql' ) ) < 120 );
$check( 'every name that it makes is valid', $I::is_valid_name( $I::uploaded_name( '  ' . str_repeat( 'ä', 10 ) . ' .sql' ) ) );

// -- uploaded or put there
$check( 'a name with -u and eight characters is an uploaded name, others are not', $I::is_uploaded_name( 'a-u1a2b3c4d.sql' ) && $I::is_uploaded_name( 'a-u1a2b3c4d.sql.gz' ) && ! $I::is_uploaded_name( 'a.sql' ) && ! $I::is_uploaded_name( 'a-u1a2b3c4.sql' ) && ! $I::is_uploaded_name( 'a-uXXXXXXXX.sql' ) );

file_put_contents( $dir . '/' . $name, "SELECT 1;\n" );
file_put_contents( $dir . '/by-hand.sql', "SELECT 1;\n" );

$list = array_column( $I::files(), null, 'name' );
$check( 'the list says which file was uploaded', ! empty( $list[ $name ]['uploaded'] ) && empty( $list['by-hand.sql']['uploaded'] ) );

// -- the folder of the parts is no file of the list, and its files are no dumps
$up = $I::upload_dir();
$check( 'the folder of the parts is made inside the folder of the dumps', $dir . '/.upload' === $up && is_dir( $up ) );
file_put_contents( $up . '/' . str_repeat( 'a', 24 ) . '.part', 'x' );
$check( 'it is not in the list', ! in_array( '.upload', array_column( $I::files(), 'name' ), true ) );

// -- parts that were not finished
$old = $up . '/' . str_repeat( 'b', 24 ) . '.part';
$new = $up . '/' . str_repeat( 'c', 24 ) . '.part';
file_put_contents( $old, 'x' ); file_put_contents( $new, 'x' );
touch( $old, time() - 90000 );
file_put_contents( $up . '/other.txt', 'x' );
touch( $up . '/other.txt', time() - 90000 );

$removed = $I::remove_stale_uploads();
$check( 'a part that is older than a day is removed, a new one stays, a file that is no part stays', 1 === $removed && ! file_exists( $old ) && file_exists( $new ) && file_exists( $up . '/other.txt' ), (string) $removed );

// -- the list does the same, and says nothing of the parts
touch( $new, time() - 90000 );
$answer = json_decode( (string) $syncpilot_import->ajax_import_list(), true );
$check( 'the list of the page removes the old parts too', ! file_exists( $new ) && is_array( $answer['files'] ), json_encode( array_column( $answer['files'], 'name' ) ) );

// -- the removal with the link of the list
$_POST = array( 'file' => 'by-hand.sql' );
$answer = json_decode( (string) $syncpilot_import->ajax_import_delete(), true );
$check( 'a dump of the folder is removed', 1 === ( $answer['deleted'] ?? 0 ) && ! file_exists( $dir . '/by-hand.sql' ), json_encode( $answer ) );

file_put_contents( $dir . '/by-hand.sql', "SELECT 1;\n" );
$syncpilot_import::state_write( array( 'file' => 'by-hand.sql', 'started' => time() ) );
$answer = json_decode( (string) $syncpilot_import->ajax_import_delete(), true );
$check( 'the file of an import that is under way is not removed', ! empty( $answer['syncpilot_error'] ) && file_exists( $dir . '/by-hand.sql' ) );
$I::state_remove();

$_POST = array( 'file' => '../wp-config.php' );
$answer = json_decode( (string) $syncpilot_import->ajax_import_delete(), true );
$check( 'a name that is no dump of the folder is not removed', 0 === ( $answer['deleted'] ?? 1 ) );

// -- removal after the import
foreach ( array( 'with' => true, 'without' => false ) as $label => $delete ) {

	file_put_contents( $dir . '/' . $label . '.sql', "SELECT 1;\n" );
	$I::state_write( array( 'file' => $label . '.sql', 'delete_file' => $delete, 'started' => time() ) );
	$syncpilot_import->finalized( 'import' );

	$check( 'after the tables are replaced the file is ' . ( $delete ? 'removed (the choice was on)' : 'kept (the choice was off)' ), $delete ? ! file_exists( $dir . '/' . $label . '.sql' ) : file_exists( $dir . '/' . $label . '.sql' ) );
	$check( 'and the state is removed', false === $I::state_read() || empty( $I::state_read() ) );
}

file_put_contents( $dir . '/pull.sql', "SELECT 1;\n" );
$I::state_write( array( 'file' => 'pull.sql', 'delete_file' => true, 'started' => time() ) );
$syncpilot_import->finalized( 'pull' );
$check( 'the end of a pull does not touch the file or the state of an import', file_exists( $dir . '/pull.sql' ) && ! empty( $I::state_read() ) );

// a cancel, a stop and an error: the file stays
$_POST = array();
$syncpilot_import->ajax_import_cancel();
$check( 'a cancel keeps the file (and removes the state)', file_exists( $dir . '/pull.sql' ) && empty( $I::state_read() ) );

// -- clean up
foreach ( (array) glob( $dir . '/{,.}*', GLOB_BRACE ) as $f ) if ( is_file( $f ) ) @unlink( $f );
foreach ( (array) glob( $up . '/*' ) as $f ) @unlink( $f );
@rmdir( $up ); @rmdir( $dir ); @rmdir( $base );
$I::state_remove();
remove_all_filters( 'syncpilot_import_dir' );
$I::reset();
$check( 'no test folder is left', ! is_dir( $base ) );

printf( "\n%d ok, %d failed\n", $ok, $bad );
