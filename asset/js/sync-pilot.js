// global vars
var call_stack             = [];
var non_fatal_errors       = '';
var migration_error        = false;
var connection_data        = null;
var next_step_in_migration = null;

// What runs after the last table of a migration is a list of functions in call_stack (script.js fills it): the media
// files if they are chosen, then the end of the migration. Every step ends by calling this function for the next one.
function run_next_step() {

    var step = call_stack.shift();

    if ( 'function' === typeof step )
        step();
}

// Replacement for alert() and confirm(): one <dialog> element for the whole page. The text is set as text, so a message
// of the other site can never bring markup into the page. Browsers without <dialog> fall back to alert() / confirm().
function syncpilot_dialog( text, on_confirm, on_cancel ) {

    var is_confirm = ( 'function' === typeof on_confirm );
    var l10n       = window.syncpilot_i10n || {};
    var dialog     = document.getElementById( 'syncpilot-dialog' );

    if ( ! dialog || 'function' !== typeof dialog.showModal ) {

        if ( ! is_confirm ) {
            window.alert( text );

            return;
        }

        if ( window.confirm( text ) )
            on_confirm();

        else if ( 'function' === typeof on_cancel )
            on_cancel();

        return;
    }

    dialog.querySelector( '.syncpilot-dialog-message' ).textContent  = text;
    dialog.querySelector( '.syncpilot-dialog-cancel' ).textContent   = l10n.dialog_cancel || 'Cancel';
    dialog.querySelector( '.syncpilot-dialog-ok' ).textContent       = l10n.dialog_ok || 'OK';
    dialog.querySelector( '.syncpilot-dialog-cancel' ).style.display = is_confirm ? '' : 'none';

    dialog.returnValue = '';

    // one-time handler: the same element is used for every message
    dialog.addEventListener( 'close', function handle_close() {

        dialog.removeEventListener( 'close', handle_close );

        if ( ! is_confirm )
            return;

        if ( 'ok' === dialog.returnValue )
            on_confirm();

        else if ( 'function' === typeof on_cancel )
            on_cancel();
    } );

    dialog.showModal();
    dialog.querySelector( '.syncpilot-dialog-ok' ).focus();
}

function syncpilot_alert( text ) {
    syncpilot_dialog( text );
}

function syncpilot_confirm( text, on_confirm, on_cancel ) {
    syncpilot_dialog( text, on_confirm, on_cancel );
}

// the element is created once the page is ready
document.addEventListener( 'DOMContentLoaded', function () {

    if ( document.getElementById( 'syncpilot-dialog' ) )
        return;

    var dialog       = document.createElement( 'dialog' );

    dialog.id        = 'syncpilot-dialog';
    dialog.className = 'syncpilot-dialog';

    dialog.innerHTML = '<form method="dialog">' +
        '<p class="syncpilot-dialog-message"></p>' +
        '<div class="syncpilot-dialog-buttons">' +
        '<button type="submit" value="cancel" class="button syncpilot-dialog-cancel"></button> ' +
        '<button type="submit" value="ok" class="button button-primary syncpilot-dialog-ok"></button>' +
        '</div></form>';

    document.body.appendChild( dialog );
} );

