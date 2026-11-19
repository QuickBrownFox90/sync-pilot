// The import of a dump file: the choice of the file (the list of the folder, which takes the place of the connection info),
// and the requests of the import. The server works at the dump in steps (modules/migration.js has the same for the tables):
// every answer says where it is, and the next request goes on. The order is unpack (a gzip file), scan (nothing is written),
// the backup of the tables that the dump replaces, load (the temporary tables), replace (find and replace), and then the
// tables are replaced like after a pull (migration-end.js).

import { state } from './state.js';
import { draw_table_chunks } from './progress.js';
import { migration_failed, request_problem, start_tables, set_after_backup } from './migration.js';
import { get_intersect } from './helpers.js';

const $ = jQuery;

// the files of the folder were asked for
var files_loaded = false;

// the answer of the scan that has the list of the tables; the load goes on with it after the backup
var scanned = null;

/**
 * Bind what the form of an import needs: the list of the dumps is asked for when the import is chosen, the link refreshes it
 * @since   0.4.0
 */
export function init_import() {

    $( 'body' ).on( 'click', '.import-refresh', function ( e ) {

        e.preventDefault();
        load_files();
    } );

    $( '.migrate-selection.option-group input[type=radio]' ).change( import_chosen_changed );

    import_chosen_changed();
}

/**
 * The form is marked as an import form (what does not belong to an import is hidden by it), and the list of the files is
 * asked for when the import is chosen for the first time
 * @since   0.4.0
 */
function import_chosen_changed() {

    var chosen = $( '#import' ).is( ':checked' );

    $( '#migrate-form' ).toggleClass( 'is-import', chosen );

    if ( chosen && ! files_loaded )
        load_files();
}

/**
 * The size as a short text
 * @since   0.4.0
 * @param   {number} bytes  The size
 * @return  {string}
 */
function format_size( bytes ) {

    var units = [ 'B', 'KB', 'MB', 'GB', 'TB' ];
    var i     = 0;

    while ( bytes >= 1024 && i < units.length - 1 ) {
        bytes /= 1024;
        i++;
    }

    return ( i ? bytes.toFixed( 1 ) : bytes ) + ' ' + units[i];
}

/**
 * Ask for the dumps in the folder and show them: a radio button for every file that can be used, the others with the reason
 * @since   0.4.0
 */
function load_files() {

    $.ajax( {
        url      : ajaxurl,
        type     : 'POST',
        dataType : 'json',
        cache    : false,
        data     : {
            action : 'syncpilot_import_list',
            nonce  : syncpilot_nonces.import_list,
        },
        error : function ( jqXHR ) {
            $( '.import-no-files' ).text( syncpilot_i10n.import_list_problem + ' ' + jqXHR.status + ' ' + jqXHR.statusText );
        },
        success : function ( data ) {

            if ( typeof data.syncpilot_error != 'undefined' && data.syncpilot_error == 1 ) {
                $( '.import-no-files' ).text( syncpilot_i10n.import_list_problem );

                return;
            }

            files_loaded = true;
            show_files( data );
        }
    } );
}

/**
 * Fill the box with the folder and the list of the files; the file that was chosen before (or that the profile has) stays
 * chosen, a single file that can be used is chosen at once
 * @since   0.4.0
 * @param   {object} data  The answer of the server: files, folder, writable
 */
function show_files( data ) {

    var chosen = $( 'input[name=import_file]:checked' ).val() || ( typeof syncpilot_loaded_import_file != 'undefined' ? syncpilot_loaded_import_file : '' );
    var $list  = $( '.import-files' ).empty();
    var usable = $.grep( data.files, function ( file ) {
        return file.usable;
    } );

    $( '.import-folder-path' ).text( data.folder );
    $( '.import-folder-note' ).text( data.writable ? '' : syncpilot_i10n.import_folder_not_writable ).toggle( ! data.writable );

    $.each( data.files, function ( n, file ) {

        var $item = $( '<li>' );

        if ( file.usable ) {

            var $label = $( '<label>' ).attr( 'for', 'import-file-' + n );
            var $radio = $( '<input type="radio" name="import_file">' ).attr( { id : 'import-file-' + n, value : file.name } );

            if ( file.name === chosen || ( ! chosen && 1 === usable.length ) )
                $radio.prop( 'checked', true );

            $label.append( $radio ).append( document.createTextNode( ' ' + file.name ) );
            $label.append( $( '<span class="option-description">' ).text( format_size( file.bytes ) + ( file.gzip ? ' (gzip)' : '' ) + ', ' + new Date( file.modified * 1000 ).toLocaleString() ) );
            $item.append( $label );
        } else {
            $item.addClass( 'import-file-unusable' ).text( file.name + ' - ' + syncpilot_i10n['import_reason_' + file.reason] );
        }

        $list.append( $item );
    } );

    $( '.import-no-files' ).text( usable.length ? '' : syncpilot_i10n.import_no_files );
}

/**
 * The text and the bar for a phase of the import: what is done, and how far (the place in the dump, or the number of tables
 * for the replace)
 * @since   0.4.0
 * @param   {object} answer  The answer of the server
 */
