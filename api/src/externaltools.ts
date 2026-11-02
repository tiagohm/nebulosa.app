import { constants } from 'fs'
import { access, stat } from 'fs/promises'
import { isAbsolute, resolve } from 'path'
import { login, NOVA_ASTROMETRY_NET_URL } from 'nebulosa/src/astrometry/solvers/astrometrynet'
import type { AppDatabase } from './database'
import { errorResponse } from './http'
import { errorCode } from './util'

// Server-side settings of the external programs and services the backend uses: ASTAP, the local solve-field
// of astrometry.net, and the nova.astrometry.net web service. Each one is registered here with the capabilities
// its adapters provide and the settings it takes; nothing else can be configured, and no route runs an
// arbitrary command. Settings belong to the server instance (not to a browser, profile, or workspace), are
// persisted in the operational database, and are applied to the next runs without a restart. A test
// checks the executable (and the configuration file) on the server's filesystem only: it never starts the
// program, so it proves neither that the program runs nor that it analyzes images correctly. A web service is
// signed in to with its API key, which is sent once to the service and never stored: the session the service
// returns is kept in the memory of the server only, reused by the runs until signing out or a restart; clients only
// learn whether there is one. Any client that can reach the API can change and test these settings, like every other route.

// Identifier of a supported external program; also its key in the database and its route segment.
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

// State of the saved settings: not configured (no executable, or a web service not signed in to), or configured.
export type ExternalToolConfigStatus = 'notConfigured' | 'configured'

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
// - signedOut: the server holds no session of the web service.
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
	// Whether the server holds a session of the web service; absent for a program.
	readonly signedIn?: boolean
}

// Body of a request signing in to a web service.
export interface ExternalToolLoginRequest {
	// API key of the account, sent once to the service and never stored.
	readonly apiKey: string
}

// Outcome of signing in or out: the new state, a refusal of the service (its message), an unreachable service,
// or a program that is not a web service.
export type ExternalToolLoginOutcome =
	| { readonly status: 'signedIn'; readonly tool: ExternalToolState }
	| { readonly status: 'signedOut'; readonly tool: ExternalToolState }
	| { readonly status: 'refused'; readonly error: string }
	| { readonly status: 'unreachable'; readonly error: string }
	| { readonly status: 'notService' }

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

// Outcome of a save: saved, or refused because another revision was saved since.
export type ExternalToolSaveOutcome = { readonly status: 'saved'; readonly tool: ExternalToolState } | { readonly status: 'conflict'; readonly tool: ExternalToolState }

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

// Saved settings of a program.
interface StoredTool extends ExternalToolConfig {
	// Revision of the settings, increased by every save, sign-in, and sign-out; 0 when never saved.
	readonly revision: number
}

