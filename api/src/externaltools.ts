import { constants } from 'fs'
import { access, readdir, stat } from 'fs/promises'
import { isAbsolute, resolve } from 'path'
import type { AppDatabase } from './database'
import { errorResponse } from './http'
import { parseVersion, supportedVersion } from './observatorycameras.gateway'
import { DEFAULT_QUAD_INDEX_DIRECTORY } from './platesolving.downloads'
import { findQuadIndexFiles, type QuadIndexFiles } from './platesolving.native'
import { errorCode } from './util'

// Server-side settings of the external programs and data the backend uses: MediaMTX, the media gateway of Observatory
// Cameras, and the folder of the index files of the built-in plate solver, which ships with the server while its data
// does not. Each one is registered here with the capabilities it provides and the settings it
// takes; nothing else can be configured, and no route runs an arbitrary command. Settings belong to the server instance
// (not to a browser, profile, or workspace), are persisted in the operational database, and are applied to the next
// runs without a restart. A test checks the executable on the server's filesystem, then starts the program once with a
// fixed argument that only prints its version, and checks the version the gateway needs. The folder of the built-in
// solver is checked for the index files it holds, and nothing is started; an empty Index Folder
// stands for the default index folder of the data directory, where its downloaded bands are installed, so the built-in
// solver is always configured. A test never analyzes an image, so it proves that the program runs, not that it solves.
// The saved settings of every program are checked again when the server starts, since checks are kept in memory only.
// Any client that can reach the API can change and test these settings, like every other route.

// Identifier of a supported external program; also its key in the database and its route segment.
export type ExternalToolId = 'nebulosa' | 'mediamtx'

// Capability a program provides to the services that use it; video-gateway is the media gateway the server keeps
// running to relay the observatory cameras to browsers.
export type ExternalToolCapability = 'plate-solving' | 'video-gateway'

// Setting a program takes besides its timeout: its executable, or the folder of the index files of the built-in solver.
export type ExternalToolField = 'executable' | 'indexDirectory'

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
	// What the program needs besides itself to do its work, which a test cannot prove, meant for people.
	readonly requirements: string
	// Capabilities the program provides.
	readonly capabilities: readonly ExternalToolCapability[]
	// Settings it takes besides the timeout, in display order.
	readonly fields: readonly ExternalToolField[]
	// Valid range of the default timeout of a run.
	readonly timeoutLimits: TimeoutLimits
	// Timeout of a program never saved, in milliseconds, within timeoutLimits.
	readonly defaultTimeout: number
}

// Settings of an external program. A field the program does not take (see its fields) is absent.
export interface ExternalToolConfig {
	// Path of the executable on the server's filesystem, or a name looked up on the server's PATH; empty when not
	// configured or not taken.
	readonly executable: string
	// Default time limit of a run, in milliseconds, within the program's timeoutLimits; for a program the server keeps
	// running, the time it may take to become ready after starting.
	readonly timeout: number
	// Folder of quad index files on the server's filesystem, searched with its subfolders: Nebulosa .nqi tiles and
	// Astrometry.net index files; empty for none.
	readonly indexDirectory?: string
}

// State of the saved settings: not configured (no executable), or configured.
export type ExternalToolConfigStatus = 'notConfigured' | 'configured'

// Outcome of a check: the program answered when started, it is not where the settings point, or it cannot be used.
export type ExternalToolCheckStatus = 'available' | 'unavailable' | 'failed'

// Reason of a check outcome:
// - ok: the program answered when started (the built-in solver: its folder holds index files).
// - empty: no path is set.
// - missing: nothing exists at the path, or the name is not on the server's PATH.
// - notFile: the path is a directory or another non-regular file.
// - notExecutable: the file cannot be executed by the server process (never reported on Windows, where
//   any existing file passes).
// - inaccessible: the path cannot be inspected, such as a directory the server may not read.
// - notStarted: the server could not start the program, such as a file that is not a program of this computer.
// - noAnswer: the program did not end within PROBE_TIMEOUT when started to print its version.
// - incompatibleVersion: the program is not MediaMTX 1.21 or a later 1.x, which the gateway needs.
// - notDirectory: the index folder of the built-in solver is a file or another non-directory.
// - noIndexes: the index folder of the built-in solver holds no index file.
export type ExternalToolCheckCode = 'ok' | 'empty' | 'missing' | 'notFile' | 'notExecutable' | 'inaccessible' | 'notStarted' | 'noAnswer' | 'incompatibleVersion' | 'notDirectory' | 'noIndexes'

