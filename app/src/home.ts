import { resolve } from 'path'
import { parseArgs } from 'util'

// Data directory named on the command line: --home (also --home=<value>), resolved against the working directory, wins
// over NEBULOSA_HOME, which wins over ~/Nebulosa (DEFAULT_DATA_DIRECTORY of api). The api reads NEBULOSA_HOME once, when
// it loads, so the entry point (main.ts) applies --home to the environment before importing it. An empty value names
// nothing, and other arguments are ignored.

// Returns the absolute data directory --home names in args (the command line after the executable and script), relative
// to the working directory cwd; undefined when args name none.
export function homeArgument(args: readonly string[], cwd: string): string | undefined {
	const { values } = parseArgs({ args: [...args], options: { home: { type: 'string' } }, strict: false, allowPositionals: true })
	const home = typeof values.home === 'string' ? values.home.trim() : ''
	return home ? resolve(cwd, home) : undefined
}