// Row of a program in external_tool_settings.
interface ToolRow {
	readonly executable: string
	readonly timeout: number
	readonly config: string | null
	readonly endpoint: string | null
	readonly revision: number
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
// set (resolved against the server's working directory), or, for a web service, its endpoint and whether the server holds a session.
async function inspectTool(id: ExternalToolId, config: ExternalToolConfig, signedIn: boolean): Promise<Inspection> {
	if (definition(id).session) {
		if (!serviceUrl(config.endpoint)) return { status: 'failed', code: 'invalidEndpoint', message: 'The endpoint is not an http or https URL.' }
		if (!signedIn) return { status: 'unavailable', code: 'signedOut', message: 'Not signed in. Sign in with the API key of your account.' }
		return { status: 'available', code: 'ok', message: 'Signed in. The service was not contacted, so the session may have expired.' }
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

// Settings of the supported external programs, persisted in the operational database. Changes are applied one at a
// time, so a save waits for a sign-in in progress; a save made from an outdated revision is refused, so concurrent
// clients never overwrite each other silently. The sessions of the web services and the latest check of each
// program's saved settings are kept in memory only, so a restart signs out of every service. Every change is
// published to the listener.
export class ExternalToolsStore {
	// Latest check of the saved settings of each program.
	readonly #checks = new Map<ExternalToolId, ExternalToolCheck>()
	// Session token of each web service signed in to.
	readonly #sessions = new Map<ExternalToolId, string>()
	// Tail of the changes in progress, which run one at a time.
	#queue: Promise<unknown> = Promise.resolve()

	// Creates the store of the settings in database, publishing changes to listener.
	constructor(
		readonly database: AppDatabase,
		readonly listener?: ExternalToolListener,
	) {}

	// Returns the saved settings of a program, the defaults when never saved.
	#tool(id: ExternalToolId): StoredTool {
		const row = this.database.db.query<ToolRow, [string]>('SELECT executable, timeout, config, endpoint, revision FROM external_tool_settings WHERE tool_id = ?').get(id)
		if (!row) return { ...configOf(id, { executable: '', timeout: DEFAULT_EXTERNAL_TOOL_TIMEOUT }), revision: 0 }
		const { executable, timeout, config, endpoint, revision } = row
		return { ...configOf(id, { executable, timeout, config: config ?? undefined, endpoint: endpoint ?? undefined }), revision }
	}

	// Saves the settings of a program under revision. Throws when the database cannot be written.
	#write(id: ExternalToolId, { executable, timeout, config, endpoint }: ExternalToolConfig, revision: number) {
		this.database.db
			.query(
				'INSERT INTO external_tool_settings (tool_id, executable, timeout, config, endpoint, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tool_id) DO UPDATE SET executable = excluded.executable, timeout = excluded.timeout, config = excluded.config, endpoint = excluded.endpoint, revision = excluded.revision, updated_at = excluded.updated_at',
			)
			.run(id, executable, timeout, config ?? null, endpoint ?? null, revision, Date.now())
	}

	// Returns the state of a program. A web service is configured once signed in, a program once its executable is set.
	#state(id: ExternalToolId): ExternalToolState {
		const { revision, ...config } = this.#tool(id)
		const tool = definition(id)
		const lastCheck = this.#checks.get(id)
		const signedIn = this.#sessions.has(id)
		const status = (tool.session ? signedIn : config.executable) ? 'configured' : 'notConfigured'
		return { ...tool, status, config, revision, ...(lastCheck && { lastCheck }), ...(tool.session && { signedIn }) }
	}

