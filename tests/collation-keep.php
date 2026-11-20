<?php
/**
 * The choice "keep the collations" of a push (SyncPilot::keep_collations_in_query()): a table that exists on the receiving
 * site keeps its collation (table and columns), a table that is new gets the collation of the posts table (a binary column
 * stays binary), another character set is left alone, and nothing happens without the choice.
 *
 * Run on a TEST installation only:   wp eval-file wp-content/plugins/sync-pilot/tests/collation-keep.php
 */

error_reporting( E_ALL ); global $syncpilot, $wpdb; $ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };

$live = 'syncpilot_zz_ck1'; $new = 'syncpilot_zz_ck2'; $other = 'syncpilot_zz_ck3';
$drop = function () use ( $wpdb, $live, $new, $other ) { foreach ( array( $live, $new, $other ) as $t ) { $wpdb->query( "DROP TABLE IF EXISTS `$t`" ); $wpdb->query( "DROP TABLE IF EXISTS `_mig_$t`" ); } };
$drop();

$coll  = fn( $t ) => $wpdb->get_var( $wpdb->prepare( 'SELECT TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s', $t ) );
$col   = fn( $t, $c ) => $wpdb->get_var( $wpdb->prepare( 'SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s', $t, $c ) );
$posts = $coll( $wpdb->posts );

// the live site: a table with a collation that is not the one of the posts table
$other_coll = 'utf8mb4_general_ci' === $posts ? 'utf8mb4_unicode_ci' : 'utf8mb4_general_ci';
$wpdb->query( "CREATE TABLE `$live` (`id` int NOT NULL, `a` varchar(20) COLLATE $other_coll DEFAULT NULL, `b` varchar(20) COLLATE utf8mb4_bin DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=$other_coll" );

$inc = 'utf8mb4_unicode_520_ci' === $posts ? 'utf8mb4_swedish_ci' : 'utf8mb4_unicode_520_ci';
$make = fn( $t, $charset = 'utf8mb4', $c = null ) => "CREATE TABLE `_mig_$t` (\n  `id` int NOT NULL,\n  `a` varchar(20) COLLATE " . ( $c ?? $inc ) . " DEFAULT 'COLLATE x',\n  `b` varchar(20) COLLATE {$inc} DEFAULT NULL,\n  `k` varchar(20) COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'COLLATE y',\n  KEY `a` (`a`)\n) ENGINE=InnoDB DEFAULT CHARSET=$charset COLLATE=" . ( $c ?? $inc ) . " COMMENT='COLLATE z';\n";

$ref = new ReflectionProperty( $syncpilot, 'keep_collations' ); $ref->setAccessible( true );
$syncpilot->set_migration_form_data( 'action=push' );

// without the choice nothing is touched
$ref->setValue( $syncpilot, false );
SyncPilot_Logger::clear();
$syncpilot->process_chunk( $make( $live ) );
$check( 'without the choice the table has what it came with', $inc === $coll( "_mig_$live" ), (string) $coll( "_mig_$live" ) );
$wpdb->query( "DROP TABLE `_mig_$live`" );

// a table that exists
$ref->setValue( $syncpilot, true );
SyncPilot_Logger::clear();
$syncpilot->process_chunk( $make( $live ) );
$check( 'an existing table keeps the collation of the table', $other_coll === $coll( "_mig_$live" ), (string) $coll( "_mig_$live" ) );
$check( 'the column keeps its collation', $other_coll === $col( "_mig_$live", 'a' ), (string) $col( "_mig_$live", 'a' ) );
$check( 'a column keeps the collation that it has on the live site, a binary one too', 'utf8mb4_bin' === $col( "_mig_$live", 'b' ), (string) $col( "_mig_$live", 'b' ) );
$check( 'a binary column stays binary', 'utf8mb4_bin' === $col( "_mig_$live", 'k' ) );
$check( 'text in a default and in comments is not touched', 'COLLATE x' === $wpdb->get_var( $wpdb->prepare( 'SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s', "_mig_$live", 'a' ) ) || "'COLLATE x'" === $wpdb->get_var( $wpdb->prepare( 'SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s', "_mig_$live", 'a' ) ) );
$log = implode( "\n", array_map( fn( $l ) => is_string( $l ) ? $l : json_encode( $l ), (array) SyncPilot_Logger::lines() ) );
$check( 'the log has "Collation kept" with the table', false !== strpos( $log, 'Collation kept' ) && false !== strpos( $log, $live ) );

// a table that is new
SyncPilot_Logger::clear();
$syncpilot->process_chunk( $make( $new ) );
$check( 'a new table gets the collation of the posts table', $posts === $coll( "_mig_$new" ), (string) $coll( "_mig_$new" ) . ' / ' . $posts );
$check( 'its columns too, a binary one stays binary', $posts === $col( "_mig_$new", 'a' ) && 'utf8mb4_bin' === $col( "_mig_$new", 'k' ) );

// another character set is not touched
$syncpilot->process_chunk( "CREATE TABLE `_mig_$other` (\n  `id` int NOT NULL,\n  `a` varchar(20) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;\n" );
$check( 'a table of another character set stays', 'latin1_swedish_ci' === $coll( "_mig_$other" ) && 'latin1_swedish_ci' === $col( "_mig_$other", 'a' ) );

$ref->setValue( $syncpilot, false );
$drop();
SyncPilot_Logger::clear();
$check( 'no test table is left', ! $wpdb->get_var( "SHOW TABLES LIKE '%syncpilot_zz_ck%'" ) );

printf( "\n%d ok, %d failed\n", $ok, $bad );
