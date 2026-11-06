import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { RtspTransport } from './observatorycameras'

// Supervision of the one MediaMTX process that relays the observatory cameras, and the client of its control API. The
// process is configured only by MTX_* variables, in an empty private working directory: its control API and WebRTC
// signaling listen on loopback ports chosen at each start, so only this server reaches them; WebRTC media uses the
// documented UDP port MEDIAMTX_ICE_PORT on every interface; every other protocol, recording, and hook is off. No camera
// address is ever on its command line or in a file: paths are added through the control API. Its output is read only
// to classify the errors of the camera sources and is never logged nor passed on, since it may name the cameras. An
// unexpected exit is followed by at most MAX_RESTARTS restarts; stopping it waits for its exit, then kills it.

// UDP port of the WebRTC media (ICE) of the gateway, on every interface; the browsers must reach it.
export const MEDIAMTX_ICE_PORT = 8189

// Path name prefix of the cameras in the gateway; paths without it are never touched.
export const CAMERA_PATH_PREFIX = 'obs-'

// Time the source of a camera may take to deliver its stream once a browser asks for it, in seconds.
const SOURCE_START_TIMEOUT = 15

// Time a source is kept open after its last reader left, in seconds.
const SOURCE_CLOSE_AFTER = 10

// Restarts tried after unexpected exits before the gateway stays unavailable.
const MAX_RESTARTS = 3

// Pause before each restart, in milliseconds, by attempt.
const RESTART_DELAYS = [1000, 4000, 16000] as const

// Time the gateway must stay ready before its restart attempts are counted again from zero, in milliseconds.
const STABLE_TIME = 60000

// Time a stopping gateway may take to exit before it is killed, in milliseconds.
const STOP_TIMEOUT = 2000

// Time the version check may take, in milliseconds.
const VERSION_TIMEOUT = 5000

// Time a request to the control API may take, in milliseconds.
const CONTROL_TIMEOUT = 5000

// Interval between two probes of the control API while starting, in milliseconds.
const PROBE_INTERVAL = 100

// Oldest supported minor version of MediaMTX 1.x: the v3 control API and WHEP of 1.21.
const MIN_MINOR_VERSION = 21

// Lifecycle of the gateway: no executable is configured, it is starting, ready, waiting to restart after an unexpected
// exit, unavailable (it could not start or keep running), stopping, or stopped (not needed).
export type GatewayStatus = 'notInstalled' | 'starting' | 'ready' | 'restarting' | 'unavailable' | 'stopping' | 'stopped'

// Reason of a gateway state:
// - notConfigured: no MediaMTX executable is set in External Tools.
// - missing / notExecutable: the executable set cannot be found or run.
// - incompatibleVersion: the program is not MediaMTX 1.21 or a later 1.x.
// - bindFailed: a port of the gateway, usually the UDP port of WebRTC, is in use.
// - exited: the process ended unexpectedly.
// - readinessTimeout: the control API did not answer within the timeout of the tool.
// - controlFailed: the control API refused a configuration.
export type GatewayCode = 'notConfigured' | 'missing' | 'notExecutable' | 'incompatibleVersion' | 'bindFailed' | 'exited' | 'readinessTimeout' | 'controlFailed'

// Reason a camera source failed, from the gateway's output: refused credentials, a path the camera does not serve, a
// camera that cannot be reached, or another failure.
export type SourceCode = 'sourceAuthFailed' | 'sourceNotFound' | 'sourceUnreachable' | 'sourceFailed'

// State of the gateway, as clients see it.
export interface GatewayState {
	// Lifecycle of the gateway.
	readonly status: GatewayStatus
	// Reason of the status, when it is not the normal one.
	readonly code?: GatewayCode
	// Explanation meant for people; never a camera address.
	readonly message?: string
}

// Executable and readiness timeout of the gateway, from External Tools.
export interface GatewayProgram {
	// Path or PATH name of the executable.
	readonly executable: string
	// Time the control API may take to answer after starting, in milliseconds.
	readonly timeout: number
}

// Desired configuration of the path of a camera.
export interface GatewayPathConfig {
	// RTSP address of the camera, decrypted; sent only to the control API.
	readonly source: string
	// How the RTSP stream is read.
	readonly rtspTransport: RtspTransport
}

// Path of a camera at runtime.
export interface GatewayPathState {
	// Whether the stream is being received.
	readonly available: boolean
	// Number of readers, such as WebRTC sessions.
	readonly readers: number
}

