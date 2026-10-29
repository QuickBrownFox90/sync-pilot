// global vars
var hooks                  = [];
var call_stack             = [];
var non_fatal_errors       = '';
var migration_error        = false;
var connection_data        = null;
var next_step_in_migration = null;

function syncpilot_call_next_hook() {

    if ( ! call_stack.length )
        call_stack = hooks;

    var func = call_stack[0];

    call_stack.shift();

    window[func](); // Uses the string from the array to call the function of the same name
}

// Messages of the other site are shown with .html(). Only harmless markup stays, everything else is removed or
// shown as text. The parser is DOMParser: it neither runs scripts nor loads images or event handlers.
function syncpilot_sanitize_html( html ) {

    var allowed = {
        A      : [ 'href', 'class', 'target' ],
        BR     : [],
        STRONG : [],
        B      : [],
        EM     : [],
        I      : [],
        U      : [],
        CODE   : [],
        P      : [],
        UL     : [],
        LI     : [],
        H3     : [],
        SPAN   : [ 'class' ],
        DIV    : [ 'class' ]
    };

    var doc = new DOMParser().parseFromString( '<body>' + String( html ), 'text/html' );

    function clean( node ) {

        Array.prototype.slice.call( node.childNodes ).forEach( function ( child ) {

            if ( 3 === child.nodeType )
                return;

            if ( 1 !== child.nodeType ) {
                node.removeChild( child );

                return;
            }

            if ( ! allowed.hasOwnProperty( child.tagName ) ) {

                // script, style, img, iframe, form …: keep the text, drop the element
                if ( 'SCRIPT' === child.tagName || 'STYLE' === child.tagName )
                    node.removeChild( child );
                else
                    node.replaceChild( doc.createTextNode( child.textContent ), child );

                return;
            }

            Array.prototype.slice.call( child.attributes ).forEach( function ( attribute ) {

                var name = attribute.name.toLowerCase();

                if ( -1 === allowed[ child.tagName ].indexOf( name ) )
                    child.removeAttribute( attribute.name );
            } );

            if ( 'A' === child.tagName ) {

                var href = child.getAttribute( 'href' ) || '';

                if ( ! /^(#|\/|https?:\/\/)/i.test( href ) )
                    child.removeAttribute( 'href' );

                child.setAttribute( 'rel', 'noopener noreferrer' );
            }

            clean( child );
        } );
    }

    clean( doc.body );

    return doc.body.innerHTML;
}

function syncpilot_add_commas( number_string ) {

    number_string += '';

    x  = number_string.split( '.' );
    x1 = x[0];
    x2 = x.length > 1 ? '.' + x[1] : '';

    var rgx = /(\d+)(\d{3})/;

    while ( rgx.test( x1 ) )
        x1 = x1.replace( rgx, '$1' + ',' + '$2' );

    return x1 + x2;
}

function syncpilot_parse_json( maybe_json ) {

    try {
        var json_object = jQuery.parseJSON( maybe_json );
    }

    catch ( e ) {
        // we simply return false here because the json data itself will never just contain a value of "false"
        return false;
    }

    return json_object;
}
