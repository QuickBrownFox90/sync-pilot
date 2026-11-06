import { state } from './modules/state.js';
import { spinner_url } from './modules/spinner.js';
import { setup_counter, count } from './modules/timer.js';
import { maybe_show_ssl_warning, maybe_show_version_warning, maybe_show_prefix_notice } from './modules/notices.js';
import { init_slider } from './modules/slider.js';
import { init_plugin_compatibility } from './modules/plugin-compatibility.js';
import { init_diagnostics } from './modules/diagnostics.js';
import { init_form_ui } from './modules/form-ui.js';
import { init_multiselect } from './modules/multiselect.js';
import { init_replace_rows, add_scheme_row } from './modules/replace-rows.js';
import { init_profiles } from './modules/profiles.js';
import { init_api_key } from './modules/api-key.js';
import { init_settings } from './modules/settings.js';
import { init_tabs } from './modules/tabs.js';
import { tables_are_chosen, form_is_valid } from './modules/form-check.js';
import { choose_tables, draw_table_chunks, create_overlay, show_progress_box, slide_in_progress_box } from './modules/progress.js';
import { profile_has_name, is_new_profile, send_profile, add_profile_to_list } from './modules/save-profile.js';
import { init_migration, initiate_migration } from './modules/migration.js';
import { get_query_var, get_domain_name, get_default_profile_name, remove_protocol } from './modules/helpers.js';

// These three are global on purpose (the fourth, migrate_table_recursive, is put on window by modules/migration.js): media-files.js uses them (common.js and the media files part are plain scripts). In
// the file that esbuild makes they would be local to it, so they are put on window.
window.migration_complete        = undefined;
window.migration_complete_events = undefined;
window.execute_next_step         = undefined;

