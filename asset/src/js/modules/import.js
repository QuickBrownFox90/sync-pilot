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

// the upload that is under way: the ID of the server, a flag to stop it, and the request that is sent
var upload = null;

// the backup that is not complete was asked about and confirmed (for this start only)
var confirmed_incomplete = false;

// the name that the server gave to the file that was uploaded last: it is chosen when the list is shown
var uploaded_name = '';

// the choice to remove the file was changed by hand: the list does not set it again
var delete_touched = false;

// how often a part of an upload is sent again after an error of the connection
const UPLOAD_TRIES = 3;

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

    // the file comes from the folder or from an upload
    $( 'input[name=import_source]' ).change( function () {

        var source      = $( 'input[name=import_source]:checked' ).val();

        $( '.import-from-upload' ).toggle( 'upload' === source );
        $( '.import-from-folder' ).toggle( 'folder' === source );
        $( '.import-from-backup' ).toggle( 'backup' === source );

        // what is chosen in a box that is not shown is not chosen
        $( 'input[name=import_file]' ).filter( function () {
            return ! $( this ).closest( '.import-source-box' ).is( ':visible' );
        } ).prop( 'checked', false );

        file_chosen();
    } );

    $( '.import-upload-start' ).click( start_upload );

    $( '.import-upload-cancel' ).click( function ( e ) {

        e.preventDefault();
        cancel_upload();
    } );

    // a file that was uploaded is removed after the import, one that was put into the folder is not (the choice can be changed)
    $( '#import-delete-file' ).change( function () {
        delete_touched = true;
    } );

    $( 'body' ).on( 'change', 'input[name=import_file]', function () {

        delete_touched = false;
        file_chosen();
    } );

    $( 'body' ).on( 'click', '.import-file-delete', function ( e ) {

        e.preventDefault();
        delete_file( $( this ).attr( 'data-file' ), $( this ).attr( 'data-source' ) );
    } );

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
            show_backups( data );
            file_chosen();
        }
    } );
}

/**
 * What follows from the file that is chosen: the choice to remove it after the import (on for an uploaded file, off for a file
 * that was put into the folder, not offered for a backup)
 * @since   0.4.3
 */
function file_chosen() {

    var $now = $( 'input[name=import_file]:checked' );

    $( '.import-delete-file' ).toggle( 'backup' !== $now.attr( 'data-source' ) );

    if ( $now.length && ! delete_touched )
        $( '#import-delete-file' ).prop( 'checked', '1' === $now.attr( 'data-uploaded' ) );
}

/**
 * Show the backups that can be restored: the time, the address of the site the backup was made on (when it is not this one), the
 * size, and whether it is complete. A radio button for each; they belong to the group of the files (a single choice).
 * @since   0.4.3
 * @param   {object} data  The answer of the server: backups, backup_folder
 */
function show_backups( data ) {

    var chosen = $( 'input[name=import_file]:checked' ).val();
    var $list  = $( '.import-backups' ).empty();

    $( '.import-backup-path' ).text( data.backup_folder || '' );

    $.each( data.backups || [], function ( n, backup ) {

        if ( ! backup.usable )
            return;

        var header = backup.header;
        var when   = header && header.created ? new Date( header.created ) : new Date( backup.modified * 1000 );
        var text   = when.toLocaleString();
        var $radio = $( '<input type="radio" name="import_file">' ).attr( { id : 'import-backup-' + n, value : backup.name, 'data-source' : 'backup', 'data-complete' : null === backup.complete ? '' : ( backup.complete ? '1' : '0' ) } );
        var $label = $( '<label>' ).attr( 'for', 'import-backup-' + n );

        if ( backup.name === chosen )
            $radio.prop( 'checked', true );

        if ( header ) {

            if ( 'export' === header.kind )
                text += ', ' + syncpilot_i10n.import_backup_export;

            if ( header.home && header.home !== syncpilot_this_url )
                text += ', ' + syncpilot_i10n.import_backup_other_site + ' ' + header.home;
        } else {
            text += ', ' + syncpilot_i10n.import_backup_older;
        }

        text += ', ' + format_size( backup.bytes );

        $label.append( $radio ).append( document.createTextNode( ' ' + text ) );

        if ( false === backup.complete )
            $label.append( $( '<span class="option-description import-backup-incomplete">' ).text( syncpilot_i10n.import_backup_incomplete ) );

        $list.append( $( '<li>' ).append( $label ).append( $( '<a href="#" class="js-action-link import-file-delete" data-source="backup">' ).attr( 'data-file', backup.name ).text( syncpilot_i10n.import_delete ) ) );
    } );

    $( '.import-no-backups' ).text( $list.children().length ? '' : syncpilot_i10n.import_no_backups );
}

