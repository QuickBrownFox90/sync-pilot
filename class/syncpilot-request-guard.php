<?php
/**
 * The guard of the AJAX requests of SyncPilot: what the handlers do not catch themselves.
 *
 * An exception that nobody catches, a PHP fatal error, the time limit and the memory limit end a request with the
 * "critical error" page of WordPress (HTTP 500) and nothing in our log. The guard writes the reason to the log and
 * answers in the way the plugin's requests are answered.
 *
 * Who gets which answer: a request of a logged-in user (the browser of the migration) gets the reason (message, file,
 * line), as JSON with `syncpilot_error` like every other error of the admin requests. A request of another site to a
 * public endpoint gets a short answer without details (HTTP 500): such a request can fail before the signature is
 * checked, and then it comes from anyone. The details are in the log of the site where it happened.
 *
 * @since   0.3.0
 * @author  Patrick Mauersberger
 */
class SyncPilot_Request_Guard {

	protected static $installed = false;

	protected $plugin;
	protected $reserve = '';
	protected $handled = false;

	// warnings and notices (level verbose): once for each place and kind, and not more than this many in one request
	const MESSAGES_MAX = 50;

	protected $messages  = array();
	protected $in_report = false;

	/**
	 * Guard the request when it is an AJAX request of SyncPilot (an action that starts with syncpilot_). Done once.
	 * @since   0.3.0
	 *
	 * @param   SyncPilot_Base $plugin  The plugin, for the log
	 */
	static function install( $plugin ) {

		if ( self::$installed || defined( 'DOING_SYNCPILOT_TESTS' ) || ( defined( 'WP_CLI' ) && WP_CLI ) )
			return;

		if ( ! function_exists( 'wp_doing_ajax' ) || ! wp_doing_ajax() || empty( $_REQUEST['action'] ) || ! is_string( $_REQUEST['action'] ) || 0 !== strpos( $_REQUEST['action'], 'syncpilot_' ) )
			return;

		self::$installed = true;

		( new self( $plugin ) )->start( $_REQUEST['action'] );
	}

	/**
	 * @since   0.3.0
	 *
	 * @param   SyncPilot_Base $plugin  The plugin, for the log
	 */
	function __construct( $plugin ) {
		$this->plugin = $plugin;
	}

	/**
	 * Name the phase for the entries of the request, and catch what the handlers do not: an exception, a fatal error (also
	 * the time and the memory limit), and the "critical error" page that WordPress makes of it
	 * @since   0.3.0
	 *
	 * @param   string $action  The action of the request
	 */
	function start( $action ) {

		SyncPilot_Logger::set_phase( substr( $action, strlen( 'syncpilot_' ) ) );

		// the migration this request belongs to: the browser sends it as a field, the other site as a header
		$id = $_POST['migration_id'] ?? $_SERVER['HTTP_X_SYNCPILOT_MIGRATION'] ?? '';

		if ( is_string( $id ) && '' !== $id )
			SyncPilot_Logger::set_migration_id( substr( $id, 0, 40 ) );

		// memory that is given back when the memory limit is the reason, so that there is room to write the entry
		$this->reserve = str_repeat( ' ', 262144 );

		set_exception_handler( array( $this, 'handle_exception' ) );
		register_shutdown_function( array( $this, 'handle_shutdown' ) );

		// WordPress ends a fatal error with wp_die() in its own shutdown function, which runs before ours
		add_filter( 'wp_die_ajax_handler', array( $this, 'die_handler' ), 99 );

		// warnings and notices only help when somebody looks for a culprit: at the level verbose
		if ( SyncPilot_Logger::LEVEL_VERBOSE === SyncPilot_Logger::level() )
			set_error_handler( array( $this, 'handle_message' ) );
	}

	/**
	 * A warning, a notice or a deprecation of PHP during the request, from any code (the culprit may be another plugin).
	 * It is written to the log and then passed on: the handler of PHP goes on as if there were none. A message that was
	 * suppressed with @ is not written.
	 * @since   0.3.0
	 *
	 * @param   int    $number   The level of the message (E_WARNING...)
	 * @param   string $message  The message of PHP
	 * @param   string $file     The file
	 * @param   int    $line     The line
	 *
	 * @return  bool  false: PHP handles the message as well
	 */
	function handle_message( $number, $message, $file = '', $line = 0 ) {

		// an error that ends the request is the work of the shutdown function
		if ( in_array( $number, array( E_USER_ERROR, E_RECOVERABLE_ERROR ), true ) )
			return false;

		if ( ! ( error_reporting() & $number ) || $this->in_report || count( $this->messages ) >= self::MESSAGES_MAX )
			return false;

		$key = $number . ':' . $file . ':' . $line;

		if ( isset( $this->messages[ $key ] ) )
			return false;

		$this->messages[ $key ] = true;
		$this->in_report        = true;

		$kinds = array(
			E_WARNING => 'warning', E_USER_WARNING => 'warning', E_CORE_WARNING => 'warning', E_COMPILE_WARNING => 'warning',
			E_NOTICE => 'notice', E_USER_NOTICE => 'notice', E_DEPRECATED => 'deprecated', E_USER_DEPRECATED => 'deprecated',
		);

		$this->plugin->log_error( SyncPilot_HelpCode::PhpMessage, array(
			'kind'    => $kinds[ $number ] ?? 'other',
			'message' => $message,
			'file'    => $this->relative_path( $file ),
			'line'    => $line,
		), level: 'info', site: 1 );

		$this->in_report = false;

		return false;
	}

