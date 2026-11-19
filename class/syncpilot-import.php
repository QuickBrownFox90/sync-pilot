<?php
/**
 * The import of a database dump: the folder the dumps are put in, and what is read from it.
 *
 * A dump (.sql or .sql.gz) gets into the folder by the upload of the page or by hand (SFTP, a local copy), and is run into
 * the temporary tables from there; from then on it is the same migration as a push or a pull. The helpers that need no
 * WordPress state are static, so tests can use them without a migration.
 *
 * @since   0.4.0
 * @author  Patrick Mauersberger
 */
class SyncPilot_Import extends SyncPilot_Base {

	// the folder of the dumps is a folder of the uploads folder of SyncPilot, with a part in its name that cannot be guessed
	// (see path()); the filter "syncpilot_import_dir" can move it
	const FOLDER = 'imports';

	// the longest name of a dump that is accepted
	const NAME_MAX = 150;

	// the files that SyncPilot puts into the folder itself: they are no dumps and are not listed
	const OWN_FILES = array( '.htaccess', 'index.php', 'web.config' );

	// the folder as it was made and checked in this request (false: it cannot be used)
	protected static $dir = null;

	/**
	 * Hooks of the import. Nothing is translated here (see SyncPilot_Base::__construct())
	 * @since   0.4.0
	 *
	 * @param   string $plugin_file_path  The main file of the plugin
	 */
	function __construct( $plugin_file_path ) {

		parent::__construct( $plugin_file_path );

		add_filter( 'syncpilot_nonces', array( $this, 'add_nonces' ) );
		add_action( 'syncpilot_migration_finalized', array( $this, 'finalized' ) );
		add_action( 'syncpilot_diagnostic_info', array( $this, 'output_diagnostic_info' ) );

		// internal AJAX handlers
		add_action( 'wp_ajax_syncpilot_import_list', array( $this, 'ajax_import_list' ) );
		add_action( 'wp_ajax_syncpilot_import_start', array( $this, 'ajax_import_start' ) );
		add_action( 'wp_ajax_syncpilot_import_step', array( $this, 'ajax_import_step' ) );
		add_action( 'wp_ajax_syncpilot_import_cancel', array( $this, 'ajax_import_cancel' ) );
	}

	/**
	 * The nonces of the import for the script of the page
	 * @since   0.4.0
	 *
	 * @param   array $nonces  The nonces of the other parts
	 *
	 * @return  array
	 */
	function add_nonces( $nonces ) {

		$nonces['import_list']   = wp_create_nonce( 'import-list' );
		$nonces['import_start']  = wp_create_nonce( 'import-start' );
		$nonces['import_step']   = wp_create_nonce( 'import-step' );
		$nonces['import_cancel'] = wp_create_nonce( 'import-cancel' );

		return $nonces;
	}

	/**
	 * Where the dumps are: uploads/sync-pilot/imports-<16 characters>/. The characters are made from the salts of the site
	 * (like the name of the log file), so the folder cannot be guessed and is the same on every request without being
	 * stored; a web server that ignores the rule of the folder (nginx) does not give a dump to someone who does not know the
	 * name. The filter "syncpilot_import_dir" can change the whole path, for example to a folder outside of the web root.
	 * Only the path: the folder is not made and not checked.
	 * @since   0.4.0
	 *
	 * @return  string  The path without a slash at the end
	 */
	static function path() {

		$upload = wp_upload_dir( null, false );
		$path   = $upload['basedir'] . DS . apply_filters( 'syncpilot_upload_dir_name', 'sync-pilot' ) . DS . self::FOLDER . '-' . substr( wp_hash( 'syncpilot-imports' ), 0, 16 );

		return untrailingslashit( (string) apply_filters( 'syncpilot_import_dir', $path ) );
	}

	/**
	 * The folder to put dumps into, made with a rule that denies every request from outside: a dump holds the data of a
	 * site, nothing in this folder is handed out by the web server (a dump is read by the import only)
	 * @since   0.4.0
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
	 * Forget the folder that was checked, the next call of dir() looks again (for tests and for a changed filter)
	 * @since   0.4.0
	 */
	static function reset() {
		self::$dir = null;
	}

	/**
	 * No listing, no access from outside, an index.php for the case of neither rule working. A web server that reads none of
	 * the files (nginx) is told in the diagnostics.
	 * @since   0.4.0
	 *
	 * @param   string $path  The folder
	 */
	protected static function protect_dir( $path ) {

		$files = array(
			'.htaccess'  => "# SyncPilot: dumps are read by the import of the plugin only\nOptions -Indexes\n<IfModule mod_authz_core.c>\n\tRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n\tOrder allow,deny\n\tDeny from all\n</IfModule>\n",
			'index.php'  => "<?php\n// Silence is golden\n",
			'web.config' => "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<configuration><system.webServer><authorization><deny users=\"*\" /></authorization></system.webServer></configuration>\n",
		);

		foreach ( $files as $name => $content ) {
			if ( ! file_exists( $path . DS . $name ) )
				@file_put_contents( $path . DS . $name, $content );
		}
	}

	/**
	 * Whether a name is the name of a dump that the import accepts: .sql or .sql.gz, no folder in it, no second extension that a server runs, no name that starts with
	 * a dot, only letters, digits, space and . _ ( ) -
	 * @since   0.4.0
	 *
	 * @param   mixed $name  The name of the file
	 *
	 * @return  bool
	 */
	static function is_valid_name( $name ) {

		if ( ! is_string( $name ) || '' === $name || strlen( $name ) > self::NAME_MAX )
			return false;

		if ( false !== strpos( $name, '..' ) )
			return false;

		// a second extension that a web server may run (dump.php.sql): the name is not a dump, whatever the folder denies
		if ( 1 === preg_match( '/\.(php\d?|phtml|phar|pht|phps|cgi|pl|py|asp|aspx|jsp|sh|exe)(\.|$)/i', $name ) )
			return false;

		return 1 === preg_match( '/^[A-Za-z0-9][A-Za-z0-9 ._()-]*\.sql(\.gz)?$/i', $name );
	}

	/**
	 * Whether a name is the name of a gzip file
	 * @since   0.4.0
	 *
	 * @param   string $name  The name of the file
	 *
	 * @return  bool
	 */
	static function is_gzip_name( $name ) {
		return '.gz' === strtolower( substr( $name, -3 ) );
	}

	/**
	 * Whether a file is a gzip file, by its content
	 * @since   0.4.0
	 *
	 * @param   string $file  The path
	 *
	 * @return  bool
	 */
	static function is_gzip_file( $file ) {
		return "\x1f\x8b" === (string) @file_get_contents( $file, false, null, 0, 2 );
	}

	/**
	 * The files of the folder, the newest first. A file that cannot be used is in the list with the reason, so the page can
	 * say why a file that was put there is not offered: name (the name is not accepted), extension (not .sql or .sql.gz),
	 * symlink (a link is never followed), unreadable, empty. Folders and the files of SyncPilot are not listed.
	 * @since   0.4.0
	 *
	 * @return  array  Per file: name, bytes, modified (time), gzip, usable, reason ('' when it is usable)
	 */
	static function files() {

		$path  = self::path();
		$files = array();

		if ( ! is_dir( $path ) || false === ( $names = @scandir( $path ) ) )
			return $files;

		foreach ( $names as $name ) {

			if ( '.' === $name || '..' === $name || in_array( $name, self::OWN_FILES, true ) )
				continue;

			$file = $path . DS . $name;

			// a link is listed (and refused), a folder is not
			if ( ! is_link( $file ) && ! is_file( $file ) )
				continue;

			$reason = '';

			if ( is_link( $file ) )
				$reason = 'symlink';

			elseif ( ! preg_match( '/\.sql(\.gz)?$/i', $name ) )
				$reason = 'extension';

			elseif ( ! self::is_valid_name( $name ) )
				$reason = 'name';

			elseif ( ! is_readable( $file ) )
				$reason = 'unreadable';

			elseif ( 0 === filesize( $file ) )
				$reason = 'empty';

			$files[] = array(
				'name'     => $name,
				'bytes'    => (int) @filesize( $file ),
				'modified' => (int) @filemtime( $file ),
				'gzip'     => self::is_gzip_name( $name ),
				'usable'   => '' === $reason,
				'reason'   => $reason,
			);
		}

		usort( $files, fn( $a, $b ) => array( $b['modified'], $a['name'] ) <=> array( $a['modified'], $b['name'] ) );

		return $files;
	}

	/**
	 * The path of a dump of the folder. Whatever comes from the browser goes through here: the name must be valid, the file
	 * must be a file of the folder itself (no link, no folder in between) and readable.
	 * @since   0.4.0
	 *
	 * @param   mixed $name  The name of the file
	 *
	 * @return  string|false  The path; false when it is no dump of the folder
	 */
	static function resolve( $name ) {

		if ( ! self::is_valid_name( $name ) )
			return false;

		$folder = realpath( self::path() );
		$file   = self::path() . DS . $name;

		if ( false === $folder || is_link( $file ) || ! is_file( $file ) || ! is_readable( $file ) )
			return false;

		$real = realpath( $file );

		if ( false === $real || dirname( $real ) !== $folder )
			return false;

		return $file;
	}

	/**
	 * Remove a dump of the folder
	 * @since   0.4.0
	 *
	 * @param   mixed $name  The name of the file
	 *
	 * @return  bool  false when it is no dump of the folder or could not be removed
	 */
	static function delete( $name ) {

		$file = self::resolve( $name );

		return false !== $file && @unlink( $file );
	}

