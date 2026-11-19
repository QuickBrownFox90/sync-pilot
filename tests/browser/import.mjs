// The import of a dump file, clicked through in a headless browser: the form with the choice of the dump, the progress box
// with its phases, and the result in the database. The dump is the database of the second test site, which is imported into
// the first one; the first site is put back afterwards from a dump that is made before.
//
//   node tests/browser/import.mjs --yes            import of a plain dump, no backup
//   node tests/browser/import.mjs --yes --gzip     the same with a gzip dump (it is unpacked first) and a backup
//   node tests/browser/import.mjs --yes --cancel   cancel while the dump is loaded: nothing is changed, nothing is left
//   node tests/browser/import.mjs --yes --shots    screenshots of the form and the progress box (folder: see lib.mjs)
//
// The first test site is overwritten (and put back), so --yes is required. The folder for the dumps of that site is not
// writable for the user of the command (it belongs to the web server), so a folder of the test is used instead: a file in
// the mu-plugins folder of the site sets it (and a short time for a request of the import) and is removed at the end.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, checks, config, need, wp, wait } from './lib.mjs';

need( 'wp', 'site', 'remoteWp', 'remoteSite' );

if ( ! process.argv.includes( '--yes' ) ) {
    console.log( 'This test overwrites the database of the first test site (' + config.wp + ') and puts it back afterwards. Run it with --yes.' );
    process.exit( 1 );
}

const gzip   = process.argv.includes( '--gzip' );
const backup = process.argv.includes( '--gzip' ) || process.argv.includes( '--backup' );
const cancel = process.argv.includes( '--cancel' );
const shots  = process.argv.includes( '--shots' );

const { check, section, finish } = checks();

const page      = `${ config.site }/wp-admin/tools.php?page=sync-pilot&syncpilot-profile=-1`;

// the folder of the dumps is in the uploads folder: the web server does not see the temporary folder of this user
const uploads   = wp( config.wp, 'echo wp_upload_dir()["basedir"];' );
const work      = join( uploads, 'syncpilot-import-test' );
const importDir = join( work, 'imports' );
const reference = join( tmpdir(), 'syncpilot-import-test-before.sql' );
const muPlugin  = join( config.wp, 'wp-content', 'mu-plugins', 'syncpilot-test-import.php' );
const name      = gzip ? 'remote-site.sql.gz' : 'remote-site.sql';

const dump  = ( path, file ) => execFileSync( 'wp', [ '--path=' + path, 'db', 'export', file, '--quiet' ], { stdio : [ 'ignore', 'pipe', 'ignore' ] } );
const load  = ( path, file ) => execFileSync( 'wp', [ '--path=' + path, 'db', 'import', file ], { stdio : [ 'ignore', 'pipe', 'ignore' ] } );
const query = ( path, sql ) => execFileSync( 'wp', [ '--path=' + path, 'db', 'query', sql, '--skip-column-names' ], { encoding : 'utf8', stdio : [ 'ignore', 'pipe', 'ignore' ] } ).trim();

const tables = path => execFileSync( 'wp', [ '--path=' + path, 'db', 'tables', '--all-tables' ], { encoding : 'utf8', stdio : [ 'ignore', 'pipe', 'ignore' ] } ).trim().split( '\n' );
const sums   = path => Object.fromEntries( query( path, 'CHECKSUM TABLE ' + tables( path ).map( t => '`' + t + '`' ).join( ', ' ) ).split( '\n' ).map( line => {

    const [ n, s ] = line.split( '\t' );

    return [ n.replace( /^[^.]*\./, '' ), s ];
} ) );
const counts = path => JSON.parse( wp( path, 'global $wpdb; $o = array(); foreach ( $wpdb->get_col( "SHOW TABLES" ) as $t ) $o[$t] = (int) $wpdb->get_var( "SELECT COUNT(*) FROM `$t`" ); echo json_encode( $o );' ) );

