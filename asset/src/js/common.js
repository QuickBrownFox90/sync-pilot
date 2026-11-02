// global vars
var call_stack             = [];
var non_fatal_errors       = '';
var migration_error        = false;
var connection_data        = null;
var next_step_in_migration = null;

// What runs after the last table of a migration is a list of functions in call_stack (script.js fills it): the media
// files if they are chosen, then the end of the migration. Every step ends by calling this function for the next one.
function run_next_step() {

    var step = call_stack.shift();

    if ( 'function' === typeof step )
        step();
}

// Replacement for alert() and confirm(): one <dialog> element for the whole page. The text is set as text, so a message
// of the other site can never bring markup into the page. Browsers without <dialog> fall back to alert() / confirm().
function syncpilot_dialog( text, on_confirm, on_cancel ) {

    var is_confirm = ( 'function' === typeof on_confirm );
    var l10n       = window.syncpilot_i10n || {};
    var dialog     = document.getElementById( 'syncpilot-dialog' );

    if ( ! dialog || 'function' !== typeof dialog.showModal ) {

        if ( ! is_confirm ) {
            window.alert( text );

            return;
        }

        if ( window.confirm( text ) )
            on_confirm();

        else if ( 'function' === typeof on_cancel )
            on_cancel();

        return;
    }

    dialog.querySelector( '.syncpilot-dialog-message' ).textContent  = text;
    dialog.querySelector( '.syncpilot-dialog-cancel' ).textContent   = l10n.dialog_cancel || 'Cancel';
    dialog.querySelector( '.syncpilot-dialog-ok' ).textContent       = l10n.dialog_ok || 'OK';
    dialog.querySelector( '.syncpilot-dialog-cancel' ).style.display = is_confirm ? '' : 'none';

    dialog.returnValue = '';

    // one-time handler: the same element is used for every message
    dialog.addEventListener( 'close', function handle_close() {

        dialog.removeEventListener( 'close', handle_close );

        if ( ! is_confirm )
            return;

        if ( 'ok' === dialog.returnValue )
            on_confirm();

        else if ( 'function' === typeof on_cancel )
            on_cancel();
    } );

    dialog.showModal();
    dialog.querySelector( '.syncpilot-dialog-ok' ).focus();
}

function syncpilot_alert( text ) {
    syncpilot_dialog( text );
}

function syncpilot_confirm( text, on_confirm, on_cancel ) {
    syncpilot_dialog( text, on_confirm, on_cancel );
}

// the element is created once the page is ready
document.addEventListener( 'DOMContentLoaded', function () {

    if ( document.getElementById( 'syncpilot-dialog' ) )
        return;

    var dialog       = document.createElement( 'dialog' );

    dialog.id        = 'syncpilot-dialog';
    dialog.className = 'syncpilot-dialog';

    dialog.innerHTML = '<form method="dialog">' +
        '<p class="syncpilot-dialog-message"></p>' +
        '<div class="syncpilot-dialog-buttons">' +
        '<button type="submit" value="cancel" class="button syncpilot-dialog-cancel"></button> ' +
        '<button type="submit" value="ok" class="button button-primary syncpilot-dialog-ok"></button>' +
        '</div></form>';

    document.body.appendChild( dialog );
} );

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

                if ( -1 === allowed[child.tagName].indexOf( name ) )
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
    } catch ( e ) {
        // we simply return false here because the json data itself will never just contain a value of "false"
        return false;
    }

    return json_object;
}
