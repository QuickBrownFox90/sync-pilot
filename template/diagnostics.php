<?php
	/**
	 * Diagnostics tab template part
	 * @since   0.0.1
	 * @author  Patrick Mauersberger, Sean Lang and contributors
	 */
?>

<div class="diagnostics-tab content-tab">
	<div class="debug">
		<h3>
			<?php _e( 'Diagnostic Info &amp; Error Log', self::TEXT_DOMAIN ); ?>
		</h3>
		<textarea class="debug-log-textarea" autocomplete="off" readonly></textarea>
		<a class="button clear-log js-action-link">
			<?php _e( 'Clear Error Log', self::TEXT_DOMAIN ); ?>
		</a>
	</div>
</div>
