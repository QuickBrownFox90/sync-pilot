// Checks of the guard of the AJAX requests (SyncPilot_Request_Guard): an exception, a fatal error, the memory limit and
// the time limit must end in an entry in the log and in an answer of the plugin instead of the critical error page.
//
//   npm run test:guard
//
// TEST site only. It copies tests/fault/sp-fault.php into the mu-plugins folder of the site, sends requests with
// ?sp_fault=..., and removes the file again. The site and its folder come from tests/browser/local.config.json.
// A request of a logged-in user (the browser of the migration) must get the reason; a request of another site to a
// public endpoint must get a short answer without any detail.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, need } from './browser/lib.mjs';

need( 'wp', 'site' );

const here   = dirname( fileURLToPath( import.meta.url ) );
const mu     = join( config.wp, 'wp-content', 'mu-plugins' );
const target = join( mu, 'sp-fault.php' );
const ajax   = config.site + '/wp-admin/admin-ajax.php';

let failed = 0;
let passed = 0;
let savedLevel;

const check = ( label, ok, info = '' ) => {

    ok ? passed++ : failed++;
    console.log( ( ok ? 'ok   ' : 'FAIL ' ) + label + ( info ? '  | ' + info : '' ) );
};

const wp = code => execFileSync( 'wp', [ 'eval', code, '--path=' + config.wp ], { encoding : 'utf8' } ).trim();

const lines = () => JSON.parse( wp( 'echo json_encode( SyncPilot_Logger::lines() );' ) ).map( line => JSON.parse( line ) );

async function send( action, fault, cookie ) {

    const started  = Date.now();
    const response = await fetch( ajax, {
        method  : 'POST',
        headers : { 'Content-Type' : 'application/x-www-form-urlencoded', ...( cookie ? { Cookie : cookie } : {} ) },
        body    : new URLSearchParams( { action, ...( fault ? { sp_fault : fault } : {} ) } ),
    } );

    return { status : response.status, text : await response.text(), seconds : ( Date.now() - started ) / 1000 };
}

const faults = [
    { fault : 'exception', help : 147, message : 'Uncaught exception in request', reason : 'fault injection: exception' },
    { fault : 'fatal', help : 148, message : 'PHP fatal error in request', reason : 'fault injection: fatal' },
    { fault : 'memory', help : 150, message : 'PHP memory limit reached in request', reason : 'Allowed memory size' },
    { fault : 'timeout', help : 149, message : 'PHP time limit reached in request', reason : 'Maximum execution time' },
];

mkdirSync( mu, { recursive : true } );
copyFileSync( join( here, 'fault', 'sp-fault.php' ), target );

