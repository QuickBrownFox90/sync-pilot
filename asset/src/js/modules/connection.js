// The connection to the other site: what is typed into the box, the check of it (a request to the other site), the lists of
// tables and post types that the answer fills, the rows of find and replace, and the box that moves to the list of the
// action (pull, push, export). A saved profile connects when the page is loaded.

import { state } from './state.js';
import { spinner_url } from './spinner.js';
import { maybe_show_ssl_warning, maybe_show_version_warning, maybe_show_prefix_notice } from './notices.js';
import { add_scheme_row } from './replace-rows.js';
import { get_domain_name, remove_protocol } from './helpers.js';

const $ = jQuery;

// the lists of tables and post types as the page had them, one pair for each action; a connection replaces the ones for
// the other site (pull: its tables are chosen from, push: its tables are backed up)
var push_select;
var pull_select;
var push_post_type_select;
var pull_post_type_select;
var push_select_backup;
var pull_select_backup;

// the box with the connection info, which moves between the lists of the actions
var connection_info_box;

/**
 * The first part of the start of the page: the lists of tables as the page had them are kept, the options for the
 * backup are shown (hidden for an export), and a saved profile connects to the other site
 * @since   0.2.8
 */
export function prepare_connection() {

    push_select           = $( '#select-tables' ).clone();
    pull_select           = $( '#select-tables' ).clone();
    push_post_type_select = $( '#select-post-types' ).clone();
    pull_post_type_select = $( '#select-post-types' ).clone();
    push_select_backup    = $( '#select-backup' ).clone();
    pull_select_backup    = $( '#select-backup' ).clone();

    $( '.backup-options' ).show();
    $( '.keep-active-plugins' ).show();

    if ( $( '#savefile' ).is( ':checked' ) ) {
        $( '.backup-options' ).hide();
        $( '.keep-active-plugins' ).hide();
    }

    // automatically validate connnection info if we're loading a saved profile
    establish_remote_connection_from_saved_profile();
}

/**
 * Lock the options (export, pull, push, ...) while the connection to the other site is checked
 * @since   0.2.8
 */
function disable_export_type_controls() {

    $( '.option-group' ).each( function ( index ) {

        $( 'input', this ).attr( 'disabled', 'disabled' );
        $( 'label', this ).css( 'cursor', 'default' );
    } );
}

/**
 * Unlock the options again when the answer of the other site is there
 * @since   0.2.8
 */
function enable_export_type_controls() {

    $( '.option-group' ).each( function ( index ) {

        $( 'input', this ).removeAttr( 'disabled' );
        $( 'label', this ).css( 'cursor', 'pointer' );
    } );
}

/**
 * A saved profile for a pull or a push connects to the other site by itself when the page is loaded: the same check as
 * connection_box_changed(), then the lists of tables and post types get the selection the profile saved
 * @since   0.2.8
 */
function establish_remote_connection_from_saved_profile() {

    var action          = $( 'input[name=action]:checked' ).val();
    var connection_info = $.trim( $( '.pull-push-connection-info' ).val() ).split( '\n' );

    if ( typeof syncpilot_default_profile == 'undefined' || syncpilot_default_profile == true || action == 'savefile' || state.doing_ajax )
        return;

    state.last_replace_switch = action;

    state.doing_ajax = true;
    disable_export_type_controls();
    show_establishing_status();

    $.ajax( {
        url      : ajaxurl,
        type     : 'POST',
        dataType : 'json',
        cache    : false,
        data     : {
            action                      : 'syncpilot_verify_connection_to_remote_site',
            url                         : connection_info[0],
            key                         : connection_info[1],
            intent                      : action,
            nonce                       : syncpilot_nonces.verify_connection_to_remote_site,
            convert_post_type_selection : syncpilot_convert_post_type_selection,
            profile                     : syncpilot_profile
        },
        error : function ( jqXHR ) {
            connection_request_failed( jqXHR, '#102' );
        },
        success : function ( data ) {

            if ( connection_answer_is_error( data ) ) {
                return;
            }

            show_connection( connection_info, data );
            fill_lists_from_profile( data );

            media_files_connection_verified( connection_data );
        }
    } );
}

