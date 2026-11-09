import { state } from './modules/state.js';
import { spinner_url } from './modules/spinner.js';
import { setup_counter } from './modules/timer.js';
import { init_slider } from './modules/slider.js';
import { init_plugin_compatibility } from './modules/plugin-compatibility.js';
import { init_diagnostics } from './modules/diagnostics.js';
import { init_form_ui } from './modules/form-ui.js';
import { init_multiselect } from './modules/multiselect.js';
import { init_replace_rows } from './modules/replace-rows.js';
import { init_profiles } from './modules/profiles.js';
import { init_api_key } from './modules/api-key.js';
import { init_settings } from './modules/settings.js';
import { init_tabs } from './modules/tabs.js';
import { tables_are_chosen, form_is_valid } from './modules/form-check.js';
import { choose_tables, draw_table_chunks, create_overlay, show_progress_box, slide_in_progress_box } from './modules/progress.js';
import { profile_has_name, is_new_profile, send_profile, add_profile_to_list } from './modules/save-profile.js';
import { prepare_connection, init_connection } from './modules/connection.js';
import { init_migration, initiate_migration } from './modules/migration.js';
import { init_migration_end } from './modules/migration-end.js';
import { init_migration_control } from './modules/migration-control.js';
import { get_default_profile_name } from './modules/helpers.js';

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

        prepare_connection();
        init_diagnostics();
        init_form_ui();
        init_multiselect();
        init_replace_rows();
        init_profiles();
        init_api_key();
        init_settings();
        init_tabs();
        init_migration();
        init_migration_end();
        init_migration_control();

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

        // the box with the connection info, the buttons and links around it
        init_connection();
    } );
} )( jQuery );
