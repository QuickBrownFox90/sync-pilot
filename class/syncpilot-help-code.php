<?php
/**
 * The help codes of SyncPilot: one number for one kind of event, with the texts that belong to it.
 *
 * A number means one thing everywhere. The place in the code that reports it is a second number, the site: 130.02 is the
 * second place that reports 130. The sites are numbered by hand at the call (log_error( ..., site: 2 )), the enum does
 * not know them; tests/help-codes.php makes sure that none is used twice.
 *
 * Ranges: 1xx events of the server with an entry in the log, 2xx media files, 9xx only the browser (no entry in the
 * log). The numbers of the earlier versions (#111, #103mf...) are found by legacy().
 *
 * The log text is English, short and complete in itself, without facts: names, sizes and numbers are the context of the
 * entry. It is never translated. The texts for the user and the help texts (translated) come later; they are read when
 * they are needed, never when the class is loaded, because translating before init is too early.
 *
 * @since   0.3.0
 * @author  Patrick Mauersberger
 */
enum SyncPilot_HelpCode: int {

	// the other site: the request itself
	case RemoteRequestFailed     = 121;
	case RemoteHttpError         = 129;
	case RemotePluginMissing     = 131;
	case RemoteTimeout           = 134;
	case RemoteTlsFailed         = 139;
	case RemoteAuthRequired      = 142;
	case RemoteHostNotFound      = 143;
	case RemoteAnswerInvalid     = 144;
	case RemoteAnswerUnreadable  = 145;
	case RemoteReportedError     = 146;

	// the request itself (caught by SyncPilot_Request_Guard)
	case UncaughtException       = 147;
	case PhpFatalError           = 148;
	case PhpTimeLimit            = 149;
	case PhpMemoryLimit          = 150;
	case PhpMessage              = 151;

	// permission and signature
	case InvalidSignature        = 130;
	case PullNotAllowed          = 132;
	case PushNotAllowed          = 133;

	// tables, dump, finalize
	case TableStructureFailed    = 125;
	case CreateQueryFailed       = 126;
	case DumpGzipWriteFailed     = 127;
	case DumpWriteFailed         = 128;
	case ChunkMissing            = 135;
	case ChunkUnreadable         = 136;
	case TempTablesMissing       = 140;
	case TableNameInvalid        = 141;

	// media files
	case MediaMoveFailed         = 203;
	case MediaFolderFailed       = 204;
	case MediaUploadEmpty        = 206;
	case MediaUploadMoveFailed   = 207;
	case MediaDataUnreadable     = 210;
	case MediaPathInvalid        = 211;
	case MediaListMismatch       = 212;
	case MediaPathOutside        = 213;
	case MediaDownloadFailed     = 214;

	// the numbers of the earlier versions: as the user saw them (#111, #103mf) without # => the code that means it now
	const LEGACY = array(
		'111' => 130, '120' => 130, '123' => 130, '124' => 130, '130' => 130, '137' => 130, '138' => 130,
		'100mf' => 130, '109mf' => 130,
		'103mf' => 203, '105mf' => 203,
		'104mf' => 204, '108mf' => 204,
		'106mf' => 206, '107mf' => 207, '110mf' => 210, '111mf' => 211, '112mf' => 212, '113mf' => 213,
	);

