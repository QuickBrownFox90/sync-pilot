// The requests of a migration: the one that starts it and the loop over the tables. The tables are sent one after the other
// (and a big table in several requests, every answer says where the next one starts); after the last table the media files,
// the finalizing and the end follow as steps (execute_next_step, call_stack), which are still in script.js.

import { state } from './state.js';
import { choose_tables, draw_table_chunks } from './progress.js';

const $ = jQuery;

// Where the loop is: the table it works on (an index in state.tables_to_migrate), the rows of the tables, the sum of the rows
// and how much of it is done. initiate_migration() sets it, the stage "migrate" after a backup starts it again
const run = {
    table_rows             : {},
    total_size             : 0,
    index                  : 0,
    progress_size          : 0,
    last_progress          : 0,
    overall_table_progress : 0,
};

/**
 * Put the loop over the tables where the steps of a migration (execute_next_step) and the media files can call it
 * by name: it is `next_step_in_migration.fn`
 * @since   0.2.7
 */
export function init_migration() {

    window.migrate_table_recursive = migrate_table_recursive;
}

/**
 * The migration cannot go on: the title says so, the text is the reason, and the end of the migration is run, which
 * shows the button to close the box
 * @since   0.2.7
 * @param   {string} text   The reason, as HTML (sanitized by the caller where it comes from the other site)
 * @param   {string} title  The title; the one for a failed migration when it is left out
 */
export function migration_failed( text, title ) {

    $( '.progress-title' ).html( title || syncpilot_i10n.migration_failed );
    $( '.progress-text' ).html( text );
    $( '.progress-text' ).addClass( 'migration-error' );

    migration_error = true;
    migration_complete_events();
}

/**
 * The text of a failed request: the status, and the response which can be a whole page of HTML
 * @since   0.2.7
 * @param   {object} jqXHR         The request
 * @param   {string} textStatus    What jQuery says went wrong
 * @param   {string} errorThrown   The error text of the browser
 * @param   {string} status_label  The word before the status (the translated one, or Status for the old texts)
 * @param   {string} response_label  The word before the response
 * @return  {string}               The HTML below the first line of the message
 */
export function request_problem( jqXHR, textStatus, errorThrown, status_label, response_label ) {

    console.log( jqXHR );
    console.log( textStatus );
    console.log( errorThrown );

    return '<br /><br />' + status_label + ': ' + jqXHR.status + ' ' + jqXHR.statusText + '<br /><br />' + response_label + ':<br />' +
        jqXHR.responseText;
}

/**
 * Send the request that starts the migration (an export file is made, or the other site is asked to). Its answer starts the
 * loop over the tables
 * @since   0.2.7
 * @param   {object} table_rows  The number of rows by the name of the table (of the first stage)
 * @param   {number} total_size  The sum of the rows
 */
export function initiate_migration( table_rows, total_size ) {

    // a request is under way: Cancel waits for its answer instead of cancelling a migration that has no export file yet
    state.doing_ajax = true;

    $.ajax( {
        url      : ajaxurl,
        type     : 'POST',
        dataType : 'json',
        cache    : false,
        data     : {
            action    : 'syncpilot_initiate_migration',
            intent    : state.migration_intent,
            url       : state.remote_site,
            key       : state.secret_key,
            form_data : state.form_data,
            stage     : state.stage,
            nonce     : syncpilot_nonces.initiate_migration,
        },
        error : function ( jqXHR, textStatus, errorThrown ) {

            state.doing_ajax = false;

            migration_failed( syncpilot_i10n.connection_local_server_problem + ' (#112)' +
                request_problem( jqXHR, textStatus, errorThrown, 'Status', 'Response' ) );
        },
        success : function ( data ) {

            state.doing_ajax = false;

            if ( typeof data.syncpilot_error != 'undefined' && data.syncpilot_error == 1 ) {
                migration_failed( syncpilot_sanitize_html( data.body ) );

                return;
            }

            state.dump_url      = data.dump_url;
            state.dump_filename = data.dump_filename;

            start_tables( table_rows, total_size );
        }
    } );
}

/**
 * Start the loop at the first table
 * @since   0.2.7
 * @param   {object} table_rows  The number of rows by the name of the table
 * @param   {number} total_size  The sum of the rows
 */
function start_tables( table_rows, total_size ) {

    run.table_rows             = table_rows;
    run.total_size             = total_size;
    run.index                  = 0;
    run.progress_size          = 0;
    run.last_progress          = 0;
    run.overall_table_progress = 0;

    state.overall_percent = 0;

    next_step_in_migration = {
        fn   : migrate_table_recursive,
        args : [ '-1', '' ]
    };

    execute_next_step();
}

/**
 * One request for the table the loop is at, from the row it says (a big table is sent in several requests). When the
 * tables of the backup are done, the tables of the migration follow; after the last one the final steps
 * @since   0.2.7
 * @param   {string} current_row   The row to start at; '-1' for the beginning of the table
 * @param   {string} primary_keys  The values of the primary keys of the row, for a table that is sorted by them
 */
function migrate_table_recursive( current_row, primary_keys ) {

    if ( run.index >= state.tables_to_migrate.length ) {

        if ( state.stage == 'backup' ) {
            start_migrate_stage();
        } else {
            start_final_steps();

            return;
        }
    }

    show_table_text();
    send_table_request( current_row, primary_keys );
}

/**
 * The backup is done: the tables of the migration are chosen and drawn, and the loop begins again at the first one
 * @since   0.2.7
 */