// Result of checking the executable of a configuration on the server's filesystem.
export interface ExternalToolCheck {
	// Outcome of the check.
	readonly status: ExternalToolCheckStatus
	// Reason of the outcome.
	readonly code: ExternalToolCheckCode
	// Configuration checked, so a client can tell whether the result still applies to what it edits.
	readonly config: ExternalToolConfig
	// Absolute path the executable (for the built-in solver, its index folder) resolved to; absent when it was not found.
	readonly resolvedPath?: string
	// Version the program printed when started; absent when it printed none and when it was not started.
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

// Outcome of a save: saved, or refused because another revision was saved since.
export type ExternalToolSaveOutcome = { readonly status: 'saved'; readonly tool: ExternalToolState } | { readonly status: 'conflict'; readonly tool: ExternalToolState }

// Default time limit of a plate solve of the built-in solver, in milliseconds: 5 minutes, the toolkit's
// DEFAULT_NATIVE_TIMEOUT.
export const DEFAULT_EXTERNAL_TOOL_TIMEOUT = 300000

// Default time MediaMTX may take to answer its control API after starting, in milliseconds.
export const DEFAULT_MEDIAMTX_TIMEOUT = 15000

// Supported external programs, in display order.
export const EXTERNAL_TOOLS: readonly ExternalToolDefinition[] = [
	{
		id: 'nebulosa',
		name: 'Nebulosa',
		description: 'Plate solver built into Nebulosa, which searches quad index files on this server; images never leave it.',
		requirements: 'Solving needs quad index files whose bands cover the field of view of your images (Nebulosa .nqi tiles or Astrometry.net index files).',
		capabilities: ['plate-solving'],
		fields: ['indexDirectory'],
		timeoutLimits: { min: 1000, max: 3600000 },
		defaultTimeout: DEFAULT_EXTERNAL_TOOL_TIMEOUT,
	},
	{
		id: 'mediamtx',
		name: 'MediaMTX',
		description: 'Media gateway the server keeps running while observatory cameras are enabled; it reads their RTSP streams and relays them to browsers over WebRTC.',
		requirements: 'The gateway needs MediaMTX 1.21 or a later 1.x, the RTSP streams of the cameras reachable from the server, and its UDP port open to the browsers.',
		capabilities: ['video-gateway'],
		fields: ['executable'],
		timeoutLimits: { min: 1000, max: 60000 },
		defaultTimeout: DEFAULT_MEDIAMTX_TIMEOUT,
	},
]

// Saved settings of a program.
interface StoredTool extends ExternalToolConfig {
	// Revision of the settings, increased by every save; 0 when never saved.
	readonly revision: number
}

// Row of a program in external_tool_settings.
interface ToolRow {
	readonly executable: string
	readonly timeout: number
	readonly index_directory: string | null
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
	return a.executable === b.executable && a.timeout === b.timeout && (a.indexDirectory ?? '') === (b.indexDirectory ?? '')
}

// Returns the settings of a program that it takes, from any configuration: the fields it does not take are left
// out, and the executable of a program without one is empty.
function configOf(id: ExternalToolId, { executable, timeout, indexDirectory }: ExternalToolConfig): ExternalToolConfig {
	const { fields } = definition(id)
	return {
		executable: fields.includes('executable') ? executable : '',
		timeout,
		...(fields.includes('indexDirectory') && { indexDirectory: indexDirectory ?? '' }),
	}
}

// Whether the settings of a program are set up enough to run: an executable. The built-in solver always is, since an
// empty Index Folder stands for the default index folder.
function hasSettings(id: ExternalToolId, { executable }: ExternalToolConfig) {
	return definition(id).fields.includes('indexDirectory') || executable.trim() !== ''
}

// Outcome of inspecting an executable, before timing is added.
type Inspection = Pick<ExternalToolCheck, 'status' | 'code' | 'resolvedPath' | 'version' | 'message'>

// Outcome of starting a program to print its version: what it printed (standard output, then standard error), why it
// could not be started, or that it was stopped for not ending within the time given.
export type ProbeOutcome = { readonly status: 'answered'; readonly output: string } | { readonly status: 'notStarted'; readonly message: string } | { readonly status: 'noAnswer' }

// Starts a program with fixed arguments and waits for it to end, at most timeout milliseconds.
export type ProgramProbe = (executable: string, args: readonly string[], timeout: number) => Promise<ProbeOutcome>

// Longest time a program started by a test may take to print its version and end, in milliseconds.
export const PROBE_TIMEOUT = 10000

// Arguments that make each program print its version and end without doing any work.
const PROBE_ARGUMENTS: Readonly<Partial<Record<ExternalToolId, readonly string[]>>> = { mediamtx: ['--version'] }

// Starts executable with args, never through a shell, and collects what it prints until it ends. A program still
// running after timeout milliseconds is killed and reported as not answering.
export async function probeProgram(executable: string, args: readonly string[], timeout: number): Promise<ProbeOutcome> {
	let subprocess: Bun.Subprocess<'ignore', 'pipe', 'pipe'>

	try {
		subprocess = Bun.spawn([executable, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
	} catch (error) {
		return { status: 'notStarted', message: Error.isError(error) ? error.message : String(error) }
	}

	let timedOut = false
	const timer = setTimeout(() => {
		timedOut = true
		subprocess.kill('SIGKILL')
	}, timeout)

	try {
		const [stdout, stderr] = await Promise.all([new Response(subprocess.stdout).text(), new Response(subprocess.stderr).text(), subprocess.exited])
		if (timedOut) return { status: 'noAnswer' }
		if (subprocess.signalCode) return { status: 'notStarted', message: `it ended with ${subprocess.signalCode}` }
		return { status: 'answered', output: `${stdout}\n${stderr}` }
	} finally {
		clearTimeout(timer)
	}
}

// Returns the version a program printed: the word after "version" or "revision", else the first dotted number
// (MediaMTX's v1.21.3 as 1.21.3); undefined when there is none.
export function programVersion(output: string): string | undefined {
	const named = /\b(?:version|revision)\s+v?([0-9a-z][\w.+-]*\d)/i.exec(output)
	if (named) return named[1]
	return /\bv?(\d+\.\d+(?:\.\d+)*)\b/.exec(output)?.[1]
}

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

	return { status: 'available', code: 'ok', resolvedPath: path, message: 'The executable was found and the server may run it.' }
}

// Inspects the settings of a program: the folders of the built-in solver, or the executable of a program, which is
// then started once with probe to print its version.
async function inspectTool(id: ExternalToolId, config: ExternalToolConfig, probe: ProgramProbe, defaultIndexDirectory: string): Promise<Inspection> {
	if (id === 'nebulosa') return await inspectSolverFolders(config, defaultIndexDirectory)

	const { name } = definition(id)
	const inspection = await inspectExecutable(config.executable)
	if (inspection.status !== 'available' || !inspection.resolvedPath) return inspection
	const { resolvedPath } = inspection

	const args = PROBE_ARGUMENTS[id] ?? []
	const outcome = await probe(resolvedPath, args, PROBE_TIMEOUT)

	if (outcome.status === 'notStarted') return { status: 'failed', code: 'notStarted', resolvedPath, message: `The server could not start the program: ${outcome.message}.` }
	if (outcome.status === 'noAnswer') return { status: 'failed', code: 'noAnswer', resolvedPath, message: `The program did not end within ${PROBE_TIMEOUT / 1000} s when started with ${args.join(' ')}, so it was stopped. Set the command-line program, not a graphical one.` }

	const version = programVersion(outcome.output)
	const named = version ? `${name} ${version}` : name

	if (id === 'mediamtx') {
		const parsed = parseVersion(outcome.output)
		if (!parsed || !supportedVersion(parsed)) return { status: 'failed', code: 'incompatibleVersion', resolvedPath, version, message: `${version ? `Version ${version}` : 'The program'} answered, but the gateway needs MediaMTX 1.21 or a later 1.x.` }
	}

	return { status: 'available', code: 'ok', resolvedPath, version, message: `${named} answered when started.` }
}

// Inspects the index folder of the built-in solver: undefined when it is a folder the server may read, else why it
// cannot be used.
async function inspectFolder(path: string): Promise<Inspection | undefined> {
	try {
		if (!(await stat(path)).isDirectory()) return { status: 'failed', code: 'notDirectory', resolvedPath: path, message: 'The index folder is not a folder.' }
		await readdir(path)
		return undefined
	} catch (error) {
		const code = errorCode(error)
		if (code === 'ENOENT' || code === 'ENOTDIR') return { status: 'unavailable', code: 'missing', message: 'No folder exists at the path of the index folder on the server.' }
		return { status: 'failed', code: 'inaccessible', resolvedPath: path, message: 'The index folder cannot be read by the server.' }
	}
}

// Inspects the index folder of the built-in solver (resolved against the server's working directory): it must be a
// folder the server reads holding an index file. An empty Index Folder stands for defaultIndexDirectory, which holds no
// index file until a band is downloaded. Nothing is started.
async function inspectSolverFolders({ indexDirectory = '' }: ExternalToolConfig, defaultIndexDirectory: string): Promise<Inspection> {
	const indexPath = indexDirectory.trim() ? resolve(indexDirectory) : defaultIndexDirectory
	// The default index folder is created by the first download, so it may not exist yet.
	const defaultMissing =
		!indexDirectory.trim() &&
		!(await stat(indexPath).then(
			(e) => e.isDirectory(),
			() => false,
		))
	const problem = !defaultMissing && (await inspectFolder(indexPath))
	if (problem) return problem

	const resolvedPath = indexPath
	let files: QuadIndexFiles = { nebulosa: [], astrometryNet: [], unreadable: [] }

	// The folder was readable a moment ago; one that stops being so is reported as such.
	try {
		if (!defaultMissing) files = await findQuadIndexFiles(indexPath)
	} catch {
		return { status: 'failed', code: 'inaccessible', resolvedPath, message: 'The index folder cannot be read by the server.' }
	}

	const found: string[] = []
	if (files.nebulosa.length > 0) found.push(`${files.nebulosa.length} Nebulosa index ${files.nebulosa.length === 1 ? 'file' : 'files'}`)
	if (files.astrometryNet.length > 0) found.push(`${files.astrometryNet.length} Astrometry.net index ${files.astrometryNet.length === 1 ? 'file' : 'files'}`)

	if (found.length === 0) return { status: 'unavailable', code: 'noIndexes', resolvedPath, message: `The index folder holds no index file.${indexDirectory.trim() ? '' : ' Download the index bands that cover the field of view of your images.'}` }
	const unreadable = files.unreadable.length === 0 ? '' : ` ${files.unreadable.length} ${files.unreadable.length === 1 ? 'subfolder' : 'subfolders'} of the index folder cannot be read and ${files.unreadable.length === 1 ? 'is' : 'are'} left out.`
	return { status: 'available', code: 'ok', resolvedPath, message: `Found ${found.join(', ')}.${unreadable} The files are read once a solve needs them.` }
}

// Settings of the supported external programs, persisted in the operational database. Saves are applied one at a
// time; a save made from an outdated revision is refused, so concurrent clients never overwrite each other silently.
// The latest check of each program's saved settings is kept in memory only. Every change is published to the listener.
export class ExternalToolsStore {
	// Latest check of the saved settings of each program.
	readonly #checks = new Map<ExternalToolId, ExternalToolCheck>()
	// Tail of the changes in progress, which run one at a time.
	#queue: Promise<unknown> = Promise.resolve()

	// Creates the store of the settings in database, publishing changes to listener; probe starts the programs a check
	// tests, and defaultIndexDirectory is the folder the built-in solver searches when its Index Folder is empty.
	constructor(
		readonly database: AppDatabase,
		readonly listener?: ExternalToolListener,
		readonly probe: ProgramProbe = probeProgram,
		readonly defaultIndexDirectory: string = DEFAULT_QUAD_INDEX_DIRECTORY,
	) {}

	// Returns the saved settings of a program, the defaults when never saved.
	#tool(id: ExternalToolId): StoredTool {
		const row = this.database.db.query<ToolRow, [string]>('SELECT executable, timeout, index_directory, revision FROM external_tool_settings WHERE tool_id = ?').get(id)
		if (!row) return { ...configOf(id, { executable: '', timeout: definition(id).defaultTimeout }), revision: 0 }
		const { executable, timeout, index_directory, revision } = row
		return { ...configOf(id, { executable, timeout, indexDirectory: index_directory ?? undefined }), revision }
	}

	// Saves the settings of a program under revision. Throws when the database cannot be written.
	#write(id: ExternalToolId, { executable, timeout, indexDirectory }: ExternalToolConfig, revision: number) {
		this.database.db
			.query(
				'INSERT INTO external_tool_settings (tool_id, executable, timeout, index_directory, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (tool_id) DO UPDATE SET executable = excluded.executable, timeout = excluded.timeout, index_directory = excluded.index_directory, revision = excluded.revision, updated_at = excluded.updated_at',
			)
			.run(id, executable, timeout, indexDirectory ?? null, revision, Date.now())
	}

