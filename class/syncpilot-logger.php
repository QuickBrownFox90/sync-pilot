<?php
/**
 * The log of SyncPilot: one line of JSON per entry, in a file that the web server does not hand out.
 *
 * The log holds metadata only: names, sizes, numbers, times and messages. Values of the database, the signature and the
 * keys are never written (see clean()), because the public endpoints log requests of anyone, before the signature is
 * known to be right.
 *
 * @since   0.3.0
 * @author  Patrick Mauersberger
 */
class SyncPilot_Logger {

	const LEVEL_OFF     = 'off';
	const LEVEL_ERRORS  = 'errors';
	const LEVEL_VERBOSE = 'verbose';

	// a file is rotated when it would grow above this size; the newest FILES_KEPT - 1 rotated files are kept
	const FILE_MAX_BYTES  = 1048576;
	const FILES_KEPT      = 3;

	// one entry is cut to this size
	const ENTRY_MAX_BYTES = 4096;

	// when the file cannot be written (the uploads folder is not writable, for one) the entries go to this option
	const FALLBACK_OPTION = 'syncpilot_log_fallback';
	const FALLBACK_BYTES  = 102400;

	// the log of the versions before 0.3.0 was this option
	const LEGACY_OPTION   = 'syncpilot_error_log';

	// names whose values are never written, only their size
	const SECRET_NAMES = array( 'sig', 'key', 'secret_key', 'nonce', 'chunk', 'form_data', 'connection_info', 'auth', 'password', 'cookies', 'authorization', 'set-cookie' );

	protected static $migration_id = '';
	protected static $phase        = '';
	protected static $dir          = null;

	/**
	 * The level of the log: off, errors (the default) or verbose. Set by the setting "log_level" and the filter
	 * "syncpilot_log_level"
	 * @since   0.3.0
	 *
	 * @return  string
	 */
	static function level() {

		$settings = get_option( 'syncpilot_settings' );
		$level    = is_array( $settings ) && isset( $settings['log_level'] ) ? $settings['log_level'] : self::LEVEL_ERRORS;
		$level    = apply_filters( 'syncpilot_log_level', $level );

		return in_array( $level, array( self::LEVEL_OFF, self::LEVEL_ERRORS, self::LEVEL_VERBOSE ), true ) ? $level : self::LEVEL_ERRORS;
	}

	/**
	 * Name the migration that the next entries of this request belong to; both sites write the same ID
	 * @since   0.3.0
	 *
	 * @param   string $id  The ID of the migration; an empty text for none
	 */
	static function set_migration_id( $id ) {
		self::$migration_id = preg_replace( '/[^A-Za-z0-9_-]/', '', (string) $id );
	}

	/**
	 * A new ID for a migration: the time (UTC) and six random characters, for example 261112-101530-a1b2c3. Short enough to
	 * say aloud, and the entries of the log are in the order of the IDs.
	 * @since   0.3.0
	 *
	 * @return  string
	 */
	static function new_migration_id() {
		return gmdate( 'ymd-His' ) . '-' . substr( bin2hex( random_bytes( 4 ) ), 0, 6 );
	}

	/**
	 * @since   0.3.0
	 *
	 * @return  string  The ID of the migration of this request; an empty text for none
	 */
	static function migration_id() {
		return self::$migration_id;
	}

	/**
	 * Name the phase that the next entries belong to (initiate, tables, media, finalize...)
	 * @since   0.3.0
	 *
	 * @param   string $phase  The phase; an empty text for none
	 */
	static function set_phase( $phase ) {
		self::$phase = preg_replace( '/[^A-Za-z0-9_.-]/', '', (string) $phase );
	}

	/**
	 * Something went wrong. Written at the levels errors and verbose.
	 * @since   0.3.0
	 *
	 * @param   string $message  What went wrong
	 * @param   array  $context  Names and sizes that belong to it, see clean()
	 * @param   array  $fields   Fields of the entry besides the message: help (the number of the help code), site (the number of the place in the code), at (the function)
	 */
	static function error( $message, $context = array(), $fields = array() ) {
		self::write( 'error', $message, $context, $fields );
	}

	/**
	 * Something that happened on the way, for finding a culprit. Written at the level verbose only.
	 * @since   0.3.0
	 *
	 * @param   string $message  What happened
	 * @param   array  $context  Names and sizes that belong to it, see clean()
	 * @param   array  $fields   Fields of the entry besides the message, see error()
	 */
	static function info( $message, $context = array(), $fields = array() ) {
		self::write( 'info', $message, $context, $fields );
	}

