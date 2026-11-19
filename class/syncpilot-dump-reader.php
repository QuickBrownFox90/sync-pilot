<?php
/**
 * Reads a database dump (.sql or .sql.gz) statement by statement, from any place in the file.
 *
 * A statement ends at a semicolon that is not inside a string ('..', "..", `..`), a comment (-- , #, a block comment) or
 * an escape. The file is read in blocks, so a dump of any size is read with the memory of one block and the largest
 * statement. The place is the position in the uncompressed text: the import stops after a statement, keeps the place, and
 * goes on there in the next request. For a gzip file going to a place means reading from the start (a gzip file cannot be
 * entered in the middle).
 *
 * The reader only splits. What a statement is allowed to do is decided by SyncPilot_Import::classify().
 *
 * @since   0.4.0
 * @author  Patrick Mauersberger
 */
class SyncPilot_Dump_Reader {

	// how much is read at a time
	const BLOCK_BYTES = 1048576;

	// the largest statement that is read (the one of an extended INSERT); the filter "syncpilot_import_max_statement_bytes" changes it
	const STATEMENT_MAX_BYTES = 33554432;

	protected $handle;
	protected $gzip   = false;
	protected $buffer = '';
	protected $offset = 0;      // the place of buffer[0] in the uncompressed text
	protected $pos    = 0;      // the place in the buffer where the next statement begins
	protected $eof    = false;
	protected $block;
	protected $max;
	protected $error  = '';

	/**
	 * Open a dump at a place
	 * @since   0.4.0
	 *
	 * @param   string $path    The file
	 * @param   int    $offset  The place in the uncompressed text where a statement begins (0 for the start)
	 * @param   int    $block   How much is read at a time (only tests use another value)
	 * @param   int    $max     The largest statement in bytes; 0 for the default
	 */
	function __construct( $path, $offset = 0, $block = self::BLOCK_BYTES, $max = 0 ) {

		$this->block = max( 16, (int) $block );
		$this->max   = $max > 0 ? (int) $max : (int) apply_filters( 'syncpilot_import_max_statement_bytes', self::STATEMENT_MAX_BYTES );

		$magic = '';

		if ( is_readable( $path ) && false !== ( $probe = @fopen( $path, 'rb' ) ) ) {
			$magic = (string) fread( $probe, 2 );
			fclose( $probe );
		}

		// the content decides, not the name: a gzip file without .gz is read as gzip, a plain file with .gz as plain
		$this->gzip = "\x1f\x8b" === $magic;

		if ( $this->gzip && ! function_exists( 'gzopen' ) ) {
			$this->error = 'zlib_missing';

			return;
		}

		$this->handle = $this->gzip ? @gzopen( $path, 'rb' ) : @fopen( $path, 'rb' );

		if ( false === $this->handle ) {
			$this->handle = null;
			$this->error  = 'open_failed';

			return;
		}

		$offset = max( 0, (int) $offset );

		if ( $offset > 0 ) {

			$moved = $this->gzip ? ( 0 === @gzseek( $this->handle, $offset ) ) : ( 0 === @fseek( $this->handle, $offset ) );

			if ( ! $moved )
				$this->error = 'seek_failed';

			$this->offset = $offset;
		}
	}

	function __destruct() {
		$this->close();
	}

	/**
	 * Close the file
	 * @since   0.4.0
	 */
	function close() {

		if ( ! $this->handle )
			return;

		$this->gzip ? gzclose( $this->handle ) : fclose( $this->handle );

		$this->handle = null;
	}

	/**
	 * The reason that the last call failed: open_failed, zlib_missing, seek_failed, read_failed, statement_too_large,
	 * unterminated; an empty text when nothing failed
	 * @since   0.4.0
	 *
	 * @return  string
	 */
	function error() {
		return $this->error;
	}

	/**
	 * Whether the file is gzip
	 * @since   0.4.0
	 *
	 * @return  bool
	 */
	function is_gzip() {
		return $this->gzip;
	}

	/**
	 * The place after the last statement that was read: where the next one begins
	 * @since   0.4.0
	 *
	 * @return  int
	 */
	function offset() {
		return $this->offset + $this->pos;
	}

