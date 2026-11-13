// Helpers of the admin page that depend on nothing but their arguments. They are imported by script.js, which
// esbuild joins with them into one file (npm run build).

export function pad( n, width, z ) {

    z = z || '0';
    n = n + '';

    return n.length >= width ? n : new Array( width - n.length + 1 ).join( z ) +
        n;
}

export function get_intersect( arr1, arr2 ) {

    var r = [],
        o = {}, l = arr2.length,
        i, v;

    for ( i = 0; i < l; i++ )
        o[arr2[i]] = true;

    l = arr1.length;

    for ( i = 0; i < l; i++ ) {
        v = arr1[i];

        if ( v in o )
            r.push( v );
    }

    return r;
}

export function get_query_var( name ) {

    name = name.replace( /[\[]/, '\\\[' ).replace( /[\]]/, '\\\]' );

    var regex = new RegExp( '[\\?&]' + name + '=([^&#]*)' ),
        results = regex.exec( location.search );

    return results == null ? '' : decodeURIComponent( results[1].replace( /\+/g,
        ' ' ) );
}

export function get_domain_name( url ) {

    var temp_url = url;
    var domain = temp_url.replace( /\/\/(.*)@/, '//' ).replace( 'http://', '' ).replace(
        'https://', '' ).replace( 'www.', '' );

    return domain;
}

export function get_default_profile_name( url, intent, ing_suffix ) {

    var domain = get_domain_name( url );

    // title of the progress box: "Pushing to example.com" / "Pulling from example.com" (translatable as a whole)
    if ( ing_suffix ) {
        return ( intent == 'pull' ? syncpilot_i10n.pulling_from : syncpilot_i10n.pushing_to ).replace( '%s', domain );
    }

    var action      = intent.charAt( 0 ).toUpperCase() + intent.slice( 1 );
    var preposition = intent == 'pull' ? 'from' : 'to';

    return action + ' ' + preposition + ' ' + domain;
}

export function remove_protocol( url ) {
    return url.replace( /^https?:/i, '' );
}

/**
 * Did the answer of a failed request come from something else than WordPress? admin-ajax.php sends the header
 * X-Robots-Tag with every answer, also with an error; a firewall or a proxy that answers in its place does not. No answer
 * at all (status 0: no connection, a request that was stopped) is not an answer of anything.
 * @since   0.3.1
 * @param   {object} jqXHR  The request that failed
 * @return  {boolean}
 */
export function answer_not_from_wordpress( jqXHR ) {

    return jqXHR.status > 0 && ! /noindex/i.test( jqXHR.getResponseHeader( 'X-Robots-Tag' ) || '' );
}

/**
 * The reference numbers that the block page of a firewall names (Attack ID, Message ID...), as the text "Attack ID: 1,
 * Message ID: 2". The page is read as a document that does not run anything.
 * @since   0.3.1
 * @param   {string} html  The response
 * @return  {string}       Empty when the page names none
 */
export function block_references( html ) {

    var doc  = new DOMParser().parseFromString( html || '', 'text/html' );

    // every tag is a gap between words (a <br> between "Client IP: ..." and "Attack ID: ..." must not glue them)
    doc.querySelectorAll( 'script, style' ).forEach( function ( el ) { el.remove(); } );
    doc.querySelectorAll( '*' ).forEach( function ( el ) { el.append( ' ' ); el.prepend( ' ' ); } );

    var text = ( doc.body ? doc.body.textContent : '' ).replace( /\s+/g, ' ' );
    var re   = /\b(Attack ID|Message ID|Support ID|Ray ID|Incident ID|Block ID|Event ID|Request ID|Reference(?: number)?)\s*[:#]?\s*((?=[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9-]{5,30})(?![A-Za-z0-9-])/gi;
    var ids  = [];
    var found;

    while ( ( found = re.exec( text ) ) !== null && ids.length < 5 )
        ids.push( found[1] + ': ' + found[2] );

    return ids.join( ', ' );
}

/**
 * The sentence that says a firewall or a proxy has answered instead of WordPress, with the reference numbers of its page;
 * an empty text when the answer came from WordPress. The words of the page itself are never shown.
 * @since   0.3.1
 * @param   {object} jqXHR  The request that failed
 * @return  {string}        Plain text
 */
export function firewall_note( jqXHR ) {

    if ( ! answer_not_from_wordpress( jqXHR ) )
        return '';

    var references = block_references( jqXHR.responseText );

    return syncpilot_i10n.not_from_wordpress + ( references ? ' ' + syncpilot_i10n.block_page_gives.replace( '%s', references ) : '' );
}

// text of the dialog after a failed request: what went wrong and the HTTP status (and, when a firewall or a proxy has
// answered, that and its reference numbers); the response itself goes to the console, it can be a whole HTML page
export function ajax_problem_text( message, jqXHR ) {

    if ( window.console && console.log )
        console.log( 'SyncPilot: ' + message, jqXHR.status, jqXHR.statusText, jqXHR.responseText );

    var note = firewall_note( jqXHR );

    return message + '\n\n' + jqXHR.status + ' ' + jqXHR.statusText + ( note ? '\n\n' + note : '' );
}
