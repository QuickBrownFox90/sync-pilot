// A complete push through the interface from one test installation to the other, then everything is put back.
//
//   node tests/browser/push.mjs --yes                  a few small tables (posts, postmeta, terms, ...), about a minute
//   node tests/browser/push.mjs --yes --full           all tables
//   node tests/browser/push.mjs --yes --media          with the media files (files that are new on the other site are copied
//                                                      into its uploads folder and removed again at the end)
//   node tests/browser/push.mjs --yes --backup         with the backup of the receiving site before the data is replaced (the
//                                                      stage "backup", then the switch to the migration); the backup file is
//                                                      removed again through the plugin of that site
//   node tests/browser/push.mjs --yes --pull           the other direction: the second site is pulled into the first one
//                                                      (it permits pulls for the time of the test); the media files of
//                                                      the first site are the ones that are taken away and come back
//
// THIS OVERWRITES THE DATABASES OF BOTH TEST SITES. They exist only for tests. A reference backup of both is kept in
// ~/.cache/syncpilot-tests/<id of the pair of sites> (or SP_BACKUP_DIR); it is made from the current state when it does not exist yet (or with
// --refresh-baseline), together with the checksum of every table. Every run starts by putting the sites back to it and
// does the same at the end, so the sites are always in the same state, and the checksums of all tables are compared with
// the ones from before. Only the tables whose checksum differs are imported again (importing 87 tables takes 11 s), all
// of them with --full or when the list of tables is not the same. Without --yes it only says
// what it would do. Never point it at a site that is not a test site.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { launch, checks, config, need, wp, wait, full, quickTables } from './lib.mjs';

need( 'wp', 'site', 'remoteWp', 'remoteSite' );

const { check, section, finish } = checks();

if ( ! process.argv.includes( '--yes' ) ) {

    console.log( pull ? `Pull from ${ config.remoteSite } (${ config.remoteWp }) into ${ config.site } (${ config.wp }).` : `Push from ${ config.site } (${ config.wp }) to ${ config.remoteSite } (${ config.remoteWp }).` );
    console.log( 'The databases of both sites are overwritten and put back from the reference backup afterwards. Run again with --yes to do it.' );
    process.exit( 0 );
}

const withMedia = process.argv.includes( '--media' );
const pull      = process.argv.includes( '--pull' );
const backup    = process.argv.includes( '--backup' );

// the site that receives the data, and the one it comes from (the names of the sides in the checksums: source is config.wp)
const receiver = pull ? config.wp : config.remoteWp;
const sender   = pull ? config.remoteWp : config.wp;
const received = pull ? 'source' : 'target';

// the tables that are pushed (all of them with --full)
const prefix = wp( config.wp, 'global $wpdb; echo $wpdb->prefix;' );
const chosen = full ? null : quickTables( prefix );

// the reference backup belongs to this pair of sites: another pair gets another folder, so that a backup is never put into the wrong site
const dir = process.env.SP_BACKUP_DIR || join( homedir(), '.cache', 'syncpilot-tests', createHash( 'sha1' ).update( config.wp + '|' + config.remoteWp ).digest( 'hex' ).slice( 0, 12 ) );

mkdirSync( dir, { recursive : true } );

const dump = ( path, file ) => execFileSync( 'wp', [ '--path=' + path, 'db', 'export', file, '--quiet' ], { stdio : [ 'ignore', 'pipe', 'ignore' ] } );
const load = ( path, file ) => execFileSync( 'wp', [ '--path=' + path, 'db', 'import', file ], { stdio : [ 'ignore', 'pipe', 'ignore' ] } );

// the checksum of every table, asked of the database itself: WordPress is not started for it, because starting it with all
// its plugins can change rows (a checksum must come from the state of the database and from nothing else)
const sums = path => {

    const tables = execFileSync( 'wp', [ '--path=' + path, 'db', 'tables', '--all-tables' ], { encoding : 'utf8', stdio : [ 'ignore', 'pipe', 'ignore' ] } ).trim().split( '\n' );
    const out    = execFileSync( 'wp', [ '--path=' + path, 'db', 'query', 'CHECKSUM TABLE ' + tables.map( t => '`' + t + '`' ).join( ', ' ) ], { encoding : 'utf8', stdio : [ 'ignore', 'pipe', 'ignore' ], maxBuffer : 16 * 1024 * 1024 } ).trim().split( '\n' ).slice( 1 );

    return Object.fromEntries( out.map( line => {

        const [ name, sum ] = line.split( '\t' );

        return [ name.replace( /^[^.]*\./, '' ), sum ];
    } ) );
};