	// Publishes the state of a program.
	#publish(id: ExternalToolId) {
		const tool = this.#state(id)
		this.listener?.({ type: 'externalTool:updated', tool })
		return tool
	}

	// Returns the state of every supported program, in display order.
	list(): Promise<ExternalToolState[]> {
		return Promise.resolve(EXTERNAL_TOOLS.map((tool) => this.#state(tool.id)))
	}

	// Returns the state of a program.
	get(id: ExternalToolId): Promise<ExternalToolState> {
		return Promise.resolve(this.#state(id))
	}

	// Saves the settings of a program edited from revision. A check of other settings stops being the program's latest
	// one, and a web service whose endpoint changed is signed out, since its session belongs to the former one. Throws
	// when the database cannot be written; the saved settings are then unchanged.
	save(id: ExternalToolId, config: ExternalToolConfig, revision: number): Promise<ExternalToolSaveOutcome> {
		return this.#serialized((): ExternalToolSaveOutcome => {
			const current = this.#tool(id)
			if (revision !== current.revision) return { status: 'conflict', tool: this.#state(id) }

			const next = configOf(id, config)
			this.#write(id, next, current.revision + 1)
			const signedOut = this.#sessions.has(id) && (current.endpoint ?? '') !== (next.endpoint ?? '')
			if (signedOut) this.#sessions.delete(id)
			const check = this.#checks.get(id)
			if (check && (!sameConfig(check.config, next) || signedOut)) this.#checks.delete(id)
			return { status: 'saved', tool: this.#publish(id) }
		})
	}

	// Signs in to a web service at its saved endpoint with apiKey, and keeps only the session the service returns, in
	// memory; the key itself is never stored nor logged. A refused key or an unreachable service leaves the settings
	// unchanged. Throws when the database cannot be written.
	login(id: ExternalToolId, apiKey: string): Promise<ExternalToolLoginOutcome> {
		return this.#serialized(async (): Promise<ExternalToolLoginOutcome> => {
			if (!definition(id).session) return { status: 'notService' }

			const current = this.#tool(id)
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

			this.#write(id, current, current.revision + 1)
			this.#sessions.set(id, session)
			this.#checks.delete(id)
			return { status: 'signedIn', tool: this.#publish(id) }
		})
	}

	// Signs out of a web service: forgets its session. Throws when the database cannot be written.
	logout(id: ExternalToolId): Promise<ExternalToolLoginOutcome> {
		return this.#serialized((): ExternalToolLoginOutcome => {
			if (!definition(id).session) return { status: 'notService' }

			const current = this.#tool(id)
			this.#write(id, current, current.revision + 1)
			this.#sessions.delete(id)
			this.#checks.delete(id)
			return { status: 'signedOut', tool: this.#publish(id) }
		})
	}

	// Checks settings of a program on the server's filesystem without saving them (for a web service, its endpoint
	// and whether it is signed in to). When they are the program's saved settings at the end of the check, the result
	// becomes its latest check.
	async check(id: ExternalToolId, config: ExternalToolConfig): Promise<ExternalToolCheck> {
		const start = performance.now()
		const checked = configOf(id, config)
		const inspection = await inspectTool(id, checked, this.#sessions.has(id))
		const check: ExternalToolCheck = { ...inspection, config: checked, checkedAt: Date.now(), duration: performance.now() - start }

		if (sameConfig(this.#tool(id), checked)) {
			this.#checks.set(id, check)
			this.#publish(id)
		}

		return check
	}

	// Returns the settings a run of a program uses, or undefined when the program is not configured (a web service
	// not signed in to). A service resolves them once when an operation starts and keeps the returned snapshot for the
	// whole operation, so a later save applies to the next operations only.
	resolve(id: ExternalToolId): Promise<Readonly<ResolvedExternalTool> | undefined> {
		const { revision: _, ...tool } = this.#tool(id)
		const session = this.#sessions.get(id)
		if (!(definition(id).session ? session : tool.executable)) return Promise.resolve(undefined)
		return Promise.resolve(Object.freeze({ ...tool, ...(session && { session }) }))
	}

	// Runs a change of the settings after the ones in progress, one at a time.
	#serialized<T>(change: () => T | Promise<T>): Promise<T> {
		const run = this.#queue.then(change)
		this.#queue = run.catch(() => undefined)
		return run
	}
}

// Responds 404 for an unknown external program.
function toolNotFound() {
	return errorResponse('External tool not found', 404, 'notFound')
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
			// with the current state when another revision was saved since, and 500 when the database cannot be written.
			PUT: async (req) => {
				const { id } = req.params
				if (!isExternalToolId(id)) return toolNotFound()
				const { config, revision } = (await req.json()) as ExternalToolSaveRequest

				try {
					const outcome = await store.save(id, config, revision)
					if (outcome.status === 'conflict') return errorResponse('The settings were changed by another client', 409, 'conflict', { tool: outcome.tool })
					return Response.json(outcome.tool)
				} catch (error) {
					return errorResponse(`Unable to write the settings: ${Error.isError(error) ? error.message : String(error)}`, 500, 'writeFailed')
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
		if (outcome.status === 'refused') return errorResponse(outcome.error, 422, 'refused')
		if (outcome.status === 'unreachable') return errorResponse(outcome.error, 502, 'unreachable')
		return Response.json(outcome.tool)
	} catch (error) {
		return errorResponse(`Unable to write the settings: ${Error.isError(error) ? error.message : String(error)}`, 500, 'writeFailed')
	}
}
