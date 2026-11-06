<?php
/*
 * Plugin Name: SyncPilot
 * Description: Export, push, and pull to migrate your WordPress databases and media files.
 * Author: Patrick Mauersberger
 * Author URI: http://dev.patrick-mauersberger.de
 * Version: 0.2.7
 * Requires PHP: 8.2
 * Requires at least: 6.0
 * License: GPL-2.0
 * Text Domain: sync-pilot
 * Domain Path: /languages/
 * Network: true
 *
 * SyncPilot is a fork of WP Sync DB 1.5 (https://github.com/wp-sync-db/wp-sync-db)
 * merged with WP Sync DB Media Files 1.1.4b1, both by Sean Lang and contributors
 * and licensed under the GPL v2. It continues the work of WP Migrate DB by
 * Delicious Brains.
 */

$GLOBALS['syncpilot_meta']['sync-pilot']['version'] = '0.2.7';
$GLOBALS['syncpilot_meta']['sync-pilot']['folder'] = basename( plugin_dir_path( __FILE__ ) );

// Define the directory seperator if it isn't already
if ( ! defined( 'DS' ) ) {

	if ( strtoupper( substr( PHP_OS, 0, 3 ) ) == 'WIN' )
		define( 'DS', '\\' );

	else
		define( 'DS', '/' );
}

function syncpilot_loaded() {

	// the update checks of WordPress also run in cron, so the updater is registered before the quick exit; it asks GitHub
	// only in the admin and in cron, never for a visitor
	require_once 'class/syncpilot-updater.php';

	( new SyncPilot_Updater( 'QuickBrownFox90/sync-pilot', __FILE__ ) )->init();

	// if neither WordPress admin nor running from wp-cli, exit quickly to prevent performance impact
	if ( ! is_admin() && ! ( defined( 'WP_CLI' ) && WP_CLI ) ) return;

	require_once 'class/syncpilot-base.php';
	require_once 'class/syncpilot.php';
	require_once 'class/syncpilot-media-files.php';

	// carry over settings and profiles of WP Sync DB before they are read
	SyncPilot_Base::migrate_legacy_settings();

	global $syncpilot, $syncpilot_media_files;

	$syncpilot = new SyncPilot( __FILE__ );
	$syncpilot_media_files = new SyncPilot_Media_Files( __FILE__ );
}

add_action( 'plugins_loaded', 'syncpilot_loaded' );


function syncpilot_init() {

    // if neither WordPress admin nor running from wp-cli, exit quickly to prevent performance impact
	if ( ! is_admin() && ! ( defined( 'WP_CLI' ) && WP_CLI ) )
        return;

	load_plugin_textdomain( SyncPilot_Base::TEXT_DOMAIN, false, dirname( plugin_basename( __FILE__ ) ) . '/languages/' );
}

add_action( 'init', 'syncpilot_init' );
