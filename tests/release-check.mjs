// Check before a release is tagged: the same things the release workflow stops for, but here and early.
//
//   npm run release:check -- 0.2.4        after the commit, before "git tag"
//   node tests/release-check.mjs --no-git 0.2.4    only the versions, no look at git and no build
//
// It checks that
//   - everything is committed (an IDE commit takes only what is staged: this is how a release lost its files),
//   - the plugin header, syncpilot_meta, the MU compatibility plugin, the README and the top of the changelog all name
//     the same version, and that this is the version of the tag you are about to make,
//   - the built files in asset/ are up to date (npm run build changes nothing),
//   - the tag does not exist yet.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root   = join( dirname( fileURLToPath( import.meta.url ) ), '..' );
const args   = process.argv.slice( 2 );
const noGit  = args.includes( '--no-git' );
const wanted = ( args.find( a => ! a.startsWith( '--' ) ) || '' ).replace( /^v/, '' );

const read = file => readFileSync( join( root, file ), 'utf8' );
const git  = ( ...a ) => execFileSync( 'git', a, { cwd : root, encoding : 'utf8' } ).trimEnd();

let failed = 0;

const check = ( label, ok, info = '' ) => {

    ok || failed++;
    console.log( ( ok ? 'ok   ' : 'FAIL ' ) + label + ( info ? '  | ' + info : '' ) );
};

const first = ( text, pattern ) => ( text.match( pattern ) || [] )[1];

const versions = {
    'plugin header'           : first( read( 'sync-pilot.php' ), /^[\s*]*Version:\s*(\S+)/m ),
    'syncpilot_meta'          : first( read( 'sync-pilot.php' ), /\['version'\]\s*=\s*'([^']+)'/ ),
    'MU compatibility plugin' : first( read( 'compatibility/sync-pilot-compatibility.php' ), /^[\s*]*Version:\s*(\S+)/m ),
    'README status'           : first( read( 'README.md' ), /^Version (\S+) \(/m ),
    'top of the changelog'    : first( read( 'changelog.txt' ), /^= Version (\S+) =/m ),
};

console.log( 'versions' );

const names = Object.keys( versions );
const same  = names.every( name => versions[name] && versions[name] === versions[names[0]] );

for ( const name of names )
    check( name.padEnd( 25 ) + ' ' + ( versions[name] || 'not found' ), versions[name] === versions[names[0]] && !! versions[name] );

check( 'all the same', same );

if ( wanted )
    check( `the same as the tag you are about to make (${ wanted })`, same && versions[names[0]] === wanted );

else
    console.log( 'note  give the version of the tag as an argument to compare it: npm run release:check -- 0.2.4' );

if ( ! noGit ) {

    console.log( '\ngit' );

    const dirty = git( 'status', '--porcelain' );

    check( 'everything is committed (no changed, staged or new files)', dirty === '', dirty ? '\n' + dirty.split( '\n' ).slice( 0, 12 ).join( '\n' ) : '' );

    // the built files: a build must not change anything
    execFileSync( 'npm', [ 'run', 'build' ], { cwd : root, stdio : 'ignore' } );

    const built = git( 'status', '--porcelain', '--', 'asset/css', 'asset/js' );

    check( 'the built files in asset/ are up to date', built === '', built );

    if ( wanted ) {

        const tags = git( 'tag', '-l', 'v' + wanted, wanted );

        check( `the tag v${ wanted } does not exist yet`, tags === '', tags );
    }
}

console.log( failed ? `\n${ failed } problem(s): do not tag yet` : '\nall fine: you can tag' );

process.exit( failed ? 1 : 0 );