	/**
	 * The statement with everything replaced that is not code: the text of a string becomes '', the name between backticks
	 * becomes ``, a comment becomes a space (a comment that a server of some version runs, /*!50100 ... *\/, stays: it is
	 * code). What is looked for in a statement (SELECT, a variable) is looked for in this text, so that a word in a post
	 * or in the name of a column is no word of the statement. It is made with a loop like the reader's, not with a
	 * pattern: a pattern for a string of a megabyte runs into the limits of PCRE.
	 * @since   0.4.0
	 *
	 * @param   string $sql  A statement
	 *
	 * @return  string
	 */
	static function mask_literals( $sql ) {

		$out = '';
		$i   = 0;
		$len = strlen( $sql );

		while ( $i < $len ) {

			$n    = strcspn( $sql, "'\"`#-/", $i );
			$out .= substr( $sql, $i, $n );
			$i   += $n;

			if ( $i >= $len )
				break;

			$c = $sql[ $i ];

			if ( "'" === $c || '"' === $c || '`' === $c ) {

				$i++;

				while ( $i < $len ) {

					$i += strcspn( $sql, '`' === $c ? '`' : $c . '\\', $i );

					if ( $i >= $len )
						break;

					if ( '\\' === $sql[ $i ] ) {
						$i += 2;

						continue;
					}

					if ( ( $sql[ $i + 1 ] ?? '' ) === $c ) {
						$i += 2;

						continue;
					}

					$i++;

					break;
				}

				$out .= '`' === $c ? '``' : "''";
			}

			elseif ( '#' === $c || ( '-' === $c && '-' === ( $sql[ $i + 1 ] ?? '' ) && ( $i + 2 >= $len || ctype_space( $sql[ $i + 2 ] ) ) ) ) {

				$newline = strpos( $sql, "\n", $i );
				$i       = false === $newline ? $len : $newline + 1;
				$out    .= ' ';
			}

			elseif ( '/' === $c && '*' === ( $sql[ $i + 1 ] ?? '' ) ) {

				$close = strpos( $sql, '*/', $i + 2 );
				$end   = false === $close ? $len : $close + 2;

				// the comment that a server runs is code, the others are not
				$out .= preg_match( '/^\/\*M?!/', substr( $sql, $i, 4 ) ) ? substr( $sql, $i, $end - $i ) : ' ';
				$i    = $end;
			}

			else {
				$out .= $c;
				$i++;
			}
		}

		return $out;
	}

	/**
	 * What the import does with a statement of a dump. Only what a dump of a WordPress site is made of is run: DROP TABLE,
	 * CREATE TABLE, INSERT, and the SET of the session (the character set, the checks, the time zone). The statements that
	 * only make the import fast or safe in the program that made the dump (LOCK TABLES, transactions, DISABLE KEYS, USE)
	 * are skipped (a dump of MariaDB sets AUTOCOMMIT=0 around every table: what is not committed when a request ends is gone, so the
	 * import commits every query). Everything else is refused, whatever it is: UPDATE, DELETE, TRUNCATE, GRANT, a trigger, a view, SELECT
	 * INTO OUTFILE, LOAD DATA... A table in a statement is a plain name of this database, never db.name; no INSERT and no
	 * CREATE TABLE may have a SELECT in it, and no CREATE TABLE a reference to another table or a file name.
	 * @since   0.4.0
	 *
	 * @param   string $sql  The statement as the reader gives it
	 *
	 * @return  array  action: run, skip or reject; kind: drop_table, create_table, insert, set, or for a refusal the words
	 *                 that begin the statement (DROP DATABASE); table, name_at and name_len for a statement with a table
	 *                 (the table, and where its name is in the statement, with the backticks, for with_table()); reason for
	 *                 a refusal: form, select, reference, file, qualified, variable, unknown; for a CREATE TABLE
	 *                 collations and charsets (see used_collations())
	 */
	static function classify( $sql ) {

		$head = substr( $sql, 0, 65536 );
		$ident = '(?<tok>`(?<q>(?:[^`]|``)+)`|(?<u>[A-Za-z0-9_$]+))(?!\s*\.)';

		if ( ! preg_match( '/^([A-Za-z]+)\b/', $head, $m ) )
			return self::refusal( $sql, 'unknown' );

		$word  = strtoupper( $m[1] );
		$table = function ( $found ) {

			$name = '' !== ( $found['q'][0] ?? '' ) ? str_replace( '``', '`', $found['q'][0] ) : $found['u'][0];

			return array( 'table' => $name, 'name_at' => $found['tok'][1], 'name_len' => strlen( $found['tok'][0] ) );
		};

		switch ( $word ) {

			case 'DROP':

				if ( preg_match( '/^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?' . $ident . '\s*$/i', $head, $found, PREG_OFFSET_CAPTURE ) )
					return array( 'action' => 'run', 'kind' => 'drop_table' ) + $table( $found );

				return self::refusal( $sql, preg_match( '/^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`\w$]+\s*\./i', $head ) ? 'qualified' : 'form' );

			case 'CREATE':

				if ( preg_match( '/^CREATE\s+(?:DATABASE|SCHEMA)\b/i', $head ) )
					return array( 'action' => 'skip', 'kind' => 'create_database' );

				if ( ! preg_match( '/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?' . $ident . '\s*\(/i', $head, $found, PREG_OFFSET_CAPTURE ) )
					return self::refusal( $sql, preg_match( '/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`\w$]+\s*\./i', $head ) ? 'qualified' : 'form' );

				$masked = self::mask_literals( $sql );

				if ( preg_match( '/\bSELECT\b/i', $masked ) )
					return self::refusal( $sql, 'select' );

				if ( preg_match( '/\bREFERENCES\b/i', $masked ) )
					return self::refusal( $sql, 'reference' );

				if ( preg_match( '/\b(?:DATA|INDEX)\s+DIRECTORY\b|\bCONNECTION\s*=/i', $masked ) )
					return self::refusal( $sql, 'file' );

				return array( 'action' => 'run', 'kind' => 'create_table' ) + $table( $found ) + self::used_collations( $masked );

			case 'INSERT':

				if ( ! preg_match( '/^INSERT\s+(?:IGNORE\s+)?INTO\s+' . $ident . '\s*(?:\((?>\s*(?:`(?:[^`]|``)+`|[A-Za-z0-9_$]+)\s*,?)*\)\s*)?VALUES?\s*\(/i', $head, $found, PREG_OFFSET_CAPTURE ) )
					return self::refusal( $sql, preg_match( '/^INSERT\s+(?:IGNORE\s+)?INTO\s+[`\w$]+\s*\./i', $head ) ? 'qualified' : 'form' );

				// "select" is in many posts: only a statement that has the word at all is looked at closely
				if ( false !== stripos( $sql, 'select' ) && preg_match( '/\bSELECT\b/i', self::mask_literals( $sql ) ) )
					return self::refusal( $sql, 'select' );

				return array( 'action' => 'run', 'kind' => 'insert' ) + $table( $found );

			case 'SET':

				return self::classify_set( $sql );

			case 'LOCK':
			case 'UNLOCK':
			case 'BEGIN':
			case 'COMMIT':
			case 'USE':

				return array( 'action' => 'skip', 'kind' => strtolower( $word ) );

			case 'START':

				return preg_match( '/^START\s+TRANSACTION\s*$/i', $head ) ? array( 'action' => 'skip', 'kind' => 'transaction' ) : self::refusal( $sql, 'form' );

			case 'ALTER':

				if ( preg_match( '/^ALTER\s+TABLE\s+(?:`(?:[^`]|``)+`|[A-Za-z0-9_$]+)\s+(?:DISABLE|ENABLE)\s+KEYS\s*$/i', $head ) )
					return array( 'action' => 'skip', 'kind' => 'keys' );

				return self::refusal( $sql, 'form' );
		}

		return self::refusal( $sql, 'unknown' );
	}

	/**
	 * What the import does with a SET statement. The set is run when every variable in it is one that a dump sets for the
	 * session; the settings that are made for the server (GLOBAL, the binary log) are skipped; anything else is refused.
	 * The filter "syncpilot_import_allowed_variables" adds variables.
	 * @since   0.4.0
	 *
	 * @param   string $sql  The statement, it begins with SET
	 *
	 * @return  array  The answer of classify(); vars are the variables that the statement sets (a user variable with its @)
	 */
	protected static function classify_set( $sql ) {

		$allowed = apply_filters( 'syncpilot_import_allowed_variables', array(
			'character_set_client', 'character_set_connection', 'character_set_results', 'character_set_database', 'character_set_server',
			'collation_connection', 'collation_database', 'collation_server', 'foreign_key_checks', 'unique_checks', 'sql_mode', 'time_zone',
			'autocommit', 'sql_notes', 'note_verbosity', 'sql_quote_show_create', 'sql_auto_is_null',
		) );

		$masked = trim( substr( self::mask_literals( $sql ), 3 ) );

		if ( preg_match( '/^NAMES\s+\w+(?:\s+COLLATE\s+\w+)?$/i', $masked ) || preg_match( '/^NAMES\s+\'\'(?:\s+COLLATE\s+\'\')?$/i', $masked ) )
			return array( 'action' => 'run', 'kind' => 'set', 'vars' => array( 'character_set_client', 'character_set_connection', 'character_set_results', 'collation_connection' ) );

		// the settings of the server: not run, whatever follows (the value of GTID_PURGED has a comment in it)
		if ( preg_match( '/^(?:GLOBAL|PERSIST)\s|^@@(?:GLOBAL|PERSIST)\./i', $masked ) )
			return array( 'action' => 'skip', 'kind' => 'set' );

		if ( preg_match( '/\bSELECT\b|\(/i', $masked ) )
			return self::refusal( $sql, 'select' );

		$skip = false;
		$vars = array();

		foreach ( explode( ',', $masked ) as $assignment ) {

			if ( ! preg_match( '/^\s*(?:(GLOBAL|SESSION|LOCAL|PERSIST)\s+)?(@@(?:(global|session|local|persist)\.)?)?(@?[A-Za-z_]\w*)\s*:?=\s*[\w@.\s\'+-]*$/is', $assignment, $m ) ) {

				// the second part of "sql_mode='A,B'" is a literal that is masked, so a part that does not read as an assignment is none
				return self::refusal( $sql, 'variable' );
			}

			$scope    = strtolower( $m[1] ?: ( $m[3] ?? '' ) );
			$variable = strtolower( $m[4] );
			$user     = '@' === $variable[0] && '' === $m[2] && '' === $m[1];

			// the dump wraps a table in SET AUTOCOMMIT=0 ... COMMIT: every query is its own transaction here (the next request has a
			// new connection, what was not committed would be gone), so the whole statement is skipped, and the one that sets it back
			if ( in_array( $scope, array( 'global', 'persist' ), true ) || 'sql_log_bin' === $variable || 'autocommit' === $variable ) {
				$skip = true;

				continue;
			}

			if ( ! $user && ! in_array( $variable, $allowed, true ) )
				return self::refusal( $sql, 'variable' );

			$vars[] = $variable;
		}

		return array( 'action' => $skip ? 'skip' : 'run', 'kind' => 'set', 'vars' => $vars );
	}

