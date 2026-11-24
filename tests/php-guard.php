<?php
/**
 * The guard for an older PHP in sync-pilot.php (0.4.4): the version check, the notice, and that the part above the `return`
 * of the guard can be read by PHP 5 (no arrow function, match, enum, nullsafe operator, ??=, attribute, readonly, type
 * declaration, named argument; looked at with the tokens of this PHP). The guard itself cannot be run on an old PHP here: this
 * is what the tokens are for.
 *
 * Run on a TEST installation only:   wp eval-file wp-content/plugins/sync-pilot/tests/php-guard.php
 */

error_reporting( E_ALL ); $ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };

$file = dirname( __DIR__ ) . '/sync-pilot.php';
$code = (string) file_get_contents( $file );

// -- the check
$check( 'the functions are there and the minimum is the one of the header', function_exists( 'syncpilot_php_too_old' ) && function_exists( 'syncpilot_php_notice' ) && 1 === preg_match( '/Requires PHP:\s*' . preg_quote( SYNCPILOT_MIN_PHP, '/' ) . '\b/', $code ) );

foreach ( array( '5.6.40' => true, '7.4.33' => true, '8.0.30' => true, '8.1.27' => true, '8.2.0' => false, '8.2.25' => false, '8.3.1' => false, '8.4.1' => false ) as $version => $old )
	$check( "PHP $version is " . ( $old ? 'too old' : 'fine' ), syncpilot_php_too_old( $version ) === $old );

$check( 'this PHP is fine (the plugin is loaded)', false === syncpilot_php_too_old() && function_exists( 'syncpilot_loaded' ) );

// -- the notice
wp_set_current_user( 0 );
ob_start(); syncpilot_php_notice(); $none = ob_get_clean();
$check( 'nobody who may not activate plugins sees the notice', '' === $none );

$admins = get_users( array( 'role' => 'administrator', 'number' => 1 ) );
wp_set_current_user( $admins[0]->ID );
ob_start(); syncpilot_php_notice(); $text = ob_get_clean();
$check( 'an administrator sees it, with the version that runs and the one that is needed', false !== strpos( $text, 'notice-error' ) && false !== strpos( $text, PHP_VERSION ) && false !== strpos( $text, SYNCPILOT_MIN_PHP ), $text );

// -- the part above the return of the guard
$tokens = token_get_all( $code );
$end    = null;

foreach ( $tokens as $i => $t ) {

	if ( is_array( $t ) && T_RETURN === $t[0] ) {
		$end = $i;
		break;
	}
}

$check( 'the guard has a return', null !== $end );

$bad_tokens = array();
$forbidden  = array_filter( array(
	defined( 'T_FN' ) ? T_FN : null, defined( 'T_MATCH' ) ? T_MATCH : null, defined( 'T_ENUM' ) ? T_ENUM : null,
	defined( 'T_NULLSAFE_OBJECT_OPERATOR' ) ? T_NULLSAFE_OBJECT_OPERATOR : null, defined( 'T_COALESCE_EQUAL' ) ? T_COALESCE_EQUAL : null,
	defined( 'T_ATTRIBUTE' ) ? T_ATTRIBUTE : null, defined( 'T_READONLY' ) ? T_READONLY : null, defined( 'T_ELLIPSIS' ) ? T_ELLIPSIS : null,
	defined( 'T_POW_EQUAL' ) ? T_POW_EQUAL : null, defined( 'T_SPACESHIP' ) ? T_SPACESHIP : null,
) );

foreach ( array_slice( $tokens, 0, (int) $end ) as $n => $t ) {

	if ( is_array( $t ) && in_array( $t[0], $forbidden, true ) )
		$bad_tokens[] = token_name( $t[0] ) . ' in line ' . $t[2];

	// a type before a parameter or after the closing bracket of a function, `: type`
	if ( is_array( $t ) && T_FUNCTION === $t[0] ) {

		$j = $n + 1;

		while ( isset( $tokens[ $j ] ) && '{' !== $tokens[ $j ] && ';' !== $tokens[ $j ] ) {

			if ( ':' === $tokens[ $j ] )
				$bad_tokens[] = 'a return type in line ' . $t[2];

			if ( is_array( $tokens[ $j ] ) && in_array( $tokens[ $j ][0], array( T_STRING, T_ARRAY, T_CALLABLE, T_STATIC ), true ) && isset( $tokens[ $j + 2 ] ) && is_array( $tokens[ $j + 2 ] ) && T_VARIABLE === $tokens[ $j + 2 ][0] && ( '(' === $tokens[ $j - 1 ] || ',' === $tokens[ $j - 1 ] || ( is_array( $tokens[ $j - 1 ] ) && T_WHITESPACE === $tokens[ $j - 1 ][0] ) ) && is_array( $tokens[ $j + 1 ] ) && T_WHITESPACE === $tokens[ $j + 1 ][0] )
				$bad_tokens[] = 'a type of a parameter in line ' . $tokens[ $j ][2];

			$j++;
		}
	}
}

$check( 'the part above the return has no syntax that PHP 5 cannot read', ! $bad_tokens, implode( ', ', $bad_tokens ) );

$above = '';
foreach ( array_slice( $tokens, 0, (int) $end ) as $t )
	$above .= is_array( $t ) ? $t[1] : $t;

$check( 'nothing is loaded above the return (no require, no class, no namespace)', ! preg_match( '/\b(require|require_once|include|include_once|namespace|class|interface|trait|use)\b\s*[\'"\w\\\\]/', preg_replace( '#/\*.*?\*/#s', '', $above ) ) );

// the part below the return is not read on an old PHP: the check must come first
$check( 'the first function of the plugin that loads classes is below the guard', strpos( $code, 'function syncpilot_loaded' ) > strpos( $code, 'if ( syncpilot_php_too_old() )' ) );

printf( "\n%d ok, %d failed\n", $ok, $bad );
exit( $bad ? 1 : 0 );
