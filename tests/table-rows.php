<?php
/**
 * Checks of the number of rows per table (SyncPilot::get_table_row_count()), from which the progress of a migration is
 * worked out. MySQL 8 gives the columns of INFORMATION_SCHEMA in capitals (TABLE_NAME): a query without names of its own for
 * the columns gave no table at all, and the progress was NaN%. A stand-in for the database answers like MySQL 8 does.
 *
 * Run on a TEST installation only:   wp eval-file wp-content/plugins/sync-pilot/tests/table-rows.php
 */

error_reporting( E_ALL ); global $syncpilot, $wpdb; $ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };

// the answer of MySQL 8: the columns of INFORMATION_SCHEMA are in capitals, unless the query gives them a name of its own
class SP_Test_Mysql8 extends wpdb {

	public $rows = array(
		array( 'TABLE_NAME' => 'wp_posts',   'TABLE_ROWS' => '120' ),
		array( 'TABLE_NAME' => 'wp_empty',   'TABLE_ROWS' => '0' ),
		array( 'TABLE_NAME' => 'wp_unknown', 'TABLE_ROWS' => null ),
	);

	function __construct() {}
	function prepare( $query, ...$args ) { return $query; }

	function get_results( $query = null, $output = OBJECT ) {

		$names = array();

		// "SELECT TABLE_NAME AS "name", TABLE_ROWS AS "row_count"": the aliases are the keys of the rows
		if ( preg_match_all( '/(TABLE_NAME|TABLE_ROWS)\s+AS\s+"(\w+)"/i', $query, $found, PREG_SET_ORDER ) )
			foreach ( $found as $f )
				$names[ strtoupper( $f[1] ) ] = $f[2];

		$result = array();

		foreach ( $this->rows as $row ) {

			$one = array();

			foreach ( $row as $column => $value )
				$one[ $names[ $column ] ?? $column ] = $value;

			$result[] = $one;
		}

		return $result;
	}
}

$real           = $wpdb;
$GLOBALS['wpdb'] = new SP_Test_Mysql8();
$rows           = $syncpilot->get_table_row_count();
$GLOBALS['wpdb'] = $real;

$check( 'a database that answers in capitals (MySQL 8): every table has its number', array( 'wp_posts', 'wp_empty', 'wp_unknown' ) === array_keys( $rows ), json_encode( $rows ) );
$check( 'the number of rows is the number of rows', 120 === (int) $rows['wp_posts'] );
$check( 'a table without rows, and one with an unknown number (NULL), count as 1', 1 === (int) $rows['wp_empty'] && 1 === (int) $rows['wp_unknown'] );

$rows = $syncpilot->get_table_row_count();
$check( 'on this database: the tables of the site with a number each', isset( $rows[ $wpdb->posts ] ) && (int) $rows[ $wpdb->posts ] >= 1 && count( $rows ) > 10, count( $rows ) . ' tables' );
$check( 'and no table without a name', ! isset( $rows[''] ) );

echo "\n$ok ok, $bad failed\n";
