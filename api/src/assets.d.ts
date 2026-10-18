// Module declarations of the data files the API imports.

// SQLite database imported with `{ type: 'sqlite' }` (and `embed: 'true'` to embed it in the executable).
declare module '*.db' {
	// Open database.
	const db: import('bun:sqlite').Database
	export default db
}
