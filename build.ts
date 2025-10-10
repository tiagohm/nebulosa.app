import { build } from 'bun'

await build({
	entrypoints: ['./main.ts'],
	minify: true,
	target: 'bun',
	compile: {
		outfile: 'nebulosa.exe',
	},
})
