<?php
/**
 * Checks of the folder for dumps (SyncPilot_Import): where it is, how it is protected, which names and files are accepted,
 * which way leads from a name of the browser to a file (no folder, no link), the list and the answer of the page. It uses a
 * folder of its own and removes it again.
 *
 * Run on a TEST installation only:   wp eval-file wp-content/plugins/sync-pilot/tests/import.php
 */

error_reporting( E_ALL ); global $syncpilot, $syncpilot_import; $ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };
$I     = 'SyncPilot_Import';

if ( ! defined( 'DOING_SYNCPILOT_TESTS' ) )
	define( 'DOING_SYNCPILOT_TESTS', true );

$base   = sys_get_temp_dir() . '/syncpilot-import-test-' . uniqid();
$folder = $base . '/imports/';       // a slash at the end is taken off
$path   = $base . '/imports';

add_filter( 'syncpilot_import_dir', function () use ( $folder ) { return $folder; } );

// -- where it is
$check( 'the filter moves the folder, no slash at the end', $path === $I::path(), $I::path() );

remove_all_filters( 'syncpilot_import_dir' );
$upload = wp_upload_dir( null, false );
$check( 'by default it is a folder of uploads/sync-pilot with a name that cannot be guessed (16 characters of the salts)', 1 === preg_match( '#^' . preg_quote( $upload['basedir'], '#' ) . '/sync-pilot/imports-[0-9a-f]{16}$#', $I::path() ), $I::path() );
$check( 'the name is the same on every call and not the plain name', $I::path() === $I::path() && 'imports' !== basename( $I::path() ) );
add_filter( 'syncpilot_import_dir', function () use ( $folder ) { return $folder; } );

// -- the folder is made and protected
$I::reset();
$check( 'the folder does not exist before it is used', ! is_dir( $path ) );
$check( 'dir() makes it and gives the path', $path === $I::dir() && is_dir( $path ), (string) $I::dir() );
$htaccess = (string) @file_get_contents( $path . '/.htaccess' );
$check( 'it has a rule that denies every request, for both Apache versions', false !== strpos( $htaccess, 'Require all denied' ) && false !== strpos( $htaccess, 'Deny from all' ) && false !== strpos( $htaccess, 'Options -Indexes' ) );
$check( 'it has index.php and web.config', is_file( $path . '/index.php' ) && is_file( $path . '/web.config' ) );

// -- names
$valid   = array( 'dump.sql', 'dump.sql.gz', 'My Dump (2026-11-17).sql', 'a_b-c.1.SQL', 'x.sql.GZ' );
$invalid = array( '', '.hidden.sql', '../dump.sql', 'sub/dump.sql', 'sub\\dump.sql', 'dump.sql.php', 'dump.txt', 'dump.sql.gz.exe', 'dump.php.sql', 'dump.phtml.sql.gz', 'dump..sql', "dump\0.sql", ' dump.sql', 'dump.sql/', str_repeat( 'a', 150 ) . '.sql' );
$wrong   = array();
foreach ( $valid as $name )   if ( ! $I::is_valid_name( $name ) )  $wrong[] = 'valid: ' . $name;
foreach ( $invalid as $name ) if ( $I::is_valid_name( $name ) )    $wrong[] = 'invalid: ' . addcslashes( $name, "\0" );
foreach ( array( null, 5, array( 'dump.sql' ), false ) as $name ) if ( $I::is_valid_name( $name ) ) $wrong[] = 'type: ' . gettype( $name );
$check( 'the names that are dumps and the names that are not', array() === $wrong, implode( '; ', $wrong ) );
$check( 'a gzip name is told from a plain one', $I::is_gzip_name( 'a.sql.gz' ) && $I::is_gzip_name( 'a.SQL.GZ' ) && ! $I::is_gzip_name( 'a.sql' ) );

// -- the list
$now = time();
file_put_contents( $path . '/old.sql', "SELECT 1;\n" );                touch( $path . '/old.sql', $now - 300 );
file_put_contents( $path . '/new.sql.gz', gzencode( "SELECT 1;\n" ) ); touch( $path . '/new.sql.gz', $now - 10 );
file_put_contents( $path . '/notes.txt', 'text' );
file_put_contents( $path . '/.hidden.sql', 'x' );
file_put_contents( $path . '/two words.sql', 'x' );                       touch( $path . '/two words.sql', $now - 100 );
file_put_contents( $path . '/empty.sql', '' );
file_put_contents( $path . '/shell.php.sql', 'x' );
mkdir( $path . '/folder' ); file_put_contents( $path . '/folder/inner.sql', 'x' );
$secret = $base . '/secret.sql'; file_put_contents( $secret, 'secret' );
$linked = symlink( $secret, $path . '/link.sql' );