	/**
	 * The next statement. Comments before it are dropped; a statement that is one conditional comment
	 * (/*!40101 SET ... *\/, how mysqldump writes what only some versions run) is given without it.
	 * @since   0.4.0
	 *
	 * @return  array|null|false  start (the place where the statement begins), end (the place after its semicolon), bytes
	 *                            (its size as it is in the file) and sql; null at the end of the file; false on an error
	 *                            (error() says which)
	 */
	function next() {

		if ( '' !== $this->error || ! $this->handle )
			return false;

		// what is behind us is not needed any more
		if ( $this->pos > 0 && $this->pos >= strlen( $this->buffer ) || $this->pos > self::BLOCK_BYTES ) {
			$this->buffer  = (string) substr( $this->buffer, $this->pos );
			$this->offset += $this->pos;
			$this->pos     = 0;
		}

		while ( true ) {

			$start = $this->pos;
			$end   = $this->find_end( $start );

			if ( false === $end )
				return false;

			if ( null === $end ) {

				// the end of the file: what is left is a statement without a semicolon, or only comments and space
				$raw = (string) substr( $this->buffer, $start );

				$this->pos = strlen( $this->buffer );

				$sql = self::clean( $raw );

				if ( '' === $sql )
					return null;

				return array( 'start' => $this->offset + $start, 'end' => $this->offset + $this->pos, 'bytes' => strlen( $raw ), 'sql' => $sql );
			}

			$raw = substr( $this->buffer, $start, $end - $start );

			$this->pos = $end + 1;

			$sql = self::clean( $raw );

			// only comments and space between two semicolons: the next one
			if ( '' === $sql )
				continue;

			return array( 'start' => $this->offset + $start, 'end' => $this->offset + $this->pos, 'bytes' => strlen( $raw ), 'sql' => $sql );
		}
	}

	/**
	 * Find the semicolon that ends the statement that begins at a place of the buffer; the buffer is read on when it is
	 * not enough
	 * @since   0.4.0
	 *
	 * @param   int $start  The place in the buffer
	 *
	 * @return  int|null|false  The place of the semicolon in the buffer; null when the file ends first; false on an error
	 */
	protected function find_end( $start ) {

		$i    = $start;
		$mode = '';   // '' outside of anything; ' " ` inside a string or a name; -- and # a line comment; /* a block comment

		while ( true ) {

			$len = strlen( $this->buffer );

			while ( $i < $len ) {

				if ( '' === $mode ) {

					$i += strcspn( $this->buffer, ";'\"`#-/", $i );

					if ( $i >= $len )
						break;

					$c = $this->buffer[ $i ];

					if ( ';' === $c )
						return $i;

					if ( "'" === $c || '"' === $c || '`' === $c ) {
						$mode = $c;
						$i++;
					}

					elseif ( '#' === $c ) {
						$mode = '#';
						$i++;
					}

					elseif ( '-' === $c ) {

						// "-- " begins a comment, "--x" does not: the character behind it is needed
						if ( $i + 2 >= $len && ! $this->eof )
							break;

						if ( '-' === ( $this->buffer[ $i + 1 ] ?? '' ) && ( $i + 2 >= $len || ctype_space( $this->buffer[ $i + 2 ] ) || ctype_cntrl( $this->buffer[ $i + 2 ] ) ) ) {
							$mode = '--';
							$i   += 2;
						}

						else
							$i++;
					}

					else {

						// "/*" begins a block comment
						if ( $i + 1 >= $len && ! $this->eof )
							break;

						if ( '*' === ( $this->buffer[ $i + 1 ] ?? '' ) ) {
							$mode = '/*';
							$i   += 2;
						}

						else
							$i++;
					}
				}

				elseif ( '--' === $mode || '#' === $mode ) {

					$newline = strpos( $this->buffer, "\n", $i );

					if ( false === $newline ) {
						$i = $len;

						break;
					}

					$i    = $newline + 1;
					$mode = '';
				}

				elseif ( '/*' === $mode ) {

					$close = strpos( $this->buffer, '*/', $i );

					if ( false === $close ) {
						$i = max( $i, $len - 1 );   // the "*" at the end may be the first half of "*/"

						break;
					}

					$i    = $close + 2;
					$mode = '';
				}

				else {

					// a string or a name: a backslash escapes the next character (not in a name), a doubled quote is one quote
					$i += strcspn( $this->buffer, '`' === $mode ? '`' : $mode . '\\', $i );

					if ( $i >= $len )
						break;

					if ( '\\' === $this->buffer[ $i ] ) {

						if ( $i + 1 >= $len && ! $this->eof )
							break;

						$i += 2;
					}

					else {

						if ( $i + 1 >= $len && ! $this->eof )
							break;

						if ( $mode === ( $this->buffer[ $i + 1 ] ?? '' ) )
							$i += 2;

						else {
							$mode = '';
							$i++;
						}
					}
				}
			}

			if ( $this->eof ) {

				// a string that is not closed is a file that is cut off; a comment that is not closed does no harm
				if ( '' !== $mode && '--' !== $mode && '#' !== $mode && '/*' !== $mode ) {
					$this->error = 'unterminated';

					return false;
				}

				return null;
			}

			if ( strlen( $this->buffer ) - $start > $this->max ) {
				$this->error = 'statement_too_large';

				return false;
			}

			if ( ! $this->read_block() )
				return false;
		}
	}

