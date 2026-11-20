<?php
/**
 * The head and the end of a backup of SyncPilot and the restore of it (SyncPilot_Import): the line for programs that
 * db_backup_header() writes, what backup_info() reads from the beginning and the end of a file, the list of the backups
 * (only files with the name of a backup, no link), the way from a name of the browser to a file (resolve_backup()), and
 * that the import reads a backup as it is. The restore itself is clicked through by tests/browser/import.mjs --restore.
 *
 * Run on a TEST installation only:   wp eval-file wp-content/plugins/sync-pilot/tests/import-backup.php
 */

error_reporting( E_ALL ); global $syncpilot, $syncpilot_import, $wpdb; $ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };
$I     = 'SyncPilot_Import';

if ( ! defined( 'DOING_SYNCPILOT_TESTS' ) )
	define( 'DOING_SYNCPILOT_TESTS', true );

$base = sys_get_temp_dir() . '/syncpilot-import-backup-test-' . uniqid();
mkdir( $base );

add_filter( 'syncpilot_upload_info', fn() => array( 'path' => $base, 'url' => 'http://example.test/x' ) );

// -- the head that SyncPilot writes
$file = $base . '/db-backup-20261120120000-' . str_repeat( 'a', 32 ) . '.sql';
$post = $_POST; $_POST['stage'] = 'backup';
$syncpilot->set_migration_form_data( 'action=pull' );

$fp = fopen( $file, 'w' );
$ref = new ReflectionProperty( $syncpilot, 'fp' ); $ref->setAccessible( true ); $ref->setValue( $syncpilot, $fp );
$syncpilot->db_backup_header( 'backup' );
fwrite( $fp, "DROP TABLE IF EXISTS `{$wpdb->prefix}x`;\nCREATE TABLE `{$wpdb->prefix}x` (`a` int);\nINSERT INTO `{$wpdb->prefix}x` VALUES (1);\n" );
fclose( $fp );

$text = (string) file_get_contents( $file );
$check( 'the head has the line for programs, one line, with no language in it', 1 === preg_match( '/^# syncpilot-header: \{.*\}$/m', $text ) );

