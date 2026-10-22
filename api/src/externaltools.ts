import { constants } from 'fs'
import { access, readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { isAbsolute, join, resolve } from 'path'
import { errorCode, isRecord, writeAtomically } from './util'

// Server-side settings of the external programs the backend runs, such as ASTAP. Each supported program
// is registered here with the capabilities its adapters provide; nothing else can be configured, and no
// route runs an arbitrary command. Settings belong to the server instance (not to a browser, profile, or
// workspace), are persisted in a versioned JSON file of the server, and are applied to the next runs
// without a restart. A test checks the executable on the server's filesystem only: it never starts the
// program, so it proves neither that the program runs nor that it analyzes images correctly. Any client
// that can reach the API can change and test these settings, like every other route.

// Identifier of a supported external program; also its key in the settings file and its route segment.
export type ExternalToolId = 'astap'

// Capability an adapter of an external program provides to the services that use it.
export type ExternalToolCapability = 'plate-solving' | 'star-detection'

// Valid range of a timeout, in milliseconds.
export interface TimeoutLimits {
	// Shortest timeout, in milliseconds.
	readonly min: number
	// Longest timeout, in milliseconds.
	readonly max: number
}

// Supported external program.
export interface ExternalToolDefinition {
	// Identifier of the program.
	readonly id: ExternalToolId
	// Name shown to people.
	readonly name: string
	// What the program is used for.
	readonly description: string
	// Capabilities the program's adapters provide.
	readonly capabilities: readonly ExternalToolCapability[]
	// Valid range of the default timeout of a run.
	readonly timeoutLimits: TimeoutLimits
}

// Settings of an external program.
export interface ExternalToolConfig {
	// Path of the executable on the server's filesystem, or a name looked up on the server's PATH; empty when not configured.
	readonly executable: string
	// Default time limit of a run, in milliseconds, within the program's timeoutLimits.
	readonly timeout: number
}

// State of the saved settings: none saved, saved, or unusable because the settings file cannot be read.
export type ExternalToolConfigStatus = 'notConfigured' | 'configured' | 'invalid'

// Outcome of a check: the executable can be run, is not where the settings point, or cannot be run.
export type ExternalToolCheckStatus = 'available' | 'unavailable' | 'failed'

// Reason of a check outcome:
// - ok: the path is a file the server process may execute.
// - empty: no path is set.
// - missing: nothing exists at the path, or the name is not on the server's PATH.
// - notFile: the path is a directory or another non-regular file.
// - notExecutable: the file cannot be executed by the server process (never reported on Windows, where
//   any existing file passes).
// - inaccessible: the path cannot be inspected, such as a directory the server may not read.
export type ExternalToolCheckCode = 'ok' | 'empty' | 'missing' | 'notFile' | 'notExecutable' | 'inaccessible'

// Result of checking the executable of a configuration on the server's filesystem.
export interface ExternalToolCheck {
	// Outcome of the check.
	readonly status: ExternalToolCheckStatus
	// Reason of the outcome.
	readonly code: ExternalToolCheckCode
	// Configuration checked, so a client can tell whether the result still applies to what it edits.
	readonly config: ExternalToolConfig
	// Absolute path the executable resolved to; absent when it was not found.
	readonly resolvedPath?: string
	// Version of the program; never detected, since a check does not run the program.
	readonly version?: string
	// When the check ended, in milliseconds since the Unix epoch.
	readonly checkedAt: number
	// Time the check took, in milliseconds.
	readonly duration: number
	// Summary meant for people.
	readonly message: string
}

// Settings and status of a supported external program, as reported to clients.
export interface ExternalToolState extends ExternalToolDefinition {
	// State of the saved settings.
	readonly status: ExternalToolConfigStatus
	// Saved settings; the defaults when none are saved.
	readonly config: ExternalToolConfig
	// Revision of the saved settings, increased by every save; 0 when never saved.
	readonly revision: number
	// Latest check of the saved settings since the server started; absent when not tested.
	readonly lastCheck?: ExternalToolCheck
	// Why the settings file cannot be used, when status is invalid.
	readonly error?: string
}

// Body of a request saving the settings of an external program.
export interface ExternalToolSaveRequest {
	// New settings.
	readonly config: ExternalToolConfig
	// Revision the settings were edited from; the save is refused when another one was saved since.
	readonly revision: number
}

// Body of a request checking settings without saving them.
export interface ExternalToolTestRequest {
	// Settings to check, usually the unsaved edits of a client.
	readonly config: ExternalToolConfig
}

// Notification published when the settings or the latest check of an external program change.
export interface ExternalToolEvent {
	readonly type: 'externalTool:updated'
	// New state of the program.
	readonly tool: ExternalToolState
}

// Receiver of external program events.
export type ExternalToolListener = (event: ExternalToolEvent) => void

// Outcome of a save: saved, refused because another revision was saved since, or refused because the
// settings file was written by a newer version, which is never overwritten.
export type ExternalToolSaveOutcome = { readonly status: 'saved'; readonly tool: ExternalToolState } | { readonly status: 'conflict'; readonly tool: ExternalToolState } | { readonly status: 'newerVersion' }

// Default time limit of a run, in milliseconds: 5 minutes, as ASTAP's adapters use when given none.
export const DEFAULT_EXTERNAL_TOOL_TIMEOUT = 300000

// Supported external programs, in display order.
export const EXTERNAL_TOOLS: readonly ExternalToolDefinition[] = [
	{
		id: 'astap',
		name: 'ASTAP',
		description: 'Astronomical software used by supported plate-solving and star-detection providers.',
		capabilities: ['plate-solving', 'star-detection'],
		timeoutLimits: { min: 1000, max: 3600000 },
	},
]

// File the settings are persisted in when none is given.
export const DEFAULT_SETTINGS_FILE = join(homedir(), 'Nebulosa', 'settings.json')

// Version of the settings file format written by this version.
const SETTINGS_VERSION = 1

// Saved settings of a program, as kept in memory and in the settings file.
interface StoredTool extends ExternalToolConfig {
	// Revision of the settings, increased by every save.
	readonly revision: number
}

// Settings read from the settings file.
interface LoadedSettings {
	// Settings of every supported program; the defaults for those not in the file.
	readonly tools: ReadonlyMap<ExternalToolId, StoredTool>
	// Why the file cannot be used; absent when it was read or does not exist.
	readonly error?: string
	// Whether the file was written by a newer version, so it must not be overwritten.
	readonly newer?: boolean
}

// Whether value names a supported external program.
export function isExternalToolId(value: string): value is ExternalToolId {
	return EXTERNAL_TOOLS.some((tool) => tool.id === value)
}

// Returns the definition of a supported external program.
function definition(id: ExternalToolId): ExternalToolDefinition {
	return EXTERNAL_TOOLS.find((tool) => tool.id === id)!
}

// Whether two configurations are the same.
function sameConfig(a: ExternalToolConfig, b: ExternalToolConfig) {
	return a.executable === b.executable && a.timeout === b.timeout
}

// Returns the settings of every supported program before anything is saved.
function defaultTools(): Map<ExternalToolId, StoredTool> {
	return new Map(EXTERNAL_TOOLS.map((tool) => [tool.id, { executable: '', timeout: DEFAULT_EXTERNAL_TOOL_TIMEOUT, revision: 0 }]))
}

// Reads the stored settings of a program from the settings file, whose content is not trusted: a path
// that is not a string becomes empty, a timeout that is not an integer within the program's limits
// becomes the default, and a revision that is not a non-negative integer becomes 0.
function normalizeTool(id: ExternalToolId, value: unknown): StoredTool {
	const { timeoutLimits } = definition(id)
	const entry = isRecord(value) ? value : {}
	const { executable, timeout, revision } = entry
	return {
		executable: typeof executable === 'string' ? executable : '',
		timeout: Number.isInteger(timeout) && (timeout as number) >= timeoutLimits.min && (timeout as number) <= timeoutLimits.max ? (timeout as number) : DEFAULT_EXTERNAL_TOOL_TIMEOUT,
		revision: Number.isInteger(revision) && (revision as number) >= 0 ? (revision as number) : 0,
	}
}

// Parses the content of the settings file. Content that is not a settings document is reported as an
// error; a document of a newer version is read as far as it is understood and marked as newer.
export function parseSettings(text: string): LoadedSettings {
	let data: unknown

	try {
		data = JSON.parse(text)
	} catch {
		return { tools: defaultTools(), error: 'The settings file is not valid JSON' }
	}

	if (!isRecord(data) || !isRecord(data.tools) || !Number.isInteger(data.version)) return { tools: defaultTools(), error: 'The settings file is not a Nebulosa settings document' }

	const tools = new Map(EXTERNAL_TOOLS.map((tool) => [tool.id, normalizeTool(tool.id, (data.tools as Record<string, unknown>)[tool.id])]))
	if ((data.version as number) > SETTINGS_VERSION) return { tools, error: 'The settings file was written by a newer version of Nebulosa', newer: true }
	return { tools }
}

// Returns the content of the settings file for the settings of every program.
function serializeSettings(tools: ReadonlyMap<ExternalToolId, StoredTool>) {
	return `${JSON.stringify({ version: SETTINGS_VERSION, tools: Object.fromEntries(tools) }, undefined, '\t')}\n`
}

// Outcome of inspecting an executable, before timing is added.
type Inspection = Pick<ExternalToolCheck, 'status' | 'code' | 'resolvedPath' | 'message'>

// Inspects an executable on the server's filesystem without running it. A bare name (no directory
// separator) is looked up on the server's PATH; any other relative path is resolved against the
// server's working directory. The path is never interpreted by a shell.
export async function inspectExecutable(executable: string): Promise<Inspection> {
	if (!executable.trim()) return { status: 'failed', code: 'empty', message: 'No executable path is set.' }

	let path: string

	if (!isAbsolute(executable) && !/[\\/]/.test(executable)) {
		const found = Bun.which(executable)
		if (!found) return { status: 'unavailable', code: 'missing', message: `${executable} was not found on the PATH of the server.` }
		path = found
	} else {
		path = resolve(executable)
	}

	try {
		if (!(await stat(path)).isFile()) return { status: 'failed', code: 'notFile', resolvedPath: path, message: 'The path is not a file.' }
	} catch (error) {
		const code = errorCode(error)
		if (code === 'ENOENT' || code === 'ENOTDIR') return { status: 'unavailable', code: 'missing', message: 'No file exists at this path on the server.' }
		return { status: 'failed', code: 'inaccessible', resolvedPath: path, message: 'The path cannot be inspected by the server.' }
	}

	try {
		await access(path, constants.X_OK)
	} catch {
		return { status: 'failed', code: 'notExecutable', resolvedPath: path, message: 'The file cannot be executed by the server.' }
	}

	return { status: 'available', code: 'ok', resolvedPath: path, message: 'The executable was found and the server may run it. The program itself was not started.' }
}

// Settings of the supported external programs, persisted in a JSON file of the server. The file is read
// on first use, so creating the store has no side effect. Saves are applied one at a time; a save made
// from an outdated revision is refused, so concurrent clients never overwrite each other silently. The
// latest check of each program's saved settings is kept in memory only. Every change is published to the
// listener.
export class ExternalToolsStore {
	// Settings read from the file, once the first read started.
	#loaded?: Promise<LoadedSettings>
	// Latest check of the saved settings of each program.
	readonly #checks = new Map<ExternalToolId, ExternalToolCheck>()
	// Tail of the saves in progress, which run one at a time.
	#queue: Promise<unknown> = Promise.resolve()

	// Creates the store of the settings file at file, publishing changes to listener.
	constructor(
		readonly file: string = DEFAULT_SETTINGS_FILE,
		readonly listener?: ExternalToolListener,
	) {}

	// Returns the settings read from the file, reading it on the first call. A missing file gives the defaults.
	#load(): Promise<LoadedSettings> {
		return (this.#loaded ??= readFile(this.file, 'utf-8').then(parseSettings, (error: unknown) => {
			const code = errorCode(error)
			return code === 'ENOTDIR' || code === 'ENOENT' ? { tools: defaultTools() } : { tools: defaultTools(), error: 'The settings file cannot be read' }
		}))
	}

	// Returns the state of a program from loaded settings.
	#state(id: ExternalToolId, { tools, error }: LoadedSettings): ExternalToolState {
		const { executable, timeout, revision } = tools.get(id)!
		const lastCheck = this.#checks.get(id)
		const status = error ? 'invalid' : executable ? 'configured' : 'notConfigured'
		return { ...definition(id), status, config: { executable, timeout }, revision, ...(lastCheck && { lastCheck }), ...(error && { error }) }
	}

	// Publishes the state of a program.
	#publish(id: ExternalToolId, settings: LoadedSettings) {
		const tool = this.#state(id, settings)
		this.listener?.({ type: 'externalTool:updated', tool })
		return tool
	}

	// Returns the state of every supported program, in display order.
	async list(): Promise<ExternalToolState[]> {
		const settings = await this.#load()
		return EXTERNAL_TOOLS.map((tool) => this.#state(tool.id, settings))
	}

	// Returns the state of a program.
	async get(id: ExternalToolId): Promise<ExternalToolState> {
		return this.#state(id, await this.#load())
	}

	// Saves the settings of a program edited from revision, replacing an unreadable settings file. A check
	// of other settings stops being the program's latest one. Throws when the file cannot be written; the
	// saved settings are then unchanged.
	save(id: ExternalToolId, config: ExternalToolConfig, revision: number): Promise<ExternalToolSaveOutcome> {
		const run = this.#queue.then(async (): Promise<ExternalToolSaveOutcome> => {
			const settings = await this.#load()
			if (settings.newer) return { status: 'newerVersion' }

			const current = settings.tools.get(id)!
			if (revision !== current.revision) return { status: 'conflict', tool: this.#state(id, settings) }

			const tools = new Map(settings.tools).set(id, { executable: config.executable, timeout: config.timeout, revision: current.revision + 1 })
			await writeAtomically(this.file, serializeSettings(tools))

			const saved: LoadedSettings = { tools }
			this.#loaded = Promise.resolve(saved)
			const check = this.#checks.get(id)
			if (check && !sameConfig(check.config, config)) this.#checks.delete(id)
			return { status: 'saved', tool: this.#publish(id, saved) }
		})

		this.#queue = run.catch(() => undefined)
		return run
	}

	// Checks settings of a program on the server's filesystem without saving them. When they are the
	// program's saved settings at the end of the check, the result becomes its latest check.
	async check(id: ExternalToolId, config: ExternalToolConfig): Promise<ExternalToolCheck> {
		const start = performance.now()
		const inspection = await inspectExecutable(config.executable)
		const check: ExternalToolCheck = { ...inspection, config: { executable: config.executable, timeout: config.timeout }, checkedAt: Date.now(), duration: performance.now() - start }

		const settings = await this.#load()

		if (!settings.error && sameConfig(settings.tools.get(id)!, config)) {
			this.#checks.set(id, check)
			this.#publish(id, settings)
		}

		return check
	}

	// Returns the settings a run of a program uses, or undefined when the program is not configured or
	// the settings file cannot be used. A service resolves them once when an operation starts and keeps
	// the returned snapshot for the whole operation, so a later save applies to the next operations only.
	async resolve(id: ExternalToolId): Promise<Readonly<ExternalToolConfig> | undefined> {
		const { tools, error } = await this.#load()
		const { executable, timeout } = tools.get(id)!
		return error || !executable ? undefined : Object.freeze({ executable, timeout })
	}
}