	/**
	 * Read the next block of the file onto the buffer
	 * @since   0.4.0
	 *
	 * @return  bool  false on an error
	 */
	protected function read_block() {

		$data = $this->gzip ? @gzread( $this->handle, $this->block ) : @fread( $this->handle, $this->block );

		if ( false === $data ) {
			$this->error = 'read_failed';

			return false;
		}

		$this->buffer .= $data;

		if ( '' === $data || strlen( $data ) < $this->block && ( $this->gzip ? gzeof( $this->handle ) : feof( $this->handle ) ) )
			$this->eof = true;

		return true;
	}

	/**
	 * The database server as the comments that only some servers run need it: whether it is MariaDB, and its version as the
	 * number that these comments use (8.4.13 is 80413, 11.8.6 is 110806)
	 * @since   0.4.0
	 *
	 * @return  array  mariadb (bool) and version (int)
	 */
	static function server() {

		global $wpdb;

		$info = (string) $wpdb->db_server_info();

		if ( ! preg_match( '/(\d+)\.(\d+)\.(\d+)/', $info, $m ) )
			return array( 'mariadb' => false, 'version' => 0 );

		return array( 'mariadb' => false !== stripos( $info, 'mariadb' ), 'version' => (int) $m[1] * 10000 + (int) $m[2] * 100 + (int) $m[3] );
	}

	/**
	 * What a statement says without the comments in front of it: leading space and comments are dropped, and a statement
	 * that is one conditional comment is opened when the server runs it. /*!40101 ... *\/ is run by a server of that
	 * version or a newer one, /*M!100616 ... *\/ only by MariaDB of that version or a newer one; for the others it is a
	 * comment, as it is for the server itself. A number of 999999 is a comment for every server.
	 * @since   0.4.0
	 *
	 * @param   string     $raw     The statement as it is in the file, without the semicolon
	 * @param   array|null $server  mariadb and version of the server (see server()); null for the server of this site
	 *
	 * @return  string  Empty when there was nothing but space and comments
	 */
	static function clean( $raw, $server = null ) {

		$server = $server ?? self::server();
		$i      = 0;
		$len    = strlen( $raw );

		while ( $i < $len ) {

			$i += strspn( $raw, " \t\r\n\x0b\x0c", $i );

			if ( $i >= $len )
				return '';

			$two = substr( $raw, $i, 2 );

			if ( '#' === $raw[ $i ] || ( '--' === $two && ( $i + 2 >= $len || ctype_space( $raw[ $i + 2 ] ) || ctype_cntrl( $raw[ $i + 2 ] ) ) ) ) {

				$newline = strpos( $raw, "\n", $i );

				if ( false === $newline )
					return '';

				$i = $newline + 1;

				continue;
			}

			if ( '/*' === $two ) {

				$close = strpos( $raw, '*/', $i + 2 );

				if ( false === $close )
					return '';

				$conditional = preg_match( '/^\/\*(M?)!(\d*)\s*/', substr( $raw, $i, 24 ), $m );
				$runs        = $conditional && ( '' === $m[1] || $server['mariadb'] ) && (int) $m[2] <= $server['version'] && (int) $m[2] < 999999;

				// the content is the statement when this server runs it and it is the whole statement
				if ( $runs && '' === trim( substr( $raw, $close + 2 ) ) ) {

					$inner = trim( substr( $raw, $i + strlen( $m[0] ), $close - $i - strlen( $m[0] ) ) );

					return self::clean( $inner, $server );
				}

				// a comment that explains, one that this server does not run (/*M!999999\- enable the sandbox mode */ is one
				// for every server)
				if ( ! $conditional || ! $runs ) {
					$i = $close + 2;

					continue;
				}
			}

			break;
		}

		return rtrim( substr( $raw, $i ) );
	}
}
