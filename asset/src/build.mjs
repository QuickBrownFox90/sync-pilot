// Builds asset/css and asset/js from asset/src, with esbuild.
//
//   npm run build   build once (this is what the release workflow checks)
//   npm run dev     build, then watch asset/src and build again on every change
//
// CSS: asset/src/css/main.css joins the modules with @import -> styles.css (readable) and styles.min.css.
// JS:  one file for the whole admin page, asset/js/sync-pilot.js (readable) and sync-pilot.min.js. It is made of the
//      scripts in asset/src/js in this order: common, script, media-files. script.js imports the modules in
//      asset/src/js/modules and esbuild joins them with it into one plain script; the others are plain scripts and are
//      taken as they are. The code relies on global names (common.js defines some that the others use, and the media
//      files part is called by script.js), so the parts are only put behind each other. The minified file keeps
//      global names.
import { readFileSync, writeFileSync, mkdirSync, rmSync, watch } from 'node:fs';
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

// the parts of the script in the order in which they run; a part that imports modules is bundled first
const parts   = [ 'common.js', 'script.js', 'media-files.js' ];
const bundled = [ 'script.js' ];

async function build_js() {

    // nothing of an older build stays behind
    rmSync( jsTo, { recursive : true, force : true } );
    mkdirSync( jsTo, { recursive : true } );

    const sources = [];

    for ( const file of parts ) {

        const entry = new URL( file, jsFrom ).pathname;

        if ( bundled.includes( file ) ) {

            const result = await build( { entryPoints : [ entry ], bundle : true, format : 'iife', charset : 'utf8', legalComments : 'inline', logLevel : 'warning', write : false, outdir : '/' } );

            sources.push( result.outputFiles[0].text );
            continue;
        }

        sources.push( readFileSync( entry, 'utf8' ) );
    }

    const code = sources.map( text => text.replace( /\s+$/, '' ) ).join( '\n\n' ) + '\n';

    writeFileSync( new URL( 'sync-pilot.js', jsTo ), code );
    writeFileSync( new URL( 'sync-pilot.min.js', jsTo ), transformSync( code, { minify : true, charset : 'utf8', legalComments : 'inline' } ).code );
}

async function run( what ) {

    try {
        if ( what !== 'js' )
            await build_css();

        if ( what !== 'css' )
            await build_js();

        console.log( `[${ pad() }] built ${ what }` );
    } catch ( error ) {

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

            clearTimeout( timers[what] );
            timers[what] = setTimeout( () => run( what ), 80 );
        } );
    }
}
