// A complete push through the interface from one test installation to the other, then everything is put back.
//
//   node tests/browser/push.mjs --yes            the database
//   node tests/browser/push.mjs --yes --media    the database and the media files (files that are new on the other site are
//                                                copied into its uploads folder and removed again at the end)
//
// THIS OVERWRITES THE DATABASES OF BOTH TEST SITES. They exist only for tests. A reference backup of both is kept in
// ~/.cache/syncpilot-tests/<id of the pair of sites> (or SP_BACKUP_DIR); it is made from the current state when it does not exist yet (or with
// --refresh-baseline). Every run starts by importing it, and imports it again at the end, so the sites are always in
// the same state, and the checksums of all tables are compared with the ones from before. Without --yes it only says
// what it would do. Never point it at a site that is not a test site.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { launch, checks, config, need, wp, wait } from './lib.mjs';

need( 'wp', 'site', 'remoteWp', 'remoteSite' );

const { check, section, finish } = checks();

if ( ! process.argv.includes( '--yes' ) ) {

    console.log( `Push from ${ config.site } (${ config.wp }) to ${ config.remoteSite } (${ config.remoteWp }).` );
    console.log( 'The databases of both sites are overwritten and put back from the reference backup afterwards. Run again with --yes to do it.' );
    process.exit( 0 );
}

const withMedia = process.argv.includes( '--media' );

// the reference backup belongs to this pair of sites: another pair gets another folder, so that a backup is never put into the wrong site
const dir = process.env.SP_BACKUP_DIR || join( homedir(), '.cache', 'syncpilot-tests', createHash( 'sha1' ).update( config.wp + '|' + config.remoteWp ).digest( 'hex' ).slice( 0, 12 ) );

mkdirSync( dir, { recursive : true } );

const dump = ( path, file ) => execFileSync( 'wp', [ '--path=' + path, 'db', 'export', file, '--quiet' ], { stdio : [ 'ignore', 'pipe', 'ignore' ] } );
const load = ( path, file ) => execFileSync( 'wp', [ '--path=' + path, 'db', 'import', file ], { stdio : [ 'ignore', 'pipe', 'ignore' ] } );
const sums = path => JSON.parse( wp( path, 'global $wpdb; $o = array(); foreach ( $wpdb->get_col( "SHOW TABLES" ) as $t ) { $r = $wpdb->get_row( "CHECKSUM TABLE `$t`", ARRAY_A ); $o[$t] = $r["Checksum"]; } echo json_encode( $o );' ) );

// files in the uploads folder of a site (without the folder of the exports), relative to it
const files  = path => JSON.parse( wp( path, '$d = wp_upload_dir()["basedir"]; $o = array(); if ( is_dir( $d ) ) foreach ( new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $d, FilesystemIterator::SKIP_DOTS ) ) as $f ) { $r = substr( $f->getPathname(), strlen( $d ) + 1 ); if ( $f->isFile() && 0 !== strpos( $r, "sync-pilot/" ) ) $o[] = $r; } echo json_encode( $o );' ) );

// the files of the first attachments of a site: the original and all sizes, relative to the uploads folder
const attachmentFiles = ( path, number ) => JSON.parse( wp( path, '$d = wp_upload_dir()["basedir"]; $o = array(); foreach ( get_posts( array( "post_type" => "attachment", "posts_per_page" => ' + Number( number ) + ', "orderby" => "ID", "order" => "ASC", "post_status" => "any" ) ) as $p ) { $f = get_post_meta( $p->ID, "_wp_attached_file", true ); if ( ! $f ) continue; $o[] = $f; $m = wp_get_attachment_metadata( $p->ID ); if ( ! empty( $m["sizes"] ) ) foreach ( $m["sizes"] as $s ) $o[] = ( dirname( $f ) === "." ? "" : dirname( $f ) . "/" ) . $s["file"]; } echo json_encode( array_values( array_filter( array_unique( $o ), fn( $r ) => is_file( "$d/$r" ) ) ) );' ) );

