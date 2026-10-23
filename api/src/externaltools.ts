import { constants } from 'fs'
import { access, readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { isAbsolute, join, resolve } from 'path'
import { login, NOVA_ASTROMETRY_NET_URL } from 'nebulosa/src/astrometry/solvers/astrometrynet'
import { errorCode, isRecord, writeAtomically } from './util'

// Server-side settings of the external programs and services the backend uses: ASTAP, the local solve-field
// of astrometry.net, and the nova.astrometry.net web service. Each one is registered here with the capabilities
// its adapters provide and the settings it takes; nothing else can be configured, and no route runs an
// arbitrary command. Settings belong to the server instance (not to a browser, profile, or workspace), are
// persisted in a versioned JSON file of the server, and are applied to the next runs without a restart. A test
// checks the executable (and the configuration file) on the server's filesystem only: it never starts the
// program, so it proves neither that the program runs nor that it analyzes images correctly. A web service is
// signed in to with its API key, which is sent once to the service and never stored: only the session the
// service returns is saved, reused by the runs, and removed by signing out; clients only learn whether a
// session is saved. Any client that can reach the API can change and test these settings, like every other route.

// Identifier of a supported external program; also its key in the settings file and its route segment.
export type ExternalToolId = 'astap' | 'astrometryLocal' | 'nova'

// Capability an adapter of an external program provides to the services that use it.
export type ExternalToolCapability = 'plate-solving' | 'star-detection'

// Setting a program takes besides its timeout: its executable, the configuration file passed to it, or the
// endpoint of a web service.
export type ExternalToolField = 'executable' | 'config' | 'endpoint'

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
	// Settings it takes besides the timeout, in display order.
	readonly fields: readonly ExternalToolField[]
	// Whether it is a web service signed in to with an API key (see ExternalToolsStore.login).
	readonly session: boolean
	// Valid range of the default timeout of a run.
	readonly timeoutLimits: TimeoutLimits
}

// Settings of an external program. A field the program does not take (see its fields) is absent.
export interface ExternalToolConfig {
	// Path of the executable on the server's filesystem, or a name looked up on the server's PATH; empty when not
	// configured or not taken.
	readonly executable: string
	// Default time limit of a run, in milliseconds, within the program's timeoutLimits.
	readonly timeout: number
	// Path of a configuration file on the server's filesystem passed to the program; empty for its default one.
	readonly config?: string
	// Base URL of a web service; its public endpoint when empty.
	readonly endpoint?: string
}

// Settings a run uses: the saved settings plus the session of a web service.
export interface ResolvedExternalTool extends ExternalToolConfig {
	// Session token of a web service signed in to.
	readonly session?: string
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
// - configMissing: the configuration file does not exist or is not a file.
// - invalidEndpoint: the endpoint of a web service is not an http(s) URL.
// - signedOut: no session of the web service is saved.
export type ExternalToolCheckCode = 'ok' | 'empty' | 'missing' | 'notFile' | 'notExecutable' | 'inaccessible' | 'configMissing' | 'invalidEndpoint' | 'signedOut'

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
	// Whether a session of the web service is saved; absent for a program.
	readonly signedIn?: boolean
	// Why the settings file cannot be used, when status is invalid.
	readonly error?: string
}

// Body of a request signing in to a web service.
export interface ExternalToolLoginRequest {
	// API key of the account, sent once to the service and never stored.
	readonly apiKey: string
}

// Outcome of signing in or out: the new state, a refusal of the service (its message), an unreachable service,
// a program that is not a web service, or a settings file written by a newer version.
export type ExternalToolLoginOutcome =
	| { readonly status: 'signedIn'; readonly tool: ExternalToolState }
	| { readonly status: 'signedOut'; readonly tool: ExternalToolState }
	| { readonly status: 'refused'; readonly error: string }
	| { readonly status: 'unreachable'; readonly error: string }
	| { readonly status: 'notService' }
	| { readonly status: 'newerVersion' }

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

// Time a sign-in request to a web service may take, in milliseconds.
const LOGIN_TIMEOUT = 30000

