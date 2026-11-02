<?php
/**
 * Self-hosted plugin updater via GitHub Releases.
 *
 * Hooks into the update system of WordPress, reads the releases of the GitHub repository and shows the newest one as a
 * normal plugin update, so that no wordpress.org is needed. It finds pre-releases too, only takes the ZIP that the
 * release workflow builds and only from a link of the repository itself, caches a failed request so that GitHub is not
 * asked on every page, and fetches only in the admin, in cron and in WP-CLI, never for a visitor of the site.
 *
 * @since   0.2.3
 * @author  Patrick Mauersberger
 */

class SyncPilot_Updater {

	// how long an answer is kept: a found release, no usable release or an error of GitHub (for example the rate limit),
	// and a release whose ZIP is not attached yet (the release workflow needs a minute)
	const CACHE_TTL         = DAY_IN_SECONDS;
	const CACHE_TTL_MISS    = HOUR_IN_SECONDS;
	const CACHE_TTL_PENDING = 15 * MINUTE_IN_SECONDS;

	private $github_repo;
	private $plugin_file;
	private $plugin_slug;
	private $plugin_basename;
	private $cache_key;


	/**
	 * @since   0.2.3
	 * @param   string $github_repo  Repository as "owner/repo"
	 * @param   string $plugin_file  Absolute path of the main file of the plugin (__FILE__)
	 */
	function __construct( $github_repo, $plugin_file ) {

		$this->github_repo     = $github_repo;
		$this->plugin_file     = $plugin_file;
		$this->plugin_basename = plugin_basename( $plugin_file );
		$this->plugin_slug     = dirname( $this->plugin_basename );
		$this->cache_key       = 'syncpilot_updater_' . md5( $github_repo );
	}


	/**
	 * The text domain of the plugin. The updater is registered before the base class is loaded (cron and WP-CLI run
	 * updates without it), so it cannot rely on the class.
	 * @since   0.2.3
	 * @return  string
	 */
	function text_domain() {

		return class_exists( 'SyncPilot_Base', false ) ? SyncPilot_Base::TEXT_DOMAIN : 'sync-pilot';
	}


	/**
	 * Register the hooks of the update flow. Switched off with the constant SYNCPILOT_DISABLE_UPDATER or the filter
	 * syncpilot_updater_enabled.
	 * @since   0.2.3
	 */
	function init() {

		if ( defined( 'SYNCPILOT_DISABLE_UPDATER' ) && SYNCPILOT_DISABLE_UPDATER )
			return;

		if ( ! apply_filters( 'syncpilot_updater_enabled', true ) )
			return;

		add_filter( 'plugins_api', array( $this, 'plugin_info' ), 20, 3 );
		add_filter( 'site_transient_update_plugins', array( $this, 'check_update' ) );
		add_filter( 'upgrader_source_selection', array( $this, 'fix_source_folder' ), 10, 4 );
		add_action( 'upgrader_process_complete', array( $this, 'purge_cache' ), 10, 2 );
		add_filter( 'plugin_action_links_' . $this->plugin_basename, array( $this, 'action_links' ) );
		add_action( 'admin_post_syncpilot_check_updates', array( $this, 'handle_cache_bust' ) );
		add_action( 'admin_notices', array( $this, 'update_check_notice' ) );
	}


	/**
	 * The release to offer, from the cache or from GitHub. A failed answer is cached as well (as "none"), otherwise every
	 * read of the update data of WordPress would wait for GitHub again.
	 * @since   0.2.3
	 * @return  object|false  version, download_url, changelog, published_at; false when there is nothing to offer
	 */
	function get_release_info() {

		$cached = get_site_transient( $this->cache_key );

		if ( false !== $cached )
			return is_object( $cached ) ? $cached : false;

		// a visitor of the site never causes a request to GitHub
		if ( ! is_admin() && ! wp_doing_cron() && ! ( defined( 'WP_CLI' ) && WP_CLI ) )
			return false;

		$pending = false;
		$release = $this->fetch_release( $pending );

		set_site_transient( $this->cache_key, $release ? $release : 'none', $release ? ( $pending ? self::CACHE_TTL_PENDING : self::CACHE_TTL ) : self::CACHE_TTL_MISS );

		return $release;
	}


