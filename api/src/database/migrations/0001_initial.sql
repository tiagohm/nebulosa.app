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

-- Settings of the external programs and services of the server (ExternalToolsStore). A program without a row has
-- never been saved and runs with the defaults. The session of a web service is never stored.
CREATE TABLE external_tool_settings (
	-- Supported program.
	tool_id TEXT PRIMARY KEY CHECK (tool_id IN ('astap', 'astrometryLocal', 'nova')),
	-- Path or PATH name of the executable on the server; empty when not configured or not taken.
	executable TEXT NOT NULL,
	-- Default time limit of a run, in milliseconds.
	timeout INTEGER NOT NULL CHECK (timeout > 0),
	-- Path of the configuration file passed to the program; NULL when the program takes none.
	config TEXT,
	-- Base URL of a web service; NULL when the program is not one.
	endpoint TEXT,
	-- Revision of the settings, increased by every save, sign-in, and sign-out; >= 1.
	revision INTEGER NOT NULL CHECK (revision > 0),
	-- When the settings last changed, Unix milliseconds (UTC).
	updated_at INTEGER NOT NULL
) STRICT;

-- Backlash compensation of each physical focuser (FocuserBacklashStore), by its connection id and device id, both stable
-- across restarts and reconnects of the same endpoint. A focuser without a row has never been saved: compensation off.
CREATE TABLE focuser_backlash (
	-- Id of the connection of the focuser (the hash of its endpoint).
	connection_id TEXT NOT NULL,
	-- Id of the focuser on its connection.
	device_id TEXT NOT NULL,
	-- Whether the moves are compensated, 0 or 1.
	enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
	-- Compensation strategy.
	mode TEXT NOT NULL CHECK (mode IN ('ABSOLUTE', 'OVERSHOOT')),
	-- Backlash absorbed when reversing into the IN direction, in steps.
	backlash_in INTEGER NOT NULL CHECK (backlash_in >= 0),
	-- Backlash absorbed when reversing into the OUT direction, in steps.
	backlash_out INTEGER NOT NULL CHECK (backlash_out >= 0),
	-- Revision of the settings, increased by every save; >= 1.
	revision INTEGER NOT NULL CHECK (revision > 0),
	-- When the settings last changed, Unix milliseconds (UTC).
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (connection_id, device_id)
) STRICT;