// files in the uploads folder of a site (without the folder of the exports), relative to it
const files  = path => JSON.parse( wp( path, '$d = wp_upload_dir()["basedir"]; $o = array(); if ( is_dir( $d ) ) foreach ( new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $d, FilesystemIterator::SKIP_DOTS ) ) as $f ) { $r = substr( $f->getPathname(), strlen( $d ) + 1 ); if ( $f->isFile() && 0 !== strpos( $r, "sync-pilot/" ) ) $o[] = $r; } echo json_encode( $o );' ) );

// the files of the first attachments of a site: the original and all sizes, relative to the uploads folder
const attachmentFiles = ( path, number ) => JSON.parse( wp( path, '$d = wp_upload_dir()["basedir"]; $o = array(); foreach ( get_posts( array( "post_type" => "attachment", "posts_per_page" => ' + Number( number ) + ', "orderby" => "ID", "order" => "ASC", "post_status" => "any" ) ) as $p ) { $f = get_post_meta( $p->ID, "_wp_attached_file", true ); if ( ! $f ) continue; $o[] = $f; $m = wp_get_attachment_metadata( $p->ID ); if ( ! empty( $m["sizes"] ) ) foreach ( $m["sizes"] as $s ) $o[] = ( dirname( $f ) === "." ? "" : dirname( $f ) . "/" ) . $s["file"]; } echo json_encode( array_values( array_filter( array_unique( $o ), fn( $r ) => is_file( "$d/$r" ) ) ) );' ) );

// copy files from one site to the other (to put back what a test removed)
const copyBack = ( from, to, list ) => wp( to, '$src = ' + JSON.stringify( wp( from, 'echo wp_upload_dir()["basedir"];' ) ) + '; $d = wp_upload_dir()["basedir"]; foreach ( json_decode( base64_decode( "' + Buffer.from( JSON.stringify( list ) ).toString( 'base64' ) + '" ), true ) as $r ) { if ( false === strpos( $r, ".." ) && is_file( "$src/$r" ) && ! is_file( "$d/$r" ) ) { wp_mkdir_p( dirname( "$d/$r" ) ); copy( "$src/$r", "$d/$r" ); } }' );
const remove   = ( path, list ) => wp( path, '$d = wp_upload_dir()["basedir"]; $l = json_decode( base64_decode( "' + Buffer.from( JSON.stringify( list ) ).toString( 'base64' ) + '" ), true ); foreach ( $l as $r ) { if ( false === strpos( $r, ".." ) && is_file( "$d/$r" ) ) { unlink( "$d/$r" ); $p = dirname( "$d/$r" ); while ( $p !== $d && 0 === strpos( $p, $d ) && @rmdir( $p ) ) $p = dirname( $p ); } }' );
const counts   = path => JSON.parse( wp( path, 'global $wpdb; $o = array(); foreach ( $wpdb->get_col( "SHOW TABLES" ) as $t ) $o[$t] = (int) $wpdb->get_var( "SELECT COUNT(*) FROM `$t`" ); echo json_encode( $o );' ) );

// the backups that a site made (the plugin writes them into its folder in the uploads)
const backupDir   = path => join( wp( path, 'echo wp_upload_dir()["basedir"];' ), 'sync-pilot' );
const backupFiles = path => existsSync( backupDir( path ) ) ? readdirSync( backupDir( path ) ).filter( f => /-backup-.*\.sql(\.gz)?$/.test( f ) ) : [];

section( 'reference backup (' + dir + ')' );

const source = join( dir, 'source.sql' ), target = join( dir, 'target.sql' ), reference = join( dir, 'sums.json' );

// import only some tables of a dump: the header of the file, then the parts of the tables that are wanted
const loadTables = ( path, file, tables ) => {

    const parts  = readFileSync( file, 'utf8' ).split( /(?=^-- Table structure for table `)/m );
    const wanted = new Set( tables );
    const slice  = [ parts[0], ...parts.slice( 1 ).filter( part => wanted.has( part.match( /^-- Table structure for table `([^`]+)`/ )[1] ) ) ];

    writeFileSync( join( dir, 'slice.sql' ), slice.join( '' ) );
    load( path, join( dir, 'slice.sql' ) );
};

