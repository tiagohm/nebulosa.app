import { build } from 'bun'
import { author, description, version } from 'package.json'

await build({
	entrypoints: ['./main.ts'],
	minify: true,
	sourcemap: false,
	target: 'bun',
	env: 'APP_*',
	compile: {
		outfile: process.platform === 'win32' ? 'nebulosa.exe' : 'nebulosa.out',
		autoloadBunfig: false,
		autoloadDotenv: true,
		autoloadPackageJson: true,
		windows: {
			title: 'Nebulosa',
			description,
			publisher: author.name,
			icon: 'src/web/assets/nebulosa.ico', // Generated using GIMP (256x256, 32 bpp, 8-bit alpha, no palette, compressed PNG)
			copyright: `© ${new Date().getUTCFullYear()} ${author.name}`,
			hideConsole: false,
			version,
		},
	},
})
