<?php global $loaded_profile; ?>
<div class="option-section media-files-options">
	<label class="media-files checkbox-label" for="media-files">
		<input type="checkbox" name="media_files" value="1" data-available="1" id="media-files"<?php echo ( isset( $loaded_profile['media_files'] ) ? ' checked="checked"' : '' ); ?> />
		<?php _e( 'Media Files', self::TEXT_DOMAIN ); ?>
	</label>
	<div class="indent-wrap expandable-content">
		<ul>
			<li id="remove-local-media-list-item">
				<label for="remove-local-media" class="remove-local-media">
				<input type="checkbox" name="remove_local_media" value="1" id="remove-local-media"<?php echo ( isset( $loaded_profile['remove_local_media'] ) ? ' checked="checked"' : '' ); ?> />
				<?php _e( 'Remove <span class="remove-scope-1">local</span> media files that are not found on the <span class="remove-scope-2">remote</span> site', self::TEXT_DOMAIN ); ?>
				</label>
			</li>
		</ul>
	</div>
	<p class="media-migration-unavailable inline-message warning" style="display: none; margin: 10px 0 0 0;">
		<strong><?php _e( 'Media Files Unavailable', self::TEXT_DOMAIN ); ?></strong> &mdash; <?php _e( 'The <strong>remote site</strong> runs a version of SyncPilot without media file support. Please install or update SyncPilot there to enable media file migration.', self::TEXT_DOMAIN ); ?>
	</p>
	<p class="media-files-different-plugin-version-notice inline-message warning" style="display: none; margin: 10px 0 0 0;">
		<strong><?php _e( 'Version Mismatch', self::TEXT_DOMAIN ); ?></strong> &mdash; <?php _e( sprintf( 'We have detected you have version <span class="media-file-remote-version"></span> of SyncPilot at <span class="media-files-remote-location"></span> but are using %1$s here. Please go to the <a href="%2$s">Plugins page</a> on both installs and check for updates.', $GLOBALS['syncpilot_meta'][$this->plugin_slug]['version'], network_admin_url( 'plugins.php' ) ), self::TEXT_DOMAIN ); ?>
	</p>
</div>