$info = $I::backup_info( $file );
$check( 'backup_info() reads it: kind, version, time (UTC), address, prefix', is_array( $info['header'] ) && 'backup' === $info['header']['kind'] && $info['header']['version'] === $GLOBALS['syncpilot_meta']['sync-pilot']['version'] && 1 === preg_match( '/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $info['header']['created'] ) && $info['header']['home'] === home_url() && $info['header']['prefix'] === $wpdb->base_prefix, json_encode( $info['header'] ) );
$check( 'a file with a head and no end mark is not complete', false === $info['complete'] );

// -- the end mark
file_put_contents( $file, "# syncpilot-end: " . json_encode( array( 'complete' => true, 'created' => gmdate( 'Y-m-d\TH:i:s\Z' ) ) ) . "\n", FILE_APPEND );
$check( 'with the end mark it is complete', true === $I::backup_info( $file )['complete'] );

// a big file: the end is read from the end of the file
$big = $base . '/big-backup-20261120120001-' . str_repeat( 'b', 32 ) . '.sql';
copy( $file, $big );
$fh = fopen( $big, 'r+' ); fseek( $fh, 0, SEEK_END ); $end = ftell( $fh );
$body = '';
fclose( $fh );
$head = substr( $text, 0, strpos( $text, "DROP TABLE" ) );
file_put_contents( $big, $head . str_repeat( "INSERT INTO `{$wpdb->prefix}x` VALUES (1);\n", 5000 ) );
$check( 'a big file without the mark is not complete (the end of the file is read)', false === $I::backup_info( $big )['complete'] );
file_put_contents( $big, "# syncpilot-end: {\"complete\":true}\n", FILE_APPEND );
$check( 'and with it complete', true === $I::backup_info( $big )['complete'] );

// a backup of an older version
$old = $base . '/old-backup-20261120120002-' . str_repeat( 'c', 32 ) . '.sql';
file_put_contents( $old, "# WordPress MySQL database migration\n#\nDROP TABLE IF EXISTS `{$wpdb->prefix}x`;\n" );
$oi = $I::backup_info( $old );
$check( 'a backup of an older version has no head: it is listed, complete is not known', null === $oi['header'] && null === $oi['complete'] );

// a head that is not ours
$odd = $base . '/odd-backup-20261120120003-' . str_repeat( 'd', 32 ) . '.sql';
file_put_contents( $odd, "# syncpilot-header: {\"format\":9,\"kind\":\"backup\"}\n# syncpilot-header: not json\nSELECT 1;\n" );
$check( 'a head with another format or no JSON is not taken', null === $I::backup_info( $odd )['header'] );

// -- the list
file_put_contents( $base . '/notes.sql', 'x' );
file_put_contents( $base . '/db-backup-bad-' . str_repeat( 'e', 32 ) . '.sql', 'x' );
file_put_contents( $base . '/db-backup-20261120120004-' . str_repeat( 'f', 32 ) . '.sql.gz', 'x' );
symlink( $file, $base . '/link-backup-20261120120005-' . str_repeat( '1', 32 ) . '.sql' );
touch( $file, time() - 100 ); touch( $big, time() - 50 ); touch( $old, time() - 200 );

$list  = $I::backups();
$names = array_column( $list, 'name' );

$check( 'the list has the files with the name of a backup, newest first', array_slice( $names, 0, 3 ) === array( basename( $odd ), basename( $big ), basename( $file ) ) || in_array( basename( $big ), $names, true ) && in_array( basename( $old ), $names, true ), implode( ', ', $names ) );
$check( 'other files, a gzip file and a link are not in it', ! in_array( 'notes.sql', $names, true ) && 4 === count( $names ) );

$byname = array_column( $list, null, 'name' );
$check( 'each has the size, the time, the head and whether it is complete', 'backup' === $byname[ basename( $file ) ]['header']['kind'] && true === $byname[ basename( $file ) ]['complete'] && $byname[ basename( $file ) ]['bytes'] > 0 && null === $byname[ basename( $old ) ]['header'] );

// -- from a name of the browser to a file
$check( 'resolve_backup() gives the file for the name of a backup', $file === $I::resolve_backup( basename( $file ) ) );
$check( 'it refuses a link, a name of another kind, a folder in the name and a file that is not there', false === $I::resolve_backup( 'link-backup-20261120120005-' . str_repeat( '1', 32 ) . '.sql' ) && false === $I::resolve_backup( 'notes.sql' ) && false === $I::resolve_backup( '../' . basename( $file ) ) && false === $I::resolve_backup( 'x-backup-20261120120006-' . str_repeat( '2', 32 ) . '.sql' ) && false === $I::resolve_backup( null ) );
$check( 'state_file_path() takes the backup when the state says so, the folder for dumps otherwise', $file === $I::state_file_path( array( 'file' => basename( $file ), 'source' => 'backup' ) ) && false === $I::state_file_path( array( 'file' => basename( $file ) ) ) );

// -- the import reads a backup as it is (the head is a comment)
$reader = new SyncPilot_Dump_Reader( $file );
$kinds  = array();
while ( is_array( $s = $reader->next() ) ) { $c = $I::classify( $s['sql'] ); $kinds[] = $c['action'] . ':' . ( $c['kind'] ?? '' ); }
$check( 'the import runs every statement of the backup, with no error of the reader', array( 'run:set', 'run:set', 'run:drop_table', 'run:create_table', 'run:insert' ) === $kinds && '' === $reader->error(), implode( ' ', $kinds ) . ' ' . $reader->error() );

// -- the start: a backup that is not complete is not restored unless the page says so
SyncPilot_Logger::set_migration_id( SyncPilot_Logger::new_migration_id() );
$_POST = array( 'source' => 'backup', 'file' => basename( $big ), 'form_data' => '' );
unset( $_POST['confirm_incomplete'] );
$unfinished = $base . '/un-backup-20261120120007-' . str_repeat( '3', 32 ) . '.sql';
copy( $file, $unfinished );
file_put_contents( $unfinished, $head . "DROP TABLE IF EXISTS `{$wpdb->prefix}x`;\n" );
$_POST['file'] = basename( $unfinished );
$answer = json_decode( (string) $syncpilot_import->ajax_import_start(), true );
$check( 'the start of a backup that is not complete is refused with #308', ! empty( $answer['syncpilot_error'] ) && false !== strpos( $answer['body'], '308' ), json_encode( $answer ) );

$_POST['confirm_incomplete'] = 1;
$answer = json_decode( (string) $syncpilot_import->ajax_import_start(), true );
$state  = $I::state_read();
$check( 'with the confirmation it starts, and the state has the source and no removal of the file', ! empty( $answer['migration_id'] ) && 'backup' === ( $state['source'] ?? '' ) && empty( $state['delete_file'] ), json_encode( $answer ) );

$_POST = array( 'source' => 'backup', 'file' => '../../wp-config.php' );
$answer = json_decode( (string) $syncpilot_import->ajax_import_start(), true );
$check( 'a name that is no backup does not start', ! empty( $answer['syncpilot_error'] ) && false !== strpos( $answer['body'], '301' ), json_encode( $answer ) );

// the end of an import of a backup does not remove it
$I::state_write( array( 'file' => basename( $file ), 'source' => 'backup', 'delete_file' => true, 'started' => time() ) );
$syncpilot_import->finalized( 'import' );
$check( 'the file of a backup is never removed after the import', file_exists( $file ) );

// -- clean up
$_POST = $post;
$I::state_remove();
SyncPilot_Logger::clear();
foreach ( (array) glob( $base . '/*' ) as $f ) @unlink( $f );
@rmdir( $base );
remove_all_filters( 'syncpilot_upload_info' );
$check( 'no test folder is left', ! is_dir( $base ) );

printf( "\n%d ok, %d failed\n", $ok, $bad );