// Supported external programs, in display order.
export const EXTERNAL_TOOLS: readonly ExternalToolDefinition[] = [
	{
		id: 'astap',
		name: 'ASTAP',
		description: 'Astronomical software used by supported plate-solving and star-detection providers.',
		capabilities: ['plate-solving', 'star-detection'],
		fields: ['executable'],
		session: false,
		timeoutLimits: { min: 1000, max: 3600000 },
	},
	{
		id: 'astrometryLocal',
		name: 'Astrometry.net Local',
		description: 'The solve-field program of astrometry.net, run on this server with its own index files.',
		capabilities: ['plate-solving'],
		fields: ['executable', 'config'],
		session: false,
		timeoutLimits: { min: 1000, max: 3600000 },
	},
	{
		id: 'nova',
		name: 'Nova Astrometry.net',
		description: 'The nova.astrometry.net web service; images are uploaded to it.',
		capabilities: ['plate-solving'],
		fields: ['endpoint'],
		session: true,
		timeoutLimits: { min: 10000, max: 3600000 },
	},
]

// File the settings are persisted in when none is given.
export const DEFAULT_SETTINGS_FILE = join(homedir(), 'Nebulosa', 'settings.json')

// Version of the settings file format written by this version. The fields of the programs added since version 1
// (config, endpoint, session) are optional, so a version 1 file is read as is.
const SETTINGS_VERSION = 1

