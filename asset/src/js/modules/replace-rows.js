// The table of find and replace rows: add, remove, sort.

const $ = jQuery;

export function init_replace_rows() {

    // repeatable fields
    $( 'body' ).on( 'click', '.add-row', function () {
        $( this ).parents( 'tr' ).before( $( '.original-repeatable-field' ).clone()
            .removeClass( 'original-repeatable-field' ) );
    } );

    // repeatable fields
    $( 'body' ).on( 'click', '.replace-remove-row', function () {

        $( this ).parents( 'tr' ).remove();

        if ( $( '.replace-row' ).length < 2 ) {
            $( '.no-replaces-message' ).show();
        }
    } );

    $( '.add-replace' ).click( function () {

        $( '.replace-fields' ).prepend( $( '.original-repeatable-field' ).clone()
            .removeClass( 'original-repeatable-field' ) );

        $( '.no-replaces-message' ).hide();
    } );

    $( 'body' ).on( 'mouseenter mouseleave', '#find-and-replace-sort tbody tr.replace-row',
        function ( event ) {

            if ( event.type === 'mouseenter' ) {
                $( '.replace-remove-row', this ).show();
            } else {
                $( '.replace-remove-row', this ).hide();
            }
        } );

    $( '#find-and-replace-sort tbody' ).sortable( {
        items  : '> tr:not(.pin)',
        handle : 'td:first',
        start  : function () {

            $( '.sort-handle' ).css( 'cursor', '-webkit-grabbing' );
            $( '.sort-handle' ).css( 'cursor', '-moz-grabbing' );
        },
        stop : function () {

            $( '.sort-handle' ).css( 'cursor', '-webkit-grab' );
            $( '.sort-handle' ).css( 'cursor', '-moz-grab' );
        }
    } );
}