// put a site back to the reference: the tables that differ (the options are written by wp-cli itself and do not count),
// or everything
const putBack = ( path, file, side ) => {

    const wanted = existsSync( reference ) ? JSON.parse( readFileSync( reference, 'utf8' ) )[side] : null;
    const now    = wanted && ! full ? sums( path ) : null;

    if ( ! now || Object.keys( now ).length !== Object.keys( wanted ).length || Object.keys( wanted ).some( t => ! ( t in now ) ) ) {
        load( path, file );

        return 'all tables';
    }

    const differ = Object.keys( wanted ).filter( t => wanted[t] !== now[t] && ! t.endsWith( 'options' ) );

    if ( differ.length )
        loadTables( path, file, differ );

    return differ.length ? differ.length + ' tables' : 'nothing to import';
};

if ( process.argv.includes( '--refresh-baseline' ) || ! existsSync( source ) || ! existsSync( target ) ) {

    dump( config.wp, source );
    dump( config.remoteWp, target );
    writeFileSync( reference, JSON.stringify( { source : sums( config.wp ), target : sums( config.remoteWp ) } ) );
    console.log( 'made from the current state of both sites' );
} else if ( ! existsSync( reference ) ) {

    // a backup from before the checksums were kept: import it once and note them
    load( config.wp, source );
    load( config.remoteWp, target );
    writeFileSync( reference, JSON.stringify( { source : sums( config.wp ), target : sums( config.remoteWp ) } ) );
    console.log( 'both sites are back in the state of the reference backup (checksums noted)' );
} else {

    console.log( `both sites are back in the state of the reference backup (source: ${ putBack( config.wp, source, 'source' ) }, target: ${ putBack( config.remoteWp, target, 'target' ) })` );
}

const before      = { source : sums( config.wp ), target : sums( config.remoteWp ) };
const filesBefore   = withMedia ? files( receiver ) : [];
const backupsBefore = backupFiles( receiver );

// media files: take the files of two attachments away from the other site, so that the push has something to copy
const takenAway = withMedia ? attachmentFiles( sender, 2 ).filter( f => filesBefore.includes( f ) ) : [];

if ( withMedia ) {

    if ( takenAway.length === 0 )
        console.log( 'WARNING: no attachment files that exist on both sites, the media part has nothing to do' );

    remove( receiver, takenAway );
}

const key    = wp( config.remoteWp, 'echo get_option( "syncpilot_settings" )["key"];' );

// a pull needs the permission on the other site (it is put back at the end)
const remoteSettings = wp( config.remoteWp, 'echo base64_encode( serialize( get_option( "syncpilot_settings" ) ) );' );

if ( pull )
    wp( config.remoteWp, '$s = get_option( "syncpilot_settings" ); $s["allow_pull"] = true; update_option( "syncpilot_settings", $s );' );

// a row that exists only on the other site: the push has to replace the table, so it must be gone afterwards (the two test
// sites are copies of each other, without it a push that sends nothing would pass as well)
const marker = 'syncpilot-test-marker';
const marked = () => wp( receiver, 'global $wpdb; echo (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $wpdb->terms WHERE slug = %s", "' + marker + '" ) );' );

wp( receiver, 'global $wpdb; $wpdb->insert( $wpdb->terms, array( "name" => "SyncPilot test marker", "slug" => "' + marker + '" ) );' );

check( 'both sites are in the state of the backup', true, `${ Object.keys( before.source ).length } and ${ Object.keys( before.target ).length } tables` );

const browser = await launch();