	/**
	 * The answer of classify() for a statement that is refused
	 * @since   0.4.0
	 *
	 * @param   string $sql     The statement
	 * @param   string $reason  Why: form, select, reference, file, qualified, variable or unknown
	 *
	 * @return  array  action reject, kind (the first word of the statement in capitals, and the second when it is a word of SQL,
	 *                 never a name: a statement can hold values) and reason
	 */
	protected static function refusal( $sql, $reason ) {

		preg_match( '/^([A-Za-z]+)(?:\s+([A-Za-z]+))?/', $sql, $m );

		$first  = strtoupper( $m[1] ?? '' );
		$second = strtoupper( $m[2] ?? '' );

		// the second word only when it is a word of SQL: it can be the name of a table
		$words = array( 'TABLE', 'TABLES', 'DATABASE', 'SCHEMA', 'TRIGGER', 'VIEW', 'PROCEDURE', 'FUNCTION', 'EVENT', 'INDEX', 'USER', 'ROLE', 'INTO', 'DATA', 'FROM', 'TEMPORARY', 'ALGORITHM', 'DEFINER', 'OR', 'UNIQUE', 'FULLTEXT' );
		$kind  = in_array( $second, $words, true ) ? $first . ' ' . $second : $first;

		return array( 'action' => 'reject', 'kind' => '' === $kind ? 'UNKNOWN' : substr( $kind, 0, 30 ), 'reason' => $reason );
	}

	/**
	 * The statement with another name for its table (the temporary prefix is put before the name this way)
	 * @since   0.4.0
	 *
	 * @param   string $sql   The statement
	 * @param   array  $info  The answer of classify() for it
	 * @param   string $name  The new name of the table
	 *
	 * @return  string
	 */
	static function with_table( $sql, $info, $name ) {
		return substr_replace( $sql, '`' . str_replace( '`', '``', $name ) . '`', $info['name_at'], $info['name_len'] );
	}

	/**
	 * The collations and character sets that a CREATE TABLE names
	 * @since   0.4.0
	 *
	 * @param   string $masked  The statement after mask_literals()
	 *
	 * @return  array  collations and charsets: the names in small letters, each once
	 */
	static function used_collations( $masked ) {

		preg_match_all( '/\bCOLLATE\s*=?\s*([A-Za-z0-9_]+)/i', $masked, $collations );
		preg_match_all( '/\b(?:CHARACTER\s+SET|CHARSET)\s*=?\s*([A-Za-z0-9_]+)/i', $masked, $charsets );

		return array(
			'collations' => array_values( array_unique( array_map( 'strtolower', $collations[1] ) ) ),
			'charsets'   => array_values( array_unique( array_map( 'strtolower', $charsets[1] ) ) ),
		);
	}

	/**
	 * Which of the collations and character sets of a dump this database does not know. A dump of MySQL 8 has
	 * utf8mb4_0900_ai_ci, which MariaDB and MySQL 5.7 do not have: every CREATE TABLE with it would fail, so it is found
	 * before the first table is made.
	 * @since   0.4.0
	 *
	 * @param   array $used  collations and charsets as used_collations() gives them
	 *
	 * @return  array  collations and charsets that are not known
	 */
	static function unsupported_collations( $used ) {

		$known = self::known_collations();

		return array(
			'collations' => array_values( array_diff( $used['collations'] ?? array(), $known['collations'] ) ),
			'charsets'   => array_values( array_diff( $used['charsets'] ?? array(), $known['charsets'] ) ),
		);
	}

	/**
	 * A collation that this database knows and that is the nearest to one that it does not know. A dump of MariaDB 11 has
	 * utf8mb4_uca1400_ai_ci, a dump of MySQL 8 utf8mb4_0900_ai_ci: an older MariaDB or MySQL 5.7 does not know them. A binary
	 * collation stays binary; the others become the collation that WordPress uses for utf8mb4 (utf8mb4_unicode_520_ci), or the
	 * next one of its kind. utf8mb3 and utf8 are the same character set under two names.
	 * @since   0.4.0
	 *
	 * @param   string $name        The collation of the dump
	 * @param   array  $collations  The collations that this database knows, in small letters
	 *
	 * @return  string|null  null when there is no collation that fits (the character set is not known either)
	 */
	static function map_collation( $name, $collations ) {

		$name = strtolower( $name );

		if ( false === ( $cut = strpos( $name, '_' ) ) )
			return null;

		$charset = substr( $name, 0, $cut );
		$rest    = substr( $name, $cut + 1 );

		// the same character set under its other name
		foreach ( array( 'utf8mb3' => 'utf8', 'utf8' => 'utf8mb3' ) as $from => $to ) {

			if ( $charset === $from && in_array( $to . '_' . $rest, $collations, true ) )
				return $to . '_' . $rest;
		}

		if ( '_bin' === substr( $name, -4 ) && in_array( $charset . '_bin', $collations, true ) )
			return $charset . '_bin';

		$candidates = array( $charset . '_unicode_520_ci', $charset . '_unicode_ci', $charset . '_general_ci' );

		// utf8mb3 is called utf8 by the other server
		if ( 'utf8mb3' === $charset )
			$candidates = array_merge( $candidates, array( 'utf8_unicode_520_ci', 'utf8_unicode_ci', 'utf8_general_ci' ) );

		foreach ( $candidates as $candidate ) {

			if ( in_array( $candidate, $collations, true ) )
				return $candidate;
		}

		return null;
	}

	/**
	 * The character set of a dump that this database does not know, under the name that it knows (utf8mb3 and utf8)
	 * @since   0.4.0
	 *
	 * @param   string $name      The character set of the dump
	 * @param   array  $charsets  The character sets that this database knows, in small letters
	 *
	 * @return  string|null
	 */
	static function map_charset( $name, $charsets ) {

		$other = array( 'utf8mb3' => 'utf8', 'utf8' => 'utf8mb3' )[ strtolower( $name ) ] ?? null;

		return null !== $other && in_array( $other, $charsets, true ) ? $other : null;
	}

	/**
	 * The collations and character sets that this database knows
	 * @since   0.4.0
	 *
	 * @return  array  collations and charsets, in small letters
	 */
	static function known_collations() {

		global $wpdb;

		return array(
			'collations' => array_map( 'strtolower', (array) $wpdb->get_col( 'SELECT COLLATION_NAME FROM information_schema.COLLATIONS' ) ),
			'charsets'   => array_map( 'strtolower', (array) $wpdb->get_col( 'SELECT CHARACTER_SET_NAME FROM information_schema.CHARACTER_SETS' ) ),
		);
	}

	/**
	 * The statement with the collations and character sets that were mapped (see map_collation()) in place of the ones of
	 * the dump. Only the names that are in the map are touched, behind COLLATE, COLLATE=, CHARSET= and CHARACTER SET.
	 * @since   0.4.0
	 *
	 * @param   string $sql      A CREATE TABLE statement
	 * @param   array  $map      collations and charsets: name of the dump => name that this database knows
	 *
	 * @return  string
	 */
	static function apply_collation_map( $sql, $map ) {

		foreach ( $map['collations'] ?? array() as $from => $to )
			$sql = preg_replace( '/\b(COLLATE\s*=?\s*)' . preg_quote( $from, '/' ) . '\b/i', '${1}' . $to, $sql );

		foreach ( $map['charsets'] ?? array() as $from => $to )
			$sql = preg_replace( '/\b((?:CHARACTER\s+SET|CHARSET)\s*=?\s*)' . preg_quote( $from, '/' ) . '\b/i', '${1}' . $to, $sql );

		return $sql;
	}

	/**
	 * Whether the web server hands out a file of the folder. A harmless file with a random content is put there, asked for
	 * by its address and removed; the folder is closed when the answer is not that file. The rule of the folder works with
	 * Apache; nginx ignores it and needs a rule of its own (deny the folder).
	 * @since   0.4.0
	 *
	 * @return  bool|null  true: the file was handed out; false: it was not; null: not known (the folder is outside of the
	 *                     uploads folder and has no address, it cannot be written, or the request failed)
	 */
	static function is_reachable() {

		$upload = wp_upload_dir( null, false );
		$base   = wp_normalize_path( $upload['basedir'] ) . '/';
		$path   = wp_normalize_path( self::path() ) . '/';

		if ( 0 !== strpos( $path, $base ) || false === ( $dir = self::dir() ) )
			return null;

		$name    = 'probe-' . bin2hex( random_bytes( 6 ) ) . '.txt';
		$content = bin2hex( random_bytes( 16 ) );
		$file    = $dir . DS . $name;

		if ( false === @file_put_contents( $file, $content ) )
			return null;

		$response = wp_remote_get( trailingslashit( $upload['baseurl'] ) . substr( $path, strlen( $base ) ) . $name, array(
			'timeout'     => 5,
			'redirection' => 0,
			'sslverify'   => apply_filters( 'https_local_ssl_verify', false ),
		) );

		@unlink( $file );

		if ( is_wp_error( $response ) )
			return null;

		return 200 === wp_remote_retrieve_response_code( $response ) && $content === wp_remote_retrieve_body( $response );
	}

	/**
	 * The lines of the diagnostic info of this site: the folder of the dumps, and whether the web server hands out its files
	 * @since   0.4.0
	 */
	function output_diagnostic_info() {

		$reachable = self::is_reachable();

		echo 'Import Folder: ';
		echo esc_html( self::path() );
		echo "\r\n";

		echo 'Import Folder Reachable: ';

		if ( true === $reachable )
			echo 'YES - the web server hands out files of this folder, deny the access to it (nginx: location ~ /imports-)';

		elseif ( false === $reachable )
			echo 'No';

		else
			echo 'Unknown';

		echo "\r\n";
	}

