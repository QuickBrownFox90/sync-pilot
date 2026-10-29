<?php
class SyncPilot_Base {
	const TEXT_DOMAIN = 'sync-pilot';

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

	function __construct( $plugin_file_path ) {

		$this->settings = get_option( 'syncpilot_settings' );

		$this->invalid_content_verification_error = __( 'Invalid content verification signature, please verify the connection information on the remote site and try again.', self::TEXT_DOMAIN );

		$this->transient_timeout       = 60 * 60 * 12;
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

	function log_error( $syncpilot_error, $additional_error_var = false ){

		$error_header = "********************************************\n******  Log date: " . date( 'Y/m/d H:i:s' ) . " ******\n********************************************\n\n";
		$error        = $error_header . "SyncPilot Error: " . $syncpilot_error . "\n\n";

		if ( ! empty( $this->attempting_to_connect_to ) )
			$error .= "Attempted to connect to: " . $this->attempting_to_connect_to . "\n\n";

		if ( $additional_error_var !== false )
			$error .= print_r( $additional_error_var, true ) . "\n\n";

		$log = get_option( 'syncpilot_error_log' );

		if( $log )
			$log = $log . $error;

		else
			$log = $error;

		update_option( 'syncpilot_error_log', $log );
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
