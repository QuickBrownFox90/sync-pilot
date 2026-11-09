// The connection to the other site, clicked through in a headless browser: the checks of what is typed into the box, the
// connection for a push and a pull (the lists of tables, the rows of find and replace), switching between push, pull and
// export, unlocking the box after a connection, and a saved profile that connects when the page is loaded (with the tables
// it saved, and with a wrong key). Nothing is migrated; the other site is only asked who it is.
//
//   node tests/browser/connection.mjs
//
// The settings of the test site are put back at the end (the profiles that the test adds are removed with them).
// The tests do not depend on the language of the interface.

import { launch, checks, config, need, wp } from './lib.mjs';

need( 'wp', 'site', 'remoteWp', 'remoteSite' );

const { check, section, finish } = checks();

const page   = `${ config.site }/wp-admin/tools.php?page=sync-pilot`;
const saved  = wp( config.wp, 'echo base64_encode( serialize( get_option( "syncpilot_settings" ) ) );' );
const key    = wp( config.remoteWp, 'echo get_option( "syncpilot_settings" )["key"];' );
const prefix = wp( config.remoteWp, 'global $wpdb; echo $wpdb->prefix;' );
const info   = `${ config.remoteSite }\n${ key }`;

const restore = () => wp( config.wp, 'update_option( "syncpilot_settings", unserialize( base64_decode( ' + JSON.stringify( saved ) + ' ) ) );' );

// add a profile to the settings, return its number for the address (they are numbered from 1)
const addProfile = fields => {

    const profile = Object.assign( {
        save_computer        : '1', gzip_file            : '1', replace_guids        : '1', exclude_spam         : '0', keep_active_plugins  : '1', create_backup        : '0',
        exclude_post_types   : '0', action               : 'push', connection_info      : info, replace_old          : { 1 : '//' + new URL( config.site ).hostname }, replace_new          : { 1 : '//' + new URL( config.remoteSite ).hostname },
        table_migrate_option : 'migrate_select', backup_option        : 'backup_selected',
    }, fields );

    return Number( wp( config.wp, '$s = get_option( "syncpilot_settings" ); $s["profiles"][] = json_decode( ' + JSON.stringify( JSON.stringify( profile ) ) + ', true ); update_option( "syncpilot_settings", $s ); echo count( $s["profiles"] );' ) );
};

const browser = await launch();

const ajax = () => browser.requests.length;

const connected = `jQuery('.step-two').is(':visible') && jQuery('#select-tables option').length > 0`;

const selected = id => browser.ev( `jQuery('${ id } option:selected').map(function () { return this.value; }).get().sort()` );

