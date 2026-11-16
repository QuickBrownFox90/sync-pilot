<?php
/**
 * Checks of the check before the media files are written (SyncPilot_Media_Files::check_media_write()): a folder that
 * cannot be written is reported once, with its owner and mode; so are the temporary folder and too little free space; a
 * folder that is fine is not reported. It uses a folder of its own as the uploads folder and removes it again.
 *
 * Run on a TEST installation only:   wp eval-file wp-content/plugins/sync-pilot/tests/media-preflight.php
 */

error_reporting( E_ALL ); global $syncpilot_media_files, $wpdb; $ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };
$L     = 'SyncPilot_Logger';
$M     = $syncpilot_media_files;
$set   = function ( $prop, $value ) use ( $L ) { $p = new ReflectionProperty( $L, $prop ); $p->setAccessible( true ); $p->setValue( null, $value ); };
$errors = function () use ( $L ) { return array_values( array_filter( $L::entries(), function ( $e ) { return 'error' === ( $e['level'] ?? '' ); } ) ); };

$settings_before = get_option( 'syncpilot_settings' );
$base = sys_get_temp_dir() . '/syncpilot-media-test-' . uniqid();
$logs = $base . '-logs';

mkdir( $base . '/2026/10', 0755, true ); mkdir( $base . '/2026/11', 0755, true ); touch( $base . '/2026/10/a.jpg' ); touch( $base . '/2026/11/b.jpg' );
chmod( $base . '/2026/11', 0555 );

add_filter( 'upload_dir', function ( $dirs ) use ( $base ) { $dirs['basedir'] = $base; return $dirs; } );
add_filter( 'syncpilot_log_dir', function () use ( $logs ) { return $logs; } );
add_filter( 'syncpilot_log_level', function () { return 'verbose'; } );
$set( 'dir', null ); $L::clear();

$media = $M->get_local_media();
$state = $M->media_write_state();

$check( 'the folder that cannot be written is found, the others are not', array( '2026/11' ) === array_keys( $state['folders'] ), json_encode( array_keys( $state['folders'] ) ) );
$check( 'the state has the uploads folder, the temporary folder and their free space', true === $state['uploads']['writable'] && true === $state['temp']['writable'] && $state['uploads_free'] > 0 && $state['temp_free'] > 0 );
$check( 'the facts of the folder: mode and owner', '0555' === $state['folders']['2026/11']['mode'] && ! empty( $state['folders']['2026/11']['owner'] ) && false === $state['folders']['2026/11']['writable'], json_encode( $state['folders']['2026/11'] ) );

// 1. a file into the good folder, one into a new folder below the good one: nothing to report
$M->check_media_write( $state, $media, array( '2026/10/new.jpg' => 100, '2027/01/new.jpg' => 100 ), 'this site' );
$check( 'files for a writable folder and for a new folder in the uploads folder: no error', array() === $errors() );
$entries = $L::entries(); $info = end( $entries );
$check( 'the check is in the log at verbose: files, size, free space, no problem', 'Media check before writing' === $info['message'] && 'info' === $info['level'] && 2 === $info['context']['files'] && 0 === $info['context']['problems'] && 'this site' === $info['context']['where'], json_encode( $info ) );

// 2. three files for the folder that cannot be written (one in a new folder below it): one entry
$L::clear();
$M->check_media_write( $state, $media, array( '2026/11/c.jpg' => 10, '2026/11/d.jpg' => 10, '2026/11/x/y/e.jpg' => 10 ), 'this site' );
$e = $errors();
$check( 'a folder that cannot be written is reported once for all its files', 1 === count( $e ) && 215 === $e[0]['help'] && 2 === $e[0]['site'], json_encode( array_column( $e, 'help' ) ) );
$check( 'the entry says the folder, the mode, the owner, the user of the web server and where', '2026/11' === $e[0]['context']['folder'] && '0555' === $e[0]['context']['mode'] && isset( $e[0]['context']['owner'], $e[0]['context']['web_user'] ) && 'this site' === $e[0]['context']['where'], json_encode( $e[0]['context'] ) );

// 3. the uploads folder itself
$L::clear();
$bad_state = $state; $bad_state['uploads']['writable'] = false; $bad_state['temp']['writable'] = false;
$M->check_media_write( $bad_state, $media, array( '2026/10/f.jpg' => 10 ), 'remote site' );
$e = $errors();
$check( 'uploads folder and temporary folder that cannot be written: one entry each (215 site 1, 216)', array( 215, 216 ) === array_column( $e, 'help' ) && 1 === $e[0]['site'] && 'remote site' === $e[0]['context']['where'], json_encode( array_column( $e, 'help' ) ) );

// 4. free space
$L::clear();
$low = $state; $low['uploads_free'] = 50; $low['temp_free'] = 20;
$M->check_media_write( $low, $media, array( '2026/10/g.jpg' => 100, '2026/10/h.jpg' => 60 ), 'this site' );
$e = $errors();
$check( 'too little room in the uploads folder (all files) and in the temporary folder (the largest file)', array( 217, 217 ) === array_column( $e, 'help' ) && array( 1, 2 ) === array_column( $e, 'site' ) && 160 === $e[0]['context']['needed_bytes'] && 100 === $e[1]['context']['needed_bytes'] && 'temp' === $e[1]['context']['folder'], json_encode( array_column( $e, 'context' ) ) );

// 5. nothing to write: nothing to check
$L::clear();
$M->check_media_write( $bad_state, $media, array(), 'this site' );
$check( 'no file to write: nothing is reported, nothing is logged', array() === $L::entries() );

// 6. a size that is unknown (the other site does not say): no report for it
$L::clear();
$unknown = $state; $unknown['uploads_free'] = null; $unknown['temp_free'] = null;
$M->check_media_write( $unknown, $media, array( '2026/10/i.jpg' => 1000000000000 ), 'remote site' );
$check( 'free space that is not known is not a problem', array() === $errors() );

// put it back
chmod( $base . '/2026/11', 0755 );
$rm = function ( $dir ) use ( &$rm ) { foreach ( glob( $dir . '/{,.}[!.]*', GLOB_BRACE ) ?: array() as $f ) is_dir( $f ) ? $rm( $f ) : unlink( $f ); @rmdir( $dir ); };
$L::clear(); $rm( $base ); $rm( $logs );
remove_all_filters( 'upload_dir' ); remove_all_filters( 'syncpilot_log_dir' ); remove_all_filters( 'syncpilot_log_level' ); $set( 'dir', null );
update_option( 'syncpilot_settings', $settings_before ); wp_cache_flush();
echo "\n$ok ok, $bad failed\n";