/**
 * The lists of tables and post types of the other site, with the selection that the saved profile has
 * @since   0.2.8
 * @param   {object} data  The answer of the other site
 */
function fill_lists_from_profile( data ) {

    var loaded_tables        = '';
    var loaded_post_types    = '';
    var loaded_tables_backup = '';

    if ( syncpilot_default_profile == false && typeof syncpilot_loaded_tables != 'undefined' )
        loaded_tables = syncpilot_loaded_tables;

    if ( syncpilot_default_profile == false && typeof syncpilot_loaded_post_types != 'undefined' ) {

        if ( typeof data.select_post_types != 'undefined' ) {
            $( '#exclude-post-types' ).attr( 'checked', 'checked' );
            $( '.post-type-select-wrap' ).show();
            loaded_post_types = data.select_post_types;
        } else
            loaded_post_types = syncpilot_loaded_post_types;
    }

    if ( syncpilot_default_profile == false && typeof syncpilot_loaded_tables_backup != 'undefined' )
        loaded_tables_backup = syncpilot_loaded_tables_backup;

    pull_select = build_select( 'select_tables[]', 'select-tables', connection_data.tables, table_label, in_list( loaded_tables ) );

    pull_post_type_select = build_select( 'select_post_types[]', 'select-post-types', connection_data.post_types, post_type_label, function ( value ) {
        return $.inArray( value, loaded_post_types ) != -1 || ( syncpilot_convert_exclude_revisions == true && value != 'revision' );
    } );

    push_select_backup = build_select( 'select_backup[]', 'select-backup', connection_data.tables, table_label, in_list( loaded_tables_backup ) );

    if ( $( '#pull' ).is( ':checked' ) ) {
        $( '#select-tables' ).remove();
        $( '.select-tables-wrap' ).prepend( pull_select );
        $( '#select-post-types' ).remove();
        $( '.select-post-types-wrap' ).prepend( pull_post_type_select );
        $( '#select-backup' ).remove();
        $( '.backup-tables-wrap' ).prepend( pull_select_backup );
        $( '.table-prefix' ).text( data.prefix );
        $( '.uploads-dir' ).html( syncpilot_this_uploads_dir );
    } else {
        $( '#select-backup' ).remove();
        $( '.backup-tables-wrap' ).prepend( push_select_backup );
    }
}

/**
 * A list for a multiple select (tables, post types) with the options of the other site
 * @since   0.2.8
 * @param   {string}   name         The name of the field
 * @param   {string}   id           The id of the select
 * @param   {array}    values       The values of the options
 * @param   {function} label_for    Gives the text of an option for its value
 * @param   {function} is_selected  Tells whether an option is selected, for its value
 * @return  {Element}               The select
 */
function build_select( name, id, values, label_for, is_selected ) {

    var select = document.createElement( 'select' );

    $( select ).attr( {
        multiple : 'multiple',
        name     : name,
        id       : id,
        class    : 'multiselect'
    } );

    $.each( values, function ( index, value ) {

        var selected = is_selected( value ) ? ' selected="selected" ' : ' ';

        $( select ).append( '<option' + selected + 'value="' + value + '">' + label_for( value ) + '</option>' );
    } );

    return select;
}

/**
 * The text of an option for a table: the name and the size
 * @since   0.2.8
 * @param   {string} value  The name of the table
 * @return  {string}
 */
function table_label( value ) {
    return value + ' (' + connection_data.table_sizes_hr[value] + ')';
}

/**
 * The text of an option for a post type: its name
 * @since   0.2.8
 * @param   {string} value  The name of the post type
 * @return  {string}
 */
function post_type_label( value ) {
    return value;
}

