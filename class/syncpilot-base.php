<?php
class SyncPilot_Base {
	const TEXT_DOMAIN = 'sync-pilot';

	// the folder of the exports and backups in the folder of the plugin gets this name, a dash and a part that cannot be guessed (@since 0.4.4)
	const EXPORT_FOLDER = 'exports';

	// the tables that are replaced are renamed to <this prefix><name> first and dropped when the migration has worked
	const OLD_TABLE_PREFIX = '_old_';

	protected $settings;
	protected $plugin_file_path;
	protected $plugin_dir_path;
	protected $plugin_slug;
	protected $plugin_folder_name;
	protected $plugin_basename;
	protected $plugin_base;
	protected $plugin_version;
	protected $template_dir;
	protected $plugin_title;
	protected $transient_timeout;
	protected $transient_retry_timeout;
	protected $multipart_boundary = 'bWH4JVmYCnf6GfXacrcc';
	protected $attempting_to_connect_to;
	protected $error;
	protected $temp_prefix = '_mig_';
	protected $invalid_content_verification_error;
	protected $doing_cli_migration = false;

	/**
	 * One-time import of the settings (API key, permissions, saved profiles)
	 * of WP Sync DB. The old option is copied, never modified or deleted, so
	 * the old plugin keeps working if it is still installed.
	 */
	static function migrate_legacy_settings() {

		if ( false !== get_option( 'syncpilot_settings' ) )
			return;

		$legacy_settings = get_option( 'wpsdb_settings' );

		if ( empty( $legacy_settings ) || ! is_array( $legacy_settings ) )
			return;

		update_option( 'syncpilot_settings', $legacy_settings );
		update_option( 'syncpilot_legacy_migrated', time() );
	}

	/**
	 * Read the settings and set up the paths. Nothing is translated here: the constructor runs on plugins_loaded, and
	 * WordPress 6.7 and later report a text domain that is used before init as loaded too early
	 * @since   0.1.0
	 * @since   0.3.0  Guards the AJAX requests of the plugin (SyncPilot_Request_Guard)
	 *
	 * @param   string $plugin_file_path  The main file of the plugin
	 */
	function __construct( $plugin_file_path ) {

		$this->settings = get_option( 'syncpilot_settings' );

		add_action( 'init', array( $this, 'set_translated_texts' ), 20 );

		$this->transient_timeout      = 60 * 60 * 12;
		$this->transient_retry_timeout = 60 * 60 * 2;

		$this->plugin_file_path   = $plugin_file_path;
		$this->plugin_dir_path    = plugin_dir_path( $plugin_file_path );
		$this->plugin_folder_name = basename( $this->plugin_dir_path );
		$this->plugin_basename    = plugin_basename( $plugin_file_path );
		$this->template_dir       = $this->plugin_dir_path . 'template' . DS;
		$this->plugin_title       = 'SyncPilot';

		if ( is_multisite() )
			$this->plugin_base = 'settings.php?page=sync-pilot';

		else
			$this->plugin_base = 'tools.php?page=sync-pilot';

		// allow devs to change the temporary prefix applied to the tables
		$this->temp_prefix = apply_filters( 'syncpilot_temporary_prefix', $this->temp_prefix );

		// an exception or a fatal error in an AJAX request of ours is logged and answered, not left to the critical error page
		SyncPilot_Request_Guard::install( $this );
	}

	/**
	 * Translate the texts that are kept in properties. It runs on init after the text domain is loaded (priority 10
	 * in syncpilot_init()); every use of the texts is in a request handler or on the admin page, which come later
	 * @since   0.2.6
	 */
	function set_translated_texts() {

		$this->invalid_content_verification_error = __( 'Invalid content verification signature, please verify the connection data on the remote site and try again.', self::TEXT_DOMAIN );
	}

	function template( $template ) {
		include $this->template_dir . $template . '.php';
	}

	function open_ssl_enabled() {

		if ( defined( 'OPENSSL_VERSION_TEXT' ) )
			return true;

		return false;
	}

	function set_time_limit() {
		if ( function_exists( 'set_time_limit' ) )
			@set_time_limit( 0 );
	}

