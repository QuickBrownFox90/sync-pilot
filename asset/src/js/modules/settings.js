// The checkboxes on the settings tab: each one is saved when it is clicked.

import { spinner_url } from './spinner.js';
import { ajax_problem_text } from './helpers.js';

const $ = jQuery;

export function init_settings() {

    // ajax request for settings page when checking/unchecking setting radio
    // buttons
    $( '.settings-tab input[type=checkbox]' ).change( function () {

        if ( 'plugin-compatibility' == $( this ).attr( 'id' ) ) return;

        var checked = $( this ).is( ':checked' );
        var setting = $( this ).attr( 'id' );

        $( this ).parent().append( '<img src="' + spinner_url +
            '" alt="" class="ajax-spinner general-spinner" />' );

        var $label = $( this ).parent();

        $.ajax( {
            url      : ajaxurl,
            type     : 'POST',
            dataType : 'text',
            cache    : false,
            data     : {
                action  : 'syncpilot_save_setting',
                checked : checked,
                setting : setting,
                nonce   : syncpilot_nonces.save_setting,
            },
            error : function ( jqXHR, textStatus, errorThrown ) {

                syncpilot_alert( ajax_problem_text( syncpilot_i10n.save_settings_problem, jqXHR ) );
                $( '.ajax-spinner' ).remove();
            },
            success : function ( data ) {

                $( '.ajax-spinner' ).remove();

                $( $label ).append( '<span class="ajax-success-msg">' +
                    syncpilot_i10n.saved + '</span>' );

                $( '.ajax-success-msg' ).fadeOut( 2000, function () {
                    $( this ).remove();
                } );
            }
        } );
    } );
}
