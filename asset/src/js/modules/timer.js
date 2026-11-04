// The counter of the elapsed time in the progress box.

import { state } from './state.js';
import { pad } from './helpers.js';

const $ = jQuery;

var counter_display;
var label;

export function setup_counter() {

    state.timer_count = 0;
    counter_display   = $( '.timer' );
    label             = syncpilot_i10n.time_elapsed + ' ';

    state.elapsed_interval = setInterval( count, 1000 );
}

function display_count() {

    var hours   = Math.floor( state.timer_count / 3600 ) % 24;
    var minutes = Math.floor( state.timer_count / 60 ) % 60;
    var seconds = state.timer_count % 60;

    var display = label + pad( hours, 2, 0 ) + ':' + pad( minutes, 2, 0 ) + ':' +
        pad( seconds, 2, 0 );

    counter_display.html( display );
}

export function count() {

    state.timer_count = state.timer_count + 1;
    display_count();
}
