// What the log says when the answer of the other site is wrong. The first test site is connected to the second one through
// a proxy (tests/fault/proxy.mjs) that spoils the answers: a web server error, a firewall, a request for a password, an
// empty answer, a cut answer, a PHP notice in front of the answer, a redirect, a closed connection, no answer at all.
// For each, the log of the first site must name the help code, the facts (status, cURL number, duration, sizes) and a
// cleaned beginning of the answer, and must never hold a key, a password or a long token.
//
//   node tests/browser/remote-faults.mjs      (the one with "no answer at all" waits for the time limit of 10 s)
//
// TEST sites only. Nothing is changed on them; the browser asks "who are you" through the proxy.

import { launch, checks, config, need, wp } from './lib.mjs';
import { startProxy } from '../fault/proxy.mjs';

need( 'wp', 'site', 'remoteWp', 'remoteSite' );

const { check, section, finish } = checks();

const page = `${ config.site }/wp-admin/tools.php?page=sync-pilot`;
const key  = wp( config.remoteWp, 'echo get_option( "syncpilot_settings" )["key"];' );
const logs = () => JSON.parse( wp( config.wp, 'echo json_encode( SyncPilot_Logger::entries() );' ) );

const cases = [
    { mode : 'status502', help : 129, label : 'a web server error (502)', status : 502, includes : '502 Bad Gateway nginx', server : 'nginx' },
    { mode : 'status403', help : 129, label : 'a firewall (403)', status : 403, includes : 'Request blocked ModSecurity', token : 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8' },
    { mode : 'basic', help : 142, label : 'a request for a password (401)', status : 401 },
    { mode : 'empty', help : 144, label : 'an empty answer', status : 200, received : 0 },
    { mode : 'truncate', help : 144, label : 'an answer that is cut', status : 200 },
    { mode : 'notice', help : 144, label : 'a PHP notice in front of the answer', status : 200, includes : 'Notice Undefined variable', noData : true },
    { mode : 'redirect', help : 144, label : 'a redirect to a web page', status : 200, includes : 'Welcome to our shop' },
    { mode : 'reset', help : 121, label : 'a closed connection', errno : [ 52, 56 ] },
    { mode : 'hang', help : 134, label : 'no answer at all', errno : [ 28 ], slow : true },
];

const proxy   = await startProxy( config.remoteSite );
const browser = await launch();

try {

    await browser.login();
    await browser.goto( page );

    for ( const c of cases ) {

        section( c.label );

        proxy.mode = c.mode;

        const before = logs().length;
        const asked  = Date.now();
        const answer = await browser.ev( `(async () => { const r = await fetch( ajaxurl, { method : 'POST', body : new URLSearchParams( { action : 'syncpilot_verify_connection_to_remote_site', url : ${ JSON.stringify( proxy.url ) }, key : ${ JSON.stringify( key ) }, intent : 'pull', nonce : syncpilot_nonces.verify_connection_to_remote_site } ) } ); return await r.text(); })()` );
        const took   = ( Date.now() - asked ) / 1000;
        const entry  = logs().slice( before ).filter( e => 'error' === e.level ).pop() || {};
        const ctx    = entry.context || {};
        const raw    = JSON.stringify( entry );

        check( 'the browser gets the error of the plugin', /syncpilot_error/.test( answer ), answer.slice( 0, 100 ) );
        check( 'the log has the help code ' + c.help + ' for it', c.help === entry.help && 'admin' === entry.src, JSON.stringify( [ entry.help, entry.message ] ) );
        check( 'the scope and the time it took are in it', 'ajax_verify_connection_to_remote_site' === ctx.scope && ctx.duration_ms >= 0 && ctx.duration_ms <= took * 1000 + 200, `${ ctx.duration_ms } ms, the request took ${ took } s` );

        if ( c.status )
            check( 'the status is in it', c.status === ctx.status, String( ctx.status ) );

        if ( c.errno )
            check( 'the number of cURL is in it', c.errno.includes( ctx.curl_errno ), `${ ctx.curl_errno } ${ ctx.error || '' }` );

        if ( c.slow )
            check( 'the duration is the time limit', ctx.duration_ms >= 9500, `${ ctx.duration_ms } ms` );

        if ( undefined !== c.received )
            check( 'the size of the answer is in it', c.received === ctx.received_bytes, String( ctx.received_bytes ) );

        if ( c.includes )
            check( 'a cleaned beginning of the answer: "' + c.includes + '"', ( ctx.excerpt || '' ).replace( /[:()]/g, ' ' ).replace( /\s+/g, ' ' ).includes( c.includes.replace( /[:()]/g, ' ' ).replace( /\s+/g, ' ' ) ), ctx.excerpt );

        if ( c.server )
            check( 'the server is in it', c.server === ctx.header_server, ctx.header_server );

        if ( c.noData )
            check( 'nothing of the data behind the notice: no table name, no serialized text', ! /wp_|s:\d+:/.test( ctx.excerpt || '' ) && ( ctx.excerpt || '' ).endsWith( '[data]' ), ctx.excerpt );

        check( 'no tag, no key, no password and no long token in the entry', ! /<\w|<\//.test( ctx.excerpt || '' ) && ! raw.includes( key ) && ! raw.includes( 'secret' ) && ! ( c.token && raw.includes( c.token ) ), raw.slice( 0, 160 ) );
        check( 'no error in the page', browser.takeProblems().filter( p => ! /50\d|40\d|status of/i.test( p ) ).length === 0, browser.takeProblems().join( ' | ' ) );
    }

    section( 'the ID of a migration reaches the other site through the proxy' );

    proxy.mode     = 'pass';
    proxy.requests = [];

    const begin = logs().length;

    await browser.ev( `(async () => { const r = await fetch( ajaxurl, { method : 'POST', body : new URLSearchParams( { action : 'syncpilot_verify_connection_to_remote_site', url : ${ JSON.stringify( proxy.url ) }, key : ${ JSON.stringify( key ) }, intent : 'pull', nonce : syncpilot_nonces.verify_connection_to_remote_site, migration_id : '261112-000000-abcdef' } ) } ); return await r.text(); })()` );

    check( 'the request through the proxy carries the header with the ID of the browser', proxy.requests.some( r => '261112-000000-abcdef' === r.migration ), JSON.stringify( proxy.requests.map( r => r.migration ) ) );
    check( 'at the level errors an answered request is not in the log', ! logs().slice( begin ).some( e => 'Remote request answered' === e.message ) );
} catch ( error ) {

    check( 'the test itself ran through', false, error.message );
} finally {

    try { await browser.close(); } catch {}

    proxy.close();
}

process.exit( finish() );