	/**
	 * The size of the text of a dump when it is read: the size of a plain file; for a gzip file the size that the file
	 * says at its end (the last four bytes, what a dump of more than 4 GB cannot hold, so it is never less than the file)
	 * @since   0.4.0
	 *
	 * @param   string $file  The path of the dump
	 *
	 * @return  int
	 */
	static function text_size( $file ) {

		$size = (int) @filesize( $file );

		// the content decides, as in the reader
		if ( "\x1f\x8b" !== (string) @file_get_contents( $file, false, null, 0, 2 ) )
			return $size;

		if ( false === ( $handle = @fopen( $file, 'rb' ) ) )
			return $size;

		fseek( $handle, -4, SEEK_END );

		$tail = (string) fread( $handle, 4 );

		fclose( $handle );

		return 4 === strlen( $tail ) ? max( $size, (int) unpack( 'V', $tail )[1] ) : $size;
	}

	/**
	 * The size of the text that a gzip file says at its end (the last four bytes, the size modulo 4 GB)
	 * @since   0.4.0
	 *
	 * @param   string $file  The path of the gzip file
	 *
	 * @return  int|null  null when it cannot be read
	 */
	static function gzip_trailer( $file ) {

		if ( false === ( $handle = @fopen( $file, 'rb' ) ) )
			return null;

		fseek( $handle, -4, SEEK_END );

		$tail = (string) fread( $handle, 4 );

		fclose( $handle );

		return 4 === strlen( $tail ) ? (int) unpack( 'V', $tail )[1] : null;
	}

	/**
	 * The prefix of the tables of a dump: what stands before "options" in the shortest name of a table that ends with it
	 * (wp_options of a site, wp_2_options of a site of a multisite)
	 * @since   0.4.0
	 *
	 * @param   array $tables  The names of the tables
	 *
	 * @return  string  Empty when the dump has no options table
	 */
	static function detect_prefix( $tables ) {

		$found = '';

		foreach ( $tables as $table ) {

			if ( ! preg_match( '/^(.*)options$/', $table, $m ) || '' === $m[1] )
				continue;

			if ( '' === $found || strlen( $m[1] ) < strlen( $found ) )
				$found = $m[1];
		}

		return $found;
	}

	/**
	 * The seconds that one request works at the dump, then it answers and the browser asks again
	 * @since   0.4.0
	 *
	 * @return  float
	 */
	static function step_seconds() {
		return (float) apply_filters( 'syncpilot_import_step_seconds', 10 );
	}

	/**
	 * The file of the state of an import: what the next request needs to go on where this one stopped. It is in the folder
	 * of the log (closed to the web server); a transient is the fallback when the folder cannot be written.
	 * @since   0.4.0
	 *
	 * @return  string|false  The path; false when there is no ID of a migration or the folder cannot be written
	 */
	protected static function state_file() {

		$id  = SyncPilot_Logger::migration_id();
		$dir = SyncPilot_Logger::dir();

		return '' !== $id && $dir ? $dir . DS . 'import-' . $id . '.json' : false;
	}

	/**
	 * The state of the import of this request
	 * @since   0.4.0
	 *
	 * @return  array|null  null when there is none
	 */
	static function state_read() {

		$id   = SyncPilot_Logger::migration_id();
		$file = self::state_file();
		$data = false;

		if ( '' === $id )
			return null;

		if ( $file && is_file( $file ) )
			$data = json_decode( (string) @file_get_contents( $file ), true );

		else
			$data = get_transient( 'syncpilot_import_' . $id );

		return is_array( $data ) ? $data : null;
	}

	/**
	 * Keep the state of the import of this request
	 * @since   0.4.0
	 *
	 * @param   array $state  The state
	 */
	static function state_write( $state ) {

		$file = self::state_file();

		if ( $file && false !== @file_put_contents( $file, wp_json_encode( $state ), LOCK_EX ) )
			return;

		set_transient( 'syncpilot_import_' . SyncPilot_Logger::migration_id(), $state, DAY_IN_SECONDS );
	}

	/**
	 * Remove the state of the import of this request
	 * @since   0.4.0
	 */
	static function state_remove() {

		$state = self::state_read();

		// the unpacked copy of a gzip dump is not needed any more
		if ( ! empty( $state['work'] ) && is_file( $state['work'] ) )
			@unlink( $state['work'] );

		$file = self::state_file();

		if ( $file && is_file( $file ) )
			@unlink( $file );

		delete_transient( 'syncpilot_import_' . SyncPilot_Logger::migration_id() );
	}

	/**
	 * The states of imports that never ended (the browser was closed) are removed after a week
	 * @since   0.4.0
	 */
	protected static function state_remove_old() {

		$dir = SyncPilot_Logger::dir();

		if ( ! $dir )
			return;

		foreach ( (array) glob( $dir . DS . 'import-*.json' ) as $file ) {

			if ( filemtime( $file ) < time() - WEEK_IN_SECONDS )
				@unlink( $file );
		}
	}

	/**
	 * The answer of an import request when it cannot go on: the browser shows the text
	 * @since   0.4.0
	 *
	 * @param   string $text  The reason
	 *
	 * @return  string|void  The answer (only in tests)
	 */
	protected function import_error( $text ) {

		$result = $this->end_ajax( json_encode( array( 'syncpilot_error' => 1, 'body' => $text ) ) );

		return $result;
	}

	/**
	 * The import stops here: the temporary tables go, the state goes, the log has the end of the migration as "stopped"
	 * (nothing of this site was changed) and the browser gets the reason
	 * @since   0.4.0
	 *
	 * @param   string $text  The reason
	 *
	 * @return  string|void  The answer (only in tests)
	 */
	protected function import_stop( $text ) {

		global $syncpilot;

		$state = self::state_read();

		if ( ! empty( $state['loading'] ) )
			$syncpilot->delete_temporary_tables( $this->temp_prefix );

		self::state_remove();

		SyncPilot_Logger::close_migration( 'stopped', array( 'intent' => 'import' ) );

		return $this->import_error( $text );
	}

	/**
	 * Start the import of a dump of the folder: the ID of the migration is made, the state is begun, and the file is
	 * checked as far as it can be without reading it. Reading it (scan, then load) is done by ajax_import_step().
	 * @since   0.4.0
	 *
	 * @return  string|void  The answer as JSON (only in tests, otherwise the request ends here)
	 */
	function ajax_import_start() {

		global $wpdb;

		$this->check_ajax_referer( 'import-start' );

		$file = self::resolve( wp_unslash( $_POST['file'] ?? '' ) );

		if ( false === $file ) {

			$this->log_error( SyncPilot_HelpCode::ImportFileInvalid, array( 'name_bytes' => strlen( (string) ( $_POST['file'] ?? '' ) ) ), site: 1 );

			return $this->import_error( __( 'This file is not a dump in the folder for dumps. (#301)', self::TEXT_DOMAIN ) );
		}

		SyncPilot_Logger::set_migration_id( SyncPilot_Logger::new_migration_id() );
		SyncPilot_Logger::tally( array(), true );
		self::state_remove_old();

		$size = (int) filesize( $file );
		$text = self::text_size( $file );
		$gzip = self::is_gzip_file( $file );
		$work = $gzip ? $this->import_work_file( $text ) : '';

		SyncPilot_Logger::event( 'Migration started', array(
			'intent'      => 'import',
			'scope'       => array(
				'file_bytes'   => $size,
				'text_bytes'   => $text,
				'gzip'         => $gzip,
				'unpack'       => '' !== $work,
				'other_prefix' => ! empty( $_POST['other_prefix'] ),
				'strict_collations' => ! empty( $_POST['strict_collations'] ),
				'replace_rows' => count( array_filter( (array) ( $this->import_form( (string) ( $_POST['form_data'] ?? '' ) )['replace_old'] ?? array() ), 'strlen' ) ),
			),
			'environment' => SyncPilot_Logger::environment(),
		) );

		self::state_write( array(
			'file'         => basename( $file ),
			'work'         => $work,
			'unpacked'     => 0,
			'gz_text'      => $gzip ? self::gzip_trailer( $file ) : null,
			'phase'        => '' !== $work ? 'unpack' : 'scan',
			'offset'       => 0,
			'total'        => $text,
			'form_data'    => (string) ( $_POST['form_data'] ?? '' ),
			'other_prefix' => ! empty( $_POST['other_prefix'] ),
			'strict_collations' => ! empty( $_POST['strict_collations'] ),
			'started'      => time(),
			'statements'   => 0,
			'tables'       => array(),
			'collations'   => array(),
			'charsets'     => array(),
			'session_vars' => array(),
			'session'      => array(),
			'loading'      => false,
			'seconds'      => array( 'unpack' => 0, 'scan' => 0, 'load' => 0, 'replace' => 0 ),
		) );

		global $syncpilot;

		$answer = array(
			'migration_id' => SyncPilot_Logger::migration_id(),
			'phase'        => '' !== $work ? 'unpack' : 'scan',
			'total'        => $text,
			'prefix'       => $wpdb->prefix,
			'temp_prefix'  => $this->temp_prefix,
			'bottleneck'   => $syncpilot->get_bottleneck(),
		);

		// the backup of the tables that the import replaces: the file is named now, the browser writes it table by table
		if ( ! empty( $this->import_form( (string) ( $_POST['form_data'] ?? '' ) )['create_backup'] ) ) {

			$syncpilot->process_chunk( $syncpilot->get_create_alter_table_query() );

			$answer['dump_filename'] = substr( basename( $syncpilot->get_sql_dump_info( 'backup', 'path' ) ), 0, -4 );
			$answer['dump_url']      = $syncpilot->get_sql_dump_info( 'backup', 'url' );
		}

		$result = $this->end_ajax( json_encode( $answer ) );

		return $result;
	}

