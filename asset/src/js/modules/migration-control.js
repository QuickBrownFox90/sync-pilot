// What the user can do while a migration runs (pause, resume, cancel) and the function that every step ends with:
// it decides whether the next step runs, the migration waits (paused) or it is cancelled.

import { state } from './state.js';
import { count } from './timer.js';
import { migration_failed, request_problem } from './migration.js';
import { firewall_note } from './helpers.js';

const $ = jQuery;

/**
 * Put execute_next_step and migration_request_running on window (media-files.js and the steps call them by name) and
 * bind the buttons of the box
 * @since   0.2.8
 */
export function init_migration_control() {

    window.execute_next_step = execute_next_step;

    // media-files.js is a plain script: it says that a firewall or a proxy has answered through this
    window.syncpilot_firewall_note = firewall_note;

    // media-files.js stops the migration when it cannot write the files; the temporary tables are removed like at a cancellation
    window.stop_migration = cancel_on_server;

    // media-files.js is a plain script and cannot reach the state of the page: it says whether it has a request under way
    window.migration_request_running = function ( running ) {
        state.doing_ajax = running;
    };

    $( 'body' ).on( 'click', '.pause-resume', toggle_pause );
    $( 'body' ).on( 'click', '.cancel', cancel_clicked );
}

/**
 * The button "Pause" / "Resume": a pause takes effect when the running request is answered (the next step does not
 * start), a resume starts the step that was waiting
 * @since   0.2.8
 */
function toggle_pause() {

    if ( true == state.migration_paused ) {

        state.migration_paused = false;
        state.doing_ajax       = true;

        $( '.progress-title' ).html( state.previous_progress_title );
        $( '.progress-text' ).html( state.previous_progress_text );
        $( '.migration-progress-ajax-spinner' ).show();
        $( '.pause-resume' ).html( syncpilot_i10n.pause );

        // resume the timer
        state.elapsed_interval = setInterval( count, 1000 );
        execute_next_step();
    } else {
        state.migration_paused        = true;
        state.doing_ajax              = false;
        state.previous_progress_title = $( '.progress-title' ).html();
        state.previous_progress_text  = $( '.progress-text' ).html();

        $( '.progress-title' ).html( syncpilot_i10n.migration_paused );
        $( '.pause-resume' ).html( syncpilot_i10n.resume );
        $( '.progress-text' ).html( syncpilot_i10n.completing_current_request );
    }
}

/**
 * The button "Cancel": the migration is marked as cancelled. When no request is running the cancellation starts now,
 * otherwise execute_next_step() starts it when the answer of the running request arrives
 * @since   0.2.8
 */
function cancel_clicked() {

    state.migration_cancelled = true;
    state.migration_paused    = false;

    $( '.progress-text' ).html( syncpilot_i10n.completing_current_request );
    $( '.progress-title' ).html( syncpilot_i10n.cancelling_migration );
    $( '.migration-controls' ).fadeOut();
    $( '.migration-progress-ajax-spinner' ).show();

    if ( false == state.doing_ajax )
        execute_next_step();
}

/**
 * Every step of a migration ends with this call for the next one. A paused migration stops here (the step waits in
 * next_step_in_migration), a cancelled one is cancelled, otherwise the next step runs
 * @since   0.2.8
 */
function execute_next_step() {

    if ( true == state.migration_paused ) {

        $( '.migration-progress-ajax-spinner' ).hide();

        // pause the timer
        clearInterval( state.elapsed_interval );
        $( '.progress-text' ).html( syncpilot_i10n.paused );
    } else if ( true == state.migration_cancelled ) {
        cancel_on_server();
    } else {
        next_step_in_migration.fn.apply( null, next_step_in_migration.args );
    }
}

/**
 * What is removed when a migration is cancelled, as the text under the bar: the export file, the backup, or the
 * temporary tables, on this site or on the other one
 * @since   0.2.8
 * @return  {string}
 */
function removing_text() {

    var progress_msg;

    if ( 'savefile' == state.migration_intent ) {
        progress_msg = syncpilot_i10n.removing_local_sql;
    } else if ( 'pull' == state.migration_intent ) {

        if ( 'backup' == state.stage )
            progress_msg = syncpilot_i10n.removing_local_backup;

        else
            progress_msg = syncpilot_i10n.removing_local_temp_tables;
    } else if ( 'push' == state.migration_intent ) {

        if ( 'backup' == state.stage )
            progress_msg = syncpilot_i10n.removing_remote_sql;

        else
            progress_msg = syncpilot_i10n.removing_remote_temp_tables;
    }

    return progress_msg;
}

/**
 * Ask the server to remove what the migration made so far (the export file, the backup, the temporary tables). An empty
 * answer means it worked; then the migration ends with the message "cancelled", or, when it is stopped because of a
 * reason (the media files cannot be written), with the title "stopped" and the reason
 * @since   0.2.8
 * @since   0.3.1  The reason: a migration that stops itself, with the same clean-up as a cancellation
 * @param   {string} reason  Why the migration stops, as HTML from the server; nothing for a cancellation
 */
function cancel_on_server( reason ) {

    state.migration_intent = $( 'input[name=action]:checked' ).val();

    $( '.progress-text' ).html( removing_text() );

    var request_data = {
        action        : 'syncpilot_cancel_migration',
        intent        : state.migration_intent,
        url           : state.remote_site,
        key           : state.secret_key,
        stage         : state.stage,
        dump_filename : state.dump_filename,
        form_data     : state.form_data,
        nonce         : syncpilot_nonces.cancel_migration,
    };

    // connection_data is null (not undefined) until a connection to another site was checked, so an export has none
    if ( connection_data )
        request_data.temp_prefix = connection_data.temp_prefix;

    $.ajax( {
        url      : ajaxurl,
        type     : 'POST',
        dataType : 'text',
        cache    : false,
        data     : request_data,
        error    : function ( jqXHR, textStatus, errorThrown ) {

            migration_failed( syncpilot_i10n.manually_remove_temp_files +
                request_problem( jqXHR, textStatus, errorThrown, 'Status', 'Response' ), syncpilot_i10n.migration_cancellation_failed );
        },
        success : function ( data ) {

            state.doing_ajax = false;
            data             = $.trim( data );

            if ( data != '' ) {
                migration_failed( syncpilot_sanitize_html( data ), syncpilot_i10n.migration_cancellation_failed );

                return;
            }

            if ( reason ) {
                migration_failed( syncpilot_sanitize_html( reason ), syncpilot_i10n.migration_stopped );

                return;
            }

            state.completed_msg = syncpilot_i10n.migration_cancelled;

            $( '.progress-text' ).hide();
            migration_complete_events();
        }
    } );
}
