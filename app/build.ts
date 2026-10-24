import { join, relative } from 'path'
import { build } from 'bun'
import { author, description, version } from './package.json'
import bunTailwindPlugin from './tailwind.plugin'

// Repository root, the common ancestor of every entry point and so the root of the embedded files.
const ROOT = join(import.meta.dir, '..')

// Image, star detection, and DARV analysis workers, bundled as extra entry points so the executable embeds them
// transpiled with their imports. Inside the executable a worker is only found by its path relative to the
// embedded root, never through `new URL(..., import.meta.url)`, which points at the executable itself.
const IMAGE_WORKER = join(ROOT, 'api/src/images.worker.ts')
const STAR_WORKER = join(ROOT, 'api/src/stars.worker.ts')
const DARV_WORKER = join(ROOT, 'api/src/darv.worker.ts')

// Path of a worker relative to the embedded root, as the executable finds it, as a define value.
function embeddedPath(path: string) {
	return JSON.stringify(`./${relative(ROOT, path).replaceAll('\\', '/')}`)
}

await build({
	entrypoints: [join(import.meta.dir, 'src/main.ts'), IMAGE_WORKER, STAR_WORKER, DARV_WORKER],
	minify: true,
	sourcemap: false,
	target: 'bun',
	env: 'APP_*',
	define: {
		'process.env.NODE_ENV': '"production"',
		'process.env.NEBULOSA_IMAGE_WORKER': embeddedPath(IMAGE_WORKER),
		'process.env.NEBULOSA_STAR_WORKER': embeddedPath(STAR_WORKER),
		'process.env.NEBULOSA_DARV_WORKER': embeddedPath(DARV_WORKER),
	},
	plugins: [bunTailwindPlugin],
	reactCompiler: true,
	reactCompilerOutputMode: 'client',
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