$files = $I::files();
$by    = array(); foreach ( $files as $f ) $by[ $f['name'] ] = $f;

$check( 'the files of SyncPilot and the folders are not listed', ! isset( $by['.htaccess'], $by['index.php'], $by['web.config'], $by['folder'], $by['inner.sql'] ) && count( array_intersect( array( '.htaccess', 'index.php', 'web.config', 'folder', 'inner.sql' ), array_keys( $by ) ) ) === 0, implode( ',', array_keys( $by ) ) );
$check( 'a dump can be used, with size, time and kind', isset( $by['old.sql'] ) && $by['old.sql']['usable'] && '' === $by['old.sql']['reason'] && 10 === $by['old.sql']['bytes'] && $now - 300 === $by['old.sql']['modified'] && false === $by['old.sql']['gzip'] );
$check( 'a gzip dump is told as gzip', isset( $by['new.sql.gz'] ) && $by['new.sql.gz']['usable'] && true === $by['new.sql.gz']['gzip'] );
$check( 'a name with a space is a dump', isset( $by['two words.sql'] ) && $by['two words.sql']['usable'] );
$check( 'another type is listed with the reason extension', isset( $by['notes.txt'] ) && ! $by['notes.txt']['usable'] && 'extension' === $by['notes.txt']['reason'] );
$check( 'a name that starts with a dot is listed with the reason name', isset( $by['.hidden.sql'] ) && 'name' === $by['.hidden.sql']['reason'] );
$check( 'a name with two extensions is listed with the reason name', isset( $by['shell.php.sql'] ) && 'name' === $by['shell.php.sql']['reason'] );
$check( 'an empty file is listed with the reason empty', isset( $by['empty.sql'] ) && 'empty' === $by['empty.sql']['reason'] );
$check( 'a link is listed with the reason symlink', $linked && isset( $by['link.sql'] ) && 'symlink' === $by['link.sql']['reason'] && ! $by['link.sql']['usable'] );

$usable = array_values( array_map( fn( $f ) => $f['name'], array_filter( $files, fn( $f ) => $f['usable'] ) ) );
$check( 'the newest dump is the first', array( 'new.sql.gz', 'two words.sql', 'old.sql' ) === $usable, implode( ',', $usable ) );

// -- from a name to a file
$check( 'a dump of the folder is found', $path . '/old.sql' === $I::resolve( 'old.sql' ), (string) $I::resolve( 'old.sql' ) );
$wrong = array();
foreach ( array( '../secret.sql', 'sub/old.sql', 'folder/inner.sql', '.hidden.sql', 'missing.sql', 'link.sql', 'notes.txt', '', null, 7, "old.sql\0" ) as $name )
	if ( false !== $I::resolve( $name ) ) $wrong[] = is_string( $name ) ? addcslashes( $name, "\0" ) : gettype( $name );
$check( 'no way out of the folder: a path, a hidden name, a missing file, a link, another type, no string', array() === $wrong, implode( '; ', $wrong ) );

// a folder that is a link to another folder is the folder: its files are found, but a file in it that leads out is not
$check( 'the secret file is untouched by all of that', 'secret' === file_get_contents( $secret ) );

// -- remove
$check( 'a name that is no dump is not removed', false === $I::delete( '../secret.sql' ) && is_file( $secret ) );
$check( 'a link is not followed: neither the link nor its target is removed', false === $I::delete( 'link.sql' ) && is_link( $path . '/link.sql' ) && is_file( $secret ) );
$check( 'a dump is removed', true === $I::delete( 'old.sql' ) && ! file_exists( $path . '/old.sql' ) );
$check( 'a dump that is not there is not removed', false === $I::delete( 'old.sql' ) );

// -- the answer of the page
$answer = json_decode( (string) $syncpilot_import->ajax_import_list(), true );
$check( 'the page gets the list, the folder and whether it can be written', is_array( $answer ) && true === $answer['writable'] && $path === $answer['folder'] && 2 === count( array_filter( $answer['files'], fn( $f ) => $f['usable'] ) ), json_encode( $answer ) );
$check( 'the nonce of the page is there', ! empty( apply_filters( 'syncpilot_nonces', array() )['import_list'] ) );

