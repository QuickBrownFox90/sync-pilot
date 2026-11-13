// The controls of a running migration and the saved profiles, clicked through in a headless browser with real mouse
// events: pause and resume, cancel while it runs, cancel while it is paused, a new run after a cancel (the state of the
// page has to be reset), and deleting a profile (from the list of profiles and from the form). Nothing is sent to another
// site: the runs are exports of a few small tables, which the browser slows down (every request waits) so that there is
// time to click.
//
//   node tests/browser/controls.mjs
//
// The settings of the test site are put back at the end (the profile that the test adds is removed with them).
// The tests do not depend on the language of the interface.

import { launch, checks, config, need, wp, wait, quickTables } from './lib.mjs';

need( 'wp', 'site' );

const { check, section, finish } = checks();

const page  = `${ config.site }/wp-admin/tools.php?page=sync-pilot`;
const saved = wp( config.wp, 'echo base64_encode( serialize( get_option( "syncpilot_settings" ) ) );' );

const restore = () => wp( config.wp, 'update_option( "syncpilot_settings", unserialize( base64_decode( ' + JSON.stringify( saved ) + ' ) ) );' );

// the export files of the site: a cancelled export has to remove its file
const files = () => wp( config.wp, 'global $syncpilot; $p = $syncpilot->get_upload_info( "path" ); echo implode( "\\n", glob( $p . "/*.sql*" ) ?: array() );' ).split( '\n' ).filter( Boolean );

const names = () => JSON.parse( wp( config.wp, 'echo json_encode( array_values( array_map( function ( $p ) { return $p["name"]; }, get_option( "syncpilot_settings" )["profiles"] ) ) );' ) );

const browser = await launch();

// the number of requests that the plugin sent (the recorder of the browser counts admin-ajax.php)
const ajax = () => browser.requests.length;

const slow = async ms => await browser.send( 'Network.emulateNetworkConditions', { offline : false, latency : ms, downloadThroughput : -1, uploadThroughput : -1 } );

// open the form for a new profile and start an export of a few small tables
async function start() {

    await browser.goto( page + '&syncpilot-profile=-1' );
    await browser.click( '#savefile' );
    await browser.chooseTables( quickTables( wp( config.wp, 'global $wpdb; echo $wpdb->prefix;' ) ) );
    await browser.ev( `jQuery('#new-url').val('//export.test').trigger('input').trigger('change'); jQuery('#new-path').val('/tmp/export-test').trigger('input').trigger('change');` );
    await wait( 300 );
    await browser.click( '.migrate-db-button', 300 );
}

// the migration has sent its first request and the controls are there; the box slides in from above (400 ms), and a click
// while it moves misses the button
const running = async () => await browser.waitFor( `jQuery('.migration-controls').is(':visible') && jQuery('.progress-title').text().trim() !== '' && ! jQuery('.progress-content').is(':animated') && Math.round( jQuery('.progress-content')[0].getBoundingClientRect().top ) >= 0`, 20000, 100 );

const state = () => browser.ev( `({ done : jQuery('.close-progress-content').is(':visible'), error : jQuery('.progress-text').hasClass('migration-error'), spinner : jQuery('.migration-progress-ajax-spinner').is(':visible'), controls : jQuery('.migration-controls').is(':visible'), button : jQuery('.pause-resume').text().trim(), title : jQuery('.progress-title').text().trim() })` );