	// "Enable SSL verification" in the settings: check the TLS certificate of the other site
	function verify_ssl() {
		return ! empty( $this->settings['verify_ssl'] );
	}

	// The connection test may fall back from https to http only if the certificate is not verified anyway,
	// otherwise a network attacker could force the downgrade and read everything that follows
	function may_retry_over_http( $url, $scope ) {
		return 0 === strpos( $url, 'https://' ) && 'ajax_verify_connection_to_remote_site' === $scope && ! $this->verify_ssl();
	}

	// unserialize() for data from another site, a request or the database: no object is created, so no
	// __wakeup() or __destruct() of any class can run
	function safe_unserialize( $data ) {
		return @unserialize( $data, array( 'allowed_classes' => false ) );
	}

	/**
	 * Send a signed request to the other site and check the answer
	 * @since   0.0.1
	 * @since   0.3.0  Sends the ID of the migration to the other site (header X-SyncPilot-Migration). Every failure is logged with its own help code (RemoteTimeout, RemoteHostNotFound, RemoteTlsFailed, RemoteRequestFailed, RemoteAuthRequired, RemoteHttpError, RemoteAnswerInvalid, RemotePluginMissing) and the facts of describe_remote_response() as context (scope, duration, sizes, status or cURL number, a cleaned beginning of the answer); at the level verbose every answered request is logged without the answer
	 *
	 * @param   string $url               The address of admin-ajax.php of the other site
	 * @param   array  $data              The fields of the request
	 * @param   string $scope             The function that asks, for the log
	 * @param   array  $args              Arguments of wp_remote_post()
	 * @param   bool   $expecting_serial  The answer has to be serialized data
	 *
	 * @return  string|false  The answer; false when it failed (the text for the user is in $this->error)
	 */
	function remote_post( $url, $data, $scope, $args = array(), $expecting_serial = false ) {

		$this->set_time_limit();

		if ( function_exists( 'fsockopen' ) && $this->may_retry_over_http( $url, $scope ) ) {

			$url_parts = parse_url( $url );
			$host      = $url_parts['host'];

			if ( $pf = @fsockopen( $host, 443, $err, $err_string, 1 ) ) //worked
				fclose( $pf );

			else // failed
				$url = substr_replace( $url, 'http', 0, 5 );
		}

		$default_remote_post_timeout = apply_filters( 'syncpilot_default_remote_post_timeout', 60 * 20 );

		$args = wp_parse_args( $args, array(
			'timeout'   => $default_remote_post_timeout,
			'blocking'  => true,
			'sslverify'	=> $this->verify_ssl(),
		) );

		$args['method'] = 'POST';

		if ( ! isset( $args['body'] ) )
			$args['body'] = $this->array_to_multipart( $data );

		$args['headers']['Content-Type'] = 'multipart/form-data; boundary=' . $this->multipart_boundary;
		$args['headers']['Referer']      = network_admin_url( 'admin-ajax.php' );

		// the other site writes the same ID in its log; the header is not part of the signature
		if ( '' !== SyncPilot_Logger::migration_id() )
			$args['headers']['X-SyncPilot-Migration'] = SyncPilot_Logger::migration_id();

		$this->attempting_to_connect_to = $url;

		$started  = microtime( true );
		$response = wp_remote_post( $url, $args );

		if ( ! is_wp_error( $response ) )
			$response['body'] = trim( $response['body'], "\xef\xbb\xbf" );

		$context = array( 'scope' => $scope ) + $this->describe_remote_response( $response, $started, strlen( (string) ( $args['body'] ?? '' ) ) );

		if ( is_wp_error( $response ) ) {

			if ( $this->may_retry_over_http( $url, $scope ) ) {
				return $this->retry_remote_post( $url, $data, $scope, $args, $expecting_serial );
			}

			else if ( isset( $response->errors['http_request_failed'][0] ) && strstr( $response->errors['http_request_failed'][0], 'timed out' ) ) {
				$this->error = sprintf( __( 'The connection to the remote server has timed out, no changes have been committed. (#134 - scope: %s)', self::TEXT_DOMAIN ), $scope );

				$this->log_error( SyncPilot_HelpCode::RemoteTimeout, $context, site: 1 );
			}

			else if ( isset( $response->errors['http_request_failed'][0] ) && ( strstr( $response->errors['http_request_failed'][0], 'Could not resolve host' ) || strstr( $response->errors['http_request_failed'][0], 'couldn\'t connect to host' ) ) ) {
				$this->error = sprintf( __( 'We could not find: %s. Are you sure this is the correct URL?', self::TEXT_DOMAIN ), $_POST['url'] );
				$url_bits = parse_url( $_POST['url'] );
				if( strstr( $_POST['url'], 'dev.' ) || strstr( $_POST['url'], '.dev' ) || ! strstr( $url_bits['host'], '.' ) ) {
					$this->error .= '<br />';
					if( $_POST['intent'] == 'pull' ) {
						$this->error .= __( 'It appears that you might be trying to pull from a local environment. This will not work if <u>this</u> website happens to be located on a remote server, it would be impossible for this server to contact your local environment.', self::TEXT_DOMAIN );
					}
					else {
						$this->error .= __( 'It appears that you might be trying to push to a local environment. This will not work if <u>this</u> website happens to be located on a remote server, it would be impossible for this server to contact your local environment.', self::TEXT_DOMAIN );
					}
				}

				$this->log_error( SyncPilot_HelpCode::RemoteHostNotFound, $context, site: 1 );
			}

			else if ( isset( $response->errors['http_request_failed'][0] ) && preg_match( '/ssl|certificate|tls/i', $response->errors['http_request_failed'][0] ) ) {
				$this->error = sprintf( __( 'The TLS certificate of the remote site could not be verified. Install a valid certificate there or switch off "Enable SSL verification" in the settings. (#139 - scope: %s)', self::TEXT_DOMAIN ), $scope );

				$this->log_error( SyncPilot_HelpCode::RemoteTlsFailed, $context, site: 1 );
			}

			else {
				$this->error = sprintf( __( 'The connection failed, an unexpected error occurred, please contact support. (#121 - scope: %s)', self::TEXT_DOMAIN ), $scope );

				$this->log_error( SyncPilot_HelpCode::RemoteRequestFailed, $context, site: 1 );
			}

			return false;
		}

		elseif ( (int) $response['response']['code'] < 200 || (int) $response['response']['code'] > 399 ) {

			if ( $this->may_retry_over_http( $url, $scope ) ) {
				return $this->retry_remote_post( $url, $data, $scope, $args, $expecting_serial );
			}

			else if ( $response['response']['code'] == '401' ) {
				$this->error = __( 'The remote site is protected with Basic Authentication. Please enter the username and password above to continue. (401 Unauthorized)', self::TEXT_DOMAIN );

				$this->log_error( SyncPilot_HelpCode::RemoteAuthRequired, $context, site: 1 );

				return false;
			}

			// not WordPress: a firewall or a proxy in front of the site has answered, the request did not get there
			else if ( empty( $context['from_wordpress'] ) ) {
				$this->error = $this->not_wordpress_text( $response['response']['code'], $context['block_ids'] ?? array(), $scope );

				$this->log_error( SyncPilot_HelpCode::RemoteNotWordPress, $context, site: 1 );

				return false;
			}

			else {
				$this->error = sprintf( __( 'Unable to connect to the remote server, please check the connection details - %1$s %2$s (#129 - scope: %3$s)', self::TEXT_DOMAIN ), $response['response']['code'], $response['response']['message'], $scope );

				$this->log_error( SyncPilot_HelpCode::RemoteHttpError, $context, site: 1 );

				return false;
			}
		}

		elseif ( $expecting_serial && is_serialized( $response['body'] ) == false ) {
			if ( $this->may_retry_over_http( $url, $scope ) )
				return $this->retry_remote_post( $url, $data, $scope, $args, $expecting_serial );

			// a page of HTML that did not come from WordPress: a firewall or a proxy has answered (a page that says "blocked" with the status 200)
			if ( empty( $context['from_wordpress'] ) && preg_match( '/<(?:!DOCTYPE|html|body)\b/i', $response['body'] ) ) {
				$this->error = $this->not_wordpress_text( $response['response']['code'], $context['block_ids'] ?? array(), $scope );

				$this->log_error( SyncPilot_HelpCode::RemoteNotWordPress, $context, site: 2 );

				return false;
			}

			$this->error = __( 'There was a problem with the AJAX request, we were expecting a serialized response, instead we received:<br />', self::TEXT_DOMAIN ) . htmlentities( $response['body'] );

			$this->log_error( SyncPilot_HelpCode::RemoteAnswerInvalid, $context, site: 1 );

			return false;
		}

		elseif ( $response['body'] === '0' ) {
			if( $this->may_retry_over_http( $url, $scope ) )
				return $this->retry_remote_post( $url, $data, $scope, $args, $expecting_serial );


			$this->error = sprintf( __( 'SyncPilot does not seem to be installed or active on the remote site. (#131 - scope: %s)', self::TEXT_DOMAIN ), $scope );

			$this->log_error( SyncPilot_HelpCode::RemotePluginMissing, $context, site: 1 );

			return false;
		}

		elseif ( $expecting_serial && is_serialized( $response['body'] ) == true && $scope == 'ajax_verify_connection_to_remote_site' ) {

			$unserialized_response = $this->safe_unserialize( $response['body'] );

			if ( isset( $unserialized_response['error'] ) && '1' == $unserialized_response['error'] && $this->may_retry_over_http( $url, $scope ) )
				return $this->retry_remote_post( $url, $data, $scope, $args, $expecting_serial );
		}

		// at the level verbose every request to the other site: how long it took and how big it was, no answer
		unset( $context['excerpt'] );
		SyncPilot_Logger::info( 'Remote request answered', $context );

		return $response['body'];
	}

