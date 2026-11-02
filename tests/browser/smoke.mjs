// Click through the admin page of SyncPilot in a headless browser with real mouse and keyboard events and check that
// the page works: the three views, the dialogs, the settings (changed and put back), the slider, and a complete export
// of all tables with a progress bar that moves. Nothing is sent to another site.
//
//   node tests/browser/smoke.mjs            (see lib.mjs for the test installation that is used)
//
// The tests do not depend on the language of the interface.

import { launch, checks, config, need, wp, wait } from './lib.mjs';

need( 'wp', 'site' );

const { check, section, finish } = checks();

const page  = `${ config.site }/wp-admin/tools.php?page=sync-pilot`;
const keys  = [ 'allow_pull', 'allow_push', 'verify_ssl', 'max_request' ];
const saved = JSON.parse( wp( config.wp, 'echo json_encode( array_intersect_key( get_option( "syncpilot_settings" ), array_flip( ' + JSON.stringify( keys ) + ' ) ) );' ) );

const restore = () => wp( config.wp, '$s = get_option( "syncpilot_settings" ); foreach ( json_decode( ' + JSON.stringify( JSON.stringify( saved ) ) + ', true ) as $k => $v ) $s[$k] = $v; update_option( "syncpilot_settings", $s );' );

const dialog = b => b.ev( `(() => { const d = document.getElementById('syncpilot-dialog'); return d ? { open : d.open, text : d.querySelector('.syncpilot-dialog-message').textContent, cancel : d.querySelector('.syncpilot-dialog-cancel').style.display !== 'none' } : null; })()` );

const browser = await launch();

