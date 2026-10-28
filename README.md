# SyncPilot

SyncPilot migrates WordPress databases and media files between installs with a single click in the dashboard. It is especially handy for syncing a local development site with a live site.

**SyncPilot is a fork of the excellent [WP Sync DB](https://github.com/wp-sync-db/wp-sync-db) 1.5 by Sean Lang, merged with the [WP Sync DB Media Files](https://github.com/wp-sync-db/wp-sync-db-media-files) addon 1.1.4b1. Media file sync is now part of the plugin, there is no separate addon to install.**

## Features

- **Pull and push** a database between two WordPress installs
- **Selective sync**: choose which tables are migrated
- **Media files sync** between installs, optionally removing files that do not exist on the other side
- **Export** the database as an SQL file
- **Automatic find & replace** of URLs and file paths, serialization safe
- **Signed requests**: every request is verified with HMAC, data can be sent over SSL
- Detects server limits (e.g. `max_allowed_packet`) and adapts the chunk size

## Installation

1. Copy the `sync-pilot` folder to `wp-content/plugins/` on **both** sites and activate it.
2. Open **Tools → SyncPilot** (on multisite: **Settings → SyncPilot** in the network admin).
3. Enable pull/push on the remote site and copy its connection info into the local site.

Both sites need SyncPilot. A remote site that still runs WP Sync DB cannot be reached, because all request names were renamed on purpose.

## Migrating from WP Sync DB

On the first load SyncPilot copies the settings of WP Sync DB (API key, pull/push permissions, saved profiles) from the `wpsdb_settings` option. The old option is only read, never changed, so you can keep WP Sync DB installed during the switch. Deactivate and remove WP Sync DB and WP Sync DB Media Files afterwards.

## Requirements

- PHP 8.1 or newer, WordPress 6.0 or newer
- SyncPilot on **both** sites of a migration

## Status

Version 0.0.1 (private test release, the first public release will be 1.0.0): functionally identical to WP Sync DB 1.5 + Media Files 1.1.4b1, renamed and merged. Tested with pull and push including media files on PHP 8.4. Not yet verified: pulling new media files, SQL export download, multisite and WP-CLI. See [changelog.txt](changelog.txt) for details and known issues.

> **Use in production at your own risk.** SyncPilot has not yet been reviewed by an independent community and is maintained by a single developer. Test on a staging copy first and keep an independent backup before you push to a live site.

## Releases

Publishing a GitHub release (tag `v0.0.1`, matching the `Version:` header in `sync-pilot.php`) starts the release workflow, which builds `sync-pilot.zip` with the folder `sync-pilot/` and attaches it to the release.

## License

GPL v2, see [LICENSE](LICENSE). Original work by Sean Lang and contributors, WP Migrate DB by Delicious Brains.
