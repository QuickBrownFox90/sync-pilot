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

/**
 * The scheme of an address: "https" or "http"
 * @since   0.2.7
 * @param   {string} url  An address with the scheme, for example https://example.com
 * @return  {string}
 */
function get_scheme( url ) {

    return /^https:/i.test( url ) ? 'https' : 'http';
}

/**
 * A new profile gets a row for the scheme when the two sites differ (http on one, https on the other): the plain
 * http:// to https:// or the other way round. Every address is turned, not only the one of the receiving site, so the
 * other domains of a multisite follow, and a local site without SSL does not load its own files from https addresses
 * (which the browser blocks). External links, fonts and embeds are turned as well. The row stands behind the rows for the
 * URL and the path. A loaded profile keeps its rows, and a row that was added before is replaced, not doubled
 * @since   0.2.7
 * @param   {string} source_url  The address of the sending site, with the scheme
 * @param   {string} target_url  The address of the receiving site, with the scheme
 */
export function add_scheme_row( source_url, target_url ) {

    $( '.scheme-row' ).remove();

    var from = get_scheme( source_url );
    var to   = get_scheme( target_url );

    if ( ! $( '#new-url' ).val() || ! $( '#old-path' ).length || from == to ) {
        return;
    }

    var row = $( '.original-repeatable-field' ).clone().removeClass( 'original-repeatable-field' ).addClass( 'scheme-row' );

    $( 'input[name="replace_old[]"]', row ).val( from + '://' );
    $( 'input[name="replace_new[]"]', row ).val( to + '://' );

    $( '#old-path' ).parents( 'tr' ).after( row );
}
