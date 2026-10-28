// Static asset imports bundled by Bun's file loader, which resolve to the hashed asset URL.

// Icon file imported from a module; the default export is its URL.
declare module '*.ico' {
	// URL of the bundled icon.
	const url: string
	export default url
}

// SVG file imported from a module; the default export is its URL.
declare module '*.svg' {
	// URL of the bundled SVG.
	const url: string
	export default url
}

// JPEG image imported from a module; the default export is its URL.
declare module '*.jpg' {
	// URL of the bundled image.
	const url: string
	export default url
}

// Gzipped data file imported from a module with `with { type: 'file' }`; the default export is its URL.
declare module '*.gz' {
	// URL of the bundled file.
	const url: string
	export default url
}
