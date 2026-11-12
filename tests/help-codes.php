<?php
/**
 * Checks of the help codes (SyncPilot_HelpCode) and of every place in the code that reports one. No WordPress needed:
 *
 *   php tests/help-codes.php
 *
 * The codes: every number once, every log text English, short and without a code or a fact in it. The calls: every
 * log_error() names a help code and a site, no site is used twice for the same code, every code is reported somewhere.
 */

error_reporting( E_ALL );

require_once dirname( __DIR__ ) . '/class/syncpilot-help-code.php';

$ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };

echo "-- the codes\n";
$cases = SyncPilot_HelpCode::cases();
$check( 'there are codes', count( $cases ) > 0, count( $cases ) . ' codes' );

$wrong = array(); $seen = array();
foreach ( $cases as $case ) {
	$text = $case->log_text();
	if ( '' === $text || strlen( $text ) > 70 )                                   $wrong[] = $case->name . ': length';
	if ( preg_match( '/[^\x20-\x7e]/', $text ) )                                   $wrong[] = $case->name . ': not plain English characters';
	if ( preg_match( '/[#%<>]|\d/', $text ) )                                      $wrong[] = $case->name . ': code, number, placeholder or tag in the text';
	if ( preg_match( '/[.!?:]$/', $text ) )                                        $wrong[] = $case->name . ': ends with punctuation';
	if ( isset( $seen[ $text ] ) )                                                 $wrong[] = $case->name . ': same text as ' . $seen[ $text ];
	$seen[ $text ] = $case->name;
	if ( ! preg_match( '/^[1-2]\d\d$/', (string) $case->value ) )                  $wrong[] = $case->name . ': number outside 1xx / 2xx';
	if ( ( $case->value >= 200 ) !== ( 0 === strpos( $case->name, 'Media' ) ) )    $wrong[] = $case->name . ': media in 2xx only, and only media';
}
$check( 'every log text: English, short, no code, no number, no fact, no punctuation at the end, its own text', array() === $wrong, implode( '; ', $wrong ) );

$bad_legacy = array();
foreach ( SyncPilot_HelpCode::LEGACY as $tag => $number ) {
	if ( null === SyncPilot_HelpCode::tryFrom( $number ) ) $bad_legacy[] = $tag;
}
$check( 'every earlier number leads to a code that exists', array() === $bad_legacy, implode( ', ', $bad_legacy ) );
$check( 'legacy(): #111, 103mf, a number without a code', SyncPilot_HelpCode::InvalidSignature === SyncPilot_HelpCode::legacy( '#111' ) && SyncPilot_HelpCode::MediaMoveFailed === SyncPilot_HelpCode::legacy( '103mf' ) && null === SyncPilot_HelpCode::legacy( '#999' ) );
$check( 'an unknown number is answered, not an error', 'Unknown help code 245' === SyncPilot_HelpCode::get_log_text( 245 ) && 'Invalid content signature' === SyncPilot_HelpCode::get_log_text( 130 ) );
$check( 'format(): 130.02, 130.10, 130', '130.02' === SyncPilot_HelpCode::format( 130, 2 ) && '130.10' === SyncPilot_HelpCode::format( 130, 10 ) && '130' === SyncPilot_HelpCode::format( 130 ) );
$check( 'parse(): 130.02, #130, 130.1, nonsense', array( 'code' => 130, 'site' => 2 ) === SyncPilot_HelpCode::parse( '130.02' ) && array( 'code' => 130, 'site' => 0 ) === SyncPilot_HelpCode::parse( '#130' ) && array( 'code' => 130, 'site' => 1 ) === SyncPilot_HelpCode::parse( '130.1' ) && null === SyncPilot_HelpCode::parse( 'abc' ) );

echo "\n-- the places that report a code\n";
$used = array(); $problems = array(); $calls = 0;
foreach ( glob( dirname( __DIR__ ) . '/class/*.php' ) as $file ) {

	// the comments are not calls; a call can go over several lines, its end is the closing bracket
	$code = '';
	foreach ( token_get_all( file_get_contents( $file ) ) as $token )
		$code .= is_array( $token ) ? ( in_array( $token[0], array( T_COMMENT, T_DOC_COMMENT ), true ) ? str_repeat( "\n", substr_count( $token[1], "\n" ) ) : $token[1] ) : $token;

	preg_match_all( '/log_error\(/', $code, $found, PREG_OFFSET_CAPTURE );

	foreach ( $found[0] as $hit ) {

		$start = $hit[1] + strlen( $hit[0] );
		$depth = 1;
		$end   = $start;

		for ( $length = strlen( $code ); $end < $length && $depth > 0; $end++ ) {
			if ( '(' === $code[ $end ] ) $depth++;
			if ( ')' === $code[ $end ] ) $depth--;
		}

		$line = substr_count( substr( $code, 0, $hit[1] ), "\n" ) + 1;
		$call = substr( $code, $start, $end - $start );

		// the definition is not a call
		if ( preg_match( '/function\s+$/', substr( $code, max( 0, $hit[1] - 12 ), 12 ) ) )
			continue;

		$calls++;
		$where = basename( $file ) . ':' . $line;

		if ( ! preg_match_all( '/SyncPilot_HelpCode::(\w+)/', $call, $names ) ) { $problems[] = "$where: no help code"; continue; }
		if ( ! preg_match( '/site:\s*(\d+)\s*\)$/', $call, $site ) )              { $problems[] = "$where: no site";      continue; }

		foreach ( array_unique( $names[1] ) as $name ) {

			if ( ! defined( "SyncPilot_HelpCode::$name" ) )  { $problems[] = "$where: $name does not exist"; continue; }
			if ( isset( $used[ $name ][ $site[1] ] ) )       { $problems[] = "$where: $name site {$site[1]} is also at " . $used[ $name ][ $site[1] ]; continue; }

			$used[ $name ][ $site[1] ] = $where;
		}
	}
}
$check( 'there are calls', $calls > 0, $calls . ' calls of log_error()' );
$check( 'every call has a help code and a site, no site is used twice for a code', array() === $problems, implode( '; ', $problems ) );

$unused = array_values( array_filter( array_map( fn ( $c ) => $c->name, $cases ), fn ( $name ) => ! isset( $used[ $name ] ) ) );
$check( 'every code is reported somewhere', array() === $unused, implode( ', ', $unused ) );

$gaps = array();
foreach ( $used as $name => $sites ) {
	$numbers = array_keys( $sites ); sort( $numbers );
	if ( $numbers !== range( 1, count( $numbers ) ) ) $gaps[] = $name . ' (' . implode( ',', $numbers ) . ')';
}
echo "note  sites with gaps (a number is fine if it is shared by a place that reports two codes): " . ( $gaps ? implode( ' ', $gaps ) : 'none' ) . "\n";

echo "\n$ok ok, $bad failed\n";
exit( $bad ? 1 : 0 );
