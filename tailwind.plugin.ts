import { compile, optimize } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import type { BunPlugin } from 'bun'
import { dirname } from 'path'

// Source: https://github.com/oven-sh/bun/issues/12878#issuecomment-4280279428

// Fast skip for CSS files that don't use Tailwind. Anything containing one of
// these directives goes through the Tailwind compiler; everything else is
// returned untouched so Bun's native CSS loader handles it.
const TAILWIND_DIRECTIVE = /@import\s+["']tailwindcss["']|@theme|@apply|@tailwind\b/

// Bun plugin that replaces `bun-plugin-tailwind` with a direct binding to the
// official Tailwind v4 node packages. Because this plugin uses the
// `tailwindcss` package from the project's own dependencies (not a bundled
// copy), new utilities ship the same day Tailwind releases them.
export function bunTailwindPlugin(): BunPlugin {
	const minify = process.env.NODE_ENV === 'production'

	return {
		name: 'bun-tailwind-plugin',
		setup(build) {
			build.onLoad({ filter: /\.css$/ }, async ({ path: filePath }) => {
				const source = await Bun.file(filePath).text()

				if (!TAILWIND_DIRECTIVE.test(source)) return

				const compiler = await compile(source, {
					from: filePath,
					base: dirname(filePath),
					shouldRewriteUrls: true,
					onDependency: () => {},
				})

				// Mirrors @tailwindcss/vite: the scanner needs both the compiler's
				// auto-detection root and any explicit `@source` directives. Passing
				// only `compiler.sources` yields an empty set, so generated CSS would
				// drop every utility that isn't in a @source file.
				const rootSources = (() => {
					if (compiler.root === 'none') return []
					if (compiler.root === null) return [{ base: process.cwd(), pattern: '**/*', negated: false }]
					return [{ ...compiler.root, negated: false }]
				})()

				const sources = rootSources.concat(compiler.sources)
				const candidates = new Scanner({ sources }).scan()
				let css = compiler.build(candidates)
				if (minify) css = optimize(css, { minify: true }).code
				return { contents: css, loader: 'css' }
			})
		},
	}
}

export default bunTailwindPlugin()
