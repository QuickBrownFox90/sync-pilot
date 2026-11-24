# SyncPilot – WordPress Migration Plugin

SyncPilot migrates WordPress databases and media files between installs with a single click in the dashboard. It is especially handy for syncing a local development site with a live site.

## About

SyncPilot is aimed at WordPress developers and administrators who want a reliable, no-nonsense sync tool — without upsells, cloud-account lockout, or UI bloat that comes from a freemium model.

**It is a fork of the excellent [WP Sync DB](https://github.com/wp-sync-db/wp-sync-db) 1.5 by Sean Lang, merged with the [WP Sync DB Media Files](https://github.com/wp-sync-db/wp-sync-db-media-files) addon 1.1.4b1. Media file sync is now part of the plugin, there is no separate addon to install.**

This is a side project maintained by one person in their spare time — not a product with a roadmap, a support team, or a commitment to feature requests. If this fork doesn't fit your workflow exactly, the codebase is intentionally kept clean and forkable. GPLv2 applies; take it and run.

## Features

- **Pull and push** a database between two WordPress installs: a pull replaces the database of this site with the one of a remote site, a push replaces the remote database with this one
- **Selective sync**: choose which tables are migrated
- **Media files sync** between installs. The site that writes the files is checked twice: before the first table is sent (the uploads folder and the temporary folder can be written) and before the database is replaced (the folder of every file, free space). A problem, or a file that cannot be copied, stops the migration before the database is replaced; files that were copied already stay. Optionally files that do not exist on the other side are removed, **at the very end and only when everything went well**. SyncPilot makes no backup of media files, so removing cannot be undone: use it only when you know you need it
- **Export** the database as an SQL file, without ssh or phpMyAdmin
- **Import** of a database dump (`.sql` or `.sql.gz`) that lies in a folder of the site: it is checked completely before anything is changed, loaded into temporary tables, the values are replaced (serialized data stays valid) and the tables are exchanged at the end, like after a pull; with a backup, pause and cancel, and a log. See the section on the import below
- **Backup** of the database that is replaced, before a pull or a push
- **Saved profiles** for migrations that are repeated
- **Pause, resume and cancel** a running migration
- **Automatic find & replace** of URLs and file paths in content, widgets, menus and settings, serialization safe
- **Log of every migration**: a log file of its own with the course of each migration, the options it was started with, the errors with their reason, the environment of both sites (versions, limits, what differs) and at the end how long it took and how much each site read and imported; both sites write the same migration ID. It holds names, sizes and numbers, never values of the database or keys
- **Signed requests**: every request is verified with HMAC, data can be sent over SSL
- Detects server limits (e.g. `max_allowed_packet`) and adapts the chunk size

## Requirements

- WordPress 6.0 or later
- PHP 8.2 or later (an older PHP gets a notice in the admin, the plugin is not loaded; a WordPress with several domains that are vhosts of their own can run under several PHP versions)
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

## Import of a dump

**Tools → SyncPilot → Import** replaces the tables that a dump holds with the data of the dump. The dump is a `.sql` or `.sql.gz` file, from SyncPilot, `wp db export`, mysqldump or another tool.

1. Put the file into the folder that the page shows (`uploads/sync-pilot/imports-<random name>/`, closed to the web server; the filter `syncpilot_import_dir` moves it, for example outside of the web root). On a local site a copy is enough, otherwise SFTP. Refresh the list and choose the file. Or choose "Upload a file": the page sends the file in parts of the size of one request (so the PHP limits for an upload do not matter), compresses a `.sql` file in the browser first (smaller, and a firewall sees no SQL) and offers to remove it after the import; a file that was uploaded is removed after a successful import unless you change that, a file that you put into the folder stays.
2. Fill the rows of find and replace as for a pull: the old values (the address and the path as they are in the dump) and the new ones (this site). The option for the backup is the one of the other migrations; it saves the tables of this site that the dump replaces.
3. Start. The dump is unpacked (gzip), **checked completely** (every statement; nothing is changed if one is not allowed, a collation is not known or the prefix differs), the backup is made, the dump is loaded into temporary tables, the values are replaced, and at the end the tables are exchanged. Pause and cancel work as for the other migrations, a cancel removes everything that the import made.

To restore a backup of SyncPilot choose "Restore a backup" in the dump box: the list shows the backups of this site (time, address, size; "not complete" when the migration that made it stopped before the last table was written). Nothing is copied, the file is read where it is. Leave the rows of find and replace empty to get the tables exactly as they were.

What to know:

- Only `DROP TABLE`, `CREATE TABLE`, `INSERT` and the `SET` of the session are run. Everything else in a dump (`UPDATE`, `DELETE`, `GRANT`, triggers, views, `LOAD DATA`...) is refused, with its kind in the message.
- A collation that this database does not know (a dump of MariaDB 11 has `utf8mb4_uca1400_ai_ci`, one of MySQL 8 `utf8mb4_0900_ai_ci`) is replaced by a similar one, usually `utf8mb4_unicode_520_ci`; a checkbox stops the import instead.
- The import does not change the media files. Use a pull for them.
- The tables of the dump must have the prefix of this site, unless a checkbox allows another one.
- A browser that is closed during an import leaves the temporary tables and its state; they are removed by the next migration or a cancel.

## Migrating from WP Sync DB

On the first load SyncPilot copies the settings of WP Sync DB (API key, pull/push permissions, saved profiles) from the `wpsdb_settings` option. The old option is only read, never changed, so you can keep WP Sync DB installed during the switch. Deactivate and remove WP Sync DB and WP Sync DB Media Files afterwards.

## Log and diagnostics

The Diagnostics tab shows the diagnostic info of the site and its log, with the choice of the log level and a button to clear it.

- **Levels**: *Off*, *Errors* (default) and *Verbose* (for troubleshooting). Errors writes every error (also a database query that failed, with its kind and table but never its values) and the course of every migration: started (with its options), other site agreed (with what differs between the two environments), requested by the other site, and the end on both sites (finished, cancelled, stopped or failed, with the duration, the seconds of its parts (tables, media files, replacing the tables) and the totals of tables, rows and bytes; numbers only). Verbose adds the warnings and notices of PHP, every request to the other site with its duration and size, and every chunk of a table: where it began, how many rows, its size, how long it took, the peak of the memory and the largest value (table, column, row and size, never the value). An import writes Import scanned, Import loaded and Import replaced (statements, tables, bytes, seconds) in between.
- **An entry** is one line of JSON: time (UTC), level, source (`admin`, `remote`, `cli`), migration ID, action, a short English message, a help code and facts (`"help":130,"site":3` is the third place in the code that reports code 130).
- **Never in it**: values of the database, keys, signatures, passwords, tokens. The beginning of an answer of the other site is cleaned (no tags, long tokens replaced, nothing from serialized data or SQL).
- **A firewall in the way is named**: when the answer of the other site, or of this site to your browser, does not come from WordPress (no `X-Robots-Tag`, which `admin-ajax.php` always sends), the message says that a firewall or a proxy has probably blocked the request, gives its reference numbers (Attack ID, Message ID...) for the administrator of that server, and the log has help code 153.
- **A failed request ends with a reason**: exceptions, fatal errors and the time and memory limit during a request of SyncPilot are logged with message, file and line. A logged-in user sees the reason in the progress box; the other site only gets a short answer and has the details in its own log.
- **Where**: `uploads/sync-pilot/logs/` (random file name, 1 MB per file, three files, denied by `.htaccess` and `web.config`). If the folder cannot be written, the entries go to an option. The filters `syncpilot_log_dir` and `syncpilot_log_level` change the folder and the level.

## Status

Version 0.4.4 (alpha): based on WP Sync DB 1.5 + Media Files 1.1.4b1, renamed and merged (see [changelog.txt](changelog.txt)).

**What the 0.2.x versions were for.** Mostly groundwork, not new features. The admin script of WP Sync DB was one big file without any test. It is split into small modules and a short start-up script now, built with esbuild, checked with ESLint and covered by browser tests that click through the admin page. That was necessary to maintain the code at all, and to make the project really forkable: the parts can be developed one at a time without touching everything. You still have to understand how they work together, but not all of it at once. Besides that: fixes for PHP 8.2+ and WordPress 6.7, the first security fixes, several fixes found by pulling real sites (media files, cancelling), and one small feature (a find and replace row for http/https).

**What 0.3.x is.** The logging: a failed migration says what went wrong and where, on both sites, without reading server logs. The patches that follow are the first fixes from using it on real sites: telemetry per chunk at the level verbose, the failed database query that was not logged before, the check of the folders for the media files (before the first table is sent and before the database is replaced) and a media file that cannot be copied, both stop the migration before the database is replaced, the removal of media files only at the very end and only when nothing went wrong, and a firewall or a proxy that answers instead of WordPress is named, with the reference numbers of its block page, instead of "check the connection data". The progress bar belongs to the same idea (what is going on right now): it shows a percent on every database, also on MySQL 8 and with hundreds of tables.

**What 0.4.0 is.** The import of a database dump, built to be safe: it reads the dump statement by statement from any place, so a dump of any size is handled in many short requests, and checks all of it before the first table is made. The replace of the import does not unserialize serialized values (the function of a pull and a push builds them again and copies every object that is used twice: a graph of 764 bytes with a depth of 18 needs 669 MB there, and every level doubles it); it rewrites the text, so references stay and the memory is the size of the text. The choice of the form is Pull, Push, Import, Export.

**What 0.4.1 is.** What the import learned is used by pull and push: the replace in serialized values no longer copies objects (and keeps references), and a database that does not know a collation of the other one (MariaDB 11 to an older server, MySQL 8 to MariaDB) gets a similar one instead of stopping at the first table. A push has the choice to keep the collations of the other site (a table that exists there keeps its collation, a new table gets the one of its posts table), so a deploy does not mix the collations of the live database. A push needs 0.4.1 on both sites for that.

**What 0.4.2 is.** The upload of a dump in the page, which completes the import: the file goes up in many small requests, compressed in the browser, under a name with a part that cannot be guessed, and is removed after the import if you want that.

**What 0.4.3 is.** A backup of SyncPilot can be restored: the head of a backup (and of an export) says what it is, when it was made and on which address, the end mark says that it is complete, and the import lists the backups of the site and restores one like any other dump ("Restore a backup" in the dump box).

**What 0.4.4 is.** Exports and backups are no longer where a web server can hand them out: they are in a folder with a name that cannot be guessed, closed for every `.sql` and `.sql.gz` file, and the plugin hands them out through a link with a nonce (an export once, a backup stays). The backups of the versions before are still found and can be restored, and a backup can be removed from the list. The diagnostics say whether the web server serves the folder (nginx does not read the rule of the folder and needs its own: deny `/exports-`).

**What is tested.** Pull, push, export, import (also a gzip dump, with a backup and a cancel), backup, media files, pause, cancel and saved profiles, automatically on two test sites (PHP 8.4) and by hand with pulls and imports of live sites, multisites among them; also the cases that go wrong (an exception, a fatal error, the memory and the time limit, an answer that is cut or empty, a firewall that answers instead of WordPress, folders that cannot be written). WP-CLI is not verified yet, multisite only by hand.

**What comes next.** 0.5.x: the overhaul of the admin page, with the log in boxes per migration, its download and the entries of the other site. Use it only between sites you control and only on a trusted connection.

## Development

Edit only `asset/src`. The built files in `asset/css` and `asset/js` are committed; the release workflow stops if they are stale.

### Layout

- `class/`: the plugin in PHP: `syncpilot.php` (the admin page and the requests), `syncpilot-base.php` (what both parts share), `syncpilot-media-files.php`, `syncpilot-import.php` (the import of a dump: folder, checks, loading, replace), `syncpilot-dump-reader.php` (reads a dump statement by statement), `syncpilot-logger.php` (the log), `syncpilot-help-code.php` (the codes of the errors and their texts), `syncpilot-request-guard.php` (what ends a request without an answer), `syncpilot-updater.php`
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
- `node tests/browser/push.mjs --yes`: a complete push to the second site. Options: `--pull` (the other direction), `--media`, `--backup`, `--cancel` (cancel while it runs), `--full` (all tables), `--verbose` (the log level verbose on both sites; checks the entries of the chunks). `--shot-progress` takes a picture of the progress box while the tables run. `--media --unwritable`, `--media --stray`, `--media --stray --broken` and `--pull --media --broken` check that the media check and a file that cannot be copied stop the migration and that files are removed only at the end, and only when all went well. Both databases are put back from a reference backup before and after.
- `node tests/browser/import.mjs --yes`: the import of the database of the second site into the first one, clicked through (the first site is put back afterwards). Options: `--gzip` (a gzip dump, with a backup), `--backup`, `--cancel` (cancel while the dump is loaded), `--upload` (the file is uploaded in the page, with `--plain` without compression), `--restore` (an import with a backup, then that backup is restored), `--shots`. The folder for the dumps is not writable for the user of the command, so the test sets another one with a temporary mu-plugin
- `npm run test:guard`: an exception, a fatal error, the memory limit and the time limit in a request. It copies a mu-plugin from `tests/fault/` into the test site and removes it again
- `npm run test:faults`: the other site answers wrongly (a web server error, a firewall, an empty or a cut answer, a closed connection, no answer); a proxy in `tests/fault/` spoils the answers, and the log has to say what happened
- `php tests/help-codes.php`: the help codes and every place that reports one (no WordPress needed)
- `wp eval-file wp-content/plugins/sync-pilot/tests/logger.php`, `tests/media-preflight.php` (the check of the folders for the media files) and `tests/table-rows.php` (the number of rows per table, answered like MySQL 8) run on a test site; so do the checks of the import: `tests/import.php` (the folder), `tests/import-upload.php` (the names of uploads, the removal), `tests/import-backup.php` (the head and the end of a backup, the list), `tests/import-reader.php` (the reader, the statements that are allowed, the collations, a real dump), `tests/import-load.php` (scan and load in short requests with a new connection each, and what stops the import), `tests/import-replace.php` (the replace for every kind of value, gzip, a real dump compared with the function of a push or a pull), `tests/import-serialized.php` and `tests/import-memory.php` (shared objects, a memory limit); `tests/php-guard.php` (the guard for an older PHP), `tests/export-folder.php` (the folder of the exports and backups, the links, the old folder) and `tests/browser/download.mjs` (the download of an export), `tests/collation-map.php` and `tests/collation-keep.php` (the collations of a chunk) and `tests/replace-compare.php` (old and new replace on the data of a real site)

### Logging in the code

- An error is a case of the enum `SyncPilot_HelpCode`: a number and an English log text, short, complete in itself, without facts and without a code in it.
- `$this->log_error( SyncPilot_HelpCode::Name, array( … facts … ), site: N )`: N numbers the place in the code that reports it, 1 and up. `php tests/help-codes.php` stops a call without a site, a site that is used twice for a code and a code that nobody reports.
- A field that the browser sends and that the other site must not sign has to be removed in `get_post_data_filtered()`, otherwise it ends up in the signature.

## License

GPL v2, see [LICENSE](LICENSE). Original work by Sean Lang and contributors, WP Migrate DB by Delicious Brains.