	/**
	 * The message for an answer that did not come from WordPress
	 * @since   0.3.1
	 *
	 * @param   int|string $status  The HTTP status of the answer
	 * @param   array      $ids     The reference numbers of the block page (SyncPilot_Logger::block_ids())
	 * @param   string     $scope   The function that made the request
	 *
	 * @return  string
	 */
	function not_wordpress_text( $status, $ids, $scope ) {

		$text = sprintf( __( 'The remote site did not answer through WordPress (HTTP %s): a firewall or a proxy in front of it has probably blocked the request. The administrator of that server can allow the requests of SyncPilot, they go to admin-ajax.php with an action that starts with syncpilot_.', self::TEXT_DOMAIN ), (int) $status );

		if ( $ids ) {

			$list = array();

			foreach ( $ids as $name => $number )
				$list[] = esc_html( $name . ': ' . $number );

			$text .= ' ' . sprintf( __( 'The block page gives: %s.', self::TEXT_DOMAIN ), implode( ', ', $list ) );
		}

		return $text . ' ' . sprintf( __( '(#153 - scope: %s)', self::TEXT_DOMAIN ), $scope );
	}

	function retry_remote_post( $url, $data, $scope, $args = array(), $expecting_serial = false ) {

		if ( ! $this->may_retry_over_http( $url, $scope ) )
			return false;

		$url = substr_replace( $url, 'http', 0, 5 );

		if ( $response = $this->remote_post( $url, $data, $scope, $args, $expecting_serial ) )
			return $response;

		return false;
	}

