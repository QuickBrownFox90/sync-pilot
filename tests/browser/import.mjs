// The import of a dump file, clicked through in a headless browser: the form with the choice of the dump, the progress box
// with its phases, and the result in the database. The dump is the database of the second test site, which is imported into
// the first one; the first site is put back afterwards from a dump that is made before.
//
//   node tests/browser/import.mjs --yes            import of a plain dump, no backup
//   node tests/browser/import.mjs --yes --gzip     the same with a gzip dump (it is unpacked first) and a backup
//   node tests/browser/import.mjs --yes --cancel   cancel while the dump is loaded: nothing is changed, nothing is left
//   node tests/browser/import.mjs --yes --upload   the dump is uploaded in the page (in parts of 64 KB, compressed in the browser) and removed after the import
//   node tests/browser/import.mjs --yes --upload --plain   the same without the compression (--gzip: a gzip file is uploaded as it is)
//   node tests/browser/import.mjs --yes --restore   import with a backup, then restore that backup from the list of backups: the first site is as before
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
const restore = process.argv.includes( '--restore' );
const backup  = process.argv.includes( '--gzip' ) || process.argv.includes( '--backup' ) || restore;
const cancel = process.argv.includes( '--cancel' );
const shots  = process.argv.includes( '--shots' );
const upload = process.argv.includes( '--upload' );
const plain  = process.argv.includes( '--plain' );

const { check, section, finish } = checks();

const page      = `${ config.site }/wp-admin/tools.php?page=sync-pilot&syncpilot-profile=-1`;

// the folder of the dumps is in the uploads folder: the web server does not see the temporary folder of this user
const uploads   = wp( config.wp, 'echo wp_upload_dir()["basedir"];' );
const work      = join( uploads, 'syncpilot-import-test' );
const importDir = join( work, 'imports' );
const reference = join( tmpdir(), 'syncpilot-import-test-before.sql' );
const muPlugin  = join( config.wp, 'wp-content', 'mu-plugins', 'syncpilot-test-import.php' );

// the file that is imported is gzip when it is one, or when the page compressed it
const inFolderGzip = gzip || ( process.argv.includes( '--upload' ) && ! process.argv.includes( '--plain' ) );
const name      = gzip ? 'remote-site.sql.gz' : 'remote-site.sql';

// an upload takes the file from a folder that is not the folder of the dumps
const source    = join( work, 'source' );
const dumpDir   = upload ? source : importDir;

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
mkdirSync( source, { recursive : true } );
chmodSync( work, 0o777 ); chmodSync( importDir, 0o777 );

section( 'preparation: a dump of the second site, a dump of the first to put it back' );

dump( config.remoteWp, join( dumpDir, 'remote-site.sql' ) );

if ( gzip )
    execFileSync( 'gzip', [ '-f', join( dumpDir, 'remote-site.sql' ) ] );

dump( config.wp, reference );
writeFileSync( muPlugin, `<?php\n// SyncPilot test only: the folder for the dumps and a short time for a request of the import\nadd_filter( 'syncpilot_import_dir', fn() => ${ JSON.stringify( importDir ) } );\nadd_filter( 'syncpilot_import_step_seconds', fn() => 0.3 );\n` );
chmodSync( muPlugin, 0o644 );

const before     = sums( config.wp );
const remoteSums = counts( config.remoteWp );
const logDir     = join( wp( config.wp, 'echo wp_upload_dir()["basedir"];' ), 'sync-pilot' );

// states of earlier imports that were not finished (a browser that was closed): they are not of this test
const statesBefore  = existsSync( join( logDir, 'logs' ) ) ? readdirSync( join( logDir, 'logs' ) ).filter( f => f.startsWith( 'import-' ) ) : [];
const newStates     = () => readdirSync( join( logDir, 'logs' ) ).filter( f => f.startsWith( 'import-' ) && ! statesBefore.includes( f ) );
const exportDir     = wp( config.wp, 'global $syncpilot; echo $syncpilot->get_upload_info( "path" );' ); // exports and backups (since 0.4.4)
const backupsBefore = existsSync( exportDir ) ? readdirSync( exportDir ).filter( f => /-backup-.*\.sql/.test( f ) ) : [];

