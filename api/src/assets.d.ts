// Module declarations of the data files the API imports.

// Zstd-compressed file imported with `{ type: 'file' }`: its path, embedded in the executable.
declare module '*.zst' {
	// Path of the file, readable with Bun.file or fs.
	const path: string
	export default path
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
