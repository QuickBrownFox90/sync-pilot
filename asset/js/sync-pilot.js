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

  // asset/src/js/script.js
  window.migration_complete = void 0;
  window.migration_complete_events = void 0;
  window.migrate_table_recursive = void 0;
  window.execute_next_step = void 0;
  (function($) {
    var connection_established = false;
    var last_replace_switch = "";
    var doing_ajax = false;
    var doing_reset_api_key_ajax = false;
    var doing_save_profile = false;
    var doing_plugin_compatibility_ajax = false;
    var profile_name_edited = false;
    var show_prefix_notice = false;
    var show_ssl_notice = false;
    var show_version_notice = false;
    var migration_completed = false;
    var currently_migrating = false;
    var dump_filename = "";
    var dump_url = "";
    var migration_intent;
    var remote_site;
    var secret_key;
    var form_data;
    var stage;
    var elapsed_interval;
    var completed_msg;
    var tables_to_migrate = "";
    var migration_paused = false;
    var previous_progress_title;
    var previous_progress_text;
    var timer_count;
    var overall_percent;
    var migration_cancelled = false;
    var admin_url = ajaxurl.replace("/admin-ajax.php", ""), spinner_url = admin_url + "/images/wpspin_light";
    if (window.devicePixelRatio >= 2) {
      spinner_url += "-2x";
    }
    spinner_url += ".gif";
    window.onbeforeunload = function(e) {
      if (currently_migrating) {
        e = e || window.event;
        if (e) {
          e.returnValue = "Sure?";
        }
        return "Sure?";
      }
    };
    function setup_counter() {
      timer_count = 0, counter_display = $(".timer"), label = syncpilot_i10n.time_elapsed + " ";
      elapsed_interval = setInterval(count, 1e3);
    }
    function display_count() {
      hours = Math.floor(timer_count / 3600) % 24;
      minutes = Math.floor(timer_count / 60) % 60;
      seconds = timer_count % 60;
      var display = label + pad(hours, 2, 0) + ":" + pad(minutes, 2, 0) + ":" + pad(seconds, 2, 0);
      counter_display.html(display);
    }
    function count() {
      timer_count = timer_count + 1;
      display_count();
    }
    function maybe_show_ssl_warning(url, key, remote_scheme) {
      var scheme = url.substr(0, url.indexOf(":"));
      if (remote_scheme != scheme && url.indexOf("https") != -1) {
        $(".ssl-notice").show();
        show_ssl_notice = true;
        url = url.replace("https", "http");
        $(".pull-push-connection-info").val(url + "\n" + key);
        return;
      }
      show_ssl_notice = false;
      return;
    }
    function maybe_show_version_warning(plugin_version, url) {
      if (typeof plugin_version != "undefined" && plugin_version != syncpilot_plugin_version) {
        $(".different-plugin-version-notice").show();
        $(".remote-version").text(plugin_version);
        $(".remote-location").text(url);
        $(".step-two").hide();
        show_version_notice = true;
      }
    }
    function maybe_show_prefix_notice(prefix) {
      if (prefix != syncpilot_this_prefix) {
        $(".remote-prefix").text(prefix);
        show_prefix_notice = true;
        if ($("#pull").is(":checked")) {
          $(".prefix-notice.pull").show();
        } else {
          $(".prefix-notice.push").show();
        }
      }
    }
    $(document).ready(function() {
      $("#plugin-compatibility").change(function(e) {
        var $box = $(this);
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
        $(".plugin-compatibility-wrap").toggle();
        $("#plugin-compatibility").parent().append('<img src="' + spinner_url + '" alt="" class="ajax-spinner general-spinner" />');
        $("#plugin-compatibility").attr("disabled", "disabled");
        $(".plugin-compatibility").addClass("disabled");
        $.ajax({
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
            $(".ajax-spinner").remove();
            $("#plugin-compatibility").removeAttr("disabled");
            $(".plugin-compatibility").removeClass("disabled");
          },
          success: function(data) {
            if ("" != $.trim(data)) {
              syncpilot_alert($.trim(data));
            } else {
              $(".plugin-compatibility").append(
                '<span class="ajax-success-msg">' + syncpilot_i10n.saved + "</span>"
              );
              $(".ajax-success-msg").fadeOut(2e3, function() {
                $(this).remove();
              });
            }
            $(".ajax-spinner").remove();
            $("#plugin-compatibility").removeAttr("disabled");
            $(".plugin-compatibility").removeClass("disabled");
          }
        });
      }
      if ($("#plugin-compatibility").is(":checked")) {
        $(".plugin-compatibility-wrap").show();
      }
      $(".slider").slider({
        range: "min",
        value: syncpilot_max_request / 1024,
        min: 512,
        max: syncpilot_bottleneck / 1024,
        step: 512,
        slide: function(event, ui) {
          $(".amount").html(syncpilot_add_commas(ui.value) + " kB");
        },
        change: function(event, ui) {
          $(".amount").after('<img src="' + spinner_url + '" alt="" class="slider-spinner general-spinner" />');
          $(".slider").slider("disable");
          $.ajax({
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
              $(".slider").slider("enable");
              $(".slider-spinner").remove();
              syncpilot_alert(syncpilot_i10n.max_request_size_problem);
            },
            success: function(data) {
              $(".slider").slider("enable");
              $(".slider-spinner").remove();
              $(".slider-success-msg").show();
              $(".slider-success-msg").fadeOut(2e3, function() {
                $(this).hide();
              });
            }
          });
        }
      });
      $(".amount").html(syncpilot_add_commas($(".slider").slider("value")) + " kB");
      var progress_content_original = $(".progress-content").clone();
      $(".progress-content").remove();
      var push_select = $("#select-tables").clone();
      var pull_select = $("#select-tables").clone();
      var push_post_type_select = $("#select-post-types").clone();
      var pull_post_type_select = $("#select-post-types").clone();
      var push_select_backup = $("#select-backup").clone();
      var pull_select_backup = $("#select-backup").clone();
      $(".backup-options").show();
      $(".keep-active-plugins").show();
      if ($("#savefile").is(":checked")) {
        $(".backup-options").hide();
        $(".keep-active-plugins").hide();
      }
      function disable_export_type_controls() {
        $(".option-group").each(function(index) {
          $("input", this).attr("disabled", "disabled");
          $("label", this).css("cursor", "default");
        });
      }
      function enable_export_type_controls() {
        $(".option-group").each(function(index) {
          $("input", this).removeAttr("disabled");
          $("label", this).css("cursor", "pointer");
        });
      }
      establish_remote_connection_from_saved_profile();
      function establish_remote_connection_from_saved_profile() {
        var action = $("input[name=action]:checked").val();
        var connection_info = $.trim($(".pull-push-connection-info").val()).split(
          "\n"
        );
        if (typeof syncpilot_default_profile == "undefined" || syncpilot_default_profile == true || action == "savefile" || doing_ajax) {
          return;
        }
        last_replace_switch = action;
        doing_ajax = true;
        disable_export_type_controls();
        $(".connection-status").html(syncpilot_i10n.establishing_remote_connection);
        $(".connection-status").removeClass(
          "notification-message error-notice migration-error"
        );
        $(".connection-status").append('<img src="' + spinner_url + '" alt="" class="ajax-spinner general-spinner" />');
        var intent = $("input[name=action]:checked").val();
        $.ajax({
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
            $(".connection-status").html(syncpilot_i10n.connection_local_server_problem + " (#102)");
            $(".connection-status").append("<br /><br />Status: " + jqXHR.status + " " + jqXHR.statusText + "<br /><br />Response:<br />" + jqXHR.responseText);
            $(".connection-status").addClass(
              "notification-message error-notice migration-error"
            );
            $(".ajax-spinner").remove();
            doing_ajax = false;
            enable_export_type_controls();
          },
          success: function(data) {
            $(".ajax-spinner").remove();
            doing_ajax = false;
            enable_export_type_controls();
            if (typeof data.syncpilot_error != "undefined" && data.syncpilot_error == 1) {
              $(".connection-status").html(syncpilot_sanitize_html(data.body));
              $(".connection-status").addClass(
                "notification-message error-notice migration-error"
              );
              if (data.body.indexOf("401 Unauthorized") > -1) {
                $(".basic-access-auth-wrapper").show();
              }
              return;
            }
            maybe_show_ssl_warning(connection_info[0], connection_info[1], data.scheme);
            maybe_show_version_warning(data.plugin_version, connection_info[0]);
            maybe_show_prefix_notice(data.prefix);
            $(".pull-push-connection-info").addClass("temp-disabled");
            $(".pull-push-connection-info").attr("readonly", "readonly");
            $(".connect-button").hide();
            $(".connection-status").hide();
            $(".step-two").show();
            connection_established = true;
            connection_data = data;
            move_connection_info_box();
            var loaded_tables = "";
            if (syncpilot_default_profile == false && typeof syncpilot_loaded_tables != "undefined") {
              loaded_tables = syncpilot_loaded_tables;
            }
            var table_select = document.createElement("select");
            $(table_select).attr({
              multiple: "multiple",
              name: "select_tables[]",
              id: "select-tables",
              class: "multiselect"
            });
            $.each(connection_data.tables, function(index, value) {
              var selected = $.inArray(value, loaded_tables);
              if (selected != -1) {
                selected = ' selected="selected" ';
              } else {
                selected = " ";
              }
              $(table_select).append("<option" + selected + 'value="' + value + '">' + value + " (" + connection_data.table_sizes_hr[value] + ")</option>");
            });
            pull_select = table_select;
            var loaded_post_types = "";
            if (syncpilot_default_profile == false && typeof syncpilot_loaded_post_types != "undefined") {
              if (typeof data.select_post_types != "undefined") {
                $("#exclude-post-types").attr("checked", "checked");
                $(".post-type-select-wrap").show();
                loaded_post_types = data.select_post_types;
              } else {
                loaded_post_types = syncpilot_loaded_post_types;
              }
            }
            var post_type_select = document.createElement("select");
            $(post_type_select).attr({
              multiple: "multiple",
              name: "select_post_types[]",
              id: "select-post-types",
              class: "multiselect"
            });
            $.each(connection_data.post_types, function(index, value) {
              var selected = $.inArray(value, loaded_post_types);
              if (selected != -1 || syncpilot_convert_exclude_revisions == true && value != "revision") {
                selected = ' selected="selected" ';
              } else {
                selected = " ";
              }
              $(post_type_select).append("<option" + selected + 'value="' + value + '">' + value + "</option>");
            });
            pull_post_type_select = post_type_select;
            var loaded_tables_backup = "";
            if (syncpilot_default_profile == false && typeof syncpilot_loaded_tables_backup != "undefined") {
              loaded_tables_backup = syncpilot_loaded_tables_backup;
            }
            var table_select_backup = document.createElement("select");
            $(table_select_backup).attr({
              multiple: "multiple",
              name: "select_backup[]",
              id: "select-backup",
              class: "multiselect"
            });
            $.each(connection_data.tables, function(index, value) {
              var selected = $.inArray(value, loaded_tables_backup);
              if (selected != -1) {
                selected = ' selected="selected" ';
              } else {
                selected = " ";
              }
              $(table_select_backup).append("<option" + selected + 'value="' + value + '">' + value + " (" + connection_data.table_sizes_hr[value] + ")</option>");
            });
            push_select_backup = table_select_backup;
            if ($("#pull").is(":checked")) {
              $("#select-tables").remove();
              $(".select-tables-wrap").prepend(pull_select);
              $("#select-post-types").remove();
              $(".select-post-types-wrap").prepend(pull_post_type_select);
              $("#select-backup").remove();
              $(".backup-tables-wrap").prepend(pull_select_backup);
              $(".table-prefix").text(data.prefix);
              $(".uploads-dir").html(syncpilot_this_uploads_dir);
            } else {
              $("#select-backup").remove();
              $(".backup-tables-wrap").prepend(push_select_backup);
            }
            media_files_connection_verified(connection_data);
          }
        });
      }
      $(".js-action-link").click(function(e) {
        e.preventDefault();
        $(this).blur();
      });
      $(".clear-log").click(function() {
        $(".debug-log-textarea").val("");
        $.ajax({
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
      function refresh_debug_log() {
        $.ajax({
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
            $(".debug-log-textarea").val(data);
          }
        });
      }
      $(".multiselect-select-all").click(function() {
        var multiselect = $(this).parents(".select-wrap").children(".multiselect");
        $(multiselect).focus();
        $("option", multiselect).attr("selected", 1);
      });
      $(".multiselect-deselect-all").click(function() {
        var multiselect = $(this).parents(".select-wrap").children(".multiselect");
        $(multiselect).focus();
        $("option", multiselect).removeAttr("selected");
      });
      $(".multiselect-invert-selection").click(function() {
        var multiselect = $(this).parents(".select-wrap").children(".multiselect");
        $(multiselect).focus();
        $("option", multiselect).each(function() {
          $(this).attr("selected", !$(this).attr("selected"));
        });
      });
      $(".option-group input[type=radio]").change(function() {
        group = $(this).closest(".option-group");
        $("ul", group).hide();
        parent = $(this).closest("li");
        $("ul", parent).show();
      });
      $(".option-group").each(function() {
        $(".option-group input[type=radio]").each(function() {
          if ($(this).is(":checked")) {
            parent = $(this).closest("li");
            $("ul", parent).show();
          }
        });
      });
      $(".header-expand-collapse").click(function() {
        if ($(".expand-collapse-arrow", this).hasClass("collapsed")) {
          $(".expand-collapse-arrow", this).removeClass("collapsed");
          $(this).next().show();
        } else {
          $(".expand-collapse-arrow", this).addClass("collapsed");
          $(this).next().hide();
        }
      });
      $(".checkbox-label input[type=checkbox]").change(function() {
        if ($(this).is(":checked")) {
          $(this).parent().next().show();
        } else {
          $(this).parent().next().hide();
        }
      });
      $("#save-migration-profile").change(function() {
        if ($(this).is(":checked")) {
          $(".save-settings-button").show();
          $(".migrate-db .button-primary").val(syncpilot_i10n.migrate_db_save);
        } else {
          $(".save-settings-button").hide();
          $(".migrate-db .button-primary").val(syncpilot_i10n.migrate_db);
        }
      });
      if ($("#save-migration-profile").is(":checked")) {
        $(".save-settings-button").show();
        $(".migrate-db .button-primary").val(syncpilot_i10n.migrate_db_save);
      }
      $(".checkbox-label input[type=checkbox]").each(function() {
        if ($(this).is(":checked")) {
          $(this).parent().next().show();
        }
      });
      $("#new-url").change(function() {
        $("#new-url-missing-warning").hide();
      });
      $("#new-path").change(function() {
        $("#new-path-missing-warning").hide();
      });
      $(".migrate-db-button").click(function(event) {
        $(this).blur();
        event.preventDefault();
        if ($("#migrate-selected").is(":checked") && !($("#select-tables").val() || []).length) {
          syncpilot_alert(syncpilot_i10n.please_select_one_table);
          return;
        }
        new_url_missing = false;
        new_file_path_missing = false;
        if ($("#new-url").length && !$("#new-url").val()) {
          $("#new-url-missing-warning").show();
          $("#new-url").focus();
          $("html,body").scrollTop(0);
          new_url_missing = true;
        }
        if ($("#new-path").length && !$("#new-path").val()) {
          $("#new-path-missing-warning").show();
          if (false == new_url_missing) {
            $("#new-path").focus();
            $("html,body").scrollTop(0);
          }
          new_file_path_missing = true;
        }
        if (true == new_url_missing || true == new_file_path_missing) return;
        if ($("#save-migration-profile").is(":checked")) {
          if ($.trim($(".create-new-profile").val()) == "" && $(
            "#create_new"
          ).is(":checked")) {
            syncpilot_alert(syncpilot_i10n.enter_name_for_profile);
            $(".create-new-profile").focus();
            return;
          }
          var create_new_profile = false;
          if ($("#create_new").is(":checked")) {
            create_new_profile = true;
          }
          var profile_name = $(".create-new-profile").val();
          profile = $("#migrate-form").serialize();
          $.ajax({
            url: ajaxurl,
            type: "POST",
            dataType: "text",
            cache: false,
            data: {
              action: "syncpilot_save_profile",
              profile,
              nonce: syncpilot_nonces.save_profile
            },
            error: function(jqXHR, textStatus, errorThrown) {
              syncpilot_alert(syncpilot_i10n.save_profile_problem);
            },
            success: function(data) {
              if (create_new_profile) {
                var new_profile_key = parseInt(data, 10);
                var new_profile_id = new_profile_key + 1;
                var new_li = '<li><span style="display: none;" class="delete-profile" data-profile-id="' + new_profile_id + '"></span><label for="profile-' + new_profile_id + '"><input id="profile-' + new_profile_id + '" value="' + new_profile_key + '" name="save_migration_profile_option" type="radio"> ' + profile_name + "</label></li>";
                $("#create_new").parents("li").before(new_li);
                $("#profile-" + new_profile_id).attr("checked", "checked");
                $(".create-new-profile").val("");
              }
            }
          });
        }
        form_data = $("#migrate-form").serialize();
        var doc_height = $(document).height();
        $("body").append('<div id="overlay"></div>');
        $("#overlay").height(doc_height).css({
          "position": "fixed",
          "top": 0,
          "left": 0,
          "width": "100%",
          "z-index": 99999,
          "display": "none"
        });
        $progress_content = progress_content_original.clone();
        migration_intent = $("input[name=action]:checked").val();
        stage = "backup";
        if (migration_intent == "savefile") {
          stage = "migrate";
        }
        if ($("#create-backup").is(":checked") == false) {
          stage = "migrate";
        }
        var table_intent = $("input[name=table_migrate_option]:checked").val();
        var connection_info = $.trim($(".pull-push-connection-info").val()).split("\n");
        var table_rows = "";
        remote_site = connection_info[0];
        secret_key = connection_info[1];
        var static_migration_label = "";
        $("#overlay").after($progress_content);
        completed_msg = syncpilot_i10n.exporting_complete;
        if (migration_intent == "savefile") {
          static_migration_label = syncpilot_i10n.exporting_please_wait;
        } else {
          static_migration_label = get_default_profile_name(
            remote_site,
            migration_intent,
            true
          ) + ", " + syncpilot_i10n.please_wait;
          completed_msg = get_default_profile_name(
            remote_site,
            migration_intent,
            true
          ) + " " + syncpilot_i10n.complete;
        }
        $(".progress-title").html(static_migration_label);
        $("#overlay").show();
        backup_option = $("input[name=backup_option]:checked").val();
        table_option = $("input[name=table_migrate_option]:checked").val();
        if (stage == "backup") {
          if (table_option == "migrate_only_with_prefix" && backup_option == "backup_selected") {
            backup_option = "backup_only_with_prefix";
          }
          if (migration_intent == "push") {
            table_rows = connection_data.table_rows;
            if (backup_option == "backup_only_with_prefix") {
              tables_to_migrate = connection_data.prefixed_tables;
            } else if (backup_option == "backup_selected") {
              selected_tables = $("#select-tables").val();
              tables_to_migrate = get_intersect(
                selected_tables,
                connection_data.tables
              );
            } else if (backup_option == "backup_manual_select") {
              tables_to_migrate = $("#select-backup").val();
            }
          } else {
            table_rows = syncpilot_this_table_rows;
            if (backup_option == "backup_only_with_prefix") {
              tables_to_migrate = syncpilot_this_prefixed_tables;
            } else if (backup_option == "backup_selected") {
              selected_tables = $("#select-tables").val();
              tables_to_migrate = get_intersect(selected_tables, syncpilot_this_tables);
            } else if (backup_option == "backup_manual_select") {
              tables_to_migrate = $("#select-backup").val();
            }
          }
        } else {
          if (table_intent == "migrate_select") {
            tables_to_migrate = $("#select-tables").val();
            if (migration_intent == "push" || migration_intent == "savefile") {
              table_rows = syncpilot_this_table_rows;
            } else {
              table_rows = connection_data.table_rows;
            }
          } else {
            if (migration_intent == "push" || migration_intent == "savefile") {
              tables_to_migrate = syncpilot_this_prefixed_tables;
              table_rows = syncpilot_this_table_rows;
            } else {
              tables_to_migrate = connection_data.prefixed_tables;
              table_rows = connection_data.table_rows;
            }
          }
        }
        function decide_tables_to_display_rows(tables_to_migrate2, table_rows2) {
          var total_size2 = 0;
          $.each(tables_to_migrate2, function(index, value) {
            total_size2 += parseInt(table_rows2[value]);
          });
          var last_element = "";
          $.each(tables_to_migrate2, function(index, value) {
            var percent2 = table_rows2[value] / total_size2 * 100;
            var percent_rounded2 = Math.round(percent2 * 1e3) / 1e3;
            $(".progress-tables").append('<div class="progress-chunk ' + value + '_chunk" style="width: ' + percent_rounded2 + '%;" title="' + value + '"><span>' + value + "</span></div>");
            $(".progress-tables-hover-boxes").append(
              '<div class="progress-chunk-hover" data-table="' + value + '" style="width: ' + percent_rounded2 + '%;"></div>'
            );
            var label2 = $(".progress-tables .progress-chunk:last span");
            last_element = value;
          });
          $(".progress-content").css({ display: "block", visibility: "hidden" });
          $(".progress-chunk").each(function(index) {
            if ($(this).width() < 1 && tables_to_migrate2[index] != last_element) {
              $(this).hide();
              $(".progress-chunk-hover[data-table=" + tables_to_migrate2[index] + "]").hide();
              table_rows2[last_element] = Number(table_rows2[last_element]);
              table_rows2[last_element] += Number(table_rows2[tables_to_migrate2[index]]);
              table_rows2[tables_to_migrate2[index]] = 0;
            }
            var element = this;
            setTimeout(function() {
              hide_overflowing_elements(element);
            }, 0);
            function hide_overflowing_elements(element2) {
              if ($("span", element2).innerWidth() > $(element2).width()) {
                $("span", element2).hide();
              }
            }
          });
          $(".progress-content").css({ display: "", visibility: "" });
          percent_rounded = 0;
          if (table_rows2[last_element] != 0) {
            var percent = table_rows2[last_element] / total_size2 * 100;
            var percent_rounded = Math.round(percent * 1e3) / 1e3;
          }
          $(".progress-tables .progress-chunk:last").css(
            "width",
            percent_rounded + "%"
          );
          $(".progress-chunk-hover:last").css("width", percent_rounded + "%");
          var return_vals = [table_rows2, total_size2];
          return return_vals;
        }
        table_details = decide_tables_to_display_rows(tables_to_migrate, table_rows);
        table_rows = table_details[0];
        total_size = table_details[1];
        $(".progress-title").after(
          '<img src="' + spinner_url + '" alt="" class="migration-progress-ajax-spinner general-spinner" />'
        );
        var height = $(".progress-content").outerHeight();
        $(".progress-content").css("top", "-" + height + "px").show().animate({
          "top": "0px"
        });
        setup_counter();
        currently_migrating = true;
        $.ajax({
          url: ajaxurl,
          type: "POST",
          dataType: "json",
          cache: false,
          data: {
            action: "syncpilot_initiate_migration",
            intent: migration_intent,
            url: remote_site,
            key: secret_key,
            form_data,
            stage,
            nonce: syncpilot_nonces.initiate_migration
          },
          error: function(jqXHR, textStatus, errorThrown) {
            $(".progress-title").html(syncpilot_i10n.migration_failed);
            $(".progress-text").html(syncpilot_i10n.connection_local_server_problem + " (#112)");
            $(".progress-text").append("<br /><br />Status: " + jqXHR.status + " " + jqXHR.statusText + "<br /><br />Response:<br />" + jqXHR.responseText);
            $(".progress-text").addClass("migration-error");
            console.log(jqXHR);
            console.log(textStatus);
            console.log(errorThrown);
            migration_error = true;
            migration_complete_events();
            return;
          },
          success: function(data) {
            if (typeof data.syncpilot_error != "undefined" && data.syncpilot_error == 1) {
              migration_error = true;
              migration_complete_events();
              $(".progress-title").html(syncpilot_i10n.migration_failed);
              $(".progress-text").addClass("migration-error");
              $(".progress-text").html(syncpilot_sanitize_html(data.body));
              return;
            }
            dump_url = data.dump_url;
            dump_filename = data.dump_filename;
            var i = 0;
            var progress_size = 0;
            overall_percent = 0;
            var table_progress = 0;
            var temp_progress = 0;
            var last_progress = 0;
            var overall_table_progress = 0;
            migrate_table_recursive = function(current_row, primary_keys) {
              if (i >= tables_to_migrate.length) {
                if (stage == "backup") {
                  stage = "migrate";
                  i = 0;
                  progress_size = 0;
                  $(".progress-bar").width("0px");
                  if (table_intent == "migrate_select") {
                    tables_to_migrate = $("#select-tables").val();
                    if (migration_intent == "push" || migration_intent == "savefile") {
                      table_rows = syncpilot_this_table_rows;
                    } else {
                      table_rows = connection_data.table_rows;
                    }
                  } else {
                    if (migration_intent == "push" || migration_intent == "savefile") {
                      tables_to_migrate = syncpilot_this_prefixed_tables;
                      table_rows = syncpilot_this_table_rows;
                    } else {
                      tables_to_migrate = connection_data.prefixed_tables;
                      table_rows = connection_data.table_rows;
                    }
                  }
                  $(".progress-tables").empty();
                  $(".progress-tables-hover-boxes").empty();
                  table_details = decide_tables_to_display_rows(
                    tables_to_migrate,
                    table_rows
                  );
                  table_rows = table_details[0];
                  total_size = table_details[1];
                } else {
                  call_stack = [];
                  if (media_files_chosen()) {
                    call_stack.push(determine_media_to_migrate);
                  }
                  call_stack.push(migration_complete, migration_complete_events);
                  next_step_in_migration = {
                    fn: run_next_step
                  };
                  execute_next_step();
                  return;
                }
              }
              if (stage == "backup") {
                $(".progress-text").html(overall_percent + "% - " + syncpilot_i10n.backing_up + ' "' + tables_to_migrate[i] + '"');
              } else {
                $(".progress-text").html(overall_percent + "% - " + syncpilot_i10n.migrating + ' "' + tables_to_migrate[i] + '"');
              }
              last_table = 0;
              if (i == tables_to_migrate.length - 1) {
                last_table = 1;
              }
              gzip = 0;
              if (migration_intent != "savefile" && parseInt(
                connection_data.gzip
              ) == 1) {
                gzip = 1;
              }
              var request_data = {
                action: "syncpilot_migrate_table",
                intent: migration_intent,
                url: remote_site,
                key: secret_key,
                table: tables_to_migrate[i],
                form_data,
                stage,
                current_row,
                dump_filename,
                last_table,
                primary_keys,
                gzip,
                nonce: syncpilot_nonces.migrate_table
              };
              if (migration_intent != "savefile") {
                request_data.bottleneck = connection_data.bottleneck;
                request_data.prefix = connection_data.prefix;
              }
              if (connection_data && connection_data.path_current_site && connection_data.domain) {
                request_data.path_current_site = connection_data.path_current_site;
                request_data.domain_current_site = connection_data.domain;
              }
              doing_ajax = true;
              $.ajax({
                url: ajaxurl,
                type: "POST",
                dataType: "text",
                cache: false,
                timeout: 0,
                data: request_data,
                error: function(jqXHR, textStatus, errorThrown) {
                  $(".progress-title").html(syncpilot_i10n.migration_failed);
                  $(".progress-text").html(syncpilot_i10n.table_process_problem + " " + tables_to_migrate[i]);
                  $(".progress-text").append("<br /><br />" + syncpilot_i10n.status + ": " + jqXHR.status + " " + jqXHR.statusText + "<br /><br />" + syncpilot_i10n.response + ":<br />" + jqXHR.responseText);
                  $(".progress-text").addClass("migration-error");
                  doing_ajax = false;
                  console.log(jqXHR);
                  console.log(textStatus);
                  console.log(errorThrown);
                  migration_error = true;
                  migration_complete_events();
                  return;
                },
                success: function(data2) {
                  doing_ajax = false;
                  data2 = data2.trim();
                  try {
                    row_information = JSON.parse(data2);
                  } catch (variable) {
                    $(".progress-title").html(syncpilot_i10n.migration_failed);
                    if ("" == data2 || null == data2) {
                      $(".progress-text").html(syncpilot_i10n.table_process_problem_empty_response + " " + tables_to_migrate[i]);
                    } else {
                      $(".progress-text").html(syncpilot_sanitize_html(data2));
                    }
                    $(".progress-text").addClass("migration-error");
                    migration_error = true;
                    migration_complete_events();
                    return;
                  }
                  if (typeof row_information.syncpilot_error != "undefined" && row_information.syncpilot_error == 1) {
                    $(".progress-title").html(syncpilot_i10n.migration_failed);
                    $(".progress-text").addClass("migration-error");
                    $(".progress-text").html(syncpilot_sanitize_html(row_information.body));
                    migration_error = true;
                    migration_complete_events();
                    return;
                  }
                  if (row_information.current_row == "-1") {
                    progress_size -= overall_table_progress;
                    overall_table_progress = 0;
                    last_progress = 0;
                    progress_size += parseInt(table_rows[tables_to_migrate[i]]);
                    i++;
                    row_information.current_row = "";
                    row_information.primary_keys = "";
                  } else {
                    temp_progress = parseInt(row_information.current_row);
                    table_progress = temp_progress - last_progress;
                    last_progress = temp_progress;
                    progress_size += table_progress;
                    overall_table_progress += table_progress;
                  }
                  var percent = 100 * progress_size / total_size;
                  $(".progress-bar").width(percent + "%");
                  overall_percent = Math.floor(percent);
                  next_step_in_migration = {
                    fn: migrate_table_recursive,
                    args: [
                      row_information.current_row,
                      row_information.primary_keys
                    ]
                  };
                  execute_next_step();
                }
              });
            };
            next_step_in_migration = {
              fn: migrate_table_recursive,
              args: ["-1", ""]
            };
            execute_next_step();
          }
        });
      });
      migration_complete_events = function() {
        if (false == migration_error) {
          if (non_fatal_errors == "") {
            if ("savefile" != migration_intent && true == $("#save_computer").is(":checked")) {
              $(".progress-text").css("visibility", "hidden");
            }
            $(".progress-title").html(completed_msg).append(
              '<div class="dashicons dashicons-yes"></div>'
            );
          } else {
            $(".progress-text").html(syncpilot_sanitize_html(non_fatal_errors));
            $(".progress-text").addClass("migration-error");
            $(".progress-title").html(syncpilot_i10n.completed_with_some_errors);
          }
          $(".progress-bar-wrapper").hide();
        }
        $(".migration-controls").hide();
        call_stack = [];
        migration_error = false;
        currently_migrating = false;
        migration_completed = true;
        migration_paused = false;
        migration_cancelled = false;
        doing_ajax = false;
        non_fatal_errors = "";
        $(".progress-label").remove();
        $(".migration-progress-ajax-spinner").remove();
        $(".close-progress-content").show();
        $("#overlay").css("cursor", "pointer");
        clearInterval(elapsed_interval);
      };
      migration_complete = function() {
        $(".migration-controls").fadeOut();
        if (migration_intent == "savefile") {
          currently_migrating = false;
          var migrate_complete_text = syncpilot_i10n.migration_complete;
          if ($("#save_computer").is(":checked")) {
            var url = syncpilot_this_download_url + encodeURIComponent(dump_filename);
            if ($("#gzip_file").is(":checked")) {
              url += "&gzip=1";
            }
            window.location = url;
          } else {
            migrate_complete_text = syncpilot_i10n.completed_dump_located_at + ' <a href="' + dump_url + '">' + dump_url + "</a>.";
          }
          if (migration_error == false) {
            $(".progress-text").html(migrate_complete_text);
            migration_complete_events();
            $(".progress-title").html(completed_msg);
          }
        } else {
          $(".progress-text").html(syncpilot_i10n.finalizing_migration);
          $.ajax({
            url: ajaxurl,
            type: "POST",
            dataType: "text",
            cache: false,
            data: {
              action: "syncpilot_finalize_migration",
              intent: migration_intent,
              url: remote_site,
              key: secret_key,
              form_data,
              prefix: connection_data.prefix,
              temp_prefix: connection_data.temp_prefix,
              tables: tables_to_migrate.join(","),
              nonce: syncpilot_nonces.finalize_migration
            },
            error: function(jqXHR, textStatus, errorThrown) {
              $(".progress-title").html(syncpilot_i10n.migration_failed);
              $(".progress-text").html(syncpilot_i10n.finalize_tables_problem);
              $(".progress-text").addClass("migration-error");
              if (window.console && console.log)
                console.log("SyncPilot: finalize", textStatus, errorThrown, jqXHR.responseText);
              migration_error = true;
              migration_complete_events();
              return;
            },
            success: function(data) {
              if ($.trim(data) != "") {
                $(".progress-title").html(syncpilot_i10n.migration_failed);
                $(".progress-text").html(syncpilot_sanitize_html(data));
                $(".progress-text").addClass("migration-error");
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
      $("body").on("click", ".close-progress-content-button", function(e) {
        hide_overlay();
      });
      $("body").on("click", "#overlay", function() {
        if (migration_completed == true) {
          hide_overlay();
        }
      });
      function hide_overlay() {
        var height = $(".progress-content").outerHeight();
        $(".progress-content").animate({
          "top": "-" + height + "px"
        }, 400, "swing", function() {
          $("#overlay").remove();
          $(".progress-content").remove();
        });
        migration_completed = false;
      }
      $(".save-settings-button").click(function(event) {
        var profile2;
        $(this).blur();
        event.preventDefault();
        if (doing_save_profile) {
          return;
        }
        if ($("#migrate-selected").is(":checked") && !($("#select-tables").val() || []).length) {
          syncpilot_alert(syncpilot_i10n.please_select_one_table);
          return;
        }
        if ($.trim($(".create-new-profile").val()) == "" && $("#create_new").is(":checked")) {
          syncpilot_alert(syncpilot_i10n.enter_name_for_profile);
          $(".create-new-profile").focus();
          return;
        }
        var create_new_profile = false;
        if ($("#create_new").is(":checked")) {
          create_new_profile = true;
        }
        var profile_name = $(".create-new-profile").val();
        doing_save_profile = true;
        profile2 = $("#migrate-form").serialize();
        $(".save-settings-button").after('<img src="' + spinner_url + '" alt="" class="save-profile-ajax-spinner general-spinner" />');
        $(this).attr("disabled", "disabled");
        $.ajax({
          url: ajaxurl,
          type: "POST",
          dataType: "text",
          cache: false,
          data: {
            action: "syncpilot_save_profile",
            profile: profile2,
            nonce: syncpilot_nonces.save_profile
          },
          error: function(jqXHR, textStatus, errorThrown) {
            syncpilot_alert(syncpilot_i10n.save_profile_problem);
            $(".save-settings-button").removeAttr("disabled");
            $(".save-profile-ajax-spinner").remove();
            $(".save-settings-button").after(
              '<span class="ajax-success-msg">' + syncpilot_i10n.saved + "</span>"
            );
            $(".ajax-success-msg").fadeOut(2e3, function() {
              $(this).remove();
            });
            doing_save_profile = false;
          },
          success: function(data) {
            $(".save-settings-button").removeAttr("disabled");
            $(".save-profile-ajax-spinner").remove();
            $(".save-settings-button").after(
              '<span class="ajax-success-msg">' + syncpilot_i10n.saved + "</span>"
            );
            $(".ajax-success-msg").fadeOut(2e3, function() {
              $(this).remove();
            });
            doing_save_profile = false;
            $(".create-new-profile").val("");
            if (create_new_profile) {
              var new_profile_key = parseInt(data, 10);
              var new_profile_id = new_profile_key + 1;
              var new_li = '<li><span style="display: none;" class="delete-profile" data-profile-id="' + new_profile_id + '"></span><label for="profile-' + new_profile_id + '"><input id="profile-' + new_profile_id + '" value="' + new_profile_key + '" name="save_migration_profile_option" type="radio"> ' + profile_name + "</label></li>";
              $("#create_new").parents("li").before(new_li);
              $("#profile-" + new_profile_id).attr("checked", "checked");
            }
          }
        });
      });
      $("body").on("mousemove", ".progress-chunk-hover", function(e) {
        mX = e.pageX;
        offset = $(".progress-bar-wrapper").offset();
        label_offset = $(".progress-label").outerWidth() / 2;
        mX = mX - offset.left - label_offset;
        $(".progress-label").css("left", mX + "px");
        $(".progress-label").html($(this).attr("data-table"));
      });
      $("body").on("mouseenter mouseleave", ".progress-chunk-hover", function(event) {
        if (event.type === "mouseenter") {
          $(".progress-label").addClass("label-visible");
        } else {
          $(".progress-label").removeClass("label-visible");
        }
      });
      connection_info_box = $(".connection-info-wrapper");
      move_connection_info_box();
      $(".migrate-selection.option-group input[type=radio]").change(function() {
        move_connection_info_box();
        if (connection_established) {
          change_replace_values();
        }
      });
      function move_connection_info_box() {
        $(".connection-status").hide();
        $(".prefix-notice").hide();
        $(".ssl-notice").hide();
        $(".different-plugin-version-notice").hide();
        $(".step-two").show();
        $(".backup-options").show();
        $(".keep-active-plugins").show();
        $(".directory-permission-notice").hide();
        $("#create-backup").removeAttr("disabled");
        $("#create-backup-label").removeClass("disabled");
        $(".backup-option-disabled").hide();
        var connection_info = $.trim($(".pull-push-connection-info").val()).split(
          "\n"
        );
        if ($("#pull").is(":checked")) {
          $(".pull-list li").append(connection_info_box);
          connection_info_box.show();
          if (connection_established) {
            $(".connection-status").hide();
            $(".step-two").show();
            $(".table-prefix").text(connection_data.prefix);
            $(".uploads-dir").html(syncpilot_this_uploads_dir);
            if (profile_name_edited == false) {
              var profile_name = get_domain_name(connection_info[0]);
              $(".create-new-profile").val(profile_name);
            }
            if (show_prefix_notice == true) {
              $(".prefix-notice.pull").show();
            }
            if (show_ssl_notice == true) {
              $(".ssl-notice").show();
            }
            if (show_version_notice == true) {
              $(".different-plugin-version-notice").show();
              $(".step-two").hide();
            }
            $(".directory-scope").text(syncpilot_i10n.scope_local);
            if (false == syncpilot_write_permission) {
              $("#create-backup").prop("checked", false);
              $("#create-backup").attr("disabled", "disabled");
              $("#create-backup-label").addClass("disabled");
              $(".backup-option-disabled").show();
              $(".upload-directory-location").html(syncpilot_this_upload_dir_long);
            }
          } else {
            $(".connection-status").show();
            $(".step-two").hide();
          }
        } else if ($("#push").is(":checked")) {
          $(".push-list li").append(connection_info_box);
          connection_info_box.show();
          if (connection_established) {
            $(".connection-status").hide();
            $(".step-two").show();
            $(".table-prefix").html(syncpilot_this_prefix);
            $(".uploads-dir").text(connection_data.uploads_dir);
            if (profile_name_edited == false) {
              var profile_name = get_domain_name(connection_info[0]);
              $(".create-new-profile").val(profile_name);
            }
            if (show_prefix_notice == true) {
              $(".prefix-notice.push").show();
            }
            if (show_ssl_notice == true) {
              $(".ssl-notice").show();
            }
            if (show_version_notice == true) {
              $(".different-plugin-version-notice").show();
              $(".step-two").hide();
            }
            $(".directory-scope").text(syncpilot_i10n.scope_remote);
            if ("0" == connection_data.write_permissions) {
              $("#create-backup").prop("checked", false);
              $("#create-backup").attr("disabled", "disabled");
              $("#create-backup-label").addClass("disabled");
              $(".backup-option-disabled").show();
              $(".upload-directory-location").text(connection_data.upload_dir_long);
            }
          } else {
            $(".connection-status").show();
            $(".step-two").hide();
          }
        } else if ($("#savefile").is(":checked")) {
          $(".connection-status").hide();
          $(".step-two").show();
          $(".table-prefix").html(syncpilot_this_prefix);
          if (profile_name_edited == false) {
            $(".create-new-profile").val("");
          }
          $(".backup-options").hide();
          $(".keep-active-plugins").hide();
          if (false == syncpilot_write_permission) {
            $(".directory-permission-notice").show();
            $(".step-two").hide();
          }
        }
        media_files_connection_box_moved();
      }
      function change_replace_values() {
        if ($("#push").is(":checked") || $("#savefile").is(":checked")) {
          if (last_replace_switch == "" || last_replace_switch == "pull") {
            $(".replace-row").each(function() {
              var old_val = $(".old-replace-col input", this).val();
              $(".old-replace-col input", this).val($(
                ".replace-right-col input",
                this
              ).val());
              $(".replace-right-col input", this).val(old_val);
            });
          }
          $("#select-tables").remove();
          $(".select-tables-wrap").prepend(push_select);
          $("#select-post-types").remove();
          $(".select-post-types-wrap").prepend(push_post_type_select);
          $("#select-backup").remove();
          $(".backup-tables-wrap").prepend(push_select_backup);
          last_replace_switch = "push";
        } else if ($("#pull").is(":checked")) {
          if (last_replace_switch == "" || last_replace_switch == "push") {
            $(".replace-row").each(function() {
              var old_val = $(".old-replace-col input", this).val();
              $(".old-replace-col input", this).val($(
                ".replace-right-col input",
                this
              ).val());
              $(".replace-right-col input", this).val(old_val);
            });
          }
          $("#select-tables").remove();
          $(".select-tables-wrap").prepend(pull_select);
          $("#select-post-types").remove();
          $(".select-post-types-wrap").prepend(pull_post_type_select);
          $("#select-backup").remove();
          $(".backup-tables-wrap").prepend(pull_select_backup);
          last_replace_switch = "pull";
        }
      }
      if (($("#pull").is(":checked") || $("#push").is(":checked")) && !connection_established) {
        $(".step-two").hide();
        $(".connection-status").show();
      }
      $(".general-helper").click(function(e) {
        var icon = $(this), bubble = $(this).next();
        $(".helper-message").not(bubble).hide();
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
      $("body").click(function() {
        $(".helper-message").hide();
      });
      $(".helper-message").click(function(e) {
        e.stopPropagation();
      });
      $(".nav-tab").click(function() {
        $(".nav-tab").removeClass("nav-tab-active");
        $(this).addClass("nav-tab-active");
        $(".content-tab").hide();
        $("." + $(this).attr("data-div-name")).show();
        var hash2 = $(this).attr("data-div-name");
        hash2 = hash2.replace("-tab", "");
        window.location.hash = hash2;
        if ($(this).hasClass("diagnostics")) {
          refresh_debug_log();
        }
      });
      $("body").on("click", ".add-row", function() {
        $(this).parents("tr").before($(".original-repeatable-field").clone().removeClass("original-repeatable-field"));
      });
      $("body").on("click", ".replace-remove-row", function() {
        $(this).parents("tr").remove();
        if ($(".replace-row").length < 2) {
          $(".no-replaces-message").show();
        }
      });
      $(".add-replace").click(function() {
        $(".replace-fields").prepend($(".original-repeatable-field").clone().removeClass("original-repeatable-field"));
        $(".no-replaces-message").hide();
      });
      $("body").on(
        "mouseenter mouseleave",
        "#find-and-replace-sort tbody tr.replace-row",
        function(event) {
          if (event.type === "mouseenter") {
            $(".replace-remove-row", this).show();
          } else {
            $(".replace-remove-row", this).hide();
          }
        }
      );
      $("#find-and-replace-sort tbody").sortable({
        items: "> tr:not(.pin)",
        handle: "td:first",
        start: function() {
          $(".sort-handle").css("cursor", "-webkit-grabbing");
          $(".sort-handle").css("cursor", "-moz-grabbing");
        },
        stop: function() {
          $(".sort-handle").css("cursor", "-webkit-grab");
          $(".sort-handle").css("cursor", "-moz-grab");
        }
      });
      $("body").on("mouseenter mouseleave", ".save-migration-profile-wrap li", function(event) {
        if (event.type === "mouseenter") {
          $(".delete-profile", this).show();
        } else {
          $(".delete-profile", this).hide();
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
        $(".nav-tab").removeClass("nav-tab-active");
        $(".nav-tab." + hash2).addClass("nav-tab-active");
        $(".content-tab").hide();
        $("." + hash2 + "-tab").show();
        if (hash2 == "diagnostics") {
          refresh_debug_log();
        }
      }
      $(".reset-api-key").click(function() {
        if (doing_reset_api_key_ajax) {
          return;
        }
        syncpilot_confirm(syncpilot_i10n.reset_api_key, reset_api_key);
      });
      function reset_api_key() {
        doing_reset_api_key_ajax = true;
        $(".reset-api-key").after('<img src="' + spinner_url + '" alt="" class="reset-api-key-ajax-spinner general-spinner" />');
        $.ajax({
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
            $(".reset-api-key-ajax-spinner").remove();
            doing_reset_api_key_ajax = false;
          },
          success: function(data) {
            $(".reset-api-key-ajax-spinner").remove();
            doing_reset_api_key_ajax = false;
            $(".connection-info").html(data);
          }
        });
      }
      $("input.multiselect-toggle").change(function() {
        $(this).parents(".expandable-content").children(".select-wrap").toggle();
      });
      $(".show-multiselect").each(function() {
        if ($(this).is(":checked")) {
          $(this).parents(".option-section").children(".header-expand-collapse").children(".expand-collapse-arrow").removeClass("collapsed");
          $(this).parents(".expandable-content").show();
          $(this).parents(".expandable-content").children(".select-wrap").toggle();
        }
      });
      $("input[name=backup_option]").change(function() {
        $(".backup-tables-wrap").hide();
        if ($(this).val() == "backup_manual_select") {
          $(".backup-tables-wrap").show();
        }
      });
      if ($("#backup-manual-select").is(":checked")) {
        $(".backup-tables-wrap").show();
      }
      $(".plugin-compatibility-save").click(function() {
        if (doing_plugin_compatibility_ajax) {
          return;
        }
        $(this).addClass("disabled");
        select_element = $("#selected-plugins");
        $(select_element).attr("disabled", "disabled");
        doing_plugin_compatibility_ajax = true;
        $(this).after(
          '<img src="' + spinner_url + '" alt="" class="plugin-compatibility-spinner general-spinner" />'
        );
        $.ajax({
          url: ajaxurl,
          type: "POST",
          dataType: "text",
          cache: false,
          data: {
            action: "syncpilot_blacklist_plugins",
            blacklist_plugins: $(select_element).val(),
            nonce: syncpilot_nonces.blacklist_plugins
          },
          error: function(jqXHR, textStatus, errorThrown) {
            syncpilot_alert(ajax_problem_text(syncpilot_i10n.blacklist_problem, jqXHR));
            $(select_element).removeAttr("disabled");
            $(".plugin-compatibility-save").removeClass("disabled");
            doing_plugin_compatibility_ajax = false;
            $(".plugin-compatibility-spinner").remove();
            $(".plugin-compatibility-success-msg").show().fadeOut(2e3);
          },
          success: function(data) {
            if ("" != $.trim(data)) {
              syncpilot_alert($.trim(data));
            }
            $(select_element).removeAttr("disabled");
            $(".plugin-compatibility-save").removeClass("disabled");
            doing_plugin_compatibility_ajax = false;
            $(".plugin-compatibility-spinner").remove();
            $(".plugin-compatibility-success-msg").show().fadeOut(2e3);
          }
        });
      });
      $("body").on("click", ".delete-profile", function() {
        var name = $(this).next().clone();
        $("input", name).remove();
        var name = $.trim($(name).text());
        var $link = $(this);
        syncpilot_confirm(syncpilot_i10n.remove_profile + ' "' + name + '"', function() {
          delete_profile($link);
        });
      });
      function delete_profile($link) {
        $link.parent().fadeOut(500);
        $.ajax({
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
      $(".main-list-delete-profile-link").click(function() {
        var name = $(this).prev().text();
        var $link = $(this);
        syncpilot_confirm(syncpilot_i10n.remove_profile + ' "' + name + '"', function() {
          delete_profile($link);
        });
      });
      $("body").on("click", ".temp-disabled", function() {
        syncpilot_confirm(syncpilot_i10n.change_connection_info, function() {
          $(".ssl-notice").hide();
          $(".different-plugin-version-notice").hide();
          $(".migrate-db-button").show();
          $(".temp-disabled").removeAttr("readonly");
          $(".temp-disabled").removeClass("temp-disabled");
          $(".connect-button").show();
          $(".step-two").hide();
          $(".connection-status").show().html(syncpilot_i10n.enter_connection_info);
          connection_established = false;
        });
      });
      $(".settings-tab input[type=checkbox]").change(function() {
        if ("plugin-compatibility" == $(this).attr("id")) return;
        var checked = $(this).is(":checked");
        var setting = $(this).attr("id");
        $(this).parent().append('<img src="' + spinner_url + '" alt="" class="ajax-spinner general-spinner" />');
        var $label = $(this).parent();
        $.ajax({
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
            $(".ajax-spinner").remove();
          },
          success: function(data) {
            $(".ajax-spinner").remove();
            $($label).append('<span class="ajax-success-msg">' + syncpilot_i10n.saved + "</span>");
            $(".ajax-success-msg").fadeOut(2e3, function() {
              $(this).remove();
            });
          }
        });
      });
      $(".migrate-form").submit(function(e) {
        e.preventDefault();
      });
      $(".connect-button").click(function(event) {
        event.preventDefault();
        $(this).blur();
        connection_box_changed();
      });
      $(".pull-push-connection-info").bind("paste", function(e) {
        var $this = this;
        setTimeout(function() {
          connection_box_changed();
        }, 0);
      });
      $("body").on("click", ".try-again", function() {
        connection_box_changed();
      });
      $("body").on("click", ".try-http", function() {
        var connection_info = $.trim($(".pull-push-connection-info").val()).split("\n");
        var new_url = connection_info[0].replace("https", "http");
        var new_contents = new_url + "\n" + connection_info[1];
        $(".pull-push-connection-info").val(new_contents);
        connection_box_changed();
      });
      $(".create-new-profile").change(function() {
        profile_name_edited = true;
      });
      $("body").on("click", ".temporarily-disable-ssl", function() {
        if (window.location.hash) {
          var hash2 = window.location.hash.substring(1);
        }
        $(this).attr("href", $(this).attr("href") + "&hash=" + hash2);
      });
      function connection_box_changed(data) {
        var $this = $(".pull-push-connection-info");
        if (doing_ajax || $($this).hasClass("temp-disabled")) {
          return;
        }
        var data = $(".pull-push-connection-info").val();
        var connection_info = $.trim(data).split("\n");
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
          $(".connection-status").html(error_message);
          $(".connection-status").addClass(
            "notification-message error-notice migration-error"
          );
          return;
        }
        if (syncpilot_openssl_available == false) {
          connection_info[0] = connection_info[0].replace("https://", "http://");
          var new_connection_info_contents = connection_info[0] + "\n" + connection_info[1];
          $(".pull-push-connection-info").val(new_connection_info_contents);
        }
        show_prefix_notice = false;
        doing_ajax = true;
        disable_export_type_controls();
        if ($(".basic-access-auth-wrapper").is(":visible")) {
          connection_info[0] = connection_info[0].replace(/\/\/(.*)@/, "//");
          connection_info[0] = connection_info[0].replace("//", "//" + encodeURIComponent($.trim($(".auth-username").val())) + ":" + encodeURIComponent($.trim($(".auth-password").val())) + "@");
          var new_connection_info_contents = connection_info[0] + "\n" + connection_info[1];
          $(".pull-push-connection-info").val(new_connection_info_contents);
          $(".basic-access-auth-wrapper").hide();
        }
        $(".step-two").hide();
        $(".ssl-notice").hide();
        $(".prefix-notice").hide();
        $(".connection-status").show();
        $(".connection-status").html(syncpilot_i10n.establishing_remote_connection);
        $(".connection-status").removeClass(
          "notification-message error-notice migration-error"
        );
        $(".connection-status").append('<img src="' + spinner_url + '" alt="" class="ajax-spinner general-spinner" />');
        var intent = $("input[name=action]:checked").val();
        profile_name_edited = false;
        $.ajax({
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
            $(".connection-status").html(syncpilot_i10n.connection_local_server_problem + " (#100)");
            $(".connection-status").append("<br /><br />Status: " + jqXHR.status + " " + jqXHR.statusText + "<br /><br />Response:<br />" + jqXHR.responseText);
            $(".connection-status").addClass(
              "notification-message error-notice migration-error"
            );
            $(".ajax-spinner").remove();
            doing_ajax = false;
            enable_export_type_controls();
          },
          success: function(data2) {
            $(".ajax-spinner").remove();
            doing_ajax = false;
            enable_export_type_controls();
            if (typeof data2.syncpilot_error != "undefined" && data2.syncpilot_error == 1) {
              $(".connection-status").html(syncpilot_sanitize_html(data2.body));
              $(".connection-status").addClass(
                "notification-message error-notice migration-error"
              );
              if (data2.body.indexOf("401 Unauthorized") > -1) {
                $(".basic-access-auth-wrapper").show();
              }
              return;
            }
            var profile_name = get_domain_name(connection_info[0]);
            $(".create-new-profile").val(profile_name);
            $(".pull-push-connection-info").addClass("temp-disabled");
            $(".pull-push-connection-info").attr("readonly", "readonly");
            $(".connect-button").hide();
            $(".connection-status").hide();
            $(".step-two").show();
            maybe_show_ssl_warning(connection_info[0], connection_info[1], data2.scheme);
            maybe_show_version_warning(data2.plugin_version, connection_info[0]);
            maybe_show_prefix_notice(data2.prefix);
            connection_established = true;
            connection_data = data2;
            move_connection_info_box();
            var table_select = document.createElement("select");
            $(table_select).attr({
              multiple: "multiple",
              name: "select_tables[]",
              id: "select-tables",
              class: "multiselect"
            });
            $.each(connection_data.tables, function(index, value) {
              $(table_select).append('<option value="' + value + '">' + value + " (" + connection_data.table_sizes_hr[value] + ")</option>");
            });
            pull_select = table_select;
            push_select_backup = $(table_select).clone();
            $(push_select_backup).attr({
              name: "select_backup[]",
              id: "select-backup"
            });
            var post_type_select = document.createElement("select");
            $(post_type_select).attr({
              multiple: "multiple",
              name: "select_post_types[]",
              id: "select-post-types",
              class: "multiselect"
            });
            $.each(connection_data.post_types, function(index, value) {
              $(post_type_select).append('<option value="' + value + '">' + value + "</option>");
            });
            pull_post_type_select = post_type_select;
            if ($("#pull").is(":checked")) {
              $("#new-url").val(remove_protocol(syncpilot_this_url));
              $("#new-path").val(syncpilot_this_path);
              if (syncpilot_is_multisite == true) {
                $("#new-domain").val(syncpilot_this_domain);
              }
              $("#old-url").val(remove_protocol(data2.url));
              $("#old-path").val(data2.path);
              $("#select-tables").remove();
              $(".select-tables-wrap").prepend(pull_select);
              $("#select-post-types").remove();
              $(".select-post-types-wrap").prepend(pull_post_type_select);
              $(".table-prefix").text(data2.prefix);
              $(".uploads-dir").html(syncpilot_this_uploads_dir);
            } else {
              $("#select-backup").remove();
              $(".backup-tables-wrap").prepend(push_select_backup);
              $("#new-url").val(remove_protocol(data2.url));
              $("#new-path").val(data2.path);
            }
            next_step_in_migration = {
              fn: media_files_connection_verified,
              args: [connection_data]
            };
            execute_next_step();
          }
        });
      }
      $("body").on("click", ".pause-resume", function() {
        if (true == migration_paused) {
          migration_paused = false;
          doing_ajax = true;
          $(".progress-title").html(previous_progress_title);
          $(".progress-text").html(previous_progress_text);
          $(".migration-progress-ajax-spinner").show();
          $(".pause-resume").html(syncpilot_i10n.pause);
          elapsed_interval = setInterval(count, 1e3);
          execute_next_step();
        } else {
          migration_paused = true;
          doing_ajax = false;
          previous_progress_title = $(".progress-title").html();
          previous_progress_text = $(".progress-text").html();
          $(".progress-title").html(syncpilot_i10n.migration_paused);
          $(".pause-resume").html(syncpilot_i10n.resume);
          $(".progress-text").html(syncpilot_i10n.completing_current_request);
        }
      });
      $("body").on("click", ".cancel", function() {
        migration_cancelled = true;
        migration_paused = false;
        $(".progress-text").html(syncpilot_i10n.completing_current_request);
        $(".progress-title").html(syncpilot_i10n.cancelling_migration);
        $(".migration-controls").fadeOut();
        $(".migration-progress-ajax-spinner").show();
        if (false == doing_ajax) {
          execute_next_step();
        }
      });
      execute_next_step = function() {
        if (true == migration_paused) {
          $(".migration-progress-ajax-spinner").hide();
          clearInterval(elapsed_interval);
          $(".progress-text").html(syncpilot_i10n.paused);
          return;
        } else if (true == migration_cancelled) {
          migration_intent = $("input[name=action]:checked").val();
          if ("savefile" == migration_intent) {
            progress_msg = syncpilot_i10n.removing_local_sql;
          } else if ("pull" == migration_intent) {
            if ("backup" == stage) {
              progress_msg = syncpilot_i10n.removing_local_backup;
            } else {
              progress_msg = syncpilot_i10n.removing_local_temp_tables;
            }
          } else if ("push" == migration_intent) {
            if ("backup" == stage) {
              progress_msg = syncpilot_i10n.removing_remote_sql;
            } else {
              progress_msg = syncpilot_i10n.removing_remote_temp_tables;
            }
          }
          $(".progress-text").html(progress_msg);
          var request_data = {
            action: "syncpilot_cancel_migration",
            intent: migration_intent,
            url: remote_site,
            key: secret_key,
            stage,
            dump_filename,
            form_data,
            nonce: syncpilot_nonces.cancel_migration
          };
          if (typeof connection_data != "undefined") {
            request_data.temp_prefix = connection_data.temp_prefix;
          }
          $.ajax({
            url: ajaxurl,
            type: "POST",
            dataType: "text",
            cache: false,
            data: request_data,
            error: function(jqXHR, textStatus, errorThrown) {
              $(".progress-title").html(syncpilot_i10n.migration_cancellation_failed);
              $(".progress-text").html(syncpilot_i10n.manually_remove_temp_files);
              $(".progress-text").append("<br /><br />Status: " + jqXHR.status + " " + jqXHR.statusText + "<br /><br />Response:<br />" + jqXHR.responseText);
              $(".progress-text").addClass("migration-error");
              console.log(jqXHR);
              console.log(textStatus);
              console.log(errorThrown);
              migration_error = true;
              migration_complete_events();
              return;
            },
            success: function(data) {
              doing_ajax = false;
              data = $.trim(data);
              if (data != "") {
                $(".progress-title").html(syncpilot_i10n.migration_cancellation_failed);
                $(".progress-text").html(syncpilot_sanitize_html(data));
                $(".progress-text").addClass("migration-error");
                migration_error = true;
                migration_complete_events();
                return;
              }
              completed_msg = syncpilot_i10n.migration_cancelled;
              $(".progress-text").hide();
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
