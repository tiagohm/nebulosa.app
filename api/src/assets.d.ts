// Module declarations of the data files the API imports.

// SQLite database imported with `{ type: 'sqlite' }` (and `embed: 'true'` to embed it in the executable).
declare module '*.db' {
	// Open database.
	const db: import('bun:sqlite').Database
	export default db
}

// SQL statements imported with `{ type: 'text' }`, embedded in the executable.
declare module '*.sql' {
	// Text of the file.
	const text: string
	export default text
}

// Gzipped JSON imported with `{ type: 'file' }`: its path, embedded in the executable.
declare module '*.json.gz' {
	// Path of the file, readable with Bun.file.
	const path: string
	export default path
}
