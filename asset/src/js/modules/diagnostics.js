// The log on the diagnostics tab.

const $ = jQuery;

// updates the debug log when the user switches to the diagnostics tab
export function refresh_debug_log() {

    $.ajax( {
        url      : ajaxurl,
        type     : 'POST',
        dataType : 'text',
        cache    : false,
        data     : {
            action : 'syncpilot_get_log',
            nonce  : syncpilot_nonces.get_log,
        },
        error : function ( jqXHR, textStatus, errorThrown ) {
            syncpilot_alert( syncpilot_i10n.update_log_problem );
        },
        success : function ( data ) {
            $( '.debug-log-textarea' ).val( data );
        }
    } );
}

export function init_diagnostics() {

    // clears the debug log
    $( '.clear-log' ).click( function () {

        $( '.debug-log-textarea' ).val( '' );

        $.ajax( {
            url      : ajaxurl,
            type     : 'POST',
            dataType : 'text',
            cache    : false,
            data     : {
                action : 'syncpilot_clear_log',
                nonce  : syncpilot_nonces.clear_log,
            },
            error : function ( jqXHR, textStatus, errorThrown ) {
                syncpilot_alert( syncpilot_i10n.clear_log_problem );
            },
            success : function ( data ) { }
        } );
    } );
}
