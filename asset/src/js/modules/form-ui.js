// The small behaviours of the form: the option groups that open their lists, the areas that expand and collapse, the
// bubbles with the help texts.

const $ = jQuery;

export function init_form_ui() {

    // add to <a> tags which act as JS event buttons, will not jump page to top
    // and will deselect the button
    $( '.js-action-link' ).click( function ( e ) {

        e.preventDefault();
        $( this ).blur();
    } );

    // on option select hide all "advanced" option divs and show the correct div
    // for the option selected
    $( '.option-group input[type=radio]' ).change( function () {

        var group = $( this ).closest( '.option-group' );

        $( 'ul', group ).hide();

        var parent = $( this ).closest( 'li' );

        $( 'ul', parent ).show();
    } );

    // on page load, expand hidden divs for selected options (browser form
    // cache)
    $( '.option-group' ).each( function () {

        $( '.option-group input[type=radio]' ).each( function () {

            if ( $( this ).is( ':checked' ) ) {
                var parent = $( this ).closest( 'li' );

                $( 'ul', parent ).show();
            }
        } );
    } );

    // expand and collapse content on click
    $( '.header-expand-collapse' ).click( function () {

        if ( $( '.expand-collapse-arrow', this ).hasClass( 'collapsed' ) ) {
            $( '.expand-collapse-arrow', this ).removeClass( 'collapsed' );
            $( this ).next().show();
        } else {
            $( '.expand-collapse-arrow', this ).addClass( 'collapsed' );
            $( this ).next().hide();
        }
    } );

    $( '.checkbox-label input[type=checkbox]' ).change( function () {

        if ( $( this ).is( ':checked' ) ) {
            $( this ).parent().next().show();
        } else {
            $( this ).parent().next().hide();
        }
    } );

    // special expand and collapse content on click for save migration profile
    $( '#save-migration-profile' ).change( function () {

        if ( $( this ).is( ':checked' ) ) {
            $( '.save-settings-button' ).show();
            $( '.migrate-db .button-primary' ).val( syncpilot_i10n.migrate_db_save );
        } else {
            $( '.save-settings-button' ).hide();
            $( '.migrate-db .button-primary' ).val( syncpilot_i10n.migrate_db );
        }
    } );

    if ( $( '#save-migration-profile' ).is( ':checked' ) ) {
        $( '.save-settings-button' ).show();
        $( '.migrate-db .button-primary' ).val( syncpilot_i10n.migrate_db_save );
    }

    $( '.checkbox-label input[type=checkbox]' ).each( function () {
        if ( $( this ).is( ':checked' ) ) {
            $( this ).parent().next().show();
        }
    } );

    $( '#new-url' ).change( function () {
        $( '#new-url-missing-warning' ).hide();
    } );

    $( '#new-path' ).change( function () {
        $( '#new-path-missing-warning' ).hide();
    } );

    // show / hide GUID helper description
    $( '.general-helper' ).click( function ( e ) {

        var icon = $( this ),
            bubble = $( this ).next();

        // Close any that are already open
        $( '.helper-message' ).not( bubble ).hide();

        var position = icon.position();

        if ( bubble.hasClass( 'bottom' ) ) {
            bubble.css( {
                'left' : ( position.left - bubble.width() / 2 ) + 'px',
                'top'  : ( position.top + icon.height() + 9 ) + 'px'
            } );
        } else {
            bubble.css( {
                'left' : ( position.left + icon.width() + 9 ) + 'px',
                'top'  : ( position.top + icon.height() / 2 - 18 ) + 'px'
            } );
        }

        bubble.toggle();
        e.stopPropagation();
    } );

    $( 'body' ).click( function () {
        $( '.helper-message' ).hide();
    } );

    $( '.helper-message' ).click( function ( e ) {
        e.stopPropagation();
    } );
}