/**
 * Fill the box with the folder and the list of the files; the file that was chosen before (or that the profile has) stays
 * chosen, a single file that can be used is chosen at once
 * @since   0.4.0
 * @param   {object} data  The answer of the server: files, folder, writable
 */
function show_files( data ) {

    var chosen = uploaded_name || $( 'input[name=import_file]:checked' ).val() || ( typeof syncpilot_loaded_import_file != 'undefined' ? syncpilot_loaded_import_file : '' );

    uploaded_name = '';

    var $list  = $( '.import-from-folder .import-files' ).empty();
    var usable = $.grep( data.files, function ( file ) {
        return file.usable;
    } );

    $( '.import-folder-path' ).text( data.folder );
    $( '.import-folder-note' ).text( data.writable ? '' : syncpilot_i10n.import_folder_not_writable ).toggle( ! data.writable );

    $.each( data.files, function ( n, file ) {

        var $item = $( '<li>' );

        if ( file.usable ) {

            var $label = $( '<label>' ).attr( 'for', 'import-file-' + n );
            var $radio = $( '<input type="radio" name="import_file">' ).attr( { id : 'import-file-' + n, value : file.name, 'data-source' : 'folder', 'data-uploaded' : file.uploaded ? '1' : '0' } );

            if ( file.name === chosen || ( ! chosen && 1 === usable.length ) )
                $radio.prop( 'checked', true );

            $label.append( $radio ).append( document.createTextNode( ' ' + file.name ) );
            $label.append( $( '<span class="option-description">' ).text( format_size( file.bytes ) + ( file.gzip ? ' (gzip)' : '' ) + ( file.uploaded ? ', ' + syncpilot_i10n.import_uploaded : '' ) + ', ' + new Date( file.modified * 1000 ).toLocaleString() ) );
            $item.append( $label );
            $item.append( $( '<a href="#" class="js-action-link import-file-delete">' ).attr( 'data-file', file.name ).text( syncpilot_i10n.import_delete ) );
        } else {
            $item.addClass( 'import-file-unusable' ).text( file.name + ' - ' + syncpilot_i10n['import_reason_' + file.reason] );
        }

        $list.append( $item );
    } );

    $( '.import-no-files' ).text( usable.length ? '' : syncpilot_i10n.import_no_files );

}

/**
 * Show a text under the upload (and in the colour of an error when it is one)
 * @since   0.4.2
 * @param   {string}  text   The text
 * @param   {boolean} error  It is an error
 */
function upload_text( text, error ) {
    $( '.import-upload-text' ).text( text ).toggleClass( 'error', !! error ).toggleClass( 'notification-message', !! error );
}

/**
 * Remove a file of the folder (the link behind it), after a question (in the dialog of the page, not a native pop-up)
 * @since   0.4.2
 * @since   0.4.4   Also a backup (source "backup")
 * @param   {string} name    The name of the file
 * @param   {string} source  "backup" for a backup, otherwise a dump of the folder
 */
function delete_file( name, source ) {

    var backup = 'backup' === source;

    syncpilot_confirm( ( backup ? syncpilot_i10n.import_delete_backup_confirm : syncpilot_i10n.import_delete_confirm ) + '\n' + name, function () {

        $.ajax( {
            url      : ajaxurl,
            type     : 'POST',
            dataType : 'json',
            cache    : false,
            data     : {
                action : 'syncpilot_import_delete',
                file   : name,
                source : backup ? 'backup' : 'folder',
                nonce  : syncpilot_nonces.import_delete,
            },
            success : function ( data ) {

                if ( data && data.deleted )
                    load_files();
                else
                    syncpilot_alert( ( data && data.body ) || syncpilot_i10n.import_delete_problem );
            },
            error : function () {
                syncpilot_alert( syncpilot_i10n.import_delete_problem );
            }
        } );
    } );
}

/**
 * The parts of a file for the upload, one after the other: a file as it is is cut with slice(), a .sql file is compressed
 * (gzip, in the browser) and cut where the compressed data is as large as a part. Each call gives { blob, last } for the next part;
 * the next part is read before the answer so that the last one is known (an empty last part would be sent for a file that
 * ends at the border of a part).
 * @since   0.4.2
 * @param   {File}    file      The file
 * @param   {number}  size      The size of a part
 * @param   {boolean} compress  Compress it
 * @return  {object}  next(): promise of { blob, last }, progress(): 0..1
 */
