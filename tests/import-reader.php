<?php
/**
 * Checks of the reader of dumps (SyncPilot_Dump_Reader) and of what the import allows a statement to do
 * (SyncPilot_Import::classify() and the helpers around it): strings, comments and escapes with a semicolon in them,
 * blocks that cut a statement anywhere, gzip, going on at a place, files that are cut off, the statements that are run,
 * skipped and refused, the temporary name of a table, the collations. And a real dump of the test site: every statement of
 * it is understood, as many CREATE TABLE as tables and as many INSERT as the file has.
 *
 * Run on a TEST installation only:   wp eval-file wp-content/plugins/sync-pilot/tests/import-reader.php
 */

error_reporting( E_ALL ); global $wpdb; $ok = 0; $bad = 0;
$check = function ( $label, $cond, $info = '' ) use ( &$ok, &$bad ) { $cond ? $ok++ : $bad++; printf( "%-4s %s%s\n", $cond ? 'ok' : 'FAIL', $label, '' !== $info ? "  | $info" : '' ); };
$I     = 'SyncPilot_Import';
$R     = 'SyncPilot_Dump_Reader';
$tmp   = sys_get_temp_dir() . '/syncpilot-reader-test-' . uniqid();
mkdir( $tmp );

$read_all = function ( $path, $offset = 0, $block = 1048576, $max = 0 ) use ( $R ) {
	$reader = new $R( $path, $offset, $block, $max );
	$list   = array();
	while ( is_array( $statement = $reader->next() ) ) $list[] = $statement;
	return array( $list, $reader );
};
$sqls = fn( $list ) => array_map( fn( $s ) => $s['sql'], $list );

// -- a dump with everything in it that makes a semicolon not the end
$dump = "-- a comment; with a semicolon\n"
	. "/* a block; comment\nover two lines; */\n"
	. "# a hash; comment\n"
	. "SET NAMES utf8mb4;\n"
	. "INSERT INTO `t` VALUES (1,'a;b'),(2,'it''s;'),(3,'back\\';'),(4,\"dq;\\\"x\"),(5,'-- not a comment;'),(6,'/* not; */'),(7,'ü;ß;日本');\n"
	. "INSERT INTO `we;ird``name` VALUES (1);\n"
	. "DROP TABLE IF EXISTS `t`; DROP TABLE IF EXISTS `u`;\n"
	. "/*!40101 SET @x=1 */;\n"
	. "/*M!999999\\- enable the sandbox mode */\n"
	. "SET @y=2;\n"
	. ";;\n"
	. "SELECT 1--2;\n"
	. "SELECT 'a'-- comment ; here\n;\n"
	. "SELECT 'back\\\\\\\\'; SELECT 'next';\n"
	. "UNLOCK TABLES\n-- the file ends without a semicolon\n";

$expected = array(
	"SET NAMES utf8mb4",
	"INSERT INTO `t` VALUES (1,'a;b'),(2,'it''s;'),(3,'back\\';'),(4,\"dq;\\\"x\"),(5,'-- not a comment;'),(6,'/* not; */'),(7,'ü;ß;日本')",
	"INSERT INTO `we;ird``name` VALUES (1)",
	"DROP TABLE IF EXISTS `t`",
	"DROP TABLE IF EXISTS `u`",
	"SET @x=1",
	"SET @y=2",
	"SELECT 1--2",
	"SELECT 'a'-- comment ; here",
	"SELECT 'back\\\\\\\\'",
	"SELECT 'next'",
	"UNLOCK TABLES\n-- the file ends without a semicolon",
);

$plain = $tmp . '/dump.sql';
$gz    = $tmp . '/dump.sql.gz';
file_put_contents( $plain, $dump );
file_put_contents( $gz, gzencode( $dump ) );

