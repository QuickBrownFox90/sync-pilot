// A small browser for the tests: headless Chromium, driven over the DevTools protocol (no dependencies, Node 22+).
// It logs in with a session of the administrator that wp-cli creates, clicks with real mouse events, and collects
// everything that goes wrong in the page: JavaScript errors, native pop-ups, failed requests, console errors.
//
// Run the tests on TEST installations only. Which ones is set in tests/browser/local.config.json (it is not part of the
// repository, copy config.example.json) or by environment variables, which win:
//
//   wp          SP_WP_PATH         WordPress folder of the site that is clicked through
//   site        SP_SITE            its address, for example https://site-one.test
//   remoteWp    SP_REMOTE_WP_PATH  WordPress folder of the second test site (push test only)
//   remoteSite  SP_REMOTE_SITE     its address (push test only)
//   user        SP_WP_USER         ID of the administrator (default 1)
//   shots       SP_SHOTS           folder for screenshots (default <tmp>/syncpilot-shots)

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join( dirname( fileURLToPath( import.meta.url ) ), 'local.config.json' );
const own  = existsSync( file ) ? JSON.parse( readFileSync( file, 'utf8' ) ) : {};

const names = { wp : 'SP_WP_PATH', site : 'SP_SITE', remoteWp : 'SP_REMOTE_WP_PATH', remoteSite : 'SP_REMOTE_SITE', user : 'SP_WP_USER', shots : 'SP_SHOTS' };
const pick  = key => process.env[names[key]] || own[key];

export const config = {
    wp         : pick( 'wp' ),
    site       : ( pick( 'site' ) || '' ).replace( /\/$/, '' ),
    remoteWp   : pick( 'remoteWp' ),
    remoteSite : ( pick( 'remoteSite' ) || '' ).replace( /\/$/, '' ),
    user       : pick( 'user' ) || '1',
    shots      : pick( 'shots' ) || join( tmpdir(), 'syncpilot-shots' ),
};

// stop with a clear message when a test needs a setting that is not there
export function need( ...keys ) {

    const missing = keys.filter( key => ! config[key] );

    if ( missing.length ) {
        console.error( 'Missing settings: ' + missing.map( key => `${ key } (${ names[key] })` ).join( ', ' ) );
        console.error( 'Set them as environment variables or in tests/browser/local.config.json (copy config.example.json).' );
        process.exit( 2 );
    }
}

export const wait = ms => new Promise( resolve => setTimeout( resolve, ms ) );

// The tests migrate a few small tables with content by default (a migration costs time for every table, not for the
// data), and all tables with --full. The options are not among them: they hold the key of the site.
export const full = process.argv.includes( '--full' );

export const quickTables = prefix => [ 'posts', 'postmeta', 'terms', 'term_taxonomy', 'term_relationships' ].map( name => prefix + name );

// run PHP in a WordPress installation (wp-cli) and return what it prints
export function wp( path, php ) {
    return execFileSync( 'wp', [ '--path=' + path, 'eval', php ], { encoding : 'utf8', stdio : [ 'ignore', 'pipe', 'ignore' ], maxBuffer : 64 * 1024 * 1024 } ).trim();
}