	/**
	 * Read the releases of the repository and pick the newest one that has the ZIP of the plugin attached.
	 * @since   0.2.3
	 * @param   bool $pending  Set to true when a newer release exists whose ZIP is not attached yet
	 * @return  object|false
	 */
	function fetch_release( &$pending ) {

		$response = wp_remote_get(
			'https://api.github.com/repos/' . $this->github_repo . '/releases?per_page=10',
			array(
				'timeout' => 10,
				'headers' => array(
					'Accept'     => 'application/vnd.github+json',
					'User-Agent' => 'SyncPilot-Updater/' . $GLOBALS['syncpilot_meta']['sync-pilot']['version'],
				),
			)
		);

		if ( is_wp_error( $response ) || 200 !== wp_remote_retrieve_response_code( $response ) )
			return false;

		$releases = json_decode( wp_remote_retrieve_body( $response ) );

		if ( ! is_array( $releases ) )
			return false;

		$prereleases = apply_filters( 'syncpilot_updater_prereleases', true );
		$newest      = false;
		$newest_any  = '0';

		foreach ( $releases as $data ) {

			if ( ! is_object( $data ) || ! empty( $data->draft ) || ( ! $prereleases && ! empty( $data->prerelease ) ) )
				continue;

			// only a plain version number: 1.2.3 or 1.2.3-beta.1, with or without a leading "v"
			if ( empty( $data->tag_name ) || ! preg_match( '/^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/', (string) $data->tag_name, $matches ) )
				continue;

			$version = $matches[1];

			if ( version_compare( $version, $newest_any, '>' ) )
				$newest_any = $version;

			$download_url = $this->find_package( $data );

			if ( '' === $download_url )
				continue;

			if ( false === $newest || version_compare( $version, $newest->version, '>' ) ) {

				$newest = (object) array(
					'version'      => $version,
					'download_url' => $download_url,
					'changelog'    => isset( $data->body ) ? (string) $data->body : '',
					'published_at' => isset( $data->published_at ) ? (string) $data->published_at : '',
				);
			}
		}

		$pending = ( false !== $newest && version_compare( $newest_any, $newest->version, '>' ) ) || ( false === $newest && '0' !== $newest_any );

		return $newest;
	}


	/**
	 * The download link of the ZIP that the release workflow attaches (<slug>.zip), if it is a link of the repository itself
	 * @since   0.2.3
	 * @param   object $release  A release of the GitHub API
	 * @return  string           The link, or an empty string
	 */
	function find_package( $release ) {

		if ( empty( $release->assets ) || ! is_array( $release->assets ) )
			return '';

		foreach ( $release->assets as $asset ) {

			if ( ! is_object( $asset ) || empty( $asset->name ) || empty( $asset->browser_download_url ) || $asset->name !== $this->plugin_slug . '.zip' )
				continue;

			$url   = (string) $asset->browser_download_url;
			$parts = wp_parse_url( $url );

			if ( isset( $parts['scheme'], $parts['host'], $parts['path'] ) && 'https' === $parts['scheme'] && 'github.com' === $parts['host'] && 0 === strpos( $parts['path'], '/' . $this->github_repo . '/releases/download/' ) )
				return $url;
		}

		return '';
	}


	/**
	 * Fill the dialog "View details" of the plugins list
	 * @since   0.2.3
	 * @param   mixed  $result  The result of the filter so far
	 * @param   string $action  What is asked, for example "plugin_information"
	 * @param   object $args   The request; $args->slug is the plugin
	 * @return  mixed
	 */
	function plugin_info( $result, $action, $args ) {

		if ( 'plugin_information' !== $action || ! is_object( $args ) || ( isset( $args->slug ) ? $args->slug : '' ) !== $this->plugin_slug )
			return $result;

		$release = $this->get_release_info();

		if ( ! $release )
			return $result;

		$plugin_data = get_plugin_data( $this->plugin_file );

		$info                = new stdClass();
		$info->name          = $plugin_data['Name'];
		$info->slug          = $this->plugin_slug;
		$info->version       = $release->version;
		$info->author        = $plugin_data['AuthorName'];
		$info->homepage      = 'https://github.com/' . $this->github_repo;
		$info->requires      = '6.0';
		$info->requires_php  = '8.2';
		$info->last_updated  = $release->published_at;
		$info->download_link = $release->download_url;
		$info->sections      = array(
			'description' => esc_html( $plugin_data['Description'] ),
			'changelog'   => nl2br( esc_html( $release->changelog ) ),
		);

		return $info;
	}