echo "-- the reader\n";
foreach ( array( 'plain' => $plain, 'gzip' => $gz ) as $kind => $file ) {

	$wrong = array();

	// blocks of 16 bytes and more: a statement, a quote, "--", "/*", "*/" or an escape is cut at every place once
	foreach ( array( 16, 17, 19, 23, 31, 64, 1000, 1048576 ) as $block ) {
		list( $list, $reader ) = $read_all( $file, 0, $block );
		if ( $sqls( $list ) !== $expected || '' !== $reader->error() ) $wrong[] = $block . ' (' . count( $list ) . ' statements' . ( '' !== $reader->error() ? ', ' . $reader->error() : '' ) . ')';
	}

	$check( "$kind: the statements are the same for every size of the block", array() === $wrong, implode( ', ', $wrong ) );
}

list( $list ) = $read_all( $plain );
$wrong = array();
foreach ( $list as $n => $s )
	if ( ';' !== $dump[ $s['end'] - 1 ] && $s['end'] !== strlen( $dump ) ) $wrong[] = 'end ' . $n;
$check( 'the place after a statement is behind its semicolon', array() === $wrong, implode( ', ', $wrong ) );

// going on at a place: after every statement, with another reader, in a plain and a gzip file
foreach ( array( 'plain' => $plain, 'gzip' => $gz ) as $kind => $file ) {

	$wrong = array();

	foreach ( $list as $n => $s ) {
		list( $rest, $reader ) = $read_all( $file, $s['end'], 23 );
		if ( $sqls( $rest ) !== array_slice( $expected, $n + 1 ) || '' !== $reader->error() ) $wrong[] = 'after ' . $n;
	}

	$check( "$kind: a reader that goes on after any statement gives the rest", array() === $wrong, implode( ', ', $wrong ) );
}

$reader = new $R( $plain, 0, 20 );
$reader->next(); $reader->next();
$check( 'offset() is the place after the last statement that was given', $list[1]['end'] === $reader->offset(), $reader->offset() . ' / ' . $list[1]['end'] );

// the comments that only some servers run: the server decides, as it does when it runs the text itself
$mysql8 = array( 'mariadb' => false, 'version' => 80413 ); $mysql57 = array( 'mariadb' => false, 'version' => 50744 ); $maria5 = array( 'mariadb' => true, 'version' => 100529 ); $maria11 = array( 'mariadb' => true, 'version' => 110806 );
$clean  = fn( $text, $server ) => $R::clean( $text, $server );
$check( 'a conditional comment is run by a server of that version or a newer one', 'SET @a=1' === $clean( '/*!40101 SET @a=1 */', $mysql57 ) && 'SET @a=1' === $clean( '/*!80000 SET @a=1 */', $mysql8 ) && '' === $clean( '/*!80000 SET @a=1 */', $mysql57 ) );
$check( 'a comment with M! is run by MariaDB only, and of that version or a newer one', '' === $clean( '/*M!100616 SET @a=1 */', $mysql8 ) && '' === $clean( '/*M!100616 SET @a=1 */', $maria5 ) && 'SET @a=1' === $clean( '/*M!100616 SET @a=1 */', $maria11 ) );
$check( 'the number 999999 is a comment for every server', '' === $clean( "/*M!999999\\- enable the sandbox mode */", $maria11 ) && '' === $clean( '/*!999999 SET @a=1 */', $maria11 ) );
$check( 'a comment in front of a statement is dropped, a conditional comment that is not the whole statement is not opened', 'SET @a=1' === $clean( "/* x */ -- y\n# z\nSET @a=1", $mysql8 ) && '/*!50100 PARTITION */ x' === $clean( '/*!50100 PARTITION */ x', $mysql8 ) );

