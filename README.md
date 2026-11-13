# SyncPilot – WordPress Migration Plugin

SyncPilot migrates WordPress databases and media files between installs with a single click in the dashboard. It is especially handy for syncing a local development site with a live site.

## About

SyncPilot is aimed at WordPress developers and administrators who want a reliable, no-nonsense sync tool — without upsells, cloud-account lockout, or UI bloat that comes from a freemium model.

**It is a fork of the excellent [WP Sync DB](https://github.com/wp-sync-db/wp-sync-db) 1.5 by Sean Lang, merged with the [WP Sync DB Media Files](https://github.com/wp-sync-db/wp-sync-db-media-files) addon 1.1.4b1. Media file sync is now part of the plugin, there is no separate addon to install.**

This is a side project maintained by one person in their spare time — not a product with a roadmap, a support team, or a commitment to feature requests. If this fork doesn't fit your workflow exactly, the codebase is intentionally kept clean and forkable. GPLv2 applies; take it and run.

## Features

- **Pull and push** a database between two WordPress installs: a pull replaces the database of this site with the one of a remote site, a push replaces the remote database with this one
- **Selective sync**: choose which tables are migrated
- **Media files sync** between installs. Before the first file is written the receiving site is checked (folders that cannot be written, the temporary folder, free space): if a file cannot be written, the migration stops before the database is replaced. Optionally files that do not exist on the other side are removed, **at the very end and only when everything went well**. SyncPilot makes no backup of media files, so removing cannot be undone: use it only when you know you need it
- **Export** the database as an SQL file, without ssh or phpMyAdmin
- **Backup** of the database that is replaced, before a pull or a push
- **Saved profiles** for migrations that are repeated
- **Pause, resume and cancel** a running migration
- **Automatic find & replace** of URLs and file paths in content, widgets, menus and settings, serialization safe
- **Log of every migration**: a log file of its own with the course of each migration, the errors with their reason and the environment of both sites (versions, limits); both sites write the same migration ID. It holds names, sizes and numbers, never values of the database or keys
- **Signed requests**: every request is verified with HMAC, data can be sent over SSL
- Detects server limits (e.g. `max_allowed_packet`) and adapts the chunk size

## Requirements

- WordPress 6.0 or later
- PHP 8.2 or later
- For full functionality: PHP extensions mysqli, curl

Features that cannot run due to your server configuration will not appear in the admin area.

## Installation

1. Download the latest `sync-pilot.zip` from the [Releases page](https://github.com/QuickBrownFox90/sync-pilot/releases).
2. In your WordPress admin go to **Plugins → Add New → Upload Plugin**, select the ZIP and click **Install Now**.
3. Activate the plugin, then go to **Tools → SyncPilot** (on multisite: **Settings → SyncPilot** in the network admin).
4. Enable pull/push on the remote site and copy its connection data into the local site.

Once installed, future updates appear in the standard WordPress update flow — no manual download needed.

Both sites need SyncPilot. A remote site that still runs WP Sync DB cannot be reached, because all request names were renamed on purpose.

## Updates

SyncPilot looks for new versions in the releases of its GitHub repository and offers them **like any other plugin update** (Plugins, "Check for updates" in the row of the plugin forces a new look). It asks GitHub in the admin and in cron, at most once a day, and never for a visitor of the site.

Pre-releases are offered as well; the filter `syncpilot_updater_prereleases` switches that off. The constant `SYNCPILOT_DISABLE_UPDATER` or the filter `syncpilot_updater_enabled` switches the updater off.

## Migrating from WP Sync DB

On the first load SyncPilot copies the settings of WP Sync DB (API key, pull/push permissions, saved profiles) from the `wpsdb_settings` option. The old option is only read, never changed, so you can keep WP Sync DB installed during the switch. Deactivate and remove WP Sync DB and WP Sync DB Media Files afterwards.

## Log and diagnostics

The Diagnostics tab shows the diagnostic info of the site and its log, with the choice of the log level and a button to clear it.

- **Levels**: *Off*, *Errors* (default) and *Verbose* (for troubleshooting). Errors writes every error (also a database query that failed, with its kind and table but never its values) and three entries per migration (started, other site agreed, requested by the other site). Verbose adds the warnings and notices of PHP, every request to the other site with its duration and size, and every chunk of a table: where it began, how many rows, its size, how long it took, the peak of the memory and the largest value (table, column, row and size, never the value).
- **An entry** is one line of JSON: time (UTC), level, source (`admin`, `remote`, `cli`), migration ID, action, a short English message, a help code and facts (`"help":130,"site":3` is the third place in the code that reports code 130).
- **Never in it**: values of the database, keys, signatures, passwords, tokens. The beginning of an answer of the other site is cleaned (no tags, long tokens replaced, nothing from serialized data or SQL).
- **A firewall in the way is named**: when the answer of the other site, or of this site to your browser, does not come from WordPress (no `X-Robots-Tag`, which `admin-ajax.php` always sends), the message says that a firewall or a proxy has probably blocked the request, gives its reference numbers (Attack ID, Message ID...) for the administrator of that server, and the log has help code 153.
- **A failed request ends with a reason**: exceptions, fatal errors and the time and memory limit during a request of SyncPilot are logged with message, file and line. A logged-in user sees the reason in the progress box; the other site only gets a short answer and has the details in its own log.
- **Where**: `uploads/sync-pilot/logs/` (random file name, 1 MB per file, three files, denied by `.htaccess` and `web.config`). If the folder cannot be written, the entries go to an option. The filters `syncpilot_log_dir` and `syncpilot_log_level` change the folder and the level.

## Status

Version 0.3.1 (alpha): based on WP Sync DB 1.5 + Media Files 1.1.4b1, renamed and merged (see [changelog.txt](changelog.txt)).

**What the 0.2.x versions were for.** Mostly groundwork, not new features. The admin script of WP Sync DB was one big file without any test. It is split into small modules and a short start-up script now, built with esbuild, checked with ESLint and covered by browser tests that click through the admin page. That was necessary to maintain the code at all, and to make the project really forkable: the parts can be developed one at a time without touching everything. You still have to understand how they work together, but not all of it at once. Besides that: fixes for PHP 8.2+ and WordPress 6.7, the first security fixes, several fixes found by pulling real sites (media files, cancelling), and one small feature (a find and replace row for http/https).

**What 0.3.x is.** The logging: a failed migration says what went wrong and where, on both sites, without reading server logs. The patches that follow are the first fixes from using it on real sites: telemetry per chunk at the level verbose, the failed database query that was not logged before, the check before the media files are written (it stops the migration before the database is replaced), the removal of media files only at the very end and only when nothing went wrong, and a firewall or a proxy that answers instead of WordPress is named, with the reference numbers of its block page, instead of "check the connection data".

**What is tested.** Pull, push, export, backup, media files, pause, cancel and saved profiles, automatically on two test sites (PHP 8.4) and by hand with pulls from live sites; also the cases that go wrong (an exception, a fatal error, the memory and the time limit, an answer that is cut or empty, a firewall that answers instead of WordPress, folders that cannot be written). Multisite and WP-CLI are not verified yet.

**What comes next.** 0.3.2: download of the log, filter by migration, the entries of the other site in one view. After that the media check before the tables are migrated (so that nothing is started that cannot end) and a migration that stops when a file cannot be copied. 0.4.0: import of a database dump. Use it only between sites you control and only on a trusted connection.

## Development

Edit only `asset/src`. The built files in `asset/css` and `asset/js` are committed; the release workflow stops if they are stale.

### Layout

- `class/`: the plugin in PHP: `syncpilot.php` (the admin page and the requests), `syncpilot-base.php` (what both parts share), `syncpilot-media-files.php`, `syncpilot-logger.php` (the log), `syncpilot-help-code.php` (the codes of the errors and their texts), `syncpilot-request-guard.php` (what ends a request without an answer), `syncpilot-updater.php`
- `asset/src/css/`: the admin styles as modules, built into `asset/css/styles.css`
- `asset/src/js/`: `script.js` (start-up), `modules/` (one file per feature), `common.js` and `media-files.js` (plain scripts); built into `asset/js/sync-pilot.js` and a `.min` file, which the plugin loads unless `SCRIPT_DEBUG` is on
- `tests/`: PHP checks and browser tests

The ZIP of a release does not contain `asset/src`, `tests`, `package.json` or `package-lock.json`.

### Commands

Run `npm install` once.

- `npm run build` builds once, `npm run dev` builds and then watches `asset/src` (a browser extension such as LiveReload reloads the page)
- `npm run lint` checks the style (ESLint with `@stylistic`), `npm run lint:fix` repairs it
- `npm run release:check -- <version>` checks what the release workflow would stop for: everything committed, the same version everywhere, the built files up to date, the tag not there yet

### Tests

The tests run on two test installations of WordPress with wp-cli, named in `tests/browser/local.config.json` (copy `config.example.json`; the file is not part of the repository) or in environment variables. They say what they change and put it back.

- `npm run test:browser`: the three views, the dialogs, the settings, an export
- `npm run test:controls`: pause, resume, cancel, saving and deleting profiles
- `npm run test:connection`: the connection box and saved profiles
- `node tests/browser/push.mjs --yes`: a complete push to the second site. Options: `--pull` (the other direction), `--media`, `--backup`, `--cancel` (cancel while it runs), `--full` (all tables), `--verbose` (the log level verbose on both sites; checks the entries of the chunks). `--media --unwritable`, `--media --stray` and `--media --stray --broken` check that the media check stops the migration and that files are removed only at the end, and only when all went well. Both databases are put back from a reference backup before and after.
- `npm run test:guard`: an exception, a fatal error, the memory limit and the time limit in a request. It copies a mu-plugin from `tests/fault/` into the test site and removes it again
- `npm run test:faults`: the other site answers wrongly (a web server error, a firewall, an empty or a cut answer, a closed connection, no answer); a proxy in `tests/fault/` spoils the answers, and the log has to say what happened
- `php tests/help-codes.php`: the help codes and every place that reports one (no WordPress needed)
- `wp eval-file wp-content/plugins/sync-pilot/tests/logger.php` and `tests/media-preflight.php` (the check before the media files are written) run on a test site

### Logging in the code

- An error is a case of the enum `SyncPilot_HelpCode`: a number and an English log text, short, complete in itself, without facts and without a code in it.
- `$this->log_error( SyncPilot_HelpCode::Name, array( … facts … ), site: N )`: N numbers the place in the code that reports it, 1 and up. `php tests/help-codes.php` stops a call without a site, a site that is used twice for a code and a code that nobody reports.
- A field that the browser sends and that the other site must not sign has to be removed in `get_post_data_filtered()`, otherwise it ends up in the signature.

## License

GPL v2, see [LICENSE](LICENSE). Original work by Sean Lang and contributors, WP Migrate DB by Delicious Brains.
