<?php
	/**
	 * Diagnostics tab template part
	 * @since   0.0.1
	 * @since   0.3.0  Two text fields with a title each: the diagnostic info and the log; the selection of the log level under the title of the log
	 * @author  Patrick Mauersberger, Sean Lang and contributors
	 */
?>

<div class="diagnostics-tab content-tab">
	<div class="debug">
		<h3>
			<?php _e( 'Diagnostic Info', self::TEXT_DOMAIN ); ?>
		</h3>
		<textarea class="debug-info-textarea" autocomplete="off" readonly></textarea>
	</div>

	<div class="debug">
		<h3>
			<?php _e( 'Error Log', self::TEXT_DOMAIN ); ?>
		</h3>
		<?php $log_level = $this->settings['log_level'] ?? SyncPilot_Logger::LEVEL_ERRORS; ?>
		<p class="log-level">
			<label for="log-level"><?php _e( 'Log level', self::TEXT_DOMAIN ); ?></label>
			<select id="log-level" class="log-level-select">
				<option value="off"<?php selected( $log_level, 'off' ); ?>><?php _e( 'Off', self::TEXT_DOMAIN ); ?></option>
				<option value="errors"<?php selected( $log_level, 'errors' ); ?>><?php _e( 'Errors (default)', self::TEXT_DOMAIN ); ?></option>
				<option value="verbose"<?php selected( $log_level, 'verbose' ); ?>><?php _e( 'Verbose (for troubleshooting)', self::TEXT_DOMAIN ); ?></option>
			</select>
		</p>
		<textarea class="debug-log-textarea" autocomplete="off" readonly></textarea>
		<a class="button clear-log js-action-link">
			<?php _e( 'Clear Error Log', self::TEXT_DOMAIN ); ?>
		</a>
	</div>
</div>