// CRLF and a file that is gzip without its name saying so
file_put_contents( $tmp . '/crlf.sql', "SET NAMES utf8;\r\nINSERT INTO t VALUES ('a;\r\nb');\r\n-- c\r\nUNLOCK TABLES;\r\n" );
list( $crlf ) = $read_all( $tmp . '/crlf.sql', 0, 16 );
$check( 'lines that end with CRLF', array( 'SET NAMES utf8', "INSERT INTO t VALUES ('a;\r\nb')", 'UNLOCK TABLES' ) === $sqls( $crlf ), json_encode( $sqls( $crlf ) ) );
copy( $gz, $tmp . '/disguised.dat' );
list( $disguised, $dreader ) = $read_all( $tmp . '/disguised.dat', 0, 64 );
$check( 'the content decides what the file is, not the name', $dreader->is_gzip() && $sqls( $disguised ) === $expected );
file_put_contents( $tmp . '/plain.sql.gz', $dump );
list( $named, $nreader ) = $read_all( $tmp . '/plain.sql.gz', 0, 64 );
$check( 'a plain file with the name of a gzip file is read as plain', ! $nreader->is_gzip() && $sqls( $named ) === $expected );

// a statement of several megabytes in blocks of 64 KB, with all the characters that matter in it
$piece = "it''s; -- x /* y */ \\\\' \\' `z` \"q\" ü\n";
$big   = "INSERT INTO `t` VALUES ('" . str_repeat( $piece, 150000 ) . "');\nSELECT 2;\n";
file_put_contents( $tmp . '/big.sql', $big );
list( $bigl, $breader ) = $read_all( $tmp . '/big.sql', 0, 65536, 20 * 1048576 );
$check( 'a statement of ' . round( strlen( $big ) / 1048576, 1 ) . ' MB in blocks of 64 KB is one statement', 2 === count( $bigl ) && 'SELECT 2' === $bigl[1]['sql'] && strlen( $bigl[0]['sql'] ) === strlen( $big ) - strlen( ";\nSELECT 2;\n" ) && '' === $breader->error(), count( $bigl ) . ' statements' );
list( $none, $treader ) = $read_all( $tmp . '/big.sql', 0, 65536, 1048576 );
$check( 'a statement over the limit stops the reading with statement_too_large', array() === $none && 'statement_too_large' === $treader->error() && false === $treader->next(), $treader->error() );

// files that cannot be read as they are
file_put_contents( $tmp . '/cut.sql', "SET NAMES utf8;\nINSERT INTO t VALUES ('abc" );
list( $cut, $creader ) = $read_all( $tmp . '/cut.sql' );
$check( 'a file that ends inside a string: the statements before it are given, then unterminated', array( 'SET NAMES utf8' ) === $sqls( $cut ) && 'unterminated' === $creader->error() );
file_put_contents( $tmp . '/comments.sql', "-- nothing\n/* here */\n# at all\n" ); file_put_contents( $tmp . '/empty.sql', '' );
list( $comments, $cmreader ) = $read_all( $tmp . '/comments.sql' ); list( $empty, $ereader ) = $read_all( $tmp . '/empty.sql' );
$check( 'a file of comments and an empty file have no statements and no error', array() === $comments && array() === $empty && '' === $cmreader->error() && '' === $ereader->error() );
$mreader = new $R( $tmp . '/missing.sql' );
$check( 'a file that is not there: false and open_failed', false === $mreader->next() && 'open_failed' === $mreader->error() );
file_put_contents( $tmp . '/cut.gz', substr( gzencode( str_repeat( "INSERT INTO t VALUES (1);\n", 2000 ) ), 0, 100 ) );
list( $gcut, $gcreader ) = $read_all( $tmp . '/cut.gz' );
$check( 'a gzip file that is cut off ends the reading: fewer statements than in the file, no endless loop', count( $gcut ) < 2000 );

