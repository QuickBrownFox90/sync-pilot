<?php
/**
 * The replace in serialized values without unserializing them (SyncPilot_Import::rewrite_serialized() and replace_value()):
 * the result is what the function of a push or a pull gives for data that it can handle, the keys and the class names are not
 * touched, the length of a changed string is new, a serialized text in a string is changed the same way, references stay
 * references, and a text that is not read to the end is not changed. And the object graph that the function of a push or a pull
 * cannot handle: 1644 bytes with a depth of 40 would need 2^40 copies there.
 *
 * Run on a TEST installation only:   wp eval-file wp-content/plugins/sync-pilot/tests/import-serialized.php
 */

error_reporting( E_ALL ); global $syncpilot, $syncpilot_import; $ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };
$I     = 'SyncPilot_Import';

$syncpilot->set_migration_form_data( 'replace_old[0]=&replace_new[0]=&replace_old[1]=' . rawurlencode( 'http://old.test' ) . '&replace_new[1]=' . rawurlencode( 'https://new.example.org' ) );
$mine = new ReflectionMethod( $I, 'replace_value' ); $mine->setAccessible( true );
$mine = fn( $v ) => $mine->invoke( $GLOBALS['syncpilot_import'], $v );
$ref  = fn( $v ) => $syncpilot->recursive_unserialize_replace( $v );

$std = new stdClass; $std->url = 'http://old.test/o'; $std->n = 5; $std->list = array( 'http://old.test/l1', 7, null, true, 1.5 );

$cases = array(
	'a plain string'                   => 'see http://old.test/x',
	'an array'                         => serialize( array( 'a' => 'http://old.test/1', 'b' => 2, 'c' => array( 'http://old.test/2', 'x' ), 'd' => null, 'e' => false, 'f' => 0.25 ) ),
	'a key that has the text'          => serialize( array( 'http://old.test' => 'http://old.test/v', 5 => 'x' ) ),
	'multibyte strings'                => serialize( array( 'ü' => "Grüße 日本 http://old.test/ü", 'k' => '' ) ),
	'a string that is serialized'      => serialize( array( 'inner' => serialize( array( 'u' => 'http://old.test/in' ) ), 'x' => 1 ) ),
	'a string that is JSON'            => serialize( array( 'j' => '{"u":"http:\/\/old.test\/j","n":1}' ) ),
	'an object'                        => serialize( $std ),
	'capitals'                         => serialize( array( 'u' => 'HTTP://OLD.TEST/UP' ) ),
	'nothing to find'                  => serialize( array( 'u' => 'nothing', 'v' => array( 1, 2, 3 ) ) ),
	'big numbers and floats'           => serialize( array( PHP_INT_MAX, -5, 1.0E+25, 0.1, NAN > 1 ) ),
	'nested depth'                     => serialize( array( 'a' => array( 'b' => array( 'c' => array( 'd' => 'http://old.test/deep' ) ) ) ) ),
);

$wrong = array();
foreach ( $cases as $name => $value ) {
	$a = $mine( $value ); $b = $ref( $value );
	if ( $a !== $b ) $wrong[] = $name . ' [' . substr( $a, 0, 90 ) . ' | ' . substr( $b, 0, 90 ) . ']';
}
$check( count( $cases ) . ' kinds of values: the same result as the function of a push or a pull', array() === $wrong, implode( ' ;; ', $wrong ) );

$one = $mine( serialize( array( 'http://old.test' => 'http://old.test/v' ) ) );
$check( 'the key is not touched, the value is, with its new length', 'a:1:{s:15:"http://old.test";s:25:"https://new.example.org/v";}' === $one, $one );
$one = $mine( serialize( $std ) );
$check( 'an object: the class and the names of the properties stay, the values change', false !== strpos( $one, 'O:8:"stdClass":3:{s:3:"url";s:25:"https://new.example.org/o";' ) && false !== strpos( $one, 's:26:"https://new.example.org/l1"' ), $one );
$check( 'every changed value can be unserialized', is_array( unserialize( $mine( $cases['an array'] ) ) ) && is_object( unserialize( $mine( $cases['an object'] ) ) ) );

