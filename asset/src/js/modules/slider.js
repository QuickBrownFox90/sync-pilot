// The slider for the maximum size of a request.

import { spinner_url } from './spinner.js';

const $ = jQuery;

export function init_slider() {

    $( '.slider' ).slider( {
        range : 'min',
        value : syncpilot_max_request / 1024,
        min   : 512,
        max   : syncpilot_bottleneck / 1024,
        step  : 512,
        slide : function ( event, ui ) {
            $( '.amount' ).html( syncpilot_add_commas( ui.value ) + ' kB' );
        },
        change : function ( event, ui ) {

            $( '.amount' ).after( '<img src="' + spinner_url +
                '" alt="" class="slider-spinner general-spinner" />' );

            $( '.slider' ).slider( 'disable' );

            // the answer is empty: with 'json' jQuery treats that as a parse error and calls error()
            $.ajax( {
                url      : ajaxurl,
                type     : 'POST',
                dataType : 'text',
                cache    : false,
                data     : {
                    action           : 'syncpilot_update_max_request_size',
                    max_request_size : parseInt( ui.value ),
                    nonce            : syncpilot_nonces.update_max_request_size,
                },
                error : function ( jqXHR, textStatus, errorThrown ) {

                    $( '.slider' ).slider( 'enable' );
                    $( '.slider-spinner' ).remove();
                    syncpilot_alert( syncpilot_i10n.max_request_size_problem );
                },
                success : function ( data ) {

                    $( '.slider' ).slider( 'enable' );
                    $( '.slider-spinner' ).remove();
                    $( '.slider-success-msg' ).show();

                    $( '.slider-success-msg' ).fadeOut( 2000, function () {
                        $( this ).hide();
                    } );
                }
            } );
        }
    } );

    $( '.amount' ).html( syncpilot_add_commas( $( '.slider' ).slider( 'value' ) ) + ' kB' );
}
