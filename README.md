# SyncPilot – WordPress Migration Plugin

SyncPilot migrates WordPress databases and media files between installs with a single click in the dashboard. It is especially handy for syncing a local development site with a live site.

**SyncPilot is a fork of the excellent [WP Sync DB](https://github.com/wp-sync-db/wp-sync-db) 1.5 by Sean Lang, merged with the [WP Sync DB Media Files](https://github.com/wp-sync-db/wp-sync-db-media-files) addon 1.1.4b1. Media file sync is now part of the plugin, there is no separate addon to install.**

## About

SyncPilot is aimed at WordPress developers and administrators who want a reliable, no-nonsense sync tool — without upsells, cloud-account lockout, or UI bloat that comes from a freemium model.

This is a side project maintained by one person in their spare time — not a product with a roadmap, a support team, or a commitment to feature requests. If this fork doesn't fit your workflow exactly, the codebase is intentionally kept clean and forkable. GPLv2 applies; take it and run.

## Features

- **Pull and push** a database between two WordPress installs
- **Selective sync**: choose which tables are migrated
- **Media files sync** between installs, optionally removing files that do not exist on the other side
- **Export** the database as an SQL file
- **Automatic find & replace** of URLs and file paths, serialization safe
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
4. Enable pull/push on the remote site and copy its connection info into the local site.

Once installed, future updates appear in the standard WordPress update flow — no manual download needed.

Both sites need SyncPilot. A remote site that still runs WP Sync DB cannot be reached, because all request names were renamed on purpose.

## Migrating from WP Sync DB

On the first load SyncPilot copies the settings of WP Sync DB (API key, pull/push permissions, saved profiles) from the `wpsdb_settings` option. The old option is only read, never changed, so you can keep WP Sync DB installed during the switch. Deactivate and remove WP Sync DB and WP Sync DB Media Files afterwards.

## Status

Version 0.2.4 (alpha): based on WP Sync DB 1.5 + Media Files 1.1.4b1, renamed and merged, with fixes for PHP 8.2+ and the first security fixes (see [changelog.txt](changelog.txt)). Pull, push and export were tested on PHP 8.4; Media Files, multisite and WP-CLI are not verified yet. Further hardening is planned, so use it only between sites you control and only on a trusted connection.

## Updates

SyncPilot looks for new versions in the releases of its GitHub repository and offers them like any other plugin update (Plugins, "Check for updates" in the row of the plugin forces a new look). It asks GitHub in the admin and in cron, at most once a day, and never for a visitor of the site. Pre-releases are offered as well; the filter `syncpilot_updater_prereleases` switches that off. The constant `SYNCPILOT_DISABLE_UPDATER` or the filter `syncpilot_updater_enabled` switches the updater off.

## Development

The admin styles are written as modules in `asset/src/css/` and the scripts live in `asset/src/js/`; both are built into `asset/css/styles.css` and `asset/js/sync-pilot.js` (the readable file and a `.min` file; the plugin loads the minified files unless `SCRIPT_DEBUG` is on). The admin page loads one script. Edit only `asset/src`. Run `npm install` once. `npm run dev` builds and then watches `asset/src` (a browser extension such as LiveReload then reloads the page), `npm run build` builds once; commit the built files; the release workflow stops if `asset/css` or `asset/js` is not up to date. The ZIP of a release does not contain `asset/src`, `tests`, `package.json` or `package-lock.json`. Before a release is tagged, `npm run release:check -- <version>` checks what the release workflow would stop for (everything committed, the same version everywhere, the built files up to date, the tag not yet there). The style of the scripts is checked with `npm run lint` (ESLint with `@stylistic`; `npm run lint:fix` repairs it). The checks in `tests/` run on a test installation (they say what they change and put it back): the PHP checks with `wp eval-file`, the browser tests with `npm run test:browser` (a headless Chromium clicks through the admin page) and, for a complete push to a second test site, `node tests/browser/push.mjs --yes`, which puts both databases back from a reference backup. They need two test installations of WordPress with wp-cli, named in `tests/browser/local.config.json` (copy `config.example.json`; the file is not part of the repository) or in environment variables.

## License

GPL v2, see [LICENSE](LICENSE). Original work by Sean Lang and contributors, WP Migrate DB by Delicious Brains.
