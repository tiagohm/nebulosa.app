import { join, relative } from 'path'
import { build } from 'bun'
import { author, description, version } from './package.json'
import bunTailwindPlugin from './tailwind.plugin'

// Repository root, the common ancestor of every entry point and so the root of the embedded files.
const ROOT = join(import.meta.dir, '..')

// Image, image processing, star detection, streak detection, DARV analysis, Flat Wizard measurement, guide frame, and solar eclipse map workers, bundled as extra entry points so
// the executable embeds them transpiled with their imports. Inside the executable a worker is only found by its
// path relative to the embedded root, never through `new URL(..., import.meta.url)`, which points at the
// executable itself.
const IMAGE_WORKER = join(ROOT, 'api/src/images.worker.ts')
const IMAGE_PROCESSING_WORKER = join(ROOT, 'api/src/imageprocessing.worker.ts')
const STAR_WORKER = join(ROOT, 'api/src/stars.worker.ts')
const STREAK_WORKER = join(ROOT, 'api/src/streaks.worker.ts')
const DARV_WORKER = join(ROOT, 'api/src/darv.worker.ts')
const FLATWIZARD_WORKER = join(ROOT, 'api/src/flatwizard.worker.ts')
const GUIDING_WORKER = join(ROOT, 'api/src/guiding.worker.ts')
const SOLARECLIPSE_WORKER = join(ROOT, 'api/src/solareclipses.worker.ts')

// Path of a worker relative to the embedded root, as the executable finds it, as a define value.
function embeddedPath(path: string) {
	return JSON.stringify(`./${relative(ROOT, path).replaceAll('\\', '/')}`)
}

await build({
	entrypoints: [join(import.meta.dir, 'src/main.ts'), IMAGE_WORKER, IMAGE_PROCESSING_WORKER, STAR_WORKER, STREAK_WORKER, DARV_WORKER, FLATWIZARD_WORKER, GUIDING_WORKER, SOLARECLIPSE_WORKER],
	minify: true,
	sourcemap: false,
	target: 'bun',
	env: 'APP_*',
	define: {
		'process.env.NODE_ENV': '"production"',
		'process.env.NEBULOSA_IMAGE_WORKER': embeddedPath(IMAGE_WORKER),
		'process.env.NEBULOSA_IMAGE_PROCESSING_WORKER': embeddedPath(IMAGE_PROCESSING_WORKER),
		'process.env.NEBULOSA_STAR_WORKER': embeddedPath(STAR_WORKER),
		'process.env.NEBULOSA_STREAK_WORKER': embeddedPath(STREAK_WORKER),
		'process.env.NEBULOSA_DARV_WORKER': embeddedPath(DARV_WORKER),
		'process.env.NEBULOSA_FLATWIZARD_WORKER': embeddedPath(FLATWIZARD_WORKER),
		'process.env.NEBULOSA_GUIDING_WORKER': embeddedPath(GUIDING_WORKER),
		'process.env.NEBULOSA_SOLARECLIPSE_WORKER': embeddedPath(SOLARECLIPSE_WORKER),
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
