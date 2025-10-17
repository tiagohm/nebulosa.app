import { build } from 'bun'
import { version } from 'package.json'

await build({
	entrypoints: ['./main.ts'],
	minify: true,
	target: 'bun',
	compile: {
		outfile: process.platform === 'win32' ? 'nebulosa.exe' : 'nebulosa.out',
		windows: {
			title: 'Nebulosa',
			description: 'The complete integrated solution for all of your astronomical imaging needs.',
			publisher: 'Tiago Melo',
			icon: 'src/web/assets/nebulosa.ico',
			copyright: '© 2025 Tiago Melo',
			hideConsole: false,
			version,
		},
	},
})