// -- what a statement may do
echo "-- classify\n";
$cases = array(
	// sql => array( action, kind or reason, table )
	array( "DROP TABLE IF EXISTS `wp_posts`",                                   'run',    'drop_table',  'wp_posts' ),
	array( "DROP TABLE wp_posts",                                               'run',    'drop_table',  'wp_posts' ),
	array( "DROP TABLE IF EXISTS `a`, `b`",                                      'reject', 'DROP TABLE',  null, 'form' ),
	array( "DROP TABLE `db`.`a`",                                               'reject', 'DROP TABLE',  null, 'qualified' ),
	array( "DROP DATABASE wp",                                                  'reject', 'DROP DATABASE', null, 'form' ),
	array( "CREATE TABLE `wp_posts` (\n  `ID` bigint(20) unsigned NOT NULL,\n  PRIMARY KEY (`ID`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci", 'run', 'create_table', 'wp_posts' ),
	array( "CREATE TABLE IF NOT EXISTS wp_x (a int)",                            'run',    'create_table', 'wp_x' ),
	array( "CREATE TABLE `select` (`select` text DEFAULT 'select from references', `directory` int COMMENT 'data directory')", 'run', 'create_table', 'select' ),
	array( "CREATE TABLE `a``b` (id int)",                                      'run',    'create_table', 'a`b' ),
	array( "CREATE TABLE a LIKE b",                                             'reject', 'CREATE TABLE', null, 'form' ),
	array( "CREATE TABLE a AS SELECT * FROM b",                                 'reject', 'CREATE TABLE', null, 'form' ),
	array( "CREATE TABLE a (id int) SELECT * FROM b",                           'reject', 'CREATE TABLE', null, 'select' ),
	array( "CREATE TABLE a (id int, FOREIGN KEY (id) REFERENCES wp_users (ID))", 'reject', 'CREATE TABLE', null, 'reference' ),
	array( "CREATE TABLE a (id int) DATA DIRECTORY='/etc'",                     'reject', 'CREATE TABLE', null, 'file' ),
	array( "CREATE TABLE `db`.`a` (id int)",                                    'reject', 'CREATE TABLE', null, 'qualified' ),
	array( "CREATE TABLE a (id int)\n/*!50100 PARTITION BY HASH (id) PARTITIONS 4 */", 'run', 'create_table', 'a' ),
	array( "CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW SET NEW.x=1",      'reject', 'CREATE TRIGGER', null, 'form' ),
	array( "CREATE VIEW v AS SELECT 1",                                         'reject', 'CREATE VIEW', null, 'form' ),
	array( "CREATE DATABASE `wp`",                                              'skip',   'create_database' ),
	array( "INSERT INTO `wp_posts` VALUES (1,'select * from wp_users; drop','x')",       'run', 'insert', 'wp_posts' ),
	array( "INSERT INTO `wp_posts` (`ID`, `post_title`) VALUES (1,'a'),(2,'b')", 'run', 'insert', 'wp_posts' ),
	array( "INSERT IGNORE INTO wp_posts VALUE (1)",                             'run',    'insert', 'wp_posts' ),
	array( "INSERT INTO `wp_posts` VALUES (1,(SELECT 1))",                       'reject', 'INSERT INTO', null, 'select' ),
	array( "INSERT INTO `wp_posts` SELECT * FROM wp_users",                      'reject', 'INSERT INTO', null, 'form' ),
	array( "INSERT INTO `wp_posts` SET ID=1",                                    'reject', 'INSERT INTO', null, 'form' ),
	array( "INSERT INTO other.wp_posts VALUES (1)",                              'reject', 'INSERT INTO', null, 'qualified' ),
	array( "SET NAMES utf8mb4",                                                  'run',    'set' ),
	array( "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci",                       'run',    'set' ),
	array( "SET FOREIGN_KEY_CHECKS=0",                                           'run',    'set' ),
	array( "SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0",            'run',    'set' ),
	array( "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO,NO_ENGINE_SUBSTITUTION'",        'run',    'set' ),
	array( "SET TIME_ZONE='+00:00'",                                             'run',    'set' ),
	array( "SET @saved_cs_client     = @@character_set_client",                  'run',    'set' ),
	array( "SET character_set_client = utf8mb4",                                 'run',    'set' ),
	array( "SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ 'abc:1-2'",                  'skip',   'set' ),
	array( "SET GLOBAL max_allowed_packet=1",                                    'skip',   'set' ),
	array( "SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0",                     'skip',   'set' ),
	array( "SET AUTOCOMMIT=@OLD_AUTOCOMMIT",                                     'skip',   'set' ),
	array( "SET @@SESSION.SQL_LOG_BIN= 0",                                       'skip',   'set' ),
	array( "SET PASSWORD = 'x'",                                                 'reject', 'SET', null, 'variable' ),
	array( "SET max_execution_time=0",                                           'reject', 'SET', null, 'variable' ),
	array( "SET @a=(SELECT 1)",                                                  'reject', 'SET', null, 'select' ),
	array( "LOCK TABLES `wp_posts` WRITE",                                       'skip',   'lock' ),
	array( "UNLOCK TABLES",                                                      'skip',   'unlock' ),
	array( "START TRANSACTION",                                                  'skip',   'transaction' ),
	array( "COMMIT",                                                             'skip',   'commit' ),
	array( "USE `wp`",                                                           'skip',   'use' ),
	array( "ALTER TABLE `wp_posts` DISABLE KEYS",                                'skip',   'keys' ),
	array( "ALTER TABLE `wp_posts` ADD COLUMN x int",                            'reject', 'ALTER TABLE', null, 'form' ),
	array( "UPDATE wp_users SET user_pass='secret'",                             'reject', 'UPDATE', null, 'unknown' ),
	array( "DELETE FROM wp_users",                                               'reject', 'DELETE FROM', null, 'unknown' ),
	array( "TRUNCATE TABLE wp_users",                                            'reject', 'TRUNCATE TABLE', null, 'unknown' ),
	array( "REPLACE INTO wp_users VALUES (1)",                                   'reject', 'REPLACE INTO', null, 'unknown' ),
	array( "GRANT ALL ON *.* TO 'x'@'%'",                                        'reject', 'GRANT', null, 'unknown' ),
	array( "SELECT * FROM wp_users INTO OUTFILE '/tmp/x'",                       'reject', 'SELECT', null, 'unknown' ),
	array( "LOAD DATA INFILE '/etc/passwd' INTO TABLE t",                        'reject', 'LOAD DATA', null, 'unknown' ),
	array( "DELIMITER ;;",                                                       'reject', 'DELIMITER', null, 'unknown' ),
	array( "CALL evil()",                                                        'reject', 'CALL', null, 'unknown' ),
	array( "RENAME TABLE a TO b",                                                'reject', 'RENAME TABLE', null, 'unknown' ),
	array( "/*!50003 CREATE*/ /*!50017 DEFINER=x*/ /*!50003 TRIGGER t BEFORE INSERT ON a FOR EACH ROW x */", 'reject', 'UNKNOWN', null, 'unknown' ),
	array( "1 = 1",                                                              'reject', 'UNKNOWN', null, 'unknown' ),
);