// copy files from one site to the other (to put back what a test removed)
const copyBack = ( from, to, list ) => wp( to, '$src = ' + JSON.stringify( wp( from, 'echo wp_upload_dir()["basedir"];' ) ) + '; $d = wp_upload_dir()["basedir"]; foreach ( json_decode( base64_decode( "' + Buffer.from( JSON.stringify( list ) ).toString( 'base64' ) + '" ), true ) as $r ) { if ( false === strpos( $r, ".." ) && is_file( "$src/$r" ) && ! is_file( "$d/$r" ) ) { wp_mkdir_p( dirname( "$d/$r" ) ); copy( "$src/$r", "$d/$r" ); } }' );
const remove   = ( path, list ) => wp( path, '$d = wp_upload_dir()["basedir"]; $l = json_decode( base64_decode( "' + Buffer.from( JSON.stringify( list ) ).toString( 'base64' ) + '" ), true ); foreach ( $l as $r ) { if ( false === strpos( $r, ".." ) && is_file( "$d/$r" ) ) { unlink( "$d/$r" ); $p = dirname( "$d/$r" ); while ( $p !== $d && 0 === strpos( $p, $d ) && @rmdir( $p ) ) $p = dirname( $p ); } }' );
const counts   = path => JSON.parse( wp( path, 'global $wpdb; $o = array(); foreach ( $wpdb->get_col( "SHOW TABLES" ) as $t ) $o[$t] = (int) $wpdb->get_var( "SELECT COUNT(*) FROM `$t`" ); echo json_encode( $o );' ) );

section( 'reference backup (' + dir + ')' );

const source = join( dir, 'source.sql' ), target = join( dir, 'target.sql' );

if ( process.argv.includes( '--refresh-baseline' ) || ! existsSync( source ) || ! existsSync( target ) ) {

    dump( config.wp, source );
    dump( config.remoteWp, target );
    console.log( 'made from the current state of both sites' );
} else {

    load( config.wp, source );
    load( config.remoteWp, target );
    console.log( 'both sites are back in the state of the reference backup' );
}

const before      = { source : sums( config.wp ), target : sums( config.remoteWp ) };
const filesBefore = withMedia ? files( config.remoteWp ) : [];

// media files: take the files of two attachments away from the other site, so that the push has something to copy
const takenAway = withMedia ? attachmentFiles( config.wp, 2 ).filter( f => filesBefore.includes( f ) ) : [];

if ( withMedia ) {

    if ( takenAway.length === 0 )
        console.log( 'WARNING: no attachment files that exist on both sites, the media part has nothing to do' );

    remove( config.remoteWp, takenAway );
}

const key    = wp( config.remoteWp, 'echo get_option( "syncpilot_settings" )["key"];' );

check( 'both sites are in the state of the backup', true, `${ Object.keys( before.source ).length } and ${ Object.keys( before.target ).length } tables` );

const browser = await launch();

