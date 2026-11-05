// Saving the settings of the form as a profile: what the two places that do it (the button "Save Profile" and the
// migration with the box "Save Migration Profile" checked) have in common.

const $ = jQuery;

/**
 * A new profile needs a name; if it has none, the message says so and the field gets the focus
 * @since   0.2.6
 * @return  {boolean}  True when the profile may be saved
 */
export function profile_has_name() {

    if ( $.trim( $( '.create-new-profile' ).val() ) == '' && $( '#create_new' ).is( ':checked' ) ) {
        syncpilot_alert( syncpilot_i10n.enter_name_for_profile );
        $( '.create-new-profile' ).focus();

        return false;
    }

    return true;
}

/**
 * Is a new profile created (and not an existing one replaced)?
 * @since   0.2.6
 * @return  {boolean}
 */
export function is_new_profile() {
    return $( '#create_new' ).is( ':checked' );
}

/**
 * Send the form to the server as a profile. A failed request shows the message first, then calls on_error
 * @since   0.2.6
 * @param   {function} on_success  Called with the answer of the server: the number of the profile
 * @param   {function} on_error    Called after the message (optional)
 */
export function send_profile( on_success, on_error ) {

    $.ajax( {
        url      : ajaxurl,
        type     : 'POST',
        dataType : 'text',
        cache    : false,
        data     : {
            action  : 'syncpilot_save_profile',
            profile : $( '#migrate-form' ).serialize(),
            nonce   : syncpilot_nonces.save_profile,
        },
        error : function ( jqXHR, textStatus, errorThrown ) {

            syncpilot_alert( syncpilot_i10n.save_profile_problem );

            if ( on_error ) {
                on_error();
            }
        },
        success : on_success
    } );
}

/**
 * List a profile that was just created in the form, before "Create new profile", and select it
 * @since   0.2.6
 * @param   {string} data  The answer of the server: the number of the profile (it starts at 0)
 * @param   {string} name  The name of the profile
 */
export function add_profile_to_list( data, name ) {

    var new_profile_key = parseInt( data, 10 );
    var new_profile_id  = new_profile_key + 1;
    var new_li          =
        '<li><span style="display: none;" class="delete-profile" data-profile-id="' +
        new_profile_id + '"></span><label for="profile-' +
        new_profile_id + '"><input id="profile-' + new_profile_id +
        '" value="' + new_profile_key +
        '" name="save_migration_profile_option" type="radio"> ' +
        name + '</label></li>';

    $( '#create_new' ).parents( 'li' ).before( new_li );
    $( '#profile-' + new_profile_id ).attr( 'checked', 'checked' );
}
