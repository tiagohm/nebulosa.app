import { join, relative } from 'path'
import { build } from 'bun'
import { author, description, version } from './package.json'
import bunTailwindPlugin from './tailwind.plugin'

// Repository root, passed to the build as the root of the embedded files; without it the root is the working
// directory of the build (app/), and the workers are embedded outside of it, under a path nothing finds.
const ROOT = join(import.meta.dir, '..')

// Image, image processing, star detection, star profile, streak detection, DARV analysis, Flat Wizard measurement, guide frame, mount pointing fit, and solar eclipse map workers, bundled as extra entry points so
// the executable embeds them transpiled with their imports. Inside the executable a worker is only found by its
// path relative to the embedded root, never through `new URL(..., import.meta.url)`, which points at the
// executable itself.
const IMAGE_WORKER = join(ROOT, 'api/src/images.worker.ts')
const IMAGE_PROCESSING_WORKER = join(ROOT, 'api/src/imageprocessing.worker.ts')
const STAR_WORKER = join(ROOT, 'api/src/stars.worker.ts')
const STAR_PROFILE_WORKER = join(ROOT, 'api/src/starprofile.worker.ts')
const STREAK_WORKER = join(ROOT, 'api/src/streaks.worker.ts')
const DARV_WORKER = join(ROOT, 'api/src/darv.worker.ts')
const FLATWIZARD_WORKER = join(ROOT, 'api/src/flatwizard.worker.ts')
const MOUNTPOINTING_WORKER = join(ROOT, 'api/src/mountpointing.worker.ts')
const GUIDING_WORKER = join(ROOT, 'api/src/guiding.worker.ts')
const SOLARECLIPSE_WORKER = join(ROOT, 'api/src/solareclipses.worker.ts')

// Path of a worker relative to the embedded root, as the executable finds it, as a define value.
function embeddedPath(path: string) {
	return JSON.stringify(`./${relative(ROOT, path).replaceAll('\\', '/')}`)
}

// Commit checked out in the Git work tree at dir, or undefined when it cannot be read (no Git, a source archive,
// an uninitialized submodule), so missing provenance never fails the build.
function gitHead(dir: string) {
	try {
		const result = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: dir, stdout: 'pipe', stderr: 'ignore' })
		const commit = result.stdout.toString().trim()
		return result.exitCode === 0 && commit ? commit : undefined
	} catch {
		return undefined
	}
}

// Define value of an optional string. An absent value is defined as undefined rather than left out, so the
// executable never reads a variable of the same name from its environment instead.
function defineString(value?: string) {
	return value === undefined ? 'undefined' : JSON.stringify(value)
}

await build({
	entrypoints: [join(import.meta.dir, 'src/main.ts'), IMAGE_WORKER, IMAGE_PROCESSING_WORKER, STAR_WORKER, STAR_PROFILE_WORKER, STREAK_WORKER, DARV_WORKER, FLATWIZARD_WORKER, GUIDING_WORKER, MOUNTPOINTING_WORKER, SOLARECLIPSE_WORKER],
	root: ROOT,
	// Syntax minification stays off: together with the React Compiler it drops the constants it inlines into the
	// template literals of components and hooks, so `${MARGIN} ${width}` becomes `${width}` in the executable only.
	minify: { whitespace: true, identifiers: true, syntax: false },
	sourcemap: false,
	target: 'bun',
	env: 'APP_*',
	define: {
		'process.env.NODE_ENV': '"production"',
		'process.env.NEBULOSA_IMAGE_WORKER': embeddedPath(IMAGE_WORKER),
		'process.env.NEBULOSA_IMAGE_PROCESSING_WORKER': embeddedPath(IMAGE_PROCESSING_WORKER),
		'process.env.NEBULOSA_STAR_WORKER': embeddedPath(STAR_WORKER),
		'process.env.NEBULOSA_STAR_PROFILE_WORKER': embeddedPath(STAR_PROFILE_WORKER),
		'process.env.NEBULOSA_STREAK_WORKER': embeddedPath(STREAK_WORKER),
		'process.env.NEBULOSA_DARV_WORKER': embeddedPath(DARV_WORKER),
		'process.env.NEBULOSA_FLATWIZARD_WORKER': embeddedPath(FLATWIZARD_WORKER),
		'process.env.NEBULOSA_GUIDING_WORKER': embeddedPath(GUIDING_WORKER),
		'process.env.NEBULOSA_MOUNTPOINTING_WORKER': embeddedPath(MOUNTPOINTING_WORKER),
		'process.env.NEBULOSA_SOLARECLIPSE_WORKER': embeddedPath(SOLARECLIPSE_WORKER),
		// Provenance shown by the About page, recorded once when compiling.
		'process.env.NEBULOSA_BUILD_COMMIT': defineString(gitHead(ROOT)),
		'process.env.NEBULOSA_CORE_COMMIT': defineString(gitHead(join(ROOT, 'core'))),
		'process.env.NEBULOSA_BUILT_AT': JSON.stringify(new Date().toISOString()),
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