	/**
	 * One request of the import: the dump is read for as long as step_seconds() says, then the answer tells the browser
	 * where it is and whether to ask again. The phases: scan (nothing is written: every statement is checked, the tables
	 * and their collations are listed), scanned (the browser has the list of the tables, for the backup; the next request
	 * begins the loading), load (the tables are made and filled under the temporary prefix), loaded.
	 * @since   0.4.0
	 *
	 * @return  string|void  The answer as JSON (only in tests, otherwise the request ends here)
	 */
	function ajax_import_step() {

		$this->check_ajax_referer( 'import-step' );

		$state = self::state_read();

		if ( null === $state || false === ( $file = self::resolve( $state['file'] ?? '' ) ) ) {

			$this->log_error( SyncPilot_HelpCode::ImportStateLost, array(), site: 1 );

			return $this->import_error( __( 'The import cannot go on: what it knows about the file is gone. Start it again. (#306)', self::TEXT_DOMAIN ) );
		}

		// the browser asks again after the end: the answer is the same
		if ( 'replaced' === $state['phase'] )
			return $this->end_ajax( json_encode( $this->import_progress( $state ) ) );

		if ( 'scanned' === $state['phase'] )
			$state = $this->import_begin_load( $state );

		elseif ( 'loaded' === $state['phase'] )
			$state = $this->import_begin_replace( $state );

		if ( ! is_array( $state ) )
			return $state;

		$this->set_time_limit();

		$started = microtime( true );
		$phase   = $state['phase'];

		if ( 'unpack' === $phase )
			$stopped = $this->import_unpack( $state, $file, $started );

		elseif ( 'replace' === $phase )
			$stopped = $this->import_replace( $state, $started );

		else {

			// the unpacked copy of a gzip dump, or the dump itself
			$reader  = new SyncPilot_Dump_Reader( ! empty( $state['work'] ) && is_file( $state['work'] ) ? $state['work'] : $file, $state['offset'] );
			$stopped = 'scan' === $phase ? $this->import_scan( $state, $reader, $started ) : $this->import_load( $state, $reader, $started );
		}

		if ( null !== $stopped )
			return $stopped;

		$state['seconds'][ $phase ] += microtime( true ) - $started;

		if ( 'verbose' === SyncPilot_Logger::level() ) {

			SyncPilot_Logger::info( 'Import step', array(
				'phase'             => $phase,
				'offset'            => $state['offset'],
				'statements'        => $state['statements'],
				'duration_ms'       => (int) round( ( microtime( true ) - $started ) * 1000 ),
				'memory_peak_bytes' => memory_get_peak_usage( true ),
			) );
		}

		// a phase is over
		if ( 'scanned' === $state['phase'] ) {

			SyncPilot_Logger::event( 'Import scanned', array(
				'statements' => $state['statements'],
				'tables'     => count( $state['tables'] ),
				'bytes'      => $state['offset'],
				'seconds'    => (int) round( $state['seconds']['scan'] ),
			) + ( array_filter( $state['collation_map'] ?? array() ) ? array( 'collations_mapped' => $state['collation_map'] ) : array() ) );
		}

		if ( 'loaded' === $state['phase'] ) {

			SyncPilot_Logger::event( 'Import loaded', array(
				'statements' => $state['statements'],
				'tables'     => $state['tables_done'],
				'bytes'      => $state['offset'],
				'seconds'    => (int) round( $state['seconds']['load'] ),
			) );

			// the unpacked copy is not needed any more
			if ( ! empty( $state['work'] ) && is_file( $state['work'] ) )
				@unlink( $state['work'] );
		}

		if ( 'replaced' === $state['phase'] ) {

			SyncPilot_Logger::event( 'Import replaced', array(
				'tables'       => count( $state['replace_tables'] ),
				'rows_checked' => $state['rows_checked'],
				'rows_changed' => $state['rows_changed'],
				'seconds'      => (int) round( $state['seconds']['replace'] ),
			) );
		}

		self::state_write( $state );

		return $this->end_ajax( json_encode( $this->import_progress( $state ) ) );
	}

	/**
	 * What the browser is told after a request: where the import is, and for the end of the scan the tables
	 * @since   0.4.0
	 *
	 * @param   array $state  The state
	 *
	 * @return  array
	 */
	protected function import_progress( $state ) {

		$answer = array(
			'phase'      => $state['phase'],
			'offset'     => $state['offset'],
			'total'      => $state['total'],
			'statements' => $state['statements'],
			'tables'     => count( $state['tables'] ),
			'done'       => in_array( $state['phase'], array( 'scanned', 'loaded', 'replaced' ), true ),
		);

		if ( 'replace' === $state['phase'] || 'replaced' === $state['phase'] ) {
			$answer['replace_table'] = $state['replace_index'];
			$answer['rows_checked']  = $state['rows_checked'];
			$answer['rows_changed']  = $state['rows_changed'];
		}

		if ( 'scanned' === $state['phase'] || 'loaded' === $state['phase'] || 'replaced' === $state['phase'] ) {
			$answer['table_names'] = array_keys( $state['tables'] );
			$answer['prefix']      = $state['prefix'] ?? '';
		}

		if ( in_array( $state['phase'], array( 'load', 'loaded', 'replace', 'replaced' ), true ) )
			$answer['tables_done'] = (int) ( $state['tables_done'] ?? 0 );

		return $answer;
	}

	/**
	 * The scan: every statement is read and checked, nothing is written. A statement that is not allowed stops the import
	 * before anything is changed; at the end the collations and the prefix are checked.
	 * @since   0.4.0
	 *
	 * @param   array                  $state   The state, changed by this
	 * @param   SyncPilot_Dump_Reader  $reader  The dump, at the place of the state
	 * @param   float                  $started The time of the start of the request
	 *
	 * @return  string|null  The answer when the import stopped; null when it goes on
	 */
	protected function import_scan( &$state, $reader, $started ) {

		$budget = self::step_seconds();
		$first  = true;

		// at least one statement per request, however short the time is
		while ( $first || microtime( true ) - $started < $budget ) {

			$first     = false;
			$statement = $reader->next();

			if ( false === $statement ) {

				$this->log_error( SyncPilot_HelpCode::ImportReadFailed, array( 'reason' => $reader->error(), 'offset' => $reader->offset(), 'phase' => 'scan' ), site: 1 );

				return $this->import_stop( $this->import_reader_text( $reader->error() ) );
			}

			if ( null === $statement ) {

				$state['offset'] = $reader->offset();

				return $this->import_scanned( $state );
			}

			$info = self::classify( $statement['sql'] );

			$state['statements']++;

			if ( 'reject' === $info['action'] ) {

				$this->log_error( SyncPilot_HelpCode::ImportStatementRefused, array( 'kind' => $info['kind'], 'reason' => $info['reason'], 'offset' => $statement['start'], 'number' => $state['statements'], 'phase' => 'scan' ), site: 1 );

				return $this->import_stop( sprintf( __( 'The dump has a statement that is not allowed: %1$s (%2$s). Nothing was changed. (#302)', self::TEXT_DOMAIN ), $info['kind'], $info['reason'] ) );
			}

			if ( 'create_table' === $info['kind'] ) {

				$state['tables'][ $info['table'] ] = 1;

				foreach ( $info['collations'] as $name )
					$state['collations'][ $name ] = 1;

				foreach ( $info['charsets'] as $name )
					$state['charsets'][ $name ] = 1;
			}

			$state['offset'] = $statement['end'];
		}

		return null;
	}

	/**
	 * The end of the scan: the collations and character sets must be known to this database, and the tables must have
	 * the prefix of this site (or the browser said that another one is fine)
	 * @since   0.4.0
	 *
	 * @param   array $state  The state, changed by this
	 *
	 * @return  string|null  The answer when the import stopped; null when the scan is done
	 */
	protected function import_scanned( &$state ) {

		global $wpdb;

		$missing = self::unsupported_collations( array( 'collations' => array_keys( $state['collations'] ), 'charsets' => array_keys( $state['charsets'] ) ) );
		$map     = array( 'collations' => array(), 'charsets' => array() );
		$stuck   = array();

		// a collation that this database does not know is replaced by a similar one, unless the form says to stop
		if ( $missing['collations'] || $missing['charsets'] ) {

			$known = self::known_collations();

			foreach ( $missing['charsets'] as $name ) {

				$to = empty( $state['strict_collations'] ) ? self::map_charset( $name, $known['charsets'] ) : null;

				if ( null === $to )
					$stuck[] = $name;

				else
					$map['charsets'][ $name ] = $to;
			}

			foreach ( $missing['collations'] as $name ) {

				$to = empty( $state['strict_collations'] ) ? self::map_collation( $name, $known['collations'] ) : null;

				if ( null === $to )
					$stuck[] = $name;

				else
					$map['collations'][ $name ] = $to;
			}
		}

		if ( $stuck ) {

			$this->log_error( SyncPilot_HelpCode::ImportCollationUnknown, array( 'collations' => array_values( array_intersect( $missing['collations'], $stuck ) ), 'charsets' => array_values( array_intersect( $missing['charsets'], $stuck ) ), 'strict' => ! empty( $state['strict_collations'] ) ), site: 1 );

			return $this->import_stop( sprintf( __( 'This database does not know %s, which the dump uses. Nothing was changed. (#303)', self::TEXT_DOMAIN ), implode( ', ', $stuck ) ) );
		}

		$state['collation_map'] = $map;

		$prefix = self::detect_prefix( array_keys( $state['tables'] ) );

		if ( '' !== $prefix && $prefix !== $wpdb->base_prefix && empty( $state['other_prefix'] ) ) {

			$this->log_error( SyncPilot_HelpCode::ImportPrefixDiffers, array( 'dump_prefix_bytes' => strlen( $prefix ), 'site_prefix_bytes' => strlen( $wpdb->base_prefix ) ), site: 1 );

			return $this->import_stop( sprintf( __( 'The tables of the dump begin with "%1$s", the tables of this site with "%2$s". Nothing was changed. (#305)', self::TEXT_DOMAIN ), esc_html( $prefix ), esc_html( $wpdb->base_prefix ) ) );
		}

		$state['prefix'] = $prefix;
		$state['phase']  = 'scanned';

		return null;
	}

