<?php
/*
 * Plugin Name: SyncPilot
 * Description: Export, push, and pull to migrate your WordPress databases and media files.
 * Author: Patrick Mauersberger
 * Author URI: http://dev.patrick-mauersberger.de
 * Version: 0.4.4
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

/*
 * The guard for an older PHP. Everything above the `return` must be readable by PHP 5: no `fn`, no types, no `match`, no
 * `?->`. The classes of the plugin need PHP 8.2 (enums, readonly, ...); on an older PHP they would end the page with a
 * parse error, so nothing of them is loaded and the admin gets a notice. One WordPress can run under several PHP versions
 * when its domains are separate vhosts of one folder (Plesk), then only some domains show it.
 * tests/php-guard.php and tests/release-check.mjs watch this part.
 */
define( 'SYNCPILOT_MIN_PHP', '8.2' );

/**
 * Whether a PHP version is too old for the plugin
 * @since   0.4.4
 *
 * @param   string $version  The version to look at (the one that runs by default)
 *
 * @return  bool
 */
function syncpilot_php_too_old( $version = PHP_VERSION ) {
	return version_compare( $version, SYNCPILOT_MIN_PHP, '<' );
}

/**
 * The notice of the admin when the plugin is not loaded because PHP is too old: the version that runs this request and the
 * one that is needed
 * @since   0.4.4
 */
function syncpilot_php_notice() {

	if ( ! current_user_can( 'activate_plugins' ) )
		return;

	echo '<div class="notice notice-error"><p><strong>SyncPilot</strong> is not loaded: it needs PHP ' . esc_html( SYNCPILOT_MIN_PHP ) . ' or later, and this request runs PHP ' . esc_html( PHP_VERSION ) . '. ';
	echo 'If the site has several domains, look at the PHP version of this one: every domain that is a vhost of its own has its own setting (Plesk: Hosting &amp; DNS &rarr; PHP Settings of that domain).</p></div>';
}

if ( syncpilot_php_too_old() ) {

	add_action( 'admin_notices', 'syncpilot_php_notice' );
	add_action( 'network_admin_notices', 'syncpilot_php_notice' );

	return;
}

$GLOBALS['syncpilot_meta']['sync-pilot']['version'] = '0.4.4';
$GLOBALS['syncpilot_meta']['sync-pilot']['folder'] = basename( plugin_dir_path( __FILE__ ) );

// Define the directory seperator if it isn't already
if ( ! defined( 'DS' ) ) {

	if ( strtoupper( substr( PHP_OS, 0, 3 ) ) == 'WIN' )
		define( 'DS', '\\' );

	else
		define( 'DS', '/' );
}

/**
 * Load the plugin: the updater always, the rest only in the admin and in WP-CLI
 * @since   0.0.1
 * @since   0.4.0  Loads the import (SyncPilot_Import) and keeps it in $syncpilot_import
 */
function syncpilot_loaded() {

	// the update checks of WordPress also run in cron, so the updater is registered before the quick exit; it asks GitHub
	// only in the admin and in cron, never for a visitor
	require_once 'class/syncpilot-updater.php';

	( new SyncPilot_Updater( 'QuickBrownFox90/sync-pilot', __FILE__ ) )->init();

	// if neither WordPress admin nor running from wp-cli, exit quickly to prevent performance impact
	if ( ! is_admin() && ! ( defined( 'WP_CLI' ) && WP_CLI ) ) return;

	require_once 'class/syncpilot-logger.php';
	require_once 'class/syncpilot-help-code.php';
	require_once 'class/syncpilot-request-guard.php';
	require_once 'class/syncpilot-base.php';
	require_once 'class/syncpilot.php';
	require_once 'class/syncpilot-media-files.php';
	require_once 'class/syncpilot-dump-reader.php';
	require_once 'class/syncpilot-import.php';

	// carry over settings and profiles of WP Sync DB before they are read
	SyncPilot_Base::migrate_legacy_settings();

	global $syncpilot, $syncpilot_media_files, $syncpilot_import;

	$syncpilot             = new SyncPilot( __FILE__ );
	$syncpilot_media_files = new SyncPilot_Media_Files( __FILE__ );
	$syncpilot_import      = new SyncPilot_Import( __FILE__ );
}

add_action( 'plugins_loaded', 'syncpilot_loaded' );


function syncpilot_init() {

    // if neither WordPress admin nor running from wp-cli, exit quickly to prevent performance impact
	if ( ! is_admin() && ! ( defined( 'WP_CLI' ) && WP_CLI ) )
        return;

	load_plugin_textdomain( SyncPilot_Base::TEXT_DOMAIN, false, dirname( plugin_basename( __FILE__ ) ) . '/languages/' );
}

add_action( 'init', 'syncpilot_init' );