try {

    await browser.login();

    const before = files();

    section( 'pause and resume' );

    await slow( 700 );
    await start();
    check( 'the export starts, the controls are shown', await running() );

    const first = await state();

    await browser.click( '.pause-resume', 200 );

    const paused = await state();

    check( 'pause: the button and the title change', paused.button !== first.button && paused.title !== first.title, `"${ first.button }" -> "${ paused.button }", "${ paused.title }"` );

    // the request that is under way ends, then nothing more is sent
    await browser.waitFor( `!jQuery('.migration-progress-ajax-spinner').is(':visible')`, 10000, 100 );

    const count = ajax();

    await wait( 2500 );
    check( 'pause: no request is sent while it is paused', ajax() === count, `${ ajax() - count } new requests` );
    check( 'pause: the spinner is gone, the migration is not finished', ! ( await state() ).spinner && ! ( await state() ).done );

    await browser.click( '.pause-resume', 200 );
    check( 'resume: the button is back, the spinner runs', ( await state() ).button === first.button && ( await state() ).spinner );
    check( 'resume: the migration ends without an error', await browser.waitFor( `jQuery('.close-progress-content').is(':visible')`, 60000, 200 ) && ! ( await state() ).error );
    check( 'pause and resume: no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );

    section( 'cancel while it runs' );

    await start();
    await running();

    const mark = ajax();

    await browser.click( '.cancel', 200 );
    check( 'cancel: the controls go away', await browser.waitFor( `!jQuery('.migration-controls').is(':visible')`, 5000, 100 ) );
    check( 'cancel: it ends (closing button), without an error', await browser.waitFor( `jQuery('.close-progress-content').is(':visible')`, 60000, 200 ) && ! ( await state() ).error, JSON.stringify( await state() ) );
    check( 'cancel: the cancellation was sent to the server', browser.requests.slice( mark ).some( r => /syncpilot_cancel_migration/.test( r ) ), browser.requests.slice( mark ).join( ' ; ' ) );
    check( 'cancel: the export file is removed', files().length === before.length, files().join( ', ' ) );

    // closing the box and starting again in the same page: nothing of the cancelled run may be left over
    section( 'a new run after a cancel, in the same page' );

    await slow( 0 );
    await browser.click( '.close-progress-content-button', 800 );
    check( 'the box closes', await browser.ev( `!document.querySelector('.progress-content')` ) );
    await browser.click( '.migrate-db-button', 300 );
    check( 'the new run ends without an error and is not cancelled', await browser.waitFor( `jQuery('.close-progress-content').is(':visible')`, 60000, 200 ) && ! ( await state() ).error );
    check( 'the new run: the export is offered (no cancel message)', ( await browser.ev( `jQuery('.progress-text').is(':visible') || jQuery('.progress-title').text().length > 0` ) ) );
    check( 'new run: no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );

    section( 'cancel while it is paused' );

    await slow( 700 );
    await start();
    await running();
    await browser.click( '.pause-resume', 200 );
    await browser.waitFor( `!jQuery('.migration-progress-ajax-spinner').is(':visible')`, 10000, 100 );

    const mark2 = ajax();

    await browser.click( '.cancel', 200 );
    check( 'cancel when paused: it ends without an error', await browser.waitFor( `jQuery('.close-progress-content').is(':visible')`, 60000, 200 ) && ! ( await state() ).error, JSON.stringify( await state() ) );
    check( 'cancel when paused: the cancellation was sent', browser.requests.slice( mark2 ).some( r => /syncpilot_cancel_migration/.test( r ) ) );
    check( 'cancel when paused: the export file is removed', files().length === before.length, files().join( ', ' ) );
    check( 'cancel: no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );

    await slow( 0 );

    section( 'the checks before the migration starts' );

    await browser.goto( page + '&syncpilot-profile=-1' );
    await browser.click( '#savefile' );
    await browser.chooseTables( quickTables( wp( config.wp, 'global $wpdb; echo $wpdb->prefix;' ) ) );

    const mark5 = ajax();

    await browser.click( '.migrate-db-button', 400 );
    check( 'no new URL and no new path: both warnings are shown, nothing is sent', await browser.ev( `jQuery('#new-url-missing-warning').is(':visible') && jQuery('#new-path-missing-warning').is(':visible')` ) && ajax() === mark5 );
    check( 'the field for the URL has the focus', await browser.ev( `document.activeElement && document.activeElement.id === 'new-url'` ) );

    await browser.ev( `jQuery('#new-url').val('//export.test').trigger('input').trigger('change')` );
    await browser.click( '.migrate-db-button', 400 );
    check( 'only the URL: the warning for the path is shown, the one for the URL is gone, nothing is sent', await browser.ev( `jQuery('#new-path-missing-warning').is(':visible') && ! jQuery('#new-url-missing-warning').is(':visible')` ) && ajax() === mark5 );
    check( 'the field for the path has the focus', await browser.ev( `document.activeElement && document.activeElement.id === 'new-path'` ) );
    check( 'checks: no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );

    section( 'save the profile and migrate' );

    // the box "Save Migration Profile" is checked and the profile has no name: a message, and nothing is sent
    await browser.goto( page + '&syncpilot-profile=-1' );
    await browser.click( '#savefile' );
    await browser.chooseTables( quickTables( wp( config.wp, 'global $wpdb; echo $wpdb->prefix;' ) ) );
    await browser.ev( `jQuery('#new-url').val('//export.test').trigger('input').trigger('change'); jQuery('#new-path').val('/tmp/export-test').trigger('input').trigger('change'); jQuery('#save-migration-profile').prop('checked', true).trigger('change')` );
    await wait( 300 );

    const mark4 = ajax();

    await browser.click( '.migrate-db-button', 600 );

    let box = await browser.ev( `(() => { const d = document.getElementById('syncpilot-dialog'); return d ? { open : d.open, cancel : d.querySelector('.syncpilot-dialog-cancel').style.display !== 'none' } : null; })()` );

    check( 'no name for the profile: a message with one button opens, nothing is sent', box?.open && ! box.cancel && ajax() === mark4, JSON.stringify( box ) );
    await browser.click( '.syncpilot-dialog-ok' );

    // with a name: the profile is saved first, then the export runs
    await browser.ev( `jQuery('.create-new-profile').val('zz-saved-profile').trigger('input').trigger('change')` );
    await browser.click( '.migrate-db-button', 300 );
    check( 'with a name: the export runs to the end without an error', await browser.waitFor( `jQuery('.close-progress-content').is(':visible')`, 60000, 200 ) && ! ( await state() ).error );
    check( 'the profile was sent to the server before the export', browser.requests.slice( mark4 ).findIndex( r => /syncpilot_save_profile/.test( r ) ) !== -1 && browser.requests.slice( mark4 ).findIndex( r => /syncpilot_save_profile/.test( r ) ) < browser.requests.slice( mark4 ).findIndex( r => /syncpilot_initiate_migration/.test( r ) ), browser.requests.slice( mark4 ).map( r => r.slice( 7, 40 ) ).join( ' ; ' ) );

    const saved_profile = JSON.parse( wp( config.wp, '$p = array_values( array_filter( get_option( "syncpilot_settings" )["profiles"], fn( $p ) => "zz-saved-profile" === $p["name"] ) ); echo json_encode( $p ? array( "action" => $p[0]["action"], "tables" => count( $p[0]["select_tables"] ?? array() ), "url" => in_array( "//export.test", $p[0]["replace_new"] ?? array(), true ) ) : null );' ) );

    check( 'the profile is in the settings with its action, tables and values', saved_profile?.action === 'savefile' && saved_profile.tables === 5 && saved_profile.url === true, JSON.stringify( saved_profile ) );
    check( 'the form lists the new profile (without a reload)', await browser.ev( `jQuery('.save-migration-profile-wrap li').filter(function () { return jQuery(this).text().trim() === 'zz-saved-profile'; }).length === 1` ) );
    check( 'save profile: no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );

    section( 'the button "Save Profile"' );

    await browser.goto( page + '&syncpilot-profile=-1' );
    await browser.click( '#savefile' );
    await browser.chooseTables( quickTables( wp( config.wp, 'global $wpdb; echo $wpdb->prefix;' ) ) );
    await browser.ev( `jQuery('#save-migration-profile').prop('checked', true).trigger('change')` );
    await wait( 300 );

    const mark6 = ajax();

    await browser.click( '.save-settings-button', 400 );
    box = await browser.ev( `(() => { const d = document.getElementById('syncpilot-dialog'); return d ? { open : d.open, cancel : d.querySelector('.syncpilot-dialog-cancel').style.display !== 'none' } : null; })()` );
    check( 'no name: a message with one button opens, nothing is sent', box?.open && ! box.cancel && ajax() === mark6, JSON.stringify( box ) );
    await browser.click( '.syncpilot-dialog-ok' );

    await browser.ev( `jQuery('.create-new-profile').val('zz-button-profile').trigger('input').trigger('change')` );
    await browser.click( '.save-settings-button', 100 );
    await browser.waitFor( `!jQuery('.save-profile-ajax-spinner').length`, 5000, 50 );
    await wait( 200 );
    check( 'with a name: one request, the profile is in the settings', ajax() === mark6 + 1 && names().includes( 'zz-button-profile' ), names().join( ', ' ) );
    check( 'the button works again, "saved" is shown, the name field is empty', await browser.ev( `! jQuery('.save-settings-button').prop('disabled') && jQuery('.ajax-success-msg').length === 1 && jQuery('.create-new-profile').val() === ''` ) );
    check( 'the form lists the new profile and selects it', await browser.ev( `jQuery('.save-migration-profile-wrap li').filter(function () { return jQuery(this).text().trim() === 'zz-button-profile'; }).find('input').is(':checked')` ) );

    // a second click with the new profile selected replaces it: no new entry
    await browser.click( '.save-settings-button', 100 );
    await browser.waitFor( `!jQuery('.save-profile-ajax-spinner').length`, 5000, 50 );
    await wait( 200 );
    check( 'saving again replaces the profile (no second one)', names().filter( n => n === 'zz-button-profile' ).length === 1, names().join( ', ' ) );
    check( 'button: no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );

    section( 'delete a profile' );

    // two profiles for the test; the settings are put back at the end
    wp( config.wp, '$s = get_option( "syncpilot_settings" ); $p = array( "name" => "zz-test-profile", "action" => "savefile", "save_computer" => "1", "table_migrate_option" => "migrate_only_with_prefix" ); $s["profiles"][] = $p; $p["name"] = "zz-test-profile-2"; $s["profiles"][] = $p; update_option( "syncpilot_settings", $s );' );

    await browser.goto( page );

    const listed = await browser.ev( `jQuery('.migration-profile-options li a').map(function () { return jQuery(this).text().trim(); }).get()` );

    check( 'the list shows the two test profiles', listed.some( t => /zz-test-profile$/.test( t ) ) && listed.some( t => /zz-test-profile-2$/.test( t ) ), listed.join( ' | ' ) );

    // the link to delete a profile belongs to the entry with the name; the last two entries are the test profiles
    const link = name => `jQuery('.migration-profile-options li').filter(function () { return jQuery('a', this).text().trim().endsWith(${ JSON.stringify( name ) }); }).find('.main-list-delete-profile-link')`;

    const mark3 = ajax();

    await browser.ev( `window.__link = ${ link( 'zz-test-profile-2' ) }[0]; window.__link.setAttribute('data-test', 'delete'); 1` );
    await browser.click( '[data-test=delete]', 300 );

    let d = await browser.ev( `(() => { const d = document.getElementById('syncpilot-dialog'); return d ? { open : d.open, text : d.querySelector('.syncpilot-dialog-message').textContent, cancel : d.querySelector('.syncpilot-dialog-cancel').style.display !== 'none' } : null; })()` );

    check( 'delete: a question with the name of the profile opens', d?.open && d.cancel && d.text.includes( 'zz-test-profile-2' ), d?.text );
    await browser.click( '.syncpilot-dialog-cancel' );
    check( 'delete: Cancel sends nothing and keeps the profile', ajax() === mark3 && names().includes( 'zz-test-profile-2' ) );

    await browser.click( '[data-test=delete]', 300 );
    await browser.click( '.syncpilot-dialog-ok', 300 );
    await browser.waitFor( `!jQuery('[data-test=delete]').is(':visible')`, 5000, 100 );
    await wait( 500 );
    check( 'delete: OK removes the profile (list and settings), one request, the other stays', ! names().includes( 'zz-test-profile-2' ) && names().includes( 'zz-test-profile' ) && ajax() === mark3 + 1, names().join( ', ' ) );

    // from the form: the list "Save Migration Profile" shows a cross when the mouse is over an entry
    await browser.goto( page + '&syncpilot-profile=-1' );
    await browser.ev( `jQuery('#save-migration-profile').prop('checked', true).trigger('change')` );

    const row = `jQuery('.save-migration-profile-wrap li').filter(function () { return jQuery(this).text().trim() === 'zz-test-profile'; })`;
    const spot = await browser.ev( `(() => { const l = ${ row }[0]; if (!l) return null; l.scrollIntoView({ block : 'center' }); const r = l.getBoundingClientRect(); return [ r.left + r.width / 2, r.top + r.height / 2 ]; })()` );

    check( 'the form lists the test profile', !! spot );

    if ( spot ) {

        await browser.send( 'Input.dispatchMouseEvent', { type : 'mouseMoved', x : spot[0], y : spot[1] } );
        await wait( 300 );
        check( 'the cross appears when the mouse is over the entry', await browser.ev( `${ row }.find('.delete-profile').is(':visible')` ) );

        // the cross is the :after of an empty element without a size of its own (the element has 0 x 0), so the mouse goes
        // to the place where the cross is drawn, next to the element, and has to hit it
        const cross = await browser.ev( `(() => { const e = ${ row }.find('.delete-profile')[0]; const r = e.getBoundingClientRect(); for (const [ dx, dy ] of [ [ 6, 6 ], [ 8, 8 ], [ 4, 4 ], [ 10, 4 ], [ 6, 0 ] ]) if (document.elementFromPoint(r.left + dx, r.top + dy) === e) return [ r.left + dx, r.top + dy ]; return null; })()` );

        check( 'the cross can be hit with the mouse', !! cross );

        for ( const type of [ 'mouseMoved', 'mousePressed', 'mouseReleased' ] )
            await browser.send( 'Input.dispatchMouseEvent', { type, x : cross?.[0] ?? 0, y : cross?.[1] ?? 0, button : 'left', clickCount : 1 } );

        await wait( 300 );
        await browser.click( '.syncpilot-dialog-ok', 500 );
        await wait( 700 );
        check( 'delete from the form: OK removes the profile', ! names().includes( 'zz-test-profile' ), names().join( ', ' ) );
    }

    check( 'delete: no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );

    section( 'a firewall answers instead of WordPress' );

    // the answer of a firewall for the request that saves a profile, as the browser gets it (no X-Robots-Tag, that is the header
    // that admin-ajax.php always sends); a transport of jQuery answers it, so that the real handler of the plugin runs
    const waf = '<html><head><title> The URL you requested has been blocked </title></head><body><h3>Web Page Blocked!</h3><p>URL: www.example.test/wp-admin/admin-ajax.php<br/>Client IP: 80.153.24.194<br/>Attack ID: 20000008<br/>Message ID: 000186991602</p></body></html>';

    await browser.goto( page + '&syncpilot-profile=-1' );
    await browser.click( '#savefile' );
    await browser.chooseTables( quickTables( wp( config.wp, 'global $wpdb; echo $wpdb->prefix;' ) ) );
    await browser.ev( `jQuery('#save-migration-profile').prop('checked', true).trigger('change')` );
    await wait( 300 );
    await browser.ev( `window.__waf = true; jQuery.ajaxTransport( '+*', function ( options ) { if ( ! window.__waf || String( options.data ).indexOf( 'action=syncpilot_save_profile' ) === -1 ) return; return { send : function ( headers, complete ) { complete( 500, 'Internal Server Error', { text : ${ JSON.stringify( waf ) } }, 'Content-Type: text/html\\r\\nServer: Apache' ); }, abort : function () {} }; } );` );
    await browser.ev( `jQuery('.create-new-profile').val('zz-waf-profile').trigger('input').trigger('change')` );
    await browser.click( '.save-settings-button', 600 );

    const note = await browser.ev( `(() => { const d = document.getElementById('syncpilot-dialog'); return d && d.open ? d.querySelector('.syncpilot-dialog-message').textContent : null; })()` );

    check( 'the message says that the answer did not come from WordPress, with the status', !! note && /WordPress/.test( note ) && /500/.test( note ), note );
    check( 'it names the reference numbers of the block page', !! note && /Attack ID: 20000008/.test( note ) && /Message ID: 000186991602/.test( note ), note );
    check( 'it does not show the words or the address of the page', !! note && ! /Web Page Blocked|80\.153|example\.test/.test( note ), note );

    await browser.click( '.syncpilot-dialog-ok', 300 );

    // an answer of WordPress (the header is there) gets no such sentence
    await browser.ev( `window.__waf = false; jQuery.ajaxTransport( '+*', function ( options ) { if ( String( options.data ).indexOf( 'action=syncpilot_save_profile' ) === -1 ) return; return { send : function ( headers, complete ) { complete( 500, 'Internal Server Error', { text : 'There has been a critical error' }, 'Content-Type: text/html\\r\\nX-Robots-Tag: noindex' ); }, abort : function () {} }; } );` );
    await browser.click( '.save-settings-button', 600 );

    const plain = await browser.ev( `(() => { const d = document.getElementById('syncpilot-dialog'); return d && d.open ? d.querySelector('.syncpilot-dialog-message').textContent : null; })()` );

    check( 'an error answer of WordPress itself: the status, and no sentence about a firewall', !! plain && /500/.test( plain ) && ! /Firewall|firewall/.test( plain ), plain );

    await browser.click( '.syncpilot-dialog-ok', 300 );
} catch ( error ) {

    check( 'the test itself ran through', false, error.message );
} finally {

    try { await slow( 0 ); } catch {}

    restore();
    await browser.close();
}

process.exit( finish() );
