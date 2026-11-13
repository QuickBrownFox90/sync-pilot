<?php
class SyncPilot_Media_Files extends SyncPilot_Base {
	protected $files_to_migrate;
	protected $responding_to_get_remote_media_listing = false;
	protected $unwritable_media_folders               = array();
	protected $remembered_uploads_dir                 = '';

	function __construct( $plugin_file_path ) {

		parent::__construct( $plugin_file_path );

		$this->plugin_slug = 'sync-pilot';
		$this->plugin_version = $GLOBALS['syncpilot_meta']['sync-pilot']['version'];

		add_action( 'syncpilot_after_advanced_options', array( $this, 'migration_form_controls' ) );
		add_action( 'syncpilot_load_assets', array( $this, 'load_assets' ) );
		add_action( 'syncpilot_js_variables', array( $this, 'js_variables' ) );
		add_filter( 'syncpilot_accepted_profile_fields', array( $this, 'accepted_profile_fields' ) );
		add_filter( 'syncpilot_establish_remote_connection_data', array( $this, 'establish_remote_connection_data' ) );
		add_filter( 'syncpilot_nonces', array( $this, 'add_nonces' ) );

		// the media files that the other site does not have are removed when everything else is done
		add_action( 'syncpilot_before_finalize_migration', array( $this, 'remember_uploads_dir' ) );
		add_action( 'syncpilot_migration_finalized', array( $this, 'remove_media_after_finalize' ) );

		// compatibility with CLI migraitons
		add_filter( 'syncpilot_cli_finalize_migration', array( $this, 'cli_migration' ), 10, 4 );

		// internal AJAX handlers
		add_action( 'wp_ajax_syncpilot_mf_determine_media_to_migrate', array( $this, 'ajax_determine_media_to_migrate' ) );
		add_action( 'wp_ajax_syncpilot_mf_migrate_media', array( $this, 'ajax_migrate_media' ) );

		// external AJAX handlers
		add_action( 'wp_ajax_nopriv_syncpilot_mf_get_remote_media_listing', array( $this, 'respond_to_get_remote_media_listing' ) );
		add_action( 'wp_ajax_nopriv_syncpilot_mf_push_request', array( $this, 'respond_to_push_request' ) );
		add_action( 'wp_ajax_nopriv_syncpilot_mf_remove_local_attachments', array( $this, 'respond_to_remove_local_attachments' ) );
	}

	function get_local_attachments() {

		global $wpdb;

		$prefix      = $wpdb->prefix;
		$temp_prefix = stripslashes( $_POST['temp_prefix'] );

		/*
		* We determine which media files need migrating BEFORE the database migration is finalized.
		* Because of this we need to scan the *_post & *_postmeta that are prefixed using the temporary prefix.
		* Though this should only happen when we're responding to a get_remote_media_listing() call AND it's a push OR
		* we're scanning local files AND it's a pull.
		*/

		if (
			( true == $this->responding_to_get_remote_media_listing && $_POST['intent'] == 'push' ) ||
			( false == $this->responding_to_get_remote_media_listing && $_POST['intent'] == 'pull' )
		) {

			$local_tables = array_flip( $this->get_tables() );

			$posts_table_name    = "{$temp_prefix}{$prefix}posts";
			$postmeta_table_name = "{$temp_prefix}{$prefix}postmeta";

			if ( isset( $local_tables[$posts_table_name] ) && isset( $local_tables[$postmeta_table_name] ) )
				$prefix = $temp_prefix . $prefix;
		}

		$local_attachments = $wpdb->get_results(
			"SELECT `{$prefix}posts`.`post_modified_gmt` AS 'date', pm1.`meta_value` AS 'file', pm2.`meta_value` AS 'metadata'
			FROM `{$prefix}posts`
			INNER JOIN `{$prefix}postmeta` pm1 ON `{$prefix}posts`.`ID` = pm1.`post_id` AND pm1.`meta_key` = '_wp_attached_file'
			LEFT OUTER JOIN `{$prefix}postmeta` pm2 ON `{$prefix}posts`.`ID` = pm2.`post_id` AND pm2.`meta_key` = '_wp_attachment_metadata'
			WHERE `{$prefix}posts`.`post_type` = 'attachment'", ARRAY_A
		);

		if ( is_multisite() ) {

			$blogs  = $this->get_blogs();
			$prefix = $wpdb->prefix;

			foreach ( $blogs as $blog ) {
				$posts_table_name    = "{$temp_prefix}{$prefix}{$blog}_posts";
				$postmeta_table_name = "{$temp_prefix}{$prefix}{$blog}_postmeta";

				if ( isset( $local_tables[ $posts_table_name ] ) && isset( $local_tables[ $postmeta_table_name ] ) )
					$prefix = $temp_prefix . $prefix;

				$attachments = $wpdb->get_results(
					"SELECT `{$prefix}{$blog}_posts`.`post_modified_gmt` AS 'date', pm1.`meta_value` AS 'file', pm2.`meta_value` AS 'metadata', {$blog} AS 'blog_id'
					FROM `{$prefix}{$blog}_posts`
					INNER JOIN `{$prefix}{$blog}_postmeta` pm1 ON `{$prefix}{$blog}_posts`.`ID` = pm1.`post_id` AND pm1.`meta_key` = '_wp_attached_file'
					LEFT OUTER JOIN `{$prefix}{$blog}_postmeta` pm2 ON `{$prefix}{$blog}_posts`.`ID` = pm2.`post_id` AND pm2.`meta_key` = '_wp_attachment_metadata'
					WHERE `{$prefix}{$blog}_posts`.`post_type` = 'attachment'", ARRAY_A
				);

				$local_attachments = array_merge( $attachments, $local_attachments );
			}
		}

		$local_attachments = array_map( array( $this, 'process_attachment_data' ), $local_attachments );
		$local_attachments = array_filter( $local_attachments );

		return $local_attachments;
	}

	function get_flat_attachments( $attachments ) {

		$flat_attachments = array();

		foreach( $attachments as $attachment ) {

			$flat_attachments[] = $attachment['file'];

			if ( isset( $attachment['sizes'] ) )
				$flat_attachments = array_merge( $flat_attachments, $attachment['sizes'] );
		}
		return $flat_attachments;
	}

	function process_attachment_data( $attachment ) {

		if ( isset( $attachment['blog_id'] ) ) { // used for multisite

			if ( defined( 'UPLOADBLOGSDIR' ) )
				$upload_dir = sprintf( '%s/files/', $attachment['blog_id'] );

			else
				$upload_dir = sprintf( 'sites/%s/', $attachment['blog_id'] );

			$attachment['file'] = $upload_dir . $attachment['file'];
		}

		$upload_dir = str_replace( basename( $attachment['file'] ), '', $attachment['file'] );

		if ( ! empty( $attachment['metadata'] ) ) {

			$attachment['metadata'] = $this->safe_unserialize( $attachment['metadata'] );

			if ( ! empty( $attachment['metadata']['sizes'] ) && is_array( $attachment['metadata']['sizes'] ) ) {

				foreach ( $attachment['metadata']['sizes'] as $size ) {

					if ( empty( $size['file'] ) )
						continue;

					$attachment['sizes'][] = $upload_dir . $size['file'];
				}
			}
		}

		unset( $attachment['metadata'] );

		return $attachment;
	}