/**
 * A test for build_select(): is the value in a list (the selection of a profile; an empty text for none)
 * @since   0.2.8
 * @param   {array|string} list  The values that are selected
 * @return  {function}
 */
function in_list( list ) {

    return function ( value ) {
        return $.inArray( value, list ) != -1;
    };
}

/**
 * A test for build_select(): nothing is selected
 * @since   0.2.8
 * @return  {boolean}
 */
function nothing_selected() {
    return false;
}

/**
 * The text under the box while the other site is asked: "establishing connection" and the spinner
 * @since   0.2.8
 */
function show_establishing_status() {

    $( '.connection-status' ).html( syncpilot_i10n.establishing_remote_connection );

    $( '.connection-status' ).removeClass( 'notification-message error-notice migration-error' );

    $( '.connection-status' ).append( '<img src="' + spinner_url + '" alt="" class="ajax-spinner general-spinner" />' );
}

/**
 * The request to the other site failed (this server could not answer): the message with the status and the response,
 * the options are unlocked again
 * @since   0.2.8
 * @param   {object} jqXHR  The request
 * @param   {string} code   The number of the message (#100 for a typed connection, #102 for a saved profile)
 */
function connection_request_failed( jqXHR, code ) {

    $( '.connection-status' ).html( syncpilot_i10n.connection_local_server_problem + ' (' + code + ')' );

    $( '.connection-status' ).append( '<br /><br />Status: ' + jqXHR.status + ' ' + jqXHR.statusText + '<br /><br />Response:<br />' + jqXHR.responseText );

    $( '.connection-status' ).addClass( 'notification-message error-notice migration-error' );

    $( '.ajax-spinner' ).remove();
    state.doing_ajax = false;
    enable_export_type_controls();
}

/**
 * The first thing to do with an answer of the other site: the request is over (spinner away, options unlocked), and when
 * the answer is an error its message is shown (with the fields for a user name and password when the site asks for them)
 * @since   0.2.8
 * @param   {object} data  The answer
 * @return  {boolean}      True when the answer is an error
 */
function connection_answer_is_error( data ) {

    $( '.ajax-spinner' ).remove();
    state.doing_ajax = false;
    enable_export_type_controls();

    if ( typeof data.syncpilot_error == 'undefined' || data.syncpilot_error != 1 )
        return false;

    $( '.connection-status' ).html( syncpilot_sanitize_html( data.body ) );

    $( '.connection-status' ).addClass( 'notification-message error-notice migration-error' );

    if ( data.body.indexOf( '401 Unauthorized' ) > -1 )
        $( '.basic-access-auth-wrapper' ).show();

    return true;
}

/**
 * A good answer: the notices (different scheme, plugin version, table prefix), the box is locked, the second step is
 * shown, the answer is kept for the migration and the box moves to its place
 * @since   0.2.8
 * @param   {array}  connection_info  The two lines of the box: the address and the key
 * @param   {object} data             The answer of the other site
 */
function show_connection( connection_info, data ) {

    maybe_show_ssl_warning( connection_info[0], connection_info[1], data.scheme );

    maybe_show_version_warning( data.plugin_version, connection_info[0] );

    maybe_show_prefix_notice( data.prefix );

    $( '.pull-push-connection-info' ).addClass( 'temp-disabled' );
    $( '.pull-push-connection-info' ).attr( 'readonly', 'readonly' );
    $( '.connect-button' ).hide();

    $( '.connection-status' ).hide();
    $( '.step-two' ).show();

    state.connection_established = true;
    connection_data              = data;

    move_connection_info_box();
}

/**
 * The second part of the start of the page: the box moves to the list of the chosen action, the radios move it when the
 * action changes, and the buttons and links around the connection work
 * @since   0.2.8
 */
