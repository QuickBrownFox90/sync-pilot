<?php
class SyncPilot_Base {
	const TEXT_DOMAIN = 'sync-pilot';

	// the tables that are replaced are renamed to <this prefix><name> first and dropped when the migration has worked
	const OLD_TABLE_PREFIX = '_old_';

	// the error log keeps its newest entries up to this size; one entry is cut at the second size
	const LOG_MAX_BYTES       = 102400;
	const LOG_ENTRY_MAX_BYTES = 4096;

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

		$this->attempting_to_connect_to = $url;

		$response = wp_remote_post( $url, $args );

		if ( ! is_wp_error( $response ) )
			$response['body'] = trim( $response['body'], "\xef\xbb\xbf" );

		if ( is_wp_error( $response ) ) {

			if ( $this->may_retry_over_http( $url, $scope ) ) {
				return $this->retry_remote_post( $url, $data, $scope, $args, $expecting_serial );
			}

			else if ( isset( $response->errors['http_request_failed'][0] ) && strstr( $response->errors['http_request_failed'][0], 'timed out' ) ) {
				$this->error = sprintf( __( 'The connection to the remote server has timed out, no changes have been committed. (#134 - scope: %s)', self::TEXT_DOMAIN ), $scope );
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
			}

			else if ( isset( $response->errors['http_request_failed'][0] ) && preg_match( '/ssl|certificate|tls/i', $response->errors['http_request_failed'][0] ) ) {
				$this->error = sprintf( __( 'The TLS certificate of the remote site could not be verified. Install a valid certificate there or switch off "Enable SSL verification" in the settings. (#139 - scope: %s)', self::TEXT_DOMAIN ), $scope );
			}

			else {
				$this->error = sprintf( __( 'The connection failed, an unexpected error occurred, please contact support. (#121 - scope: %s)', self::TEXT_DOMAIN ), $scope );
			}

			$this->log_error( $this->error, $response );

			return false;
		}

		elseif ( (int) $response['response']['code'] < 200 || (int) $response['response']['code'] > 399 ) {

			if ( $this->may_retry_over_http( $url, $scope ) ) {
				return $this->retry_remote_post( $url, $data, $scope, $args, $expecting_serial );
			}

			else if ( $response['response']['code'] == '401' ) {
				$this->error = __( 'The remote site is protected with Basic Authentication. Please enter the username and password above to continue. (401 Unauthorized)', self::TEXT_DOMAIN );

				$this->log_error( $this->error, $response );

				return false;
			}

			else {
				$this->error = sprintf( __( 'Unable to connect to the remote server, please check the connection details - %1$s %2$s (#129 - scope: %3$s)', self::TEXT_DOMAIN ), $response['response']['code'], $response['response']['message'], $scope );

				$this->log_error( $this->error, $response );
				return false;
			}
		}

		elseif ( $expecting_serial && is_serialized( $response['body'] ) == false ) {
			if ( $this->may_retry_over_http( $url, $scope ) )
				return $this->retry_remote_post( $url, $data, $scope, $args, $expecting_serial );

			$this->error = __( 'There was a problem with the AJAX request, we were expecting a serialized response, instead we received:<br />', self::TEXT_DOMAIN ) . htmlentities( $response['body'] );

			$this->log_error( $this->error, $response );

			return false;
		}

		elseif ( $response['body'] === '0' ) {
			if( $this->may_retry_over_http( $url, $scope ) )
				return $this->retry_remote_post( $url, $data, $scope, $args, $expecting_serial );


			$this->error = sprintf( __( 'SyncPilot does not seem to be installed or active on the remote site. (#131 - scope: %s)', self::TEXT_DOMAIN ), $scope );

			$this->log_error( $this->error, $response );

			return false;
		}

		elseif ( $expecting_serial && is_serialized( $response['body'] ) == true && $scope == 'ajax_verify_connection_to_remote_site' ) {

			$unserialized_response = $this->safe_unserialize( $response['body'] );

			if ( isset( $unserialized_response['error'] ) && '1' == $unserialized_response['error'] && $this->may_retry_over_http( $url, $scope ) )
				return $this->retry_remote_post( $url, $data, $scope, $args, $expecting_serial );
		}

		return $response['body'];
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
	 * Add an entry to the error log. The log is an option that is not loaded on every request, it keeps only its newest
	 * LOG_MAX_BYTES, and the data that belongs to an error is described and never copied: the public endpoints log
	 * requests of anyone, before the signature is known to be right, and such a request can be as big as the server
	 * accepts and contains SQL rows, the signature and keys
	 * @since   0.2.3
	 * @param   string $syncpilot_error       What went wrong
	 * @param   mixed  $additional_error_var  Request data, a response or an error object; false for nothing
	 */
	function log_error( $syncpilot_error, $additional_error_var = false ) {

		$error_header = "********************************************\n******  Log date: " . date( 'Y/m/d H:i:s' ) . " ******\n********************************************\n\n";
		$error        = $error_header . "SyncPilot Error: " . $this->shorten_log_text( (string) $syncpilot_error, 2000 ) . "\n\n";

		if ( ! empty( $this->attempting_to_connect_to ) )
			$error .= "Attempted to connect to: " . $this->shorten_log_text( (string) $this->attempting_to_connect_to, 300 ) . "\n\n";

		if ( ! empty( $_SERVER['CONTENT_LENGTH'] ) )
			$error .= "Size of the request: " . (int) $_SERVER['CONTENT_LENGTH'] . " bytes\n\n";

		if ( $additional_error_var !== false )
			$error .= $this->describe_log_data( $additional_error_var ) . "\n";

		$this->save_error_log( (string) get_option( 'syncpilot_error_log' ), $this->cut_log_text( $error, self::LOG_ENTRY_MAX_BYTES ) );
	}