$wrong = array();
foreach ( $cases as $case ) {
	$info = $I::classify( $case[0] );
	$name = 'run' === $case[1] && isset( $case[3] ) ? $case[3] : null;
	$good = $case[1] === $info['action'] && ( 'reject' === $case[1] ? $case[2] === $info['kind'] && ( $case[4] ?? '' ) === $info['reason'] : $case[2] === $info['kind'] ) && ( null === $name || $name === ( $info['table'] ?? null ) );
	if ( ! $good ) $wrong[] = substr( str_replace( "\n", ' ', $case[0] ), 0, 40 ) . ' => ' . json_encode( array_intersect_key( $info, array_flip( array( 'action', 'kind', 'reason', 'table' ) ) ) );
}
$check( count( $cases ) . ' statements: run, skipped or refused as they should be, with the table', array() === $wrong, implode( ' | ', $wrong ) );

$info = $I::classify( "UPDATE wp_users SET user_pass='secret' WHERE ID=1" );
$check( 'what is said of a refused statement has no name and no value in it', 'UPDATE' === $info['kind'] && false === strpos( json_encode( $info ), 'secret' ) && false === strpos( json_encode( $info ), 'wp_users' ) );
$info = $I::classify( "DROP TABLE secret_table_name, other" );
$check( 'neither has the refusal of a DROP', 'DROP TABLE' === $info['kind'] && false === strpos( json_encode( $info ), 'secret' ) );