try {

    await browser.login();
    await browser.goto( `${ config.site }/wp-admin/tools.php?page=sync-pilot&syncpilot-profile=-1` );

    section( pull ? 'pull' : 'push' );

    await browser.click( `input[name=action][value=${ pull ? 'pull' : 'push' }]` );
    await browser.ev( `(() => { const t = document.querySelector('.pull-push-connection-info'); t.focus(); t.value = ${ JSON.stringify( config.remoteSite + '\n' + key ) }; jQuery(t).trigger('paste').trigger('keyup').trigger('input').trigger('change'); })()` );

    check( 'the connection to the other site is verified (tables are listed)', await browser.waitFor( `jQuery('#select-tables option').length > 0`, 60000 ) );

    await wait( 1000 );

    // a new profile: when one site is http and the other https, a row sets the scheme after the URL has been replaced
    const schemeOf  = url => url.startsWith( 'https:' ) ? 'https' : 'http';
    const fromScheme = schemeOf( pull ? config.remoteSite : config.site );
    const toScheme   = schemeOf( pull ? config.site : config.remoteSite );
    const pairs      = await browser.ev( `jQuery('.replace-row:not(.original-repeatable-field)').map( function () { return jQuery('[name="replace_old[]"]', this).val() + ' => ' + jQuery('[name="replace_new[]"]', this).val(); } ).get()` );
    const wanted     = `${ fromScheme }:// => ${ toScheme }://`;

    check( fromScheme === toScheme ? 'no row for the scheme when both sites use the same one' : `a row sets the scheme (${ fromScheme } to ${ toScheme }) behind the URL and the path`,
        fromScheme === toScheme ? ! pairs.some( p => /^https?:/.test( p ) ) : pairs.indexOf( wanted ) === 2 && pairs[0].startsWith( '//' ), pairs.join( ' | ' ) );

    if ( withMedia ) {

        check( 'the media files are available on the other site', await browser.ev( `jQuery('#media-files').attr('data-available') === '1'` ) );
        await browser.waitFor( `(() => { const e = document.querySelector('#media-files'); return !! e && e.offsetWidth > 0 && e.offsetHeight > 0; })()`, 10000 );
        await browser.click( '#media-files', 600 );
        check( 'the option "media files" is checked', await browser.ev( `jQuery('#media-files').is(':checked')` ) );
    }

    if ( backup ) {

        await browser.click( '#create-backup', 400 );
        await browser.click( '#backup-selected', 300 );
        check( 'the backup is switched on, with the selected tables', await browser.ev( `jQuery('#create-backup').is(':checked') && jQuery('#backup-selected').is(':checked')` ) );
    }

    check( 'the option for the media files is offered (it is set up by the media files part)', await browser.ev( `jQuery('.media-files').length > 0` ) );

    if ( chosen )
        await browser.chooseTables( chosen );

    await browser.shot( 'push-ready' );
    await browser.watchProgress();
    await browser.click( '.migrate-db-button', 800 );

    const end    = Date.now() + ( full ? 540000 : 150000 );
    let finished = false, failed = false, text = '';

    while ( Date.now() < end ) {

        const s = await browser.ev( `({ done : jQuery('.close-progress-content').is(':visible'), error : jQuery('.progress-text').hasClass('migration-error'), text : jQuery('.progress-title').text().trim() + ' | ' + jQuery('.progress-text').text().trim().slice(0, 100) })` );

        text = s.text;

        if ( s.error ) { failed = true; break; }

        if ( s.done ) { finished = true; break; }

        await wait( 1000 );
    }

    // when it did not end: what the box looks like (the part with the closing button)
    if ( ! finished && ! failed )
        console.log( 'the box at the end: ' + await browser.ev( `(() => { const c = jQuery('.close-progress-content'); return JSON.stringify({ closeButtons : c.length, display : c.css('display'), visible : c.is(':visible'), parentVisible : c.parent().is(':visible'), controls : jQuery('.migration-controls').is(':visible'), overlay : jQuery('#overlay').length, boxTop : jQuery('.progress-content').css('top'), title : jQuery('.progress-title').html(), doingAjax : null, html : (jQuery('.progress-content')[0] || {}).outerHTML.replace(/\\s+/g, ' ').slice(0, 900) }); })()` ) );

    await browser.shot( 'push-done' );

    const widths = await browser.progressWidths();

    check( `the ${ pull ? 'pull' : 'push' } runs to the end without an error message`, finished && ! failed, text );

    // with media files the bar starts again at 0 for the files, so it only has to rise within each part
    check( 'the progress bar moves', widths.some( w => w > 0 && w < 100 ) && ( withMedia || backup || widths.every( ( w, i ) => i === 0 || w >= widths[i - 1] ) ), `${ widths.length } samples, highest ${ Math.max( ...widths ) }%` );
    check( 'no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );

    section( 'the other site afterwards' );

    if ( backup ) {

        const made = backupFiles( receiver ).filter( f => ! backupsBefore.includes( f ) );

        check( 'one backup was made, with content', made.length === 1 && statSync( join( backupDir( receiver ), made[0] ) ).size > 1000, made.map( f => f + ' ' + statSync( join( backupDir( receiver ), made[0] ) ).size + ' bytes' ).join( ', ' ) );

        // the backup belongs to the web server (the folder is not writable for this user): the plugin of that site removes it
        // the way it removes the backup of a cancelled migration
        const site = pull ? config.site : config.remoteSite;

        if ( ! pull )
            await browser.login( config.remoteWp, config.remoteSite );

        await browser.goto( `${ site }/wp-admin/tools.php?page=sync-pilot` );

        for ( const file of made )
            await browser.ev( `fetch( ajaxurl, { method : 'POST', headers : { 'Content-Type' : 'application/x-www-form-urlencoded' }, body : new URLSearchParams( { action : 'syncpilot_cancel_migration', intent : 'pull', stage : 'backup', dump_filename : ${ JSON.stringify( file.replace( /\.sql(\.gz)?$/, '' ) ) }, form_data : '', temp_prefix : '_mig_', nonce : syncpilot_nonces.cancel_migration } ) } ).then( r => r.text() )` );

        check( 'the backup is removed again', backupFiles( receiver ).filter( f => ! backupsBefore.includes( f ) ).length === 0, backupFiles( receiver ).filter( f => ! backupsBefore.includes( f ) ).join( ', ' ) );
    }

    if ( withMedia ) {

        const onTarget = new Set( files( receiver ) );
        const missing  = takenAway.filter( f => ! onTarget.has( f ) );

        check( 'the files that were taken away are back on the other site', takenAway.length > 0 && missing.length === 0, `${ takenAway.length } files taken away, ${ missing.length } not back${ missing.length ? ': ' + missing.slice( 0, 3 ).join( ', ' ) : '' }` );
    }

    const rowsSource = counts( sender ), rowsTarget = counts( receiver );
    const left       = Object.keys( rowsTarget ).filter( t => t.startsWith( '_mig_' ) || t.startsWith( '_old_' ) );
    const differ     = Object.keys( rowsSource ).filter( t => rowsSource[t] !== rowsTarget[t] );

    check( 'the data of the sending site replaced the table on the receiving site (its marker row is gone)', marked() === '0' );
    check( 'no temporary or old tables are left', left.length === 0, left.join( ', ' ) );

    if ( chosen ) {

        // the other tables were not sent: the sites may differ there (and must not have changed on the other site)
        const wrong = chosen.filter( t => rowsSource[t] !== rowsTarget[t] );

        check( 'the pushed tables have the same number of rows on both sites', wrong.length === 0 && chosen.every( t => t in rowsTarget ), wrong.join( ', ' ) );

        const nowTarget = sums( receiver );

        // the options are written by WordPress itself; the users' meta (sessions) of a site that is logged in change as well
        // (the pull is received by the site of the test, and the backup is removed through the receiving site)
        const changed   = Object.keys( before[received] ).filter( t => ! chosen.includes( t ) && before[received][t] !== nowTarget[t] && ! t.endsWith( 'options' ) && ! t.endsWith( 'usermeta' ) );

        check( 'the other tables of the receiving site were not touched', changed.length === 0, changed.join( ', ' ) );
    } else {

        check( 'same tables, same number of rows (except the options, whose transients are not sent)', Object.keys( rowsSource ).length === Object.keys( rowsTarget ).length && differ.every( t => t.endsWith( 'options' ) ), 'different: ' + differ.join( ', ' ) );
    }

    check( 'the receiving site kept its address and its key', wp( receiver, 'echo get_option( "home" );' ) === ( pull ? config.site : config.remoteSite ) && wp( receiver, 'echo get_option( "syncpilot_settings" )["key"];' ) === ( pull ? wp( config.wp, 'echo get_option( "syncpilot_settings" )["key"];' ) : key ) );
} catch ( error ) {

    check( 'the test itself ran through', false, error.message );
} finally {

    // whatever happens, both sites are put back
    try { await browser.close(); } catch {}

    wp( config.remoteWp, 'update_option( "syncpilot_settings", unserialize( base64_decode( ' + JSON.stringify( remoteSettings ) + ' ) ) );' );

    section( 'put everything back' );

    console.log( `target: ${ putBack( config.remoteWp, target, 'target' ) }, source: ${ putBack( config.wp, source, 'source' ) }` );

    // what the push did not bring back is copied back, and what came in addition is removed again
    if ( withMedia ) {

        copyBack( sender, receiver, takenAway );

        const known = new Set( filesBefore );
        const added = files( receiver ).filter( f => ! known.has( f ) );

        remove( receiver, added );
        check( 'the uploads folder of the receiving site is as before', files( receiver ).length === filesBefore.length, `${ added.length } extra files removed` );
    }

    const after = { source : sums( config.wp ), target : sums( config.remoteWp ) };

    // wp-cli itself writes transients and the schedule into the options, so they can differ
    for ( const side of [ 'source', 'target' ] ) {

        const differ = Object.keys( before[side] ).filter( t => before[side][t] !== after[side][t] && ! t.endsWith( 'options' ) );

        check( side + ' site restored: all tables but the options have the same checksum as before', differ.length === 0 && Object.keys( before[side] ).length === Object.keys( after[side] ).length, differ.join( ', ' ) );
    }
}

process.exit( finish() );