	function array_to_multipart( $data ) {

		if ( ! $data || ! is_array( $data ) )
			return $data;

		$result = '';

		foreach ( $data as $key => $value ) {

			$result .= '--' . $this->multipart_boundary . "\r\n" .
				sprintf( 'Content-Disposition: form-data; name="%s"', $key );

			if ( 'chunk' == $key ) {
				if ( $data['chunk_gzipped'] )
					$result .= "; filename=\"chunk.txt.gz\"\r\nContent-Type: application/x-gzip";

				else
					$result .= "; filename=\"chunk.txt\"\r\nContent-Type: text/plain;";
			}

			else
				$result .= "\r\nContent-Type: text/plain; charset=" . get_option( 'blog_charset' );

			$result .= "\r\n\r\n" . $value . "\r\n";
		}

		$result .= "--" . $this->multipart_boundary . "--\r\n";

		return $result;
	}

	function file_to_multipart( $file ) {

		$result = '';

		if ( false == file_exists( $file ) )
			return false;

		$filetype = wp_check_filetype( $file );
		$contents = file_get_contents( $file );

		$result .= '--' . $this->multipart_boundary . "\r\n" .
			sprintf( 'Content-Disposition: form-data; name="media[]"; filename="%s"', basename( $file ) );

		$result .= sprintf( "\r\nContent-Type: %s", $filetype['type'] );

		$result .= "\r\n\r\n" . $contents . "\r\n";

		$result .= "--" . $this->multipart_boundary . "--\r\n";

		return $result;
	}

