// Builds asset/css and asset/js from asset/src, with esbuild.
//
//   npm run build   build once (this is what the release workflow checks)
//   npm run dev     build, then watch asset/src and build again on every change
//
// CSS: asset/src/css/main.css joins the modules with @import -> styles.css (readable) and styles.min.css.
// JS:  every file of asset/src/js -> the same file (a byte-for-byte copy, so that the browser shows the real code with
//      SCRIPT_DEBUG) and .min.js (minified, no bundling, global names stay: the code calls some of them by string).
import { readdirSync, readFileSync, writeFileSync, mkdirSync, watch } from 'node:fs';
import { build, transformSync } from 'esbuild';

const watching = process.argv.includes( '--watch' );
const src      = new URL( './', import.meta.url );
const jsFrom   = new URL( './js/', import.meta.url );
const jsTo     = new URL( '../js/', import.meta.url );
const cssTo    = new URL( '../css/', import.meta.url );

function pad() {
    return new Date().toTimeString().slice( 0, 8 );
}

async function build_css() {

    const entry = new URL( './css/main.css', import.meta.url ).pathname;

    await build( { entryPoints : [ entry ], bundle : true, outfile : new URL( 'styles.css', cssTo ).pathname, logLevel : 'warning' } );
    await build( { entryPoints : [ entry ], bundle : true, minify : true, outfile : new URL( 'styles.min.css', cssTo ).pathname, logLevel : 'warning' } );
}

function build_js() {

    mkdirSync( jsTo, { recursive : true } );

    for ( const file of readdirSync( jsFrom ).filter( f => f.endsWith( '.js' ) ).sort() ) {

        const code = readFileSync( new URL( file, jsFrom ), 'utf8' );
        const min  = transformSync( code, { minify : true, charset : 'utf8', legalComments : 'inline' } ).code;

        writeFileSync( new URL( file, jsTo ), code );
        writeFileSync( new URL( file.replace( /\.js$/, '.min.js' ), jsTo ), min );
    }
}

async function run( what ) {

    try {
        if ( what !== 'js' )
            await build_css();

        if ( what !== 'css' )
            build_js();

        console.log( `[${ pad() }] built ${ what }` );
    }

    catch ( error ) {

        // a syntax error must not end the watcher; the message of esbuild is already printed
        if ( ! watching )
            throw error;

        console.log( `[${ pad() }] ${ what }: ${ error.message.split( '\n' )[0] }` );
    }
}

await run( 'css and js' );

if ( watching ) {

    console.log( 'Watching asset/src, press Ctrl+C to stop' );

    // one rebuild for a burst of events (editors write a file in several steps)
    const timers = {};

    for ( const [ what, dir ] of [ [ 'css', './css/' ], [ 'js', './js/' ] ] ) {

        watch( new URL( dir, src ), { recursive : true }, () => {
            clearTimeout( timers[ what ] );
            timers[ what ] = setTimeout( () => run( what ), 80 );
        } );
    }
}