// -- the temporary name of a table
$sql  = "CREATE TABLE `wp_posts` (\n  `post_title` text COMMENT 'wp_posts'\n) ENGINE=InnoDB";
$info = $I::classify( $sql );
$check( 'with_table changes the name of the table and nothing else', "CREATE TABLE `_mig_wp_posts` (\n  `post_title` text COMMENT 'wp_posts'\n) ENGINE=InnoDB" === $I::with_table( $sql, $info, '_mig_wp_posts' ), $I::with_table( $sql, $info, '_mig_wp_posts' ) );
$sql  = "INSERT INTO wp_options VALUES (1,'INSERT INTO wp_options')";
$check( 'also a name without backticks, and the same name in a value stays', "INSERT INTO `_mig_wp_options` VALUES (1,'INSERT INTO wp_options')" === $I::with_table( $sql, $I::classify( $sql ), '_mig_wp_options' ) );
$sql  = "DROP TABLE IF EXISTS `a``b`";
$check( 'a name with a backtick in it', "DROP TABLE IF EXISTS `_mig_a``b`" === $I::with_table( $sql, $I::classify( $sql ), '_mig_a`b' ) );

// -- the masked text and the collations
$check( 'mask_literals: strings, names and comments are masked, a conditional comment stays', "SELECT '' , `` , ''  /*!50100 X */ y" === $I::mask_literals( "SELECT 'a;''b' , `c``d` , \"e\\\"f\" -- x\n/*!50100 X */ y" ) || "SELECT '' , `` , ''   \n/*!50100 X */ y" === $I::mask_literals( "SELECT 'a;''b' , `c``d` , \"e\\\"f\" -- x\n/*!50100 X */ y" ), json_encode( $I::mask_literals( "SELECT 'a;''b' , `c``d` , \"e\\\"f\" -- x\n/*!50100 X */ y" ) ) );
$used = $I::classify( "CREATE TABLE a (`c` varchar(10) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT 'COLLATE nothing') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci" );
$check( 'the collations and character sets of a CREATE TABLE, the text of a default is not one', array( 'latin1_swedish_ci', 'utf8mb4_0900_ai_ci' ) === $used['collations'] && array( 'latin1', 'utf8mb4' ) === $used['charsets'], json_encode( array( $used['collations'], $used['charsets'] ) ) );

$known = array_map( 'strtolower', $wpdb->get_col( 'SHOW COLLATION' ) ); $chars = array_map( 'strtolower', $wpdb->get_col( 'SHOW CHARACTER SET' ) );
$missing = $I::unsupported_collations( array( 'collations' => array( 'utf8mb4_unicode_ci', 'klingon_ci', 'utf8mb4_0900_ai_ci' ), 'charsets' => array( 'utf8mb4', 'klingon' ) ) );
$check( 'a collation or character set that this database does not know is found, the ones it knows are not', in_array( 'klingon_ci', $missing['collations'], true ) && ! in_array( 'utf8mb4_unicode_ci', $missing['collations'], true ) && in_array( 'utf8mb4_0900_ai_ci', $missing['collations'], true ) === ! in_array( 'utf8mb4_0900_ai_ci', $known, true ) && array( 'klingon' ) === $missing['charsets'], json_encode( $missing ) );
$check( 'nothing is missing when everything is known', array( 'collations' => array(), 'charsets' => array() ) === $I::unsupported_collations( array( 'collations' => array( 'utf8mb4_unicode_ci' ), 'charsets' => array( 'utf8mb4' ) ) ) );