function upload_parts( file, size, compress ) {

    if ( ! compress ) {

        var at = 0;

        return {
            next : function () {

                var blob = file.slice( at, at + size );

                at += blob.size;

                return Promise.resolve( { blob : blob, last : at >= file.size } );
            },
            progress : function () {
                return file.size ? at / file.size : 1;
            }
        };
    }

    var read   = 0;
    var source = file.stream()
        .pipeThrough( new TransformStream( { transform : function ( piece, controller ) {

            read += piece.length;
            controller.enqueue( piece );
        } } ) )
        .pipeThrough( new CompressionStream( 'gzip' ) )
        .getReader();
    var held  = [];
    var held_bytes = 0;
    var ended = false;

    function fill( wanted ) {

        if ( ended || held_bytes >= wanted )
            return Promise.resolve();

        return source.read().then( function ( result ) {

            if ( result.done ) {
                ended = true;

                return;
            }

            held.push( result.value );
            held_bytes += result.value.length;

            return fill( wanted );
        } );
    }

    return {
        next : function () {

            // one byte more than a part: it is known whether something follows
            return fill( size + 1 ).then( function () {

                var all = new Uint8Array( held_bytes );
                var pos = 0;

                held.forEach( function ( piece ) {

                    all.set( piece, pos );
                    pos += piece.length;
                } );

                var take = Math.min( size, all.length );
                var rest = all.subarray( take );

                held       = rest.length ? [ rest ] : [];
                held_bytes = rest.length;

                return { blob : new Blob( [ all.subarray( 0, take ) ] ), last : ended && 0 === rest.length };
            } );
        },
        progress : function () {
            return file.size ? Math.min( 1, read / file.size ) : 1;
        }
    };
}

/**
 * A random ID for an upload: 24 hexadecimal characters, which the server takes as the name of the part
 * @since   0.4.2
 * @return  {string}
 */
function upload_id() {

    var bytes = new Uint8Array( 12 );

    window.crypto.getRandomValues( bytes );

    return Array.prototype.map.call( bytes, function ( b ) {
        return ( '0' + b.toString( 16 ) ).slice( -2 );
    } ).join( '' );
}

/**
 * Send one part: the part is a file of the form, the rest are fields. It is sent again after an error of the connection (the
 * server knows how much it has and tells it when a part came twice or not at all).
 * @since   0.4.2
 * @param   {object}   job   The upload: id, file, offset
 * @param   {object}   part  The part: blob, last
 * @param   {number}   tries How often it may be sent again
 * @return  {Promise}  Resolves with the answer of the server, rejects with a text
 */
function send_part( job, part, tries ) {

    return new Promise( function ( resolve, reject ) {

        var form = new FormData();

        form.append( 'action', 'syncpilot_import_upload' );
        form.append( 'nonce', syncpilot_nonces.import_upload );
        form.append( 'id', job.id );
        form.append( 'offset', job.offset );
        form.append( 'size', job.file.size );
        form.append( 'name', job.file.name );
        form.append( 'last', part.last ? 1 : 0 );
        form.append( 'chunk', part.blob, 'part' );

        job.request = $.ajax( {
            url         : ajaxurl,
            type        : 'POST',
            data        : form,
            processData : false,
            contentType : false,
            dataType    : 'text',
            cache       : false,
            timeout     : 0,
            success     : function ( text ) {

                var answer;

                try {
                    answer = JSON.parse( $.trim( text ) );
                } catch ( variable ) {
                    reject( '' === $.trim( text ) ? syncpilot_i10n.table_process_problem_empty_response : syncpilot_sanitize_html( text ) );

                    return;
                }

                // the server has it already (the answer of the part before was lost): go on from there
                if ( answer.syncpilot_error && 'offset' === answer.reason && answer.received === job.offset + part.blob.size ) {
                    resolve( { received : answer.received, done : 0 } );

                    return;
                }

                if ( answer.syncpilot_error ) {
                    reject( syncpilot_sanitize_html( answer.body ) );

                    return;
                }

                resolve( answer );
            },
            error : function ( jqXHR, textStatus ) {

                if ( job.stopped ) {
                    reject( '' );

                    return;
                }

                if ( tries > 0 ) {
                    setTimeout( function () {
                        send_part( job, part, tries - 1 ).then( resolve, reject );
                    }, 1000 );

                    return;
                }

                reject( jqXHR.status + ' ' + jqXHR.statusText + ' ' + textStatus );
            }
        } );
    } );
}

/**
 * Upload the file that is chosen: part after part, the bar shows how far it is. A .sql file is compressed first when the box says
 * so and the browser can (it is smaller, and what a firewall sees in a post is binary data). When it is done the list is read
 * again and the new file is chosen.
 * @since   0.4.2
 */
