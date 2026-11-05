// The checks of the migrate form before something is sent: the tables, and the new URL and path.

const $ = jQuery;

/**
 * Some tables are chosen when only the selected tables are migrated or saved in a profile; if not, the message says so
 * (jQuery 3 returns an empty array for a multiple select with nothing selected, older versions null)
 * @since   0.2.6
 * @return  {boolean}  True when the choice of the tables is fine
 */
export function tables_are_chosen() {

    if ( $( '#migrate-selected' ).is( ':checked' ) && ! ( $( '#select-tables' ).val() || [] ).length ) {
        syncpilot_alert( syncpilot_i10n.please_select_one_table );

        return false;
    }

    return true;
}

/**
 * The checks before a migration starts: the tables are chosen, and the new URL and the new file path are filled in (the
 * field that is missing gets the warning and the focus)
 * @since   0.2.6
 * @return  {boolean}  True when the migration may start
 */
export function form_is_valid() {

    if ( ! tables_are_chosen() ) {
        return false;
    }

    var new_url_missing       = false;
    var new_file_path_missing = false;

    if ( $( '#new-url' ).length && ! $( '#new-url' ).val() ) {
        $( '#new-url-missing-warning' ).show();
        $( '#new-url' ).focus();
        $( 'html,body' ).scrollTop( 0 );
        new_url_missing = true;
    }

    if ( $( '#new-path' ).length && ! $( '#new-path' ).val() ) {
        $( '#new-path-missing-warning' ).show();

        if ( false == new_url_missing ) {
            $( '#new-path' ).focus();
            $( 'html,body' ).scrollTop( 0 );
        }

        new_file_path_missing = true;
    }

    return ! ( new_url_missing || new_file_path_missing );
}
