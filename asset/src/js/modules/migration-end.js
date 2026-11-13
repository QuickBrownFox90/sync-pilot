// The end of a migration: finalizing the tables on the receiving site (or handing out the export), the message at the end
// and closing the progress box.

import { state } from './state.js';
import { migration_failed } from './migration.js';
import { firewall_note } from './helpers.js';

const $ = jQuery;

/**
 * Put the two functions that others call by name on window (media-files.js, and the steps in call_stack), and let the box
 * be closed by its button and, once the migration is over, by a click on the dark layer
 * @since   0.2.8
 */
export function init_migration_end() {

    window.migration_complete        = migration_complete;
    window.migration_complete_events = migration_complete_events;

    // close progress pop up once migration is completed
    $( 'body' ).on( 'click', '.close-progress-content-button', function () {
        hide_overlay();
    } );

    $( 'body' ).on( 'click', '#overlay', function () {
        if ( state.migration_completed == true ) {
            hide_overlay();
        }
    } );
}

/**
 * The last thing that is done in every migration, successful or not: the message at the end, the variables of a
 * migration are set back so that the next one starts clean, and the button to close the box is shown
 * @since   0.2.8
 */
function migration_complete_events() {

    if ( false == migration_error ) {
        if ( non_fatal_errors == '' ) {
            if ( 'savefile' != state.migration_intent && true == $( '#save_computer' ).is( ':checked' ) )
                $( '.progress-text' ).css( 'visibility', 'hidden' );

            $( '.progress-title' ).html( state.completed_msg ).append( '<div class="dashicons dashicons-yes"></div>' );
        } else {
            $( '.progress-text' ).html( syncpilot_sanitize_html( non_fatal_errors ) );
            $( '.progress-text' ).addClass( 'migration-error' );
            $( '.progress-title' ).html( syncpilot_i10n.completed_with_some_errors );
        }

        $( '.progress-bar-wrapper' ).hide();
    }

    $( '.migration-controls' ).hide();

    // reset migration variables so consecutive migrations work correctly
    call_stack                = [];
    migration_error           = false;
    state.currently_migrating = false;
    state.migration_completed = true;
    state.migration_paused    = false;
    state.migration_cancelled = false;
    state.doing_ajax          = false;
    state.migration_id        = '';
    non_fatal_errors          = '';

    $( '.progress-label' ).remove();
    $( '.migration-progress-ajax-spinner' ).remove();
    $( '.close-progress-content' ).show();
    $( '#overlay' ).css( 'cursor', 'pointer' );

    clearInterval( state.elapsed_interval );
}

/**
 * The step after the last table (and the media files): an export is handed out, for a push or a pull the tables on the
 * receiving site are finalized (the temporary tables are renamed, the old ones deleted)
 * @since   0.2.8
 */
function migration_complete() {

    $( '.migration-controls' ).fadeOut();

    if ( state.migration_intent == 'savefile' )
        finish_export();

    else
        finalize_tables();
}

/**
 * An export is done: the file is downloaded, or its address is shown
 * @since   0.2.8
 */
function finish_export() {

    state.currently_migrating = false;

    var migrate_complete_text = syncpilot_i10n.migration_complete;

    if ( $( '#save_computer' ).is( ':checked' ) ) {

        var url = syncpilot_this_download_url + encodeURIComponent( state.dump_filename );

        if ( $( '#gzip_file' ).is( ':checked' ) )
            url += '&gzip=1';

        window.location = url;
    } else {
        migrate_complete_text = syncpilot_i10n.completed_dump_located_at +
            ' <a href="' + state.dump_url + '">' + state.dump_url + '</a>.';
    }

    if ( migration_error == false ) {
        $( '.progress-text' ).html( migrate_complete_text );
        migration_complete_events();
        $( '.progress-title' ).html( state.completed_msg );
    }
}

/**
 * Rename the temporary tables, delete the old ones. The answer is empty when it worked
 * @since   0.2.8
 */
function finalize_tables() {

    $( '.progress-text' ).html( syncpilot_i10n.finalizing_migration );

    state.doing_ajax = true;

    $.ajax( {
        url      : ajaxurl,
        type     : 'POST',
        dataType : 'text',
        cache    : false,
        data     : {
            action      : 'syncpilot_finalize_migration',
            intent      : state.migration_intent,
            url         : state.remote_site,
            key         : state.secret_key,
            form_data   : state.form_data,
            prefix      : connection_data.prefix,
            temp_prefix : connection_data.temp_prefix,
            tables      : state.tables_to_migrate.join( ',' ),
            nonce       : syncpilot_nonces.finalize_migration,

            // everything before it was without an error: only then the server removes the media files that the other
            // site does not have, which cannot be undone
            media_clean : ( false == migration_error && '' == non_fatal_errors ) ? 1 : 0,
        },
        error : function ( jqXHR, textStatus, errorThrown ) {

            state.doing_ajax = false;

            if ( window.console && console.log ) {
                console.log( 'SyncPilot: finalize', textStatus, errorThrown, jqXHR.responseText );
            }

            var note = firewall_note( jqXHR );

            migration_failed( syncpilot_i10n.finalize_tables_problem + ( note ? '<br /><br />' + $( '<div>' ).text( note ).html() : '' ) );
        },
        success : function ( data ) {

            state.doing_ajax = false;

            if ( $.trim( data ) != '' ) {
                migration_failed( syncpilot_sanitize_html( data ) );

                return;
            }

            // the removal was chosen, but the migration had errors: it says so in the message at the end
            if ( $( '#remove-local-media' ).is( ':checked' ) && '' != non_fatal_errors )
                non_fatal_errors += '<br />' + syncpilot_i10n.media_not_removed;

            next_step_in_migration = {
                fn : run_next_step
            };

            execute_next_step();
        }
    } );
}

/**
 * Let the progress box slide out and remove it with the dark layer
 * @since   0.2.8
 */
function hide_overlay() {

    var height = $( '.progress-content' ).outerHeight();

    $( '.progress-content' ).animate( { 'top' : '-' + height + 'px' }, 400, 'swing', function () {

        $( '#overlay' ).remove();
        $( '.progress-content' ).remove();
    } );

    state.migration_completed = false;
}