	// Returns the state of a program, configured once its executable (the built-in solver always) is set.
	#state(id: ExternalToolId): ExternalToolState {
		const { revision, ...config } = this.#tool(id)
		const lastCheck = this.#checks.get(id)
		const status = hasSettings(id, config) ? 'configured' : 'notConfigured'
		return { ...definition(id), status, config, revision, ...(lastCheck && { lastCheck }) }
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
	// one. Throws when the database cannot be written; the saved settings are then unchanged.
	save(id: ExternalToolId, config: ExternalToolConfig, revision: number): Promise<ExternalToolSaveOutcome> {
		return this.#serialized((): ExternalToolSaveOutcome => {
			const current = this.#tool(id)
			if (revision !== current.revision) return { status: 'conflict', tool: this.#state(id) }

			const next = configOf(id, config)
			this.#write(id, next, current.revision + 1)
			const check = this.#checks.get(id)
			if (check && !sameConfig(check.config, next)) this.#checks.delete(id)
			return { status: 'saved', tool: this.#publish(id) }
		})
	}

	// Checks settings of a program without saving them: its files on the server, then a start that prints its version.
	// When they are the program's saved settings at the end of the check, the result becomes its latest check.
	async check(id: ExternalToolId, config: ExternalToolConfig): Promise<ExternalToolCheck> {
		const start = performance.now()
		const checked = configOf(id, config)
		const inspection = await inspectTool(id, checked, this.probe, this.defaultIndexDirectory)
		const check: ExternalToolCheck = { ...inspection, config: checked, checkedAt: Date.now(), duration: performance.now() - start }

		if (sameConfig(this.#tool(id), checked)) {
			this.#checks.set(id, check)
			this.#publish(id)
		}

		return check
	}

	// Checks the saved settings of every program with an executable set (and the built-in solver), all at once, so their
	// states are known after a restart without anyone testing them; each result becomes the program's latest check.
	async checkSaved(): Promise<void> {
		await Promise.all(
			EXTERNAL_TOOLS.map(async ({ id }) => {
				const { revision: _, ...config } = this.#tool(id)
				if (hasSettings(id, config)) await this.check(id, config)
			}),
		)
	}

	// Returns the settings a run of a program uses, or undefined when the program is not configured (a program without
	// an executable). The built-in solver gets the default index folder for an empty Index Folder. A service resolves
	// them once when an operation starts and keeps the returned snapshot for the whole operation, so a later save
	// applies to the next operations only.
	resolve(id: ExternalToolId): Promise<Readonly<ExternalToolConfig> | undefined> {
		const { revision: _, ...tool } = this.#tool(id)
		if (!hasSettings(id, tool)) return Promise.resolve(undefined)
		const defaulted = definition(id).fields.includes('indexDirectory') && !tool.indexDirectory?.trim() && { indexDirectory: this.defaultIndexDirectory }
		return Promise.resolve(Object.freeze({ ...tool, ...defaulted }))
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
			// Checks settings (ExternalToolTestRequest) without saving them, starting the program once to print its
			// version; it never analyzes an image.
			POST: async (req) => {
				const { id } = req.params
				if (!isExternalToolId(id)) return toolNotFound()
				const { config } = (await req.json()) as ExternalToolTestRequest
				return Response.json(await store.check(id, config))
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