function start_upload() {

    var input = $( '#import-upload-file' )[0];
    var file  = input.files && input.files[0];

    if ( upload ) {
        return;
    }

    if ( ! file ) {
        upload_text( syncpilot_i10n.import_upload_choose, true );

        return;
    }

    if ( ! /\.sql(\.gz)?$/i.test( file.name ) ) {
        upload_text( syncpilot_i10n.import_upload_name, true );

        return;
    }

    var compress = $( '#import-upload-compress' ).is( ':checked' ) && /\.sql$/i.test( file.name ) && typeof CompressionStream != 'undefined' && typeof file.stream == 'function';
    var size     = Math.max( 65536, parseInt( syncpilot_max_request, 10 ) || 1048576 );
    var parts    = upload_parts( file, size, compress );
    var job      = { id : upload_id(), file : file, offset : 0, stopped : false, request : null };

    upload = job;

    $( '.import-upload-start' ).prop( 'disabled', true );
    $( '.import-upload-cancel' ).show();
    $( '.import-upload-bar' ).show();
    $( '.import-upload-bar-fill' ).width( '0%' );
    upload_text( syncpilot_i10n.import_uploading + ( compress ? ' (' + syncpilot_i10n.import_upload_compressing + ')' : '' ) + ' ...', false );

    function finish() {

        upload = null;

        $( '.import-upload-start' ).prop( 'disabled', false );
        $( '.import-upload-cancel' ).hide();
    }

    function step() {

        parts.next().then( function ( part ) {

            if ( job.stopped )
                return;

            return send_part( job, part, UPLOAD_TRIES ).then( function ( answer ) {

                job.offset = answer.received;

                var percent = Math.floor( 100 * parts.progress() );

                $( '.import-upload-bar-fill' ).width( percent + '%' );
                upload_text( syncpilot_i10n.import_uploading + ' ' + percent + '% (' + format_size( job.offset ) + ')', false );

                if ( answer.done || part.last && answer.name ) {

                    finish();
                    $( '.import-upload-bar' ).hide();
                    upload_text( syncpilot_i10n.import_upload_done, false );

                    // the file that came is chosen, the list shows it
                    $( 'input[name=import_source][value=folder]' ).prop( 'checked', true ).trigger( 'change' );
                    uploaded_name = answer.name;
                    delete_touched = false;
                    load_files();

                    return;
                }

                return step();
            } );
        } ).catch( function ( text ) {

            if ( job.stopped )
                return;

            finish();
            upload_text( syncpilot_i10n.import_upload_problem + ' ' + text, true );
        } );
    }

    step();
}

/**
 * Stop the upload: the request that is sent is aborted and the server removes what it has of the file
 * @since   0.4.2
 */
function cancel_upload() {

    if ( ! upload )
        return;

    var job = upload;

    job.stopped = true;

    if ( job.request )
        job.request.abort();

    upload = null;

    $( '.import-upload-start' ).prop( 'disabled', false );
    $( '.import-upload-cancel' ).hide();
    $( '.import-upload-bar' ).hide();
    upload_text( syncpilot_i10n.import_upload_cancelled, false );

    $.ajax( {
        url      : ajaxurl,
        type     : 'POST',
        dataType : 'text',
        data     : { action : 'syncpilot_import_upload', nonce : syncpilot_nonces.import_upload, id : job.id, cancel : 1 }
    } );
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

    var $chosen = $( 'input[name=import_file]:checked' );

    // a backup that is not complete is only restored when it is said again
    if ( 'backup' === $chosen.attr( 'data-source' ) && '0' === $chosen.attr( 'data-complete' ) && ! confirmed_incomplete ) {

        syncpilot_confirm( syncpilot_i10n.import_backup_confirm, function () {

            confirmed_incomplete = true;
            start_import();
        } );

        return;
    }

    var confirmed = confirmed_incomplete;

    confirmed_incomplete = false;

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
            action             : 'syncpilot_import_start',
            file               : $chosen.val(),
            source             : 'backup' === $chosen.attr( 'data-source' ) ? 'backup' : 'folder',
            confirm_incomplete : confirmed ? 1 : 0,
            form_data          : state.form_data,
            other_prefix       : $( '#import-other-prefix' ).is( ':checked' ) ? 1 : 0,
            strict_collations  : $( '#import-strict-collations' ).is( ':checked' ) ? 1 : 0,
            delete_file        : $( '#import-delete-file' ).is( ':checked' ) ? 1 : 0,
            nonce              : syncpilot_nonces.import_start,
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
