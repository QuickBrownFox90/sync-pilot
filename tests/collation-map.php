<?php
/**
 * The collations of a push or a pull: a CREATE TABLE of a chunk with a collation or character set that this database does not
 * know is run with a similar one that it knows (SyncPilot::map_collations_in_query() in process_chunk()), the other queries
 * and the CREATE TABLE with known collations stay as they are, and the log tells what was replaced.
 *
 * Run on a TEST installation only:   wp eval-file wp-content/plugins/sync-pilot/tests/collation-map.php
 */

error_reporting( E_ALL ); global $syncpilot, $wpdb; $ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };

$t1 = 'syncpilot_zz_cm1'; $t2 = 'syncpilot_zz_cm2'; $t3 = 'syncpilot_zz_cm3';
foreach ( array( $t1, $t2, $t3 ) as $t ) $wpdb->query( "DROP TABLE IF EXISTS `$t`" );

$coll = fn( $t ) => $wpdb->get_var( $wpdb->prepare( 'SELECT TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s', $t ) );
$col  = fn( $t ) => $wpdb->get_var( $wpdb->prepare( 'SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s', $t, 'a' ) );

// unknown collation and unknown name of the character set
$sql  = "CREATE TABLE `$t1` (\n `id` int NOT NULL,\n `a` varchar(20) COLLATE utf8mb4_zzunknown_ai_ci DEFAULT NULL COMMENT 'COLLATE utf8mb4_zzunknown_ai_ci stays in a comment'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_zzunknown_ai_ci;\n";
$sql .= "CREATE TABLE `$t2` (\n `id` int NOT NULL,\n `a` varchar(80) COLLATE utf8mb4_bin DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;\n";
$sql .= "CREATE TABLE `$t3` (\n `id` int NOT NULL,\n `a` varchar(20) COLLATE utf8mb4_zzunknown_bin DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_zzunknown_bin;\n";
$sql .= "INSERT INTO `$t2` VALUES (1, 'CREATE TABLE x COLLATE utf8mb4_zzunknown_ai_ci');\n";

SyncPilot_Logger::clear();
$syncpilot->set_migration_form_data( 'action=pull' );
$result = $syncpilot->process_chunk( $sql );

$check( 'the chunk ran', true === $result );
$check( 'unknown collation became the one of WordPress', 'utf8mb4_unicode_520_ci' === $coll( $t1 ), (string) $coll( $t1 ) );
$check( 'also the collation of the column', 'utf8mb4_unicode_520_ci' === $col( $t1 ), (string) $col( $t1 ) );
$check( 'a known collation stays', 'utf8mb4_bin' === $coll( $t2 ) && 'utf8mb4_bin' === $col( $t2 ) );
$check( 'an unknown binary collation stays binary', 'utf8mb4_bin' === $coll( $t3 ) );
$check( 'an INSERT is not touched', 'CREATE TABLE x COLLATE utf8mb4_zzunknown_ai_ci' === $wpdb->get_var( "SELECT a FROM `$t2`" ) );

$comment = $wpdb->get_var( $wpdb->prepare( 'SELECT COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s', $t1, 'a' ) );
$check( 'the text of a comment is not touched', 'COLLATE utf8mb4_zzunknown_ai_ci stays in a comment' === $comment );

$log = implode( "\n", array_map( fn( $l ) => is_string( $l ) ? $l : json_encode( $l ), (array) SyncPilot_Logger::lines() ) );
$check( 'the log names the table and the collations', false !== strpos( $log, 'Collation mapped' ) && false !== strpos( $log, $t1 ) && false !== strpos( $log, 'utf8mb4_zzunknown_ai_ci' ) );
$check( 'one entry for each table that was changed', 2 === substr_count( $log, 'Collation mapped' ), (string) substr_count( $log, 'Collation mapped' ) );

foreach ( array( $t1, $t2, $t3 ) as $t ) $wpdb->query( "DROP TABLE IF EXISTS `$t`" );
SyncPilot_Logger::clear();
$check( 'no test table is left', ! $wpdb->get_var( "SHOW TABLES LIKE 'syncpilot_zz_cm%'" ) );

printf( "\n%d ok, %d failed\n", $ok, $bad );