export function init_connection() {

    // move around textarea depending on whether or not the push/pull options are selected
    connection_info_box = $( '.connection-info-wrapper' );
    move_connection_info_box();

    $( '.migrate-selection.option-group input[type=radio]' ).change( function () {

        move_connection_info_box();

        if ( state.connection_established ) {
            change_replace_values();
        }
    } );

    // hide second section if pull or push is selected with no connection established
    if ( ( $( '#pull' ).is( ':checked' ) || $( '#push' ).is( ':checked' ) ) && ! state.connection_established ) {
        $( '.step-two' ).hide();
        $( '.connection-status' ).show();
    }

    // warn the user when editing the connection info after a connection has
    // been established
    $( 'body' ).on( 'click', '.temp-disabled', function () {

        syncpilot_confirm( syncpilot_i10n.change_connection_info, function () {

            $( '.ssl-notice' ).hide();
            $( '.different-plugin-version-notice' ).hide();
            $( '.migrate-db-button' ).show();
            $( '.temp-disabled' ).removeAttr( 'readonly' );
            $( '.temp-disabled' ).removeClass( 'temp-disabled' );
            $( '.connect-button' ).show();
            $( '.step-two' ).hide();
            $( '.connection-status' ).show().html( syncpilot_i10n.enter_connection_info );
            state.connection_established = false;
        } );
    } );

    // disable form submissions
    $( '.migrate-form' ).submit( function ( e ) {
        e.preventDefault();
    } );

    // fire connection_box_changed when the connect button is pressed
    $( '.connect-button' ).click( function ( event ) {

        event.preventDefault();
        $( this ).blur();
        connection_box_changed();
    } );

    // send paste even to connection_box_changed() function
    $( '.pull-push-connection-info' ).bind( 'paste', function ( e ) {

        var $this = this;

        setTimeout( function () {
            connection_box_changed();
        }, 0 );
    } );

    $( 'body' ).on( 'click', '.try-again', function () {
        connection_box_changed();
    } );

    $( 'body' ).on( 'click', '.try-http', function () {

        var connection_info = $.trim( $( '.pull-push-connection-info' ).val() )
            .split( '\n' );
        var new_url      = connection_info[0].replace( 'https', 'http' );
        var new_contents = new_url + '\n' + connection_info[1];

        $( '.pull-push-connection-info' ).val( new_contents );
        connection_box_changed();
    } );

    $( '.create-new-profile' ).change( function () {
        state.profile_name_edited = true;
    } );

    $( 'body' ).on( 'click', '.temporarily-disable-ssl', function () {

        if ( window.location.hash )
            var hash = window.location.hash.substring( 1 );

        $( this ).attr( 'href', $( this ).attr( 'href' ) + '&hash=' + hash );
    } );
}

// save file (export) / push / pull special conditions
/**
 * Put the box with the connection info into the list of the chosen action (pull or push) and show what belongs to it:
 * the second step when a connection exists, the notices, the prefix and the folder for uploads. For an export the box is
 * not needed
 * @since   0.2.8
 */
