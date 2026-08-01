import { build } from 'bun'
import type { BunPlugin } from 'bun'
import { author, description, version } from './package.json'
import bunTailwindPlugin from './tailwind.plugin'

const IMAGE_PIPELINE_WORKER = './src/api/image.pipeline.worker.ts'

// The image pipeline worker is imported as a file so its path survives into the executable. A file
// embedded in the executable is handed to the worker verbatim, without being transpiled, so the
// TypeScript source would reach it as JavaScript and fail on the first `import type`. Bundling it up
// front and embedding the result sidesteps that, and also collapses the imports of the worker, which
// the executable could not resolve either.
const worker = build({ entrypoints: [IMAGE_PIPELINE_WORKER], minify: true, sourcemap: false, target: 'bun' })

// Replaces the contents of the embedded worker file with the bundle built above. Nothing imports the
// worker as a module, so the filter cannot match anything else.
const imagePipelineWorkerPlugin: BunPlugin = {
	name: 'image-pipeline-worker',
	async setup(build) {
		const contents = await (await worker).outputs[0].text()
		build.onLoad({ filter: /image\.pipeline\.worker\.ts$/ }, () => ({ contents, loader: 'file' }))
	},
}

await build({
	entrypoints: ['./main.ts'],
	minify: true,
	sourcemap: false,
	target: 'bun',
	env: 'APP_*',
	plugins: [bunTailwindPlugin, imagePipelineWorkerPlugin],
	compile: {
		outfile: process.platform === 'win32' ? 'nebulosa.exe' : 'nebulosa.out',
		autoloadBunfig: false,
		autoloadDotenv: true,
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
