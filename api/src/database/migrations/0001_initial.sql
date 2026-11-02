-- Baseline schema of the operational database of Nebulosa.
--
-- While the application is in development this file is edited in place: a database whose baseline checksum differs is
-- deleted and created again. Tables are STRICT; times are Unix milliseconds (UTC); every column states its unit.

-- Migrations applied to the database, one row per version.
CREATE TABLE schema_migrations (
	-- Position of the migration in the history, from 1.
	version INTEGER PRIMARY KEY,
	-- SHA-256 of its statements, in lowercase hexadecimal.
	checksum TEXT NOT NULL,
	-- When it was applied, Unix milliseconds (UTC).
	applied_at INTEGER NOT NULL
) STRICT;
