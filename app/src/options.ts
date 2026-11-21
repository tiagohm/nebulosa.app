import { resolve } from 'path'
import { parseArgs } from 'util'

// Options of the application, from the command line and the environment, parsed in one place: --host and --port (also
// --host=<value>) win over APP_HOST and APP_PORT, which win over HOST and PORT, which win over localhost and 7000, and --home,
// resolved against the working directory, names the data directory over NEBULOSA_HOME (which api reads itself, once,
// when it loads, so the entry point main.ts applies --home to the environment before importing the server).
// A port that is not a positive number falls back to the next source, and an empty value names nothing.
// Other arguments are ignored, so a runner that adds its own never stops the server.

// Host listened on when nothing names one.
export const DEFAULT_HOST = 'localhost'

// TCP port listened on when nothing names one.
export const DEFAULT_PORT = 7000

// Options the application runs with.
export interface AppOptions {
	// Host name or IP address the server listens on.
	readonly host: string
	// TCP port the server listens on, from 1.
	readonly port: number
	// Absolute data directory --home names; absent when the command line names none.
	readonly home?: string
}

function parseText(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parsePort(value: unknown) {
	const number = Number(parseText(value))
	return Number.isInteger(number) && number > 0 ? number : undefined
}

// Returns the options named by args (the command line after the executable and script) and env, a relative --home being
// resolved against the working directory cwd.
export function appOptions(args: readonly string[], env: Readonly<Record<string, string | undefined>>, cwd: string): AppOptions {
	const { values } = parseArgs({ args: [...args], options: { host: { type: 'string' }, port: { type: 'string' }, home: { type: 'string' } }, strict: false, allowPositionals: true })
	const host = parseText(values.host) ?? parseText(env.APP_HOST) ?? parseText(env.HOST) ?? DEFAULT_HOST
	const port = parsePort(values.port) ?? parsePort(env.APP_PORT) ?? parsePort(env.PORT) ?? DEFAULT_PORT
	const home = parseText(values.home)
	return { host, port, home: home && resolve(cwd, home) }
}
