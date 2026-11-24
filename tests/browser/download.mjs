// The download of an export (0.4.4): an export is made through the interface and kept on the server, the link in the box is
// the one that hands it out (the web server serves nothing from the folder): it works once (an export is deleted after
// it was sent), refuses a wrong nonce, names that are not names of an export, and the file cannot be fetched by its address
// in the uploads folder. A second export is downloaded as a gzip file.
//
//   node tests/browser/download.mjs
//
// The tests do not depend on the language of the interface. The settings of the test site are put back at the end.

import { launch, checks, config, need, wp, wait, quickTables } from './lib.mjs';

need( 'wp', 'site' );

const { check, section, finish } = checks();

const page  = `${ config.site }/wp-admin/tools.php?page=sync-pilot`;
const saved = wp( config.wp, 'echo base64_encode( serialize( get_option( "syncpilot_settings" ) ) );' );
const restore = () => wp( config.wp, 'update_option( "syncpilot_settings", unserialize( base64_decode( ' + JSON.stringify( saved ) + ' ) ) );' );

const browser = await launch();

// an export of a few small tables, kept on the server: the link of the box is returned
async function exportFile( gzip ) {

    await browser.goto( page + '&syncpilot-profile=-1' );
    await browser.click( '#savefile' );
    await browser.chooseTables( quickTables( wp( config.wp, 'global $wpdb; echo $wpdb->prefix;' ) ) );
    await browser.ev( `jQuery('#new-url').val('//export.test').trigger('input').trigger('change'); jQuery('#new-path').val('/tmp/export-test').trigger('input').trigger('change');` );
    await browser.ev( `jQuery('#save_computer').prop('checked', false).trigger('change'); jQuery('#gzip_file').prop('checked', ${ gzip ? 'true' : 'false' }).trigger('change');` );
    await wait( 300 );
    await browser.click( '.migrate-db-button', 300 );
    await browser.waitFor( `jQuery('.close-progress-content').is(':visible')`, 60000, 200 );

    return await browser.ev( `(jQuery('.progress-text a').attr('href') || '')` );
}

// fetch a link in the page (with the cookies of the login): status, headers, the start of the body
const get = async url => await browser.ev( `fetch( ${ JSON.stringify( url ) }, { redirect : 'manual' } ).then( async r => ({ status : r.status, type : r.headers.get('content-type'), disposition : r.headers.get('content-disposition'), nosniff : r.headers.get('x-content-type-options'), length : r.headers.get('content-length'), start : ( await r.arrayBuffer().then( b => Array.from( new Uint8Array( b ).slice( 0, 4 ) ) ) ) }) )` );

try {

    await browser.login();

    section( 'an export, plain' );

    const link = await exportFile( false );

    check( 'the box has a link, with the nonce and the name without .sql, no address of the file in the uploads folder', /[?&]_wpnonce=[0-9a-f]+&download=[^&]+-migrate-\d{14}-[0-9a-f]+$/.test( link ) && ! /\/uploads\/|\/media\//.test( link ), link );

    check( 'the export ran without an error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );

    const name = decodeURIComponent( ( link.match( /download=([^&]+)/ ) || [] )[1] || '' );

    // the file cannot be fetched by the address that it had before 0.4.4 and not by the address in the new folder either
    const folderUrl = wp( config.wp, 'global $syncpilot; echo trailingslashit( $syncpilot->get_upload_info( "url" ) );' );
    const direct    = await get( folderUrl + name + '.sql' );
    const oldPlace  = await get( folderUrl.replace( /exports-[0-9a-f]+\/$/, '' ) + name + '.sql' );

    check( 'the web server does not serve the file from the folder of the exports', [ 403, 404 ].includes( direct.status ), JSON.stringify( direct ) );
    check( 'and not from the place of the versions before', [ 403, 404 ].includes( oldPlace.status ), JSON.stringify( oldPlace ) );

    const wrong = await get( link.replace( /_wpnonce=[0-9a-f]+/, '_wpnonce=0000000000' ) );
    check( 'a wrong nonce is refused (403), the file stays', wrong.status === 403, JSON.stringify( wrong ) );

    const other = await get( link.replace( /download=[^&]+/, 'download=' + encodeURIComponent( '../../../wp-config' ) ) );
    check( 'a name that is not the name of an export is not found (404)', other.status === 404, JSON.stringify( other ) );

    const other2 = await get( link.replace( /download=[^&]+/, 'download=index' ) );
    check( 'index.php of the folder is not found either', other2.status === 404, JSON.stringify( other2 ) );

    const file = await get( link );
    check( 'the link hands the file out: an attachment, no sniffing, with content', file.status === 200 && /attachment/.test( file.disposition || '' ) && file.nosniff === 'nosniff' && Number( file.length ) > 1000, JSON.stringify( file ) );
    check( 'the name of the download has no random part', !! file.disposition && ! /[0-9a-f]{32}/.test( file.disposition ), file.disposition );

    const again = await get( link );
    check( 'the export is deleted after it was sent: the second try is 404', again.status === 404, JSON.stringify( again ) );

    section( 'an export, gzip' );

    const gz = await exportFile( true );

    check( 'the link says gzip=1', /&gzip=1$/.test( gz ), gz );

    const gzfile = await get( gz );
    check( 'it is handed out as a gzip file (the start is 1f 8b)', gzfile.status === 200 && gzfile.start[0] === 0x1f && gzfile.start[1] === 0x8b && /\.sql\.gz/.test( gzfile.disposition || '' ), JSON.stringify( gzfile ) );

} finally {

    restore();
    await browser.close();
}

finish();
