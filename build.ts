import { build } from 'bun'
import { author, description, version } from 'package.json'

await build({
	entrypoints: ['./main.ts'],
	minify: true,
	target: 'bun',
	compile: {
		outfile: process.platform === 'win32' ? 'nebulosa.exe' : 'nebulosa.out',
		autoloadBunfig: false,
		autoloadDotenv: true,
		windows: {
			title: 'Nebulosa',
			description,
			publisher: author.name,
			icon: 'src/web/assets/nebulosa.ico',
			copyright: '© 2025 Tiago Melo',
			hideConsole: false,
			version,
		},
	},
})
