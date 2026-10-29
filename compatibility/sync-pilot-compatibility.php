<?php
/*
 * Plugin Name: SyncPilot Compatibility
 * Description: Prevents 3rd party plugins from being loaded during SyncPilot specific operations
 * Author: Patrick Mauersberger
 * Version: 0.1.0
 * Author URI: http://dev.patrick-mauersberger.de
 */

$GLOBALS['syncpilot_compatibility'] = true;

/**
* Remove blog-active plugins
* @since   0.0.1
*
* @param   array  $plugins  Numerically keyed array of plugin names
* @return  array
*/
function syncpilotc_exclude_plugins( $plugins ) {

	if ( ! defined( 'DOING_AJAX' ) || ! DOING_AJAX || ! isset( $_POST['action'] ) || false === strpos( $_POST['action'], 'syncpilot' ) )
		return $plugins;

	$syncpilot_settings = get_option( 'syncpilot_settings' );

	if ( ! empty( $syncpilot_settings['blacklist_plugins'] ) )
		$blacklist_plugins = array_flip( $syncpilot_settings['blacklist_plugins'] );

	foreach( $plugins as $key => $plugin ) {

		if ( false !== strpos( $plugin, 'sync-pilot' ) || ! isset( $blacklist_plugins[ $plugin ] ) )
			continue;

		unset( $plugins[ $key ] );
	}

	return $plugins;
}

add_filter( 'option_active_plugins', 'syncpilotc_exclude_plugins' );


/**
* Remove network-active plugins
* @since   0.0.1
*
* @param   array  $plugins  Array of plugins keyed by name (name=>timestamp pairs)
* @return  array
*/
function syncpilotc_exclude_site_plugins( $plugins ) {

	if ( ! defined( 'DOING_AJAX' ) || !DOING_AJAX || ! isset( $_POST['action'] ) || false === strpos( $_POST['action'], 'syncpilot' ) )
		return $plugins;

	$syncpilot_settings = get_option( 'syncpilot_settings' );

	if ( ! empty( $syncpilot_settings['blacklist_plugins'] ) )
		$blacklist_plugins = array_flip( $syncpilot_settings['blacklist_plugins'] );

	foreach( array_keys( $plugins ) as $plugin ) {

		if ( false !== strpos( $plugin, 'sync-pilot' ) || ! isset( $blacklist_plugins[ $plugin ] ) )
			continue;

		unset( $plugins[ $plugin ] );
	}

	return $plugins;
}

add_filter( 'site_option_active_sitewide_plugins', 'syncpilotc_exclude_site_plugins' );