// Saved settings of a program, as kept in memory and in the settings file.
interface StoredTool extends ExternalToolConfig {
	// Revision of the settings, increased by every save, sign-in, and sign-out.
	readonly revision: number
	// Session token of a web service signed in to.
	readonly session?: string
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

// Whether two configurations are the same; an absent field equals an empty one.
function sameConfig(a: ExternalToolConfig, b: ExternalToolConfig) {
	return a.executable === b.executable && a.timeout === b.timeout && (a.config ?? '') === (b.config ?? '') && (a.endpoint ?? '') === (b.endpoint ?? '')
}

// Returns the settings of a program that it takes, from any configuration: the fields it does not take are left
// out, and the executable of a program without one is empty.
function configOf(id: ExternalToolId, { executable, timeout, config, endpoint }: ExternalToolConfig): ExternalToolConfig {
	const { fields } = definition(id)
	return { executable: fields.includes('executable') ? executable : '', timeout, ...(fields.includes('config') && { config: config ?? '' }), ...(fields.includes('endpoint') && { endpoint: endpoint ?? '' }) }
}

// Returns the settings of every supported program before anything is saved.
function defaultTools(): Map<ExternalToolId, StoredTool> {
	return new Map(EXTERNAL_TOOLS.map((tool) => [tool.id, { ...configOf(tool.id, { executable: '', timeout: DEFAULT_EXTERNAL_TOOL_TIMEOUT }), revision: 0 }]))
}

// Reads the stored settings of a program from the settings file, whose content is not trusted: a path, an
// endpoint, or a session that is not a string becomes empty (no session), a timeout that is not an integer within
// the program's limits becomes the default, and a revision that is not a non-negative integer becomes 0.
function normalizeTool(id: ExternalToolId, value: unknown): StoredTool {
	const { timeoutLimits } = definition(id)
	const entry = isRecord(value) ? value : {}
	const { executable, timeout, config, endpoint, session, revision } = entry
	const text = (field: unknown) => (typeof field === 'string' ? field : '')
	const stored = configOf(id, {
		executable: text(executable),
		timeout: Number.isInteger(timeout) && (timeout as number) >= timeoutLimits.min && (timeout as number) <= timeoutLimits.max ? (timeout as number) : DEFAULT_EXTERNAL_TOOL_TIMEOUT,
		config: text(config),
		endpoint: text(endpoint),
	})
	return { ...stored, revision: Number.isInteger(revision) && (revision as number) >= 0 ? (revision as number) : 0, ...(definition(id).session && typeof session === 'string' && session && { session }) }
}

// Returns the base URL of a web service: the endpoint without a trailing slash, or the public nova endpoint when
// it is empty. Undefined when it is not an http(s) URL.
export function serviceUrl(endpoint: string | undefined): string | undefined {
	const value = endpoint?.trim() || NOVA_ASTROMETRY_NET_URL

	try {
		const url = new URL(value)
		return url.protocol === 'http:' || url.protocol === 'https:' ? value.replace(/\/+$/, '') : undefined
	} catch {
		return undefined
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

// Inspects the settings of a program without running it: its executable, then its configuration file when one is
// set (resolved against the server's working directory), or, for a web service, its endpoint and saved session.
async function inspectTool(id: ExternalToolId, config: ExternalToolConfig, signedIn: boolean): Promise<Inspection> {
	if (definition(id).session) {
		if (!serviceUrl(config.endpoint)) return { status: 'failed', code: 'invalidEndpoint', message: 'The endpoint is not an http or https URL.' }
		if (!signedIn) return { status: 'unavailable', code: 'signedOut', message: 'Not signed in. Sign in with the API key of your account.' }
		return { status: 'available', code: 'ok', message: 'A session is saved. The service was not contacted, so the session may have expired.' }
	}

	const inspection = await inspectExecutable(config.executable)
	if (inspection.status !== 'available' || !config.config?.trim()) return inspection

	try {
		if ((await stat(resolve(config.config))).isFile()) return { ...inspection, message: `${inspection.message} The configuration file exists.` }
	} catch {
		// A missing or unreadable configuration file is reported below.
	}

	return { status: 'unavailable', code: 'configMissing', resolvedPath: inspection.resolvedPath, message: 'No configuration file exists at this path on the server.' }
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

	// Returns the state of a program from loaded settings. A web service is configured once signed in, a program
	// once its executable is set.
	#state(id: ExternalToolId, { tools, error }: LoadedSettings): ExternalToolState {
		const { revision, session, ...config } = tools.get(id)!
		const tool = definition(id)
		const lastCheck = this.#checks.get(id)
		const status = error ? 'invalid' : (tool.session ? session : config.executable) ? 'configured' : 'notConfigured'
		return { ...tool, status, config, revision, ...(lastCheck && { lastCheck }), ...(tool.session && { signedIn: !!session }), ...(error && { error }) }
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
	// of other settings stops being the program's latest one, and a web service whose endpoint changed is signed
	// out, since its session belongs to the former one. Throws when the file cannot be written; the saved settings
	// are then unchanged.
	save(id: ExternalToolId, config: ExternalToolConfig, revision: number): Promise<ExternalToolSaveOutcome> {
		return this.#serialized(async (): Promise<ExternalToolSaveOutcome> => {
			const settings = await this.#load()
			if (settings.newer) return { status: 'newerVersion' }

			const current = settings.tools.get(id)!
			if (revision !== current.revision) return { status: 'conflict', tool: this.#state(id, settings) }

			const next = configOf(id, config)
			const session = current.session && (current.endpoint ?? '') === (next.endpoint ?? '') ? current.session : undefined
			const saved = await this.#write(settings, id, { ...next, revision: current.revision + 1, ...(session && { session }) })
			const check = this.#checks.get(id)
			if (check && (!sameConfig(check.config, next) || session !== current.session)) this.#checks.delete(id)
			return { status: 'saved', tool: this.#publish(id, saved) }
		})
	}

	// Signs in to a web service at its saved endpoint with apiKey, and saves only the session the service returns;
	// the key itself is never stored nor logged. A refused key or an unreachable service leaves the settings
	// unchanged. Throws when the file cannot be written.
	login(id: ExternalToolId, apiKey: string): Promise<ExternalToolLoginOutcome> {
		return this.#serialized(async (): Promise<ExternalToolLoginOutcome> => {
			if (!definition(id).session) return { status: 'notService' }

			const settings = await this.#load()
			if (settings.newer) return { status: 'newerVersion' }

			const current = settings.tools.get(id)!
			const apiUrl = serviceUrl(current.endpoint)
			if (!apiUrl) return { status: 'refused', error: 'The saved endpoint is not an http or https URL' }

			let session: string | undefined

			try {
				const response = await login({ apiUrl, apiKey }, AbortSignal.timeout(LOGIN_TIMEOUT))
				if (!response) return { status: 'unreachable', error: 'The service did not answer the sign-in' }
				if (response.status !== 'success' || !response.session) return { status: 'refused', error: response.errormessage || 'The service refused the API key' }
				session = response.session
			} catch {
				return { status: 'unreachable', error: 'Unable to reach the service' }
			}

			const saved = await this.#write(settings, id, { ...current, revision: current.revision + 1, session })
			this.#checks.delete(id)
			return { status: 'signedIn', tool: this.#publish(id, saved) }
		})
	}

	// Signs out of a web service: removes its saved session. Throws when the file cannot be written.
	logout(id: ExternalToolId): Promise<ExternalToolLoginOutcome> {
		return this.#serialized(async (): Promise<ExternalToolLoginOutcome> => {
			if (!definition(id).session) return { status: 'notService' }

			const settings = await this.#load()
			if (settings.newer) return { status: 'newerVersion' }

			const { session: _, ...current } = settings.tools.get(id)!
			const saved = await this.#write(settings, id, { ...current, revision: current.revision + 1 })
			this.#checks.delete(id)
			return { status: 'signedOut', tool: this.#publish(id, saved) }
		})
	}

	// Checks settings of a program on the server's filesystem without saving them (for a web service, its endpoint
	// and whether a session is saved). When they are the program's saved settings at the end of the check, the
	// result becomes its latest check.
	async check(id: ExternalToolId, config: ExternalToolConfig): Promise<ExternalToolCheck> {
		const start = performance.now()
		const checked = configOf(id, config)
		const before = await this.#load()
		const inspection = await inspectTool(id, checked, !before.error && !!before.tools.get(id)!.session)
		const check: ExternalToolCheck = { ...inspection, config: checked, checkedAt: Date.now(), duration: performance.now() - start }

		const settings = await this.#load()

		if (!settings.error && sameConfig(settings.tools.get(id)!, checked)) {
			this.#checks.set(id, check)
			this.#publish(id, settings)
		}

		return check
	}

	// Returns the settings a run of a program uses, or undefined when the program is not configured (a web service
	// not signed in to) or the settings file cannot be used. A service resolves them once when an operation starts
	// and keeps the returned snapshot for the whole operation, so a later save applies to the next operations only.
	async resolve(id: ExternalToolId): Promise<Readonly<ResolvedExternalTool> | undefined> {
		const { tools, error } = await this.#load()
		const { revision: _, ...tool } = tools.get(id)!
		if (error || !(definition(id).session ? tool.session : tool.executable)) return undefined
		return Object.freeze(tool)
	}

	// Runs a change of the settings after the ones in progress, one at a time.
	#serialized<T>(change: () => Promise<T>): Promise<T> {
		const run = this.#queue.then(change)
		this.#queue = run.catch(() => undefined)
		return run
	}

