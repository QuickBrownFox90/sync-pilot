<?php
/**
 * A visitor of the site must never cause a request to GitHub. This is no WP-CLI script: it loads WordPress like a
 * request for the front page (no admin, no cron).
 *
 * Run on a TEST installation only:   php tests/updater-visitor.php /path/to/wordpress
 */

if ( empty( $argv[1] ) || ! is_file( rtrim( $argv[1], '/' ) . '/wp-load.php' ) )
	exit( "Usage: php tests/updater-visitor.php /path/to/wordpress\n" );

$_SERVER['HTTP_HOST']      = 'localhost';
$_SERVER['REQUEST_URI']    = '/';
$_SERVER['REQUEST_METHOD'] = 'GET';

define( 'SHORTINIT', false );
require rtrim( $argv[1], '/' ) . '/wp-load.php';

$calls = 0;

add_filter( 'pre_http_request', function ( $pre, $args, $url ) use ( &$calls ) {

	if ( false !== strpos( $url, 'api.github.com' ) )
		$calls++;

	return new WP_Error( 'blocked', 'no network in this test' );
}, 10, 3 );

require_once dirname( __DIR__ ) . '/class/syncpilot-base.php';
require_once dirname( __DIR__ ) . '/class/syncpilot-updater.php';

$updater = new SyncPilot_Updater( 'QuickBrownFox90/sync-pilot', dirname( __DIR__ ) . '/sync-pilot.php' );
$key     = 'syncpilot_updater_' . md5( 'QuickBrownFox90/sync-pilot' );

delete_site_transient( $key );

$release = $updater->get_release_info();

printf( "%-4s visitor context (is_admin=%s, cron=%s, cli=%s): no request to GitHub (%d), nothing cached (%s)\n",
	( 0 === $calls && false === get_site_transient( $key ) && ! is_admin() && ! wp_doing_cron() ) ? 'ok' : 'FAIL',
	var_export( is_admin(), true ), var_export( wp_doing_cron(), true ), var_export( defined( 'WP_CLI' ), true ), $calls, var_export( get_site_transient( $key ), true )
);

$updater->check_update( (object) array( 'checked' => array( 'sync-pilot/sync-pilot.php' => '0.1.0' ) ) );

printf( "%-4s reading the update data in that context asks nobody either (%d request(s))\n", 0 === $calls ? 'ok' : 'FAIL', $calls );