	/**
	 * Append an entry to the log and cut the log to its size; the oldest entries go first
	 * @since   0.2.3
	 * @param   string $log    The log as it is stored
	 * @param   string $entry  The new entry
	 */
	function save_error_log( $log, $entry ) {

		$log .= $entry;

		if ( strlen( $log ) > self::LOG_MAX_BYTES ) {

			$log    = substr( $log, -self::LOG_MAX_BYTES );
			$marker = "********************************************\n******  Log date:";
			$start  = strpos( $log, $marker );

			// start at the beginning of an entry, not in the middle of one
			if ( false !== $start )
				$log = substr( $log, $start );
		}

		// not autoloaded: a log that grows must not be read on every page
		update_option( 'syncpilot_error_log', $log, false );
	}

	/**
	 * An error log of an older version can be big and is loaded on every request; it is cut and stored without autoload
	 * once. Only an autoloaded log is in the options that WordPress has loaded already, so this costs no query.
	 * @since   0.2.3
	 */
	function trim_error_log() {

		$alloptions = wp_load_alloptions();

		if ( ! isset( $alloptions['syncpilot_error_log'] ) )
			return;

		$log = (string) $alloptions['syncpilot_error_log'];

		delete_option( 'syncpilot_error_log' );

		if ( '' !== $log )
			$this->save_error_log( '', $log );
	}

	/**
	 * Describe data for the log in a few lines: names and sizes, short beginnings of values, nothing that is secret
	 * @since   0.2.3
	 * @param   mixed  $data   Array, WP_Error, object or scalar
	 * @param   int    $depth  How deep it went already
	 * @return  string
	 */
	function describe_log_data( $data, $depth = 0 ) {

		$indent = str_repeat( '  ', $depth );

		if ( is_wp_error( $data ) )
			return $indent . 'WP_Error ' . $this->shorten_log_text( (string) $data->get_error_code() . ': ' . $data->get_error_message(), 500 ) . "\n";

		if ( is_object( $data ) )
			return $indent . get_class( $data ) . "\n";

		if ( ! is_array( $data ) )
			return $indent . $this->shorten_log_text( is_scalar( $data ) ? (string) $data : gettype( $data ), 500 ) . "\n";

		$secret = array( 'sig', 'key', 'secret_key', 'nonce', 'chunk', 'form_data', 'connection_info', 'auth', 'password', 'cookies', 'authorization', 'set-cookie' );
		$text   = '';
		$count  = 0;

		foreach ( $data as $name => $value ) {

			if ( ++$count > 20 ) {
				$text .= $indent . "... " . ( count( $data ) - 20 ) . " more\n";
				break;
			}

			$label = $indent . $this->shorten_log_text( (string) $name, 60 ) . ': ';

			if ( in_array( strtolower( (string) $name ), $secret, true ) )
				$text .= $label . '[not logged' . ( is_string( $value ) ? ', ' . strlen( $value ) . ' bytes' : '' ) . "]\n";

			elseif ( is_array( $value ) && $depth < 2 )
				$text .= rtrim( $label ) . "\n" . $this->describe_log_data( $value, $depth + 1 );

			elseif ( is_array( $value ) )
				$text .= $label . '[array, ' . count( $value ) . " items]\n";

			elseif ( is_object( $value ) )
				$text .= $label . get_class( $value ) . "\n";

			else
				$text .= $label . $this->shorten_log_text( is_scalar( $value ) ? (string) $value : gettype( $value ), 300 ) . "\n";
		}

		return $text;
	}

	/**
	 * The beginning of a text, with its size when it is cut
	 * @since   0.2.3
	 * @param   string $text    The text
	 * @param   int    $length  How many bytes stay
	 * @return  string
	 */
	function shorten_log_text( $text, $length ) {

		if ( strlen( $text ) <= $length )
			return $text;

		return $this->cut_log_text( $text, $length ) . '... (' . strlen( $text ) . ' bytes)';
	}

	/**
	 * Cut a text to a number of bytes without breaking a multibyte character
	 * @since   0.2.3
	 * @param   string $text    The text
	 * @param   int    $length  How many bytes stay at most
	 * @return  string
	 */
	function cut_log_text( $text, $length ) {

		if ( strlen( $text ) <= $length )
			return $text;

		return function_exists( 'mb_strcut' ) ? mb_strcut( $text, 0, $length, 'UTF-8' ) : substr( $text, 0, $length );
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

}