export async function launch() {

    const port    = 20000 + Math.floor( Math.random() * 20000 );
    const profile = mkdtempSync( join( tmpdir(), 'syncpilot-chrome-' ) );

    // its own process group, so that the processes that Chromium starts end with it
    const child   = spawn( 'chromium', [ '--headless=new', '--no-sandbox', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--window-size=1300,900', 'about:blank' ], { stdio : 'ignore', detached : true } );

    let target;

    for ( let i = 0; i < 60 && ! target; i++ ) {

        try {
            target = await ( await fetch( `http://127.0.0.1:${ port }/json/new?about:blank`, { method : 'PUT' } ) ).json();
        } catch {
            await wait( 250 );
        }
    }

    if ( ! target )
        throw new Error( 'Chromium did not start (is "chromium" installed?)' );

    const ws = new WebSocket( target.webSocketDebuggerUrl );

    await new Promise( resolve => ws.addEventListener( 'open', resolve ) );

    let id = 0;

    const pending  = new Map();
    const problems = [];
    const requests = [];

    ws.addEventListener( 'message', async message => {

        const data = JSON.parse( message.data );

        if ( data.id && pending.has( data.id ) ) {
            pending.get( data.id )( data );
            pending.delete( data.id );

            return;
        }

        const p = data.params || {};

        if ( 'Runtime.exceptionThrown' === data.method )
            problems.push( 'JS exception: ' + ( p.exceptionDetails.exception?.description || p.exceptionDetails.text ).split( '\n' )[0] );

        else if ( 'Runtime.consoleAPICalled' === data.method && 'error' === p.type )
            problems.push( 'console.error: ' + p.args.map( a => a.value ?? a.description ).join( ' ' ).slice( 0, 160 ) );

        else if ( 'Log.entryAdded' === data.method && 'error' === p.entry.level && ! /livereload|favicon/.test( p.entry.url || '' ) )
            problems.push( 'log: ' + p.entry.text.slice( 0, 160 ) + ' ' + ( p.entry.url || '' ).replace( /^.*\//, '' ) );

        else if ( 'Network.responseReceived' === data.method && p.response.status >= 400 && ! /favicon/.test( p.response.url ) )
            problems.push( 'HTTP ' + p.response.status + ' ' + p.response.url.replace( /^https?:\/\/[^/]+/, '' ).slice( 0, 100 ) );

        else if ( 'Network.requestWillBeSent' === data.method && /admin-ajax\.php/.test( p.request.url ) )
            requests.push( ( p.request.postData || '' ).replace( /nonce=[^&]*/, '' ).replace( /&?(profile|form_data|key)=[^&]*/g, '' ).slice( 0, 120 ) );

        // a native pop-up is a failure of the plugin (they were replaced by dialogs); close it so that the page does not hang
        else if ( 'Page.javascriptDialogOpening' === data.method ) {
            problems.push( 'native pop-up: ' + p.message.slice( 0, 120 ) );
            send( 'Page.handleJavaScriptDialog', { accept : false } );
        }
    } );

    const send = ( method, params = {} ) => new Promise( resolve => {

        const n = ++id;

        pending.set( n, resolve );
        ws.send( JSON.stringify( { id : n, method, params } ) );
    } );

    for ( const domain of [ 'Network', 'Runtime', 'Page', 'Log' ] )
        await send( domain + '.enable' );

    // the export ends with a download: do not save it
    await send( 'Browser.setDownloadBehavior', { behavior : 'deny' } );
    await send( 'Emulation.setDeviceMetricsOverride', { width : 1300, height : 900, deviceScaleFactor : 1, mobile : false } );

    const ev = async expression => {

        const r = await send( 'Runtime.evaluate', { expression, returnByValue : true, awaitPromise : true } );

        if ( r.result?.exceptionDetails )
            throw new Error( 'evaluate failed: ' + ( r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text ).split( '\n' )[0] + '  <- ' + expression.slice( 0, 90 ) );

        return r.result?.result?.value;
    };

    const page = {

        send, ev, problems, requests,

        // log in as the administrator: a session that wp-cli creates, valid for two hours
        async login() {

            const out    = wp( config.wp, '$u = ' + Number( config.user ) + '; $exp = time() + 7200; $t = WP_Session_Tokens::get_instance( $u )->create( $exp ); echo LOGGED_IN_COOKIE, "\\t", wp_generate_auth_cookie( $u, $exp, "logged_in", $t ), "\\n", AUTH_COOKIE, "\\t", wp_generate_auth_cookie( $u, $exp, "auth", $t );' );
            const domain = new URL( config.site ).hostname;
            const cookies = out.split( '\n' ).map( line => {

                const [ name, value ] = line.split( '\t' );

                return { name, value, domain, path : '/' };
            } );

            await send( 'Network.setCookies', { cookies } );
        },

        // open a page and wait until it is loaded and the scripts had time to bind their handlers
        async goto( url, settle = 1500 ) {

            await send( 'Page.navigate', { url } );

            for ( let i = 0; i < 80; i++ ) {

                await wait( 250 );

                if ( 'complete' === await ev( 'document.readyState' ).catch( () => '' ) )
                    break;
            }

            await wait( settle );
        },

        async waitFor( expression, timeout = 30000, step = 250 ) {

            const end = Date.now() + timeout;

            while ( Date.now() < end ) {

                if ( await ev( expression ).catch( () => false ) )
                    return true;

                await wait( step );
            }

            return false;
        },

        // a real click: the mouse moves to the middle of the element, which has to be visible
        async click( selector, pause = 400 ) {

            const spot = await ev( `(() => { const e = document.querySelector(${ JSON.stringify( selector ) }); if (!e) return null; e.scrollIntoView({ block : 'center' }); const r = e.getBoundingClientRect(); return r.width && r.height ? [ r.left + r.width / 2, r.top + r.height / 2 ] : null; })()` );

            if ( ! spot ) {

                // say why: the first ancestor that takes no space or is not displayed
                const why = await ev( `(() => { const e = document.querySelector(${ JSON.stringify( selector ) }); if (!e) return 'not in the page'; for (let n = e; n && n !== document.body; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || ! n.offsetHeight) return n.tagName + '.' + n.className + ' display=' + s.display + ' height=' + n.offsetHeight; } return 'size ' + e.offsetWidth + 'x' + e.offsetHeight; })()` ).catch( () => '?' );

                throw new Error( 'cannot click, not found or not visible: ' + selector + ' (' + why + ')' );
            }

            for ( const type of [ 'mouseMoved', 'mousePressed', 'mouseReleased' ] )
                await send( 'Input.dispatchMouseEvent', { type, x : spot[0], y : spot[1], button : 'left', clickCount : 1 } );

            await wait( pause );
        },

        async press( key, code, keyCode ) {

            for ( const type of [ 'keyDown', 'keyUp' ] )
                await send( 'Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode : keyCode } );

            await wait( 300 );
        },

        // drag the handle of a jQuery UI slider by a number of pixels
        async drag( selector, dx ) {

            const spot = await ev( `(() => { const e = document.querySelector(${ JSON.stringify( selector ) }); e.scrollIntoView({ block : 'center' }); const r = e.getBoundingClientRect(); return [ r.left + r.width / 2, r.top + r.height / 2 ]; })()` );

            await send( 'Input.dispatchMouseEvent', { type : 'mouseMoved', x : spot[0], y : spot[1] } );
            await send( 'Input.dispatchMouseEvent', { type : 'mousePressed', x : spot[0], y : spot[1], button : 'left', clickCount : 1 } );
            await send( 'Input.dispatchMouseEvent', { type : 'mouseMoved', x : spot[0] + dx, y : spot[1], button : 'left' } );
            await send( 'Input.dispatchMouseEvent', { type : 'mouseReleased', x : spot[0] + dx, y : spot[1], button : 'left', clickCount : 1 } );
            await wait( 1500 );
        },

        async shot( name ) {

            mkdirSync( config.shots, { recursive : true } );

            const r = await send( 'Page.captureScreenshot', { format : 'png' } );

            writeFileSync( join( config.shots, name + '.png' ), Buffer.from( r.result.data, 'base64' ) );
        },

        // record every width of the progress bar in the page itself (a fast migration is over before a poll would see it)
        async watchProgress() {

            await ev( `window.__widths = []; new MutationObserver( list => { for ( const m of list ) if ( m.target.classList && m.target.classList.contains( 'progress-bar' ) ) window.__widths.push( parseFloat( m.target.style.width ) || 0 ); } ).observe( document.body, { attributes : true, subtree : true, attributeFilter : [ 'style' ] } )` );
        },

        async progressWidths() {
            return await ev( 'window.__widths' ) || [];
        },

        // migrate only these tables: open the table section, choose "selected tables", select them
        async chooseTables( tables ) {

            await page.click( '.tables-header' );
            await page.click( '#migrate-selected' );
            await ev( `jQuery('#select-tables').val(${ JSON.stringify( tables ) }).trigger('change')` );
        },

        // what went wrong since the last call (and forget it)
        takeProblems() {
            return [ ...new Set( problems.splice( 0 ) ) ];
        },

        async close() {

            try { ws.close(); } catch {}

            // end Chromium with everything it started, then remove its profile; a folder that stays must not fail a test
            try { process.kill( -child.pid, 'SIGKILL' ); } catch {}

            await wait( 500 );

            try { rmSync( profile, { recursive : true, force : true, maxRetries : 10, retryDelay : 300 } ); } catch {}
        },
    };

    return page;
}

// checks with a summary; the exit code is 1 when one failed
export function checks() {

    let ok = 0, bad = 0, last = 0;

    return {

        check( label, condition, info = '' ) {

            condition ? ok++ : bad++;
            console.log( ( condition ? 'ok   ' : 'FAIL ' ) + label + ( info ? '  | ' + info : '' ) );

            return !! condition;
        },

        section( title ) {

            const now = Date.now();

            console.log( '\n-- ' + title + ( last ? `  (the section before took ${ Math.round( ( now - last ) / 100 ) / 10 } s)` : '' ) );
            last = now;
        },

        finish() {

            console.log( `\n${ ok } ok, ${ bad } failed` + ( last ? `  (the last section took ${ Math.round( ( Date.now() - last ) / 100 ) / 10 } s)` : '' ) );

            return bad ? 1 : 0;
        },
    };
}