	/**
	 * Something that marks the course of a migration (it started, it was requested by the other site). Written at the
	 * levels errors and verbose: the entry carries the ID of the migration and the environment, which is what is needed to
	 * read an error that comes later.
	 * @since   0.3.0
	 *
	 * @param   string $message  What happened
	 * @param   array  $context  Names and sizes that belong to it, see clean()
	 */
	static function event( $message, $context = array() ) {
		self::write( 'event', $message, $context );
	}

	/**
	 * What decides whether a migration works, of this site: versions, limits of PHP and of the database. Names, numbers
	 * and yes/no only: no paths, no addresses, no keys, no names of users.
	 * @since   0.3.0
	 *
	 * @return  array
	 */
	static function environment() {

		global $wpdb;

		$env = array(
			'plugin'              => $GLOBALS['syncpilot_meta']['sync-pilot']['version'] ?? '',
			'wordpress'           => get_bloginfo( 'version' ),
			'multisite'           => is_multisite(),
			'php'                 => PHP_VERSION,
			'sapi'                => PHP_SAPI,
			'os'                  => PHP_OS_FAMILY,
			'server'              => self::shorten( (string) ( $_SERVER['SERVER_SOFTWARE'] ?? '' ), 60 ),
			'ssl'                 => is_ssl(),
			'memory_limit'        => ini_get( 'memory_limit' ),
			'max_execution_time'  => (int) ini_get( 'max_execution_time' ),
			'post_max_size'       => ini_get( 'post_max_size' ),
			'upload_max_filesize' => ini_get( 'upload_max_filesize' ),
			'gzip'                => function_exists( 'gzcompress' ),
		);

		$suppress = $wpdb->suppress_errors( true );
		$row      = $wpdb->get_row( 'SELECT VERSION() AS version, @@sql_mode AS sql_mode, @@max_allowed_packet AS max_allowed_packet', ARRAY_A );
		$wpdb->suppress_errors( $suppress );

		$env['db']                 = $row['version'] ?? '';
		$env['db_charset']         = $wpdb->charset;
		$env['db_collate']         = $wpdb->collate;
		$env['sql_mode']           = $row['sql_mode'] ?? '';
		$env['max_allowed_packet'] = (int) ( $row['max_allowed_packet'] ?? 0 );

		$uploads = wp_upload_dir( null, false );
		$free    = @disk_free_space( $uploads['basedir'] );

		$env['free_disk_bytes'] = false === $free ? null : (int) $free;

		return $env;
	}

	/**
	 * Add an entry to the log
	 * @since   0.3.0
	 *
	 * @param   string $level    error, event or info
	 * @param   string $message  The message
	 * @param   array  $context  Names and sizes that belong to it, see clean()
	 * @param   array  $fields   Fields of the entry besides the message, see error()
	 */
	static function write( $level, $message, $context = array(), $fields = array() ) {

		$setting = self::level();

		// error and event at the levels errors and verbose, everything else at verbose only
		if ( self::LEVEL_OFF === $setting || ( ! in_array( $level, array( 'error', 'event' ), true ) && self::LEVEL_VERBOSE !== $setting ) )
			return;

		$line = self::build_line( $level, $message, $context, $fields );

		if ( ! self::append_to_file( $line ) )
			self::append_to_fallback( $line );
	}

	/**
	 * The line for one entry: JSON without a line break, not longer than ENTRY_MAX_BYTES
	 * @since   0.3.0
	 *
	 * @param   string $level    error or info
	 * @param   string $message  The message
	 * @param   array  $context  Names and sizes that belong to it
	 * @param   array  $fields   Fields of the entry besides the message, see error()
	 *
	 * @return  string
	 */
	static function build_line( $level, $message, $context = array(), $fields = array() ) {

		$entry = array(
			't'     => gmdate( 'Y-m-d\TH:i:s\Z' ),
			'level' => $level,
			'src'   => self::source(),
		);

		if ( '' !== self::$migration_id )
			$entry['migration'] = self::$migration_id;

		if ( ! empty( $_POST['action'] ) && is_string( $_POST['action'] ) )
			$entry['action'] = self::shorten( $_POST['action'], 60 );

		if ( '' !== self::$phase )
			$entry['phase'] = self::$phase;

		// who reports it: the help code (what), the number of the place in the code (where) and the function
		if ( isset( $fields['help'] ) )
			$entry['help'] = (int) $fields['help'];

		if ( ! empty( $fields['site'] ) )
			$entry['site'] = (int) $fields['site'];

		if ( ! empty( $fields['at'] ) )
			$entry['at'] = self::shorten( (string) $fields['at'], 120 );

		$entry['message'] = self::shorten( wp_strip_all_tags( (string) $message ), 2000 );

		if ( ! empty( $context ) )
			$entry['context'] = self::clean( $context );

		$line = self::encode( $entry );

		// too long: the context goes, the message stays
		if ( strlen( $line ) > self::ENTRY_MAX_BYTES ) {
			$entry['message'] = self::shorten( $entry['message'], 1000 );
			$entry['context'] = array( 'cut' => 'the context was too long for one entry' );
			$line             = self::encode( $entry );
		}

		return $line;
	}

