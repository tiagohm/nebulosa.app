// Static asset imports bundled by Bun's file loader, which resolve to the hashed asset URL.

// Icon file imported from a module; the default export is its URL.
declare module '*.ico' {
	// URL of the bundled icon.
	const url: string
	export default url
}