function move_connection_info_box() {

    $( '.connection-status' ).hide();
    $( '.prefix-notice' ).hide();
    $( '.ssl-notice' ).hide();
    $( '.different-plugin-version-notice' ).hide();
    $( '.step-two' ).show();
    $( '.backup-options' ).show();
    $( '.keep-active-plugins' ).show();
    $( '.directory-permission-notice' ).hide();
    $( '#create-backup' ).removeAttr( 'disabled' );
    $( '#create-backup-label' ).removeClass( 'disabled' );
    $( '.backup-option-disabled' ).hide();

    var connection_info = $.trim( $( '.pull-push-connection-info' ).val() ).split( '\n' );

    if ( $( '#pull' ).is( ':checked' ) ) {

        $( '.pull-list li' ).append( connection_info_box );
        connection_info_box.show();

        if ( state.connection_established ) {

            $( '.connection-status' ).hide();
            $( '.step-two' ).show();
            $( '.table-prefix' ).text( connection_data.prefix );
            $( '.uploads-dir' ).html( syncpilot_this_uploads_dir );

            if ( state.profile_name_edited == false ) {
                var profile_name = get_domain_name( connection_info[0] );

                $( '.create-new-profile' ).val( profile_name );
            }

            if ( state.show_prefix_notice == true )
                $( '.prefix-notice.pull' ).show();

            if ( state.show_ssl_notice == true )
                $( '.ssl-notice' ).show();

            if ( state.show_version_notice == true ) {
                $( '.different-plugin-version-notice' ).show();
                $( '.step-two' ).hide();
            }

            $( '.directory-scope' ).text( syncpilot_i10n.scope_local );

            if ( false == syncpilot_write_permission ) {
                $( '#create-backup' ).prop( 'checked', false );
                $( '#create-backup' ).attr( 'disabled', 'disabled' );
                $( '#create-backup-label' ).addClass( 'disabled' );
                $( '.backup-option-disabled' ).show();
                $( '.upload-directory-location' ).html( syncpilot_this_upload_dir_long );
            }
        } else {
            $( '.connection-status' ).show();
            $( '.step-two' ).hide();
        }
    } else if ( $( '#push' ).is( ':checked' ) ) {

        $( '.push-list li' ).append( connection_info_box );
        connection_info_box.show();

        if ( state.connection_established ) {

            $( '.connection-status' ).hide();
            $( '.step-two' ).show();
            $( '.table-prefix' ).html( syncpilot_this_prefix );
            $( '.uploads-dir' ).text( connection_data.uploads_dir );

            if ( state.profile_name_edited == false ) {
                var profile_name = get_domain_name( connection_info[0] );

                $( '.create-new-profile' ).val( profile_name );
            }

            if ( state.show_prefix_notice == true )
                $( '.prefix-notice.push' ).show();

            if ( state.show_ssl_notice == true )
                $( '.ssl-notice' ).show();

            if ( state.show_version_notice == true ) {
                $( '.different-plugin-version-notice' ).show();
                $( '.step-two' ).hide();
            }

            $( '.directory-scope' ).text( syncpilot_i10n.scope_remote );

            if ( '0' == connection_data.write_permissions ) {
                $( '#create-backup' ).prop( 'checked', false );
                $( '#create-backup' ).attr( 'disabled', 'disabled' );
                $( '#create-backup-label' ).addClass( 'disabled' );
                $( '.backup-option-disabled' ).show();
                $( '.upload-directory-location' ).text( connection_data.upload_dir_long );
            }
        } else {
            $( '.connection-status' ).show();
            $( '.step-two' ).hide();
        }
    } else if ( $( '#savefile' ).is( ':checked' ) ) {

        $( '.connection-status' ).hide();
        $( '.step-two' ).show();
        $( '.table-prefix' ).html( syncpilot_this_prefix );

        if ( state.profile_name_edited == false )
            $( '.create-new-profile' ).val( '' );

        $( '.backup-options' ).hide();
        $( '.keep-active-plugins' ).hide();

        if ( false == syncpilot_write_permission ) {
            $( '.directory-permission-notice' ).show();
            $( '.step-two' ).hide();
        }
    }

    media_files_connection_box_moved();
}

/**
 * Switching between push and pull turns the rows of find and replace around (old and new swap places) and brings back the
 * lists of tables of the chosen action
 * @since   0.2.8
 */
