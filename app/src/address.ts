import { parseArgs } from 'util'

// Address the server listens on, from the command line and the environment: --host and --port (also --host=<value>)
// win over APP_HOST and APP_PORT, which win over localhost and 7000. A port that is not a positive number falls back to
// the next source. Other arguments are ignored, so a runner that adds its own never stops the server.

// Host listened on when nothing names one.
export const DEFAULT_HOST = 'localhost'

// TCP port listened on when nothing names one.
export const DEFAULT_PORT = 7000

// Host and TCP port the server listens on.
export interface ServerAddress {
	// Host name or IP address.
	readonly host: string
	// TCP port, from 1.
	readonly port: number
}

// Returns the address named by args (the command line after the executable and script) and env.
export function serverAddress(args: readonly string[], env: Readonly<Record<string, string | undefined>>): ServerAddress {
	const { values } = parseArgs({ args: [...args], options: { host: { type: 'string' }, port: { type: 'string' } }, strict: false, allowPositionals: true })
	const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
	const port = (value: unknown) => {
		const number = Number(text(value))
		return Number.isInteger(number) && number > 0 ? number : undefined
	}

	return { host: text(values.host) ?? text(env.APP_HOST) ?? DEFAULT_HOST, port: port(values.port) ?? port(env.APP_PORT) ?? DEFAULT_PORT }
}
