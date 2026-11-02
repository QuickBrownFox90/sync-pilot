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

// text of the dialog after a failed request: what went wrong and the HTTP status; the response itself goes to the
// console, it can be a whole HTML page
export function ajax_problem_text( message, jqXHR ) {

    if ( window.console && console.log )
        console.log( 'SyncPilot: ' + message, jqXHR.status, jqXHR.statusText, jqXHR.responseText );

    return message + '\n\n' + jqXHR.status + ' ' + jqXHR.statusText;
}
