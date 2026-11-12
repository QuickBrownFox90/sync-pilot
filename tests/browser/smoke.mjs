// Click through the admin page of SyncPilot in a headless browser with real mouse and keyboard events and check that
// the page works: the three views, the dialogs, the settings (changed and put back), the slider, and a complete export
// with a progress bar that moves. Nothing is sent to another site.
//
//   node tests/browser/smoke.mjs            export of a few small tables (see lib.mjs for the test installation that is used)
//   node tests/browser/smoke.mjs --full     export of all tables
//
// The tests do not depend on the language of the interface.

import { launch, checks, config, need, wp, wait, full, quickTables } from './lib.mjs';

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

    section( 'the diagnostics tab' );

    wp( config.wp, 'SyncPilot_Logger::event( "Test entry for the diagnostics tab", array( "n" => 1 ) );' );

    await browser.goto( page + '#diagnostics' );
    await browser.waitFor( `document.querySelector('.debug-info-textarea').value.length > 0 && document.querySelector('.debug-log-textarea').value.length > 0`, 10000, 100 );

    const boxes = await browser.ev( `({ info : document.querySelector('.debug-info-textarea').value, log : document.querySelector('.debug-log-textarea').value })` );
    const rows  = boxes.log.split( '\n' );

    check( 'the diagnostic info is in its own field, as text', /site_url\(\):/.test( boxes.info ) && /PHP: /.test( boxes.info ) && ! /"message"/.test( boxes.info ), boxes.info.slice( 0, 60 ) );
    check( 'the log is in the other field: one JSON object per line, no diagnostic info in it', rows.every( row => { try { return 'object' === typeof JSON.parse( row ); } catch { return false; } } ) && ! /site_url\(\)/.test( boxes.log ), rows.length + ' lines' );
    check( 'an entry that was written is in the log', rows.some( row => row.includes( 'Test entry for the diagnostics tab' ) ) );

    const level    = () => wp( config.wp, 'echo get_option( "syncpilot_settings" )["log_level"] ?? "errors";' );
    const original = level();

    check( 'the selection of the log level is under the title of the log and above its field, with the three levels', await browser.ev( `(() => { const box = document.querySelector('.debug-log-textarea').closest('.debug'); const s = box.querySelector('.log-level-select'); const after = ( a, b ) => !!( a.compareDocumentPosition( b ) & Node.DOCUMENT_POSITION_FOLLOWING ); return !!s && after( box.querySelector('h3'), s ) && after( s, box.querySelector('.debug-log-textarea') ) && Array.from( s.options ).map( o => o.value ).join() === 'off,errors,verbose'; })()` ) );
    check( 'it shows the level of the site', original === await browser.ev( `document.querySelector('.log-level-select').value` ), original );

    for ( const next of [ 'verbose', 'off', original ] ) {

        await browser.ev( `jQuery('.log-level-select').val(${ JSON.stringify( next ) }).trigger('change')` );
        await browser.waitFor( `!!document.querySelector('.log-level .ajax-success-msg')`, 5000, 50 );

        check( 'level ' + next + ': saved, and "saved" appears behind the selection', next === level(), level() );

        await browser.waitFor( `!document.querySelector('.log-level .ajax-success-msg')`, 5000, 100 );
    }

    check( 'a value that is not a level is refused and nothing is changed', 'Unknown log level' === ( await browser.ev( `(async () => { const r = await fetch( ajaxurl, { method : 'POST', body : new URLSearchParams( { action : 'syncpilot_save_log_level', level : 'nonsense', nonce : syncpilot_nonces.save_log_level } ) } ); return ( await r.json() ).body; })()` ) ) && original === level() );

    await browser.click( '.clear-log' );
    await browser.waitFor( `document.querySelector('.debug-log-textarea').value === ''`, 5000, 50 );
    await wait( 500 );

    check( 'Clear empties the field and the log of the site', '0' === wp( config.wp, 'echo count( SyncPilot_Logger::entries() );' ), wp( config.wp, 'echo count( SyncPilot_Logger::entries() );' ) );
    check( 'diagnostics tab: no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );

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

        // wait for the request to end, not for the message to fade out, and take the message away
        await browser.waitFor( `!document.querySelector('.ajax-spinner')`, 5000, 50 );
        await browser.click( '#' + id, 100 );
        await browser.waitFor( `!document.querySelector('.ajax-spinner')`, 5000, 50 );
        await browser.ev( `jQuery('.ajax-success-msg').remove()` );
    }

    // the slider: moving it must not end in an error message
    before      = browser.requests.length;

    const value = await browser.ev( `jQuery('.slider').slider('value')` );

    await browser.drag( '.slider .ui-slider-handle', -40 );
    check( 'slider: moved, one request, no dialog', await browser.ev( `jQuery('.slider').slider('value')` ) !== value && browser.requests.length === before + 1 && ( await dialog( browser ) ).open === false, `${ value } -> ${ await browser.ev( `jQuery('.slider').slider('value')` ) } kB` );
    check( 'settings: no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );

    section( full ? 'export of all tables' : 'export of a few tables' );

    await browser.goto( page + '&syncpilot-profile=-1' );
    await browser.click( '#savefile' );

    if ( ! full )
        await browser.chooseTables( quickTables( wp( config.wp, 'global $wpdb; echo $wpdb->prefix;' ) ) );

    await browser.ev( `jQuery('#new-url').val('//export.test').trigger('input').trigger('change'); jQuery('#new-path').val('/tmp/export-test').trigger('input').trigger('change');` );
    await wait( 300 );
    await browser.watchProgress();
    await browser.click( '.migrate-db-button', 800 );

    const end    = Date.now() + 180000;
    let finished = false, failed = false;

    while ( Date.now() < end ) {

        const s = await browser.ev( `({ done : jQuery('.close-progress-content').is(':visible'), error : jQuery('.progress-text').hasClass('migration-error') })` );

        if ( s.error ) { failed = true; break; }

        if ( s.done ) { finished = true; break; }

        await wait( 400 );
    }

    const widths = await browser.progressWidths();
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
