declare module 'bun' {
	interface Env {
		homeDir: string
		tmpDir: string
		appDir: string
		capturesDir: string
		framingDir: string
		satellitesDir: string
		host?: string
		port?: `${number}`
		cert?: string
		key?: string
		secure?: 'true'
		open?: 'true'
		username?: string
		password?: string
	}
}

declare module '*.svg' {
	const path: `${string}.svg`
	export = path
}

declare module '*.png' {
	const path: `${string}.png`
	export = path
}

declare module '*.webp' {
	const path: `${string}.webp`
	export = path
}

declare module '*.ico' {
	const path: `${string}.ico`
	export = path
}

declare module '*.shared' {
	const path: `${string}.shared`
	export = path
}

declare module '*.sqlite' {
	const db: import('bun:sqlite').Database
	export = db
}

declare module '*.module.css' {
	const classes: { readonly [key: string]: string }
	export = classes
}

declare module '*.csv' {
	const text: string
	export = text
}
