# SyncPilot – WordPress Migration Plugin

SyncPilot migrates WordPress databases and media files between installs with a single click in the dashboard. It is especially handy for syncing a local development site with a live site.

## About

SyncPilot is aimed at WordPress developers and administrators who want a reliable, no-nonsense sync tool — without upsells, cloud-account lockout, or UI bloat that comes from a freemium model.

**It is a fork of the excellent [WP Sync DB](https://github.com/wp-sync-db/wp-sync-db) 1.5 by Sean Lang, merged with the [WP Sync DB Media Files](https://github.com/wp-sync-db/wp-sync-db-media-files) addon 1.1.4b1. Media file sync is now part of the plugin, there is no separate addon to install.**

This is a side project maintained by one person in their spare time — not a product with a roadmap, a support team, or a commitment to feature requests. If this fork doesn't fit your workflow exactly, the codebase is intentionally kept clean and forkable. GPLv2 applies; take it and run.

## Features

- **Pull and push** a database between two WordPress installs: a pull replaces the database of this site with the one of a remote site, a push replaces the remote database with this one
- **Selective sync**: choose which tables are migrated
- **Media files sync** between installs, optionally removing files that do not exist on the other side
- **Export** the database as an SQL file, without ssh or phpMyAdmin
- **Backup** of the database that is replaced, before a pull or a push
- **Saved profiles** for migrations that are repeated
- **Pause, resume and cancel** a running migration
- **Automatic find & replace** of URLs and file paths in content, widgets, menus and settings, serialization safe
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

## Status

Version 0.2.9 (alpha): based on WP Sync DB 1.5 + Media Files 1.1.4b1, renamed and merged (see [changelog.txt](changelog.txt)).

**What the 0.2.x versions were for.** Mostly groundwork, not new features. The admin script of WP Sync DB was one big file without any test. It is split into small modules and a short start-up script now, built with esbuild, checked with ESLint and covered by browser tests that click through the admin page. That was necessary to maintain the code at all, and to make the project really forkable: the parts can be developed one at a time without touching everything. You still have to understand how they work together, but not all of it at once. Besides that: fixes for PHP 8.2+ and WordPress 6.7, the first security fixes, several fixes found by pulling real sites (media files, cancelling), and one small feature (a find and replace row for http/https).

**What is tested.** Pull, push, export, backup, media files, pause, cancel and saved profiles, automatically on two test sites (PHP 8.4) and by hand with a pull from a live site. Multisite and WP-CLI are not verified yet.

**What comes next.** No new core features before 0.3.0, which brings logging, so that a failed migration says what went wrong and why. Use it only between sites you control and only on a trusted connection.

## Development

Edit only `asset/src`. The built files in `asset/css` and `asset/js` are committed; the release workflow stops if they are stale.

### Layout

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
- `node tests/browser/push.mjs --yes`: a complete push to the second site. Options: `--pull` (the other direction), `--media`, `--backup`, `--cancel` (cancel while it runs), `--full` (all tables). Both databases are put back from a reference backup before and after.
- the PHP checks in `tests/` run with `wp eval-file`

## License

GPL v2, see [LICENSE](LICENSE). Original work by Sean Lang and contributors, WP Migrate DB by Delicious Brains.