// Receiver of what the gateway reports.
export interface GatewayListener {
	// The state changed.
	readonly stateChanged: (state: GatewayState) => void
	// The gateway became ready in a new process, whose paths are empty.
	readonly started: () => void
	// The process ended; its sessions are gone.
	readonly exited: () => void
	// The source of a camera failed, or delivered its stream again (undefined code).
	readonly sourceChanged: (cameraId: string, code: SourceCode | undefined) => void
}

// Options of the gateway.
export interface GatewayOptions {
	// Resolves the executable to run, undefined when none is configured.
	readonly program: () => Promise<GatewayProgram | undefined>
	// Receiver of what the gateway reports.
	readonly listener: GatewayListener
	// Command line of a run of the executable with arguments; the executable itself by default (tests run a script).
	readonly command?: (executable: string, args: readonly string[]) => string[]
	// UDP port of WebRTC media; MEDIAMTX_ICE_PORT by default.
	readonly icePort?: number
}

// Loopback addresses of a running gateway.
interface Endpoints {
	// Base URL of the control API.
	readonly api: string
	// Base URL of WebRTC signaling (WHEP).
	readonly webrtc: string
}

// Returns the path name of a camera in the gateway.
export function cameraPathName(cameraId: string) {
	return `${CAMERA_PATH_PREFIX}${cameraId}`
}

// Parses the version MediaMTX prints (such as v1.21.3) into its numbers, or undefined.
export function parseVersion(output: string): readonly [number, number, number] | undefined {
	const match = /v(\d+)\.(\d+)\.(\d+)/.exec(output)
	return match ? [+match[1], +match[2], +match[3]] : undefined
}

// Whether a version of MediaMTX is supported: 1.21 or a later 1.x.
export function supportedVersion(version: readonly [number, number, number]) {
	return version[0] === 1 && version[1] >= MIN_MINOR_VERSION
}

// Variables configuring a gateway with its control API and WebRTC signaling on the given loopback ports and WebRTC
// media on the UDP port icePort; every other listener is off.
export function gatewayEnvironment(apiPort: number, webrtcPort: number, icePort: number): Record<string, string> {
	return {
		MTX_LOGLEVEL: 'info',
		MTX_LOGDESTINATIONS: 'stdout',
		MTX_API: 'yes',
		MTX_APIADDRESS: `127.0.0.1:${apiPort}`,
		MTX_WEBRTC: 'yes',
		MTX_WEBRTCADDRESS: `127.0.0.1:${webrtcPort}`,
		MTX_WEBRTCLOCALUDPADDRESS: `:${icePort}`,
		MTX_WEBRTCIPSFROMINTERFACES: 'yes',
		MTX_RTSP: 'no',
		MTX_RTMP: 'no',
		MTX_HLS: 'no',
		MTX_SRT: 'no',
		MTX_MOQ: 'no',
		MTX_PLAYBACK: 'no',
		MTX_METRICS: 'no',
		MTX_PPROF: 'no',
	}
}

// Variables of the server environment the gateway inherits: only those a program needs to run on each platform.
const INHERITED_VARIABLES = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG'] as const

// Returns the inherited part of the environment of the gateway.
function inheritedEnvironment() {
	const env: Record<string, string> = {}

	for (const name of INHERITED_VARIABLES) {
		const value = process.env[name]
		if (value !== undefined) env[name] = value
	}

	return env
}

// Configuration of the path of a camera, as the control API takes it.
export function pathConfiguration({ source, rtspTransport }: GatewayPathConfig) {
	return { source, sourceOnDemand: true, sourceOnDemandStartTimeout: `${SOURCE_START_TIMEOUT}s`, sourceOnDemandCloseAfter: `${SOURCE_CLOSE_AFTER}s`, rtspTransport, record: false }
}

// Classifies a line of the gateway's output: the camera whose source failed or recovered, and the reason, or undefined
// for any other line.
export function classifyLine(line: string): { readonly cameraId: string; readonly code: SourceCode | undefined } | undefined {
	const match = /\b(ERR|INF) \[path obs-([^\]\s]+)\] (.*)$/.exec(line)
	if (!match) return undefined
	const [, level, cameraId, text] = match

	if (level === 'INF') return text.startsWith('stream is available') ? { cameraId, code: undefined } : undefined
	if (/bad status code: 40[13]\b/.test(text)) return { cameraId, code: 'sourceAuthFailed' }
	if (/bad status code: 404\b/.test(text)) return { cameraId, code: 'sourceNotFound' }
	if (/\bdial (tcp|udp)\b|i\/o timeout|no route to host|connection refused|network is unreachable/i.test(text)) return { cameraId, code: 'sourceUnreachable' }
	return { cameraId, code: 'sourceFailed' }
}