check( 'the dump is in the folder of the test', existsSync( join( dumpDir, name ) ) && statSync( join( dumpDir, name ) ).size > 100000, name );

const browser = await launch();

try {

    await browser.login();

    section( 'the form' );

    await browser.goto( page );
    check( 'no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );
    check( 'the choices are pull, push, import and export, in that order', JSON.stringify( await browser.ev( `Array.from(document.querySelectorAll('input[name=action]')).map(i => i.value)` ) ) === '["pull","push","import","savefile"]' );

    await browser.click( '#import' );

    if ( upload )
        await wait( 1500 );
    else
        await browser.waitFor( `document.querySelectorAll('.import-from-folder .import-files li').length > 0`, 10000 );

    check( 'the dump box is where the connection data are for pull and push, in the list of the import', await browser.ev( `!!document.querySelector('.import-list .import-file-wrapper') && getComputedStyle(document.querySelector('.import-file-wrapper')).display !== 'none'` ) );
    check( 'the connection box and the choice of tables are not shown', await browser.ev( `['.connection-info-wrapper', '.table-select-wrap', '.hide-for-import', '.media-files-options', '.connection-status'].every(s => Array.from(document.querySelectorAll(s)).every(e => e.offsetParent === null))` ) );
    check( 'the second step (find and replace, options) is open at once', await browser.ev( `document.querySelector('.step-two').offsetParent !== null && document.querySelector('#find-and-replace-sort').offsetParent !== null` ) );
    check( 'the folder is shown' + ( upload ? ', the list is empty' : ', and the dump is in the list' ), await browser.ev( `document.querySelector('.import-folder-path').textContent.includes(${ JSON.stringify( importDir ) }) && ` + ( upload ? `document.querySelectorAll('.import-from-folder .import-files input[name=import_file]').length === 0` : `Array.from(document.querySelectorAll('.import-from-folder .import-files input[name=import_file]')).some(i => i.value === ${ JSON.stringify( name ) })` ) ) );
    check( 'the choice between the folder and the upload is there, the folder is the one that is shown', await browser.ev( `document.querySelector('#import-source-folder').checked && document.querySelector('.import-from-folder').offsetParent !== null && document.querySelector('.import-from-upload').offsetParent === null` ) );
    check( 'the rows of find and replace are turned: this site is the new value, the old value is empty', await browser.ev( `document.querySelector('#old-url').value === '' && document.querySelector('#new-url').value !== '' && document.querySelector('#old-path').value === '' && document.querySelector('#new-path').value !== ''` ) );

    // a single dump is chosen at once: take the choice away, an import without a dump does not start
    if ( ! upload ) {
        check( 'a single dump that can be used is chosen at once', await browser.ev( `document.querySelectorAll('input[name=import_file]:checked').length === 1` ) );
        check( 'a file that was put into the folder is not removed after the import (the choice is off)', await browser.ev( `! document.querySelector('#import-delete-file').checked` ) );
        await browser.ev( `document.querySelector('input[name=import_file]:checked').checked = false` );
    }

    await browser.click( '.migrate-db-button' );
    await wait( 600 );

    const dialogText = await browser.ev( `(() => { const d = document.getElementById('syncpilot-dialog'); return d && d.open ? d.querySelector('.syncpilot-dialog-message').textContent : ''; })()` );

    check( 'without a dump the import does not start, the message says to choose one', dialogText !== '' && ! ( await browser.ev( `!!document.querySelector('.progress-content')` ) ), dialogText );
    await browser.ev( `(() => { const d = document.getElementById('syncpilot-dialog'); if ( d && d.open ) d.querySelector('button, .syncpilot-dialog-ok')?.click(); })()` );
    await wait( 300 );

    let chosenName = name;

    if ( upload ) {

        section( 'the upload' );

        await browser.click( '#import-source-upload' );
        check( 'the upload box is shown and the list is hidden', await browser.ev( `document.querySelector('.import-from-upload').offsetParent !== null && document.querySelector('.import-from-folder').offsetParent === null` ) );

        // an upload without a file says so
        await browser.click( '.import-upload-start' );
        await wait( 300 );
        check( 'an upload without a file says that a file is needed', await browser.ev( `document.querySelector('.import-upload-text').textContent.length > 5 && document.querySelector('.import-upload-text').classList.contains('error')` ) );

        if ( plain )
            await browser.click( '#import-upload-compress' );

        // small parts: the dump is sent in many requests
        await browser.ev( `window.syncpilot_max_request = '65536'; window.__parts = 0; jQuery(document).ajaxSend( ( e, x, s ) => { if ( s.data instanceof FormData && s.data.get('action') === 'syncpilot_import_upload' ) window.__parts++; } ); true` );

        const doc  = await browser.send( 'DOM.getDocument', {} );
        const node = await browser.send( 'DOM.querySelector', { nodeId : doc.result.root.nodeId, selector : '#import-upload-file' } );

        await browser.send( 'DOM.setFileInputFiles', { nodeId : node.result.nodeId, files : [ join( source, name ) ] } );
        await browser.click( '.import-upload-start' );

        const ended = await browser.waitFor( `!!document.querySelector('input[name=import_file]:checked') || document.querySelector('.import-upload-text').classList.contains('error')`, 120000, 200 );

        check( 'the upload ends: the file is in the list and chosen', ended && await browser.ev( `!!document.querySelector('input[name=import_file]:checked')` ), await browser.ev( `document.querySelector('.import-upload-text').textContent` ) );

        chosenName = await browser.ev( `document.querySelector('input[name=import_file]:checked').value` );

        const wanted = name.replace( /(\.sql)(\.gz)?$/, '' ) + '-u';

        check( 'the file has the name of the upload: the name of the file, -u, eight characters, the extension', new RegExp( '^' + wanted.replace( /[.]/g, '\\.' ) + '[0-9a-f]{8}\\.sql(\\.gz)?$' ).test( chosenName ), chosenName );
        check( 'a .sql file is compressed in the browser and is .sql.gz in the folder, unless that is switched off; a gzip file is sent as it is', ( gzip || ! plain ) === /\.gz$/.test( chosenName ), chosenName );

        const parts = await browser.ev( `window.__parts` );

        check( 'the file was sent in several parts', parts > 2, parts + ' parts of at most 64 KB' );

        const stored = join( importDir, chosenName );
        const text   = /\.gz$/.test( chosenName ) && ! gzip ? execFileSync( 'gzip', [ '-dc', stored ], { maxBuffer : 1 << 30 } ) : readFileSync( stored );
        const orig   = gzip ? readFileSync( join( source, name ) ) : readFileSync( join( source, name ) );

        check( 'the file in the folder has the content of the file (' + ( /\.gz$/.test( chosenName ) && ! gzip ? 'after unpacking' : 'byte for byte' ) + ')', Buffer.compare( text, orig ) === 0, text.length + ' / ' + orig.length + ' bytes' );
        check( 'the page shows the folder again with the file chosen, and the file is marked as uploaded', await browser.ev( `document.querySelector('#import-source-folder').checked && document.querySelector('input[name=import_file]:checked').getAttribute('data-uploaded') === '1' && document.querySelector('.import-from-folder .import-files .option-description').textContent.length > 0` ) );
        check( 'the choice to remove the file after the import is on for an uploaded file', await browser.ev( `document.querySelector('#import-delete-file').checked` ) );
        check( 'no part of the upload is left in the folder', ! existsSync( join( importDir, '.upload' ) ) || readdirSync( join( importDir, '.upload' ) ).length === 0 );
        check( 'no error in the page after the upload', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );
    } else
        await browser.click( `.import-from-folder .import-files input[value="${ name }"]` );

    await browser.ev( `(() => { const set = ( id, v ) => { const e = document.querySelector( id ); e.value = v; e.dispatchEvent( new Event( 'change', { bubbles : true } ) ); }; set( '#old-url', '//${ remoteHost }' ); set( '#old-path', ${ JSON.stringify( remotePath ) } ); })()` );

    if ( backup )
        await browser.click( '#create-backup' );

    check( 'the choices for an import are set: the dump, the old address and path, and the backup as asked', await browser.ev( `document.querySelector('input[name=import_file]:checked').value === ${ JSON.stringify( chosenName ) } && document.querySelector('#create-backup').checked === ${ backup }` ) );

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

        check( 'a gzip dump is unpacked (the log says so), a plain one is not', started && started[1].scope.unpack === inFolderGzip && started[1].scope.gzip === inFolderGzip, JSON.stringify( started && started[1].scope ) );

        const finished = log.findLast( e => 'Migration finished' === e[0] );

        check( 'the end of the migration has intent import, the seconds of the parts and the totals of the load', finished && 'import' === finished[1].intent && finished[1].queries_run > 100 && finished[1].bytes_imported > 100000 && 'finalize_s' in finished[1], JSON.stringify( finished && finished[1] ) );

        check( upload ? 'the uploaded file is removed from the folder after the import' : 'the file that was put into the folder is still there after the import',
            upload ? ! existsSync( join( importDir, chosenName ) ) : existsSync( join( importDir, name ) ) );

        if ( upload )
            check( 'the log says that the file was removed', messages.includes( 'Import file removed' ) && messages.includes( 'Dump uploaded' ), messages.filter( m => /file|uploaded/i.test( m ) ).join( ', ' ) );

        if ( backup ) {

            const files = readdirSync( exportDir ).filter( f => /-backup-.*\.sql$/.test( f ) && ! backupsBefore.includes( f ) );
            const text  = files.length ? readFileSync( join( exportDir, files[0] ), 'utf8' ) : '';
            const made  = ( text.match( /^CREATE TABLE `/gm ) || [] ).length;
            const wanted = Object.keys( remoteSums ).filter( t => tables( config.wp ).includes( t ) ).length;

            check( 'the backup is a file with a CREATE TABLE for the tables that the dump replaced', files.length === 1 && made > 20 && made <= wanted, files.length + ' file(s), ' + made + ' tables' );
        }
    }

    if ( restore && ! cancel ) {

        section( 'restore the backup that the import made' );

        const made  = readdirSync( exportDir ).filter( f => /-backup-.*\.sql$/.test( f ) && ! backupsBefore.includes( f ) );
        const bname = made[0];
        const btext = made.length ? readFileSync( join( exportDir, bname ), 'utf8' ) : '';

        check( 'the backup has the line for programs (kind backup, the address of this site) and the mark of the end as its last line', made.length === 1 && /^# syncpilot-header: \{.*"kind":"backup".*\}$/m.test( btext ) && btext.includes( '"home":' + JSON.stringify( config.site ) ) && /^# syncpilot-end: \{"complete":true/.test( btext.trimEnd().split( '\n' ).pop() ), made.join( ', ' ) );

        // the dump that was imported has the users, the sessions and the scheme (https) of the second site: the browser logs in again
        // on the address that the site has now
        const nowSite = wp( config.wp, 'echo home_url();' );

        await browser.login( config.wp, nowSite );
        await browser.goto( nowSite + '/wp-admin/tools.php?page=sync-pilot&syncpilot-profile=-1' );
        await browser.click( '#import' );
        await browser.click( '#import-source-backup' );
        await browser.waitFor( `Array.from(document.querySelectorAll('.import-backups input')).some(i => i.value === ${ JSON.stringify( bname ) })`, 20000 );

        check( 'the list of backups shows the backup: complete, and the address it was made on (the second site changed the scheme of this one, so it is named)', await browser.ev( `(() => { const l = Array.from(document.querySelectorAll('.import-backups input')).find(i => i.value === ${ JSON.stringify( bname ) }); return !!l && l.dataset.complete === '1' && l.parentNode.textContent.includes(${ JSON.stringify( config.site ) }) && l.dataset.source === 'backup'; })()` ) );
        check( 'the box of the folder and the upload are hidden, the choice to remove the file is not offered', await browser.ev( `document.querySelector('.import-from-folder').offsetParent === null && document.querySelector('.import-from-upload').offsetParent === null && document.querySelector('.import-from-backup').offsetParent !== null` ) );

        await browser.click( `.import-backups input[value="${ bname }"]` );

        check( 'a backup is chosen, the removal of the file is not offered and the rows of find and replace are empty', await browser.ev( `document.querySelector('input[name=import_file]:checked').value === ${ JSON.stringify( bname ) } && getComputedStyle(document.querySelector('.import-delete-file')).display === 'none' && document.querySelector('#old-url').value === ''` ) );

        await browser.click( '.migrate-db-button' );
        await browser.waitFor( `!!document.querySelector('.progress-content')`, 20000, 100 );
        await browser.waitFor( `getComputedStyle(document.querySelector('.close-progress-content')).display !== 'none'`, 300000, 200 );

        const back = await browser.ev( `({ title : document.querySelector('.progress-title').textContent, error : document.querySelector('.progress-text').classList.contains('migration-error') })` );

        check( 'the restore ends without an error', /complete|abgeschlossen/i.test( back.title ) && ! back.error, back.title );

        const after = sums( config.wp );
        const diff  = Object.keys( before ).filter( t => ! /usermeta$|options$/.test( t ) && before[t] !== after[t] );

        check( 'every table that the backup holds is as it was before the import (the checksum of every table, the login and the options aside)', diff.length === 0, diff.slice( 0, 5 ).join( ', ' ) );
        check( 'no temporary table is left', ! tables( config.wp ).some( t => t.startsWith( '_mig_' ) ) );
        check( 'the backup is still there', existsSync( join( exportDir, bname ) ) );

        // the link "Remove" behind a backup: the dialog asks, a cancel keeps it, a backup that is too new is refused, then it is gone
        // (the restore replaced the users and the sessions: the browser logs in again)
        await browser.login( config.wp, nowSite );
        await browser.goto( nowSite + '/wp-admin/tools.php?page=sync-pilot&syncpilot-profile=-1' );
        await browser.click( '#import' );
        await browser.click( '#import-source-backup' );
        await browser.waitFor( `Array.from(document.querySelectorAll('.import-backups input')).some(i => i.value === ${ JSON.stringify( bname ) })`, 20000 );

        const link = `.import-backups .import-file-delete[data-file="${ bname }"]`;

        check( 'a link "Remove" is behind the backup', await browser.ev( `!!document.querySelector(${ JSON.stringify( link ) })` ) );

        await browser.click( link, 300 );
        check( 'it asks in the dialog of the page', await browser.ev( `(() => { const d = document.getElementById('syncpilot-dialog'); return !! d && d.open && d.querySelector('.syncpilot-dialog-message').textContent.includes(${ JSON.stringify( bname ) }); })()` ) );
        await browser.click( '.syncpilot-dialog-cancel', 300 );
        check( 'a cancel keeps the backup', existsSync( join( exportDir, bname ) ) );

        await browser.click( link, 300 );
        await browser.click( '.syncpilot-dialog-ok', 600 );
        check( 'a backup that was written a moment ago is refused (the answer is an alert) and stays', existsSync( join( exportDir, bname ) ) && await browser.ev( `(() => { const d = document.getElementById('syncpilot-dialog'); return !! d && d.open; })()` ) );
        await browser.click( '.syncpilot-dialog-ok', 300 );

        // the file belongs to the web server, so its time cannot be set from here: the minimum age is taken away for the site
        writeFileSync( muPlugin, readFileSync( muPlugin, 'utf8' ) + `add_filter( 'syncpilot_import_backup_min_age', fn() => 0 );\n` );
        await wait( 3000 ); // the web server reads a changed file of its cache every two seconds

        await browser.click( link, 300 );
        await browser.click( '.syncpilot-dialog-ok', 800 );
        const gone = ! existsSync( join( exportDir, bname ) );
        check( 'an older backup is removed: the file is gone and the list no longer has it', gone && await browser.ev( `!Array.from(document.querySelectorAll('.import-backups input')).some(i => i.value === ${ JSON.stringify( bname ) })` ), `file gone: ${ gone }` );
        check( 'no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );
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

    const putBack = sums( config.wp );
    const unlike  = Object.keys( { ...before, ...putBack } ).filter( t => before[t] !== putBack[t] );

    check( 'the first site is as before (the checksum of every table)', unlike.length === 0, extra.length + ' extra tables dropped' + ( unlike.length ? ', different: ' + unlike.join( ', ' ) : '' ) );

    rmSync( work, { recursive : true, force : true } );
    rmSync( reference, { force : true } );
}

process.exit( finish() );