	/**
	 * Who wrote the entry: admin (a logged-in user, the browser of the migration), remote (a request of another site to
	 * a public endpoint) or cli
	 * @since   0.3.0
	 *
	 * @return  string
	 */
	static function source() {

		if ( defined( 'WP_CLI' ) && WP_CLI )
			return 'cli';

		if ( function_exists( 'wp_doing_ajax' ) && wp_doing_ajax() )
			return function_exists( 'is_user_logged_in' ) && is_user_logged_in() ? 'admin' : 'remote';

		return 'admin';
	}

	/**
	 * Turn data into something that can go into the log: names and sizes, short beginnings of text, nothing secret.
	 * A value whose name is in SECRET_NAMES is replaced by its size; a long text is cut and says how long it was; an
	 * object is its class name; a WP_Error is its code and message; arrays are followed two levels down and 20 items wide.
	 * @since   0.3.0
	 *
	 * @param   mixed $data   Array, WP_Error, object or scalar
	 * @param   int   $depth  How deep it went already
	 *
	 * @return  mixed
	 */
	static function clean( $data, $depth = 0 ) {

		if ( is_wp_error( $data ) )
			return 'WP_Error ' . self::shorten( $data->get_error_code() . ': ' . $data->get_error_message(), 500 );

		if ( is_object( $data ) )
			return get_class( $data );

		if ( is_bool( $data ) || is_int( $data ) || is_float( $data ) || is_null( $data ) )
			return $data;

		if ( is_string( $data ) )
			return self::shorten( $data, 300 );

		if ( ! is_array( $data ) )
			return gettype( $data );

		if ( $depth > 2 )
			return '[array, ' . count( $data ) . ' items]';

		$clean = array();
		$count = 0;

		foreach ( $data as $name => $value ) {

			if ( ++$count > 20 ) {
				$clean['...'] = ( count( $data ) - 20 ) . ' more';
				break;
			}

			$name = is_string( $name ) ? self::shorten( $name, 60 ) : $name;

			if ( is_string( $name ) && in_array( strtolower( $name ), self::SECRET_NAMES, true ) )
				$clean[ $name ] = '[not logged' . ( is_string( $value ) ? ', ' . strlen( $value ) . ' bytes' : '' ) . ']';

			else
				$clean[ $name ] = self::clean( $value, $depth + 1 );
		}

		return $clean;
	}

	/**
	 * The beginning of what a server answered, for the log: without tags (and what is inside script and style), without
	 * line breaks, long runs of letters and digits (a key, a signature, a token) replaced, cut to the length. A page of
	 * an error says what it is in a few words; this keeps those and nothing else. Serialized data and SQL (rows of the
	 * database) are never kept, also not behind a message that stands in front of them.
	 * @since   0.3.0
	 *
	 * @param   string $text    The answer
	 * @param   int    $length  How many bytes stay at most
	 *
	 * @return  string
	 */
	static function excerpt( $text, $length = 300 ) {

		$text = (string) $text;

		// serialized data holds rows of the database: not even its beginning
		if ( preg_match( '/^[aObsid]:\d+[:;]/', $text ) )
			return '[serialized data]';

		// script and style are no text; every other tag is a gap between words
		$text = preg_replace( '#<(script|style)\b[^>]*>.*?</\1>#is', ' ', $text );
		$text = preg_replace( '/<[^>]*>/', ' ', (string) $text );
		$text = preg_replace( '/[\x00-\x1f\x7f]+/', ' ', (string) $text );
		$text = preg_replace( '/[A-Za-z0-9+\/=_-]{32,}/', '[token]', (string) $text );
		$text = trim( (string) preg_replace( '/\s+/', ' ', (string) $text ) );
		$text = (string) preg_replace( '/ ([:;,.!?])/', '$1', $text );

		// what comes after a message in front of serialized data or SQL is data, not text: rows of the database
		if ( preg_match( '/\b[aO]:\d+:[{"]|\bs:\d+:"|\b(?:INSERT|REPLACE)\s+INTO\b/i', $text, $found, PREG_OFFSET_CAPTURE ) )
			$text = rtrim( substr( $text, 0, $found[0][1] ) ) . ' [data]';

		return self::shorten( $text, $length );
	}

