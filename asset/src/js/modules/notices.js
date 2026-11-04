// The notices that the check of the connection to the other site can show: a different scheme (http / https), a
// different plugin version and a different table prefix.

import { state } from './state.js';

const $ = jQuery;

export function maybe_show_ssl_warning( url, key, remote_scheme ) {

    var scheme = url.substr( 0, url.indexOf( ':' ) );

    if ( remote_scheme != scheme && url.indexOf( 'https' ) != -1 ) {
        $( '.ssl-notice' ).show();
        state.show_ssl_notice = true;
        url                   = url.replace( 'https', 'http' );
        $( '.pull-push-connection-info' ).val( url + '\n' + key );

        return;
    }

    state.show_ssl_notice = false;

    return;
}

export function maybe_show_version_warning( plugin_version, url ) {

    if ( typeof plugin_version != 'undefined' && plugin_version !=
        syncpilot_plugin_version ) {
        $( '.different-plugin-version-notice' ).show();
        $( '.remote-version' ).text( plugin_version );
        $( '.remote-location' ).text( url );
        $( '.step-two' ).hide();
        state.show_version_notice = true;
    }
}

export function maybe_show_prefix_notice( prefix ) {

    if ( prefix != syncpilot_this_prefix ) {
        $( '.remote-prefix' ).text( prefix );
        state.show_prefix_notice = true;

        if ( $( '#pull' ).is( ':checked' ) ) {
            $( '.prefix-notice.pull' ).show();
        } else {
            $( '.prefix-notice.push' ).show();
        }
    }
}