( function ( $ ) {

    window.onbeforeunload = function ( e ) {

        if ( state.currently_migrating ) {
            e = e || window.event;

            // For IE and Firefox prior to version 4
            if ( e ) {
                e.returnValue = 'Sure?';
            }

            // For Safari
            return 'Sure?';
        }
    };

    $( document ).ready( function () {

        init_plugin_compatibility();
        init_slider();

        var progress_content_original = $( '.progress-content' ).clone();

        $( '.progress-content' ).remove();

        var push_select           = $( '#select-tables' ).clone();
        var pull_select           = $( '#select-tables' ).clone();
        var push_post_type_select = $( '#select-post-types' ).clone();
        var pull_post_type_select = $( '#select-post-types' ).clone();
        var push_select_backup    = $( '#select-backup' ).clone();
        var pull_select_backup    = $( '#select-backup' ).clone();

        $( '.backup-options' ).show();
        $( '.keep-active-plugins' ).show();

        if ( $( '#savefile' ).is( ':checked' ) ) {
            $( '.backup-options' ).hide();
            $( '.keep-active-plugins' ).hide();
        }

        function disable_export_type_controls() {

            $( '.option-group' ).each( function ( index ) {

                $( 'input', this ).attr( 'disabled', 'disabled' );
                $( 'label', this ).css( 'cursor', 'default' );
            } );
        }

        function enable_export_type_controls() {

            $( '.option-group' ).each( function ( index ) {

                $( 'input', this ).removeAttr( 'disabled' );
                $( 'label', this ).css( 'cursor', 'pointer' );
            } );
        }

        // automatically validate connnection info if we're loading a saved profile
        establish_remote_connection_from_saved_profile();

        function establish_remote_connection_from_saved_profile() {

            var action = $( 'input[name=action]:checked' ).val();
            var connection_info = $.trim( $( '.pull-push-connection-info' ).val() ).split(
                '\n' );

            if ( typeof syncpilot_default_profile == 'undefined' ||
                syncpilot_default_profile == true || action == 'savefile' || state.doing_ajax
            ) {
                return;
            }

            state.last_replace_switch = action;

            state.doing_ajax = true;
            disable_export_type_controls();

            $( '.connection-status' ).html( syncpilot_i10n.establishing_remote_connection );

            $( '.connection-status' ).removeClass(
                'notification-message error-notice migration-error' );

            $( '.connection-status' ).append( '<img src="' + spinner_url +
                '" alt="" class="ajax-spinner general-spinner" />' );

            var intent = $( 'input[name=action]:checked' ).val();

            $.ajax( {
                url      : ajaxurl,
                type     : 'POST',
                dataType : 'json',
                cache    : false,
                data     : {
                    action                      : 'syncpilot_verify_connection_to_remote_site',
                    url                         : connection_info[0],
                    key                         : connection_info[1],
                    intent                      : intent,
                    nonce                       : syncpilot_nonces.verify_connection_to_remote_site,
                    convert_post_type_selection : syncpilot_convert_post_type_selection,
                    profile                     : syncpilot_profile
                },
                error : function ( jqXHR, textStatus, errorThrown ) {

                    $( '.connection-status' ).html( syncpilot_i10n.connection_local_server_problem +
                        ' (#102)' );

                    $( '.connection-status' ).append( '<br /><br />Status: ' + jqXHR.status +
                        ' ' + jqXHR.statusText + '<br /><br />Response:<br />' + jqXHR.responseText );

                    $( '.connection-status' ).addClass(
                        'notification-message error-notice migration-error' );

                    $( '.ajax-spinner' ).remove();
                    state.doing_ajax = false;
                    enable_export_type_controls();
                },
                success : function ( data ) {

                    $( '.ajax-spinner' ).remove();
                    state.doing_ajax = false;
                    enable_export_type_controls();

                    if ( typeof data.syncpilot_error != 'undefined' && data.syncpilot_error == 1 ) {
                        $( '.connection-status' ).html( syncpilot_sanitize_html( data.body ) );

                        $( '.connection-status' ).addClass(
                            'notification-message error-notice migration-error' );

                        if ( data.body.indexOf( '401 Unauthorized' ) > -1 ) {
                            $( '.basic-access-auth-wrapper' ).show();
                        }

                        return;
                    }

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

                    var loaded_tables = '';

                    if ( syncpilot_default_profile == false && typeof syncpilot_loaded_tables != 'undefined' ) {
                        loaded_tables = syncpilot_loaded_tables;
                    }

                    var table_select = document.createElement( 'select' );

                    $( table_select ).attr( {
                        multiple : 'multiple',
                        name     : 'select_tables[]',
                        id       : 'select-tables',
                        class    : 'multiselect'
                    } );

                    $.each( connection_data.tables, function ( index, value ) {

                        var selected = $.inArray( value, loaded_tables );

                        if ( selected != -1 ) {
                            selected = ' selected="selected" ';
                        } else {
                            selected = ' ';
                        }

                        $( table_select ).append( '<option' + selected + 'value="' +
                            value + '">' + value + ' (' + connection_data.table_sizes_hr[
                            value] + ')</option>' );
                    } );

                    pull_select = table_select;

                    var loaded_post_types = '';

                    if ( syncpilot_default_profile == false && typeof syncpilot_loaded_post_types != 'undefined' ) {
                        if ( typeof data.select_post_types != 'undefined' ) {
                            $( '#exclude-post-types' ).attr( 'checked', 'checked' );
                            $( '.post-type-select-wrap' ).show();
                            loaded_post_types = data.select_post_types;
                        } else {
                            loaded_post_types = syncpilot_loaded_post_types;
                        }
                    }

                    var post_type_select = document.createElement( 'select' );

                    $( post_type_select ).attr( {
                        multiple : 'multiple',
                        name     : 'select_post_types[]',
                        id       : 'select-post-types',
                        class    : 'multiselect'
                    } );

                    $.each( connection_data.post_types, function ( index, value ) {

                        var selected = $.inArray( value, loaded_post_types );

                        if ( selected != -1 || ( syncpilot_convert_exclude_revisions ==
                            true && value != 'revision' ) ) {
                            selected = ' selected="selected" ';
                        } else {
                            selected = ' ';
                        }

                        $( post_type_select ).append( '<option' + selected + 'value="' +
                            value + '">' + value + '</option>' );
                    } );

                    pull_post_type_select = post_type_select;

                    var loaded_tables_backup = '';

                    if ( syncpilot_default_profile == false && typeof syncpilot_loaded_tables_backup != 'undefined' ) {
                        loaded_tables_backup = syncpilot_loaded_tables_backup;
                    }

                    var table_select_backup = document.createElement( 'select' );

                    $( table_select_backup ).attr( {
                        multiple : 'multiple',
                        name     : 'select_backup[]',
                        id       : 'select-backup',
                        class    : 'multiselect'
                    } );

                    $.each( connection_data.tables, function ( index, value ) {

                        var selected = $.inArray( value, loaded_tables_backup );

                        if ( selected != -1 ) {
                            selected = ' selected="selected" ';
                        } else {
                            selected = ' ';
                        }

                        $( table_select_backup ).append( '<option' + selected +
                            'value="' + value + '">' + value + ' (' + connection_data
                            .table_sizes_hr[value] + ')</option>' );
                    } );

                    push_select_backup = table_select_backup;

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

                    media_files_connection_verified( connection_data );
                }
            } );
        }

        init_diagnostics();
        init_form_ui();
        init_multiselect();
        init_replace_rows();
        init_profiles();
        init_api_key();
        init_settings();
        init_tabs();
        init_migration();

        // AJAX migrate button
        $( '.migrate-db-button' ).click( run_migration );

        /**
         * The whole migration, from the click on "Migrate DB" / "Export" / "Pull" / "Push": checks the form, saves the
         * profile when asked, opens the progress box, decides which tables are migrated and sends the request that starts
         * the migration (modules/migration.js: the request, then the tables one after the other); after the last one the media
         * files, the finalizing and the end follow as steps (execute_next_step, call_stack)
         * @since   0.2.6
         * @param   {Event} event  The click; `this` is the button
         */
        function run_migration( event ) {

            $( this ).blur();
            event.preventDefault();

            if ( ! form_is_valid() ) {
                return;
            }

            // also save profile
            if ( $( '#save-migration-profile' ).is( ':checked' ) ) {

                if ( ! profile_has_name() ) {
                    return;
                }

                var create_new_profile = is_new_profile();
                var profile_name       = $( '.create-new-profile' ).val();

                send_profile( function ( data ) {

                    if ( create_new_profile ) {
                        add_profile_to_list( data, profile_name );
                        $( '.create-new-profile' ).val( '' );
                    }
                } );
            }

            state.form_data = $( '#migrate-form' ).serialize();

            create_overlay();

            state.migration_intent = $( 'input[name=action]:checked' ).val();

            state.stage = 'backup';

            if ( state.migration_intent == 'savefile' ) {
                state.stage = 'migrate';
            }

            if ( $( '#create-backup' ).is( ':checked' ) == false ) {
                state.stage = 'migrate';
            }

            var connection_info = $.trim( $( '.pull-push-connection-info' ).val() )
                .split( '\n' );

            state.remote_site = connection_info[0];
            state.secret_key  = connection_info[1];

            var static_migration_label = '';

            state.completed_msg = syncpilot_i10n.exporting_complete;

            if ( state.migration_intent == 'savefile' ) {
                static_migration_label = syncpilot_i10n.exporting_please_wait;
            } else {
                static_migration_label = get_default_profile_name( state.remote_site,
                    state.migration_intent, true ) + ', ' + syncpilot_i10n.please_wait;

                state.completed_msg = get_default_profile_name( state.remote_site,
                    state.migration_intent, true ) + ' ' + syncpilot_i10n.complete;
            }

            show_progress_box( progress_content_original, static_migration_label );

            var table_rows    = choose_tables( state.stage );
            var table_details = draw_table_chunks( state.tables_to_migrate, table_rows );
            var total_size    = table_details[1];

            table_rows = table_details[0];

            slide_in_progress_box();

            setup_counter();
            state.currently_migrating = true;

            initiate_migration( table_rows, total_size );
        }

        migration_complete_events = function () {

            if ( false == migration_error ) {
                if ( non_fatal_errors == '' ) {
                    if ( 'savefile' != state.migration_intent && true == $( '#save_computer' )
                        .is( ':checked' ) ) {
                        $( '.progress-text' ).css( 'visibility', 'hidden' );
                    }

                    $( '.progress-title' ).html( state.completed_msg ).append(
                        '<div class="dashicons dashicons-yes"></div>' );
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
            non_fatal_errors          = '';

            $( '.progress-label' ).remove();
            $( '.migration-progress-ajax-spinner' ).remove();
            $( '.close-progress-content' ).show();
            $( '#overlay' ).css( 'cursor', 'pointer' );
            clearInterval( state.elapsed_interval );
        };

        migration_complete = function () {

            $( '.migration-controls' ).fadeOut();

            if ( state.migration_intent == 'savefile' ) {
                state.currently_migrating       = false;

                var migrate_complete_text = syncpilot_i10n.migration_complete;

                if ( $( '#save_computer' ).is( ':checked' ) ) {
                    var url = syncpilot_this_download_url + encodeURIComponent( state.dump_filename );

                    if ( $( '#gzip_file' ).is( ':checked' ) ) {
                        url += '&gzip=1';
                    }

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

            } else { // rename temp tables, delete old tables
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
                    },
                    error : function ( jqXHR, textStatus, errorThrown ) {

                        state.doing_ajax = false;

                        $( '.progress-title' ).html( syncpilot_i10n.migration_failed );
                        $( '.progress-text' ).html( syncpilot_i10n.finalize_tables_problem );
                        $( '.progress-text' ).addClass( 'migration-error' );

                        if ( window.console && console.log )
                            console.log( 'SyncPilot: finalize', textStatus, errorThrown, jqXHR.responseText );

                        migration_error = true;
                        migration_complete_events();

                        return;
                    },
                    success : function ( data ) {

                        state.doing_ajax = false;

                        if ( $.trim( data ) != '' ) {
                            $( '.progress-title' ).html( syncpilot_i10n.migration_failed );
                            $( '.progress-text' ).html( syncpilot_sanitize_html( data ) );
                            $( '.progress-text' ).addClass( 'migration-error' );
                            migration_error = true;
                            migration_complete_events();

                            return;
                        }

                        next_step_in_migration = {
                            fn : run_next_step
                        };

                        execute_next_step();
                    }
                } );
            }
        };

        // close progress pop up once migration is completed
        $( 'body' ).on( 'click', '.close-progress-content-button', function ( e ) {
            hide_overlay();
        } );

        $( 'body' ).on( 'click', '#overlay', function () {
            if ( state.migration_completed == true ) {
                hide_overlay();
            }
        } );

        function hide_overlay() {

            var height = $( '.progress-content' ).outerHeight();

            $( '.progress-content' ).animate( {
                'top' : '-' + height + 'px'
            }, 400, 'swing', function () {

                $( '#overlay' ).remove();
                $( '.progress-content' ).remove();
            } );

            state.migration_completed = false;
        }

        // AJAX save button profile
        $( '.save-settings-button' ).click( function ( event ) {

            var $button = $( this );

            $button.blur();
            event.preventDefault();

            if ( state.doing_save_profile ) {
                return;
            }

            if ( ! tables_are_chosen() || ! profile_has_name() ) {
                return;
            }

            var create_new_profile = is_new_profile();
            var profile_name       = $( '.create-new-profile' ).val();

            state.doing_save_profile = true;

            $button.after( '<img src="' + spinner_url +
                '" alt="" class="save-profile-ajax-spinner general-spinner" />' );

            $button.attr( 'disabled', 'disabled' );

            // the same after a failed request and after a saved one: the button works again, "saved" fades out
            function profile_request_ended() {

                $button.removeAttr( 'disabled' );
                $( '.save-profile-ajax-spinner' ).remove();

                $button.after(
                    '<span class="ajax-success-msg">' + syncpilot_i10n.saved +
                    '</span>' );

                $( '.ajax-success-msg' ).fadeOut( 2000, function () {
                    $( this ).remove();
                } );

                state.doing_save_profile = false;
            }

            send_profile( function ( data ) {

                profile_request_ended();
                $( '.create-new-profile' ).val( '' );

                if ( create_new_profile ) {
                    add_profile_to_list( data, profile_name );
                }
            }, profile_request_ended );
        } );

        // progress label updating
        $( 'body' ).on( 'mousemove', '.progress-chunk-hover', function ( e ) {

            mX           = e.pageX;
            offset       = $( '.progress-bar-wrapper' ).offset();
            label_offset = $( '.progress-label' ).outerWidth() / 2;
            mX           = ( mX - offset.left ) - label_offset;
            $( '.progress-label' ).css( 'left', mX + 'px' );
            $( '.progress-label' ).html( $( this ).attr( 'data-table' ) );
        } );

        // show / hide progress lavel on hover
        $( 'body' ).on( 'mouseenter mouseleave', '.progress-chunk-hover', function ( event ) {

            if ( event.type === 'mouseenter' ) {
                $( '.progress-label' ).addClass( 'label-visible' );
            } else {
                $( '.progress-label' ).removeClass( 'label-visible' );
            }
        } );

        // move around textarea depending on whether or not the push/pull options are selected
        connection_info_box = $( '.connection-info-wrapper' );
        move_connection_info_box();

        $( '.migrate-selection.option-group input[type=radio]' ).change( function () {

            move_connection_info_box();

            if ( state.connection_established ) {
                change_replace_values();
            }
        } );

        // save file (export) / push / pull special conditions
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

            var connection_info = $.trim( $( '.pull-push-connection-info' ).val() ).split(
                '\n' );

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

                    if ( state.show_prefix_notice == true ) {
                        $( '.prefix-notice.pull' ).show();
                    }

                    if ( state.show_ssl_notice == true ) {
                        $( '.ssl-notice' ).show();
                    }

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

                    if ( state.show_prefix_notice == true ) {
                        $( '.prefix-notice.push' ).show();
                    }

                    if ( state.show_ssl_notice == true ) {
                        $( '.ssl-notice' ).show();
                    }

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

                if ( state.profile_name_edited == false ) {
                    $( '.create-new-profile' ).val( '' );
                }

                $( '.backup-options' ).hide();
                $( '.keep-active-plugins' ).hide();

                if ( false == syncpilot_write_permission ) {
                    $( '.directory-permission-notice' ).show();
                    $( '.step-two' ).hide();
                }
            }

            media_files_connection_box_moved();
        }

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

            if ( window.location.hash ) {
                var hash = window.location.hash.substring( 1 );
            }

            $( this ).attr( 'href', $( this ).attr( 'href' ) + '&hash=' + hash );
        } );

        // fired when the connection info box changes (e.g. gets pasted into)
        function connection_box_changed( data ) {

            var $this = $( '.pull-push-connection-info' );

            if ( state.doing_ajax || $( $this ).hasClass( 'temp-disabled' ) ) {
                return;
            }

            var data = $( '.pull-push-connection-info' ).val();

            var connection_info = $.trim( data ).split( '\n' );
            var error           = false;
            var error_message   = '';

            if ( connection_info == '' ) {
                error         = true;
                error_message = syncpilot_i10n.connection_info_missing;
            }

            if ( connection_info.length != 2 && ! error ) {
                error         = true;
                error_message = syncpilot_i10n.connection_info_incorrect;
            }

            if ( ! error && ! validate_url( connection_info[0] ) ) {
                error         = true;
                error_message = syncpilot_i10n.connection_info_url_invalid;
            }

            if ( ! error && connection_info[1].length != 32 ) {
                error         = true;
                error_message = syncpilot_i10n.connection_info_key_invalid;
            }

            if ( ! error && connection_info[0] == syncpilot_connection_info[0] ) {
                error         = true;
                error_message = syncpilot_i10n.connection_info_local_url;
            }

            if ( ! error && connection_info[1] == syncpilot_connection_info[1] ) {
                error         = true;
                error_message = syncpilot_i10n.connection_info_local_key;
            }

            if ( error ) {
                $( '.connection-status' ).html( error_message );

                $( '.connection-status' ).addClass(
                    'notification-message error-notice migration-error' );

                return;
            }

            if ( syncpilot_openssl_available == false ) {
                connection_info[0] = connection_info[0].replace( 'https://', 'http://' );

                var new_connection_info_contents = connection_info[0] + '\n' + connection_info[1];

                $( '.pull-push-connection-info' ).val( new_connection_info_contents );
            }

            state.show_prefix_notice = false;
            state.doing_ajax         = true;
            disable_export_type_controls();

            if ( $( '.basic-access-auth-wrapper' ).is( ':visible' ) ) {
                connection_info[0] = connection_info[0].replace( /\/\/(.*)@/, '//' );

                connection_info[0] = connection_info[0].replace( '//', '//' +
                    encodeURIComponent( $.trim( $( '.auth-username' ).val() ) ) + ':' +
                    encodeURIComponent( $.trim( $( '.auth-password' ).val() ) ) + '@' );

                var new_connection_info_contents = connection_info[0] + '\n' + connection_info[1];

                $( '.pull-push-connection-info' ).val( new_connection_info_contents );
                $( '.basic-access-auth-wrapper' ).hide();
            }

            $( '.step-two' ).hide();
            $( '.ssl-notice' ).hide();
            $( '.prefix-notice' ).hide();
            $( '.connection-status' ).show();

            $( '.connection-status' ).html( syncpilot_i10n.establishing_remote_connection );

            $( '.connection-status' ).removeClass(
                'notification-message error-notice migration-error' );

            $( '.connection-status' ).append( '<img src="' + spinner_url +
                '" alt="" class="ajax-spinner general-spinner" />' );

            var intent = $( 'input[name=action]:checked' ).val();

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
                    intent : intent,
                    nonce  : syncpilot_nonces.verify_connection_to_remote_site,
                },
                error : function ( jqXHR, textStatus, errorThrown ) {

                    $( '.connection-status' ).html( syncpilot_i10n.connection_local_server_problem +
                        ' (#100)' );

                    $( '.connection-status' ).append( '<br /><br />Status: ' + jqXHR.status +
                        ' ' + jqXHR.statusText + '<br /><br />Response:<br />' + jqXHR.responseText );

                    $( '.connection-status' ).addClass(
                        'notification-message error-notice migration-error' );

                    $( '.ajax-spinner' ).remove();
                    state.doing_ajax = false;
                    enable_export_type_controls();
                },
                success : function ( data ) {

                    $( '.ajax-spinner' ).remove();
                    state.doing_ajax = false;
                    enable_export_type_controls();

                    if ( typeof data.syncpilot_error != 'undefined' && data.syncpilot_error == 1 ) {
                        $( '.connection-status' ).html( syncpilot_sanitize_html( data.body ) );

                        $( '.connection-status' ).addClass(
                            'notification-message error-notice migration-error' );

                        if ( data.body.indexOf( '401 Unauthorized' ) > -1 ) {
                            $( '.basic-access-auth-wrapper' ).show();
                        }

                        return;
                    }

                    var profile_name = get_domain_name( connection_info[0] );

                    $( '.create-new-profile' ).val( profile_name );

                    $( '.pull-push-connection-info' ).addClass( 'temp-disabled' );
                    $( '.pull-push-connection-info' ).attr( 'readonly', 'readonly' );
                    $( '.connect-button' ).hide();

                    $( '.connection-status' ).hide();
                    $( '.step-two' ).show();

                    maybe_show_ssl_warning( connection_info[0], connection_info[1], data.scheme );

                    maybe_show_version_warning( data.plugin_version, connection_info[0] );

                    maybe_show_prefix_notice( data.prefix );

                    state.connection_established = true;
                    connection_data              = data;
                    move_connection_info_box();

                    var table_select = document.createElement( 'select' );

                    $( table_select ).attr( {
                        multiple : 'multiple',
                        name     : 'select_tables[]',
                        id       : 'select-tables',
                        class    : 'multiselect'
                    } );

                    $.each( connection_data.tables, function ( index, value ) {
                        $( table_select ).append( '<option value="' + value + '">' +
                            value + ' (' + connection_data.table_sizes_hr[value] +
                            ')</option>' );
                    } );

                    pull_select        = table_select;
                    push_select_backup = $( table_select ).clone();

                    $( push_select_backup ).attr( {
                        name : 'select_backup[]',
                        id   : 'select-backup'
                    } );

                    var post_type_select = document.createElement( 'select' );

                    $( post_type_select ).attr( {
                        multiple : 'multiple',
                        name     : 'select_post_types[]',
                        id       : 'select-post-types',
                        class    : 'multiselect'
                    } );

                    $.each( connection_data.post_types, function ( index, value ) {
                        $( post_type_select ).append( '<option value="' + value + '">' +
                            value + '</option>' );
                    } );

                    pull_post_type_select = post_type_select;

                    if ( $( '#pull' ).is( ':checked' ) ) {
                        $( '#new-url' ).val( remove_protocol( syncpilot_this_url ) );
                        $( '#new-path' ).val( syncpilot_this_path );

                        if ( syncpilot_is_multisite == true ) {
                            $( '#new-domain' ).val( syncpilot_this_domain );
                        }

                        $( '#old-url' ).val( remove_protocol( data.url ) );
                        $( '#old-path' ).val( data.path );
                        $( '#select-tables' ).remove();
                        $( '.select-tables-wrap' ).prepend( pull_select );
                        $( '#select-post-types' ).remove();
                        $( '.select-post-types-wrap' ).prepend( pull_post_type_select );
                        $( '.table-prefix' ).text( data.prefix );
                        $( '.uploads-dir' ).html( syncpilot_this_uploads_dir );
                    } else {
                        $( '#select-backup' ).remove();
                        $( '.backup-tables-wrap' ).prepend( push_select_backup );
                        $( '#new-url' ).val( remove_protocol( data.url ) );
                        $( '#new-path' ).val( data.path );
                    }

                    if ( $( '#pull' ).is( ':checked' ) ) {
                        add_scheme_row( data.url, syncpilot_this_url );
                    } else {
                        add_scheme_row( syncpilot_this_url, data.url );
                    }

                    next_step_in_migration = {
                        fn   : media_files_connection_verified,
                        args : [ connection_data ]
                    };

                    execute_next_step();
                }
            } );
        }

        $( 'body' ).on( 'click', '.pause-resume', function () {

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
        } );

        $( 'body' ).on( 'click', '.cancel', function () {

            state.migration_cancelled = true;
            state.migration_paused    = false;
            $( '.progress-text' ).html( syncpilot_i10n.completing_current_request );
            $( '.progress-title' ).html( syncpilot_i10n.cancelling_migration );
            $( '.migration-controls' ).fadeOut();
            $( '.migration-progress-ajax-spinner' ).show();

            if ( false == state.doing_ajax ) {
                execute_next_step();
            }
        } );

        execute_next_step = function () {

            if ( true == state.migration_paused ) {
                $( '.migration-progress-ajax-spinner' ).hide();

                // pause the timer
                clearInterval( state.elapsed_interval );
                $( '.progress-text' ).html( syncpilot_i10n.paused );

                return;
            } else if ( true == state.migration_cancelled ) {
                state.migration_intent = $( 'input[name=action]:checked' ).val();

                if ( 'savefile' == state.migration_intent ) {
                    progress_msg = syncpilot_i10n.removing_local_sql;
                } else if ( 'pull' == state.migration_intent ) {
                    if ( 'backup' == state.stage ) {
                        progress_msg = syncpilot_i10n.removing_local_backup;
                    } else {
                        progress_msg = syncpilot_i10n.removing_local_temp_tables;
                    }
                } else if ( 'push' == state.migration_intent ) {
                    if ( 'backup' == state.stage ) {
                        progress_msg = syncpilot_i10n.removing_remote_sql;
                    } else {
                        progress_msg = syncpilot_i10n.removing_remote_temp_tables;
                    }
                }

                $( '.progress-text' ).html( progress_msg );

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
                if ( connection_data ) {
                    request_data.temp_prefix = connection_data.temp_prefix;
                }

                $.ajax( {
                    url      : ajaxurl,
                    type     : 'POST',
                    dataType : 'text',
                    cache    : false,
                    data     : request_data,
                    error    : function ( jqXHR, textStatus, errorThrown ) {

                        $( '.progress-title' ).html( syncpilot_i10n.migration_cancellation_failed );
                        $( '.progress-text' ).html( syncpilot_i10n.manually_remove_temp_files );

                        $( '.progress-text' ).append( '<br /><br />Status: ' + jqXHR.status +
                            ' ' + jqXHR.statusText + '<br /><br />Response:<br />' + jqXHR.responseText );

                        $( '.progress-text' ).addClass( 'migration-error' );
                        console.log( jqXHR );
                        console.log( textStatus );
                        console.log( errorThrown );
                        migration_error = true;
                        migration_complete_events();

                        return;
                    },
                    success : function ( data ) {

                        state.doing_ajax = false;
                        data             = $.trim( data );

                        if ( data != '' ) {
                            $( '.progress-title' ).html( syncpilot_i10n.migration_cancellation_failed );
                            $( '.progress-text' ).html( syncpilot_sanitize_html( data ) );
                            $( '.progress-text' ).addClass( 'migration-error' );
                            migration_error = true;
                            migration_complete_events();

                            return;
                        }

                        state.completed_msg = syncpilot_i10n.migration_cancelled;
                        $( '.progress-text' ).hide();
                        migration_complete_events();
                    }
                } );
            } else {
                next_step_in_migration.fn.apply( null, next_step_in_migration.args );
            }
        };
    } );
} )( jQuery );

function validate_url( url ) {
    return /^([a-z]([a-z]|\d|\+|-|\.)*):(\/\/(((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:)*@)?((\[(|(v[\da-f]{1,}\.(([a-z]|\d|-|\.|_|~)|[!\$&'\(\)\*\+,;=]|:)+))\])|((\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5]))|(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=])*)(:\d*)?)(\/(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*|(\/((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)+(\/(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*)?)|((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)+(\/(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*)|((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)){0})(\?((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)|[\uE000-\uF8FF]|\/|\?)*)?(\#((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)|\/|\?)*)?$/i
        .test( url );
}