	/**
	 * Check a media file path that comes from the other site or from a request: relative to the uploads folder,
	 * no "." or ".." segments, no hidden files, only file types WordPress allows for uploads and no script
	 * extension inside a double extension (image.php.jpg)
	 * @since   0.1.2
	 * @param   string $path Path relative to the uploads folder
	 * @return  bool
	 */
	function is_safe_media_path( $path ) {

		if ( ! is_string( $path ) || '' === $path || false !== strpos( $path, "\0" ) )
			return false;

		$path = str_replace( '\\', '/', $path );

		if ( '/' === $path[0] || 1 === preg_match( '#^[A-Za-z]:#', $path ) || 1 === preg_match( '#(^|/)\.\.?(/|$)#', $path ) )
			return false;

		$name = basename( $path );

		if ( '.' === $name[0] || 1 === preg_match( '/\.(php[0-9]?|phtml|pht|phps|phar|shtml|cgi|asp|aspx|jsp|htaccess|htpasswd)(\.|$)/i', $name ) )
			return false;

		$filetype = wp_check_filetype( $name );

		return ! empty( $filetype['type'] );
	}

	/**
	 * Check that a destination is inside the uploads folder, symbolic links included; the folder does not have to exist yet
	 * @since   0.1.2
	 * @param   string $destination Absolute path of the file to write
	 * @return  bool
	 */
	function is_inside_uploads( $destination ) {

		$base = realpath( $this->uploads_dir() );
		$dir  = dirname( $destination );

		if ( false === $base )
			return false;

		while ( ! file_exists( $dir ) && dirname( $dir ) !== $dir )
			$dir = dirname( $dir );

		$real = realpath( $dir );

		return false !== $real && ( $real === $base || 0 === strpos( $real . DS, $base . DS ) );
	}

	/**
	 * Check the "Accept pull / push requests" setting for the endpoints the other site calls
	 * @since   0.1.2
	 * @param   string $intent What the other site does: "pull" or "push"
	 * @return  bool
	 */
	function media_request_allowed( $intent ) {

		$setting = ( 'pull' === $intent ) ? 'allow_pull' : 'allow_push';

		return ! empty( $this->settings[ $setting ] );
	}

	/**
	 * The uploads folder of this site, with a slash at the end
	 * @since   0.0.1
	 * @since   0.3.1  After remember_uploads_dir() the folder from before the tables were replaced: a pull brings the options of the other site, and with them maybe another uploads folder
	 *
	 * @return  string
	 */
	function uploads_dir() {

		if ( '' !== $this->remembered_uploads_dir )
			return $this->remembered_uploads_dir;

		if ( defined( 'UPLOADBLOGSDIR' ) ) {
			$upload_dir = trailingslashit( ABSPATH ) . UPLOADBLOGSDIR;
		}

		else {
			$upload_dir = wp_upload_dir();
			$upload_dir = $upload_dir['basedir'];
		}

		return trailingslashit( $upload_dir );
	}

