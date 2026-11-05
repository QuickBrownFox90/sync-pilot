// The progress box of a migration: the overlay, the box that slides in, the blocks for the tables in the bar, and the
// choice of the tables that are migrated in each stage.

import { state } from './state.js';
import { get_intersect } from './helpers.js';
import { spinner_url } from './spinner.js';

const $ = jQuery;

/**
 * The tables of a stage and their number of rows. The result for the tables is in state.tables_to_migrate. The backup
 * (stage "backup") follows the options of the backup, the migration (stage "migrate") the options of the tables
 * @since   0.2.6
 * @param   {string} stage  "backup" or "migrate"
 * @return  {object}        The number of rows by the name of the table
 */
export function choose_tables( stage ) {

    var table_rows = '';

    if ( stage == 'backup' ) {
        var backup_option = $( 'input[name=backup_option]:checked' ).val();
        var table_option  = $( 'input[name=table_migrate_option]:checked' ).val();

        if ( table_option == 'migrate_only_with_prefix' && backup_option == 'backup_selected' ) {
            backup_option = 'backup_only_with_prefix';
        }

        if ( state.migration_intent == 'push' ) {
            table_rows = connection_data.table_rows;

            if ( backup_option == 'backup_only_with_prefix' ) {
                state.tables_to_migrate = connection_data.prefixed_tables;
            } else if ( backup_option == 'backup_selected' ) {
                state.tables_to_migrate = get_intersect( $( '#select-tables' ).val(), connection_data.tables );
            } else if ( backup_option == 'backup_manual_select' ) {
                state.tables_to_migrate = $( '#select-backup' ).val();
            }
        } else {
            table_rows = syncpilot_this_table_rows;

            if ( backup_option == 'backup_only_with_prefix' ) {
                state.tables_to_migrate = syncpilot_this_prefixed_tables;
            } else if ( backup_option == 'backup_selected' ) {
                state.tables_to_migrate = get_intersect( $( '#select-tables' ).val(), syncpilot_this_tables );
            } else if ( backup_option == 'backup_manual_select' ) {
                state.tables_to_migrate = $( '#select-backup' ).val();
            }
        }

        return table_rows;
    }

    var sends_from_here = ( state.migration_intent == 'push' || state.migration_intent == 'savefile' );

    if ( $( 'input[name=table_migrate_option]:checked' ).val() == 'migrate_select' ) { // user has elected to migrate only certain tables
        // grab tables as per what the user has selected from the multiselect box
        state.tables_to_migrate = $( '#select-tables' ).val();
        table_rows              = sends_from_here ? syncpilot_this_table_rows : connection_data.table_rows;
    } else if ( sends_from_here ) {
        state.tables_to_migrate = syncpilot_this_prefixed_tables;
        table_rows              = syncpilot_this_table_rows;
    } else {
        state.tables_to_migrate = connection_data.prefixed_tables;
        table_rows              = connection_data.table_rows;
    }

    return table_rows;
}

/**
 * Draw one block in the bar for each table, as wide as its share of the rows, and the boxes that show the name when the
 * mouse is over it. Blocks narrower than 1px are hidden and their rows are added to the last table
 * @since   0.2.6
 * @param   {array}  tables_to_migrate  The names of the tables (not the state: the list of a stage is passed)
 * @param   {object} table_rows         The number of rows by the name of the table
 * @return  {array}                     The rows (changed by the merging) and the sum of the rows
 */
export function draw_table_chunks( tables_to_migrate, table_rows ) {

    var total_size = 0;

    $.each( tables_to_migrate, function ( index, value ) {
        total_size += parseInt( table_rows[value] );
    } );

    var last_element = '';

    $.each( tables_to_migrate, function ( index, value ) {

        var percent         = table_rows[value] / total_size * 100;
        var percent_rounded = Math.round( percent * 1000 ) / 1000;

        $( '.progress-tables' ).append( '<div class="progress-chunk ' +
            value + '_chunk" style="width: ' + percent_rounded +
            '%;" title="' + value + '"><span>' + value +
            '</span></div>' );

        $( '.progress-tables-hover-boxes' ).append(
            '<div class="progress-chunk-hover" data-table="' + value +
            '" style="width: ' + percent_rounded + '%;"></div>' );

        var label = $( '.progress-tables .progress-chunk:last span' );

        last_element = value;
    } );

    // the box is hidden until it slides in (below); in a hidden box every width is 0, every table counts as
    // "narrower than 1px" and is added to the last one, and the bar stays at 0% until the end. So it is laid
    // out, but not visible, while the chunks are measured
    // (and it is put back the way it was: when the stage changes from the backup to the migration the box is shown already,
    // and an empty `display` would hide it again)
    var box_style = { display : $( '.progress-content' )[0].style.display, visibility : $( '.progress-content' )[0].style.visibility };

    $( '.progress-content' ).css( { display : 'block', visibility : 'hidden' } );

    $( '.progress-chunk' ).each( function ( index ) {

        if ( $( this ).width() < 1 && tables_to_migrate[index] != last_element ) {
            $( this ).hide();

            $( '.progress-chunk-hover[data-table=' + tables_to_migrate[
                index] + ']' ).hide();

            table_rows[last_element] = Number( table_rows[last_element] );

            table_rows[last_element] += Number( table_rows[
                tables_to_migrate[index]] );

            table_rows[tables_to_migrate[index]] = 0;
        }

        var element = this;

        setTimeout( function () {
            hide_overflowing_elements( element );
        }, 0 );

        function hide_overflowing_elements( element ) {
            if ( $( 'span', element ).innerWidth() > $( element ).width() ) {
                $( 'span', element ).hide();
            }
        }
    } );

    $( '.progress-content' ).css( box_style );

    var percent_rounded = 0;

    if ( table_rows[last_element] != 0 ) {
        var percent = table_rows[last_element] / total_size * 100;

        percent_rounded = Math.round( percent * 1000 ) / 1000;
    }

    $( '.progress-tables .progress-chunk:last' ).css( 'width',
        percent_rounded + '%' );

    $( '.progress-chunk-hover:last' ).css( 'width', percent_rounded +
        '%' );

    var return_vals = [ table_rows, total_size ];

    return return_vals;
}

/**
 * The dark layer behind the progress box; it is hidden until show_progress_box() shows it
 * @since   0.2.6
 */
export function create_overlay() {

    var doc_height = $( document ).height();

    $( 'body' ).append( '<div id="overlay"></div>' );

    $( '#overlay' )
        .height( doc_height )
        .css( {
            'position' : 'fixed',
            'top'      : 0,
            'left'     : 0,
            'width'    : '100%',
            'z-index'  : 99999,
            'display'  : 'none',
        } );
}

/**
 * Put a copy of the progress box behind the overlay and show the overlay; the box itself slides in later
 * @since   0.2.6
 * @param   {jQuery} template  The box as it was when the page loaded
 * @param   {string} title     The text above the bar
 */
export function show_progress_box( template, title ) {

    $( '#overlay' ).after( template.clone() );
    $( '.progress-title' ).html( title );
    $( '#overlay' ).show();
}

/**
 * Show the spinner and let the box slide in from above
 * @since   0.2.6
 */
export function slide_in_progress_box() {

    $( '.progress-title' ).after( '<img src="' + spinner_url +
        '" alt="" class="migration-progress-ajax-spinner general-spinner" />'
    );

    var height = $( '.progress-content' ).outerHeight();

    $( '.progress-content' ).css( 'top', '-' + height + 'px' ).show().animate( {
        'top' : '0px'
    } );
}