// Returns a free TCP port of the loopback interface.
function freePort() {
	const listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data: () => undefined } })
	const { port } = listener
	listener.stop(true)
	return port
}

// Message of each gateway code, meant for people.
const MESSAGES: Readonly<Record<GatewayCode, string>> = {
	notConfigured: 'MediaMTX is not configured. Set its executable in Settings → External Tools.',
	missing: 'The MediaMTX executable set in External Tools was not found.',
	notExecutable: 'The MediaMTX executable set in External Tools cannot be run by the server.',
	incompatibleVersion: 'The executable set in External Tools is not MediaMTX 1.21 or a later 1.x.',
	bindFailed: `MediaMTX could not open its ports; the UDP port ${MEDIAMTX_ICE_PORT} may be in use by another program.`,
	exited: 'MediaMTX stopped unexpectedly.',
	readinessTimeout: 'MediaMTX did not become ready in time.',
	controlFailed: 'MediaMTX refused the configuration of a camera.',
}

// The MediaMTX gateway of the server: started when needed, restarted after unexpected exits, and stopped when no longer
// needed or when the server stops.
export class MediaMtxGateway {
	// Current state.
	#state: GatewayState = { status: 'stopped' }
	// Running process, from spawn to exit.
	#process?: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
	// Addresses of the running process, once spawned.
	#endpoints?: Endpoints
	// Private working directory of the running process.
	#directory?: string
	// Id of the running process, new at each start; sessions of another one are gone.
	#epoch?: string
	// Whether the gateway should be running.
	#wanted = false
	// Start in progress, shared by concurrent callers.
	#starting?: Promise<boolean>
	// Restart attempts since the gateway was last stable.
	#restarts = 0
	// Pending restart, or the timer that counts the gateway as stable.
	#timer?: Timer
	// Whether the last bind failure was seen in the output of the running process.
	#bindFailed = false

	// Creates the gateway with options.
	constructor(readonly options: GatewayOptions) {}

	// Current state.
	get state(): GatewayState {
		return this.#state
	}

	// Id of the running process, undefined when none is ready.
	get epoch(): string | undefined {
		return this.#state.status === 'ready' ? this.#epoch : undefined
	}

	// Base URL of WebRTC signaling while ready, else undefined.
	get webrtcUrl(): string | undefined {
		return this.#state.status === 'ready' ? this.#endpoints?.webrtc : undefined
	}