	/**
	 * The text for a reason that the reader gives
	 * @since   0.4.0
	 *
	 * @param   string $reason  open_failed, zlib_missing, seek_failed, read_failed, statement_too_large, unterminated
	 *
	 * @return  string
	 */
	protected function import_reader_text( $reason ) {

		$texts = array(
			'statement_too_large' => __( 'The dump has a statement that is larger than the import reads.', self::TEXT_DOMAIN ),
			'unterminated'        => __( 'The dump ends inside a text: the file is cut off.', self::TEXT_DOMAIN ),
			'zlib_missing'        => __( 'The dump is a gzip file and PHP has no zlib.', self::TEXT_DOMAIN ),
			'gzip_corrupt'        => __( 'The gzip file is damaged.', self::TEXT_DOMAIN ),
			'unpack_write'        => __( 'The gzip file cannot be unpacked: the disk is full or the folder cannot be written.', self::TEXT_DOMAIN ),
		);

		return ( $texts[ $reason ] ?? __( 'The dump cannot be read.', self::TEXT_DOMAIN ) ) . ' ' . __( 'Nothing was changed. (#304)', self::TEXT_DOMAIN );
	}

	/**
	 * Begin the loading: the temporary tables of an earlier import are removed, the table for the ALTER queries is made,
	 * and the dump is read again from the start
	 * @since   0.4.0
	 *
	 * @param   array $state  The state after the scan
	 *
	 * @return  array|string  The state of the loading; the answer when the import stopped
	 */
	protected function import_begin_load( $state ) {

		global $syncpilot;

		$syncpilot->delete_temporary_tables( $this->temp_prefix );

		$result = $syncpilot->process_chunk( $syncpilot->get_create_alter_table_query() );

		if ( true !== $result )
			return $this->import_error( (string) $result );

		$state['phase']       = 'load';
		$state['offset']      = 0;
		$state['loading']     = true;
		$state['statements']  = 0;
		$state['tables_done'] = 0;

		// written now: a request that stops the import must know that there are temporary tables to remove
		self::state_write( $state );

		return $state;
	}

	/**
	 * The loading: the statements of the dump are run on the temporary tables (the name of every table gets the temporary
	 * prefix). What the SET statements of the dump set (the character set, the time zone, the checks, the variables of the
	 * user like @saved_cs_client) belongs to the session, and a request that goes on at a place has a new session: the
	 * values are read when a request ends and set again when the next one begins, or the time zone and the character set
	 * of the dump would be those of the connection, and "SET character_set_client = @saved_cs_client" would set NULL.
	 * @since   0.4.0
	 *
	 * @param   array                  $state   The state, changed by this
	 * @param   SyncPilot_Dump_Reader  $reader  The dump, at the place of the state
	 * @param   float                  $started The time of the start of the request
	 *
	 * @return  string|null  The answer when the import stopped; null when it goes on
	 */
	protected function import_load( &$state, $reader, $started ) {

		global $wpdb, $syncpilot;

		$budget = self::step_seconds();

		if ( empty( $wpdb->charset ) ) {
			$wpdb->charset = defined( 'DB_CHARSET' ) ? DB_CHARSET : 'utf8';
			$wpdb->set_charset( $wpdb->dbh, $wpdb->charset );
		}

		$wpdb->suppress_errors( true );
		$wpdb->query( "SET sql_mode='NO_AUTO_VALUE_ON_ZERO'" );
		$wpdb->query( 'SET autocommit=1' );

		$this->import_restore_session( $state['session'] );

		$queries = 0;
		$bytes   = 0;
		$first   = true;

		while ( $first || microtime( true ) - $started < $budget ) {

			$first     = false;
			$statement = $reader->next();

			if ( false === $statement ) {

				$this->log_error( SyncPilot_HelpCode::ImportReadFailed, array( 'reason' => $reader->error(), 'offset' => $reader->offset(), 'phase' => 'load' ), site: 2 );

				return $this->import_stop( $this->import_reader_text( $reader->error() ) );
			}

			if ( null === $statement ) {

				$state['offset'] = $reader->offset();
				$state['phase']  = 'loaded';

				SyncPilot_Logger::tally( array( 'chunks_imported' => 1, 'queries_run' => $queries, 'bytes_imported' => $bytes ) );

				return null;
			}

			$info = self::classify( $statement['sql'] );

			$state['statements']++;

			if ( 'reject' === $info['action'] ) {

				$this->log_error( SyncPilot_HelpCode::ImportStatementRefused, array( 'kind' => $info['kind'], 'reason' => $info['reason'], 'offset' => $statement['start'], 'number' => $state['statements'], 'phase' => 'load' ), site: 2 );

				return $this->import_stop( sprintf( __( 'The dump has a statement that is not allowed: %1$s (%2$s). (#302)', self::TEXT_DOMAIN ), $info['kind'], $info['reason'] ) );
			}

			if ( 'run' === $info['action'] ) {

				$query = isset( $info['table'] ) ? self::with_table( $statement['sql'], $info, $this->temp_prefix . $info['table'] ) : $statement['sql'];

				if ( 'create_table' === $info['kind'] ) {
					$query = self::apply_collation_map( $query, $state['collation_map'] ?? array() );
					$query = str_replace( 'TYPE=', 'ENGINE=', $query );
					$query = apply_filters( 'syncpilot_create_table_query', $query, $info['table'] );
				}

				if ( false === $wpdb->query( $query ) ) {

					$this->log_error( SyncPilot_HelpCode::QueryFailed, $syncpilot->describe_failed_query( $query, $state['statements'] ) + array( 'phase' => 'import' ), site: 2 );

					return $this->import_stop( sprintf( __( 'The database refused a statement of the dump: %s (#152)', self::TEXT_DOMAIN ), esc_html( $wpdb->last_error ) ) );
				}

				$queries++;
				$bytes += $statement['bytes'];

				if ( 'set' === $info['kind'] )
					$state['session_vars'] = array_slice( array_values( array_unique( array_merge( $state['session_vars'], $info['vars'] ) ) ), 0, 100 );

				if ( 'create_table' === $info['kind'] )
					$state['tables_done']++;
			}

			$state['offset'] = $statement['end'];
		}

		SyncPilot_Logger::tally( array( 'chunks_imported' => 1, 'queries_run' => $queries, 'bytes_imported' => $bytes ) );

		$state['session'] = $this->import_capture_session( $state['session_vars'] );

		return null;
	}

	/**
	 * The values that the session has now for the variables that the dump has set, for the next request
	 * @since   0.4.0
	 *
	 * @param   array $names  The variables (system variables in small letters, a user variable with its @)
	 *
	 * @return  array  Name => value (null for a user variable that is not set)
	 */
	protected function import_capture_session( $names ) {

		global $wpdb;

		$names = array_values( array_filter( $names, fn( $name ) => 1 === preg_match( '/^@?[A-Za-z_][A-Za-z0-9_]*$/', $name ) ) );

		if ( ! $names )
			return array();

		$select = array();

		foreach ( $names as $n => $name )
			$select[] = ( '@' === $name[0] ? $name : '@@session.' . $name ) . ' AS v' . $n;

		$row = $wpdb->get_row( 'SELECT ' . implode( ', ', $select ), ARRAY_A );

		return is_array( $row ) ? array_combine( $names, array_values( $row ) ) : array();
	}

	/**
	 * Set the variables of the session that the request before left, in the order they were set
	 * @since   0.4.0
	 *
	 * @param   array $session  Name => value as import_capture_session() gives them
	 */
	protected function import_restore_session( $session ) {

		global $wpdb;

		foreach ( $session as $name => $value ) {

			if ( 1 !== preg_match( '/^@?[A-Za-z_][A-Za-z0-9_]*$/', $name ) )
				continue;

			$sql = null === $value ? 'NULL' : ( 1 === preg_match( '/^-?\d+$/', (string) $value ) ? (string) $value : "'" . esc_sql( (string) $value ) . "'" );

			$wpdb->query( 'SET ' . ( '@' === $name[0] ? $name : 'SESSION ' . $name ) . ' = ' . $sql );
		}
	}

	/**
	 * The form of the migration as a list of fields (the find and replace rows, the choice for the GUIDs)
	 * @since   0.4.0
	 *
	 * @param   string $raw  The serialized form
	 *
	 * @return  array
	 */
	protected function import_form( $raw ) {

		global $syncpilot;

		return $syncpilot->set_migration_form_data( $raw );
	}

	/**
	 * Where the unpacked copy of a gzip dump goes: a folder in the folder of the dumps, when the disk has room for it (the
	 * filter "syncpilot_import_free_bytes" is for tests). A gzip file cannot be entered in the middle, so without a copy every
	 * request reads from the start of the file; with it only the first request unpacks.
	 * @since   0.4.0
	 *
	 * @param   int $text_bytes  The size of the text
	 *
	 * @return  string  The path of the copy; an empty text when the dump is read from the gzip file itself
	 */
	protected function import_work_file( $text_bytes ) {

		$dir = self::dir();

		if ( ! $dir || ! wp_mkdir_p( $dir . DS . '.work' ) )
			return '';

		$free = apply_filters( 'syncpilot_import_free_bytes', @disk_free_space( $dir ), $dir );
		$need = (int) ( $text_bytes * 1.05 ) + 67108864;

		if ( false === $free || $free < $need ) {

			SyncPilot_Logger::info( 'Import reads the gzip file itself', array( 'free_bytes' => false === $free ? null : (int) $free, 'needed_bytes' => $need ) );

			return '';
		}

		return $dir . DS . '.work' . DS . SyncPilot_Logger::migration_id() . '.sql';
	}