try {

    await browser.login();
    await browser.goto( `${ config.site }/wp-admin/tools.php?page=sync-pilot&syncpilot-profile=-1` );

    section( 'push' );

    await browser.click( 'input[name=action][value=push]' );
    await browser.ev( `(() => { const t = document.querySelector('.pull-push-connection-info'); t.focus(); t.value = ${ JSON.stringify( config.remoteSite + '\n' + key ) }; jQuery(t).trigger('paste').trigger('keyup').trigger('input').trigger('change'); })()` );

    check( 'the connection to the other site is verified (tables are listed)', await browser.waitFor( `jQuery('#select-tables option').length > 0`, 60000 ) );

    await wait( 1000 );

    if ( withMedia ) {

        check( 'the media files are available on the other site', await browser.ev( `jQuery('#media-files').attr('data-available') === '1'` ) );
        await browser.click( '#media-files', 600 );
        check( 'the option "media files" is checked', await browser.ev( `jQuery('#media-files').is(':checked')` ) );
    }

    check( 'the option for the media files is offered (it is set up by the media files part)', await browser.ev( `jQuery('.media-files').length > 0` ) );
    await browser.shot( 'push-ready' );
    await browser.click( '.migrate-db-button', 800 );

    const widths = [];
    const end    = Date.now() + 540000;
    let finished = false, failed = false, text = '';

    while ( Date.now() < end ) {

        const s = await browser.ev( `({ width : parseFloat(document.querySelector('.progress-bar')?.style.width) || 0, done : jQuery('.close-progress-content').is(':visible'), error : jQuery('.progress-text').hasClass('migration-error'), text : jQuery('.progress-title').text().trim() + ' | ' + jQuery('.progress-text').text().trim().slice(0, 100) })` );

        widths.push( s.width );
        text = s.text;

        if ( s.error ) { failed = true; break; }

        if ( s.done ) { finished = true; break; }

        await wait( 1000 );
    }

    await browser.shot( 'push-done' );

    check( 'the push runs to the end without an error message', finished && ! failed, text );

    // with media files the bar starts again at 0 for the files, so it only has to rise within each part
    check( 'the progress bar moves', widths.some( w => w > 0 && w < 100 ) && ( withMedia || widths.every( ( w, i ) => i === 0 || w >= widths[i - 1] ) ), `${ widths.length } samples, highest ${ Math.max( ...widths ) }%` );
    check( 'no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );

    section( 'the other site afterwards' );

    if ( withMedia ) {

        const onTarget = new Set( files( config.remoteWp ) );
        const missing  = takenAway.filter( f => ! onTarget.has( f ) );

        check( 'the files that were taken away are back on the other site', takenAway.length > 0 && missing.length === 0, `${ takenAway.length } files taken away, ${ missing.length } not back${ missing.length ? ': ' + missing.slice( 0, 3 ).join( ', ' ) : '' }` );
    }

    const rowsSource = counts( config.wp ), rowsTarget = counts( config.remoteWp );
    const left       = Object.keys( rowsTarget ).filter( t => t.startsWith( '_mig_' ) || t.startsWith( '_old_' ) );
    const differ     = Object.keys( rowsSource ).filter( t => rowsSource[t] !== rowsTarget[t] );

    check( 'no temporary or old tables are left', left.length === 0, left.join( ', ' ) );
    check( 'same tables, same number of rows (except the options, whose transients are not sent)', Object.keys( rowsSource ).length === Object.keys( rowsTarget ).length && differ.every( t => t.endsWith( 'options' ) ), 'different: ' + differ.join( ', ' ) );
    check( 'the other site kept its address and its key', wp( config.remoteWp, 'echo get_option( "home" );' ) === config.remoteSite && wp( config.remoteWp, 'echo get_option( "syncpilot_settings" )["key"];' ) === key );
} catch ( error ) {

    check( 'the test itself ran through', false, error.message );
} finally {

    // whatever happens, both sites are put back
    try { await browser.close(); } catch {}

    section( 'put everything back' );

    load( config.remoteWp, target );
    load( config.wp, source );

    // what the push did not bring back is copied back, and what came in addition is removed again
    if ( withMedia ) {

        copyBack( config.wp, config.remoteWp, takenAway );

        const known = new Set( filesBefore );
        const added = files( config.remoteWp ).filter( f => ! known.has( f ) );

        remove( config.remoteWp, added );
        check( 'the uploads folder of the other site is as before', files( config.remoteWp ).length === filesBefore.length, `${ added.length } extra files removed` );
    }

    const after = { source : sums( config.wp ), target : sums( config.remoteWp ) };

    // wp-cli itself writes transients and the schedule into the options, so they can differ
    for ( const side of [ 'source', 'target' ] ) {

        const differ = Object.keys( before[side] ).filter( t => before[side][t] !== after[side][t] && ! t.endsWith( 'options' ) );

        check( side + ' site restored: all tables but the options have the same checksum as before', differ.length === 0 && Object.keys( before[side] ).length === Object.keys( after[side] ).length, differ.join( ', ' ) );
    }
}

process.exit( finish() );