function change_replace_values() {

    if ( $( '#push' ).is( ':checked' ) || $( '#savefile' ).is( ':checked' ) ) {
        if ( state.last_replace_switch == '' || state.last_replace_switch == 'pull' ) {
            $( '.replace-row' ).each( function () {

                var old_val = $( '.old-replace-col input', this ).val();

                $( '.old-replace-col input', this ).val( $(
                    '.replace-right-col input', this ).val() );

                $( '.replace-right-col input', this ).val( old_val );
            } );
        }

        $( '#select-tables' ).remove();
        $( '.select-tables-wrap' ).prepend( push_select );
        $( '#select-post-types' ).remove();
        $( '.select-post-types-wrap' ).prepend( push_post_type_select );
        $( '#select-backup' ).remove();
        $( '.backup-tables-wrap' ).prepend( push_select_backup );

        state.last_replace_switch = 'push';
    } else if ( $( '#pull' ).is( ':checked' ) ) {

        if ( state.last_replace_switch == '' || state.last_replace_switch == 'push' ) {
            $( '.replace-row' ).each( function () {

                var old_val = $( '.old-replace-col input', this ).val();

                $( '.old-replace-col input', this ).val( $(
                    '.replace-right-col input', this ).val() );

                $( '.replace-right-col input', this ).val( old_val );
            } );
        }

        $( '#select-tables' ).remove();
        $( '.select-tables-wrap' ).prepend( pull_select );
        $( '#select-post-types' ).remove();
        $( '.select-post-types-wrap' ).prepend( pull_post_type_select );
        $( '#select-backup' ).remove();
        $( '.backup-tables-wrap' ).prepend( pull_select_backup );

        state.last_replace_switch = 'pull';
    }
}

/**
 * The connection info was typed, pasted or the button was clicked: check what is in the box (not empty, two lines, an
 * address, a key of 32 characters, not this site) and ask the other site who it is. A good answer opens the second step,
 * fills the lists of tables and post types and the rows for URL and path (and scheme), a bad one shows its message
 * @since   0.2.8
 */
function connection_box_changed() {

    var $this = $( '.pull-push-connection-info' );

    if ( state.doing_ajax || $( $this ).hasClass( 'temp-disabled' ) )
        return;

    var connection_info = $.trim( $this.val() ).split( '\n' );
    var error_message   = connection_info_error( connection_info );

    if ( error_message ) {
        $( '.connection-status' ).html( error_message );

        $( '.connection-status' ).addClass( 'notification-message error-notice migration-error' );

        return;
    }

    if ( syncpilot_openssl_available == false ) {
        connection_info[0] = connection_info[0].replace( 'https://', 'http://' );

        $this.val( connection_info[0] + '\n' + connection_info[1] );
    }

    state.show_prefix_notice = false;
    state.doing_ajax         = true;
    disable_export_type_controls();

    if ( $( '.basic-access-auth-wrapper' ).is( ':visible' ) ) {
        connection_info[0] = connection_info[0].replace( /\/\/(.*)@/, '//' );

        connection_info[0] = connection_info[0].replace( '//', '//' +
            encodeURIComponent( $.trim( $( '.auth-username' ).val() ) ) + ':' +
            encodeURIComponent( $.trim( $( '.auth-password' ).val() ) ) + '@' );

        $this.val( connection_info[0] + '\n' + connection_info[1] );
        $( '.basic-access-auth-wrapper' ).hide();
    }

    $( '.step-two' ).hide();
    $( '.ssl-notice' ).hide();
    $( '.prefix-notice' ).hide();
    $( '.connection-status' ).show();

    show_establishing_status();

    state.profile_name_edited = false;

    $.ajax( {
        url      : ajaxurl,
        type     : 'POST',
        dataType : 'json',
        cache    : false,
        data     : {
            action : 'syncpilot_verify_connection_to_remote_site',
            url    : connection_info[0],
            key    : connection_info[1],
            intent : $( 'input[name=action]:checked' ).val(),
            nonce  : syncpilot_nonces.verify_connection_to_remote_site,
        },
        error : function ( jqXHR ) {
            connection_request_failed( jqXHR, '#100' );
        },
        success : function ( data ) {

            if ( connection_answer_is_error( data ) )
                return;

            $( '.create-new-profile' ).val( get_domain_name( connection_info[0] ) );

            show_connection( connection_info, data );
            fill_lists( data );
            fill_replace_rows( data );

            next_step_in_migration = {
                fn   : media_files_connection_verified,
                args : [ connection_data ]
            };

            execute_next_step();
        }
    } );
}

