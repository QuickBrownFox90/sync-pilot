// The table and post type lists: select, deselect and invert all, and the switches that show them.

const $ = jQuery;

export function init_multiselect() {

    // select all tables
    $( '.multiselect-select-all' ).click( function () {

        var multiselect = $( this ).parents( '.select-wrap' ).children( '.multiselect' );

        $( multiselect ).focus();
        $( 'option', multiselect ).attr( 'selected', 1 );
    } );

    // deselect all tables
    $( '.multiselect-deselect-all' ).click( function () {

        var multiselect = $( this ).parents( '.select-wrap' ).children( '.multiselect' );

        $( multiselect ).focus();
        $( 'option', multiselect ).removeAttr( 'selected' );
    } );

    // invert table selection
    $( '.multiselect-invert-selection' ).click( function () {

        var multiselect = $( this ).parents( '.select-wrap' ).children( '.multiselect' );

        $( multiselect ).focus();

        $( 'option', multiselect ).each( function () {
            $( this ).attr( 'selected', ! $( this ).attr( 'selected' ) );
        } );
    } );

    // show / hide table select box when specific settings change
    $( 'input.multiselect-toggle' ).change( function () {
        $( this ).parents( '.expandable-content' ).children( '.select-wrap' ).toggle();
    } );

    $( '.show-multiselect' ).each( function () {

        if ( $( this ).is( ':checked' ) ) {
            $( this ).parents( '.option-section' )
                .children( '.header-expand-collapse' )
                .children( '.expand-collapse-arrow' )
                .removeClass( 'collapsed' );

            $( this ).parents( '.expandable-content' ).show();
            $( this ).parents( '.expandable-content' ).children( '.select-wrap' ).toggle();
        }
    } );

    $( 'input[name=backup_option]' ).change( function () {

        $( '.backup-tables-wrap' ).hide();

        if ( $( this ).val() == 'backup_manual_select' ) {
            $( '.backup-tables-wrap' ).show();
        }
    } );

    if ( $( '#backup-manual-select' ).is( ':checked' ) ) {
        $( '.backup-tables-wrap' ).show();
    }
}