	/**
	 * The unpacking: a gzip dump is written to the copy, for as long as step_seconds() says; the next request goes on where
	 * this one stopped (it reads the gzip file to that place again, which an unpacking of a few GB does not need more than once
	 * or twice)
	 * @since   0.4.0
	 *
	 * @param   array  $state    The state, changed by this
	 * @param   string $file     The gzip dump
	 * @param   float  $started  The time of the start of the request
	 *
	 * @return  string|null  The answer when the import stopped; null when it goes on
	 */
	protected function import_unpack( &$state, $file, $started ) {

		$in  = @gzopen( $file, 'rb' );
		$out = @fopen( $state['work'], 'cb' );

		if ( ! $in || ! $out || ( $state['unpacked'] > 0 && 0 !== @gzseek( $in, $state['unpacked'] ) ) ) {

			$this->log_error( SyncPilot_HelpCode::ImportReadFailed, array( 'reason' => 'unpack_open', 'offset' => $state['unpacked'], 'phase' => 'unpack' ), site: 3 );

			return $this->import_stop( $this->import_reader_text( 'unpack_open' ) );
		}

		// what a request that was cut off wrote behind the place is not trusted
		ftruncate( $out, $state['unpacked'] );
		fseek( $out, $state['unpacked'] );

		$budget = self::step_seconds();
		$first  = true;

		while ( $first || microtime( true ) - $started < $budget ) {

			$first = false;
			$data  = gzread( $in, SyncPilot_Dump_Reader::BLOCK_BYTES );

			if ( false === $data || ( '' === $data && ! gzeof( $in ) ) ) {

				$this->log_error( SyncPilot_HelpCode::ImportReadFailed, array( 'reason' => 'gzip_corrupt', 'offset' => $state['unpacked'], 'phase' => 'unpack' ), site: 4 );

				return $this->import_stop( $this->import_reader_text( 'gzip_corrupt' ) );
			}

			if ( '' === $data )
				break;

			if ( strlen( $data ) !== (int) fwrite( $out, $data ) ) {

				$this->log_error( SyncPilot_HelpCode::ImportReadFailed, array( 'reason' => 'unpack_write', 'offset' => $state['unpacked'], 'phase' => 'unpack' ), site: 5 );

				return $this->import_stop( $this->import_reader_text( 'unpack_write' ) );
			}

			$state['unpacked'] += strlen( $data );
		}

		fclose( $out );

		$end = gzeof( $in );

		gzclose( $in );

		// a gzip file that is cut off ends early without an error: the size it says at its end is not reached
		if ( $end && null !== ( $state['gz_text'] ?? null ) && $state['unpacked'] % 4294967296 !== $state['gz_text'] ) {

			$this->log_error( SyncPilot_HelpCode::ImportReadFailed, array( 'reason' => 'gzip_corrupt', 'offset' => $state['unpacked'], 'phase' => 'unpack' ), site: 6 );

			return $this->import_stop( $this->import_reader_text( 'gzip_corrupt' ) );
		}

		if ( $end ) {
			$state['phase']  = 'scan';
			$state['total']  = $state['unpacked'];
			$state['offset'] = 0;
		}

		else
			$state['offset'] = $state['unpacked'];

		return null;
	}

	/**
	 * Begin the replace: the tables that were loaded are gone through one after the other
	 * @since   0.4.0
	 *
	 * @param   array $state  The state after the load
	 *
	 * @return  array  The state
	 */
	protected function import_begin_replace( $state ) {

		$state['phase']          = 'replace';
		$state['replace_tables'] = array_keys( $state['tables'] );
		$state['replace_index']  = 0;
		$state['replace_last']   = null;
		$state['replace_offset'] = 0;
		$state['rows_checked']   = 0;
		$state['rows_changed']   = 0;

		return $state;
	}

	/**
	 * What of a table of the import the replace needs: its columns that hold text, its primary key
	 * @since   0.4.0
	 *
	 * @param   string $temp  The name of the temporary table
	 *
	 * @return  array  strings (the names of the columns with text), columns (all names), key (the columns of the primary key)
	 */
	protected function replace_table_meta( $temp ) {

		global $wpdb;

		$columns = $wpdb->get_results( 'SHOW COLUMNS FROM `' . esc_sql( $temp ) . '`', ARRAY_A );
		$meta    = array( 'strings' => array(), 'columns' => array(), 'key' => array() );

		foreach ( (array) $columns as $column ) {

			$meta['columns'][] = $column['Field'];

			if ( preg_match( '/^(?:char|varchar|tinytext|text|mediumtext|longtext|tinyblob|blob|mediumblob|longblob|json)\b/i', $column['Type'] ) )
				$meta['strings'][] = $column['Field'];
		}

		$keys = $wpdb->get_results( 'SHOW KEYS FROM `' . esc_sql( $temp ) . "` WHERE Key_name = 'PRIMARY'", ARRAY_A );

		usort( $keys, fn( $a, $b ) => (int) $a['Seq_in_index'] <=> (int) $b['Seq_in_index'] );

		$meta['key'] = array_map( fn( $key ) => $key['Column_name'], $keys );

		return $meta;
	}

	/**
	 * Replace in a serialized value without unserializing it. The text is read once from the front to the back and written
	 * again, the strings that are values (not the keys of an array or the names of the properties of an object) go through
	 * $leaf and get their new length. Everything else is copied as it is: numbers, references (r: and R:), the class names,
	 * custom serialized data (C:). So the memory is the size of the text twice, whatever the data look like. The function of
	 * a push or a pull (recursive_unserialize_replace()) unserializes the text and builds it again, which makes a copy of
	 * every object that is used twice: a serialized object graph of 764 bytes with a depth of 18 became 22 MB there, and
	 * every further level doubles it (and the references are gone afterwards).
	 * @since   0.4.0
	 *
	 * @param   string   $text  The serialized value
	 * @param   callable $leaf  Gets a string that is a value and gives the string for its place
	 *
	 * @return  string|false  false when the text is not a serialized value that this function reads to the end
	 */
	static function rewrite_serialized( $text, $leaf ) {

		$i     = 0;
		$n     = strlen( $text );
		$out   = '';
		$stack = array();   // per open array or object: the items that are still to come (a key and its value count 2)

		while ( $i < $n ) {

			$type = $text[ $i ];

			// the end of an array or an object
			if ( '}' === $type ) {

				if ( ! $stack || 0 !== end( $stack ) )
					return false;

				array_pop( $stack );

				$out .= '}';
				$i++;
			}

			elseif ( 'N' === $type ) {

				if ( ';' !== ( $text[ $i + 1 ] ?? '' ) )
					return false;

				$out .= 'N;';
				$i   += 2;
			}

			elseif ( 'b' === $type || 'i' === $type || 'd' === $type || 'r' === $type || 'R' === $type ) {

				if ( ! preg_match( '/\G[bidrR]:[^;]*;/', $text, $m, 0, $i ) )
					return false;

				$out .= $m[0];
				$i   += strlen( $m[0] );
			}

			elseif ( 's' === $type ) {

				if ( ! preg_match( '/\Gs:(\d+):"/', $text, $m, 0, $i ) )
					return false;

				$start  = $i + strlen( $m[0] );
				$length = (int) $m[1];

				if ( '";' !== substr( $text, $start + $length, 2 ) || $start + $length + 2 > $n )
					return false;

				$value = substr( $text, $start, $length );
				$is_key = $stack && 0 === ( end( $stack ) % 2 );

				if ( ! $is_key && '' !== $value ) {

					$new = $leaf( $value );

					if ( $new !== $value ) {
						$value  = $new;
						$length = strlen( $value );
					}
				}

				$out .= 's:' . $length . ':"' . $value . '";';
				$i    = $start + (int) $m[1] + 2;
			}

			elseif ( 'a' === $type || 'O' === $type ) {

				if ( ! preg_match( 'a' === $type ? '/\Ga:(\d+):\{/' : '/\GO:\d+:"[^"]*":(\d+):\{/', $text, $m, 0, $i ) )
					return false;

				// a key and a value are two items; the container is counted in the one around it when it is closed
				$stack[] = 2 * (int) $m[1];

				$out .= $m[0];
				$i   += strlen( $m[0] );

				continue;
			}

			elseif ( 'C' === $type ) {

				// custom serialized data: its text belongs to the class, not read, not changed
				if ( ! preg_match( '/\GC:\d+:"[^"]*":(\d+):\{/', $text, $m, 0, $i ) )
					return false;

				$end = $i + strlen( $m[0] ) + (int) $m[1];

				if ( '}' !== ( $text[ $end ] ?? '' ) )
					return false;

				$out .= substr( $text, $i, $end + 1 - $i );
				$i    = $end + 1;
			}

			elseif ( 'E' === $type ) {

				if ( ! preg_match( '/\GE:\d+:"[^"]*";/', $text, $m, 0, $i ) )
					return false;

				$out .= $m[0];
				$i   += strlen( $m[0] );
			}

			else
				return false;

			// a value is done: it was an item of the array or object that is open
			if ( '}' === $type ) {
				if ( $stack )
					$stack[ count( $stack ) - 1 ]--;
			}

			elseif ( 'a' !== $type && 'O' !== $type && $stack )
				$stack[ count( $stack ) - 1 ]--;

			if ( ! $stack )
				break;
		}

		// the value must end where the text ends, with nothing open
		return $stack || $i !== $n ? false : $out;
	}

	/**
	 * The new value of a value of a table: a serialized text is rewritten without unserializing it (rewrite_serialized()),
	 * a strings that is serialized inside it the same way, and what is left (a plain text, JSON, a serialized text that cannot
	 * be read) goes to the function that a push or a pull uses
	 * @since   0.4.0
	 *
	 * @param   string $value  The value
	 *
	 * @return  string
	 */
	protected function replace_value( $value ) {

		global $syncpilot;

		if ( ! $syncpilot->contains_search_term( $value ) )
			return $value;

		if ( is_serialized( $value ) ) {

			$new = self::rewrite_serialized( $value, fn( $leaf ) => $this->replace_value( $leaf ) );

			if ( false !== $new )
				return $new;
		}

		$new = $syncpilot->recursive_unserialize_replace( $value );

		return is_string( $new ) ? $new : $value;
	}