// -- whether the web server hands out its files: the folder is in the uploads folder here, the answer of the web server is made up
remove_all_filters( 'syncpilot_import_dir' );
$inside = $upload['basedir'] . '/imports-test-' . uniqid();
add_filter( 'syncpilot_import_dir', function () use ( $inside ) { return $inside; } );
$I::reset();
$asked  = array();
$answer_with = function ( $mode ) use ( &$asked, $upload ) {
	remove_all_filters( 'pre_http_request' );
	add_filter( 'pre_http_request', function ( $pre, $args, $url ) use ( $mode, &$asked, $upload ) {
		$asked[] = $url;
		if ( 'error' === $mode ) return new WP_Error( 'http_request_failed', 'no answer' );
		$file = str_replace( $upload['baseurl'], $upload['basedir'], $url );
		return array( 'headers' => array(), 'body' => 'open' === $mode ? (string) @file_get_contents( $file ) : 'denied', 'response' => array( 'code' => 'open' === $mode ? 200 : 403, 'message' => '' ), 'cookies' => array(), 'filename' => null );
	}, 10, 3 );
};
$answer_with( 'open' );
$check( 'a web server that hands out the probe file: reachable', true === $I::is_reachable() );
$check( 'the probe asked for a file in the folder, by its address in the uploads folder', 1 === count( $asked ) && 0 === strpos( $asked[0], $upload['baseurl'] . '/imports-test-' ) && preg_match( '#/probe-[0-9a-f]{12}\.txt$#', $asked[0] ), (string) ( $asked[0] ?? '' ) );
$check( 'the probe file is removed again', array() === glob( $inside . '/probe-*' ) );
$answer_with( 'denied' );
$check( 'a web server that denies it: not reachable', false === $I::is_reachable() && array() === glob( $inside . '/probe-*' ) );
$answer_with( 'error' );
$check( 'no answer: not known', null === $I::is_reachable() && array() === glob( $inside . '/probe-*' ) );
$answer_with( 'open' );
ob_start(); $syncpilot_import->output_diagnostic_info(); $text = ob_get_clean();
$check( 'the diagnostic info names the folder and says that it is not protected when the web server hands it out', false !== strpos( $text, 'Import Folder: ' . $inside ) && false !== strpos( $text, 'Import Folder Protected From The Web: NO' ), trim( $text ) );
$answer_with( 'denied' );
ob_start(); $syncpilot_import->output_diagnostic_info(); $text = ob_get_clean();
$check( 'and says YES when the web server denies it', false !== strpos( $text, 'Import Folder Protected From The Web: YES' ) );
ob_start(); $syncpilot->output_diagnostic_info(); $text = ob_get_clean();
$check( 'the diagnostic info of the site has the lines of the import', false !== strpos( $text, 'Import Folder Protected From The Web: YES' ) && false !== strpos( $text, 'Active Plugins:' ) );
remove_all_filters( 'pre_http_request' );
remove_all_filters( 'syncpilot_import_dir' );
$I::reset();
$remove_early = function ( $p ) use ( &$remove_early ) { if ( is_file( $p ) ) { @unlink( $p ); return; } if ( is_dir( $p ) ) { foreach ( scandir( $p ) as $n ) if ( '.' !== $n && '..' !== $n ) $remove_early( $p . '/' . $n ); @rmdir( $p ); } };
$remove_early( $inside );
add_filter( 'syncpilot_import_dir', function () use ( $folder ) { return $folder; } );
$check( 'a folder outside of the uploads folder has no address: not known', null === $I::is_reachable() );

// -- a folder that cannot be made or written
$I::reset();
chmod( $path, 0555 );
$readonly = is_writable( $path );
$check( 'a folder that cannot be written: dir() is false, the list still works', $readonly || ( false === $I::dir() && count( $I::files() ) > 0 ), $readonly ? 'skipped: running as root' : '' );
$answer = json_decode( (string) $syncpilot_import->ajax_import_list(), true );
$check( 'and the page is told that it cannot be written', $readonly || false === $answer['writable'] );
chmod( $path, 0755 );

$I::reset();
add_filter( 'syncpilot_import_dir', function () use ( $secret ) { return $secret . '/imports'; }, 20 );
$check( 'a folder below a file cannot be made: dir() is false', false === $I::dir() );

// -- clean up
remove_all_filters( 'syncpilot_import_dir' );
$I::reset();
$remove = function ( $p ) use ( &$remove ) {
	if ( is_link( $p ) || is_file( $p ) ) { @unlink( $p ); return; }
	if ( is_dir( $p ) ) { @chmod( $p, 0755 ); foreach ( scandir( $p ) as $n ) if ( '.' !== $n && '..' !== $n ) $remove( $p . '/' . $n ); @rmdir( $p ); }
};
$remove( $base );
$check( 'the test folder is gone', ! file_exists( $base ) );

printf( "\n%d ok, %d failed\n", $ok, $bad );
exit( $bad ? 1 : 0 );
