declare module '*.svg' {
	const path: `${string}.svg`
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
