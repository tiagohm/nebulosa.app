// Identity of the running distribution for the About page: the version and build provenance the app records, and
// the runtime of the server. The app composing the server supplies it, so this module never reads app/ itself.

// Identity of the running distribution. Optional fields are absent when the build did not record them, such as in
// development; they are never filled with guesses.
export interface AboutInfo {
	// Version of the application, from app/package.json.
	readonly version: string
	// Description of the application, from app/package.json.
	readonly description: string
	// Git commit of the application the executable was compiled from; absent outside compiled builds.
	readonly commit?: string
	// Git commit of the nebulosa.ts toolkit submodule the executable was compiled with; absent outside compiled builds.
	readonly coreCommit?: string
	// ISO-8601 UTC time the executable was compiled; absent outside compiled builds.
	readonly builtAt?: string
	// Runtime of the server, such as "Bun 1.4.0".
	readonly runtime: string
	// Operating system and architecture of the server, such as "linux/x64"; never the browser's.
	readonly platform: string
}

// Returns the route serving the identity of the running distribution, stable for the life of the process.
export function createAboutRoutes(info: AboutInfo) {
	return {
		'/api/about': {
			GET: () => Response.json(info),
		},
	}
}
