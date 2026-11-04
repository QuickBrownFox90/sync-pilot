// The address of the spinner image of WordPress (the double-size one for high resolution screens), for the
// requests that show one.

const admin_url = ajaxurl.replace( '/admin-ajax.php', '' );

export let spinner_url = admin_url + '/images/wpspin_light';

if ( window.devicePixelRatio >= 2 ) {
    spinner_url += '-2x';
}

spinner_url += '.gif';