// -- a collation that this database does not know is replaced by a similar one
$known = array( 'utf8mb4_unicode_520_ci', 'utf8mb4_unicode_ci', 'utf8mb4_general_ci', 'utf8mb4_bin', 'utf8_general_ci', 'utf8_bin', 'latin1_swedish_ci', 'latin1_bin' );
$check( 'utf8mb4_uca1400_ai_ci and utf8mb4_0900_ai_ci become utf8mb4_unicode_520_ci', 'utf8mb4_unicode_520_ci' === $I::map_collation( 'utf8mb4_uca1400_ai_ci', $known ) && 'utf8mb4_unicode_520_ci' === $I::map_collation( 'UTF8MB4_0900_AI_CI', $known ) );
$check( 'a binary collation stays binary', 'utf8mb4_bin' === $I::map_collation( 'utf8mb4_0900_bin', $known ) && 'latin1_bin' === $I::map_collation( 'latin1_uca1400_bin', $known ) );
$check( 'without utf8mb4_unicode_520_ci the next one of its kind is used', 'utf8mb4_unicode_ci' === $I::map_collation( 'utf8mb4_0900_ai_ci', array( 'utf8mb4_unicode_ci', 'utf8mb4_general_ci' ) ) && 'utf8mb4_general_ci' === $I::map_collation( 'utf8mb4_0900_ai_ci', array( 'utf8mb4_general_ci' ) ) );
$check( 'utf8mb3 and utf8 are one character set under two names', 'utf8_general_ci' === $I::map_collation( 'utf8mb3_general_ci', $known ) && 'utf8mb3_general_ci' === $I::map_collation( 'utf8_general_ci', array( 'utf8mb3_general_ci' ) ) && 'utf8' === $I::map_charset( 'utf8mb3', array( 'utf8', 'utf8mb4' ) ) && null === $I::map_charset( 'klingon', array( 'utf8' ) ) );
$check( 'a collation of a character set that is not known, or without one, has no mapping', null === $I::map_collation( 'klingon_ci', $known ) && null === $I::map_collation( 'klingon_unicode_ci', $known ) && null === $I::map_collation( 'nonsense', $known ) );

$sql = "CREATE TABLE `t` (`a` varchar(10) COLLATE utf8mb4_uca1400_ai_ci DEFAULT 'COLLATE utf8mb4_uca1400_ai_ci', `b` text CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci";
$out = $I::apply_collation_map( $sql, array( 'collations' => array( 'utf8mb4_uca1400_ai_ci' => 'utf8mb4_unicode_520_ci', 'utf8mb3_general_ci' => 'utf8_general_ci' ), 'charsets' => array( 'utf8mb3' => 'utf8' ) ) );
$check( 'the map is applied behind COLLATE, COLLATE= and CHARACTER SET (a name that is only part of another one is not touched)', false !== strpos( $out, '`a` varchar(10) COLLATE utf8mb4_unicode_520_ci DEFAULT' ) && false !== strpos( $out, 'CHARACTER SET utf8 COLLATE utf8_general_ci' ) && false !== strpos( $out, 'COLLATE=utf8mb4_unicode_520_ci' ) && false === strpos( $out, 'uca1400' ) && 'x COLLATE utf8mb4_uca1400_ai_ci_x' === $I::apply_collation_map( 'x COLLATE utf8mb4_uca1400_ai_ci_x', array( 'collations' => array( 'utf8mb4_uca1400_ai_ci' => 'y' ) ) ), $out );
$check( 'an empty map changes nothing', $sql === $I::apply_collation_map( $sql, array() ) );

// -- a real dump of the test site
echo "-- a dump of the database of this site\n";
$real = $tmp . '/real.sql';
$out  = array(); $status = 1;
@exec( 'wp --path=' . escapeshellarg( ABSPATH ) . ' db export ' . escapeshellarg( $real ) . ' --quiet 2>&1', $out, $status );

if ( 0 !== $status || ! is_file( $real ) ) {
	$check( 'the dump could be made with wp db export', false, implode( ' ', $out ) );
}

