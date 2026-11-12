<?php
/**
 * Fault injection for the tests of SyncPilot. NOT part of the plugin: tests/guard.mjs copies this file into the
 * mu-plugins folder of a TEST site, uses it and removes it again.
 *
 * It does nothing unless a request for an action of SyncPilot carries ?sp_fault=<what>:
 *   exception   an exception that nobody catches
 *   fatal       a PHP fatal error (E_USER_ERROR)
 *   memory      the memory limit is reached
 *   timeout     the time limit is reached
 *   notice      a notice and a warning (the request goes on)
 */

if ( empty( $_REQUEST['sp_fault'] ) || empty( $_REQUEST['action'] ) || ! is_string( $_REQUEST['action'] ) || 0 !== strpos( $_REQUEST['action'], 'syncpilot_' ) )
	return;

$sp_fault = (string) $_REQUEST['sp_fault'];

// admin_init runs in admin-ajax.php before the handler of the action
add_action( 'admin_init', function () use ( $sp_fault ) {

	if ( 'exception' === $sp_fault )
		throw new RuntimeException( 'fault injection: exception' );

	if ( 'fatal' === $sp_fault )
		trigger_error( 'fault injection: fatal', E_USER_ERROR );

	if ( 'memory' === $sp_fault ) {
		ini_set( 'memory_limit', '32M' );
		$hold = array();
		while ( true )
			$hold[] = str_repeat( 'x', 1048576 );
	}

	if ( 'timeout' === $sp_fault ) {
		set_time_limit( 1 );
		while ( true )
			;
	}

	if ( 'notice' === $sp_fault ) {
		trigger_error( 'fault injection: notice', E_USER_NOTICE );
		trigger_error( 'fault injection: warning', E_USER_WARNING );
	}
}, 1 );
