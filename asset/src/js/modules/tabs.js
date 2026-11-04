// The tabs (migrate, settings, diagnostics) and the address with the hash of the tab.

import { get_query_var } from './helpers.js';
import { refresh_debug_log } from './diagnostics.js';

const $ = jQuery;

export function init_tabs() {

    // migrate / settings / diagnostics tabs
    $( '.nav-tab' ).click( function () {

        $( '.nav-tab' ).removeClass( 'nav-tab-active' );
        $( this ).addClass( 'nav-tab-active' );
        $( '.content-tab' ).hide();
        $( '.' + $( this ).attr( 'data-div-name' ) ).show();

        var hash = $( this ).attr( 'data-div-name' );

        hash                 = hash.replace( '-tab', '' );
        window.location.hash = hash;

        if ( $( this ).hasClass( 'diagnostics' ) ) {
            refresh_debug_log();
        }
    } );

    // check for hash in url (settings || migrate) switch tabs accordingly
    if ( window.location.hash ) {
        var hash = window.location.hash.substring( 1 );

        switch_to_plugin_tab( hash, false );
    }

    if ( get_query_var( 'install-plugin' ) != '' ) {
        hash = 'addons';
        switch_to_plugin_tab( hash, true );
    }

    function switch_to_plugin_tab( hash, skip_addons_check ) {

        $( '.nav-tab' ).removeClass( 'nav-tab-active' );
        $( '.nav-tab.' + hash ).addClass( 'nav-tab-active' );
        $( '.content-tab' ).hide();
        $( '.' + hash + '-tab' ).show();

        if ( hash == 'diagnostics' ) {
            refresh_debug_log();
        }
    }
}