	/**
	 * Read the rows of a batch from the database without holding all of them: the result is read row by row and the reading
	 * stops when the rows are as big as the budget (at least one row is read). The rows that were not read are read by the
	 * next request, from the key of the last one. The buffered result of a query with big values (100 rows of 3 MB) is held by
	 * PHP twice (in the library and in the array), which a limit of 96 MB does not hold.
	 * @since   0.4.0
	 *
	 * @param   string $sql     The query
	 * @param   int    $limit   The number of rows that the query asks for
	 *
	 * @return  array|null  array( rows, complete ): complete is false when the reading stopped before the end of the result; null on an error
	 */
	protected function read_rows( $sql, $limit ) {

		global $wpdb;

		$limit_bytes = (int) wp_convert_hr_to_bytes( ini_get( 'memory_limit' ) );
		$budget      = $limit_bytes > 0 ? (int) min( 16777216, max( 1048576, ( $limit_bytes - memory_get_usage() ) / 12 ) ) : 16777216;
		$budget      = (int) apply_filters( 'syncpilot_import_replace_bytes', $budget );

		if ( ! ( $wpdb->dbh instanceof mysqli ) )
			return array( (array) $wpdb->get_results( $sql, ARRAY_A ), true );

		// the percent signs of the LIKE patterns are held back by prepare() and given back by the methods of wpdb, not by mysqli
		$result = $wpdb->dbh->query( $wpdb->remove_placeholder_escape( $sql ), MYSQLI_USE_RESULT );

		if ( false === $result )
			return null;

		$rows     = array();
		$bytes    = 0;
		$complete = true;

		while ( $row = $result->fetch_assoc() ) {

			$rows[] = $row;
			$bytes += array_sum( array_map( 'strlen', $row ) );

			if ( $bytes >= $budget && count( $rows ) < $limit ) {
				$complete = false;

				break;
			}
		}

		// what is left of the result is read and dropped here, the connection is free for the next query
		$result->free();

		return array( $rows, $complete );
	}

	/**
	 * The replace: in every temporary table the values that hold one of the texts to find are changed (the find and replace
	 * of the form: the same function that a push or a pull uses on every value, so serialized data and JSON stay valid). The
	 * database finds the rows (a LIKE over the columns with text; a value in JSON has its slashes as \/), the rows are read in
	 * the order of the primary key, 100 at a time, and written back one by one. A table without a primary key is read in the
	 * order the database gives it and every column of the row is compared when it is written.
	 * @since   0.4.0
	 *
	 * @param   array $state    The state, changed by this
	 * @param   float $started  The time of the start of the request
	 *
	 * @return  string|null  The answer when the import stopped; null when it goes on
	 */
	protected function import_replace( &$state, $started ) {

		global $wpdb, $syncpilot;

		$form  = $syncpilot->set_migration_form_data( $state['form_data'] );
		$terms = array_values( array_filter( (array) ( $form['replace_old'] ?? array() ), 'strlen' ) );
		$guids = ! empty( $form['replace_guids'] );

		// nothing to find: the values are what the dump has
		if ( ! $terms ) {
			$state['phase'] = 'replaced';

			return null;
		}

		$budget = self::step_seconds();
		$first  = true;
		$limit  = (int) apply_filters( 'syncpilot_import_replace_rows', 100 );
		$like   = array();

		foreach ( $terms as $term ) {
			$like[] = '%' . $wpdb->esc_like( $term ) . '%';
			$like[] = '%' . $wpdb->esc_like( str_replace( '/', '\\/', $term ) ) . '%';
		}

		$wpdb->suppress_errors( true );
		$wpdb->query( 'SET autocommit=1' );

		while ( $state['replace_index'] < count( $state['replace_tables'] ) ) {

			if ( ! $first && microtime( true ) - $started >= $budget )
				return null;

			$first = false;
			$table = $state['replace_tables'][ $state['replace_index'] ];
			$temp  = $this->temp_prefix . $table;
			$meta  = $this->replace_table_meta( $temp );

			if ( ! $meta['strings'] ) {
				$state['replace_index']++;
				$state['replace_last']   = null;
				$state['replace_offset'] = 0;

				continue;
			}

			$quoted = '`' . str_replace( '`', '``', $temp ) . '`';
			$order  = '';
			$where  = array();

			if ( $meta['key'] ) {

				$names = array_map( fn( $name ) => '`' . str_replace( '`', '``', $name ) . '`', $meta['key'] );
				$order = ' ORDER BY ' . implode( ', ', $names );

				if ( null !== $state['replace_last'] )
					$where[] = '(' . implode( ', ', $names ) . ') > (' . implode( ', ', array_map( fn( $value ) => $wpdb->prepare( '%s', $value ), $state['replace_last'] ) ) . ')';

				$filter = array();

				foreach ( $meta['strings'] as $name )
					foreach ( $like as $pattern )
						$filter[] = $wpdb->prepare( '`' . str_replace( '`', '``', $name ) . '` LIKE %s', $pattern );

				$where[] = '(' . implode( ' OR ', $filter ) . ')';
			}

			$sql  = "SELECT * FROM $quoted" . ( $where ? ' WHERE ' . implode( ' AND ', $where ) : '' ) . $order . ' LIMIT ' . $limit . ( $meta['key'] ? '' : ' OFFSET ' . (int) $state['replace_offset'] );
			$read = $this->read_rows( $sql, $limit );
			$rows = null === $read ? null : $read[0];

			if ( null === $rows ) {

				$this->log_error( SyncPilot_HelpCode::QueryFailed, array( 'query' => 'SELECT', 'table' => $temp, 'db_errno' => ( $wpdb->dbh instanceof mysqli ) ? $wpdb->dbh->errno : 0, 'phase' => 'replace' ), site: 3 );

				return $this->import_stop( sprintf( __( 'The database refused a query of the replace: %s (#152)', self::TEXT_DOMAIN ), esc_html( ( $wpdb->dbh instanceof mysqli ) ? $wpdb->dbh->error : $wpdb->last_error ) ) );
			}

			foreach ( $rows as $row ) {

				$changes = array();

				foreach ( $meta['strings'] as $name ) {

					$value = $row[ $name ];

					if ( null === $value || '' === $value || ( 'guid' === $name && ! ( $guids && $syncpilot->table_is( 'posts', $table ) ) ) )
						continue;

					$new = $this->replace_value( $value );

					if ( $new !== $value )
						$changes[ $name ] = $new;
				}

				$state['rows_checked']++;

				if ( $changes ) {

					$set = array();

					foreach ( $changes as $name => $new )
						$set[] = $wpdb->prepare( '`' . str_replace( '`', '``', $name ) . '` = %s', $new );

					$match = array();

					foreach ( $meta['key'] ?: $meta['columns'] as $name ) {

						$column  = '`' . str_replace( '`', '``', $name ) . '`';
						$match[] = null === $row[ $name ] ? "$column IS NULL" : $wpdb->prepare( "$column = %s", $row[ $name ] );
					}

					if ( false === $wpdb->query( "UPDATE $quoted SET " . implode( ', ', $set ) . ' WHERE ' . implode( ' AND ', $match ) . ' LIMIT 1' ) ) {

						$this->log_error( SyncPilot_HelpCode::QueryFailed, array( 'query' => 'UPDATE', 'table' => $temp, 'db_errno' => ( $wpdb->dbh instanceof mysqli ) ? $wpdb->dbh->errno : 0, 'phase' => 'replace' ), site: 4 );

						return $this->import_stop( sprintf( __( 'The database refused a query of the replace: %s (#152)', self::TEXT_DOMAIN ), esc_html( $wpdb->last_error ) ) );
					}

					$state['rows_changed']++;
				}
			}

			if ( count( $rows ) < $limit && ! empty( $read ) && $read[1] ) {
				$state['replace_index']++;
				$state['replace_last']   = null;
				$state['replace_offset'] = 0;
			}

			elseif ( $meta['key'] ) {
				$last = end( $rows );
				$state['replace_last'] = array_map( fn( $name ) => $last[ $name ], $meta['key'] );
			}

			else
				$state['replace_offset'] += count( $rows );
		}

		$state['phase'] = 'replaced';

		return null;
	}

	/**
	 * Remove what an import made on this site: the temporary tables (when the loading began), the state and the unpacked
	 * copy. The log is not touched: the caller writes the end of the migration.
	 * @since   0.4.0
	 */
	function cleanup() {

		global $syncpilot;

		$state = self::state_read();

		if ( ! empty( $state['loading'] ) )
			$syncpilot->delete_temporary_tables( $this->temp_prefix );

		self::state_remove();
	}

	/**
	 * The tables are replaced: the state of an import is not needed any more
	 * @since   0.4.0
	 *
	 * @param   string $intent  What was migrated: pull, push or import
	 */
	function finalized( $intent ) {

		if ( 'import' === $intent )
			self::state_remove();
	}

	/**
	 * Stop an import that is under way: the temporary tables and the state are removed, and the log has the end of the
	 * migration as "cancelled"
	 * @since   0.4.0
	 *
	 * @return  string|void  The answer as JSON (only in tests, otherwise the request ends here)
	 */
	function ajax_import_cancel() {

		global $syncpilot;

		$this->check_ajax_referer( 'import-cancel' );

		$state = self::state_read();

		if ( ! empty( $state['loading'] ) )
			$syncpilot->delete_temporary_tables( $this->temp_prefix );

		self::state_remove();

		SyncPilot_Logger::close_migration( 'cancelled', array( 'intent' => 'import' ) );

		$result = $this->end_ajax( json_encode( array( 'cancelled' => 1 ) ) );

		return $result;
	}

	/**
	 * Answer the page with the dumps in the folder
	 * @since   0.4.0
	 *
	 * @return  void|string  The answer as JSON (only in tests, otherwise the request ends here)
	 */
	function ajax_import_list() {

		$this->check_ajax_referer( 'import-list' );

		$writable = false !== self::dir();

		$result = $this->end_ajax( json_encode( array(
			'files'    => self::files(),
			'folder'   => self::path(),
			'writable' => $writable,
		) ) );

		return $result;
	}
}
