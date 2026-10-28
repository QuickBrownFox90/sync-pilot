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

1. Copy the `sync-pilot` folder to `wp-content/plugins/` on **both** sites and activate it.
2. Open **Tools → SyncPilot** (on multisite: **Settings → SyncPilot** in the network admin).
3. Enable pull/push on the remote site and copy its connection info into the local site.

Both sites need SyncPilot. A remote site that still runs WP Sync DB cannot be reached, because all request names were renamed on purpose.

## Migrating from WP Sync DB

On the first load SyncPilot copies the settings of WP Sync DB (API key, pull/push permissions, saved profiles) from the `wpsdb_settings` option. The old option is only read, never changed, so you can keep WP Sync DB installed during the switch. Deactivate and remove WP Sync DB and WP Sync DB Media Files afterwards.

## Status

Version 0.0.2 (alpha): functionally identical to WP Sync DB 1.5 + Media Files 1.1.4b1, renamed and merged. Modernisation (PHP 8 deprecations, hardening) is the next step.

## License

GPL v2, see [LICENSE](LICENSE). Original work by Sean Lang and contributors, WP Migrate DB by Delicious Brains.