/**
 * What is wrong with the connection info that was typed, or an empty text: not empty, two lines, an address, a key of 32
 * characters, and not the address or the key of this site
 * @since   0.2.8
 * @param   {array} connection_info  The lines of the box
 * @return  {string}                 The message, or an empty text when everything is right
 */
function connection_info_error( connection_info ) {

    if ( connection_info == '' )
        return syncpilot_i10n.connection_info_missing;

    if ( connection_info.length != 2 )
        return syncpilot_i10n.connection_info_incorrect;

    if ( ! validate_url( connection_info[0] ) )
        return syncpilot_i10n.connection_info_url_invalid;

    if ( connection_info[1].length != 32 )
        return syncpilot_i10n.connection_info_key_invalid;

    if ( connection_info[0] == syncpilot_connection_info[0] )
        return syncpilot_i10n.connection_info_local_url;

    if ( connection_info[1] == syncpilot_connection_info[1] )
        return syncpilot_i10n.connection_info_local_key;

    return '';
}

/**
 * The lists of tables and post types of the other site, nothing selected; they replace the ones of the page for the
 * action that is chosen (pull: the tables to choose from; push: the tables for the backup)
 * @since   0.2.8
 * @param   {object} data  The answer of the other site
 */
function fill_lists( data ) {

    pull_select        = build_select( 'select_tables[]', 'select-tables', connection_data.tables, table_label, nothing_selected );
    push_select_backup = build_select( 'select_backup[]', 'select-backup', connection_data.tables, table_label, nothing_selected );

    pull_post_type_select = build_select( 'select_post_types[]', 'select-post-types', connection_data.post_types, post_type_label, nothing_selected );

    if ( $( '#pull' ).is( ':checked' ) ) {
        $( '#select-tables' ).remove();
        $( '.select-tables-wrap' ).prepend( pull_select );
        $( '#select-post-types' ).remove();
        $( '.select-post-types-wrap' ).prepend( pull_post_type_select );
        $( '.table-prefix' ).text( data.prefix );
        $( '.uploads-dir' ).html( syncpilot_this_uploads_dir );
    } else {
        $( '#select-backup' ).remove();
        $( '.backup-tables-wrap' ).prepend( push_select_backup );
    }
}

/**
 * The rows of find and replace for a new profile: the URL and the path of the receiving site (and of the sending site),
 * the domain of a multisite, and the row for the scheme when the two sites differ
 * @since   0.2.8
 * @param   {object} data  The answer of the other site (its address and path)
 */
function fill_replace_rows( data ) {

    if ( $( '#pull' ).is( ':checked' ) ) {
        $( '#new-url' ).val( remove_protocol( syncpilot_this_url ) );
        $( '#new-path' ).val( syncpilot_this_path );

        if ( syncpilot_is_multisite == true )
            $( '#new-domain' ).val( syncpilot_this_domain );

        $( '#old-url' ).val( remove_protocol( data.url ) );
        $( '#old-path' ).val( data.path );

        add_scheme_row( data.url, syncpilot_this_url );
    } else {
        $( '#new-url' ).val( remove_protocol( data.url ) );
        $( '#new-path' ).val( data.path );

        add_scheme_row( syncpilot_this_url, data.url );
    }
}

/**
 * Is it an address? (the regular expression of RFC 3986)
 * @since   0.2.8
 * @param   {string} url  The text to check
 * @return  {boolean}
 */
function validate_url( url ) {
    return /^([a-z]([a-z]|\d|\+|-|\.)*):(\/\/(((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:)*@)?((\[(|(v[\da-f]{1,}\.(([a-z]|\d|-|\.|_|~)|[!\$&'\(\)\*\+,;=]|:)+))\])|((\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5]))|(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=])*)(:\d*)?)(\/(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*|(\/((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)+(\/(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*)?)|((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)+(\/(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*)|((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)){0})(\?((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)|[\uE000-\uF8FF]|\/|\?)*)?(\#((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)|\/|\?)*)?$/i
        .test( url );
}