	/**
	 * Add an entry to the log (see SyncPilot_Logger). What went wrong is the English text of the help code, the facts that
	 * belong to it (names, sizes, status) are the context. The data of a request is described and never copied: the public
	 * endpoints log requests of anyone, before the signature is known to be right, and such a request can be as big as the
	 * server accepts and contains SQL rows, the signature and keys.
	 * The place that wrote the entry is named twice: by the number of the site (130.02 is the second place that reports
	 * code 130, numbered by hand, a test makes sure that no number is used twice) and by the function that called.
	 * @since   0.2.3
	 * @since   0.3.0  Takes a help code and a context instead of a text; writes to SyncPilot_Logger (a JSON line in a file) instead of the option syncpilot_error_log
	 *
	 * @param   SyncPilot_HelpCode $code     What went wrong
	 * @param   array              $context  Names and sizes that belong to it; request data, a response or an error object are described
	 * @param   int                $site     The number of the place in the code that reports this code, 1 and up
	 * @param   string             $level    error, or info for what is only written at the level verbose
	 */
	function log_error( SyncPilot_HelpCode $code, $context = array(), $site = 0, $level = 'error' ) {

		$trace  = debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS, 2 );
		$caller = isset( $trace[1]['function'] ) ? ( isset( $trace[1]['class'] ) ? $trace[1]['class'] . '::' : '' ) . $trace[1]['function'] : '';
		$fields = array( 'help' => $code->value );

		if ( $site > 0 )
			$fields['site'] = (int) $site;

		if ( '' !== $caller )
			$fields['at'] = $caller . ( isset( $trace[0]['line'] ) ? ':' . $trace[0]['line'] : '' );

		if ( ! empty( $this->attempting_to_connect_to ) )
			$context['connecting_to'] = SyncPilot_Logger::strip_credentials( $this->attempting_to_connect_to );

		if ( ! empty( $_SERVER['CONTENT_LENGTH'] ) )
			$context['request_bytes'] = (int) $_SERVER['CONTENT_LENGTH'];