// Messages of the other site are shown with .html(). Only harmless markup stays, everything else is removed or
// shown as text. The parser is DOMParser: it neither runs scripts nor loads images or event handlers.
function syncpilot_sanitize_html( html ) {

    var allowed = {
        A      : [ 'href', 'class', 'target' ],
        BR     : [],
        STRONG : [],
        B      : [],
        EM     : [],
        I      : [],
        U      : [],
        CODE   : [],
        P      : [],
        UL     : [],
        LI     : [],
        H3     : [],
        SPAN   : [ 'class' ],
        DIV    : [ 'class' ]
    };

    var doc = new DOMParser().parseFromString( '<body>' + String( html ), 'text/html' );

    function clean( node ) {

        Array.prototype.slice.call( node.childNodes ).forEach( function ( child ) {

            if ( 3 === child.nodeType )
                return;

            if ( 1 !== child.nodeType ) {
                node.removeChild( child );

                return;
            }

            if ( ! allowed.hasOwnProperty( child.tagName ) ) {

                // script, style, img, iframe, form …: keep the text, drop the element
                if ( 'SCRIPT' === child.tagName || 'STYLE' === child.tagName )
                    node.removeChild( child );
                else
                    node.replaceChild( doc.createTextNode( child.textContent ), child );

                return;
            }

            Array.prototype.slice.call( child.attributes ).forEach( function ( attribute ) {

                var name = attribute.name.toLowerCase();

                if ( -1 === allowed[child.tagName].indexOf( name ) )
                    child.removeAttribute( attribute.name );
            } );

            if ( 'A' === child.tagName ) {

                var href = child.getAttribute( 'href' ) || '';

                if ( ! /^(#|\/|https?:\/\/)/i.test( href ) )
                    child.removeAttribute( 'href' );

                child.setAttribute( 'rel', 'noopener noreferrer' );
            }

            clean( child );
        } );
    }

    clean( doc.body );

    return doc.body.innerHTML;
}

function syncpilot_add_commas( number_string ) {

    number_string += '';

    x  = number_string.split( '.' );
    x1 = x[0];
    x2 = x.length > 1 ? '.' + x[1] : '';

    var rgx = /(\d+)(\d{3})/;

    while ( rgx.test( x1 ) )
        x1 = x1.replace( rgx, '$1' + ',' + '$2' );

    return x1 + x2;
}

function syncpilot_parse_json( maybe_json ) {

    try {
        var json_object = jQuery.parseJSON( maybe_json );
    } catch ( e ) {
        // we simply return false here because the json data itself will never just contain a value of "false"
        return false;
    }

    return json_object;
}

(() => {
  // asset/src/js/modules/state.js
  var state = {
    // the connection to the other site
    connection_established: false,
    remote_site: void 0,
    secret_key: void 0,
    // the form
    last_replace_switch: "",
    profile_name_edited: false,
    show_prefix_notice: false,
    show_ssl_notice: false,
    show_version_notice: false,
    // requests that are running (a second click must not start the same request again)
    doing_ajax: false,
    doing_reset_api_key_ajax: false,
    doing_save_profile: false,
    doing_plugin_compatibility_ajax: false,
    // the migration
    migration_intent: void 0,
    stage: void 0,
    form_data: void 0,
    tables_to_migrate: "",
    currently_migrating: false,
    migration_completed: false,
    migration_paused: false,
    migration_cancelled: false,
    completed_msg: void 0,
    overall_percent: void 0,
    previous_progress_title: void 0,
    previous_progress_text: void 0,
    // the export file
    dump_filename: "",
    dump_url: "",
    // the counter of the elapsed time
    timer_count: void 0,
    elapsed_interval: void 0
  };

  // asset/src/js/modules/spinner.js
  var admin_url = ajaxurl.replace("/admin-ajax.php", "");
  var spinner_url = admin_url + "/images/wpspin_light";
  if (window.devicePixelRatio >= 2) {
    spinner_url += "-2x";
  }
  spinner_url += ".gif";

  // asset/src/js/modules/helpers.js
  function pad(n, width, z) {
    z = z || "0";
    n = n + "";
    return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
  }
  function get_intersect(arr1, arr2) {
    var r = [], o = {}, l = arr2.length, i, v;
    for (i = 0; i < l; i++)
      o[arr2[i]] = true;
    l = arr1.length;
    for (i = 0; i < l; i++) {
      v = arr1[i];
      if (v in o)
        r.push(v);
    }
    return r;
  }
  function get_query_var(name) {
    name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
    var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"), results = regex.exec(location.search);
    return results == null ? "" : decodeURIComponent(results[1].replace(
      /\+/g,
      " "
    ));
  }
  function get_domain_name(url) {
    var temp_url = url;
    var domain = temp_url.replace(/\/\/(.*)@/, "//").replace("http://", "").replace(
      "https://",
      ""
    ).replace("www.", "");
    return domain;
  }
  function get_default_profile_name(url, intent, ing_suffix) {
    var domain = get_domain_name(url);
    if (ing_suffix) {
      return (intent == "pull" ? syncpilot_i10n.pulling_from : syncpilot_i10n.pushing_to).replace("%s", domain);
    }
    var action = intent.charAt(0).toUpperCase() + intent.slice(1);
    var preposition = intent == "pull" ? "from" : "to";
    return action + " " + preposition + " " + domain;
  }
  function remove_protocol(url) {
    return url.replace(/^https?:/i, "");
  }
  function ajax_problem_text(message, jqXHR) {
    if (window.console && console.log)
      console.log("SyncPilot: " + message, jqXHR.status, jqXHR.statusText, jqXHR.responseText);
    return message + "\n\n" + jqXHR.status + " " + jqXHR.statusText;
  }

  // asset/src/js/modules/timer.js
  var $ = jQuery;
  var counter_display;
  var label;
  function setup_counter() {
    state.timer_count = 0;
    counter_display = $(".timer");
    label = syncpilot_i10n.time_elapsed + " ";
    state.elapsed_interval = setInterval(count, 1e3);
  }
  function display_count() {
    var hours = Math.floor(state.timer_count / 3600) % 24;
    var minutes = Math.floor(state.timer_count / 60) % 60;
    var seconds = state.timer_count % 60;
    var display = label + pad(hours, 2, 0) + ":" + pad(minutes, 2, 0) + ":" + pad(seconds, 2, 0);
    counter_display.html(display);
  }
  function count() {
    state.timer_count = state.timer_count + 1;
    display_count();
  }

  // asset/src/js/modules/notices.js
  var $2 = jQuery;
  function maybe_show_ssl_warning(url, key, remote_scheme) {
    var scheme = url.substr(0, url.indexOf(":"));
    if (remote_scheme != scheme && url.indexOf("https") != -1) {
      $2(".ssl-notice").show();
      state.show_ssl_notice = true;
      url = url.replace("https", "http");
      $2(".pull-push-connection-info").val(url + "\n" + key);
      return;
    }
    state.show_ssl_notice = false;
    return;
  }
  function maybe_show_version_warning(plugin_version, url) {
    if (typeof plugin_version != "undefined" && plugin_version != syncpilot_plugin_version) {
      $2(".different-plugin-version-notice").show();
      $2(".remote-version").text(plugin_version);
      $2(".remote-location").text(url);
      $2(".step-two").hide();
      state.show_version_notice = true;
    }
  }
  function maybe_show_prefix_notice(prefix) {
    if (prefix != syncpilot_this_prefix) {
      $2(".remote-prefix").text(prefix);
      state.show_prefix_notice = true;
      if ($2("#pull").is(":checked")) {
        $2(".prefix-notice.pull").show();
      } else {
        $2(".prefix-notice.push").show();
      }
    }
  }

  // asset/src/js/modules/slider.js
  var $3 = jQuery;
  function init_slider() {
    $3(".slider").slider({
      range: "min",
      value: syncpilot_max_request / 1024,
      min: 512,
      max: syncpilot_bottleneck / 1024,
      step: 512,
      slide: function(event, ui) {
        $3(".amount").html(syncpilot_add_commas(ui.value) + " kB");
      },
      change: function(event, ui) {
        $3(".amount").after('<img src="' + spinner_url + '" alt="" class="slider-spinner general-spinner" />');
        $3(".slider").slider("disable");
        $3.ajax({
          url: ajaxurl,
          type: "POST",
          dataType: "text",
          cache: false,
          data: {
            action: "syncpilot_update_max_request_size",
            max_request_size: parseInt(ui.value),
            nonce: syncpilot_nonces.update_max_request_size
          },
          error: function(jqXHR, textStatus, errorThrown) {
            $3(".slider").slider("enable");
            $3(".slider-spinner").remove();
            syncpilot_alert(syncpilot_i10n.max_request_size_problem);
          },
          success: function(data) {
            $3(".slider").slider("enable");
            $3(".slider-spinner").remove();
            $3(".slider-success-msg").show();
            $3(".slider-success-msg").fadeOut(2e3, function() {
              $3(this).hide();
            });
          }
        });
      }
    });
    $3(".amount").html(syncpilot_add_commas($3(".slider").slider("value")) + " kB");
  }

  // asset/src/js/modules/plugin-compatibility.js
  var $4 = jQuery;
  function init_plugin_compatibility() {
    $4("#plugin-compatibility").change(function(e) {
      var $box = $4(this);
      if ($box.is(":checked")) {
        syncpilot_confirm(syncpilot_i10n.plugin_compatibility_confirm, function() {
          save_plugin_compatibility("1");
        }, function() {
          $box.prop("checked", false);
        });
        return;
      }
      save_plugin_compatibility("0");
    });
    function save_plugin_compatibility(install) {
      $4(".plugin-compatibility-wrap").toggle();
      $4("#plugin-compatibility").parent().append('<img src="' + spinner_url + '" alt="" class="ajax-spinner general-spinner" />');
      $4("#plugin-compatibility").attr("disabled", "disabled");
      $4(".plugin-compatibility").addClass("disabled");
      $4.ajax({
        url: ajaxurl,
        type: "POST",
        dataType: "text",
        cache: false,
        data: {
          action: "syncpilot_plugin_compatibility",
          install,
          nonce: syncpilot_nonces.plugin_compatibility
        },
        error: function(jqXHR, textStatus, errorThrown) {
          syncpilot_alert(ajax_problem_text(syncpilot_i10n.plugin_compatibility_problem, jqXHR));
          $4(".ajax-spinner").remove();
          $4("#plugin-compatibility").removeAttr("disabled");
          $4(".plugin-compatibility").removeClass("disabled");
        },
        success: function(data) {
          if ("" != $4.trim(data)) {
            syncpilot_alert($4.trim(data));
          } else {
            $4(".plugin-compatibility").append(
              '<span class="ajax-success-msg">' + syncpilot_i10n.saved + "</span>"
            );
            $4(".ajax-success-msg").fadeOut(2e3, function() {
              $4(this).remove();
            });
          }
          $4(".ajax-spinner").remove();
          $4("#plugin-compatibility").removeAttr("disabled");
          $4(".plugin-compatibility").removeClass("disabled");
        }
      });
    }
    if ($4("#plugin-compatibility").is(":checked")) {
      $4(".plugin-compatibility-wrap").show();
    }
    $4(".plugin-compatibility-save").click(function() {
      if (state.doing_plugin_compatibility_ajax) {
        return;
      }
      $4(this).addClass("disabled");
      var select_element = $4("#selected-plugins");
      $4(select_element).attr("disabled", "disabled");
      state.doing_plugin_compatibility_ajax = true;
      $4(this).after(
        '<img src="' + spinner_url + '" alt="" class="plugin-compatibility-spinner general-spinner" />'
      );
      $4.ajax({
        url: ajaxurl,
        type: "POST",
        dataType: "text",
        cache: false,
        data: {
          action: "syncpilot_blacklist_plugins",
          blacklist_plugins: $4(select_element).val(),
          nonce: syncpilot_nonces.blacklist_plugins
        },
        error: function(jqXHR, textStatus, errorThrown) {
          syncpilot_alert(ajax_problem_text(syncpilot_i10n.blacklist_problem, jqXHR));
          $4(select_element).removeAttr("disabled");
          $4(".plugin-compatibility-save").removeClass("disabled");
          state.doing_plugin_compatibility_ajax = false;
          $4(".plugin-compatibility-spinner").remove();
          $4(".plugin-compatibility-success-msg").show().fadeOut(2e3);
        },
        success: function(data) {
          if ("" != $4.trim(data)) {
            syncpilot_alert($4.trim(data));
          }
          $4(select_element).removeAttr("disabled");
          $4(".plugin-compatibility-save").removeClass("disabled");
          state.doing_plugin_compatibility_ajax = false;
          $4(".plugin-compatibility-spinner").remove();
          $4(".plugin-compatibility-success-msg").show().fadeOut(2e3);
        }
      });
    });
  }

  // asset/src/js/modules/diagnostics.js
  var $5 = jQuery;
  function refresh_debug_log() {
    $5.ajax({
      url: ajaxurl,
      type: "POST",
      dataType: "text",
      cache: false,
      data: {
        action: "syncpilot_get_log",
        nonce: syncpilot_nonces.get_log
      },
      error: function(jqXHR, textStatus, errorThrown) {
        syncpilot_alert(syncpilot_i10n.update_log_problem);
      },
      success: function(data) {
        $5(".debug-log-textarea").val(data);
      }
    });
  }
  function init_diagnostics() {
    $5(".clear-log").click(function() {
      $5(".debug-log-textarea").val("");
      $5.ajax({
        url: ajaxurl,
        type: "POST",
        dataType: "text",
        cache: false,
        data: {
          action: "syncpilot_clear_log",
          nonce: syncpilot_nonces.clear_log
        },
        error: function(jqXHR, textStatus, errorThrown) {
          syncpilot_alert(syncpilot_i10n.clear_log_problem);
        },
        success: function(data) {
        }
      });
    });
  }

  // asset/src/js/modules/form-ui.js
  var $6 = jQuery;
  function init_form_ui() {
    $6(".js-action-link").click(function(e) {
      e.preventDefault();
      $6(this).blur();
    });
    $6(".option-group input[type=radio]").change(function() {
      var group = $6(this).closest(".option-group");
      $6("ul", group).hide();
      var parent = $6(this).closest("li");
      $6("ul", parent).show();
    });
    $6(".option-group").each(function() {
      $6(".option-group input[type=radio]").each(function() {
        if ($6(this).is(":checked")) {
          var parent = $6(this).closest("li");
          $6("ul", parent).show();
        }
      });
    });
    $6(".header-expand-collapse").click(function() {
      if ($6(".expand-collapse-arrow", this).hasClass("collapsed")) {
        $6(".expand-collapse-arrow", this).removeClass("collapsed");
        $6(this).next().show();
      } else {
        $6(".expand-collapse-arrow", this).addClass("collapsed");
        $6(this).next().hide();
      }
    });
    $6(".checkbox-label input[type=checkbox]").change(function() {
      if ($6(this).is(":checked")) {
        $6(this).parent().next().show();
      } else {
        $6(this).parent().next().hide();
      }
    });
    $6("#save-migration-profile").change(function() {
      if ($6(this).is(":checked")) {
        $6(".save-settings-button").show();
        $6(".migrate-db .button-primary").val(syncpilot_i10n.migrate_db_save);
      } else {
        $6(".save-settings-button").hide();
        $6(".migrate-db .button-primary").val(syncpilot_i10n.migrate_db);
      }
    });
    if ($6("#save-migration-profile").is(":checked")) {
      $6(".save-settings-button").show();
      $6(".migrate-db .button-primary").val(syncpilot_i10n.migrate_db_save);
    }
    $6(".checkbox-label input[type=checkbox]").each(function() {
      if ($6(this).is(":checked")) {
        $6(this).parent().next().show();
      }
    });
    $6("#new-url").change(function() {
      $6("#new-url-missing-warning").hide();
    });
    $6("#new-path").change(function() {
      $6("#new-path-missing-warning").hide();
    });
    $6(".general-helper").click(function(e) {
      var icon = $6(this), bubble = $6(this).next();
      $6(".helper-message").not(bubble).hide();
      var position = icon.position();
      if (bubble.hasClass("bottom")) {
        bubble.css({
          "left": position.left - bubble.width() / 2 + "px",
          "top": position.top + icon.height() + 9 + "px"
        });
      } else {
        bubble.css({
          "left": position.left + icon.width() + 9 + "px",
          "top": position.top + icon.height() / 2 - 18 + "px"
        });
      }
      bubble.toggle();
      e.stopPropagation();
    });
    $6("body").click(function() {
      $6(".helper-message").hide();
    });
    $6(".helper-message").click(function(e) {
      e.stopPropagation();
    });
  }

  // asset/src/js/modules/multiselect.js
  var $7 = jQuery;
  function init_multiselect() {
    $7(".multiselect-select-all").click(function() {
      var multiselect = $7(this).parents(".select-wrap").children(".multiselect");
      $7(multiselect).focus();
      $7("option", multiselect).attr("selected", 1);
    });
    $7(".multiselect-deselect-all").click(function() {
      var multiselect = $7(this).parents(".select-wrap").children(".multiselect");
      $7(multiselect).focus();
      $7("option", multiselect).removeAttr("selected");
    });
    $7(".multiselect-invert-selection").click(function() {
      var multiselect = $7(this).parents(".select-wrap").children(".multiselect");
      $7(multiselect).focus();
      $7("option", multiselect).each(function() {
        $7(this).attr("selected", !$7(this).attr("selected"));
      });
    });
    $7("input.multiselect-toggle").change(function() {
      $7(this).parents(".expandable-content").children(".select-wrap").toggle();
    });
    $7(".show-multiselect").each(function() {
      if ($7(this).is(":checked")) {
        $7(this).parents(".option-section").children(".header-expand-collapse").children(".expand-collapse-arrow").removeClass("collapsed");
        $7(this).parents(".expandable-content").show();
        $7(this).parents(".expandable-content").children(".select-wrap").toggle();
      }
    });
    $7("input[name=backup_option]").change(function() {
      $7(".backup-tables-wrap").hide();
      if ($7(this).val() == "backup_manual_select") {
        $7(".backup-tables-wrap").show();
      }
    });
    if ($7("#backup-manual-select").is(":checked")) {
      $7(".backup-tables-wrap").show();
    }
  }

  // asset/src/js/modules/replace-rows.js
  var $8 = jQuery;
  function init_replace_rows() {
    $8("body").on("click", ".add-row", function() {
      $8(this).parents("tr").before($8(".original-repeatable-field").clone().removeClass("original-repeatable-field"));
    });
    $8("body").on("click", ".replace-remove-row", function() {
      $8(this).parents("tr").remove();
      if ($8(".replace-row").length < 2) {
        $8(".no-replaces-message").show();
      }
    });
    $8(".add-replace").click(function() {
      $8(".replace-fields").prepend($8(".original-repeatable-field").clone().removeClass("original-repeatable-field"));
      $8(".no-replaces-message").hide();
    });
    $8("body").on(
      "mouseenter mouseleave",
      "#find-and-replace-sort tbody tr.replace-row",
      function(event) {
        if (event.type === "mouseenter") {
          $8(".replace-remove-row", this).show();
        } else {
          $8(".replace-remove-row", this).hide();
        }
      }
    );
    $8("#find-and-replace-sort tbody").sortable({
      items: "> tr:not(.pin)",
      handle: "td:first",
      start: function() {
        $8(".sort-handle").css("cursor", "-webkit-grabbing");
        $8(".sort-handle").css("cursor", "-moz-grabbing");
      },
      stop: function() {
        $8(".sort-handle").css("cursor", "-webkit-grab");
        $8(".sort-handle").css("cursor", "-moz-grab");
      }
    });
  }
  function get_scheme(url) {
    return /^https:/i.test(url) ? "https" : "http";
  }
  function add_scheme_row(source_url, target_url) {
    $8(".scheme-row").remove();
    var from = get_scheme(source_url);
    var to = get_scheme(target_url);
    if (!$8("#new-url").val() || !$8("#old-path").length || from == to) {
      return;
    }
    var row = $8(".original-repeatable-field").clone().removeClass("original-repeatable-field").addClass("scheme-row");
    $8('input[name="replace_old[]"]', row).val(from + "://");
    $8('input[name="replace_new[]"]', row).val(to + "://");
    $8("#old-path").parents("tr").after(row);
  }

  // asset/src/js/modules/profiles.js
  var $9 = jQuery;
  function init_profiles() {
    $9("body").on("mouseenter mouseleave", ".save-migration-profile-wrap li", function(event) {
      if (event.type === "mouseenter") {
        $9(".delete-profile", this).show();
      } else {
        $9(".delete-profile", this).hide();
      }
    });
    $9("body").on("click", ".delete-profile", function() {
      var $name = $9(this).next().clone();
      $9("input", $name).remove();
      var name = $9.trim($9($name).text());
      var $link = $9(this);
      syncpilot_confirm(syncpilot_i10n.remove_profile + ' "' + name + '"', function() {
        delete_profile($link);
      });
    });
    function delete_profile($link) {
      $link.parent().fadeOut(500);
      $9.ajax({
        url: ajaxurl,
        type: "POST",
        dataType: "text",
        cache: false,
        data: {
          action: "syncpilot_delete_migration_profile",
          profile_id: $link.attr("data-profile-id"),
          nonce: syncpilot_nonces.delete_migration_profile
        },
        error: function(jqXHR, textStatus, errorThrown) {
          syncpilot_alert(syncpilot_i10n.remove_profile_problem);
        },
        success: function(data) {
          if (data == "-1") {
            syncpilot_alert(syncpilot_i10n.remove_profile_not_found);
          }
        }
      });
    }
    $9(".main-list-delete-profile-link").click(function() {
      var name = $9(this).prev().text();
      var $link = $9(this);
      syncpilot_confirm(syncpilot_i10n.remove_profile + ' "' + name + '"', function() {
        delete_profile($link);
      });
    });
  }

  // asset/src/js/modules/api-key.js
  var $10 = jQuery;
  function init_api_key() {
    $10(".reset-api-key").click(function() {
      if (state.doing_reset_api_key_ajax) {
        return;
      }
      syncpilot_confirm(syncpilot_i10n.reset_api_key, reset_api_key);
    });
    function reset_api_key() {
      state.doing_reset_api_key_ajax = true;
      $10(".reset-api-key").after('<img src="' + spinner_url + '" alt="" class="reset-api-key-ajax-spinner general-spinner" />');
      $10.ajax({
        url: ajaxurl,
        type: "POST",
        dataType: "text",
        cache: false,
        data: {
          action: "syncpilot_reset_api_key",
          nonce: syncpilot_nonces.reset_api_key
        },
        error: function(jqXHR, textStatus, errorThrown) {
          syncpilot_alert(syncpilot_i10n.reset_api_key_problem);
          $10(".reset-api-key-ajax-spinner").remove();
          state.doing_reset_api_key_ajax = false;
        },
        success: function(data) {
          $10(".reset-api-key-ajax-spinner").remove();
          state.doing_reset_api_key_ajax = false;
          $10(".connection-info").html(data);
        }
      });
    }
  }

  // asset/src/js/modules/settings.js
  var $11 = jQuery;
  function init_settings() {
    $11(".settings-tab input[type=checkbox]").change(function() {
      if ("plugin-compatibility" == $11(this).attr("id")) return;
      var checked = $11(this).is(":checked");
      var setting = $11(this).attr("id");
      $11(this).parent().append('<img src="' + spinner_url + '" alt="" class="ajax-spinner general-spinner" />');
      var $label = $11(this).parent();
      $11.ajax({
        url: ajaxurl,
        type: "POST",
        dataType: "text",
        cache: false,
        data: {
          action: "syncpilot_save_setting",
          checked,
          setting,
          nonce: syncpilot_nonces.save_setting
        },
        error: function(jqXHR, textStatus, errorThrown) {
          syncpilot_alert(syncpilot_i10n.save_settings_problem);
          $11(".ajax-spinner").remove();
        },
        success: function(data) {
          $11(".ajax-spinner").remove();
          $11($label).append('<span class="ajax-success-msg">' + syncpilot_i10n.saved + "</span>");
          $11(".ajax-success-msg").fadeOut(2e3, function() {
            $11(this).remove();
          });
        }
      });
    });
  }

  // asset/src/js/modules/tabs.js
  var $12 = jQuery;
  function init_tabs() {
    $12(".nav-tab").click(function() {
      $12(".nav-tab").removeClass("nav-tab-active");
      $12(this).addClass("nav-tab-active");
      $12(".content-tab").hide();
      $12("." + $12(this).attr("data-div-name")).show();
      var hash2 = $12(this).attr("data-div-name");
      hash2 = hash2.replace("-tab", "");
      window.location.hash = hash2;
      if ($12(this).hasClass("diagnostics")) {
        refresh_debug_log();
      }
    });
    if (window.location.hash) {
      var hash = window.location.hash.substring(1);
      switch_to_plugin_tab(hash, false);
    }
    if (get_query_var("install-plugin") != "") {
      hash = "addons";
      switch_to_plugin_tab(hash, true);
    }
    function switch_to_plugin_tab(hash2, skip_addons_check) {
      $12(".nav-tab").removeClass("nav-tab-active");
      $12(".nav-tab." + hash2).addClass("nav-tab-active");
      $12(".content-tab").hide();
      $12("." + hash2 + "-tab").show();
      if (hash2 == "diagnostics") {
        refresh_debug_log();
      }
    }
  }

  // asset/src/js/modules/form-check.js
  var $13 = jQuery;
  function tables_are_chosen() {
    if ($13("#migrate-selected").is(":checked") && !($13("#select-tables").val() || []).length) {
      syncpilot_alert(syncpilot_i10n.please_select_one_table);
      return false;
    }
    return true;
  }
  function form_is_valid() {
    if (!tables_are_chosen()) {
      return false;
    }
    var new_url_missing = false;
    var new_file_path_missing = false;
    if ($13("#new-url").length && !$13("#new-url").val()) {
      $13("#new-url-missing-warning").show();
      $13("#new-url").focus();
      $13("html,body").scrollTop(0);
      new_url_missing = true;
    }
    if ($13("#new-path").length && !$13("#new-path").val()) {
      $13("#new-path-missing-warning").show();
      if (false == new_url_missing) {
        $13("#new-path").focus();
        $13("html,body").scrollTop(0);
      }
      new_file_path_missing = true;
    }
    return !(new_url_missing || new_file_path_missing);
  }

  // asset/src/js/modules/progress.js
  var $14 = jQuery;
  function choose_tables(stage) {
    var table_rows = "";
    if (stage == "backup") {
      var backup_option = $14("input[name=backup_option]:checked").val();
      var table_option = $14("input[name=table_migrate_option]:checked").val();
      if (table_option == "migrate_only_with_prefix" && backup_option == "backup_selected") {
        backup_option = "backup_only_with_prefix";
      }
      if (state.migration_intent == "push") {
        table_rows = connection_data.table_rows;
        if (backup_option == "backup_only_with_prefix") {
          state.tables_to_migrate = connection_data.prefixed_tables;
        } else if (backup_option == "backup_selected") {
          state.tables_to_migrate = get_intersect($14("#select-tables").val(), connection_data.tables);
        } else if (backup_option == "backup_manual_select") {
          state.tables_to_migrate = $14("#select-backup").val();
        }
      } else {
        table_rows = syncpilot_this_table_rows;
        if (backup_option == "backup_only_with_prefix") {
          state.tables_to_migrate = syncpilot_this_prefixed_tables;
        } else if (backup_option == "backup_selected") {
          state.tables_to_migrate = get_intersect($14("#select-tables").val(), syncpilot_this_tables);
        } else if (backup_option == "backup_manual_select") {
          state.tables_to_migrate = $14("#select-backup").val();
        }
      }
      return table_rows;
    }
    var sends_from_here = state.migration_intent == "push" || state.migration_intent == "savefile";
    if ($14("input[name=table_migrate_option]:checked").val() == "migrate_select") {
      state.tables_to_migrate = $14("#select-tables").val();
      table_rows = sends_from_here ? syncpilot_this_table_rows : connection_data.table_rows;
    } else if (sends_from_here) {
      state.tables_to_migrate = syncpilot_this_prefixed_tables;
      table_rows = syncpilot_this_table_rows;
    } else {
      state.tables_to_migrate = connection_data.prefixed_tables;
      table_rows = connection_data.table_rows;
    }
    return table_rows;
  }
  function draw_table_chunks(tables_to_migrate, table_rows) {
    var total_size = 0;
    $14.each(tables_to_migrate, function(index, value) {
      total_size += parseInt(table_rows[value]);
    });
    var last_element = "";
    $14.each(tables_to_migrate, function(index, value) {
      var percent2 = table_rows[value] / total_size * 100;
      var percent_rounded2 = Math.round(percent2 * 1e3) / 1e3;
      $14(".progress-tables").append('<div class="progress-chunk ' + value + '_chunk" style="width: ' + percent_rounded2 + '%;" title="' + value + '"><span>' + value + "</span></div>");
      $14(".progress-tables-hover-boxes").append(
        '<div class="progress-chunk-hover" data-table="' + value + '" style="width: ' + percent_rounded2 + '%;"></div>'
      );
      var label2 = $14(".progress-tables .progress-chunk:last span");
      last_element = value;
    });
    var box_style = { display: $14(".progress-content")[0].style.display, visibility: $14(".progress-content")[0].style.visibility };
    $14(".progress-content").css({ display: "block", visibility: "hidden" });
    $14(".progress-chunk").each(function(index) {
      if ($14(this).width() < 1 && tables_to_migrate[index] != last_element) {
        $14(this).hide();
        $14(".progress-chunk-hover[data-table=" + tables_to_migrate[index] + "]").hide();
        table_rows[last_element] = Number(table_rows[last_element]);
        table_rows[last_element] += Number(table_rows[tables_to_migrate[index]]);
        table_rows[tables_to_migrate[index]] = 0;
      }
      var element = this;
      setTimeout(function() {
        hide_overflowing_elements(element);
      }, 0);
      function hide_overflowing_elements(element2) {
        if ($14("span", element2).innerWidth() > $14(element2).width()) {
          $14("span", element2).hide();
        }
      }
    });
    $14(".progress-content").css(box_style);
    var percent_rounded = 0;
    if (table_rows[last_element] != 0) {
      var percent = table_rows[last_element] / total_size * 100;
      percent_rounded = Math.round(percent * 1e3) / 1e3;
    }
    $14(".progress-tables .progress-chunk:last").css(
      "width",
      percent_rounded + "%"
    );
    $14(".progress-chunk-hover:last").css("width", percent_rounded + "%");
    var return_vals = [table_rows, total_size];
    return return_vals;
  }
  function create_overlay() {
    var doc_height = $14(document).height();
    $14("body").append('<div id="overlay"></div>');
    $14("#overlay").height(doc_height).css({
      "position": "fixed",
      "top": 0,
      "left": 0,
      "width": "100%",
      "z-index": 99999,
      "display": "none"
    });
  }
  function show_progress_box(template, title) {
    $14("#overlay").after(template.clone());
    $14(".progress-title").html(title);
    $14("#overlay").show();
  }
  function slide_in_progress_box() {
    $14(".progress-title").after(
      '<img src="' + spinner_url + '" alt="" class="migration-progress-ajax-spinner general-spinner" />'
    );
    var height = $14(".progress-content").outerHeight();
    $14(".progress-content").css("top", "-" + height + "px").show().animate({
      "top": "0px"
    });
  }

  // asset/src/js/modules/save-profile.js
  var $15 = jQuery;
  function profile_has_name() {
    if ($15.trim($15(".create-new-profile").val()) == "" && $15("#create_new").is(":checked")) {
      syncpilot_alert(syncpilot_i10n.enter_name_for_profile);
      $15(".create-new-profile").focus();
      return false;
    }
    return true;
  }
  function is_new_profile() {
    return $15("#create_new").is(":checked");
  }
  function send_profile(on_success, on_error) {
    $15.ajax({
      url: ajaxurl,
      type: "POST",
      dataType: "text",
      cache: false,
      data: {
        action: "syncpilot_save_profile",
        profile: $15("#migrate-form").serialize(),
        nonce: syncpilot_nonces.save_profile
      },
      error: function(jqXHR, textStatus, errorThrown) {
        syncpilot_alert(syncpilot_i10n.save_profile_problem);
        if (on_error) {
          on_error();
        }
      },
      success: on_success
    });
  }
  function add_profile_to_list(data, name) {
    var new_profile_key = parseInt(data, 10);
    var new_profile_id = new_profile_key + 1;
    var new_li = '<li><span style="display: none;" class="delete-profile" data-profile-id="' + new_profile_id + '"></span><label for="profile-' + new_profile_id + '"><input id="profile-' + new_profile_id + '" value="' + new_profile_key + '" name="save_migration_profile_option" type="radio"> ' + name + "</label></li>";
    $15("#create_new").parents("li").before(new_li);
    $15("#profile-" + new_profile_id).attr("checked", "checked");
  }

  // asset/src/js/modules/migration.js
  var $16 = jQuery;
  var run = {
    table_rows: {},
    total_size: 0,
    index: 0,
    progress_size: 0,
    last_progress: 0,
    overall_table_progress: 0
  };
  function init_migration() {
    window.migrate_table_recursive = migrate_table_recursive;
  }
  function migration_failed(text) {
    $16(".progress-title").html(syncpilot_i10n.migration_failed);
    $16(".progress-text").html(text);
    $16(".progress-text").addClass("migration-error");
    migration_error = true;
    migration_complete_events();
  }
  function request_problem(jqXHR, textStatus, errorThrown, status_label, response_label) {
    console.log(jqXHR);
    console.log(textStatus);
    console.log(errorThrown);
    return "<br /><br />" + status_label + ": " + jqXHR.status + " " + jqXHR.statusText + "<br /><br />" + response_label + ":<br />" + jqXHR.responseText;
  }
  function initiate_migration(table_rows, total_size) {
    state.doing_ajax = true;
    $16.ajax({
      url: ajaxurl,
      type: "POST",
      dataType: "json",
      cache: false,
      data: {
        action: "syncpilot_initiate_migration",
        intent: state.migration_intent,
        url: state.remote_site,
        key: state.secret_key,
        form_data: state.form_data,
        stage: state.stage,
        nonce: syncpilot_nonces.initiate_migration
      },
      error: function(jqXHR, textStatus, errorThrown) {
        state.doing_ajax = false;
        migration_failed(syncpilot_i10n.connection_local_server_problem + " (#112)" + request_problem(jqXHR, textStatus, errorThrown, "Status", "Response"));
      },
      success: function(data) {
        state.doing_ajax = false;
        if (typeof data.syncpilot_error != "undefined" && data.syncpilot_error == 1) {
          migration_failed(syncpilot_sanitize_html(data.body));
          return;
        }
        state.dump_url = data.dump_url;
        state.dump_filename = data.dump_filename;
        start_tables(table_rows, total_size);
      }
    });
  }
  function start_tables(table_rows, total_size) {
    run.table_rows = table_rows;
    run.total_size = total_size;
    run.index = 0;
    run.progress_size = 0;
    run.last_progress = 0;
    run.overall_table_progress = 0;
    state.overall_percent = 0;
    next_step_in_migration = {
      fn: migrate_table_recursive,
      args: ["-1", ""]
    };
    execute_next_step();
  }
  function migrate_table_recursive(current_row, primary_keys) {
    if (run.index >= state.tables_to_migrate.length) {
      if (state.stage == "backup") {
        start_migrate_stage();
      } else {
        start_final_steps();
        return;
      }
    }
    show_table_text();
    send_table_request(current_row, primary_keys);
  }
  function start_migrate_stage() {
    state.stage = "migrate";
    run.index = 0;
    run.progress_size = 0;
    $16(".progress-bar").width("0px");
    run.table_rows = choose_tables("migrate");
    $16(".progress-tables").empty();
    $16(".progress-tables-hover-boxes").empty();
    var table_details = draw_table_chunks(state.tables_to_migrate, run.table_rows);
    run.table_rows = table_details[0];
    run.total_size = table_details[1];
  }
  function start_final_steps() {
    call_stack = [];
    if (media_files_chosen()) {
      call_stack.push(determine_media_to_migrate);
    }
    call_stack.push(migration_complete, migration_complete_events);
    next_step_in_migration = {
      fn: run_next_step
    };
    execute_next_step();
  }
  function show_table_text() {
    var label2 = state.stage == "backup" ? syncpilot_i10n.backing_up : syncpilot_i10n.migrating;
    $16(".progress-text").html(state.overall_percent + "% - " + label2 + ' "' + state.tables_to_migrate[run.index] + '"');
  }
  function table_request_data(current_row, primary_keys) {
    var last_table = run.index == state.tables_to_migrate.length - 1 ? 1 : 0;
    var gzip = 0;
    if (state.migration_intent != "savefile" && parseInt(connection_data.gzip) == 1) {
      gzip = 1;
    }
    var request_data = {
      action: "syncpilot_migrate_table",
      intent: state.migration_intent,
      url: state.remote_site,
      key: state.secret_key,
      table: state.tables_to_migrate[run.index],
      form_data: state.form_data,
      stage: state.stage,
      current_row,
      dump_filename: state.dump_filename,
      last_table,
      primary_keys,
      gzip,
      nonce: syncpilot_nonces.migrate_table
    };
    if (state.migration_intent != "savefile") {
      request_data.bottleneck = connection_data.bottleneck;
      request_data.prefix = connection_data.prefix;
    }
    if (connection_data && connection_data.path_current_site && connection_data.domain) {
      request_data.path_current_site = connection_data.path_current_site;
      request_data.domain_current_site = connection_data.domain;
    }
    return request_data;
  }
  function send_table_request(current_row, primary_keys) {
    state.doing_ajax = true;
    $16.ajax({
      url: ajaxurl,
      type: "POST",
      dataType: "text",
      cache: false,
      timeout: 0,
      data: table_request_data(current_row, primary_keys),
      error: function(jqXHR, textStatus, errorThrown) {
        state.doing_ajax = false;
        migration_failed(syncpilot_i10n.table_process_problem + " " + state.tables_to_migrate[run.index] + request_problem(jqXHR, textStatus, errorThrown, syncpilot_i10n.status, syncpilot_i10n.response));
      },
      success: table_answered
    });
  }
  function table_answered(data) {
    state.doing_ajax = false;
    data = data.trim();
    var row_information;
    try {
      row_information = JSON.parse(data);
    } catch (variable) {
      if ("" == data || null == data) {
        migration_failed(syncpilot_i10n.table_process_problem_empty_response + " " + state.tables_to_migrate[run.index]);
      } else {
        migration_failed(syncpilot_sanitize_html(data));
      }
      return;
    }
    if (typeof row_information.syncpilot_error != "undefined" && row_information.syncpilot_error == 1) {
      migration_failed(syncpilot_sanitize_html(row_information.body));
      return;
    }
    count_progress(row_information);
    next_step_in_migration = {
      fn: migrate_table_recursive,
      args: [row_information.current_row, row_information.primary_keys]
    };
    execute_next_step();
  }
  function count_progress(row_information) {
    if (row_information.current_row == "-1") {
      run.progress_size -= run.overall_table_progress;
      run.overall_table_progress = 0;
      run.last_progress = 0;
      run.progress_size += parseInt(run.table_rows[state.tables_to_migrate[run.index]]);
      run.index++;
      row_information.current_row = "";
      row_information.primary_keys = "";
    } else {
      var current_progress = parseInt(row_information.current_row);
      var table_progress = current_progress - run.last_progress;
      run.last_progress = current_progress;
      run.progress_size += table_progress;
      run.overall_table_progress += table_progress;
    }
    var percent = 100 * run.progress_size / run.total_size;
    $16(".progress-bar").width(percent + "%");
    state.overall_percent = Math.floor(percent);
  }

  // asset/src/js/script.js
  window.migration_complete = void 0;
  window.migration_complete_events = void 0;
  window.execute_next_step = void 0;
  (function($17) {
    window.onbeforeunload = function(e) {
      if (state.currently_migrating) {
        e = e || window.event;
        if (e) {
          e.returnValue = "Sure?";
        }
        return "Sure?";
      }
    };
    $17(document).ready(function() {
      init_plugin_compatibility();
      init_slider();
      var progress_content_original = $17(".progress-content").clone();
      $17(".progress-content").remove();
      var push_select = $17("#select-tables").clone();
      var pull_select = $17("#select-tables").clone();
      var push_post_type_select = $17("#select-post-types").clone();
      var pull_post_type_select = $17("#select-post-types").clone();
      var push_select_backup = $17("#select-backup").clone();
      var pull_select_backup = $17("#select-backup").clone();
      $17(".backup-options").show();
      $17(".keep-active-plugins").show();
      if ($17("#savefile").is(":checked")) {
        $17(".backup-options").hide();
        $17(".keep-active-plugins").hide();
      }
      function disable_export_type_controls() {
        $17(".option-group").each(function(index) {
          $17("input", this).attr("disabled", "disabled");
          $17("label", this).css("cursor", "default");
        });
      }
      function enable_export_type_controls() {
        $17(".option-group").each(function(index) {
          $17("input", this).removeAttr("disabled");
          $17("label", this).css("cursor", "pointer");
        });
      }
      establish_remote_connection_from_saved_profile();
      function establish_remote_connection_from_saved_profile() {
        var action = $17("input[name=action]:checked").val();
        var connection_info = $17.trim($17(".pull-push-connection-info").val()).split(
          "\n"
        );
        if (typeof syncpilot_default_profile == "undefined" || syncpilot_default_profile == true || action == "savefile" || state.doing_ajax) {
          return;
        }
        state.last_replace_switch = action;
        state.doing_ajax = true;
        disable_export_type_controls();
        $17(".connection-status").html(syncpilot_i10n.establishing_remote_connection);
        $17(".connection-status").removeClass(
          "notification-message error-notice migration-error"
        );
        $17(".connection-status").append('<img src="' + spinner_url + '" alt="" class="ajax-spinner general-spinner" />');
        var intent = $17("input[name=action]:checked").val();
        $17.ajax({
          url: ajaxurl,
          type: "POST",
          dataType: "json",
          cache: false,
          data: {
            action: "syncpilot_verify_connection_to_remote_site",
            url: connection_info[0],
            key: connection_info[1],
            intent,
            nonce: syncpilot_nonces.verify_connection_to_remote_site,
            convert_post_type_selection: syncpilot_convert_post_type_selection,
            profile: syncpilot_profile
          },
          error: function(jqXHR, textStatus, errorThrown) {
            $17(".connection-status").html(syncpilot_i10n.connection_local_server_problem + " (#102)");
            $17(".connection-status").append("<br /><br />Status: " + jqXHR.status + " " + jqXHR.statusText + "<br /><br />Response:<br />" + jqXHR.responseText);
            $17(".connection-status").addClass(
              "notification-message error-notice migration-error"
            );
            $17(".ajax-spinner").remove();
            state.doing_ajax = false;
            enable_export_type_controls();
          },
          success: function(data) {
            $17(".ajax-spinner").remove();
            state.doing_ajax = false;
            enable_export_type_controls();
            if (typeof data.syncpilot_error != "undefined" && data.syncpilot_error == 1) {
              $17(".connection-status").html(syncpilot_sanitize_html(data.body));
              $17(".connection-status").addClass(
                "notification-message error-notice migration-error"
              );
              if (data.body.indexOf("401 Unauthorized") > -1) {
                $17(".basic-access-auth-wrapper").show();
              }
              return;
            }
            maybe_show_ssl_warning(connection_info[0], connection_info[1], data.scheme);
            maybe_show_version_warning(data.plugin_version, connection_info[0]);
            maybe_show_prefix_notice(data.prefix);
            $17(".pull-push-connection-info").addClass("temp-disabled");
            $17(".pull-push-connection-info").attr("readonly", "readonly");
            $17(".connect-button").hide();
            $17(".connection-status").hide();
            $17(".step-two").show();
            state.connection_established = true;
            connection_data = data;
            move_connection_info_box();
            var loaded_tables = "";
            if (syncpilot_default_profile == false && typeof syncpilot_loaded_tables != "undefined") {
              loaded_tables = syncpilot_loaded_tables;
            }
            var table_select = document.createElement("select");
            $17(table_select).attr({
              multiple: "multiple",
              name: "select_tables[]",
              id: "select-tables",
              class: "multiselect"
            });
            $17.each(connection_data.tables, function(index, value) {
              var selected = $17.inArray(value, loaded_tables);
              if (selected != -1) {
                selected = ' selected="selected" ';
              } else {
                selected = " ";
              }
              $17(table_select).append("<option" + selected + 'value="' + value + '">' + value + " (" + connection_data.table_sizes_hr[value] + ")</option>");
            });
            pull_select = table_select;
            var loaded_post_types = "";
            if (syncpilot_default_profile == false && typeof syncpilot_loaded_post_types != "undefined") {
              if (typeof data.select_post_types != "undefined") {
                $17("#exclude-post-types").attr("checked", "checked");
                $17(".post-type-select-wrap").show();
                loaded_post_types = data.select_post_types;
              } else {
                loaded_post_types = syncpilot_loaded_post_types;
              }
            }
            var post_type_select = document.createElement("select");
            $17(post_type_select).attr({
              multiple: "multiple",
              name: "select_post_types[]",
              id: "select-post-types",
              class: "multiselect"
            });
            $17.each(connection_data.post_types, function(index, value) {
              var selected = $17.inArray(value, loaded_post_types);
              if (selected != -1 || syncpilot_convert_exclude_revisions == true && value != "revision") {
                selected = ' selected="selected" ';
              } else {
                selected = " ";
              }
              $17(post_type_select).append("<option" + selected + 'value="' + value + '">' + value + "</option>");
            });
            pull_post_type_select = post_type_select;
            var loaded_tables_backup = "";
            if (syncpilot_default_profile == false && typeof syncpilot_loaded_tables_backup != "undefined") {
              loaded_tables_backup = syncpilot_loaded_tables_backup;
            }
            var table_select_backup = document.createElement("select");
            $17(table_select_backup).attr({
              multiple: "multiple",
              name: "select_backup[]",
              id: "select-backup",
              class: "multiselect"
            });
            $17.each(connection_data.tables, function(index, value) {
              var selected = $17.inArray(value, loaded_tables_backup);
              if (selected != -1) {
                selected = ' selected="selected" ';
              } else {
                selected = " ";
              }
              $17(table_select_backup).append("<option" + selected + 'value="' + value + '">' + value + " (" + connection_data.table_sizes_hr[value] + ")</option>");
            });
            push_select_backup = table_select_backup;
            if ($17("#pull").is(":checked")) {
              $17("#select-tables").remove();
              $17(".select-tables-wrap").prepend(pull_select);
              $17("#select-post-types").remove();
              $17(".select-post-types-wrap").prepend(pull_post_type_select);
              $17("#select-backup").remove();
              $17(".backup-tables-wrap").prepend(pull_select_backup);
              $17(".table-prefix").text(data.prefix);
              $17(".uploads-dir").html(syncpilot_this_uploads_dir);
            } else {
              $17("#select-backup").remove();
              $17(".backup-tables-wrap").prepend(push_select_backup);
            }
            media_files_connection_verified(connection_data);
          }
        });
      }
      init_diagnostics();
      init_form_ui();
      init_multiselect();
      init_replace_rows();
      init_profiles();
      init_api_key();
      init_settings();
      init_tabs();
      init_migration();
      $17(".migrate-db-button").click(run_migration);
      function run_migration(event) {
        $17(this).blur();
        event.preventDefault();
        if (!form_is_valid()) {
          return;
        }
        if ($17("#save-migration-profile").is(":checked")) {
          if (!profile_has_name()) {
            return;
          }
          var create_new_profile = is_new_profile();
          var profile_name = $17(".create-new-profile").val();
          send_profile(function(data) {
            if (create_new_profile) {
              add_profile_to_list(data, profile_name);
              $17(".create-new-profile").val("");
            }
          });
        }
        state.form_data = $17("#migrate-form").serialize();
        create_overlay();
        state.migration_intent = $17("input[name=action]:checked").val();
        state.stage = "backup";
        if (state.migration_intent == "savefile") {
          state.stage = "migrate";
        }
        if ($17("#create-backup").is(":checked") == false) {
          state.stage = "migrate";
        }
        var connection_info = $17.trim($17(".pull-push-connection-info").val()).split("\n");
        state.remote_site = connection_info[0];
        state.secret_key = connection_info[1];
        var static_migration_label = "";
        state.completed_msg = syncpilot_i10n.exporting_complete;
        if (state.migration_intent == "savefile") {
          static_migration_label = syncpilot_i10n.exporting_please_wait;
        } else {
          static_migration_label = get_default_profile_name(
            state.remote_site,
            state.migration_intent,
            true
          ) + ", " + syncpilot_i10n.please_wait;
          state.completed_msg = get_default_profile_name(
            state.remote_site,
            state.migration_intent,
            true
          ) + " " + syncpilot_i10n.complete;
        }
        show_progress_box(progress_content_original, static_migration_label);
        var table_rows = choose_tables(state.stage);
        var table_details = draw_table_chunks(state.tables_to_migrate, table_rows);
        var total_size = table_details[1];
        table_rows = table_details[0];
        slide_in_progress_box();
        setup_counter();
        state.currently_migrating = true;
        initiate_migration(table_rows, total_size);
      }
      migration_complete_events = function() {
        if (false == migration_error) {
          if (non_fatal_errors == "") {
            if ("savefile" != state.migration_intent && true == $17("#save_computer").is(":checked")) {
              $17(".progress-text").css("visibility", "hidden");
            }
            $17(".progress-title").html(state.completed_msg).append(
              '<div class="dashicons dashicons-yes"></div>'
            );
          } else {
            $17(".progress-text").html(syncpilot_sanitize_html(non_fatal_errors));
            $17(".progress-text").addClass("migration-error");
            $17(".progress-title").html(syncpilot_i10n.completed_with_some_errors);
          }
          $17(".progress-bar-wrapper").hide();
        }
        $17(".migration-controls").hide();
        call_stack = [];
        migration_error = false;
        state.currently_migrating = false;
        state.migration_completed = true;
        state.migration_paused = false;
        state.migration_cancelled = false;
        state.doing_ajax = false;
        non_fatal_errors = "";
        $17(".progress-label").remove();
        $17(".migration-progress-ajax-spinner").remove();
        $17(".close-progress-content").show();
        $17("#overlay").css("cursor", "pointer");
        clearInterval(state.elapsed_interval);
      };
      migration_complete = function() {
        $17(".migration-controls").fadeOut();
        if (state.migration_intent == "savefile") {
          state.currently_migrating = false;
          var migrate_complete_text = syncpilot_i10n.migration_complete;
          if ($17("#save_computer").is(":checked")) {
            var url = syncpilot_this_download_url + encodeURIComponent(state.dump_filename);
            if ($17("#gzip_file").is(":checked")) {
              url += "&gzip=1";
            }
            window.location = url;
          } else {
            migrate_complete_text = syncpilot_i10n.completed_dump_located_at + ' <a href="' + state.dump_url + '">' + state.dump_url + "</a>.";
          }
          if (migration_error == false) {
            $17(".progress-text").html(migrate_complete_text);
            migration_complete_events();
            $17(".progress-title").html(state.completed_msg);
          }
        } else {
          $17(".progress-text").html(syncpilot_i10n.finalizing_migration);
          state.doing_ajax = true;
          $17.ajax({
            url: ajaxurl,
            type: "POST",
            dataType: "text",
            cache: false,
            data: {
              action: "syncpilot_finalize_migration",
              intent: state.migration_intent,
              url: state.remote_site,
              key: state.secret_key,
              form_data: state.form_data,
              prefix: connection_data.prefix,
              temp_prefix: connection_data.temp_prefix,
              tables: state.tables_to_migrate.join(","),
              nonce: syncpilot_nonces.finalize_migration
            },
            error: function(jqXHR, textStatus, errorThrown) {
              state.doing_ajax = false;
              $17(".progress-title").html(syncpilot_i10n.migration_failed);
              $17(".progress-text").html(syncpilot_i10n.finalize_tables_problem);
              $17(".progress-text").addClass("migration-error");
              if (window.console && console.log)
                console.log("SyncPilot: finalize", textStatus, errorThrown, jqXHR.responseText);
              migration_error = true;
              migration_complete_events();
              return;
            },
            success: function(data) {
              state.doing_ajax = false;
              if ($17.trim(data) != "") {
                $17(".progress-title").html(syncpilot_i10n.migration_failed);
                $17(".progress-text").html(syncpilot_sanitize_html(data));
                $17(".progress-text").addClass("migration-error");
                migration_error = true;
                migration_complete_events();
                return;
              }
              next_step_in_migration = {
                fn: run_next_step
              };
              execute_next_step();
            }
          });
        }
      };
      $17("body").on("click", ".close-progress-content-button", function(e) {
        hide_overlay();
      });
      $17("body").on("click", "#overlay", function() {
        if (state.migration_completed == true) {
          hide_overlay();
        }
      });
      function hide_overlay() {
        var height = $17(".progress-content").outerHeight();
        $17(".progress-content").animate({
          "top": "-" + height + "px"
        }, 400, "swing", function() {
          $17("#overlay").remove();
          $17(".progress-content").remove();
        });
        state.migration_completed = false;
      }
      $17(".save-settings-button").click(function(event) {
        var $button = $17(this);
        $button.blur();
        event.preventDefault();
        if (state.doing_save_profile) {
          return;
        }
        if (!tables_are_chosen() || !profile_has_name()) {
          return;
        }
        var create_new_profile = is_new_profile();
        var profile_name = $17(".create-new-profile").val();
        state.doing_save_profile = true;
        $button.after('<img src="' + spinner_url + '" alt="" class="save-profile-ajax-spinner general-spinner" />');
        $button.attr("disabled", "disabled");
        function profile_request_ended() {
          $button.removeAttr("disabled");
          $17(".save-profile-ajax-spinner").remove();
          $button.after(
            '<span class="ajax-success-msg">' + syncpilot_i10n.saved + "</span>"
          );
          $17(".ajax-success-msg").fadeOut(2e3, function() {
            $17(this).remove();
          });
          state.doing_save_profile = false;
        }
        send_profile(function(data) {
          profile_request_ended();
          $17(".create-new-profile").val("");
          if (create_new_profile) {
            add_profile_to_list(data, profile_name);
          }
        }, profile_request_ended);
      });
      $17("body").on("mousemove", ".progress-chunk-hover", function(e) {
        mX = e.pageX;
        offset = $17(".progress-bar-wrapper").offset();
        label_offset = $17(".progress-label").outerWidth() / 2;
        mX = mX - offset.left - label_offset;
        $17(".progress-label").css("left", mX + "px");
        $17(".progress-label").html($17(this).attr("data-table"));
      });
      $17("body").on("mouseenter mouseleave", ".progress-chunk-hover", function(event) {
        if (event.type === "mouseenter") {
          $17(".progress-label").addClass("label-visible");
        } else {
          $17(".progress-label").removeClass("label-visible");
        }
      });
      connection_info_box = $17(".connection-info-wrapper");
      move_connection_info_box();
      $17(".migrate-selection.option-group input[type=radio]").change(function() {
        move_connection_info_box();
        if (state.connection_established) {
          change_replace_values();
        }
      });
      function move_connection_info_box() {
        $17(".connection-status").hide();
        $17(".prefix-notice").hide();
        $17(".ssl-notice").hide();
        $17(".different-plugin-version-notice").hide();
        $17(".step-two").show();
        $17(".backup-options").show();
        $17(".keep-active-plugins").show();
        $17(".directory-permission-notice").hide();
        $17("#create-backup").removeAttr("disabled");
        $17("#create-backup-label").removeClass("disabled");
        $17(".backup-option-disabled").hide();
        var connection_info = $17.trim($17(".pull-push-connection-info").val()).split(
          "\n"
        );
        if ($17("#pull").is(":checked")) {
          $17(".pull-list li").append(connection_info_box);
          connection_info_box.show();
          if (state.connection_established) {
            $17(".connection-status").hide();
            $17(".step-two").show();
            $17(".table-prefix").text(connection_data.prefix);
            $17(".uploads-dir").html(syncpilot_this_uploads_dir);
            if (state.profile_name_edited == false) {
              var profile_name = get_domain_name(connection_info[0]);
              $17(".create-new-profile").val(profile_name);
            }
            if (state.show_prefix_notice == true) {
              $17(".prefix-notice.pull").show();
            }
            if (state.show_ssl_notice == true) {
              $17(".ssl-notice").show();
            }
            if (state.show_version_notice == true) {
              $17(".different-plugin-version-notice").show();
              $17(".step-two").hide();
            }
            $17(".directory-scope").text(syncpilot_i10n.scope_local);
            if (false == syncpilot_write_permission) {
              $17("#create-backup").prop("checked", false);
              $17("#create-backup").attr("disabled", "disabled");
              $17("#create-backup-label").addClass("disabled");
              $17(".backup-option-disabled").show();
              $17(".upload-directory-location").html(syncpilot_this_upload_dir_long);
            }
          } else {
            $17(".connection-status").show();
            $17(".step-two").hide();
          }
        } else if ($17("#push").is(":checked")) {
          $17(".push-list li").append(connection_info_box);
          connection_info_box.show();
          if (state.connection_established) {
            $17(".connection-status").hide();
            $17(".step-two").show();
            $17(".table-prefix").html(syncpilot_this_prefix);
            $17(".uploads-dir").text(connection_data.uploads_dir);
            if (state.profile_name_edited == false) {
              var profile_name = get_domain_name(connection_info[0]);
              $17(".create-new-profile").val(profile_name);
            }
            if (state.show_prefix_notice == true) {
              $17(".prefix-notice.push").show();
            }
            if (state.show_ssl_notice == true) {
              $17(".ssl-notice").show();
            }
            if (state.show_version_notice == true) {
              $17(".different-plugin-version-notice").show();
              $17(".step-two").hide();
            }
            $17(".directory-scope").text(syncpilot_i10n.scope_remote);
            if ("0" == connection_data.write_permissions) {
              $17("#create-backup").prop("checked", false);
              $17("#create-backup").attr("disabled", "disabled");
              $17("#create-backup-label").addClass("disabled");
              $17(".backup-option-disabled").show();
              $17(".upload-directory-location").text(connection_data.upload_dir_long);
            }
          } else {
            $17(".connection-status").show();
            $17(".step-two").hide();
          }
        } else if ($17("#savefile").is(":checked")) {
          $17(".connection-status").hide();
          $17(".step-two").show();
          $17(".table-prefix").html(syncpilot_this_prefix);
          if (state.profile_name_edited == false) {
            $17(".create-new-profile").val("");
          }
          $17(".backup-options").hide();
          $17(".keep-active-plugins").hide();
          if (false == syncpilot_write_permission) {
            $17(".directory-permission-notice").show();
            $17(".step-two").hide();
          }
        }
        media_files_connection_box_moved();
      }
      function change_replace_values() {
        if ($17("#push").is(":checked") || $17("#savefile").is(":checked")) {
          if (state.last_replace_switch == "" || state.last_replace_switch == "pull") {
            $17(".replace-row").each(function() {
              var old_val = $17(".old-replace-col input", this).val();
              $17(".old-replace-col input", this).val($17(
                ".replace-right-col input",
                this
              ).val());
              $17(".replace-right-col input", this).val(old_val);
            });
          }
          $17("#select-tables").remove();
          $17(".select-tables-wrap").prepend(push_select);
          $17("#select-post-types").remove();
          $17(".select-post-types-wrap").prepend(push_post_type_select);
          $17("#select-backup").remove();
          $17(".backup-tables-wrap").prepend(push_select_backup);
          state.last_replace_switch = "push";
        } else if ($17("#pull").is(":checked")) {
          if (state.last_replace_switch == "" || state.last_replace_switch == "push") {
            $17(".replace-row").each(function() {
              var old_val = $17(".old-replace-col input", this).val();
              $17(".old-replace-col input", this).val($17(
                ".replace-right-col input",
                this
              ).val());
              $17(".replace-right-col input", this).val(old_val);
            });
          }
          $17("#select-tables").remove();
          $17(".select-tables-wrap").prepend(pull_select);
          $17("#select-post-types").remove();
          $17(".select-post-types-wrap").prepend(pull_post_type_select);
          $17("#select-backup").remove();
          $17(".backup-tables-wrap").prepend(pull_select_backup);
          state.last_replace_switch = "pull";
        }
      }
      if (($17("#pull").is(":checked") || $17("#push").is(":checked")) && !state.connection_established) {
        $17(".step-two").hide();
        $17(".connection-status").show();
      }
      $17("body").on("click", ".temp-disabled", function() {
        syncpilot_confirm(syncpilot_i10n.change_connection_info, function() {
          $17(".ssl-notice").hide();
          $17(".different-plugin-version-notice").hide();
          $17(".migrate-db-button").show();
          $17(".temp-disabled").removeAttr("readonly");
          $17(".temp-disabled").removeClass("temp-disabled");
          $17(".connect-button").show();
          $17(".step-two").hide();
          $17(".connection-status").show().html(syncpilot_i10n.enter_connection_info);
          state.connection_established = false;
        });
      });
      $17(".migrate-form").submit(function(e) {
        e.preventDefault();
      });
      $17(".connect-button").click(function(event) {
        event.preventDefault();
        $17(this).blur();
        connection_box_changed();
      });
      $17(".pull-push-connection-info").bind("paste", function(e) {
        var $this = this;
        setTimeout(function() {
          connection_box_changed();
        }, 0);
      });
      $17("body").on("click", ".try-again", function() {
        connection_box_changed();
      });
      $17("body").on("click", ".try-http", function() {
        var connection_info = $17.trim($17(".pull-push-connection-info").val()).split("\n");
        var new_url = connection_info[0].replace("https", "http");
        var new_contents = new_url + "\n" + connection_info[1];
        $17(".pull-push-connection-info").val(new_contents);
        connection_box_changed();
      });
      $17(".create-new-profile").change(function() {
        state.profile_name_edited = true;
      });
      $17("body").on("click", ".temporarily-disable-ssl", function() {
        if (window.location.hash) {
          var hash = window.location.hash.substring(1);
        }
        $17(this).attr("href", $17(this).attr("href") + "&hash=" + hash);
      });
      function connection_box_changed(data) {
        var $this = $17(".pull-push-connection-info");
        if (state.doing_ajax || $17($this).hasClass("temp-disabled")) {
          return;
        }
        var data = $17(".pull-push-connection-info").val();
        var connection_info = $17.trim(data).split("\n");
        var error = false;
        var error_message = "";
        if (connection_info == "") {
          error = true;
          error_message = syncpilot_i10n.connection_info_missing;
        }
        if (connection_info.length != 2 && !error) {
          error = true;
          error_message = syncpilot_i10n.connection_info_incorrect;
        }
        if (!error && !validate_url(connection_info[0])) {
          error = true;
          error_message = syncpilot_i10n.connection_info_url_invalid;
        }
        if (!error && connection_info[1].length != 32) {
          error = true;
          error_message = syncpilot_i10n.connection_info_key_invalid;
        }
        if (!error && connection_info[0] == syncpilot_connection_info[0]) {
          error = true;
          error_message = syncpilot_i10n.connection_info_local_url;
        }
        if (!error && connection_info[1] == syncpilot_connection_info[1]) {
          error = true;
          error_message = syncpilot_i10n.connection_info_local_key;
        }
        if (error) {
          $17(".connection-status").html(error_message);
          $17(".connection-status").addClass(
            "notification-message error-notice migration-error"
          );
          return;
        }
        if (syncpilot_openssl_available == false) {
          connection_info[0] = connection_info[0].replace("https://", "http://");
          var new_connection_info_contents = connection_info[0] + "\n" + connection_info[1];
          $17(".pull-push-connection-info").val(new_connection_info_contents);
        }
        state.show_prefix_notice = false;
        state.doing_ajax = true;
        disable_export_type_controls();
        if ($17(".basic-access-auth-wrapper").is(":visible")) {
          connection_info[0] = connection_info[0].replace(/\/\/(.*)@/, "//");
          connection_info[0] = connection_info[0].replace("//", "//" + encodeURIComponent($17.trim($17(".auth-username").val())) + ":" + encodeURIComponent($17.trim($17(".auth-password").val())) + "@");
          var new_connection_info_contents = connection_info[0] + "\n" + connection_info[1];
          $17(".pull-push-connection-info").val(new_connection_info_contents);
          $17(".basic-access-auth-wrapper").hide();
        }
        $17(".step-two").hide();
        $17(".ssl-notice").hide();
        $17(".prefix-notice").hide();
        $17(".connection-status").show();
        $17(".connection-status").html(syncpilot_i10n.establishing_remote_connection);
        $17(".connection-status").removeClass(
          "notification-message error-notice migration-error"
        );
        $17(".connection-status").append('<img src="' + spinner_url + '" alt="" class="ajax-spinner general-spinner" />');
        var intent = $17("input[name=action]:checked").val();
        state.profile_name_edited = false;
        $17.ajax({
          url: ajaxurl,
          type: "POST",
          dataType: "json",
          cache: false,
          data: {
            action: "syncpilot_verify_connection_to_remote_site",
            url: connection_info[0],
            key: connection_info[1],
            intent,
            nonce: syncpilot_nonces.verify_connection_to_remote_site
          },
          error: function(jqXHR, textStatus, errorThrown) {
            $17(".connection-status").html(syncpilot_i10n.connection_local_server_problem + " (#100)");
            $17(".connection-status").append("<br /><br />Status: " + jqXHR.status + " " + jqXHR.statusText + "<br /><br />Response:<br />" + jqXHR.responseText);
            $17(".connection-status").addClass(
              "notification-message error-notice migration-error"
            );
            $17(".ajax-spinner").remove();
            state.doing_ajax = false;
            enable_export_type_controls();
          },
          success: function(data2) {
            $17(".ajax-spinner").remove();
            state.doing_ajax = false;
            enable_export_type_controls();
            if (typeof data2.syncpilot_error != "undefined" && data2.syncpilot_error == 1) {
              $17(".connection-status").html(syncpilot_sanitize_html(data2.body));
              $17(".connection-status").addClass(
                "notification-message error-notice migration-error"
              );
              if (data2.body.indexOf("401 Unauthorized") > -1) {
                $17(".basic-access-auth-wrapper").show();
              }
              return;
            }
            var profile_name = get_domain_name(connection_info[0]);
            $17(".create-new-profile").val(profile_name);
            $17(".pull-push-connection-info").addClass("temp-disabled");
            $17(".pull-push-connection-info").attr("readonly", "readonly");
            $17(".connect-button").hide();
            $17(".connection-status").hide();
            $17(".step-two").show();
            maybe_show_ssl_warning(connection_info[0], connection_info[1], data2.scheme);
            maybe_show_version_warning(data2.plugin_version, connection_info[0]);
            maybe_show_prefix_notice(data2.prefix);
            state.connection_established = true;
            connection_data = data2;
            move_connection_info_box();
            var table_select = document.createElement("select");
            $17(table_select).attr({
              multiple: "multiple",
              name: "select_tables[]",
              id: "select-tables",
              class: "multiselect"
            });
            $17.each(connection_data.tables, function(index, value) {
              $17(table_select).append('<option value="' + value + '">' + value + " (" + connection_data.table_sizes_hr[value] + ")</option>");
            });
            pull_select = table_select;
            push_select_backup = $17(table_select).clone();
            $17(push_select_backup).attr({
              name: "select_backup[]",
              id: "select-backup"
            });
            var post_type_select = document.createElement("select");
            $17(post_type_select).attr({
              multiple: "multiple",
              name: "select_post_types[]",
              id: "select-post-types",
              class: "multiselect"
            });
            $17.each(connection_data.post_types, function(index, value) {
              $17(post_type_select).append('<option value="' + value + '">' + value + "</option>");
            });
            pull_post_type_select = post_type_select;
            if ($17("#pull").is(":checked")) {
              $17("#new-url").val(remove_protocol(syncpilot_this_url));
              $17("#new-path").val(syncpilot_this_path);
              if (syncpilot_is_multisite == true) {
                $17("#new-domain").val(syncpilot_this_domain);
              }
              $17("#old-url").val(remove_protocol(data2.url));
              $17("#old-path").val(data2.path);
              $17("#select-tables").remove();
              $17(".select-tables-wrap").prepend(pull_select);
              $17("#select-post-types").remove();
              $17(".select-post-types-wrap").prepend(pull_post_type_select);
              $17(".table-prefix").text(data2.prefix);
              $17(".uploads-dir").html(syncpilot_this_uploads_dir);
            } else {
              $17("#select-backup").remove();
              $17(".backup-tables-wrap").prepend(push_select_backup);
              $17("#new-url").val(remove_protocol(data2.url));
              $17("#new-path").val(data2.path);
            }
            if ($17("#pull").is(":checked")) {
              add_scheme_row(data2.url, syncpilot_this_url);
            } else {
              add_scheme_row(syncpilot_this_url, data2.url);
            }
            next_step_in_migration = {
              fn: media_files_connection_verified,
              args: [connection_data]
            };
            execute_next_step();
          }
        });
      }
      $17("body").on("click", ".pause-resume", function() {
        if (true == state.migration_paused) {
          state.migration_paused = false;
          state.doing_ajax = true;
          $17(".progress-title").html(state.previous_progress_title);
          $17(".progress-text").html(state.previous_progress_text);
          $17(".migration-progress-ajax-spinner").show();
          $17(".pause-resume").html(syncpilot_i10n.pause);
          state.elapsed_interval = setInterval(count, 1e3);
          execute_next_step();
        } else {
          state.migration_paused = true;
          state.doing_ajax = false;
          state.previous_progress_title = $17(".progress-title").html();
          state.previous_progress_text = $17(".progress-text").html();
          $17(".progress-title").html(syncpilot_i10n.migration_paused);
          $17(".pause-resume").html(syncpilot_i10n.resume);
          $17(".progress-text").html(syncpilot_i10n.completing_current_request);
        }
      });
      $17("body").on("click", ".cancel", function() {
        state.migration_cancelled = true;
        state.migration_paused = false;
        $17(".progress-text").html(syncpilot_i10n.completing_current_request);
        $17(".progress-title").html(syncpilot_i10n.cancelling_migration);
        $17(".migration-controls").fadeOut();
        $17(".migration-progress-ajax-spinner").show();
        if (false == state.doing_ajax) {
          execute_next_step();
        }
      });
      execute_next_step = function() {
        if (true == state.migration_paused) {
          $17(".migration-progress-ajax-spinner").hide();
          clearInterval(state.elapsed_interval);
          $17(".progress-text").html(syncpilot_i10n.paused);
          return;
        } else if (true == state.migration_cancelled) {
          state.migration_intent = $17("input[name=action]:checked").val();
          if ("savefile" == state.migration_intent) {
            progress_msg = syncpilot_i10n.removing_local_sql;
          } else if ("pull" == state.migration_intent) {
            if ("backup" == state.stage) {
              progress_msg = syncpilot_i10n.removing_local_backup;
            } else {
              progress_msg = syncpilot_i10n.removing_local_temp_tables;
            }
          } else if ("push" == state.migration_intent) {
            if ("backup" == state.stage) {
              progress_msg = syncpilot_i10n.removing_remote_sql;
            } else {
              progress_msg = syncpilot_i10n.removing_remote_temp_tables;
            }
          }
          $17(".progress-text").html(progress_msg);
          var request_data = {
            action: "syncpilot_cancel_migration",
            intent: state.migration_intent,
            url: state.remote_site,
            key: state.secret_key,
            stage: state.stage,
            dump_filename: state.dump_filename,
            form_data: state.form_data,
            nonce: syncpilot_nonces.cancel_migration
          };
          if (connection_data) {
            request_data.temp_prefix = connection_data.temp_prefix;
          }
          $17.ajax({
            url: ajaxurl,
            type: "POST",
            dataType: "text",
            cache: false,
            data: request_data,
            error: function(jqXHR, textStatus, errorThrown) {
              $17(".progress-title").html(syncpilot_i10n.migration_cancellation_failed);
              $17(".progress-text").html(syncpilot_i10n.manually_remove_temp_files);
              $17(".progress-text").append("<br /><br />Status: " + jqXHR.status + " " + jqXHR.statusText + "<br /><br />Response:<br />" + jqXHR.responseText);
              $17(".progress-text").addClass("migration-error");
              console.log(jqXHR);
              console.log(textStatus);
              console.log(errorThrown);
              migration_error = true;
              migration_complete_events();
              return;
            },
            success: function(data) {
              state.doing_ajax = false;
              data = $17.trim(data);
              if (data != "") {
                $17(".progress-title").html(syncpilot_i10n.migration_cancellation_failed);
                $17(".progress-text").html(syncpilot_sanitize_html(data));
                $17(".progress-text").addClass("migration-error");
                migration_error = true;
                migration_complete_events();
                return;
              }
              state.completed_msg = syncpilot_i10n.migration_cancelled;
              $17(".progress-text").hide();
              migration_complete_events();
            }
          });
        } else {
          next_step_in_migration.fn.apply(null, next_step_in_migration.args);
        }
      };
    });
  })(jQuery);
  function validate_url(url) {
    return /^([a-z]([a-z]|\d|\+|-|\.)*):(\/\/(((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:)*@)?((\[(|(v[\da-f]{1,}\.(([a-z]|\d|-|\.|_|~)|[!\$&'\(\)\*\+,;=]|:)+))\])|((\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5]))|(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=])*)(:\d*)?)(\/(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*|(\/((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)+(\/(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*)?)|((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)+(\/(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*)|((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)){0})(\?((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)|[\uE000-\uF8FF]|\/|\?)*)?(\#((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)|\/|\?)*)?$/i.test(url);
  }
})();

// The media files part of the admin page: it decides whether media files belong to a migration and copies them after the
// last table. script.js calls it through media_files_connection_verified(), media_files_connection_box_moved() and
// media_files_chosen(); these names are global because the parts of the script are put behind each other.
var determine_media_to_migrate;
var remote_media_files_unavailable = false;
var remote_connection_data;
var connection_info;
var media_successfully_determined;

( function ( $ ) {

    // .length doesn't work on JS "associative arrays" i.e. objects with key/value elements, this does
    Object.size = function ( obj ) {

        var size = 0, key;

        for ( key in obj ) {
            if ( obj.hasOwnProperty( key ) ) size++;
        }

        return size;
    };

    // what the media files need to know about the migration form
    function migration_type() {
        return $( 'input[name=action]:checked' ).val();
    }

    function is_media_migration() {
        return $( '#media-files' ).attr( 'data-available' ) == '1' && $( '#media-files' ).is( ':checked' ) ? true : false;
    }

    function disable_media_files_option() {

        $( '#media-files' ).attr( 'data-available', '0' );
        $( '#media-files' ).prop( 'checked', false );
        $( '#media-files' ).attr( 'disabled', 'disabled' );
        $( '.media-files' ).addClass( 'disabled' );
        $( '.media-files-options .expandable-content' ).hide();
    }

    function hide_show_options( unavailable ) {

        var mig_type = migration_type();

        if ( 'savefile' == mig_type ) {
            $( '.media-files-options' ).hide();

            return;
        }

        $( '.media-files-options' ).show();
        $( '.media-files-push' ).hide();

        if ( unavailable ) {
            $( '.media-files-options ul' ).hide();
            $( '.media-migration-unavailable' ).show();
            disable_media_files_option();

            return;
        }

        if ( typeof remote_connection_data != 'undefined' &&
            syncpilot_media_files_version != remote_connection_data.media_files_version
        ) {
            $( '.media-files-remote-location' ).text( remote_connection_data.url );
            $( '.media-file-remote-version' ).text( remote_connection_data.media_files_version );
            $( '.media-files-different-plugin-version-notice' ).show();
            disable_media_files_option();

            return;
        }

        $( '.media-files-options ul' ).show();
        $( '.media-migration-unavailable' ).hide();
        $( '.media-files-different-plugin-version-notice' ).hide();
        $( '#media-files' ).removeAttr( 'disabled' );
        $( '.media-files' ).removeClass( 'disabled' );
        $( '#media-files' ).attr( 'data-available', '1' );
    }

    // The three functions that script.js calls. They are defined here, not when the page is ready, so that they exist
    // before anything can call them.

    // the connection to the other site was checked: what does it offer?
    window.media_files_connection_verified = function ( connection_data ) {

        remote_connection_data = connection_data;

        remote_media_files_unavailable = ( typeof connection_data.media_files_available == 'undefined' );

        hide_show_options( remote_media_files_unavailable );
    };

    // the box with the connection info was moved (the direction of the migration changed)
    window.media_files_connection_box_moved = function () {

        hide_show_options( remote_media_files_unavailable );
        $( '.remove-scope-1' ).text( syncpilot_i10n.scope_remote );
        $( '.remove-scope-2' ).text( syncpilot_i10n.scope_local );

        if ( migration_type() == 'pull' ) {
            $( '.remove-scope-1' ).text( syncpilot_i10n.scope_local );
            $( '.remove-scope-2' ).text( syncpilot_i10n.scope_remote );
        }
    };

    // are media files part of this migration?
    window.media_files_chosen = function () {
        return is_media_migration() && 'savefile' != migration_type();
    };

    $( document ).ready( function () {

        if ( migration_type() == 'savefile' ) {
            $( '.media-files-options' ).hide();
        }

        determine_media_to_migrate = function () {

            connection_info = $.trim( $( '.pull-push-connection-info' ).val() ).split(
                '\n' );

            $( '.progress-text' ).html( syncpilot_mf_strings.determining );

            var remove_local_media = 0;

            if ( $( '#remove-local-media' ).is( ':checked' ) ) {
                remove_local_media = 1;
            }

            $.ajax( {
                url      : ajaxurl,
                type     : 'POST',
                dataType : 'text',
                cache    : false,
                data     : {
                    action             : 'syncpilot_mf_determine_media_to_migrate',
                    remove_local_media : remove_local_media,
                    intent             : migration_type(),
                    url                : connection_info[0],
                    key                : connection_info[1],
                    temp_prefix        : connection_data.temp_prefix,
                    nonce              : syncpilot_nonces.determine_media_to_migrate,
                },
                error : function ( jqXHR, textStatus, errorThrown ) {

                    $( '.progress-title' ).html( syncpilot_mf_strings.migration_failed );

                    $( '.progress-text' ).html( syncpilot_mf_strings.error_determining +
                        ' (#101mf)' );

                    $( '.progress-text' ).addClass( 'migration-error' );
                    console.log( jqXHR );
                    console.log( textStatus );
                    console.log( errorThrown );
                    migration_error = true;
                    migration_complete_events();

                    return;
                },
                success : function ( data ) {

                    original_data = data;
                    data          = JSON.parse( data.trim() );

                    if ( false == data ) {
                        migration_failed( original_data );

                        return;
                    }

                    next_step_in_migration = {
                        fn   : media_successfully_determined,
                        args : [ data ]
                    };

                    execute_next_step();
                }
            } );
        };

        function migration_failed( data ) {

            $( '.progress-title' ).html( syncpilot_mf_strings.migration_failed );
            $( '.progress-text' ).html( syncpilot_sanitize_html( data ) );
            $( '.progress-text' ).addClass( 'migration-error' );
            migration_error = true;
            migration_complete_events();
        }

        media_successfully_determined = function ( data ) {

            if ( typeof data.syncpilot_error != 'undefined' && data.syncpilot_error == 1 ) {
                non_fatal_errors += data.body;

                next_step_in_migration = {
                    fn : run_next_step
                };

                execute_next_step();

                return;
            }

            var args = {};

            args.media_progress              = 0;
            args.media_progress_image_number = 0;
            args.media_total_size            = data.total_size;
            args.remote_uploads_url          = data.remote_uploads_url;
            args.files_to_migrate            = data.files_to_migrate;

            args.bottleneck = syncpilot_max_request;

            if ( Object.size( args.files_to_migrate ) > 0 ) {
                $( '.progress-bar' ).width( '0px' );
            }

            $( '.progress-tables' ).empty();
            $( '.progress-tables-hover-boxes' ).empty();

            $( '.progress-tables' ).prepend( '<div title="' + syncpilot_mf_strings.media_files +
                '" style="width: 100%;" class="progress-chunk media_files"><span>' +
                syncpilot_mf_strings.media_files +
                ' (<span class="media-migration-current-image">0</span> / ' +
                syncpilot_add_commas( Object.size( args.files_to_migrate ) ) +
                ')</span></div>' );

            next_step_in_migration = {
                fn   : migrate_media_files_recursive,
                args : [ args ]
            };

            execute_next_step();
        };

        function migrate_media_files_recursive( args ) {

            if ( 0 == Object.size( args.files_to_migrate ) ) {
                run_next_step();

                return;
            }

            var file_chunk_to_migrate      = [];
            var file_chunk_size            = 0;
            var number_of_files_to_migrate = 0;

            $.each( args.files_to_migrate, function ( index, value ) {

                if ( ! file_chunk_to_migrate.length ) {
                    file_chunk_to_migrate.push( index );
                    file_chunk_size += value;
                    delete args.files_to_migrate[index];
                    ++args.media_progress_image_number;
                    ++number_of_files_to_migrate;
                } else {
                    if ( ( file_chunk_size + value ) > args.bottleneck ||
                        number_of_files_to_migrate >= remote_connection_data.media_files_max_file_uploads
                    ) {
                        return false;
                    } else {
                        file_chunk_to_migrate.push( index );
                        file_chunk_size += value;
                        delete args.files_to_migrate[index];
                        ++args.media_progress_image_number;
                        ++number_of_files_to_migrate;
                    }
                }
            } );

            var connection_info = $.trim( $( '.pull-push-connection-info' ).val() ).split(
                '\n' );

            $.ajax( {
                url      : ajaxurl,
                type     : 'POST',
                dataType : 'text',
                cache    : false,
                data     : {
                    action             : 'syncpilot_mf_migrate_media',
                    file_chunk         : file_chunk_to_migrate,
                    remote_uploads_url : args.remote_uploads_url,
                    intent             : migration_type(),
                    url                : connection_info[0],
                    key                : connection_info[1],
                    nonce              : syncpilot_nonces.migrate_media,
                },
                error : function ( jqXHR, textStatus, errorThrown ) {

                    $( '.progress-title' ).html( syncpilot_mf_strings.migration_failed );

                    $( '.progress-text' ).html( syncpilot_mf_strings.problem_migrating_media +
                        ' (#102mf)' );

                    $( '.progress-text' ).addClass( 'migration-error' );
                    console.log( jqXHR );
                    console.log( textStatus );
                    console.log( errorThrown );
                    migration_error = true;
                    migration_complete_events();

                    return;
                },
                success : function ( data ) {

                    original_data = data;
                    data          = JSON.parse( data.trim() );

                    if ( false == data ) {
                        migration_failed( original_data );

                        return;
                    }

                    if ( typeof data.syncpilot_error != 'undefined' && data.syncpilot_error == 1 ) {
                        non_fatal_errors += data.body;
                    }

                    args.media_progress += file_chunk_size;

                    var percent = 100 * args.media_progress / args.media_total_size;

                    $( '.progress-bar' ).width( percent + '%' );
                    overall_percent = Math.floor( percent );

                    $( '.progress-text' ).html( overall_percent + '% - ' +
                        syncpilot_mf_strings.migrating_media_files );

                    $( '.media-migration-current-image' ).html( syncpilot_add_commas( args.media_progress_image_number ) );

                    next_step_in_migration = {
                        fn   : migrate_media_files_recursive,
                        args : [ args ]
                    };

                    execute_next_step();
                }
            } );
        }
    } );
} )( jQuery );