	/**
	 * Everything about one code. Only the selected line is evaluated, so the texts that need a translation can be added
	 * here as functions without being translated when the class is loaded.
	 * @since   0.3.0
	 *
	 * @return  array  log: the English text for the log
	 */
	function entry(): array {

		return match ( $this ) {

			self::RemoteRequestFailed    => array( 'log' => 'Request to remote site failed' ),
			self::RemoteHttpError        => array( 'log' => 'Remote site answered with an HTTP error' ),
			self::RemotePluginMissing    => array( 'log' => 'SyncPilot not active on remote site' ),
			self::RemoteTimeout          => array( 'log' => 'Request to remote site timed out' ),
			self::RemoteTlsFailed        => array( 'log' => 'TLS certificate of remote site not accepted' ),
			self::RemoteAuthRequired     => array( 'log' => 'Remote site requires basic authentication' ),
			self::RemoteHostNotFound     => array( 'log' => 'Remote host not found' ),
			self::RemoteAnswerInvalid    => array( 'log' => 'Answer of remote site is not serialized data' ),
			self::RemoteAnswerUnreadable => array( 'log' => 'Answer of remote site cannot be unserialized' ),
			self::RemoteReportedError    => array( 'log' => 'Remote site reported an error' ),

			self::UncaughtException      => array( 'log' => 'Uncaught exception in request' ),
			self::PhpFatalError          => array( 'log' => 'PHP fatal error in request' ),
			self::PhpTimeLimit           => array( 'log' => 'PHP time limit reached in request' ),
			self::PhpMemoryLimit         => array( 'log' => 'PHP memory limit reached in request' ),
			self::PhpMessage             => array( 'log' => 'PHP warning or notice in request' ),

			self::InvalidSignature       => array( 'log' => 'Invalid content signature' ),
			self::PullNotAllowed         => array( 'log' => 'Pull not allowed on this site' ),
			self::PushNotAllowed         => array( 'log' => 'Push not allowed on this site' ),

			self::TableStructureFailed   => array( 'log' => 'Reading table structure failed' ),
			self::CreateQueryFailed      => array( 'log' => 'Reading CREATE TABLE query failed' ),
			self::DumpGzipWriteFailed    => array( 'log' => 'Writing gzipped dump file failed' ),
			self::DumpWriteFailed        => array( 'log' => 'Writing dump file failed' ),
			self::ChunkMissing           => array( 'log' => 'Chunk upload missing' ),
			self::ChunkUnreadable        => array( 'log' => 'Chunk file not readable' ),
			self::TempTablesMissing      => array( 'log' => 'Temporary tables missing at finalize' ),
			self::TableNameInvalid       => array( 'log' => 'Table name invalid at finalize' ),

			self::MediaMoveFailed        => array( 'log' => 'Moving downloaded media file failed' ),
			self::MediaFolderFailed      => array( 'log' => 'Creating media folder failed' ),
			self::MediaUploadEmpty       => array( 'log' => 'Media upload contains no files' ),
			self::MediaUploadMoveFailed  => array( 'log' => 'Moving uploaded media file failed' ),
			self::MediaDataUnreadable    => array( 'log' => 'Media attachment data cannot be unserialized' ),
			self::MediaPathInvalid       => array( 'log' => 'Media file path invalid' ),
			self::MediaListMismatch      => array( 'log' => 'Media file list does not match upload' ),
			self::MediaPathOutside       => array( 'log' => 'Media file path outside uploads folder' ),
			self::MediaDownloadFailed    => array( 'log' => 'Downloading media file failed' ),
		};
	}

	/**
	 * The English text for the log
	 * @since   0.3.0
	 *
	 * @return  string
	 */
	function log_text(): string {
		return $this->entry()['log'];
	}

	/**
	 * The English text for the log of a number; a number that this version does not know (the other site may be newer) is
	 * answered, not an error
	 * @since   0.3.0
	 *
	 * @param   int $code  The help code
	 *
	 * @return  string
	 */
	static function get_log_text( int $code ): string {

		$case = self::tryFrom( $code );

		return $case ? $case->log_text() : 'Unknown help code ' . $code;
	}

	/**
	 * The code that an earlier version showed as #111 or #103mf
	 * @since   0.3.0
	 *
	 * @param   string $tag  The number as the user saw it, with or without the #
	 *
	 * @return  SyncPilot_HelpCode|null  null for a number that has no code (yet)
	 */
	static function legacy( string $tag ): ?self {

		$number = self::LEGACY[ ltrim( strtolower( trim( $tag ) ), '#' ) ] ?? null;

		return null === $number ? null : self::tryFrom( $number );
	}

	/**
	 * The code and the site as one text: 130.02 for code 130, site 2; 130 without a site
	 * @since   0.3.0
	 *
	 * @param   int $code  The help code
	 * @param   int $site  The number of the place in the code; 0 for none
	 *
	 * @return  string
	 */
	static function format( int $code, int $site = 0 ): string {
		return $site > 0 ? sprintf( '%d.%02d', $code, $site ) : (string) $code;
	}

	/**
	 * The code and the site of a text like 130.02
	 * @since   0.3.0
	 *
	 * @param   string $text  130 or 130.02
	 *
	 * @return  array|null  array( 'code' => 130, 'site' => 2 ); null when it is not a number of this kind
	 */
	static function parse( string $text ): ?array {

		if ( ! preg_match( '/^#?(\d{3})(?:\.(\d{1,2}))?$/', trim( $text ), $m ) )
			return null;

		return array( 'code' => (int) $m[1], 'site' => isset( $m[2] ) ? (int) $m[2] : 0 );
	}
}