		SyncPilot_Logger::write( $level, $code->log_text(), $context, $fields );
	}

	/**
	 * What is known about a request to the other site and its answer, for the log: how long it took, how much was sent and
	 * received, and for an answer the status, a few headers (type, server, where it redirects to) and a cleaned beginning
	 * of the body (see SyncPilot_Logger::excerpt()); for a request that failed the message of cURL and its number.
	 * @since   0.3.0
	 * @since   0.3.1  Says whether the answer came from WordPress (from_wordpress: the header X-Robots-Tag that admin-ajax.php always sends), and names the reference numbers of a block page (block_ids)
	 *
	 * @param   array|WP_Error $response    The result of wp_remote_post()
	 * @param   float          $started     microtime( true ) before the request
	 * @param   int            $sent_bytes  The size of the body that was sent
	 *
	 * @return  array
	 */
	function describe_remote_response( $response, $started, $sent_bytes ) {

		$facts = array(
			'duration_ms' => (int) round( ( microtime( true ) - $started ) * 1000 ),
			'sent_bytes'  => (int) $sent_bytes,
		);

		if ( is_wp_error( $response ) ) {

			$message = $response->get_error_message();

			$facts['error'] = SyncPilot_Logger::shorten( $message, 300 );

			if ( preg_match( '/cURL error (\d+)/', $message, $found ) )
				$facts['curl_errno'] = (int) $found[1];

			return $facts;
		}

		$body = (string) wp_remote_retrieve_body( $response );

		$facts['status']         = (int) wp_remote_retrieve_response_code( $response );
		$facts['status_text']    = SyncPilot_Logger::shorten( (string) wp_remote_retrieve_response_message( $response ), 60 );
		$facts['received_bytes'] = strlen( $body );

		foreach ( array( 'content-type', 'server', 'location' ) as $header ) {

			$value = wp_remote_retrieve_header( $response, $header );

			if ( is_string( $value ) && '' !== $value )
				$facts[ 'header_' . str_replace( '-', '_', $header ) ] = SyncPilot_Logger::shorten( SyncPilot_Logger::strip_credentials( $value ), 120 );
		}

		// admin-ajax.php of WordPress always sends this header, also with an error: an answer without it came from something else
		$facts['from_wordpress'] = (bool) preg_match( '/noindex/i', (string) implode( ',', (array) wp_remote_retrieve_header( $response, 'x-robots-tag' ) ) );

		if ( ! $facts['from_wordpress'] && ( $ids = SyncPilot_Logger::block_ids( $body ) ) )
			$facts['block_ids'] = $ids;

		$facts['excerpt'] = SyncPilot_Logger::excerpt( $body );

		return $facts;
	}

	/**
	 * The reason PHP gave for the last error, for an operation that failed silently (it was called with @)
	 * @since   0.3.0
	 *
	 * @return  string  The message; an empty text when there was no error
	 */
	function last_php_error() {

		$error = error_get_last();

		return $error ? SyncPilot_Logger::shorten( $error['message'], 300 ) : '';
	}

	/**
	 * What decides whether a folder can be written, for the log: the nearest folder that exists (the one that was asked for
	 * may not), if it is writable, its mode and owner, and the user the web server runs as. Names and numbers only.
	 * @since   0.3.0
	 *
	 * @param   string $folder  The folder, it may not exist yet
	 * @param   array  $facts   Facts to add to
	 *
	 * @return  array
	 */
	function folder_facts( $folder, $facts = array() ) {

		$existing = (string) $folder;

		while ( '' !== $existing && ! file_exists( $existing ) && dirname( $existing ) !== $existing )
			$existing = dirname( $existing );

		$facts['checked']  = $existing;
		$facts['exists']   = file_exists( (string) $folder );
		$facts['writable'] = is_writable( $existing );
		$facts['mode']     = substr( sprintf( '%o', (int) @fileperms( $existing ) ), -4 );

		if ( function_exists( 'posix_getpwuid' ) ) {

			$owner = @posix_getpwuid( (int) @fileowner( $existing ) );
			$user  = @posix_getpwuid( posix_geteuid() );

			$facts['owner']    = $owner['name'] ?? '';
			$facts['web_user'] = $user['name'] ?? '';
		}

		$facts['php_reason'] = $this->last_php_error();

		return $facts;
	}

	function display_errors() {

		if ( ! empty( $this->error ) ) {
			echo $this->error;

			$this->error = '';

			return true;
		}

		return false;
	}

	function filter_post_elements( $post_array, $accepted_elements ) {

		if ( isset( $post_array['form_data'] ) )
			$post_array['form_data'] = stripslashes( $post_array['form_data'] );

		$accepted_elements[] = 'sig';

		return array_intersect_key( $post_array, array_flip( $accepted_elements ) );
	}

	// The signature is "<timestamp>.<base64 HMAC-SHA256>". The HMAC covers the timestamp and every field with its name
	// and with the length of name and value, so values cannot be moved from one field to another, and a request that
	// was recorded can only be replayed for a few minutes
	function create_signature( $data, $key ) {

		if ( isset( $data['sig'] ) )
			unset( $data['sig'] );

		$timestamp = time();

		return $timestamp . '.' . base64_encode( hash_hmac( 'sha256', $this->signature_payload( $data, $timestamp ), $key, true ) );
	}

	function signature_payload( $data, $timestamp ) {

		$payload = $timestamp . '|';

		foreach ( $data as $name => $value ) {

			$value    = is_scalar( $value ) ? (string) $value : json_encode( $value );
			$payload .= strlen( $name ) . ':' . $name . strlen( $value ) . ':' . $value . ';';
		}

		return $payload;
	}

	function verify_signature( $data, $key ) {

		if ( empty( $data['sig'] ) || ! is_string( $data['sig'] ) )
			return false;

		if ( isset( $data['nonce'] ) )
			unset( $data['nonce'] );

		$parts = explode( '.', $data['sig'], 2 );

		if ( 2 !== count( $parts ) || ! ctype_digit( $parts[0] ) )
			return false;

		$timestamp = (int) $parts[0];
		$window    = (int) apply_filters( 'syncpilot_signature_window', 10 * MINUTE_IN_SECONDS );

		if ( abs( time() - $timestamp ) > $window )
			return false;

		unset( $data['sig'] );

		$computed_signature = base64_encode( hash_hmac( 'sha256', $this->signature_payload( $data, $timestamp ), $key, true ) );

		return hash_equals( $computed_signature, $parts[1] );
	}

	function diverse_array( $vector ) {

		$result = array();

		foreach( $vector as $key1 => $value1 )
			foreach( $value1 as $key2 => $value2 )
				$result[ $key2 ][ $key1 ] = $value2;

		return $result;
	}

	function set_time_limit_available() {

		if ( ! function_exists( 'set_time_limit' ) || ! function_exists( 'ini_get' ) )
			return false;

		$current_max_execution_time  = ini_get( 'max_execution_time' );
		$proposed_max_execution_time = ( $current_max_execution_time == 30 ) ? 31 : 30;

		@set_time_limit( $proposed_max_execution_time );

		$current_max_execution_time = ini_get( 'max_execution_time' );

		return ( $proposed_max_execution_time == $current_max_execution_time );
	}

	function get_plugin_name( $plugin = false ) {

		if ( ! is_admin() )
			return false;

		$plugin_basename = ( false !== $plugin ? $plugin : $this->plugin_basename );

		$plugins = get_plugins();

		if ( ! isset( $plugins[ $plugin_basename ]['Name'] ) )
			return false;


		return $plugins[ $plugin_basename ]['Name'];
	}

	function get_class_props() {
		return get_object_vars( $this );
	}

	// Get only the table beginning with our DB prefix or temporary prefix, also skip views
	function get_tables( $scope = 'regular' ) {

		global $wpdb;

		$prefix = ( $scope == 'temp' ? $this->temp_prefix : $wpdb->prefix );
		$tables = $wpdb->get_results( 'SHOW FULL TABLES', ARRAY_N );

		foreach ( $tables as $table ) {

			if ( ( ( $scope == 'temp' || $scope == 'prefix' ) && 0 !== strpos( $table[0], $prefix ) ) || $table[1] == 'VIEW' )
				continue;

			$clean_tables[] = $table[0];
		}

		return apply_filters( 'syncpilot_tables', $clean_tables, $scope );
	}

	function plugins_dir() {
		$path = untrailingslashit( $this->plugin_dir_path );

		return substr( $path, 0, strrpos( $path, DS ) ) . DS;
	}

	function get_plugin_file_path() {
		return $this->plugin_file_path;
	}

	function set_cli_migration() {
		$this->doing_cli_migration = true;
	}

	function end_ajax( $return = false ) {

		if( defined( 'DOING_SYNCPILOT_TESTS' ) || $this->doing_cli_migration )
			return ( false === $return ) ? NULL : $return;

		echo ( false === $return ) ? '' : $return;

		exit;
	}

	function check_ajax_referer( $action ) {

		if ( defined( 'DOING_SYNCPILOT_TESTS' ) || $this->doing_cli_migration )
			return;

		$result = check_ajax_referer( $action, 'nonce', false );

		if ( false === $result ) {
			$return = array( 'syncpilot_error' => 1, 'body' => sprintf( __( 'Invalid nonce for: %s', self::TEXT_DOMAIN ), $action ) );

			$this->end_ajax( json_encode( $return ) );
		}

		$cap = ( is_multisite() ) ? 'manage_network_options' : 'export';
		$cap = apply_filters( 'syncpilot_ajax_cap', $cap );

		if ( ! current_user_can( $cap ) ) {
			$return = array( 'syncpilot_error' => 1, 'body' => sprintf( __( 'Access denied for: %s', self::TEXT_DOMAIN ), $action ) );

			$this->end_ajax( json_encode( $return ) );
		}
	}

	/**
	 * Replace in a serialized value without unserializing it. The text is read once from the front to the back and written
	 * again, the strings that are values (not the keys of an array or the names of the properties of an object) go through
	 * $leaf and get their new length. Everything else is copied as it is: numbers, references (r: and R:), the class names,
	 * custom serialized data (C:). So the memory is the size of the text twice, whatever the data look like. The function recursive_unserialize_replace()
	 * unserializes the text and builds it again, which makes a copy of
	 * every object that is used twice: a serialized object graph of 764 bytes with a depth of 18 became 22 MB there, and
	 * every further level doubles it (and the references are gone afterwards).
	 * @since   0.4.0
	 * @since   0.4.1  Moved from SyncPilot_Import to SyncPilot_Base: a push and a pull use it too
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
	 * The statement with everything replaced that is not code: the text of a string becomes '', the name between backticks
	 * becomes ``, a comment becomes a space (a comment that a server of some version runs, /*!50100 ... *\/, stays: it is
	 * code). What is looked for in a statement (SELECT, a variable) is looked for in this text, so that a word in a post
	 * or in the name of a column is no word of the statement. It is made with a loop like the reader's, not with a
	 * pattern: a pattern for a string of a megabyte runs into the limits of PCRE.
	 * @since   0.4.0
	 * @since   0.4.1  Moved from SyncPilot_Import to SyncPilot_Base: a push and a pull map the collations too
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
	 * The collations and character sets that a CREATE TABLE names
	 * @since   0.4.0
	 * @since   0.4.1  Moved from SyncPilot_Import to SyncPilot_Base: a push and a pull map the collations too
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
	 * @since   0.4.1  Moved from SyncPilot_Import to SyncPilot_Base: a push and a pull map the collations too
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
	 * @since   0.4.1  Moved from SyncPilot_Import to SyncPilot_Base: a push and a pull map the collations too
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
	 * @since   0.4.1  Moved from SyncPilot_Import to SyncPilot_Base: a push and a pull map the collations too
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
	 * @since   0.4.1  Moved from SyncPilot_Import to SyncPilot_Base: a push and a pull map the collations too
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
	 * A statement in pieces: the code and what is not code (a string, a name between backticks) one after the other, the code at
	 * the even places and the strings and names at the odd ones, so that implode() gives the statement again
	 * @since   0.4.1
	 *
	 * @param   string $sql  A statement, as small as a CREATE TABLE (the pattern is not made for a string of a megabyte)
	 *
	 * @return  array
	 */
	static function split_code( $sql ) {

		$pieces = preg_split( '/(\'(?:[^\'\\\\]|\\\\.|\'\')*\'|"(?:[^"\\\\]|\\\\.|"")*"|`(?:[^`]|``)*`)/s', $sql, -1, PREG_SPLIT_DELIM_CAPTURE );

		return false === $pieces ? array( $sql ) : $pieces;
	}

	/**
	 * The statement with the collations and character sets that were mapped (see map_collation()) in place of the ones of
	 * the dump. Only the names that are in the map are touched, behind COLLATE, COLLATE=, CHARSET= and CHARACTER SET.
	 * @since   0.4.0
	 * @since   0.4.1  Moved from SyncPilot_Import to SyncPilot_Base: a push and a pull map the collations too; strings, comments and names between backticks are not touched
	 *
	 * @param   string $sql      A CREATE TABLE statement
	 * @param   array  $map      collations and charsets: name of the dump => name that this database knows
	 *
	 * @return  string
	 */
	static function apply_collation_map( $sql, $map ) {

		// the text of a string, a comment of the table or a column and a name between backticks are not code: only the pieces between them are changed
		$pieces = self::split_code( $sql );

		foreach ( $pieces as $i => $piece ) {

			if ( $i % 2 )
				continue;

			foreach ( $map['collations'] ?? array() as $from => $to )
				$piece = preg_replace( '/\b(COLLATE\s*=?\s*)' . preg_quote( $from, '/' ) . '\b/i', '${1}' . $to, $piece );

			foreach ( $map['charsets'] ?? array() as $from => $to )
				$piece = preg_replace( '/\b((?:CHARACTER\s+SET|CHARSET)\s*=?\s*)' . preg_quote( $from, '/' ) . '\b/i', '${1}' . $to, $piece );

			$pieces[ $i ] = $piece;
		}

		return implode( '', $pieces );
	}

}