	// Writes the settings with those of one program replaced, and makes them the loaded ones.
	async #write(settings: LoadedSettings, id: ExternalToolId, tool: StoredTool): Promise<LoadedSettings> {
		const tools = new Map(settings.tools).set(id, tool)
		await writeAtomically(this.file, serializeSettings(tools))
		const saved: LoadedSettings = { tools }
		this.#loaded = Promise.resolve(saved)
		return saved
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
		'/api/settings/external-tools/:id/login': {
			// Signs in to a web service (ExternalToolLoginRequest) and responds with its new state; the API key is never
			// stored. 422 with the service's message when it refused the key, 502 when it cannot be reached, 404 for a
			// program that is not a web service.
			POST: async (req) => {
				const { id } = req.params
				if (!isExternalToolId(id)) return toolNotFound()
				const { apiKey } = (await req.json()) as ExternalToolLoginRequest
				return loginResponse(() => store.login(id, apiKey))
			},
		},
		'/api/settings/external-tools/:id/logout': {
			// Signs out of a web service, removing its session, and responds with its new state.
			POST: (req) => {
				const { id } = req.params
				return isExternalToolId(id) ? loginResponse(() => store.logout(id)) : toolNotFound()
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}

// Responds to a sign-in or sign-out with the new state of the service or why there is none.
async function loginResponse(change: () => Promise<ExternalToolLoginOutcome>): Promise<Response> {
	try {
		const outcome = await change()
		if (outcome.status === 'notService') return toolNotFound()
		if (outcome.status === 'newerVersion') return Response.json({ error: 'The settings file was written by a newer version of Nebulosa', code: 'newerVersion' }, { status: 409 })
		if (outcome.status === 'refused') return Response.json({ error: outcome.error, code: 'refused' }, { status: 422 })
		if (outcome.status === 'unreachable') return Response.json({ error: outcome.error, code: 'unreachable' }, { status: 502 })
		return Response.json(outcome.tool)
	} catch (error) {
		return Response.json({ error: `Unable to write the settings: ${Error.isError(error) ? error.message : String(error)}` }, { status: 500 })
	}
}