	// Sets the state and reports it when it changed.
	#set(status: GatewayStatus, code?: GatewayCode, message: string | undefined = code && MESSAGES[code]) {
		if (this.#state.status === status && this.#state.code === code && this.#state.message === message) return
		this.#state = { status, ...(code && { code }), ...(message && { message }) }
		this.options.listener.stateChanged(this.#state)
	}

	// Brings the gateway up when wanted, or down when not. Resolves whether it is ready. Never rejects.
	async ensure(wanted: boolean): Promise<boolean> {
		this.#wanted = wanted
		if (!wanted) {
			await this.stop()
			if (!(await this.options.program())) this.#set('notInstalled', 'notConfigured')
			return false
		}
		if (this.#state.status === 'ready') return true
		if (this.#state.status === 'restarting') return false
		this.#starting ??= this.#start().finally(() => {
			this.#starting = undefined
		})
		return this.#starting
	}

	// Stops the running process, if any, and starts again with the current executable when still wanted. Never rejects.
	async restart(): Promise<boolean> {
		await this.#starting?.catch(() => false)
		await this.#halt()
		this.#restarts = 0
		return this.ensure(this.#wanted)
	}

	// Starts the process and waits for its control API. Resolves whether it is ready.
	async #start(): Promise<boolean> {
		const program = await this.options.program()
		if (!program) return this.#fail('notInstalled', 'notConfigured')

		const executable = Bun.which(program.executable) ?? program.executable
		this.#set('starting')

		const version = await this.#version(executable)
		if (version === 'missing') return this.#fail('notInstalled', 'missing')
		if (version === 'notExecutable') return this.#fail('unavailable', 'notExecutable')
		if (!version || !supportedVersion(version)) return this.#fail('unavailable', 'incompatibleVersion')
		if (!this.#wanted) return this.#stopped()

		const apiPort = freePort()
		const webrtcPort = freePort()
		const icePort = this.options.icePort ?? MEDIAMTX_ICE_PORT
		const directory = await mkdtemp(join(tmpdir(), 'nebulosa-mediamtx-'))
		const command = this.options.command?.(executable, []) ?? [executable]
		this.#bindFailed = false

		let subprocess: Bun.Subprocess<'ignore', 'pipe', 'pipe'>

		try {
			subprocess = Bun.spawn(command, { cwd: directory, env: { ...inheritedEnvironment(), ...gatewayEnvironment(apiPort, webrtcPort, icePort) }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
		} catch {
			await rm(directory, { recursive: true, force: true })
			return this.#fail('unavailable', 'notExecutable')
		}

		this.#process = subprocess
		this.#directory = directory
		this.#endpoints = { api: `http://127.0.0.1:${apiPort}`, webrtc: `http://127.0.0.1:${webrtcPort}` }
		this.#epoch = crypto.randomUUID()
		void this.#read(subprocess.stdout)
		void this.#read(subprocess.stderr)
		void subprocess.exited.then(() => this.#exited(subprocess))

		const deadline = Date.now() + program.timeout

		while (Date.now() < deadline) {
			if (this.#process !== subprocess) return false
			if (subprocess.exitCode !== null || subprocess.signalCode !== null) return false

			if (!this.#wanted) {
				await this.#halt()
				return this.#stopped()
			}

			try {
				const response = await fetch(`${this.#endpoints.api}/v3/paths/list`, { signal: AbortSignal.timeout(CONTROL_TIMEOUT) })

				if (response.ok) {
					await response.body?.cancel()

					if (!this.#wanted) {
						await this.#halt()
						return this.#stopped()
					}

					this.#set('ready')
					this.#timer = setTimeout(() => (this.#restarts = 0), STABLE_TIME)
					this.options.listener.started()
					return true
				}
			} catch {
				// Not listening yet.
			}

			await Bun.sleep(PROBE_INTERVAL)
		}

		await this.#halt()
		return this.#fail('unavailable', 'readinessTimeout')
	}

	// Runs the executable with --version: its version, undefined when the output has none, or why it cannot run.
	async #version(executable: string): Promise<readonly [number, number, number] | 'missing' | 'notExecutable' | undefined> {
		try {
			const command = this.options.command?.(executable, ['--version']) ?? [executable, '--version']
			const subprocess = Bun.spawn(command, { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore', env: inheritedEnvironment(), timeout: VERSION_TIMEOUT })
			const output = await new Response(subprocess.stdout).text()
			await subprocess.exited
			return parseVersion(output)
		} catch (error) {
			const code = (error as { code?: string }).code
			return code === 'ENOENT' ? 'missing' : 'notExecutable'
		}
	}

	// Reads the output of the process line by line, classifying the errors of the camera sources.
	async #read(stream: ReadableStream<Uint8Array>) {
		const decoder = new TextDecoder()
		let pending = ''

		try {
			for await (const chunk of stream) {
				pending += decoder.decode(chunk, { stream: true })
				const lines = pending.split(/\r?\n/)
				pending = lines.pop() ?? ''
				for (const line of lines) this.#line(line)
			}
		} catch {
			// The process ended.
		}
	}

	// Handles a line of the output of the process.
	#line(line: string) {
		if (/address already in use|only one usage of each socket address/i.test(line)) this.#bindFailed = true
		const source = classifyLine(line)
		if (source) this.options.listener.sourceChanged(source.cameraId, source.code)
	}

	// Handles the exit of a process: an exit nobody asked for is followed by a restart while restarts remain.
	#exited(subprocess: Bun.Subprocess) {
		if (this.#process !== subprocess) return
		void this.#cleanup()
		this.options.listener.exited()

		const status = this.#state.status
		if (status === 'stopping' || status === 'stopped') return

		const code: GatewayCode = this.#bindFailed ? 'bindFailed' : 'exited'

		if (!this.#wanted || this.#bindFailed || this.#restarts >= MAX_RESTARTS) {
			this.#fail('unavailable', code)
			return
		}

		const delay = RESTART_DELAYS[this.#restarts++]
		this.#set('restarting', code)
		this.#timer = setTimeout(() => {
			this.#timer = undefined
			if (this.#state.status !== 'restarting') return
			this.#set('stopped')
			void this.ensure(this.#wanted)
		}, delay)
	}

	// Forgets the running process and removes its working directory.
	async #cleanup() {
		const directory = this.#directory
		this.#process = undefined
		this.#endpoints = undefined
		this.#directory = undefined
		this.#epoch = undefined
		if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
	}

	// Ends the running process: asks it to exit, then kills it after STOP_TIMEOUT.
	async #halt() {
		clearTimeout(this.#timer)
		this.#timer = undefined
		const subprocess = this.#process
		if (!subprocess) return

		this.#set('stopping')
		subprocess.kill()
		const exited = await Promise.race([subprocess.exited.then(() => true), Bun.sleep(STOP_TIMEOUT).then(() => false)])
		if (!exited) subprocess.kill('SIGKILL')
		await subprocess.exited
		if (this.#process === subprocess) {
			await this.#cleanup()
			this.options.listener.exited()
		}
	}

	// Sets a failed state. Resolves false.
	#fail(status: 'notInstalled' | 'unavailable', code: GatewayCode) {
		this.#set(status, code)
		return false
	}

	// Sets the stopped state. Resolves false.
	#stopped() {
		this.#set('stopped')
		return false
	}

	// Stops the gateway and waits for its process to end. Never rejects.
	async stop(): Promise<void> {
		this.#wanted = false
		await this.#starting?.catch(() => false)
		await this.#halt()
		this.#restarts = 0
		this.#set('stopped')
	}

	// Kills the running process at once, without waiting; the last resort of a server being disposed.
	kill() {
		this.#wanted = false
		clearTimeout(this.#timer)
		this.#process?.kill('SIGKILL')
	}

	// Sends a request to the control API of the ready gateway. Rejects when it is not ready or does not answer.
	async #control(path: string, init?: RequestInit): Promise<Response> {
		const endpoints = this.#state.status === 'ready' ? this.#endpoints : undefined
		if (!endpoints) throw new Error('The gateway is not ready')
		return await fetch(`${endpoints.api}${path}`, { ...init, signal: AbortSignal.timeout(CONTROL_TIMEOUT) })
	}

	// Lists the names of the camera paths configured in the gateway.
	async cameraPaths(): Promise<string[]> {
		const names: string[] = []

		for (let page = 0; ; page++) {
			const response = await this.#control(`/v3/config/paths/list?page=${page}&itemsPerPage=100`)
			if (!response.ok) throw new Error(`The gateway refused the list of paths (${response.status})`)
			const { items, pageCount } = (await response.json()) as { readonly items: readonly { readonly name: string }[]; readonly pageCount: number }
			for (const { name } of items) if (name.startsWith(CAMERA_PATH_PREFIX)) names.push(name)
			if (page + 1 >= pageCount) return names
		}
	}

	// Configures the path of a camera, adding or replacing it. Rejects when the gateway refuses it.
	async setPath(cameraId: string, config: GatewayPathConfig, exists: boolean): Promise<void> {
		const name = encodeURIComponent(cameraPathName(cameraId))
		const response = await this.#control(`/v3/config/paths/${exists ? 'replace' : 'add'}/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pathConfiguration(config)) })
		await response.body?.cancel()
		if (!response.ok) throw new Error(`The gateway refused the path of a camera (${response.status})`)
	}

	// Removes a camera path by name; a path already gone is not an error.
	async deletePath(name: string): Promise<void> {
		const response = await this.#control(`/v3/config/paths/delete/${encodeURIComponent(name)}`, { method: 'DELETE' })
		await response.body?.cancel()
		if (!response.ok && response.status !== 404) throw new Error(`The gateway refused to remove a path (${response.status})`)
	}

	// Returns the runtime state of the path of a camera, undefined when the gateway has none.
	async pathState(cameraId: string): Promise<GatewayPathState | undefined> {
		const response = await this.#control(`/v3/paths/get/${encodeURIComponent(cameraPathName(cameraId))}`)
		if (!response.ok) {
			await response.body?.cancel()
			return undefined
		}
		const { available, readers } = (await response.json()) as { readonly available: boolean; readonly readers: readonly unknown[] }
		return { available, readers: readers.length }
	}

	// Lists the ids of the WebRTC sessions of the gateway.
	async webrtcSessions(): Promise<Set<string>> {
		const ids = new Set<string>()

		for (let page = 0; ; page++) {
			const response = await this.#control(`/v3/webrtc/sessions/list?page=${page}&itemsPerPage=100`)
			if (!response.ok) throw new Error(`The gateway refused the list of sessions (${response.status})`)
			const { items, pageCount } = (await response.json()) as { readonly items: readonly { readonly id: string }[]; readonly pageCount: number }
			for (const { id } of items) ids.add(id)
			if (page + 1 >= pageCount) return ids
		}
	}

	// Ends a WebRTC session of the gateway; one already gone is not an error.
	async kickSession(id: string): Promise<void> {
		const response = await this.#control(`/v3/webrtc/sessions/kick/${encodeURIComponent(id)}`, { method: 'POST' })
		await response.body?.cancel()
	}
}
