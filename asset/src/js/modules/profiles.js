// Deleting saved profiles, from the list on the migrate form and from the list of profiles.

import { ajax_problem_text } from './helpers.js';

const $ = jQuery;

export function init_profiles() {

    // delete saved profiles
    $( 'body' ).on( 'mouseenter mouseleave', '.save-migration-profile-wrap li', function ( event ) {

        if ( event.type === 'mouseenter' ) {
            $( '.delete-profile', this ).show();
        } else {
            $( '.delete-profile', this ).hide();
        }
    } );

    // delete a profile from the migrate form area
    $( 'body' ).on( 'click', '.delete-profile', function () {

        var $name = $( this ).next().clone();

        $( 'input', $name ).remove();

        var name  = $.trim( $( $name ).text() );
        var $link = $( this );

        syncpilot_confirm( syncpilot_i10n.remove_profile + ' "' + name + '"', function () {
            delete_profile( $link );
        } );
    } );

    // removes a profile from the list and from the settings
    function delete_profile( $link ) {

        $link.parent().fadeOut( 500 );

        $.ajax( {
            url      : ajaxurl,
            type     : 'POST',
            dataType : 'text',
            cache    : false,
            data     : {
                action     : 'syncpilot_delete_migration_profile',
                profile_id : $link.attr( 'data-profile-id' ),
                nonce      : syncpilot_nonces.delete_migration_profile,
            },
            error : function ( jqXHR, textStatus, errorThrown ) {
                syncpilot_alert( ajax_problem_text( syncpilot_i10n.remove_profile_problem, jqXHR ) );
            },
            success : function ( data ) {
                if ( data == '-1' ) {
                    syncpilot_alert( syncpilot_i10n.remove_profile_not_found );
                }
            }
        } );
    }

    // deletes a profile from the main profile selection screen
    $( '.main-list-delete-profile-link' ).click( function () {

        var name  = $( this ).prev().text();
        var $link = $( this );

        syncpilot_confirm( syncpilot_i10n.remove_profile + ' "' + name + '"', function () {
            delete_profile( $link );
        } );
    } );
}
