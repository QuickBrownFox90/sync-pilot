// The secret key of this site: generating a new one.

import { state } from './state.js';
import { spinner_url } from './spinner.js';

const $ = jQuery;

export function init_api_key() {

    // regenerates the saved secret key
    $( '.reset-api-key' ).click( function () {

        if ( state.doing_reset_api_key_ajax ) {
            return;
        }

        syncpilot_confirm( syncpilot_i10n.reset_api_key, reset_api_key );
    } );

    function reset_api_key() {

        state.doing_reset_api_key_ajax = true;

        $( '.reset-api-key' ).after( '<img src="' + spinner_url +
            '" alt="" class="reset-api-key-ajax-spinner general-spinner" />' );

        $.ajax( {
            url      : ajaxurl,
            type     : 'POST',
            dataType : 'text',
            cache    : false,
            data     : {
                action : 'syncpilot_reset_api_key',
                nonce  : syncpilot_nonces.reset_api_key,
            },
            error : function ( jqXHR, textStatus, errorThrown ) {

                syncpilot_alert( syncpilot_i10n.reset_api_key_problem );
                $( '.reset-api-key-ajax-spinner' ).remove();
                state.doing_reset_api_key_ajax = false;
            },
            success : function ( data ) {

                $( '.reset-api-key-ajax-spinner' ).remove();
                state.doing_reset_api_key_ajax = false;
                $( '.connection-info' ).html( data );
            }
        } );
    }
}
