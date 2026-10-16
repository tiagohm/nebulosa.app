import { join } from 'path'
import { build } from 'bun'
import { author, description, version } from './package.json'
import bunTailwindPlugin from './tailwind.plugin'

const ROOT = join(import.meta.dir, '..')

await build({
	entrypoints: [join(import.meta.dir, 'src/main.ts')],
	minify: true,
	sourcemap: false,
	target: 'bun',
	env: 'APP_*',
	define: {
		'process.env.NODE_ENV': '"production"',
	},
	plugins: [bunTailwindPlugin],
	compile: {
		outfile: join(ROOT, '.dist', process.platform === 'win32' ? 'nebulosa.exe' : 'nebulosa'),
		autoloadBunfig: false,
		autoloadDotenv: true,
		windows: {
			title: 'Nebulosa',
			description,
			publisher: author.name,
			icon: join(ROOT, 'web/assets/nebulosa.ico'), // Generated using GIMP (256x256, 32 bpp, 8-bit alpha, no palette, compressed PNG)
			copyright: `© ${new Date().getUTCFullYear()} ${author.name}`,
			hideConsole: false,
			version,
		},
	},
})