const remoteHost = new URL( config.remoteSite ).host;
const remotePath = wp( config.remoteWp, 'echo rtrim( ABSPATH, "/" );' );
const localPath  = wp( config.wp, 'echo rtrim( ABSPATH, "/" );' );
const prefix     = wp( config.wp, 'global $wpdb; echo $wpdb->prefix;' );
const key        = wp( config.wp, 'echo get_option( "syncpilot_settings" )["key"];' );

rmSync( work, { recursive : true, force : true } );
mkdirSync( importDir, { recursive : true } );
chmodSync( work, 0o777 ); chmodSync( importDir, 0o777 );

section( 'preparation: a dump of the second site, a dump of the first to put it back' );

dump( config.remoteWp, join( importDir, 'remote-site.sql' ) );

if ( gzip )
    execFileSync( 'gzip', [ '-f', join( importDir, 'remote-site.sql' ) ] );

dump( config.wp, reference );
writeFileSync( muPlugin, `<?php\n// SyncPilot test only: the folder for the dumps and a short time for a request of the import\nadd_filter( 'syncpilot_import_dir', fn() => ${ JSON.stringify( importDir ) } );\nadd_filter( 'syncpilot_import_step_seconds', fn() => 0.3 );\n` );
chmodSync( muPlugin, 0o644 );

const before     = sums( config.wp );
const remoteSums = counts( config.remoteWp );
const logDir     = join( wp( config.wp, 'echo wp_upload_dir()["basedir"];' ), 'sync-pilot' );

// states of earlier imports that were not finished (a browser that was closed): they are not of this test
const statesBefore  = existsSync( join( logDir, 'logs' ) ) ? readdirSync( join( logDir, 'logs' ) ).filter( f => f.startsWith( 'import-' ) ) : [];
const newStates     = () => readdirSync( join( logDir, 'logs' ) ).filter( f => f.startsWith( 'import-' ) && ! statesBefore.includes( f ) );
const backupsBefore = existsSync( logDir ) ? readdirSync( logDir ).filter( f => /-backup-.*\.sql/.test( f ) ) : [];

check( 'the dump is in the folder of the test', existsSync( join( importDir, name ) ) && statSync( join( importDir, name ) ).size > 100000, name );

const browser = await launch();