try {

    await browser.login();

    section( 'the views' );

    for ( const [ label, url, selector ] of [ [ 'start (profiles)', page, '#syncpilot-main' ], [ 'form for a new profile', page + '&syncpilot-profile=-1', '#migrate-form' ] ] ) {

        await browser.goto( url );

        const scripts = await browser.ev( `Array.from(document.scripts).filter(s => /sync-pilot/.test(s.src)).map(s => s.src.replace(/^.*\\/asset\\//, '').replace(/\\?.*/, ''))` );

        check( label + ': page and the one script are there', await browser.ev( `!!document.querySelector(${ JSON.stringify( selector ) })` ) && scripts.length === 1 && /^js\/sync-pilot(\.min)?\.js$/.test( scripts[0] ), scripts.join( ', ' ) );
        check( label + ': no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );
        check( label + ': the parts of the script are all there (steps, media files with its texts, dialog, sanitizer; no hook system)', await browser.ev( `typeof run_next_step === 'function' && typeof media_files_chosen === 'function' && typeof media_files_connection_verified === 'function' && typeof media_files_connection_box_moved === 'function' && typeof jQuery.syncpilot === 'undefined' && typeof syncpilot_dialog === 'function' && typeof syncpilot_sanitize_html === 'function' && typeof syncpilot_i10n === 'object' && typeof syncpilot_mf_strings === 'object' && 'determine_media_to_migrate' in window && 'execute_next_step' in window` ) );
    }

    await browser.goto( page );

    if ( await browser.ev( `!!document.querySelector('.migration-profile-options li a')` ) ) {

        await browser.click( '.migration-profile-options li a' );
        await browser.waitFor( `!!document.querySelector('#migrate-form')`, 10000 );
        check( 'saved profile: the form opens', await browser.ev( `!!document.querySelector('#migrate-form')` ) );
        check( 'saved profile: no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );
    } else
        console.log( 'skip  no saved profile on this site' );

    section( 'dialogs' );

    await browser.goto( page + '&syncpilot-profile=-1' );

    check( 'the dialog exists and is closed', ( await dialog( browser ) )?.open === false );

    await browser.ev( `window.__r = []; syncpilot_confirm('question\\n\\n<b>no markup</b>', () => __r.push('ok'), () => __r.push('cancel'))` );
    await wait( 300 );

    let d = await dialog( browser );

    check( 'a question has two buttons and shows text as text', d.open && d.cancel && d.text.includes( '<b>no markup</b>' ) );

    await browser.click( '.syncpilot-dialog-cancel' );
    check( 'Cancel calls only the cancel callback', JSON.stringify( await browser.ev( '__r' ) ) === '["cancel"]' );

    await browser.ev( `syncpilot_confirm('x', () => __r.push('ok'), () => __r.push('cancel'))` );
    await browser.click( '.syncpilot-dialog-ok' );
    check( 'OK calls the confirm callback', JSON.stringify( await browser.ev( '__r' ) ) === '["cancel","ok"]' );

    await browser.ev( `syncpilot_confirm('x', () => __r.push('ok'), () => __r.push('esc'))` );
    await wait( 200 );
    await browser.press( 'Escape', 'Escape', 27 );
    check( 'Escape cancels', ( await browser.ev( '__r' ) ).slice( -1 )[0] === 'esc' && ( await dialog( browser ) ).open === false );

    // no table selected: the check "select at least one table" has to stop the migration
    let before = 0;

    await browser.click( '#savefile' );
    await browser.click( '.tables-header' );
    await browser.click( '#migrate-selected' );
    await browser.ev( `jQuery('#select-tables').val(null).trigger('change')` );
    before = browser.requests.length;
    await browser.click( '.migrate-db-button', 700 );
    d = await dialog( browser );
    check( 'no table selected: a message opens, with one button', d?.open && ! d.cancel, d?.text );
    await browser.click( '.syncpilot-dialog-ok' );
    check( 'no table selected: no request was sent', browser.requests.length === before, browser.requests.slice( before ).join( ' ; ' ) );
    check( 'dialogs: no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );

    section( 'settings' );

    await browser.goto( page + '&x=1#settings' );

    before = browser.requests.length;
    await browser.click( '.reset-api-key' );
    d = await dialog( browser );
    check( 'reset the key: a question opens', d?.open && d.cancel );
    await browser.click( '.syncpilot-dialog-cancel' );
    check( 'reset the key: Cancel sends nothing', browser.requests.length === before );

    if ( false === await browser.ev( `document.querySelector('#plugin-compatibility').checked` ) ) {

        await browser.click( '#plugin-compatibility' );
        d = await dialog( browser );
        check( 'plugin compatibility: a question opens', d?.open && d.cancel );
        before = browser.requests.length;
        await browser.click( '.syncpilot-dialog-cancel' );
        check( 'plugin compatibility: Cancel unchecks the box and sends nothing', false === await browser.ev( `document.querySelector('#plugin-compatibility').checked` ) && browser.requests.length === before );
    }

    // each checkbox: the message "saved" must appear behind the label and not cover it, then put the box back
    for ( const id of [ 'allow_pull', 'allow_push', 'verify_ssl' ] ) {

        await browser.click( '#' + id, 100 );
        await browser.waitFor( `!!document.querySelector('.settings-tab .ajax-success-msg')`, 5000, 50 );

        const spot = await browser.ev( `(() => { const m = document.querySelector('.settings-tab .ajax-success-msg'); const l = document.getElementById(${ JSON.stringify( id ) }).closest('label'); if (!m) return null; return { msgLeft : Math.round(m.getBoundingClientRect().left), labelRight : Math.round(l.getBoundingClientRect().right) }; })()` );

        check( id + ': "saved" appears behind the label', spot && spot.msgLeft >= spot.labelRight, JSON.stringify( spot ) );

        await wait( 2500 );
        await browser.click( '#' + id, 450 );
        await wait( 2500 );
    }

    // the slider: moving it must not end in an error message
    before      = browser.requests.length;

    const value = await browser.ev( `jQuery('.slider').slider('value')` );

    await browser.drag( '.slider .ui-slider-handle', -40 );
    check( 'slider: moved, one request, no dialog', await browser.ev( `jQuery('.slider').slider('value')` ) !== value && browser.requests.length === before + 1 && ( await dialog( browser ) ).open === false, `${ value } -> ${ await browser.ev( `jQuery('.slider').slider('value')` ) } kB` );
    check( 'settings: no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );

    section( 'export of all tables' );

    await browser.goto( page + '&syncpilot-profile=-1' );
    await browser.click( '#savefile' );
    await browser.ev( `jQuery('#new-url').val('//export.test').trigger('input').trigger('change'); jQuery('#new-path').val('/tmp/export-test').trigger('input').trigger('change');` );
    await wait( 300 );
    await browser.click( '.migrate-db-button', 800 );

    const widths = [];
    const end    = Date.now() + 180000;
    let finished = false, failed = false;

    while ( Date.now() < end ) {

        const s = await browser.ev( `({ width : parseFloat(document.querySelector('.progress-bar')?.style.width) || 0, done : jQuery('.close-progress-content').is(':visible'), error : jQuery('.progress-text').hasClass('migration-error') })` );

        widths.push( s.width );

        if ( s.error ) { failed = true; break; }

        if ( s.done ) { finished = true; break; }

        await wait( 400 );
    }

    const steps = widths.filter( w => w > 0 && w < 100 );

    check( 'the export runs to the end without an error message', finished && ! failed );
    check( 'the progress bar moves (it does not stay at 0% until the last table)', steps.length > 0 && widths.every( ( w, i ) => i === 0 || w >= widths[i - 1] ), `${ widths.length } samples, ${ steps.length } between 1 and 99%, highest ${ Math.max( ...widths ) }%` );
    check( 'export: no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );

    await browser.shot( 'smoke-export' );
} catch ( error ) {

    check( 'the test itself ran through', false, error.message );
} finally {

    restore();
    await browser.close();
}

process.exit( finish() );