	/**
	 * Put the newest release into the update data of WordPress. Without a newer one the plugin is listed as "no update",
	 * which is what WordPress needs to show the switch for automatic updates.
	 * @since   0.2.3
	 * @param   mixed $transient  The update data of the plugins
	 * @return  mixed
	 */
	function check_update( $transient ) {

		if ( ! is_object( $transient ) || empty( $transient->checked ) )
			return $transient;

		$release = $this->get_release_info();

		if ( ! $release )
			return $transient;

		$installed = isset( $transient->checked[ $this->plugin_basename ] ) ? $transient->checked[ $this->plugin_basename ] : '0';

		$update               = new stdClass();
		$update->slug         = $this->plugin_slug;
		$update->plugin       = $this->plugin_basename;
		$update->new_version  = $release->version;
		$update->url          = 'https://github.com/' . $this->github_repo;
		$update->package      = $release->download_url;
		$update->tested       = $GLOBALS['wp_version'];
		$update->requires_php = '8.2';

		if ( version_compare( $release->version, $installed, '>' ) ) {

			if ( ! isset( $transient->response ) || ! is_array( $transient->response ) )
				$transient->response = array();

			$transient->response[ $this->plugin_basename ] = $update;
		}

		else {

			$update->package = '';

			if ( ! isset( $transient->no_update ) || ! is_array( $transient->no_update ) )
				$transient->no_update = array();

			$transient->no_update[ $this->plugin_basename ] = $update;
		}

		return $transient;
	}


	/**
	 * Make sure the unpacked folder has the name of the plugin. WordPress installs the plugin into the folder of the ZIP,
	 * and a folder with another name (a renamed ZIP, a download of the repository) would be a second plugin.
	 * @since   0.2.3
	 * @param   string       $source         The unpacked folder
	 * @param   string       $remote_source  The folder that contains it
	 * @param   WP_Upgrader  $upgrader       The upgrader
	 * @param   array        $hook_extra     What is updated
	 * @return  string|WP_Error
	 */
	function fix_source_folder( $source, $remote_source, $upgrader, $hook_extra ) {

		global $wp_filesystem;

		if ( ! is_array( $hook_extra ) || ( isset( $hook_extra['plugin'] ) ? $hook_extra['plugin'] : '' ) !== $this->plugin_basename )
			return $source;

		$wanted = trailingslashit( $remote_source ) . $this->plugin_slug . '/';

		if ( untrailingslashit( $source ) === untrailingslashit( $wanted ) )
			return $source;

		if ( ! is_object( $wp_filesystem ) || ! $wp_filesystem->move( untrailingslashit( $source ), untrailingslashit( $wanted ), true ) )
			return new WP_Error( 'syncpilot_updater_folder', __( 'The folder of the update could not be renamed.', $this->text_domain() ) );

		return $wanted;
	}


	/**
	 * Forget the release after this plugin was updated, so that the next check asks GitHub again
	 * @since   0.2.3
	 * @param   WP_Upgrader $upgrader    The upgrader that has finished
	 * @param   array       $hook_extra  What was done
	 */
	function purge_cache( $upgrader, $hook_extra ) {

		if ( ! is_array( $hook_extra ) || 'update' !== ( isset( $hook_extra['action'] ) ? $hook_extra['action'] : '' ) || 'plugin' !== ( isset( $hook_extra['type'] ) ? $hook_extra['type'] : '' ) )
			return;

		$plugins = isset( $hook_extra['plugins'] ) ? (array) $hook_extra['plugins'] : array();

		if ( isset( $hook_extra['plugin'] ) )
			$plugins[] = $hook_extra['plugin'];

		if ( in_array( $this->plugin_basename, $plugins, true ) )
			delete_site_transient( $this->cache_key );
	}


	/**
	 * The link "Check for updates" in the row of the plugin
	 * @since   0.2.3
	 * @param   array $links  The links of the row
	 * @return  array
	 */
	function action_links( $links ) {

		$url = wp_nonce_url( add_query_arg( 'action', 'syncpilot_check_updates', admin_url( 'admin-post.php' ) ), 'syncpilot_check_updates' );

		$links[] = '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Check for updates', $this->text_domain() ) . '</a>';

		return $links;
	}


	/**
	 * Forget the release and the update data of WordPress, so that the next look asks GitHub, and go back to the plugins list
	 * @since   0.2.3
	 */
	function handle_cache_bust() {

		if ( ! current_user_can( 'update_plugins' ) )
			wp_die( esc_html__( 'You do not have permission to do this.', $this->text_domain() ) );

		check_admin_referer( 'syncpilot_check_updates' );

		delete_site_transient( $this->cache_key );
		delete_site_transient( 'update_plugins' );

		wp_safe_redirect( add_query_arg( 'syncpilot_update_checked', '1', self_admin_url( 'plugins.php' ) ) );
		exit;
	}


	/**
	 * The notice after "Check for updates"
	 * @since   0.2.3
	 */
	function update_check_notice() {

		if ( empty( $_GET['syncpilot_update_checked'] ) || ! current_user_can( 'update_plugins' ) )
			return;

		echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__( 'The update data was cleared. WordPress asks for a new SyncPilot version at the next check.', $this->text_domain() ) . '</p></div>';
	}
}