try {

    const cookie = wp( 'echo LOGGED_IN_COOKIE . "=" . wp_generate_auth_cookie( ' + ( config.user || 1 ) + ', time() + 600, "logged_in" );' );

    for ( const f of faults ) {

        console.log( '\n-- ' + f.fault );

        // a request of another site to a public endpoint
        let before = lines().length;
        let answer = await send( 'syncpilot_verify_connection_to_remote_site', f.fault );
        let entry  = lines().slice( before ).pop() || {};

        check( 'public endpoint: HTTP 500 and a short answer', 500 === answer.status && answer.text.startsWith( 'SyncPilot: the request failed' ), answer.status + ' ' + answer.text.slice( 0, 80 ) );
        check( 'public endpoint: no detail in the answer (no reason, no path, no file)', ! answer.text.includes( f.reason ) && ! /wp-content|\.php|\/www\//.test( answer.text ) );
        check( 'public endpoint: the log has the entry', entry.help === f.help && entry.message === f.message && 1 === entry.site, JSON.stringify( entry ).slice( 0, 200 ) );
        check( 'public endpoint: the entry names the phase and the source', 'verify_connection_to_remote_site' === entry.phase && 'remote' === entry.src );
        check( 'public endpoint: the entry has the reason, the file is relative', String( entry.context?.message || '' ).includes( f.reason ) && ! String( entry.context?.file || '/' ).startsWith( '/' ), entry.context?.file );

        // the browser of a logged-in user
        before = lines().length;
        answer = await send( 'syncpilot_get_log', f.fault, cookie );
        entry  = lines().slice( before ).pop() || {};

        let data = {};

        try { data = JSON.parse( answer.text ); } catch ( e ) { /* checked below */ }

        check( 'admin request: HTTP 200 and the JSON of the plugin with the reason', 200 === answer.status && 1 === data.syncpilot_error && String( data.body ).includes( f.reason ), answer.status + ' ' + answer.text.slice( 0, 120 ) );
        check( 'admin request: the reason names file and line', /\.php:\d+/.test( String( data.body ) ) && ! /\/www\//.test( String( data.body ) ), String( data.body ).slice( -90 ) );
        check( 'admin request: the log has the entry', entry.help === f.help && 'admin' === entry.src && 'get_log' === entry.phase, JSON.stringify( entry ).slice( 0, 160 ) );
        check( 'not the critical error page of WordPress', ! /critical error|kritischer Fehler/i.test( answer.text ) );
    }

    console.log( '\n-- a request without a fault still works, a notice does not break the answer' );

    let before = lines().length;
    let answer = await send( 'syncpilot_verify_connection_to_remote_site', '' );
    let entry  = lines().slice( before ).pop() || {};

    check( 'normal request: answered by the handler (HTTP 200), logged as before (130)', 200 === answer.status && 130 === entry.help, answer.status + ' ' + answer.text.slice( 0, 60 ) );

    before = lines().length;
    answer = await send( 'syncpilot_verify_connection_to_remote_site', 'notice' );

    const quiet = lines().slice( before );

    check( 'notice and warning: HTTP 200, the answer of the handler, no PHP text in it', 200 === answer.status && ! /fault injection/.test( answer.text ), answer.status + ' ' + answer.text.slice( 0, 60 ) );
    check( 'level errors: they are not in the log', ! quiet.some( line => 151 === line.help ), quiet.map( line => line.help ).join( ',' ) );

    console.log( '\n-- the ID of the migration is read from the field of the browser and from the header of the other site' );

    before = lines().length;
    await fetch( ajax, { method : 'POST', headers : { 'X-SyncPilot-Migration' : '261112-101530-a1b2c3' }, body : new URLSearchParams( { action : 'syncpilot_verify_connection_to_remote_site' } ) } );
    entry = lines().slice( before ).pop() || {};
    check( 'header of the other site: the entry has the ID', '261112-101530-a1b2c3' === entry.migration, entry.migration );

    before = lines().length;
    await fetch( ajax, { method : 'POST', headers : { Cookie : cookie }, body : new URLSearchParams( { action : 'syncpilot_get_log', sp_fault : 'exception', migration_id : 'ab12-<script>x' } ) } );
    entry = lines().slice( before ).pop() || {};
    check( 'field of the browser: the entry has the ID, cleaned of everything but letters, digits, - and _', 'ab12-scriptx' === entry.migration, entry.migration );

    console.log( '\n-- warnings and notices are in the log at the level verbose' );

    savedLevel = wp( 'echo json_encode( get_option( "syncpilot_settings" )["log_level"] ?? null );' );
    wp( '$s = get_option( "syncpilot_settings" ); $s["log_level"] = "verbose"; update_option( "syncpilot_settings", $s );' );

    before = lines().length;
    answer = await send( 'syncpilot_verify_connection_to_remote_site', 'notice' );

    const noisy = lines().slice( before ).filter( line => 151 === line.help );

    check( 'the answer is the same', 200 === answer.status && ! /fault injection/.test( answer.text ), answer.status );
    check( 'one entry for the notice and one for the warning, level info', 2 === noisy.length && noisy.every( line => 'info' === line.level && 1 === line.site ), JSON.stringify( noisy.map( line => line.context?.kind ) ) );
    check( 'the kind, the message and the relative file are in it', noisy.some( line => 'notice' === line.context?.kind && 'fault injection: notice' === line.context?.message ) && noisy.some( line => 'warning' === line.context?.kind && 'fault injection: warning' === line.context?.message ) && noisy.every( line => 'wp-content/mu-plugins/sp-fault.php' === line.context?.file ) );
    check( 'the invalid signature of this request is still an error entry', lines().slice( before ).some( line => 130 === line.help && 'error' === line.level ) );
} finally {

    if ( existsSync( target ) )
        rmSync( target );

    // the level of the log as it was
    if ( undefined !== savedLevel )
        wp( '$s = get_option( "syncpilot_settings" ); ' + ( 'null' === savedLevel ? 'unset( $s["log_level"] );' : '$s["log_level"] = ' + savedLevel + ';' ) + ' update_option( "syncpilot_settings", $s );' );
}

console.log( '\n' + passed + ' ok, ' + failed + ' failed' );
process.exit( failed ? 1 : 0 );
