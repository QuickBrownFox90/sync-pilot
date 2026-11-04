// What the admin page remembers while it is open. Every part of script.js reads and writes it as state.name, so that
// it is clear which values live longer than one function call.

export const state = {

    // the connection to the other site
    connection_established : false,
    remote_site            : undefined,
    secret_key             : undefined,

    // the form
    last_replace_switch : '',
    profile_name_edited : false,
    show_prefix_notice  : false,
    show_ssl_notice     : false,
    show_version_notice : false,

    // requests that are running (a second click must not start the same request again)
    doing_ajax                      : false,
    doing_reset_api_key_ajax        : false,
    doing_save_profile              : false,
    doing_plugin_compatibility_ajax : false,

    // the migration
    migration_intent        : undefined,
    stage                   : undefined,
    form_data               : undefined,
    tables_to_migrate       : '',
    currently_migrating     : false,
    migration_completed     : false,
    migration_paused        : false,
    migration_cancelled     : false,
    completed_msg           : undefined,
    overall_percent         : undefined,
    previous_progress_title : undefined,
    previous_progress_text  : undefined,

    // the export file
    dump_filename : '',
    dump_url      : '',

    // the counter of the elapsed time
    timer_count      : undefined,
    elapsed_interval : undefined,
};