function start_migrate_stage() {

    state.stage         = 'migrate';
    run.index           = 0;
    run.progress_size   = 0;

    $( '.progress-bar' ).width( '0px' );

    run.table_rows = choose_tables( 'migrate' );

    $( '.progress-tables' ).empty();
    $( '.progress-tables-hover-boxes' ).empty();

    var table_details = draw_table_chunks( state.tables_to_migrate, run.table_rows );

    run.table_rows = table_details[0];
    run.total_size = table_details[1];
}

/**
 * After the last table: the media files if they are chosen, then the end of the migration
 * @since   0.2.7
 */
function start_final_steps() {

    call_stack = [];

    if ( media_files_chosen() ) {
        call_stack.push( determine_media_to_migrate );
    }

    call_stack.push( migration_complete, migration_complete_events );

    next_step_in_migration = {
        fn : run_next_step
    };

    execute_next_step();
}

/**
 * The text under the bar: the percent and the table
 * @since   0.2.7
 */
function show_table_text() {

    var label = ( state.stage == 'backup' ) ? syncpilot_i10n.backing_up : syncpilot_i10n.migrating;

    $( '.progress-text' ).html( state.overall_percent + '% - ' + label + ' "' + state.tables_to_migrate[run.index] + '"' );
}

/**
 * What the request for a table sends
 * @since   0.2.7
 * @param   {string} current_row   The row to start at
 * @param   {string} primary_keys  The values of the primary keys of the row
 * @return  {object}               The data of the request
 */
function table_request_data( current_row, primary_keys ) {

    var last_table = ( run.index == ( state.tables_to_migrate.length - 1 ) ) ? 1 : 0;
    var gzip       = 0;

    if ( state.migration_intent != 'savefile' && parseInt( connection_data.gzip ) == 1 ) {
        gzip = 1;
    }

    var request_data = {
        action        : 'syncpilot_migrate_table',
        intent        : state.migration_intent,
        url           : state.remote_site,
        key           : state.secret_key,
        table         : state.tables_to_migrate[run.index],
        form_data     : state.form_data,
        stage         : state.stage,
        current_row   : current_row,
        dump_filename : state.dump_filename,
        last_table    : last_table,
        primary_keys  : primary_keys,
        gzip          : gzip,
        nonce         : syncpilot_nonces.migrate_table,
    };

    if ( state.migration_intent != 'savefile' ) {
        request_data.bottleneck = connection_data.bottleneck;
        request_data.prefix     = connection_data.prefix;
    }

    if ( connection_data && connection_data.path_current_site && connection_data.domain ) {
        request_data.path_current_site   = connection_data.path_current_site;
        request_data.domain_current_site = connection_data.domain;
    }

    return request_data;
}

/**
 * Send the request for the table the loop is at
 * @since   0.2.7
 * @param   {string} current_row   The row to start at
 * @param   {string} primary_keys  The values of the primary keys of the row
 */
function send_table_request( current_row, primary_keys ) {

    state.doing_ajax = true;

    $.ajax( {
        url      : ajaxurl,
        type     : 'POST',
        dataType : 'text',
        cache    : false,
        timeout  : 0,
        data     : table_request_data( current_row, primary_keys ),
        error    : function ( jqXHR, textStatus, errorThrown ) {

            state.doing_ajax = false;

            migration_failed( syncpilot_i10n.table_process_problem + ' ' + state.tables_to_migrate[run.index] +
                request_problem( jqXHR, textStatus, errorThrown, syncpilot_i10n.status, syncpilot_i10n.response ) );
        },
        success : table_answered
    } );
}

/**
 * The answer for a table: the position to go on from, or the reason why it cannot
 * @since   0.2.7
 * @param   {string} data  The answer of the server, JSON
 */
function table_answered( data ) {

    state.doing_ajax = false;
    data             = data.trim();

    var row_information;

    try {
        row_information = JSON.parse( data );
    } catch ( variable ) {

        if ( '' == data || null == data ) {
            migration_failed( syncpilot_i10n.table_process_problem_empty_response + ' ' + state.tables_to_migrate[run.index] );
        } else {
            migration_failed( syncpilot_sanitize_html( data ) );
        }

        return;
    }

    if ( typeof row_information.syncpilot_error != 'undefined' && row_information.syncpilot_error == 1 ) {
        migration_failed( syncpilot_sanitize_html( row_information.body ) );

        return;
    }

    count_progress( row_information );

    next_step_in_migration = {
        fn   : migrate_table_recursive,
        args : [ row_information.current_row, row_information.primary_keys ]
    };

    execute_next_step();
}

/**
 * Move the bar by what the answer says is done. A finished table ('-1') counts with all its rows and the loop goes on at
 * the next one; otherwise only the rows since the last answer are added
 * @since   0.2.7
 * @param   {object} row_information  The answer; a finished table gets an empty start for the next one
 */
function count_progress( row_information ) {

    if ( row_information.current_row == '-1' ) {
        run.progress_size -= run.overall_table_progress;
        run.overall_table_progress = 0;
        run.last_progress          = 0;

        run.progress_size += parseInt( run.table_rows[state.tables_to_migrate[run.index]] );

        run.index++;
        row_information.current_row  = '';
        row_information.primary_keys = '';
    } else {
        var current_progress = parseInt( row_information.current_row );
        var table_progress   = current_progress - run.last_progress;

        run.last_progress = current_progress;
        run.progress_size += table_progress;
        run.overall_table_progress += table_progress;
    }

    var percent = 100 * run.progress_size / run.total_size;

    $( '.progress-bar' ).width( percent + '%' );
    state.overall_percent = Math.floor( percent );
}