	/**
	 * An address without the user name and the password that can stand in front of the host
	 * @since   0.3.0
	 *
	 * @param   string $url  The address
	 *
	 * @return  string
	 */
	static function strip_credentials( $url ) {
		return (string) preg_replace( '#^([a-z][a-z0-9+.-]*://)[^/@]*@#i', '$1', (string) $url );
	}

	/**
	 * The beginning of a text, with its size when it is cut
	 * @since   0.3.0
	 *
	 * @param   string $text    The text
	 * @param   int    $length  How many bytes stay at most
	 *
	 * @return  string
	 */
	static function shorten( $text, $length ) {

		$text = (string) $text;

		if ( strlen( $text ) <= $length )
			return $text;

		return self::cut( $text, $length ) . '... (' . strlen( $text ) . ' bytes)';
	}

	/**
	 * Cut a text to a number of bytes without breaking a multibyte character
	 * @since   0.3.0
	 *
	 * @param   string $text    The text
	 * @param   int    $length  How many bytes stay at most
	 *
	 * @return  string
	 */
	static function cut( $text, $length ) {

		if ( strlen( $text ) <= $length )
			return $text;

		return function_exists( 'mb_strcut' ) ? mb_strcut( $text, 0, $length, 'UTF-8' ) : substr( $text, 0, $length );
	}

	/**
	 * @since   0.3.0
	 *
	 * @param   array $entry  The entry
	 *
	 * @return  string  One line of JSON; invalid UTF-8 in a text is replaced, never the reason for a lost entry
	 */
	protected static function encode( $entry ) {

		$json = wp_json_encode( $entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR );

		return false === $json ? '{"level":"error","message":"an entry could not be encoded"}' : $json;
	}

	/**
	 * Where the log files are: uploads/sync-pilot/logs/ (the filter "syncpilot_log_dir" can change it). Only the path, the
	 * folder is not made and not checked: reading the log does not need the right to write into the folder (the log is
	 * written by the web server, a command line or another user can read it).
	 * @since   0.3.0
	 *
	 * @return  string  The path without a slash at the end
	 */
	static function path() {

		$upload = wp_upload_dir( null, false );
		$path   = $upload['basedir'] . DS . apply_filters( 'syncpilot_upload_dir_name', 'sync-pilot' ) . DS . 'logs';

		return apply_filters( 'syncpilot_log_dir', $path );
	}

	/**
	 * The folder to write into, made with a rule that denies every request from outside
	 * @since   0.3.0
	 *
	 * @return  string|false  The path without a slash at the end; false when it cannot be made or written
	 */
	static function dir() {

		if ( null !== self::$dir )
			return self::$dir;

		$path = self::path();

		if ( ! is_dir( $path ) && ! @wp_mkdir_p( $path ) )
			return self::$dir = false;

		if ( ! is_writable( $path ) )
			return self::$dir = false;

		self::protect_dir( $path );

		return self::$dir = $path;
	}

	/**
	 * The web server must not hand out the log: no listing, no access, an index.php for the case of neither rule working
	 * @since   0.3.0
	 *
	 * @param   string $path  The folder
	 */
	protected static function protect_dir( $path ) {

		$files = array(
			'.htaccess'  => "# SyncPilot: the log is read in the admin of WordPress only\nOptions -Indexes\n<IfModule mod_authz_core.c>\n\tRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n\tOrder allow,deny\n\tDeny from all\n</IfModule>\n",
			'index.php'  => "<?php\n// Silence is golden\n",
			'web.config' => "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<configuration><system.webServer><authorization><deny users=\"*\" /></authorization></system.webServer></configuration>\n",
		);

		foreach ( $files as $name => $content ) {
			if ( ! file_exists( $path . DS . $name ) )
				@file_put_contents( $path . DS . $name, $content );
		}
	}

	/**
	 * The path of the newest log file. The name is made from the salts of the site, so it cannot be guessed; it is
	 * the same on every request without being stored.
	 * @since   0.3.0
	 *
	 * @return  string
	 */
	static function file_path() {
		return self::path() . DS . 'syncpilot-log-' . substr( wp_hash( 'syncpilot-log' ), 0, 20 ) . '.jsonl';
	}

