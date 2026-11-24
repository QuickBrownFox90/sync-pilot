<?php
/**
 * The folder of the exports and backups (0.4.4): a folder with a name that cannot be guessed, closed for the web server, the
 * links that hand a file out (nonce, only names of exports and backups), the old folder that is still read, and the list of
 * the backups that reads both folders. The download itself is clicked through by tests/browser/push.mjs --backup.
 *
 * Run on a TEST installation only:   wp eval-file wp-content/plugins/sync-pilot/tests/export-folder.php
 */

error_reporting( E_ALL ); global $syncpilot, $wpdb; $ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };
$I     = 'SyncPilot_Import';

if ( ! defined( 'DOING_SYNCPILOT_TESTS' ) )
	define( 'DOING_SYNCPILOT_TESTS', true );

// the folder of the plugin in the uploads folder of the test site can belong to the web server: the test uses a folder of its own
$dir_name = 'syncpilot-export-test-' . uniqid();
add_filter( 'syncpilot_upload_dir_name', fn() => $dir_name );

$upload = wp_upload_dir( null, false );
$plugin = $upload['basedir'] . '/' . $dir_name;

// -- the folder
$path = $syncpilot->get_upload_info( 'path' );
$check( 'the folder of the exports is inside the folder of the plugin and has a part that is not guessable', 1 === preg_match( '#/syncpilot-export-test-[0-9a-f]+/exports-[0-9a-f]{16}$#', $path ), $path );
$check( 'it is the same every time', $path === $syncpilot->get_upload_info( 'path' ) && $path === substr( $path, 0, strrpos( $path, '-' ) + 1 ) . substr( wp_hash( 'syncpilot-exports' ), 0, 16 ) );
$check( 'it can be written', is_dir( $path ) && is_writable( $path ) );

foreach ( array( $path, $plugin ) as $folder ) {
	$htaccess = (string) @file_get_contents( $folder . '/.htaccess' );
	$name     = basename( $folder );

	$check( "$name: the rule denies .sql and .sql.gz, no listing", false !== strpos( $htaccess, 'Options -Indexes' ) && false !== strpos( $htaccess, '\.sql(\.gz)?$' ) && false !== strpos( $htaccess, 'Require all denied' ), $htaccess );
	$check( "$name: web.config and index.php are there", is_file( $folder . '/web.config' ) && is_file( $folder . '/index.php' ) );
}

// an old rule of 0.4.3 (the exports only) is replaced, the old web.config too
file_put_contents( $plugin . '/.htaccess', "# SyncPilot: exports are handed out by the plugin only\nOptions -Indexes\n<FilesMatch \"-migrate-\">\nRequire all denied\n</FilesMatch>\n" );
file_put_contents( $plugin . '/web.config', '<configuration><denyUrlSequences><add sequence="-migrate-" /></denyUrlSequences></configuration>' );
$syncpilot->get_upload_info( 'path' );
$check( 'a rule of 0.4.3 is replaced by the new one', false !== strpos( (string) file_get_contents( $plugin . '/.htaccess' ), '\.sql(\.gz)?$' ) && false === strpos( (string) file_get_contents( $plugin . '/web.config' ), '-migrate-' ) );

// -- the folder of the versions before is found
$check( 'the old folder is the folder of the plugin', $plugin === $syncpilot->legacy_upload_path() );

add_filter( 'syncpilot_upload_info', '__return_empty_array' );
$check( 'with an empty filter nothing changes', $plugin === $syncpilot->legacy_upload_path() );
remove_all_filters( 'syncpilot_upload_info' );

add_filter( 'syncpilot_upload_info', fn() => array( 'path' => '/tmp/x', 'url' => 'http://example.test/x' ) );
$check( 'a folder that a filter sets has no old folder', false === $syncpilot->legacy_upload_path() );
remove_all_filters( 'syncpilot_upload_info' );

// -- the links
$name = 'db-migrate-20261123120000-' . str_repeat( 'a', 32 );
$url  = $syncpilot->dump_download_url( $name . '.sql' );
parse_str( (string) parse_url( $url, PHP_URL_QUERY ), $q );
$check( 'the link has the name without the extension and a nonce', $name === $q['download'] && wp_verify_nonce( $q['_wpnonce'], 'syncpilot-download' ) && ! isset( $q['gzip'] ), $url );
$check( 'no &#038; in the link (it is used as it is)', false === strpos( $url, '#038' ) );

parse_str( (string) parse_url( $syncpilot->dump_download_url( $name . '.sql.gz' ), PHP_URL_QUERY ), $q );
$check( 'a gzip file adds gzip=1', $name === $q['download'] && '1' === $q['gzip'] );

$_POST = array();
$check( 'the address of a backup is such a link, the web server has no address for it', false !== strpos( $syncpilot->get_sql_dump_info( 'backup', 'url' ), 'download=' ) && false === strpos( $syncpilot->get_sql_dump_info( 'backup', 'url' ), '/' . $dir_name . '/' ) );
$check( 'and the path is in the folder of the exports', 0 === strpos( $syncpilot->get_sql_dump_info( 'backup', 'path' ), $path . DIRECTORY_SEPARATOR ) );

// -- the backups of both folders
$new = $path . '/new-backup-20261123120000-' . str_repeat( 'b', 32 ) . '.sql';
$old = $plugin . '/old-backup-20261101120000-' . str_repeat( 'c', 32 ) . '.sql';
file_put_contents( $new, "# syncpilot-header: {\"format\":1}\nSELECT 1;\n" );
file_put_contents( $old, "# WordPress MySQL database migration\nSELECT 1;\n" );

$names = array_column( $I::backups(), 'name' );
$check( 'the list has the backups of both folders', in_array( basename( $new ), $names, true ) && in_array( basename( $old ), $names, true ), implode( ', ', $names ) );
$check( 'resolve_backup() finds a backup in the new folder', $new === $I::resolve_backup( basename( $new ) ) );
$check( 'and in the old folder', $old === $I::resolve_backup( basename( $old ) ) );
$check( 'a name that is not a backup is refused', false === $I::resolve_backup( '../' . basename( $new ) ) && false === $I::resolve_backup( 'index.php' ) );

@unlink( $new );
@unlink( $old );

// -- the diagnostic info
ob_start(); $syncpilot_import = $GLOBALS['syncpilot_import']; $syncpilot_import->output_diagnostic_info(); $text = ob_get_clean();
$check( 'the diagnostic info names the folder of the exports and says whether it is protected', false !== strpos( $text, 'Export Folder: ' . $path ) && false !== strpos( $text, 'Export Folder Protected From The Web: ' ), trim( $text ) );

// -- a folder that cannot be made: the path stays the one of the folder, nothing goes into the uploads folder itself
$readonly = sys_get_temp_dir() . '/syncpilot-export-ro-' . uniqid();
mkdir( $readonly, 0555 );
remove_all_filters( 'syncpilot_upload_dir_name' );
add_filter( 'syncpilot_upload_dir_name', fn() => 'x/../../' . basename( $readonly ) . '/sub' );
$p = $syncpilot->get_upload_info( 'path' );
$check( 'when the folder cannot be made the path is still the one of the folder, not the uploads folder', $p !== $upload['basedir'] && false !== strpos( $p, '/exports-' ), $p );
remove_all_filters( 'syncpilot_upload_dir_name' );
@rmdir( $readonly );

// clean up
if ( 0 === strpos( basename( $plugin ), 'syncpilot-export-test-' ) )
	exec( 'rm -rf ' . escapeshellarg( $plugin ) );

printf( "\n%d ok, %d failed\n", $ok, $bad );
exit( $bad ? 1 : 0 );