else {

	$tables = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s', DB_NAME ) );
	$count  = 0; preg_match_all( '/^INSERT INTO /m', file_get_contents( $real ), $found ); $count = count( $found[0] );

	foreach ( array( 'plain' => $real, 'gzip' => $real . '.gz' ) as $kind => $file ) {

		if ( 'gzip' === $kind )
			file_put_contents( $file, gzencode( file_get_contents( $real ) ) );

		$started = microtime( true );
		list( $statements, $reader ) = $read_all( $file, 0, 262144 );
		$counts  = array( 'create_table' => 0, 'insert' => 0, 'drop_table' => 0, 'set' => 0 );
		$actions = array( 'run' => 0, 'skip' => 0, 'reject' => 0 ); $refused = array();

		foreach ( $statements as $s ) {
			$info = $I::classify( $s['sql'] );
			$actions[ $info['action'] ]++;
			if ( isset( $counts[ $info['kind'] ] ) ) $counts[ $info['kind'] ]++;
			if ( 'reject' === $info['action'] ) $refused[] = $info['kind'] . '/' . $info['reason'];
		}

		$check( "$kind: " . count( $statements ) . ' statements in ' . round( microtime( true ) - $started, 2 ) . ' s, none refused', '' === $reader->error() && 0 === $actions['reject'], implode( ', ', array_unique( $refused ) ) . ' ' . $reader->error() );
		$check( "$kind: as many CREATE TABLE as tables in the database ($tables), as many INSERT as the file has ($count)", $tables === $counts['create_table'] && $count === $counts['insert'], json_encode( $counts ) );
	}

	// the dump is the database: run it into a copy of it, table by table, and compare what is in it
	$copy_prefix = '_spt_' . substr( md5( uniqid() ), 0, 6 ) . '_';
	list( $statements ) = $read_all( $real );
	$run = 0; $failed = array(); $names = array();
	$wpdb->query( "SET sql_mode='NO_AUTO_VALUE_ON_ZERO'" );
	foreach ( $statements as $s ) {
		$info = $I::classify( $s['sql'] );
		if ( 'run' !== $info['action'] ) continue;
		$query = isset( $info['table'] ) ? $I::with_table( $s['sql'], $info, $copy_prefix . $info['table'] ) : $s['sql'];
		if ( 'create_table' === $info['kind'] ) $names[] = $info['table'];
		if ( false === $wpdb->query( $query ) ) { $failed[] = $info['kind'] . ' ' . ( $info['table'] ?? '' ) . ': ' . substr( $wpdb->last_error, 0, 80 ); break; }
		$run++;
	}
	$check( "the dump runs into the copy: $run statements, none failed", array() === $failed, implode( ' | ', $failed ) );

	$different = array();
	foreach ( $names as $name ) {
		$a = $wpdb->get_row( 'CHECKSUM TABLE `' . $name . '`', ARRAY_N ); $b = $wpdb->get_row( 'CHECKSUM TABLE `' . $copy_prefix . $name . '`', ARRAY_N );
		if ( $a[1] !== $b[1] ) $different[] = $name;
	}
	$check( 'and every table of the copy is the same as the table (checksum)', array() === $different && count( $names ) > 0, count( $names ) . ' tables; different: ' . implode( ', ', $different ) );

	foreach ( $names as $name )
		$wpdb->query( 'DROP TABLE IF EXISTS `' . $copy_prefix . $name . '`' );
	$left = $wpdb->get_col( $wpdb->prepare( 'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_NAME LIKE %s', DB_NAME, $wpdb->esc_like( $copy_prefix ) . '%' ) );
	$check( 'the copy is removed', array() === $left, implode( ', ', $left ) );
}

// -- clean up
$remove = function ( $p ) use ( &$remove ) { if ( is_file( $p ) ) { @unlink( $p ); return; } if ( is_dir( $p ) ) { foreach ( scandir( $p ) as $n ) if ( '.' !== $n && '..' !== $n ) $remove( $p . '/' . $n ); @rmdir( $p ); } };
$remove( $tmp );
$check( 'the test folder is gone', ! file_exists( $tmp ) );

printf( "\n%d ok, %d failed\n", $ok, $bad );
exit( $bad ? 1 : 0 );