	/**
	 * The path of the newest log file to write to
	 * @since   0.3.0
	 *
	 * @return  string|false  false when the folder cannot be used
	 */
	static function file() {
		return false === self::dir() ? false : self::file_path();
	}

	/**
	 * Write a line to the file; the file is rotated before it would grow over FILE_MAX_BYTES
	 * @since   0.3.0
	 *
	 * @param   string $line  One entry
	 *
	 * @return  bool  false when it could not be written
	 */
	protected static function append_to_file( $line ) {

		$file = self::file();

		if ( false === $file )
			return false;

		clearstatcache( true, $file );

		if ( file_exists( $file ) && filesize( $file ) + strlen( $line ) + 1 > self::FILE_MAX_BYTES )
			self::rotate( $file );

		return false !== @file_put_contents( $file, $line . "\n", FILE_APPEND | LOCK_EX );
	}

	/**
	 * file -> file.1 -> file.2 ...; the oldest one is dropped
	 * @since   0.3.0
	 *
	 * @param   string $file  The newest log file
	 */
	protected static function rotate( $file ) {

		for ( $i = self::FILES_KEPT - 1; $i >= 1; $i-- ) {

			$from = 1 === $i ? $file : $file . '.' . ( $i - 1 );

			if ( file_exists( $from ) )
				@rename( $from, $file . '.' . $i );
		}
	}

	/**
	 * The entries that could not go to the file: an option, not autoloaded, the newest FALLBACK_BYTES. They are shown
	 * with the log and cleared with it.
	 * @since   0.3.0
	 *
	 * @param   string $line  One entry
	 */
	protected static function append_to_fallback( $line ) {

		$log = (string) get_option( self::FALLBACK_OPTION ) . $line . "\n";

		if ( strlen( $log ) > self::FALLBACK_BYTES ) {

			$log   = substr( $log, -self::FALLBACK_BYTES );
			$break = strpos( $log, "\n" );

			// start at the beginning of an entry, not in the middle of one
			$log = false === $break ? '' : substr( $log, $break + 1 );
		}

		update_option( self::FALLBACK_OPTION, $log, false );
	}

	/**
	 * The entries of the log, the oldest first: the rotated files, the newest file and the entries of the option
	 * @since   0.3.0
	 *
	 * @return  string[]  The lines
	 */
	static function lines() {

		self::import_legacy_log();

		$lines = array();
		$file  = self::file_path();

		for ( $i = self::FILES_KEPT - 1; $i >= 0; $i-- ) {

			$name = 0 === $i ? $file : $file . '.' . $i;

			if ( is_readable( $name ) )
				$lines = array_merge( $lines, file( $name, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES ) ?: array() );
		}

		$fallback = (string) get_option( self::FALLBACK_OPTION );

		if ( '' !== $fallback )
			$lines = array_merge( $lines, array_filter( explode( "\n", $fallback ), 'strlen' ) );

		return $lines;
	}

	/**
	 * The entries of the log, the oldest first, as arrays. A line that is not JSON (a file that was cut or edited) is an
	 * entry with the field raw, so that nothing is lost and the caller never has to parse.
	 * @since   0.3.0
	 *
	 * @return  array[]
	 */
	static function entries() {

		$entries = array();

		foreach ( self::lines() as $line ) {

			$entry     = json_decode( $line, true );
			$entries[] = is_array( $entry ) ? $entry : array( 'raw' => self::shorten( $line, 300 ) );
		}

		return $entries;
	}

	/**
	 * Delete the log: all files, the entries of the option and the log of the older versions
	 * @since   0.3.0
	 */
	static function clear() {

		$file = self::file_path();

		for ( $i = 0; $i < self::FILES_KEPT; $i++ )
			@unlink( 0 === $i ? $file : $file . '.' . $i );

		delete_option( self::FALLBACK_OPTION );
		delete_option( self::LEGACY_OPTION );
	}

	/**
	 * The log of the versions before 0.3.0 was the option syncpilot_error_log (text, not JSON). Its end becomes one entry
	 * of the new log and the option is deleted, once.
	 * @since   0.3.0
	 */
	static function import_legacy_log() {

		$old = get_option( self::LEGACY_OPTION );

		if ( false === $old )
			return;

		delete_option( self::LEGACY_OPTION );

		$old = trim( (string) $old );

		if ( '' === $old )
			return;

		// the end of the old log, as the message of one entry
		self::error( 'Log of an older version of SyncPilot, its end: ' . self::cut( substr( $old, -1500 ), 1500 ) );
	}
}