try {

    await browser.login();

    section( 'the form' );

    await browser.goto( page );
    check( 'no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );
    check( 'the choices are pull, push, import and export, in that order', JSON.stringify( await browser.ev( `Array.from(document.querySelectorAll('input[name=action]')).map(i => i.value)` ) ) === '["pull","push","import","savefile"]' );

    await browser.click( '#import' );
    await browser.waitFor( `document.querySelectorAll('.import-files li').length > 0`, 10000 );

    check( 'the dump box is where the connection data are for pull and push, in the list of the import', await browser.ev( `!!document.querySelector('.import-list .import-file-wrapper') && getComputedStyle(document.querySelector('.import-file-wrapper')).display !== 'none'` ) );
    check( 'the connection box and the choice of tables are not shown', await browser.ev( `['.connection-info-wrapper', '.table-select-wrap', '.hide-for-import', '.media-files-options', '.connection-status'].every(s => Array.from(document.querySelectorAll(s)).every(e => e.offsetParent === null))` ) );
    check( 'the second step (find and replace, options) is open at once', await browser.ev( `document.querySelector('.step-two').offsetParent !== null && document.querySelector('#find-and-replace-sort').offsetParent !== null` ) );
    check( 'the folder is shown, and the dump is in the list', await browser.ev( `document.querySelector('.import-folder-path').textContent.includes(${ JSON.stringify( importDir ) }) && Array.from(document.querySelectorAll('.import-files input[name=import_file]')).some(i => i.value === ${ JSON.stringify( name ) })` ) );
    check( 'the rows of find and replace are turned: this site is the new value, the old value is empty', await browser.ev( `document.querySelector('#old-url').value === '' && document.querySelector('#new-url').value !== '' && document.querySelector('#old-path').value === '' && document.querySelector('#new-path').value !== ''` ) );

    // a single dump is chosen at once: take the choice away, an import without a dump does not start
    check( 'a single dump that can be used is chosen at once', await browser.ev( `document.querySelectorAll('input[name=import_file]:checked').length === 1` ) );
    await browser.ev( `document.querySelector('input[name=import_file]:checked').checked = false` );
    await browser.click( '.migrate-db-button' );
    await wait( 600 );

    const dialogText = await browser.ev( `(() => { const d = document.getElementById('syncpilot-dialog'); return d && d.open ? d.querySelector('.syncpilot-dialog-message').textContent : ''; })()` );

    check( 'without a dump the import does not start, the message says to choose one', dialogText !== '' && ! ( await browser.ev( `!!document.querySelector('.progress-content')` ) ), dialogText );
    await browser.ev( `(() => { const d = document.getElementById('syncpilot-dialog'); if ( d && d.open ) d.querySelector('button, .syncpilot-dialog-ok')?.click(); })()` );
    await wait( 300 );

    await browser.click( `.import-files input[value="${ name }"]` );

    await browser.ev( `(() => { const set = ( id, v ) => { const e = document.querySelector( id ); e.value = v; e.dispatchEvent( new Event( 'change', { bubbles : true } ) ); }; set( '#old-url', '//${ remoteHost }' ); set( '#old-path', ${ JSON.stringify( remotePath ) } ); })()` );

    if ( backup )
        await browser.click( '#create-backup' );

    check( 'the choices for an import are set: the dump, the old address and path, and the backup as asked', await browser.ev( `document.querySelector('input[name=import_file]:checked').value === ${ JSON.stringify( name ) } && document.querySelector('#create-backup').checked === ${ backup }` ) );

    if ( shots )
        await browser.shot( 'import-form' );

    section( cancel ? 'cancel while the dump is loaded' : 'the import' );

    // every text of the box is noted: the phases are short, polling would miss one
    await browser.ev( `window.__texts = []; new MutationObserver( () => { const e = document.querySelector('.progress-text'); if ( e && e.textContent && window.__texts[ window.__texts.length - 1 ] !== e.textContent ) window.__texts.push( e.textContent ); } ).observe( document.body, { childList : true, subtree : true, characterData : true } );` );
    await browser.click( '.migrate-db-button' );
    await browser.waitFor( `!!document.querySelector('.progress-content') && /Check|Prüf|Unpack|Entpack|Backing|Load|Lade|Replac|Ersetz/i.test(document.querySelector('.progress-text').textContent)`, 20000, 100 );

    const texts = new Set();
    let shotLoad = false;
    const started = Date.now();

    while ( Date.now() - started < 300000 ) {

        const now = await browser.ev( `({ title : document.querySelector('.progress-title').textContent, text : document.querySelector('.progress-text').textContent, done : getComputedStyle(document.querySelector('.close-progress-content')).display !== 'none', width : document.querySelector('.progress-bar').style.width })` );

        texts.add( now.text.replace( /\d+% - /, '' ).replace( /\(.*\)/, '' ).trim() );

        if ( shots && ! shotLoad && /Load|Lade/i.test( now.text ) ) {
            await browser.shot( 'import-loading' );
            shotLoad = true;
        }

        if ( cancel && /Load|Lade/i.test( now.text ) && /[1-9]\d?% /.test( now.text ) ) {
            await browser.click( '.cancel' );
            await browser.waitFor( `getComputedStyle(document.querySelector('.close-progress-content')).display !== 'none'`, 60000, 200 );
            break;
        }

        if ( now.done )
            break;

        await wait( 150 );
    }

    const end = await browser.ev( `({ title : document.querySelector('.progress-title').textContent, text : document.querySelector('.progress-text').textContent, error : document.querySelector('.progress-text').classList.contains('migration-error') })` );

    if ( shots )
        await browser.shot( 'import-end' );

    for ( const t of await browser.ev( `window.__texts` ) )
        texts.add( t.replace( /\d+% - /, '' ).replace( /\(.*\)/, '' ).trim() );

    console.log( 'phases seen: ' + Array.from( texts ).map( t => t.replace( /"[^"]*"/g, '"…"' ) ).filter( ( t, i, all ) => all.indexOf( t ) === i ).join( ' | ' ) );

    if ( cancel ) {

        check( 'the title says that the migration is cancelled', /cancel|abgebrochen/i.test( end.title ) && ! end.error, end.title + ' / ' + end.text );

        // the login of the browser is a row in usermeta, and the options hold transients: they change without the import
        const after  = sums( config.wp );
        const moved  = Object.keys( before ).filter( t => ! /usermeta$|options$/.test( t ) && before[t] !== after[t] );

        check( 'nothing of the first site was changed (the checksum of every table, the login and the options aside)', moved.length === 0 && Object.keys( after ).length === Object.keys( before ).length, moved.join( ', ' ) );
        check( 'no temporary table is left', ! tables( config.wp ).some( t => t.startsWith( '_mig_' ) ) );
        check( 'no state of the import, no unpacked copy', newStates().length === 0 && ( ! existsSync( join( importDir, '.work' ) ) || readdirSync( join( importDir, '.work' ) ).length === 0 ) );
        check( 'the log has the end of the migration as cancelled', JSON.parse( wp( config.wp, 'echo json_encode( array_map( fn( $e ) => $e["message"] . ":" . ( $e["context"]["outcome"] ?? "" ), SyncPilot_Logger::entries() ) );' ) ).some( m => /^Migration cancelled:cancelled/.test( m ) ) );
    } else {

        check( 'the import ends without an error: the title says complete', /complete|abgeschlossen/i.test( end.title ) && ! end.error, end.title + ' / ' + end.text );
        check( 'the box showed the phases: check, ' + ( backup ? 'backup, ' : '' ) + 'load, replace', [ ...texts ].some( t => /Check|Prüf/i.test( t ) ) && ( ! backup || [ ...texts ].some( t => /Backing|Sicher/i.test( t ) ) ) && [ ...texts ].some( t => /Load|Lade/i.test( t ) ) && [ ...texts ].some( t => /Replac|Ersetz/i.test( t ) ), [ ...texts ].join( ' | ' ) );
        check( 'no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );

        const now = counts( config.wp );
        const wrong = Object.keys( remoteSums ).filter( t => ! /options$|usermeta$|actionscheduler|sessions|syncpilot_alter/.test( t ) && now[t] !== remoteSums[t] );

        check( 'every table of the second site is in the first one with the same number of rows (options and sessions aside)', wrong.length === 0 && Object.keys( remoteSums ).every( t => t in now ), wrong.slice( 0, 4 ).map( t => t + ' ' + now[t] + '/' + remoteSums[t] ).join( ', ' ) );
        check( 'the address of this site is in the options: siteurl and home', wp( config.wp, 'echo get_option("siteurl") . "|" . get_option("home");' ).replace( /https?:/g, '' ) === config.site.replace( /^https?:/, '' ) + '|' + config.site.replace( /^https?:/, '' ), wp( config.wp, 'echo get_option("siteurl") . "|" . get_option("home");' ) );

        const left = JSON.parse( wp( config.wp, `global $wpdb; $host = ${ JSON.stringify( remoteHost ) }; $o = array(); foreach ( $wpdb->get_results( "SHOW TABLES", ARRAY_N ) as $t ) { $t = $t[0]; $cols = array_filter( $wpdb->get_results( "SHOW COLUMNS FROM \`$t\`", ARRAY_A ), fn( $c ) => preg_match( '/char|text|blob|json/i', $c["Type"] ) && "guid" !== $c["Field"] ); if ( ! $cols ) continue; $w = implode( " OR ", array_map( fn( $c ) => "\`" . $c["Field"] . "\` LIKE '%" . $wpdb->esc_like( $host ) . "%'", $cols ) ); $n = (int) $wpdb->get_var( "SELECT COUNT(*) FROM \`$t\` WHERE $w" ); if ( $n ) $o[$t] = $n; } echo json_encode( $o );` ) );

        // the settings of SyncPilot are kept from this site and can hold the address of the second one (a saved profile)
        const settingsLeft = Number( wp( config.wp, `global $wpdb; echo (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name = 'syncpilot_settings' AND option_value LIKE '%" . $wpdb->esc_like( ${ JSON.stringify( remoteHost ) } ) . "%'" );` ) );

        if ( left[prefix + 'options'] === settingsLeft )
            delete left[prefix + 'options'];

        check( 'the address of the second site is not left in a value (the GUIDs aside, and the settings of SyncPilot of this site)', Object.keys( left ).length === 0, JSON.stringify( left ) );
        check( 'the key of SyncPilot of this site is kept (the settings are not replaced)', wp( config.wp, 'echo get_option( "syncpilot_settings" )["key"];' ) === key );

        const leftover = [ ...tables( config.wp ).filter( t => t.startsWith( '_mig_' ) || t.startsWith( '_old_' ) ), ...newStates(), ...( existsSync( join( importDir, '.work' ) ) ? readdirSync( join( importDir, '.work' ) ) : [] ) ];

        check( 'no temporary table, no state of the import, no unpacked copy are left', leftover.length === 0, leftover.join( ', ' ) );

        const log = JSON.parse( wp( config.wp, 'echo json_encode( array_map( fn( $e ) => array( $e["message"], $e["context"] ), SyncPilot_Logger::entries() ) );' ) );
        const messages = log.map( e => e[0] );

        check( 'the log has the migration: started, scanned, loaded, replaced, finished', [ 'Migration started', 'Import scanned', 'Import loaded', 'Import replaced', 'Migration finished' ].every( m => messages.includes( m ) ), messages.filter( ( m, i ) => messages.indexOf( m ) === i ).join( ', ' ) );

        const started = log.findLast( e => 'Migration started' === e[0] && 'import' === e[1].intent );

        check( 'a gzip dump is unpacked (the log says so), a plain one is not', started && started[1].scope.unpack === gzip && started[1].scope.gzip === gzip, JSON.stringify( started && started[1].scope ) );

        const finished = log.findLast( e => 'Migration finished' === e[0] );

        check( 'the end of the migration has intent import, the seconds of the parts and the totals of the load', finished && 'import' === finished[1].intent && finished[1].queries_run > 100 && finished[1].bytes_imported > 100000 && 'finalize_s' in finished[1], JSON.stringify( finished && finished[1] ) );

        if ( backup ) {

            const files = readdirSync( logDir ).filter( f => /-backup-.*\.sql$/.test( f ) && ! backupsBefore.includes( f ) );
            const text  = files.length ? readFileSync( join( logDir, files[0] ), 'utf8' ) : '';
            const made  = ( text.match( /^CREATE TABLE `/gm ) || [] ).length;
            const wanted = Object.keys( remoteSums ).filter( t => tables( config.wp ).includes( t ) ).length;

            check( 'the backup is a file with a CREATE TABLE for the tables that the dump replaced', files.length === 1 && made > 20 && made <= wanted, files.length + ' file(s), ' + made + ' tables' );
        }
    }
} finally {

    section( 'put the first site back' );

    await browser.close();

    rmSync( muPlugin, { force : true } );

    // the tables of the dump that did not exist before and the backup of the test are removed, then the dump of the start is loaded
    try { load( config.wp, reference ); } catch ( error ) { console.log( 'FAIL the first site could not be put back: ' + error.message ); }

    const extra = tables( config.wp ).filter( t => ! before[t] );

    for ( const t of extra )
        query( config.wp, 'DROP TABLE IF EXISTS `' + t + '`' );

    check( 'the first site is as before (the checksum of every table)', JSON.stringify( sums( config.wp ) ) === JSON.stringify( before ), extra.length + ' extra tables dropped' );

    rmSync( work, { recursive : true, force : true } );
    rmSync( reference, { force : true } );
}

process.exit( finish() );