// Responds 404 for an unknown external program.
function toolNotFound() {
	return Response.json({ error: 'External tool not found' }, { status: 404 })
}

// Creates the routes of the external program settings under /api/settings/external-tools.
export function createExternalToolsRoutes(store: ExternalToolsStore) {
	return {
		'/api/settings/external-tools': {
			// State of every supported program; never runs any of them.
			GET: async () => Response.json(await store.list()),
		},
		'/api/settings/external-tools/:id': {
			// State of a program; 404 when it is not supported.
			GET: async (req) => (isExternalToolId(req.params.id) ? Response.json(await store.get(req.params.id)) : toolNotFound()),
			// Saves the settings of a program (ExternalToolSaveRequest) and responds with its new state. 409
			// with the current state when another revision was saved since, 409 when the settings file was
			// written by a newer version, and 500 when the file cannot be written.
			PUT: async (req) => {
				const { id } = req.params
				if (!isExternalToolId(id)) return toolNotFound()
				const { config, revision } = (await req.json()) as ExternalToolSaveRequest

				try {
					const outcome = await store.save(id, config, revision)
					if (outcome.status === 'conflict') return Response.json({ error: 'The settings were changed by another client', code: 'conflict', tool: outcome.tool }, { status: 409 })
					if (outcome.status === 'newerVersion') return Response.json({ error: 'The settings file was written by a newer version of Nebulosa', code: 'newerVersion' }, { status: 409 })
					return Response.json(outcome.tool)
				} catch (error) {
					return Response.json({ error: `Unable to write the settings: ${Error.isError(error) ? error.message : String(error)}` }, { status: 500 })
				}
			},
		},
		'/api/settings/external-tools/:id/test': {
			// Checks settings (ExternalToolTestRequest) on the server's filesystem without saving them; never runs the program.
			POST: async (req) => {
				const { id } = req.params
				if (!isExternalToolId(id)) return toolNotFound()
				const { config } = (await req.json()) as ExternalToolTestRequest
				return Response.json(await store.check(id, config))
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