	/**
	 * An exception that nobody caught
	 * @since   0.3.0
	 *
	 * @param   Throwable $e  The exception or error
	 */
	function handle_exception( $e ) {

		$this->handled = true;

		$this->plugin->log_error( SyncPilot_HelpCode::UncaughtException, array(
			'class'   => get_class( $e ),
			'message' => $e->getMessage(),
			'file'    => $this->relative_path( $e->getFile() ),
			'line'    => $e->getLine(),
			'trace'   => $this->short_trace( $e ),
		), site: 1 );

		$this->answer( get_class( $e ) . ': ' . $e->getMessage() . ' (' . $this->relative_path( $e->getFile() ) . ':' . $e->getLine() . ')' );
	}

	/**
	 * The shutdown function: a fatal error ended the request
	 * @since   0.3.0
	 */
	function handle_shutdown() {
		$this->handle_fatal( false );
	}

	/**
	 * The handler of wp_die() for AJAX requests. WordPress calls wp_die() when a fatal error ended the request; this is
	 * the moment to answer in our way. Any other wp_die() goes the way it went.
	 * @since   0.3.0
	 *
	 * @param   callable|string $handler  The handler that WordPress would call
	 *
	 * @return  callable
	 */
	function die_handler( $handler ) {

		return function ( $message, $title = '', $args = array() ) use ( $handler ) {

			if ( $this->handle_fatal( true ) )
				return;

			call_user_func( $handler, $message, $title, $args );
		};
	}

	/**
	 * Log a fatal error and answer. Done once, it can be reached from wp_die() and from the shutdown function.
	 * @since   0.3.0
	 *
	 * @param   bool $in_die  Called from wp_die(): the output of WordPress is replaced, not appended to
	 *
	 * @return  bool  true when a fatal error was found
	 */
	protected function handle_fatal( $in_die ) {

		if ( $this->handled )
			return true;

		$error = error_get_last();

		if ( ! $error || ! in_array( $error['type'], array( E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR ), true ) )
			return false;

		$this->handled = true;
		$this->reserve = '';

		$context = array(
			'message' => $error['message'],
			'file'    => $this->relative_path( $error['file'] ),
			'line'    => $error['line'],
		);

		if ( false !== strpos( $error['message'], 'Maximum execution time' ) )
			$this->plugin->log_error( SyncPilot_HelpCode::PhpTimeLimit, array( 'max_execution_time' => (int) ini_get( 'max_execution_time' ) ) + $context, site: 1 );

		elseif ( false !== strpos( $error['message'], 'Allowed memory size' ) )
			$this->plugin->log_error( SyncPilot_HelpCode::PhpMemoryLimit, array( 'memory_limit' => ini_get( 'memory_limit' ), 'memory_peak' => memory_get_peak_usage( true ) ) + $context, site: 1 );

		else
			$this->plugin->log_error( SyncPilot_HelpCode::PhpFatalError, $context, site: 1 );

		$this->answer( $error['message'] . ' (' . $this->relative_path( $error['file'] ) . ':' . $error['line'] . ')' );

		return true;
	}

	/**
	 * Answer the request and end it. A user gets the reason, another site gets a short text without details.
	 * @since   0.3.0
	 *
	 * @param   string $reason  The reason, for a logged-in user only
	 */
	protected function answer( $reason ) {

		// what was written so far is part of a request that did not work
		while ( ob_get_level() > 0 )
			@ob_end_clean();

		if ( ! headers_sent() ) {
			header_remove( 'Content-Type' );
			header_remove( 'Content-Length' );
		}

		if ( 'admin' === SyncPilot_Logger::source() ) {

			if ( ! headers_sent() ) {
				http_response_code( 200 );
				header( 'Content-Type: application/json; charset=utf-8' );
			}

			echo wp_json_encode( array( 'syncpilot_error' => 1, 'body' => esc_html( $reason ) ) );
		}

		else {

			if ( ! headers_sent() ) {
				http_response_code( 500 );
				header( 'Content-Type: text/plain; charset=utf-8' );
			}

			echo 'SyncPilot: the request failed on this site, see the log of SyncPilot there';
		}

		exit;
	}

	/**
	 * A path relative to the WordPress folder, so that the log and the answer do not show where the site lives
	 * @since   0.3.0
	 *
	 * @param   string $path  An absolute path
	 *
	 * @return  string
	 */
	function relative_path( $path ) {

		$root = rtrim( wp_normalize_path( ABSPATH ), '/' ) . '/';
		$path = wp_normalize_path( (string) $path );

		return 0 === strpos( $path, $root ) ? substr( $path, strlen( $root ) ) : $path;
	}

	/**
	 * The first frames of the call stack: function, file and line; no arguments (they can hold keys and rows)
	 * @since   0.3.0
	 *
	 * @param   Throwable $e  The exception
	 *
	 * @return  string[]
	 */
	protected function short_trace( $e ) {

		$frames = array();

		foreach ( array_slice( $e->getTrace(), 0, 5 ) as $frame ) {
			$frames[] = ( isset( $frame['class'] ) ? $frame['class'] . '::' : '' ) . ( $frame['function'] ?? '' )
				. ( isset( $frame['file'] ) ? ' ' . $this->relative_path( $frame['file'] ) . ':' . ( $frame['line'] ?? 0 ) : '' );
		}

		return $frames;
	}
}
