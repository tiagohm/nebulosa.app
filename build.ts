import tailwind from 'bun-plugin-tailwind'

await Bun.build({
	plugins: [tailwind],
	entrypoints: ['./main.ts'],
	minify: true,
	target: 'bun',
	compile: {
		outfile: 'nebulosa.exe',
	},
})