	/**
	 * The files in the uploads folder with their sizes, by their path relative to the folder. An entry whose size
	 * cannot be read (a link that leads nowhere, a file that is removed while the folder is read) and a subfolder
	 * that cannot be opened are skipped: before, the exception ended the request with the "critical error" page of
	 * WordPress (HTTP 500) and the media files could not be determined at all
	 * @since   0.2.6
	 * @since   0.3.1  Notes the folders of the uploads folder that cannot be written (the first 50) in unwritable_media_folders, for the check before the media files are written (media_write_state())
	 * @return  array  Relative path => size in bytes
	 */
	function get_local_media() {

		$upload_dir = untrailingslashit( $this->uploads_dir() );

		$this->unwritable_media_folders = array();

		if ( ! file_exists( $upload_dir ) )
			return array();

		$files       = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $upload_dir ), RecursiveIteratorIterator::SELF_FIRST, RecursiveIteratorIterator::CATCH_GET_CHILD );
		$local_media = array();

		foreach( $files as $name => $object ) {

			try {
				$size = $object->getSize();
			} catch ( RuntimeException $e ) {
				continue;
			}

			$name               = str_replace( array( $upload_dir . DS, '\\' ), array( '', '/' ), $name );
			$local_media[$name] = $size;

			// the iterator also gives "." and ".." of every folder: they are the folder itself
			if ( ! in_array( $object->getFilename(), array( '.', '..' ), true ) && $object->isDir() && ! $object->isWritable() && count( $this->unwritable_media_folders ) < 50 )
				$this->unwritable_media_folders[] = $name;
		}

		return $local_media;
	}

	function ajax_migrate_media() {

		$this->check_ajax_referer( 'migrate-media' );
		$this->set_time_limit();

		if ( $_POST['intent'] == 'pull' ) {
			$result = $this->process_pull_request();

			return $result;
		}

		$result = $this->process_push_request();

		return $result;
	}

	/**
	 * Download the media files that the user chose from the other site (pull)
	 * @since   0.0.1
	 * @since   0.3.0  Every file that fails is logged with its path and the reason (MediaPathInvalid, MediaDownloadFailed, MediaPathOutside, MediaMoveFailed, MediaFolderFailed)
	 */
	function process_pull_request() {

		$files_to_download  = ( isset( $_POST['file_chunk'] ) && is_array( $_POST['file_chunk'] ) ) ? $_POST['file_chunk'] : array();
		$remote_uploads_url = trailingslashit( $_POST['remote_uploads_url'] );
		$parsed             = parse_url( $_POST['url'] );

		if ( ! empty( $parsed['user'] ) ) {
			$credentials        = sprintf( '%s:%s@', $parsed['user'], $parsed['pass'] );
			$remote_uploads_url = str_replace( '://', '://' . $credentials, $remote_uploads_url );
		}

		$upload_dir = $this->uploads_dir();
		$errors     = array();

		foreach( $files_to_download as $file_to_download ) {

			// the name comes from the other site: it must not leave the uploads folder or be a script
			if ( ! $this->is_safe_media_path( $file_to_download ) ) {
				$errors[] = sprintf( __( 'The path of the media file is not valid: %s', self::TEXT_DOMAIN ), esc_html( (string) $file_to_download ) ) . ' (#111mf)';

				$this->log_error( SyncPilot_HelpCode::MediaPathInvalid, array( 'path' => (string) $file_to_download ), site: 1 );

				continue;
			}

			$temp_file_path = $this->download_url( $remote_uploads_url . $file_to_download );

			if ( is_wp_error( $temp_file_path ) ) {
				$download_error = $temp_file_path->get_error_message();
				$errors[]       = __( sprintf( 'Could not download file: %1$s - %2$s', $remote_uploads_url . $file_to_download, $download_error ), self::TEXT_DOMAIN );

				$this->log_error( SyncPilot_HelpCode::MediaDownloadFailed, array( 'path' => (string) $file_to_download, 'reason' => $download_error ), site: 1 );

				continue;
			}

			$date     = str_replace( basename( $file_to_download ), '', $file_to_download );
			$new_path = $upload_dir . $date . basename( $file_to_download  );

			if ( ! $this->is_inside_uploads( $new_path ) ) {
				@unlink( $temp_file_path );

				$errors[] = sprintf( __( 'The media file would end up outside the uploads folder: %s', self::TEXT_DOMAIN ), esc_html( $file_to_download ) ) . ' (#113mf)';

				$this->log_error( SyncPilot_HelpCode::MediaPathOutside, array( 'path' => (string) $file_to_download ), site: 1 );

				continue;
			}

			error_clear_last();

			$move_result = @rename( $temp_file_path, $new_path );

			if ( false === $move_result ) {

				$folder = dirname( $new_path );

				if ( @file_exists( $folder ) ) {
					$errors[] =  __( sprintf( 'Error attempting to move downloaded file. Temp path: %1$s - New Path: %2$s', $temp_file_path, $new_path ), self::TEXT_DOMAIN ) . ' (#103mf)';

					$this->log_error( SyncPilot_HelpCode::MediaMoveFailed, $this->folder_facts( $folder, array( 'path' => (string) $file_to_download ) ), site: 1 );
				}

				else {
					error_clear_last();

					if ( false === @mkdir( $folder, 0755, true ) ) {
						$errors[] =  __( sprintf( 'Error attempting to create required directory: %s', $folder ), self::TEXT_DOMAIN ) . ' (#104mf)';

						$this->log_error( SyncPilot_HelpCode::MediaFolderFailed, $this->folder_facts( dirname( $folder ), array( 'folder' => $folder ) ), site: 1 );
					}

					else {
						error_clear_last();

						$move_result = @rename( $temp_file_path, $new_path );

						if ( false === $move_result ) {
							$errors[] =  __( sprintf( 'Error attempting to move downloaded file. Temp path: %1$s - New Path: %2$s', $temp_file_path, $new_path ), self::TEXT_DOMAIN ) . ' (#105mf)';

							$this->log_error( SyncPilot_HelpCode::MediaMoveFailed, $this->folder_facts( $folder, array( 'path' => (string) $file_to_download ) ), site: 2 );
						}
					}
				}
			}
		}

		if ( ! empty( $errors ) ) {

			$return = array(
				'syncpilot_error'	=> 1,
				'body'			=> implode( '<br />', $errors ) . '<br />'
			);

			$result = $this->end_ajax( json_encode( $return ) );

			return $result;
		}

		// not required, just here because we have to return something otherwise the AJAX fails
		$return['success'] = 1;
		$result            = $this->end_ajax( json_encode( $return ) );

		return $result;
	}

	/**
	 * Send a chunk of media files to the other site (push)
	 * @since   0.0.1
	 * @since   0.3.0  A path that is not valid is logged (MediaPathInvalid, site 2)
	 */
	function process_push_request() {

		$files_to_migrate = ( isset( $_POST['file_chunk'] ) && is_array( $_POST['file_chunk'] ) ) ? array_values( $_POST['file_chunk'] ) : array();
		$upload_dir       = $this->uploads_dir();

		$body = '';

		foreach( $files_to_migrate as $file_to_migrate ) {

			if ( ! $this->is_safe_media_path( $file_to_migrate ) || ! $this->is_inside_uploads( $upload_dir . $file_to_migrate ) ) {
				$return = array(
					'syncpilot_error' => 1,
					'body'            => sprintf( __( 'The path of the media file is not valid: %s', self::TEXT_DOMAIN ), esc_html( (string) $file_to_migrate ) ) . ' (#111mf)',
				);

				$this->log_error( SyncPilot_HelpCode::MediaPathInvalid, array( 'path' => (string) $file_to_migrate ), site: 2 );

				$result = $this->end_ajax( json_encode( $return ) );

				return $result;
			}

			$body .= $this->file_to_multipart( $upload_dir . $file_to_migrate );
		}

		$post_args = array(
			'action'	=> 'syncpilot_mf_push_request',
			'files'		=> serialize( $files_to_migrate )
		);

		$post_args['sig'] = $this->create_signature( $post_args, $_POST['key'] );
		$body            .= $this->array_to_multipart( $post_args );
		$args['body']     = $body;
		$ajax_url         = trailingslashit( $_POST['url'] ) . 'wp-admin/admin-ajax.php';
		$response         = $this->remote_post( $ajax_url, '', __FUNCTION__, $args );
		$response         = $this->verify_remote_post_response( $response );

		$result = $this->end_ajax( json_encode( $response ) );

		return $result;
	}

	/**
	 * Public endpoint: receive media files of a push (signed) and write them to the uploads folder
	 * @since   0.0.1
	 * @since   0.3.0  Every refusal and every failed file is logged (InvalidSignature, site 8; PushNotAllowed, site 5; MediaUploadEmpty, MediaListMismatch, MediaPathInvalid, MediaPathOutside, MediaFolderFailed, MediaUploadMoveFailed)
	 */
	function respond_to_push_request() {

		$filtered_post          = $this->filter_post_elements( $_POST, array( 'action', 'files' ) );
		$filtered_post['files'] = stripslashes( $filtered_post['files'] );

		if ( ! $this->verify_signature( $filtered_post, $this->settings['key'] ) ) {

			$return = array(
				'syncpilot_error' 	=> 1,
				'body'			=> $this->invalid_content_verification_error . ' (#101mf)',
			);

			$this->log_error( SyncPilot_HelpCode::InvalidSignature, array( 'request' => $filtered_post ), site: 8 );

			$result = $this->end_ajax( serialize( $return ) );

			return $result;
		}

		if ( ! $this->media_request_allowed( 'push' ) ) {

			$return = array(
				'syncpilot_error' => 1,
				'body'            => sprintf( __( 'The connection succeeded but the remote site is configured to reject %s connections. You can change this in the "settings" tab on the remote site. (#110)', self::TEXT_DOMAIN ), __( 'push', self::TEXT_DOMAIN ) ),
			);

			$this->log_error( SyncPilot_HelpCode::PushNotAllowed, array(), site: 5 );

			$result = $this->end_ajax( serialize( $return ) );

			return $result;
		}

		if( ! isset( $_FILES['media'] ) ) {

			$return = array(
				'syncpilot_error' 	=> 1,
				'body'			=> __( '$_FILES is empty, the upload appears to have failed', self::TEXT_DOMAIN ) . ' (#106mf)',
			);

			$this->log_error( SyncPilot_HelpCode::MediaUploadEmpty, array( 'request_bytes' => (int) ( $_SERVER['CONTENT_LENGTH'] ?? 0 ) ), site: 1 );

			$result = $this->end_ajax( serialize( $return ) );

			return $result;
		}

		$upload_dir = $this->uploads_dir();
		$files      = $this->diverse_array( $_FILES['media'] );
		$file_paths = $this->safe_unserialize( $filtered_post['files'] );
		$i          = 0;
		$errors     = array();

		// every uploaded file needs exactly one path, and every path has to be safe: nothing is written otherwise
		if ( ! is_array( $file_paths ) || count( $file_paths ) !== count( $files ) ) {

			$return = array(
				'syncpilot_error' => 1,
				'body'            => __( 'The list of media files does not match the uploaded files.', self::TEXT_DOMAIN ) . ' (#112mf)',
			);

			$this->log_error( SyncPilot_HelpCode::MediaListMismatch, array( 'paths' => is_array( $file_paths ) ? count( $file_paths ) : 'not a list', 'files' => count( $files ) ), site: 1 );

			$result = $this->end_ajax( serialize( $return ) );

			return $result;
		}

		$file_paths = array_values( $file_paths );

		foreach ( $file_paths as $file_path ) {

			if ( ! $this->is_safe_media_path( $file_path ) ) {

				$return = array(
					'syncpilot_error' => 1,
					'body'            => sprintf( __( 'The path of the media file is not valid: %s', self::TEXT_DOMAIN ), esc_html( (string) $file_path ) ) . ' (#111mf)',
				);

				$this->log_error( SyncPilot_HelpCode::MediaPathInvalid, array( 'path' => (string) $file_path ), site: 3 );

				$result = $this->end_ajax( serialize( $return ) );

				return $result;
			}
		}

		foreach( $files as &$file ) {

			$destination = $upload_dir . $file_paths[$i];
			$folder      = dirname( $destination );

			if ( ! $this->is_inside_uploads( $destination ) ) {
				$errors[] = sprintf( __( 'The media file would end up outside the uploads folder: %s', self::TEXT_DOMAIN ), esc_html( $file_paths[$i] ) ) . ' (#113mf)';

				$this->log_error( SyncPilot_HelpCode::MediaPathOutside, array( 'path' => (string) $file_paths[$i] ), site: 2 );
				++$i;

				continue;
			}

			error_clear_last();

			if ( false === @file_exists( $folder ) && false === @mkdir( $folder, 0755, true ) ) {
				$errors[] = __( sprintf( 'Error attempting to create required directory: %s', $folder ), self::TEXT_DOMAIN ) . ' (#108mf)';

				$this->log_error( SyncPilot_HelpCode::MediaFolderFailed, $this->folder_facts( dirname( $folder ), array( 'folder' => $folder ) ), site: 2 );
				++$i;

				continue;
			}

			error_clear_last();

			if ( false === @move_uploaded_file( $file['tmp_name'], $destination ) ) {
				$errors[] = __( sprintf( 'A problem occurred when attempting to move the temp file "%1$s" to "%2$s"', $file['tmp_name'], $destination ), self::TEXT_DOMAIN ) . ' (#107mf)';

				$this->log_error( SyncPilot_HelpCode::MediaUploadMoveFailed, $this->folder_facts( $folder, array( 'path' => (string) $file_paths[$i], 'bytes' => (int) ( $file['size'] ?? 0 ) ) ), site: 1 );
			}

			++$i;
		}

		$return = array( 'success' => 1 );

		if( ! empty( $errors ) ) {
			$return = array(
				'syncpilot_error' => 1,
				'body'			  => implode( '<br />', $errors ) . '<br />'
			);
		}

		$result = $this->end_ajax( serialize( $return ) );

		return $result;
	}

	/**
	 * The folders where this site writes media files, as far as the log needs them: the uploads folder, the temporary
	 * folder (the files are downloaded there first), the free space of both and the folders of the uploads folder that
	 * cannot be written. Call get_local_media() first, it notes those. Names, modes, owners and numbers only.
	 * @since   0.3.1
	 *
	 * @return  array  uploads and temp (folder_facts() of them), uploads_free and temp_free (bytes, null when unknown), folders (relative path => folder_facts())
	 */
	function media_write_state() {

		$uploads = untrailingslashit( $this->uploads_dir() );
		$temp    = untrailingslashit( get_temp_dir() );

		// folder_facts() says why PHP failed last: not an error from before
		error_clear_last();

		$free = static function ( $folder ) {
			$bytes = @disk_free_space( $folder );

			return false === $bytes ? null : (int) $bytes;
		};

		$state = array(
			'uploads'      => $this->folder_facts( $uploads ),
			'uploads_free' => $free( $uploads ),
			'temp'         => $this->folder_facts( $temp ),
			'temp_free'    => $free( $temp ),
			'folders'      => array(),
		);

		foreach ( $this->unwritable_media_folders as $folder )
			$state['folders'][ $folder ] = $this->folder_facts( $uploads . DS . $folder );

		return $state;
	}

	/**
	 * Say before the first file is written what will stop it: a folder that cannot be written (the uploads folder, the
	 * temporary folder, or the folder of a file that is to be written), not enough free space. One entry for each folder.
	 * The migration goes on: a folder that is reported wrongly (open_basedir, an ACL) must not stop what would work.
	 * @since   0.3.1
	 *
	 * @param   array  $state      From media_write_state(), of the site that writes
	 * @param   array  $existing   Relative path => size of everything in the uploads folder of that site (folders as well)
	 * @param   array  $files      Relative path => size of the files to write
	 * @param   string $where      "this site" or "remote site": the site that writes
	 *
	 * @return  array  The problems as texts for the user, none when all is fine
	 */
	function check_media_write( $state, $existing, $files, $where ) {

		$total    = array_sum( $files );
		$largest  = $files ? max( $files ) : 0;
		$problems = array();
		$context  = array( 'where' => $where );
		$label    = ( 'this site' === $where ) ? __( 'this site', self::TEXT_DOMAIN ) : __( 'the remote site', self::TEXT_DOMAIN );

		if ( empty( $files ) )
			return $problems;

		if ( empty( $state['uploads']['writable'] ) ) {
			$this->log_error( SyncPilot_HelpCode::MediaFolderNotWritable, $state['uploads'] + $context + array( 'folder' => 'uploads' ), site: 1 );
			$problems[] = sprintf( __( 'The folder for the media files cannot be written on %1$s: %2$s (#215)', self::TEXT_DOMAIN ), $label, 'uploads' );
		}

		if ( empty( $state['temp']['writable'] ) ) {
			$this->log_error( SyncPilot_HelpCode::MediaTempNotWritable, $state['temp'] + $context, site: 1 );
			$problems[] = sprintf( __( 'The temporary folder cannot be written on %s (#216)', self::TEXT_DOMAIN ), $label );
		}

		if ( isset( $state['uploads_free'] ) && $state['uploads_free'] < $total ) {
			$this->log_error( SyncPilot_HelpCode::MediaDiskLow, $context + array( 'folder' => 'uploads', 'free_bytes' => $state['uploads_free'], 'needed_bytes' => $total ), site: 1 );
			$problems[] = sprintf( __( 'Not enough free disk space for the media files on %1$s: %2$s needed, %3$s free (#217)', self::TEXT_DOMAIN ), $label, size_format( $total ), size_format( $state['uploads_free'] ) );
		}

		if ( isset( $state['temp_free'] ) && $state['temp_free'] < $largest ) {
			$this->log_error( SyncPilot_HelpCode::MediaDiskLow, $context + array( 'folder' => 'temp', 'free_bytes' => $state['temp_free'], 'needed_bytes' => $largest ), site: 2 );
			$problems[] = sprintf( __( 'Not enough free disk space in the temporary folder on %1$s: %2$s needed, %3$s free (#217)', self::TEXT_DOMAIN ), $label, size_format( $largest ), size_format( $state['temp_free'] ) );
		}

		// the folders of the files: the nearest one that exists decides, once for each
		$reported = array();

		foreach ( array_keys( $files ) as $file ) {

			$folder = dirname( $file );

			while ( '.' !== $folder && '' !== $folder && ! isset( $existing[ $folder ] ) )
				$folder = dirname( $folder );

			if ( '.' === $folder || isset( $reported[ $folder ] ) || ! isset( $state['folders'][ $folder ] ) )
				continue;

			$reported[ $folder ] = true;

			$this->log_error( SyncPilot_HelpCode::MediaFolderNotWritable, $state['folders'][ $folder ] + $context + array( 'folder' => $folder ), site: 2 );
			$problems[] = sprintf( __( 'The folder for the media files cannot be written on %1$s: %2$s (#215)', self::TEXT_DOMAIN ), $label, $folder );
		}

		SyncPilot_Logger::info( 'Media check before writing', $context + array(
			'files'        => count( $files ),
			'total_bytes'  => $total,
			'largest_file' => $largest,
			'uploads_free' => $state['uploads_free'] ?? null,
			'temp_free'    => $state['temp_free'] ?? null,
			'problems'     => count( $problems ),
		) );

		return $problems;
	}

	/**
	 * Work out which media files the other site lacks (or has in an older version) and how large they are
	 * @since   0.0.1
	 * @since   0.3.1  Checks before the files are written whether they can be (check_media_write()) and stops the migration when not (syncpilot_abort); the media files that the other site does not have are no longer removed here, but at the end (remove_media_after_finalize())
	 */
	function ajax_determine_media_to_migrate() {

		$this->check_ajax_referer( 'determine-media-to-migrate' );
		$this->set_time_limit();

		$local_attachments   = $this->get_local_attachments();
		$local_media         = $this->get_local_media();

		$data                = array();
		$data['action']      = 'syncpilot_mf_get_remote_media_listing';
		$data['temp_prefix'] = $this->temp_prefix;
		$data['intent']      = $_POST['intent'];
		$data['sig']         = $this->create_signature( $data, $_POST['key'] );
		$ajax_url            = trailingslashit( $_POST['url'] ) . 'wp-admin/admin-ajax.php';
		$response            = $this->remote_post( $ajax_url, $data, __FUNCTION__ );
		$response            = $this->verify_remote_post_response( $response );

		$upload_dir          = $this->uploads_dir();

		$remote_attachments  = $response['remote_attachments'];
		$remote_media        = $response['remote_media'];

		$this->files_to_migrate = array();

		if ( $_POST['intent'] == 'pull' )
			$this->media_diff( $local_attachments, $remote_attachments, $local_media, $remote_media );

		else
			$this->media_diff( $remote_attachments, $local_attachments, $remote_media, $local_media );

		// the site that writes the files: this one for a pull, the other one for a push
		$problems = array();

		if ( 'pull' === $_POST['intent'] )
			$problems = $this->check_media_write( $this->media_write_state(), $local_media, $this->files_to_migrate, 'this site' );

		elseif ( isset( $response['media_write'] ) && is_array( $response['media_write'] ) )
			$problems = $this->check_media_write( $response['media_write'], $remote_media, $this->files_to_migrate, 'remote site' );

		// the files cannot be written: the migration stops here, before the database is replaced (the browser removes the temporary tables)
		if ( $problems && apply_filters( 'syncpilot_media_check_stops_migration', true, $problems ) ) {

			SyncPilot_Logger::event( 'Migration stopped by the media check', array( 'problems' => count( $problems ) ) );

			$return = array(
				'syncpilot_abort' => 1,
				'body'            => implode( '<br />', $problems ) . '<br />' . __( 'The migration was stopped before the database was replaced, nothing was changed. Fix the folders, or migrate again without the media files.', self::TEXT_DOMAIN ),
			);

			$result = $this->end_ajax( json_encode( $return ) );

			return $result;
		}

		$return['files_to_migrate']   = $this->files_to_migrate;
		$return['total_size']         = array_sum( $this->files_to_migrate );
		$return['remote_uploads_url'] = $response['remote_uploads_url'];

		// the media files that the other site does not have are not removed here: that is irreversible, so it is done at the very end, see remove_media_after_finalize()

		$result = $this->end_ajax( json_encode( $return ) );

		return $result;
	}

	/**
	 * Public endpoint: remove the media files of this site that the other site does not have (signed)
	 * @since   0.0.1
	 * @since   0.3.0  A refusal is logged (InvalidSignature, site 9; PushNotAllowed, site 6; MediaDataUnreadable)
	 * @since   0.3.1  Answers with the numbers of removed files and files that could not be removed (it answered nothing before), and writes them to its log (MediaRemoveFailed, site 1)
	 */
	function respond_to_remove_local_attachments() {

		$filtered_post                       = $this->filter_post_elements( $_POST, array( 'action', 'remote_attachments' ) );
		$filtered_post['remote_attachments'] = stripslashes( $filtered_post['remote_attachments'] );

		if ( ! $this->verify_signature( $filtered_post, $this->settings['key'] ) ) {

			$return = array(
				'syncpilot_error' 	=> 1,
				'body'			=> $this->invalid_content_verification_error . ' (#109mf)',
			);

			$this->log_error( SyncPilot_HelpCode::InvalidSignature, array( 'request' => $filtered_post ), site: 9 );

			$result = $this->end_ajax( serialize( $return ) );

			return $result;
		}

		if ( ! $this->media_request_allowed( 'push' ) ) {

			$return = array(
				'syncpilot_error' => 1,
				'body'            => sprintf( __( 'The connection succeeded but the remote site is configured to reject %s connections. You can change this in the "settings" tab on the remote site. (#110)', self::TEXT_DOMAIN ), __( 'push', self::TEXT_DOMAIN ) ),
			);

			$this->log_error( SyncPilot_HelpCode::PushNotAllowed, array(), site: 6 );

			$result = $this->end_ajax( serialize( $return ) );

			return $result;
		}

		$remote_attachments = $this->safe_unserialize( $filtered_post['remote_attachments'] );

		if( false === $remote_attachments ) {
			$return = array(
				'syncpilot_error' 	=> 1,
				'body'			=> __( 'Error attempting to unserialize the remote attachment data', self::TEXT_DOMAIN ) . ' (#110mf)',
			);

			$this->log_error( SyncPilot_HelpCode::MediaDataUnreadable, array( 'bytes' => strlen( (string) $filtered_post['remote_attachments'] ) ), site: 1 );

			$result = $this->end_ajax( serialize( $return ) );

			return $result;
		}

		$removal = $this->remove_local_attachments( $remote_attachments );

		$this->report_media_removal( $removal, 'this site' );

		$return = array(
			'success' 	=> 1,
		) + $removal;

		$result = $this->end_ajax( serialize( $return ) );

		return $result;
	}

	/**
	 * Remember the uploads folder before the tables are replaced (a pull brings the options of the other site, and with
	 * them maybe another uploads folder); uploads_dir() gives it from then on
	 * @since   0.3.1
	 *
	 * @return  void
	 */
	function remember_uploads_dir() {

		$this->remembered_uploads_dir = $this->uploads_dir();
	}

	/**
	 * The very last thing of a migration with media files, only when everything before it worked: remove the media files
	 * that the other site does not have. It cannot be undone and SyncPilot makes no backup of the files, so it is not done
	 * before the files are copied and not when anything went wrong (a file that could not be copied, an error that was
	 * shown, a media check that failed). It is called when the tables were replaced, in the same request: after a pull the
	 * users and their sessions are the ones of the other site, and a request of the browser could be refused.
	 * @since   0.3.1
	 *
	 * @param   string $intent  pull or push
	 *
	 * @return  void
	 */
	function remove_media_after_finalize( $intent ) {

		global $syncpilot;

		$form_data = $syncpilot->parse_migration_form_data( (string) ( $_POST['form_data'] ?? '' ) );

		if ( empty( $form_data['media_files'] ) || empty( $form_data['remove_local_media'] ) || ! in_array( $intent, array( 'pull', 'push' ), true ) )
			return;

		if ( empty( $_POST['media_clean'] ) ) {

			SyncPilot_Logger::event( 'Media files not removed', array( 'reason' => 'the migration had errors' ) );

			return;
		}

		$data = array( 'temp_prefix' => $this->temp_prefix );

		if ( 'pull' === $intent ) {

			$data['action'] = 'syncpilot_mf_get_remote_media_listing';
			$data['intent'] = 'pull';
		}

		else {

			$data['action']             = 'syncpilot_mf_remove_local_attachments';
			$data['remote_attachments'] = serialize( $this->get_local_attachments() );

			unset( $data['temp_prefix'] );
		}

		$data['sig'] = $this->create_signature( $data, $_POST['key'] );
		$ajax_url    = trailingslashit( $_POST['url'] ) . 'wp-admin/admin-ajax.php';
		$answer      = $this->read_remote_answer( $this->remote_post( $ajax_url, $data, __FUNCTION__ ) );

		$this->error = '';

		if ( ! is_array( $answer ) || isset( $answer['syncpilot_error'] ) ) {

			$this->log_error( SyncPilot_HelpCode::MediaRemoveFailed, array( 'where' => ( 'pull' === $intent ) ? 'this site' : 'remote site', 'reason' => 'no usable answer of the other site' ), site: 2 );

			return;
		}

		if ( 'pull' === $intent ) {

			if ( ! isset( $answer['remote_attachments'] ) || ! is_array( $answer['remote_attachments'] ) ) {

				$this->log_error( SyncPilot_HelpCode::MediaRemoveFailed, array( 'where' => 'this site', 'reason' => 'the list of the other site has no media files' ), site: 3 );

				return;
			}

			$this->get_local_media();
			$this->report_media_removal( $this->remove_local_attachments( $answer['remote_attachments'] ), 'this site' );

			return;
		}

		// the other site has removed and written its own entry; this is the note of this site
		SyncPilot_Logger::event( 'Media files removed', array( 'where' => 'remote site', 'removed' => $answer['removed'] ?? null, 'failed' => $answer['failed'] ?? null ) );
	}

	/**
	 * The answer of the other site as an array (the answers of the media files are serialized)
	 * @since   0.3.1
	 *
	 * @param   string|false $response  What remote_post() gave
	 *
	 * @return  array|false  false when there is no answer or it is not what was expected
	 */
	function read_remote_answer( $response ) {

		if ( ! is_string( $response ) || ! is_serialized( trim( $response ) ) )
			return false;

		return $this->safe_unserialize( trim( $response ) );
	}

	/**
	 * Say in the log what the removal of media files did: the numbers as an event, and the files that could not be
	 * removed (the first 20, relative to the uploads folder) with the folder facts as one error
	 * @since   0.3.1
	 *
	 * @param   array  $removal  From remove_local_attachments()
	 * @param   string $where    this site or remote site
	 *
	 * @return  void
	 */
	function report_media_removal( $removal, $where ) {

		SyncPilot_Logger::event( 'Media files removed', array( 'where' => $where, 'removed' => $removal['removed'], 'failed' => $removal['failed'] ) );

		if ( empty( $removal['failed'] ) )
			return;

		$first = reset( $removal['failed_files'] );

		$this->log_error( SyncPilot_HelpCode::MediaRemoveFailed, $this->folder_facts( dirname( $this->uploads_dir() . $first ), array( 'where' => $where, 'failed' => $removal['failed'], 'files' => $removal['failed_files'] ) ), site: 1 );
	}

	/**
	 * Remove the local media files that the other site does not have
	 * @since   0.0.1
	 * @since   0.3.1  Gives the number of files that were removed and the files that could not be removed (the first 20); it is called at the end of the migration only (remove_media_after_finalize(), respond_to_remove_local_attachments())
	 *
	 * @param   array $remote_attachments  The attachments of the other site
	 *
	 * @return  array  removed, failed (numbers) and failed_files (relative paths)
	 */
	function remove_local_attachments( $remote_attachments ) {

		$flat_remote_attachments = array_flip( $this->get_flat_attachments( $remote_attachments ) );
		$local_media             = $this->get_local_media();

		// remove local media if it doesn't exist on the remote site
		$temp_local_media   = array_keys( $local_media );
		$allowed_mime_types = array_flip( get_allowed_mime_types() );

		$upload_dir = $this->uploads_dir();
		$removed    = 0;
		$failed     = array();

		foreach( $temp_local_media as $local_media_file ) {
			// don't remove folders
			if( false === is_file( $upload_dir . $local_media_file ) )
				continue;

			$filetype = wp_check_filetype( $local_media_file );

			// don't remove files that we shouldn't remove, e.g. .php, .sql, etc
			if( false === isset( $allowed_mime_types[$filetype['type']] ) )
				continue;

			// don't remove files that exist on the remote site
			if( true === isset( $flat_remote_attachments[$local_media_file] ) )
				continue;

			if ( @unlink( $upload_dir . $local_media_file ) )
				++$removed;

			else
				$failed[] = $local_media_file;
		}

		return array( 'removed' => $removed, 'failed' => count( $failed ), 'failed_files' => array_slice( $failed, 0, 20 ) );
	}

	function media_diff( $site_a_attachments, $site_b_attachments, $site_a_media, $site_b_media ) {

		foreach( $site_b_attachments as $attachment ) {

			$local_attachment_key = $this->multidimensional_search( array( 'file' => $attachment['file'] ), $site_a_attachments );

			if ( false === $local_attachment_key )
				continue;

			$remote_timestamp = strtotime( $attachment['date'] );
			$local_timestamp  = strtotime( $site_a_attachments[$local_attachment_key]['date'] );

			if ( $local_timestamp >= $remote_timestamp ) {

				if ( ! isset( $site_a_media[ $attachment['file'] ] ) )
					$this->add_files_to_migrate( $attachment, $site_b_media );

				else
					$this->maybe_add_resized_images( $attachment, $site_b_media, $site_a_media );

			}

			else
				$this->add_files_to_migrate( $attachment, $site_b_media );
		}
	}

	function add_files_to_migrate( $attachment, $remote_media ) {

		if ( isset( $remote_media[ $attachment['file'] ] ) )
			$this->files_to_migrate[ $attachment['file'] ] = $remote_media[ $attachment['file'] ];

		if ( empty( $attachment['sizes'] ) || apply_filters( 'syncpilot_exclude_resized_media', false ) )
			return;

		foreach ( $attachment['sizes'] as $size )
			if ( isset( $remote_media[$size] ) )
				$this->files_to_migrate[$size] = $remote_media[$size];
	}

	function maybe_add_resized_images( $attachment, $site_b_media, $site_a_media ) {
		if( empty( $attachment['sizes'] ) || apply_filters( 'syncpilot_exclude_resized_media', false ) ) return;
		foreach( $attachment['sizes'] as $size ) {
			if( isset( $site_b_media[$size] ) && ! isset( $site_a_media[$size] ) ) {
				$this->files_to_migrate[$size] = $site_b_media[$size];
			}
		}
	}

	/**
	 * Public endpoint: list the media files of this site for the other site (signed)
	 * @since   0.0.1
	 * @since   0.3.0  A refusal is logged (InvalidSignature, site 10; PullNotAllowed / PushNotAllowed, site 4)
	 * @since   0.3.1  For a push the answer says whether this site can write the media files (media_write, see media_write_state())
	 */
	function respond_to_get_remote_media_listing() {

		$filtered_post = $this->filter_post_elements( $_POST, array( 'action', 'temp_prefix', 'intent' ) );

		if ( ! $this->verify_signature( $filtered_post, $this->settings['key'] ) ) {

			$return = array(
				'syncpilot_error' => 1,
				'body'			  => $this->invalid_content_verification_error . ' (#100mf)',
			);

			$this->log_error( SyncPilot_HelpCode::InvalidSignature, array( 'request' => $filtered_post ), site: 10 );

			$result = $this->end_ajax( serialize( $return ) );

			return $result;
		}

		if ( ! $this->media_request_allowed( $filtered_post['intent'] ?? '' ) ) {

			$return = array(
				'syncpilot_error' => 1,
				'body'            => sprintf( __( 'The connection succeeded but the remote site is configured to reject %s connections. You can change this in the "settings" tab on the remote site. (#110)', self::TEXT_DOMAIN ), 'pull' === ( $filtered_post['intent'] ?? '' ) ? __( 'pull', self::TEXT_DOMAIN ) : __( 'push', self::TEXT_DOMAIN ) ),
			);

			$this->log_error( 'pull' === ( $filtered_post['intent'] ?? '' ) ? SyncPilot_HelpCode::PullNotAllowed : SyncPilot_HelpCode::PushNotAllowed, array(), site: 4 );

			$result = $this->end_ajax( serialize( $return ) );

			return $result;
		}

		if ( defined( 'UPLOADBLOGSDIR' ) ) {
			$upload_url = home_url( UPLOADBLOGSDIR );
		}

		else {
			$upload_dir = wp_upload_dir();
			$upload_url = $upload_dir['baseurl'];
		}

		$this->responding_to_get_remote_media_listing = true;

		$return['remote_attachments'] = $this->get_local_attachments();
		$return['remote_media']       = $this->get_local_media();
		$return['remote_uploads_url'] = $upload_url;

		// a push writes on this site: the other site needs to know if it can
		if ( 'push' === ( $filtered_post['intent'] ?? '' ) )
			$return['media_write'] = $this->media_write_state();

		$result = $this->end_ajax( serialize( $return ) );

		return $result;
	}

	function migration_form_controls() {
		$this->template( 'media-files-options' );
	}

	function accepted_profile_fields( $profile_fields ) {

		$profile_fields[] = 'media_files';
		$profile_fields[] = 'remove_local_media';

		return $profile_fields;
	}

	function load_assets() {

		// the script of Media Files is part of the script of the plugin; only its texts are added here
		wp_localize_script( 'sync-pilot-script', 'syncpilot_mf_strings', array(
			'determining'				=> __( "Determining which media files to migrate, please wait...", self::TEXT_DOMAIN ),
			'error_determining'			=> __( "Error while attempting to determine which media files to migrate.", self::TEXT_DOMAIN ),
			'migration_failed'			=> __( "Migration failed", self::TEXT_DOMAIN ),
			'problem_migrating_media'	=> __( "A problem occurred when migrating the media files.", self::TEXT_DOMAIN ),
			'media_files'				=> __( "Media Files", self::TEXT_DOMAIN ),
			'migrating_media_files'		=> __( "Migrating media files", self::TEXT_DOMAIN ),
		) );

	}

	function establish_remote_connection_data( $data ) {

		$data['media_files_available'] = '1';
		$data['media_files_version']   = $this->plugin_version;

		if( function_exists( 'ini_get' ) )
			$max_file_uploads = ini_get( 'max_file_uploads' );

		$max_file_uploads                     = ( empty( $max_file_uploads ) ) ? 20 : $max_file_uploads;
		$data['media_files_max_file_uploads'] = apply_filters( 'syncpilot_mf_max_file_uploads', $max_file_uploads );

		return $data;
	}

	function multidimensional_search( $needle, $haystack ) {

		if( empty( $needle ) || empty( $haystack ) )
			return false;

		foreach( $haystack as $key => $value ) {

			foreach ( $needle as $skey => $svalue )
				$exists = ( isset( $haystack[$key][$skey] ) && $haystack[$key][$skey] === $svalue );

			if ( $exists )
				return $key;
		}

		return false;
	}

	function get_blogs() {
		global $wpdb;

		$blogs = $wpdb->get_results(
			"SELECT blog_id
			FROM {$wpdb->blogs}
			WHERE spam = '0'
			AND deleted = '0'
			AND archived = '0'
			AND blog_id != 1
		");

		$clean_blogs = array();

		foreach( $blogs as $blog )
			$clean_blogs[] = $blog->blog_id;

		return $clean_blogs;
	}

	/**
	 * Download a file of the other site into a temporary file. The certificate is checked only when "Enable SSL
	 * verification" is on in the settings, like for every other request to the other site
	 * @since   0.2.7
	 * @param   string $url      The address of the file
	 * @param   int    $timeout  Seconds
	 * @return  string|WP_Error  The path of the temporary file, or the error
	 */
	function download_url( $url, $timeout = 300 ) {
		//WARNING: The file is not automatically deleted, The script must unlink() the file.
		if ( ! $url )
			return new WP_Error( 'http_no_url', __('Invalid URL Provided.') );

		$tmpfname = wp_tempnam( $url );

		if ( ! $tmpfname )
			return new WP_Error( 'http_no_file', __('Could not create Temporary file.') );

		$response = wp_remote_get( $url, array( 'timeout' => $timeout, 'stream' => true, 'filename' => $tmpfname, 'reject_unsafe_urls' => false, 'sslverify' => $this->verify_ssl() ) );

		if ( is_wp_error( $response ) ) {
			unlink( $tmpfname );
			return $response;
		}

		if ( 200 != wp_remote_retrieve_response_code( $response ) ) {
			unlink( $tmpfname );
			return new WP_Error( 'http_404', trim( wp_remote_retrieve_response_message( $response ) ) );
		}

		return $tmpfname;
	}

	function js_variables() {
		?>
		var syncpilot_media_files_version = '<?php echo $this->plugin_version; ?>';
		<?php
	}

	function verify_remote_post_response( $response ) {
		if ( false === $response ) {
			$return = array( 'syncpilot_error' => 1, 'body' => $this->error );
			$result = $this->end_ajax( json_encode( $return ) );

			return $result;
		}

		if ( ! is_serialized( trim( $response ) ) ) {
			$return = array( 'syncpilot_error'	=> 1, 'body' => $response );
			$result = $this->end_ajax( json_encode( $return ) );

			return $result;
		}

		$response = $this->safe_unserialize( trim( $response ) );

		if ( isset( $response['syncpilot_error'] ) ) {
			$result = $this->end_ajax( json_encode( $response ) );

			return $result;
		}

		return $response;
	}

	function add_nonces( $nonces ) {

		$nonces['migrate_media'] = wp_create_nonce( 'migrate-media' );
		$nonces['determine_media_to_migrate'] = wp_create_nonce( 'determine-media-to-migrate' );

		return $nonces;
	}

	function cli_migration( $outcome, $profile, $verify_connection_response, $initiate_migration_response ) {

		global $syncpilot, $syncpilot_cli;

		if ( true !== $outcome )
			return $outcome;

		if ( ! isset( $profile['media_files'] ) || '1' !== $profile['media_files'] )
			return $outcome;

		if ( ! isset( $verify_connection_response['media_files_max_file_uploads'] ) )
			return $syncpilot_cli->cli_error( __( 'SyncPilot does not seems to be installed/active on the remote website.', self::TEXT_DOMAIN ) );

		$this->set_time_limit();
		$syncpilot->set_cli_migration();
		$this->set_cli_migration();

		$connection_info = explode( "\n", $profile['connection_info'] );

		$_POST['intent']              = $profile['action'];
		$_POST['url']                 = trim( $connection_info[0] );
		$_POST['key']                 = trim( $connection_info[1] );
		$_POST['remove_local_media']  = ( isset( $profile['remove_local_media'] ) ) ? 1 : 0;
		$_POST['temp_prefix']         = $verify_connection_response['temp_prefix'];

		do_action( 'syncpilot_cli_before_determine_media_to_migrate', $profile, $verify_connection_response, $initiate_migration_response );

		$response = $this->ajax_determine_media_to_migrate();

		if ( is_wp_error( $determine_media_to_migrate_response = $syncpilot_cli->verify_cli_response( $response, 'ajax_determine_media_to_migrate()' ) ) )
			return $determine_media_to_migrate_response;

		$remote_uploads_url = $determine_media_to_migrate_response['remote_uploads_url'];
		$files_to_migrate   = $determine_media_to_migrate_response['files_to_migrate'];

		// seems like this value needs to be different depending on pull/push?
		$bottleneck = $syncpilot->get_bottleneck();

		while ( !empty( $files_to_migrate ) ) {

			$file_chunk_to_migrate      = array();
			$file_chunk_size            = 0;
			$number_of_files_to_migrate = 0;

			foreach ( $files_to_migrate as $file_to_migrate => $file_size ) {

				if ( empty( $file_chunk_to_migrate ) ) {

					$file_chunk_to_migrate[]  = $file_to_migrate;
					$file_chunk_size         += $file_size;

					unset( $files_to_migrate[$file_to_migrate] );

					++$number_of_files_to_migrate;
				}

				else {
					if ( ( $file_chunk_size + $file_size ) > $bottleneck || $number_of_files_to_migrate >= $verify_connection_response['media_files_max_file_uploads'] ) {
						break;
					}

					else {
						$file_chunk_to_migrate[]  = $file_to_migrate;
						$file_chunk_size         += $file_size;

						unset( $files_to_migrate[$file_to_migrate] );

						++$number_of_files_to_migrate;
					}
				}

				$_POST['file_chunk']         = $file_chunk_to_migrate;
				$_POST['remote_uploads_url'] = $remote_uploads_url;

				$response = $this->ajax_migrate_media();

				if ( is_wp_error( $migrate_media_response = $syncpilot_cli->verify_cli_response( $response, 'ajax_migrate_media()' ) ) )
					return $migrate_media_response;
			}
		}

		return true;
	}
}
