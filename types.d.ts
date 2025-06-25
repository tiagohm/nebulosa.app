declare module 'bun' {
	interface Env {
		appDir: string
		framingDir: string
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

declare module '*.module.css' {
	const classes: { readonly [key: string]: string }
	export = classes
}
