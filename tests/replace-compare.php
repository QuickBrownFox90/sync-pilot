<?php
/**
 * Compare the replace of a push or a pull before 0.4.1 (recursive_unserialize_replace()) with the one since 0.4.1
 * (replace_value(), which reads serialized values without unserializing them) on the data of a real installation.
 * Nothing is written: every value of every text column of the tables of the site that contains a search term is run through
 * both, and every value where the results differ is reported (table, column, key, and the first place where they differ).
 * Expected differences: serialized object graphs with shared objects or references (the old function copies them and loses
 * the references) and integer keys of ArrayObject. Everything else is a reason to look.
 *
 * Values of serialized text that are bigger than --max-old bytes are only run through the new function (the old one can
 * need hundreds of times the size in memory), they are counted as "old skipped".
 *
 * Run on a COPY of the data (read only, but heavy):
 *   wp eval-file wp-content/plugins/sync-pilot/tests/replace-compare.php <search> <replace> [<search2> <replace2> ...] [--max-old=2000000] [--all-tables]
 *
 * Without --all-tables only the tables with the prefix of the site are read ($wpdb->prefix, in a network the ones of all sites).
 */

error_reporting( E_ALL ); global $wpdb, $syncpilot;

$args    = isset( $args ) ? $args : array_slice( $GLOBALS['argv'] ?? array(), 3 );
$max_old = 2000000;
$all     = false;
$pairs   = array();

foreach ( $args as $arg ) {

	if ( 0 === strpos( $arg, '--max-old=' ) )
		$max_old = (int) substr( $arg, 10 );

	elseif ( '--all-tables' === $arg )
		$all = true;

	else
		$pairs[] = $arg;
}

if ( count( $pairs ) < 2 || count( $pairs ) % 2 ) {
	echo "Usage: wp eval-file replace-compare.php <search> <replace> [<search2> <replace2> ...] [--max-old=BYTES] [--all-tables]\n";
	return;
}

// the first row of the form is the pair of the current site, empty here: the replaces start at 1
$query = array( 'replace_old[0]=&replace_new[0]=' );

for ( $i = 0; $i < count( $pairs ); $i += 2 ) {
	$query[] = 'replace_old[' . ( $i / 2 + 1 ) . ']=' . rawurlencode( $pairs[ $i ] ) . '&replace_new[' . ( $i / 2 + 1 ) . ']=' . rawurlencode( $pairs[ $i + 1 ] );
}

$syncpilot->set_migration_form_data( implode( '&', $query ) );

$tables = $wpdb->get_col( 'SHOW TABLES' );
$prefix = $wpdb->base_prefix;

$stat = array( 'values' => 0, 'with term' => 0, 'same' => 0, 'differ' => 0, 'old skipped' => 0 );
$diffs = array();

foreach ( $tables as $table ) {

	if ( ! $all && 0 !== strpos( $table, $prefix ) )
		continue;

	if ( 0 === strpos( $table, '_mig_' ) )
		continue;

	$strings = array();

	foreach ( $wpdb->get_results( 'SHOW COLUMNS FROM `' . esc_sql( $table ) . '`', ARRAY_A ) as $column ) {

		if ( preg_match( '/^(?:char|varchar|tinytext|text|mediumtext|longtext|json)\b/i', $column['Type'] ) )
			$strings[] = $column['Field'];
	}

	if ( ! $strings )
		continue;

	$key = $wpdb->get_row( "SHOW KEYS FROM `" . esc_sql( $table ) . "` WHERE Key_name = 'PRIMARY'", ARRAY_A );
	$key = $key ? $key['Column_name'] : $strings[0];

	foreach ( $strings as $column ) {

		$last = null;

		while ( true ) {

			$sql  = "SELECT `$key` AS k, `$column` AS v FROM `" . esc_sql( $table ) . '`';
			$sql .= null === $last ? '' : $wpdb->prepare( " WHERE `$key` > %s", $last );
			$sql .= " ORDER BY `$key` LIMIT 50";

			$rows = $wpdb->get_results( $sql, ARRAY_A );

			if ( ! $rows )
				break;

			foreach ( $rows as $row ) {

				$last = $row['k'];
				$v    = $row['v'];

				$stat['values']++;

				if ( ! is_string( $v ) || ! $syncpilot->contains_search_term( $v ) )
					continue;

				$stat['with term']++;

				$new = $syncpilot->replace_value( $v );

				if ( is_serialized( $v ) && strlen( $v ) > $max_old ) {
					$stat['old skipped']++;
					continue;
				}

				$old = $syncpilot->recursive_unserialize_replace( $v );

				if ( $old === $new ) {
					$stat['same']++;
					continue;
				}

				$stat['differ']++;

				$at = 0;
				$n  = min( strlen( (string) $old ), strlen( $new ) );
				while ( $at < $n && $old[ $at ] === $new[ $at ] ) $at++;

				$diffs[] = sprintf( "%s.%s [%s] old %d bytes, new %d bytes, first difference at %d\n      old: %s\n      new: %s",
					$table, $column, $row['k'], strlen( (string) $old ), strlen( $new ), $at,
					json_encode( substr( (string) $old, max( 0, $at - 30 ), 90 ) ), json_encode( substr( $new, max( 0, $at - 30 ), 90 ) ) );
			}

			if ( count( $rows ) < 50 )
				break;
		}
	}
}

foreach ( $stat as $name => $count )
	printf( "%-16s %d\n", $name, $count );

if ( $diffs ) {
	echo "\nDifferences:\n";

	foreach ( array_slice( $diffs, 0, 50 ) as $diff )
		echo "  $diff\n";

	if ( count( $diffs ) > 50 )
		echo '  ... and ' . ( count( $diffs ) - 50 ) . " more\n";
}