// an object that keeps integer keys: the function of a push or a pull turns i:0 into s:1:"0" there
$ao = $mine( serialize( new ArrayObject( array( 'http://old.test/ao' ) ) ) );
$check( 'the keys of an ArrayObject stay what they are (integers)', false !== strpos( $ao, 'i:0;i:0;i:1;a:1:{i:0;s:26:"https://new.example.org/ao";}' ) && is_object( unserialize( $ao ) ) && false === strpos( $ao, 'old.test' ), $ao );

// a value that the reference cannot read to the end is left to it, a text that is not serialized is not read by the rewriter
$check( 'text that is cut off or not complete is not rewritten', false === $I::rewrite_serialized( 'a:1:{s:3:"abc";s:5:"xy";}', fn( $s ) => $s ) && false === $I::rewrite_serialized( 'a:1:{', fn( $s ) => $s ) && false === $I::rewrite_serialized( 's:3:"abc";junk', fn( $s ) => $s ) && false === $I::rewrite_serialized( 'x', fn( $s ) => $s ) && false === $I::rewrite_serialized( 'a:2:{i:0;i:1;}', fn( $s ) => $s ) );
$check( 'what is read to the end is the same without a change', 'a:2:{i:0;s:1:"a";s:1:"k";b:1;}' === $I::rewrite_serialized( 'a:2:{i:0;s:1:"a";s:1:"k";b:1;}', fn( $s ) => $s ) );

// references stay references (the function of a push or a pull loses them)
$x = new stdClass; $x->u = 'http://old.test/r'; $holder = new stdClass; $holder->a = $x; $holder->b = $x;
$changed = unserialize( $mine( serialize( $holder ) ) );
$check( 'an object that is used twice is still one object', $changed->a === $changed->b && 'https://new.example.org/r' === $changed->a->u );

// the graph that cannot be handled by recursive_unserialize_replace()
$o = new stdClass; $o->u = 'http://old.test/x';
for ( $k = 0; $k < 40; $k++ ) { $n = new stdClass; $n->a = $o; $n->b = $o; $o = $n; }
$text = serialize( $o );
$t = microtime( true ); $before = memory_get_peak_usage( true );
$new  = $mine( $text );
$check( 'a graph of ' . strlen( $text ) . ' bytes with a depth of 40: done in ' . round( microtime( true ) - $t, 3 ) . ' s, no memory (the other function: 2^40 copies)', microtime( true ) - $t < 2 && memory_get_peak_usage( true ) - $before < 8 * 1048576 && false !== strpos( $new, 'https://new.example.org/x' ) && false === strpos( $new, 'old.test' ) );
$u = unserialize( $new ); $v = $u; for ( $k = 0; $k < 40; $k++ ) $v = $v->a;
$check( 'and its shared parts are still shared', 'https://new.example.org/x' === $v->u && $u->a === $u->b );

// a big value: 8 MB of serialized strings are changed in one go
$big  = serialize( array_fill( 0, 40000, 'http://old.test/' . str_repeat( 'z', 190 ) ) );
$t = microtime( true ); $before = memory_get_peak_usage( true );
$new  = $mine( $big );
$check( 'a value of ' . round( strlen( $big ) / 1048576, 1 ) . ' MB with 40000 strings: ' . round( microtime( true ) - $t, 2 ) . ' s, ' . round( ( memory_get_peak_usage( true ) - $before ) / 1048576 ) . ' MB more', 40000 === count( unserialize( $new ) ) && false === strpos( $new, 'old.test' ) && ( memory_get_peak_usage( true ) - $before ) < 60 * 1048576 );

printf( "\n%d ok, %d failed\n", $ok, $bad );
exit( $bad ? 1 : 0 );
