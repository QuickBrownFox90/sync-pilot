// The plugin compatibility mode (the MU plugin that switches plugins off for the requests of SyncPilot) and the list
// of plugins that are switched off.

import { state } from './state.js';
import { spinner_url } from './spinner.js';
import { ajax_problem_text } from './helpers.js';

const $ = jQuery;

export function init_plugin_compatibility() {

    $( '#plugin-compatibility' ).change( function ( e ) {

        var $box = $( this );

        if ( $box.is( ':checked' ) ) {
            syncpilot_confirm( syncpilot_i10n.plugin_compatibility_confirm, function () {
                save_plugin_compatibility( '1' );
            }, function () {
                $box.prop( 'checked', false );
            } );

            return;
        }

        save_plugin_compatibility( '0' );
    } );

    function save_plugin_compatibility( install ) {

        $( '.plugin-compatibility-wrap' ).toggle();

        $( '#plugin-compatibility' ).parent().append( '<img src="' + spinner_url +
            '" alt="" class="ajax-spinner general-spinner" />' );

        $( '#plugin-compatibility' ).attr( 'disabled', 'disabled' );
        $( '.plugin-compatibility' ).addClass( 'disabled' );

        $.ajax( {
            url      : ajaxurl,
            type     : 'POST',
            dataType : 'text',
            cache    : false,
            data     : {
                action  : 'syncpilot_plugin_compatibility',
                install : install,
                nonce   : syncpilot_nonces.plugin_compatibility,
            },
            error : function ( jqXHR, textStatus, errorThrown ) {

                syncpilot_alert( ajax_problem_text( syncpilot_i10n.plugin_compatibility_problem, jqXHR ) );
                $( '.ajax-spinner' ).remove();
                $( '#plugin-compatibility' ).removeAttr( 'disabled' );
                $( '.plugin-compatibility' ).removeClass( 'disabled' );
            },
            success : function ( data ) {

                if ( '' != $.trim( data ) ) {
                    syncpilot_alert( $.trim( data ) );
                } else {
                    $( '.plugin-compatibility' ).append(
                        '<span class="ajax-success-msg">' + syncpilot_i10n.saved + '</span>' );

                    $( '.ajax-success-msg' ).fadeOut( 2000, function () {
                        $( this ).remove();
                    } );
                }

                $( '.ajax-spinner' ).remove();
                $( '#plugin-compatibility' ).removeAttr( 'disabled' );
                $( '.plugin-compatibility' ).removeClass( 'disabled' );
            }
        } );
    }

    if ( $( '#plugin-compatibility' ).is( ':checked' ) ) {
        $( '.plugin-compatibility-wrap' ).show();
    }

    $( '.plugin-compatibility-save' ).click( function () {

        if ( state.doing_plugin_compatibility_ajax ) {
            return;
        }

        $( this ).addClass( 'disabled' );

        var select_element = $( '#selected-plugins' );

        $( select_element ).attr( 'disabled', 'disabled' );

        state.doing_plugin_compatibility_ajax = true;

        $( this ).after( '<img src="' + spinner_url +
            '" alt="" class="plugin-compatibility-spinner general-spinner" />'
        );

        $.ajax( {
            url      : ajaxurl,
            type     : 'POST',
            dataType : 'text',
            cache    : false,
            data     : {
                action            : 'syncpilot_blacklist_plugins',
                blacklist_plugins : $( select_element ).val(),
                nonce             : syncpilot_nonces.blacklist_plugins,
            },
            error : function ( jqXHR, textStatus, errorThrown ) {

                syncpilot_alert( ajax_problem_text( syncpilot_i10n.blacklist_problem, jqXHR ) );
                $( select_element ).removeAttr( 'disabled' );
                $( '.plugin-compatibility-save' ).removeClass( 'disabled' );
                state.doing_plugin_compatibility_ajax = false;
                $( '.plugin-compatibility-spinner' ).remove();
                $( '.plugin-compatibility-success-msg' ).show().fadeOut( 2000 );
            },
            success : function ( data ) {

                if ( '' != $.trim( data ) ) {
                    syncpilot_alert( $.trim( data ) );
                }

                $( select_element ).removeAttr( 'disabled' );
                $( '.plugin-compatibility-save' ).removeClass( 'disabled' );
                state.doing_plugin_compatibility_ajax = false;
                $( '.plugin-compatibility-spinner' ).remove();
                $( '.plugin-compatibility-success-msg' ).show().fadeOut( 2000 );
            }
        } );
    } );
}