function show_progress( answer ) {

    var labels  = { unpack : syncpilot_i10n.import_unpacking, scan : syncpilot_i10n.import_scanning, scanned : syncpilot_i10n.import_scanning, load : syncpilot_i10n.import_loading, loaded : syncpilot_i10n.import_loading, replace : syncpilot_i10n.import_replacing, replaced : syncpilot_i10n.import_replacing };
    var percent = 0;

    if ( 'replace' === answer.phase || 'replaced' === answer.phase )
        percent = answer.tables ? 100 * answer.replace_table / answer.tables : 100;
    else
        percent = answer.total ? 100 * answer.offset / answer.total : 0;

    percent = Math.max( 0, Math.min( 100, percent ) );

    $( '.progress-bar' ).width( percent + '%' );
    state.overall_percent = Math.floor( percent );

    var text = state.overall_percent + '% - ' + ( labels[answer.phase] || '' );

    if ( answer.tables && ( 'load' === answer.phase || 'replace' === answer.phase ) )
        text += ' (' + ( 'load' === answer.phase ? ( answer.tables_done || 0 ) : answer.replace_table ) + ' / ' + answer.tables + ' ' + syncpilot_i10n.import_tables + ')';

    $( '.progress-text' ).html( text );
}

/**
 * Start the import after the click: the server makes the ID of the migration, notes the dump and names the backup. The
 * connection data that the loop of the tables and the end of a migration read (the prefix, the temporary prefix, the limit
 * of a request) are those of this site.
 * @since   0.4.0
 */
export function start_import() {

    state.stage = 'import';
    scanned     = null;

    state.doing_ajax = true;

    $.ajax( {
        url      : ajaxurl,
        type     : 'POST',
        dataType : 'json',
        cache    : false,
        timeout  : 0,
        data     : {
            action            : 'syncpilot_import_start',
            file              : $( 'input[name=import_file]:checked' ).val(),
            form_data         : state.form_data,
            other_prefix      : $( '#import-other-prefix' ).is( ':checked' ) ? 1 : 0,
            strict_collations : $( '#import-strict-collations' ).is( ':checked' ) ? 1 : 0,
            nonce             : syncpilot_nonces.import_start,
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

            state.migration_id  = data.migration_id;
            state.dump_filename = data.dump_filename || '';
            state.dump_url      = data.dump_url || '';

            connection_data = {
                prefix      : data.prefix,
                temp_prefix : data.temp_prefix,
                bottleneck  : data.bottleneck,
                gzip        : 0,
                table_rows  : syncpilot_this_table_rows,
                tables      : syncpilot_this_tables,
            };

            set_after_backup( load_after_backup );

            $( '.progress-text' ).html( syncpilot_i10n.import_scanning );

            next_step_in_migration = {
                fn : import_step
            };

            execute_next_step();
        }
    } );
}

/**
 * One request of the import: the server works at the dump for a few seconds, the answer says where it is
 * @since   0.4.0
 */
function import_step() {

    state.doing_ajax = true;

    $.ajax( {
        url      : ajaxurl,
        type     : 'POST',
        dataType : 'text',
        cache    : false,
        timeout  : 0,
        data     : {
            action : 'syncpilot_import_step',
            nonce  : syncpilot_nonces.import_step,
        },
        error : function ( jqXHR, textStatus, errorThrown ) {

            state.doing_ajax = false;

            migration_failed( syncpilot_i10n.table_process_problem_empty_response.split( '.' )[0] + '.' +
                request_problem( jqXHR, textStatus, errorThrown, syncpilot_i10n.status, syncpilot_i10n.response ) );
        },
        success : import_answered
    } );
}

/**
 * The answer of a request: the reason when it cannot go on; the end of the scan (the backup, then the load); the end of the
 * replace (the tables are replaced); otherwise the next request
 * @since   0.4.0
 * @param   {string} data  The answer of the server, JSON
 */
function import_answered( data ) {

    state.doing_ajax = false;

    var answer;

    try {
        answer = JSON.parse( $.trim( data ) );
    } catch ( variable ) {

        migration_failed( '' === $.trim( data ) ? syncpilot_i10n.table_process_problem_empty_response : syncpilot_sanitize_html( data ) );

        return;
    }

    if ( typeof answer.syncpilot_error != 'undefined' && answer.syncpilot_error == 1 ) {
        migration_failed( syncpilot_sanitize_html( answer.body ) );

        return;
    }

    show_progress( answer );

    if ( 'scanned' === answer.phase ) {

        scanned = answer;
        backup_or_load();

        return;
    }

    if ( 'replaced' === answer.phase ) {

        state.stage             = 'migrate';
        state.tables_to_migrate = scanned.table_names;

        call_stack = [ migration_complete, migration_complete_events ];

        next_step_in_migration = {
            fn : run_next_step
        };

        execute_next_step();

        return;
    }

    next_step_in_migration = {
        fn : import_step
    };

    execute_next_step();
}

/**
 * The scan is done: the tables of this site that the dump replaces are backed up when the form says so (the loop of the
 * tables of migration.js, which goes on with load_after_backup() after the last one), otherwise the load follows at once
 * @since   0.4.0
 */
function backup_or_load() {

    var tables = get_intersect( scanned.table_names, syncpilot_this_tables );

    if ( ! $( '#create-backup' ).is( ':checked' ) || ! tables.length ) {
        load_after_backup();

        return;
    }

    state.stage             = 'backup';
    state.tables_to_migrate = tables;

    $( '.progress-tables' ).empty();
    $( '.progress-tables-hover-boxes' ).empty();
    $( '.progress-bar' ).width( '0px' );

    var details = draw_table_chunks( state.tables_to_migrate, syncpilot_this_table_rows );

    start_tables( details[0], details[1] );
}

/**
 * The backup is done (or there is none): the load begins, and the bar starts again
 * @since   0.4.0
 */
function load_after_backup() {

    state.stage             = 'import';
    state.tables_to_migrate = scanned.table_names;

    $( '.progress-tables' ).empty();
    $( '.progress-tables-hover-boxes' ).empty();
    $( '.progress-bar' ).width( '0px' );
    $( '.progress-text' ).html( '0% - ' + syncpilot_i10n.import_loading );

    next_step_in_migration = {
        fn : import_step
    };

    execute_next_step();
}