try {

    await browser.login();

    section( 'what is typed into the box' );

    await browser.goto( page + '&syncpilot-profile=-1' );
    await browser.click( 'input[name=action][value=push]' );

    check( 'the field has a label', await browser.ev( `jQuery('label.connection-info-title[for=migrate-connection-info]').is(':visible') && jQuery('#migrate-connection-info').length === 1` ) );
    check( 'the info icon is there, the explanation is closed', await browser.ev( `jQuery('.connection-info-helper').is(':visible') && ! jQuery('.connection-info-info').is(':visible')` ) );

    await browser.click( '.connection-info-helper', 300 );

    check( 'a click on the icon opens the explanation', await browser.ev( `jQuery('.connection-info-info').is(':visible') && jQuery('.connection-info-info').text().trim().length > 100` ) );

    await browser.click( 'label.connection-info-title', 300 );

    check( 'a click elsewhere closes it', await browser.ev( `! jQuery('.connection-info-info').is(':visible')` ) );
    check( 'the warnings for a missing URL and path do not link to the documentation of another project', await browser.ev( `jQuery('#new-url-missing-warning a, #new-path-missing-warning a').length === 0` ) );

    const own   = await browser.ev( `syncpilot_connection_info` );
    const cases = [
        [ 'nothing', '' ],
        [ 'only the address', config.remoteSite ],
        [ 'an address that is none', `not an address\n${ key }` ],
        [ 'a key of the wrong length', `${ config.remoteSite }\nshort` ],
        [ 'the address of this site', `${ own[0] }\n${ key }` ],
        [ 'the key of this site', `${ config.remoteSite }\n${ own[1] }` ],
    ];
    const messages = [];
    const before   = ajax();

    for ( const [ label, text ] of cases ) {

        await browser.ev( `jQuery('.pull-push-connection-info').val(${ JSON.stringify( text ) }); jQuery('.connect-button').click(); 1` );

        const status = await browser.ev( `({ text : jQuery('.connection-status').text().trim(), error : jQuery('.connection-status').hasClass('migration-error'), two : jQuery('.step-two').is(':visible') })` );

        messages.push( status.text );
        check( `${ label }: an error message and no second step`, status.error && status.text !== '' && ! status.two, status.text );
    }

    check( 'every case has its own message', new Set( messages ).size === cases.length );
    check( 'none of the cases sent a request', ajax() === before );

    section( 'connect for a push' );

    await browser.ev( `jQuery('.pull-push-connection-info').val(${ JSON.stringify( info ) }); jQuery('.connect-button').click(); 1` );
    check( 'the second step opens with the tables of the other site', await browser.waitFor( connected, 60000 ) );

    const push = await browser.ev( `({
        locked  : jQuery('.pull-push-connection-info').hasClass('temp-disabled') && jQuery('.pull-push-connection-info').prop('readonly'),
        button  : jQuery('.connect-button').is(':visible'),
        name    : jQuery('.create-new-profile').val(),
        box     : jQuery('.push-list .connection-info-wrapper').length,
        url     : jQuery('#new-url').val(),
        path    : jQuery('#new-path').val(),
        types   : jQuery('#select-post-types option').length,
        backup  : jQuery('#select-backup option').length,
        rows    : jQuery('.replace-row:not(.original-repeatable-field)').map(function () { return jQuery('[name="replace_old[]"]', this).val() + ' => ' + jQuery('[name="replace_new[]"]', this).val(); }).get(),
    })` );

    check( 'the box is locked and the button is gone', push.locked && ! push.button );
    check( 'find and replace has a title with an icon, closed', await browser.ev( `jQuery('.find-replace-helper').is(':visible') && ! jQuery('.find-replace-info').is(':visible')` ) );

    await browser.click( '.find-replace-helper', 300 );

    check( 'a click on the icon opens the explanation of the rows', await browser.ev( `jQuery('.find-replace-info').is(':visible') && jQuery('.find-replace-info').text().trim().length > 100` ) );

    await browser.click( '.find-replace-helper', 300 );

    check( 'a second click closes it', await browser.ev( `! jQuery('.find-replace-info').is(':visible')` ) );
    check( 'the name of the profile is the domain of the other site', push.name === new URL( config.remoteSite ).hostname, push.name );
    check( 'the box stands in the list of the push', push.box === 1 );
    check( 'new URL and new path are those of the other site', push.url === '//' + new URL( config.remoteSite ).hostname && push.path.replace( /\/$/, '' ) === config.remoteWp, `${ push.url } ${ push.path }` );
    check( 'the lists of post types and tables for the backup are filled', push.types > 0 && push.backup > 0, `${ push.types } post types, ${ push.backup } tables` );

    const from = config.site.startsWith( 'https:' ) ? 'https' : 'http';
    const to   = config.remoteSite.startsWith( 'https:' ) ? 'https' : 'http';

    check( from === to ? 'no row for the scheme' : 'a row sets the scheme', from === to ? ! push.rows.some( r => /^https?:/.test( r ) ) : push.rows.includes( `${ from }:// => ${ to }://` ), push.rows.join( ' | ' ) );

    section( 'switch to pull, to export and back' );

    await browser.click( 'input[name=action][value=pull]' );

    const pull = await browser.ev( `({ box : jQuery('.pull-list .connection-info-wrapper').length, two : jQuery('.step-two').is(':visible'), url : jQuery('#new-url').val(), old : jQuery('#old-url').val(), tables : jQuery('#select-tables option').length })` );

    check( 'pull: the box moves to the list of the pull, the second step stays', pull.box === 1 && pull.two );
    check( 'pull: the values of find and replace are swapped', pull.url === '//' + new URL( config.site ).hostname && pull.old === '//' + new URL( config.remoteSite ).hostname, `${ pull.old } => ${ pull.url }` );
    check( 'pull: the list of tables is filled', pull.tables > 0 );

    await browser.click( 'input[name=action][value=savefile]' );

    const file = await browser.ev( `({ two : jQuery('.step-two').is(':visible'), backup : jQuery('.backup-options').is(':visible'), name : jQuery('.create-new-profile').val() })` );

    check( 'export: second step shown, no backup options, no name for the profile', file.two && ! file.backup && file.name === '', JSON.stringify( file ) );

    await browser.click( 'input[name=action][value=pull]' );

    section( 'unlock the box' );

    const mark = ajax();

    await browser.click( '.pull-push-connection-info', 400 );

    const asked = await browser.ev( `(() => { const d = document.getElementById('syncpilot-dialog'); return !! d && d.open; })()` );

    check( 'a question opens when the box is clicked', asked );
    await browser.click( '.syncpilot-dialog-ok', 400 );

    const open = await browser.ev( `({ locked : jQuery('.pull-push-connection-info').prop('readonly'), button : jQuery('.connect-button').is(':visible'), two : jQuery('.step-two').is(':visible') })` );

    check( 'OK unlocks the box, shows the button and hides the second step, nothing is sent', ! open.locked && open.button && ! open.two && ajax() === mark, JSON.stringify( open ) );

    section( 'a saved profile connects when the page is loaded' );

    const tables = [ prefix + 'posts', prefix + 'terms' ].sort();
    const backup = [ prefix + 'options' ];
    const number = addProfile( { name : 'zz-connection-push', action : 'push', select_tables : tables, select_backup : backup } );
    const number2 = addProfile( { name : 'zz-connection-pull', action : 'pull', select_tables : tables, select_backup : backup } );
    const wrong  = addProfile( { name : 'zz-connection-wrong-key', action : 'push', connection_info : `${ config.remoteSite }\n${ 'x'.repeat( 32 ) }`, select_tables : tables } );

    for ( const [ label, id ] of [ [ 'push', number ], [ 'pull', number2 ] ] ) {

        await browser.goto( `${ page }&syncpilot-profile=${ id }` );

        const ok = await browser.waitFor( connected, 60000 );

        check( `${ label }: the profile connects by itself and shows the second step`, ok );

        const got = await browser.ev( `({ locked : jQuery('.pull-push-connection-info').hasClass('temp-disabled'), enabled : jQuery('.option-group input:disabled').length === 0 })` );

        check( `${ label }: the box is locked and the options can be used again`, got.locked && got.enabled );
        check( `${ label }: the tables of the profile are selected`, JSON.stringify( await selected( '#select-tables' ) ) === JSON.stringify( tables ), ( await selected( '#select-tables' ) ).join( ', ' ) );
        check( `${ label }: the tables of the backup are selected`, JSON.stringify( await selected( '#select-backup' ) ) === JSON.stringify( backup ), ( await selected( '#select-backup' ) ).join( ', ' ) );
    }

    await browser.goto( `${ page }&syncpilot-profile=${ wrong }` );
    await browser.waitFor( `jQuery('.connection-status').hasClass('migration-error')`, 60000 );

    const bad = await browser.ev( `({ text : jQuery('.connection-status').text().trim(), two : jQuery('.step-two').is(':visible'), locked : jQuery('.pull-push-connection-info').hasClass('temp-disabled'), enabled : jQuery('.option-group input:disabled').length === 0, spinner : jQuery('.ajax-spinner').length })` );

    check( 'a wrong key: the message of the other site, no second step, nothing locked, no spinner', bad.text !== '' && ! bad.two && ! bad.locked && bad.enabled && bad.spinner === 0, bad.text );

    check( 'no error in the page', browser.takeProblems().length === 0, browser.takeProblems().join( ' | ' ) );
} catch ( error ) {

    check( 'the test itself ran through', false, error.message );
} finally {

    restore();
    await browser.close();
}

process.exit( finish() );
