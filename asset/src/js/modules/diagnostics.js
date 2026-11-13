// The diagnostics tab: the diagnostic info (text) and the log (JSON) are two requests and two text fields, and the level
// of the log is chosen under the title of the log.

import { spinner_url } from './spinner.js';
import { ajax_problem_text } from './helpers.js';

const $ = jQuery;

/**
 * Fill the two text fields when the user switches to the diagnostics tab: the diagnostic info of this site, and the log,
 * which the server answers as JSON ({ entries : [...] }), shown as one line per entry
 * @since   0.0.1
 * @since   0.3.0  Two requests: the diagnostic info (text) and the log (JSON) are separate
 */
export function refresh_debug_log() {

    $.ajax( {
        url      : ajaxurl,
        type     : 'POST',
        dataType : 'text',
        cache    : false,
        data     : {
            action : 'syncpilot_get_diagnostics',
            nonce  : syncpilot_nonces.get_diagnostics,
        },
        error : function ( jqXHR ) {
            syncpilot_alert( ajax_problem_text( syncpilot_i10n.update_log_problem, jqXHR ) );
        },
        success : function ( data ) {
            $( '.debug-info-textarea' ).val( data );
        }
    } );

    $.ajax( {
        url      : ajaxurl,
        type     : 'POST',
        dataType : 'json',
        cache    : false,
        data     : {
            action : 'syncpilot_get_log',
            nonce  : syncpilot_nonces.get_log,
        },
        error : function ( jqXHR ) {
            syncpilot_alert( ajax_problem_text( syncpilot_i10n.update_log_problem, jqXHR ) );
        },
        success : function ( data ) {

            if ( typeof data.syncpilot_error != 'undefined' && data.syncpilot_error == 1 ) {
                syncpilot_alert( syncpilot_i10n.update_log_problem );

                return;
            }

            $( '.debug-log-textarea' ).val( data.entries.map( entry => JSON.stringify( entry ) ).join( '\n' ) );
        }
    } );
}

/**
 * Save the level of the log when the selection changes, and say so behind the selection like the settings do
 * @since   0.3.0
 */
function init_log_level() {

    $( '.log-level-select' ).change( function () {

        const $select = $( this );

        $select.after( '<img src="' + spinner_url + '" alt="" class="ajax-spinner general-spinner" />' );

        $.ajax( {
            url      : ajaxurl,
            type     : 'POST',
            dataType : 'json',
            cache    : false,
            data     : {
                action : 'syncpilot_save_log_level',
                level  : $select.val(),
                nonce  : syncpilot_nonces.save_log_level,
            },
            error : function ( jqXHR ) {

                $( '.log-level .ajax-spinner' ).remove();
                syncpilot_alert( ajax_problem_text( syncpilot_i10n.save_settings_problem, jqXHR ) );
            },
            success : function ( data ) {

                $( '.log-level .ajax-spinner' ).remove();

                if ( typeof data.syncpilot_error != 'undefined' && data.syncpilot_error == 1 ) {
                    syncpilot_alert( syncpilot_i10n.save_settings_problem );

                    return;
                }

                $select.after( '<span class="ajax-success-msg">' + syncpilot_i10n.saved + '</span>' );

                $( '.log-level .ajax-success-msg' ).fadeOut( 2000, function () {
                    $( this ).remove();
                } );
            }
        } );
    } );
}

export function init_diagnostics() {

    init_log_level();

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
                syncpilot_alert( ajax_problem_text( syncpilot_i10n.clear_log_problem, jqXHR ) );
            },
            success : function ( data ) { }
        } );
    } );
}
