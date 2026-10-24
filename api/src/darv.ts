import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { MountCommander } from 'nebulosa/src/devices/commanders/mount'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import { type OperationFailureReason, type OperationHandle, type OperationResult, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { abortableDelay } from 'nebulosa/src/devices/orchestration/operation.wait'
import { type ResourceRequest, resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { numericKeyword } from 'nebulosa/src/io/formats/fits/util'
import { type DarvExposureMode, darvExposureTime } from 'nebulosa/src/observation/alignment/polaralignment.darv'
import { type DarvRunEvent, type DarvRunPhase, type DarvRunTiming, runDarv } from 'nebulosa/src/observation/alignment/polaralignment.darv.runner'
import type { PolarAlignmentDirection } from 'nebulosa/src/observation/alignment/polaralignment.geometry'
import { polarAlignmentMountRefusal } from 'nebulosa/src/observation/alignment/polaralignment.runner'
import type { CameraCapturer } from 'nebulosa/src/observation/capture/capture'
import { SYSTEM_CAMERA_CAPTURE_CLOCK } from 'nebulosa/src/observation/capture/types'
import { type CaptureFrameRegistry, captureFrameId } from './captureframes'
import type { CaptureFrame, CaptureSettings } from './captures'
import { busy, type ClientResolver, type CommandRequest, connectedDevice, unsupported } from './commands'
import type { DarvAnalyzer, DarvMeasurementResult, DarvTrail } from './darv.analysis'
import type { DeviceRegistry } from './devices'
import { errorResponse } from './http'
import type { ImageStore } from './images'
import type { OperationDevice, OperationRegistry } from './operations'

// DARV service: drift alignment for one camera and one mount, as a session of measurements the operator repeats
// while adjusting the mount by hand. Each measurement is its own `mount.darv` operation of the process-wide registry,
// holding the camera and the mount only while the toolkit's runner exposes one frame across the outbound and return
// RA motions; between measurements the devices are free, so the session never blocks the mount while the operator
// works on it. The runner owns the slew rate, the timing, and the motions; this service adapts the shared services
// to it (the mount commander of the mount commands, the camera capturer of the capture service, one auxiliary FITS in
// a temporary directory deleted with the measurement, never saved as a capture), decodes the frame into the image
// store, and records it in the capture frame registry as the latest frame of its camera (origin darv), which owns
// its closing. A measurement starts the tracking of a mount that is not tracking before the runner, and the tracking
// stays on between measurements until the finish, which stops it when the operator asks for it and the mount is free.
// Once the devices are released, the slew-rate preset the runner replaced is restored if the mount is free, and the
// frame is analyzed on a worker without a sky transform, so the drift is unsigned and in pixels per
// second, never a polar error. A session belongs to the server: it survives tab reloads and workspace changes.
// Durations are seconds, instants Unix milliseconds. Records live in memory, the latest session per camera.

// Settings of the frame of a measurement; its exposure is derived from the leg duration, and its type is LIGHT.
export type DarvCaptureSettings = Pick<CaptureSettings, 'gain' | 'offset' | 'binX' | 'binY' | 'subframe' | 'x' | 'y' | 'width' | 'height' | 'frameFormat'>

// Body of POST /api/darv/:sessionId/measurements: the settings of one measurement.
export interface DarvMeasurementRequest extends CommandRequest {
	// Camera settings of the frame.
	readonly capture: DarvCaptureSettings
	// Knob the operator is adjusting; it only orients the operator, the measurement is the same.
	readonly axis: DarvExposureMode
	// Direction of the outbound RA motion.
	readonly direction: PolarAlignmentDirection
	// Name of the slew-rate preset of the motions; one the mount announces.
	readonly slewRate: string
	// Duration of each RA motion, in seconds.
	readonly legDuration: number
}

// Body of POST /api/connections/:id/cameras/:deviceId/darv: the mount of the session and its first measurement.
export interface DarvRequest extends DarvMeasurementRequest {
	// Mount to move, by its exact connection and device ids; it is snooped into every frame.
	readonly mount: OperationDevice
}

// Body of POST /api/darv/:sessionId/finish.
export interface DarvFinishRequest {
	// Whether the tracking a measurement of the session started is stopped; false leaves it on.
	readonly stopTracking: boolean
}

// What a measurement is doing:
// - preparing: the measurement is acquiring the devices, starting the tracking, and applying the slew rate.
// - exposing: the exposure started; the stars stand still before the outbound motion.
// - outbound: the mount moves in the requested direction.
// - reversing: the mount stops before moving back.
// - inbound: the mount moves back.
// - finishing: the mount stopped; the exposure ends and the frame is read.
// - analyzing: the devices are free and the frame is analyzed.
// - ready: the frame and its analysis are available; it says nothing about the alignment being right.
// - failed: the measurement ended because of an error, given in reason and error.
// - aborted: the measurement was aborted; no frame of an incomplete sequence is kept.
export type DarvMeasurementState = DarvRunPhase | 'preparing' | 'analyzing' | 'ready' | 'failed' | 'aborted'

// What a session is doing:
// - measuring: a measurement is running.
// - idle: waiting for the operator to repeat the measurement or finish.
// - finished: the operator finished the session.
export type DarvSessionState = 'measuring' | 'idle' | 'finished'

// One measurement of a session.
export interface DarvMeasurement {
	// Number of the measurement within its session, from 1.
	readonly generation: number
	// Id of the operation holding the camera and the mount.
	readonly operationId: string
	// Settings the measurement ran with.
	readonly request: Omit<DarvMeasurementRequest, 'token'>
	// What the measurement is doing.
	readonly state: DarvMeasurementState
	// Requested exposure, in seconds.
	readonly exposure: number
	// Instant the exposure was requested, Unix milliseconds (UTC); the progress of the measurement runs from it.
	readonly exposureStartedAt?: number
	// Timing measured by the runner, in seconds.
	readonly timing?: DarvRunTiming
	// Id of the frame in the capture frame registry.
	readonly frameId?: string
	// Id of the capture document of the frame; open while it is the latest frame of its camera or leased.
	readonly imageId?: string
	// Analysis of the frame, without its trails.
	readonly result?: DarvMeasurementResult
	// Slew-rate preset the mount used before the measurement changed it; absent when it reported none.
	readonly previousSlewRate?: string
	// Whether the previous preset was restored; absent before the operation ended or with nothing to restore.
	readonly slewRateRestored?: boolean
	// Why the measurement failed.
	readonly reason?: OperationFailureReason
	// Detail of the failure or of a problem meant for people.
	readonly error?: string
	// Instant the measurement started, Unix milliseconds (UTC).
	readonly startedAt: number
	// Instant the measurement ended, Unix milliseconds (UTC).
	readonly endedAt?: number
}

// Session record published to clients, without the trails of its measurements.
export interface DarvSessionSummary {
	// Id of the session.
	readonly sessionId: string
	// Camera taking the frames.
	readonly camera: OperationDevice
	// Name of the camera.
	readonly cameraName: string
	// Mount being moved.
	readonly mount: OperationDevice
	// Name of the mount.
	readonly mountName: string
	// What the session is doing.
	readonly state: DarvSessionState
	// Measurements, oldest first; the latest MAXIMUM_MEASUREMENTS.
	readonly measurements: readonly DarvMeasurement[]
	// Whether a measurement of the session started the tracking of a mount that was not tracking, which stays on until
	// the session is finished; absent when the mount was already tracking.
	readonly trackingStarted?: boolean
	// Whether the finish stopped the tracking the session started; absent before the finish, when the session started
	// none, or when the finish asked to leave it on.
	readonly trackingStopped?: boolean
	// Instant the session started, Unix milliseconds (UTC).
	readonly startedAt: number
	// Instant the session was finished, Unix milliseconds (UTC).
	readonly endedAt?: number
	// Number of changes published so far; increases with every change.
	readonly revision: number
}

// Trails of an analyzed measurement.
export interface DarvMeasurementTrails {
	// Number of the measurement.
	readonly generation: number
	// Id of the capture document of its frame.
	readonly imageId?: string
	// Paired trails, in 0-based pixels of the frame.
	readonly trails: readonly DarvTrail[]
}

// Complete session record.
export interface DarvSession extends DarvSessionSummary {
	// Trails of the analyzed measurements, oldest first.
	readonly trails: readonly DarvMeasurementTrails[]
}

// Snapshot of GET /api/darv: the latest session of every camera.
export interface DarvSnapshot {
	readonly sessions: readonly DarvSessionSummary[]
}

// Response of an accepted measurement.
export interface DarvStartResponse {
	// Id of the session, repeated by its darv:updated events.
	readonly sessionId: string
	// Id of the operation of the measurement.
	readonly operationId: string
	// Number of the measurement within its session.
	readonly generation: number
}

// Notification published whenever a session changes.
export type DarvEvent = { readonly type: 'darv:updated'; readonly session: DarvSessionSummary }

// Receiver of DARV events.
export type DarvListener = (event: DarvEvent) => void

// Measurements kept per session, the latest ones.
const MAXIMUM_MEASUREMENTS = 50

// A measurement while its session knows it.
interface Measurement {
	readonly generation: number
	// Operation holding the devices; absent only before it started.
	handle?: OperationHandle<string>
	// Aborts the analysis of the frame.
	analysis?: AbortController
	// Whether the operator aborted it, which also skips an analysis that did not start yet.
	aborted?: boolean
}

// A session while its service knows it.
interface Session {
	summary: DarvSessionSummary
	readonly trails: DarvMeasurementTrails[]
	// Measurement running, from its start until its analysis ended.
	running?: Measurement
	// Whether the finish is stopping the tracking, during which no measurement starts.
	finishing?: boolean
}

// DARV sessions of the cameras of every open connection.
export class DarvSessions {
	// Latest session of each camera, by camera resource key.
	readonly #sessions = new Map<string, Session>()
	// Session and measurement of each operation a command token started, so a repeated request answers it.
	readonly #byOperation = new Map<string, { readonly session: Session; readonly generation: number }>()

	// Creates the service. client resolves an open connection id to its client, operations holds and publishes every
	// measurement, commander moves the mounts (the one of the mount commands), capturer takes the frames (the one of
	// the capture service), images receives the frames, frames records them as the latest frame of their camera and
	// closes them, analyzer measures them, and listener receives every session change synchronously. auxiliaryDir is
	// the parent of the temporary directory of each measurement.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
		readonly commander: MountCommander,
		readonly capturer: CameraCapturer,
		readonly images: ImageStore,
		readonly frames: CaptureFrameRegistry,
		readonly analyzer: Pick<DarvAnalyzer, 'analyze'>,
		readonly listener: DarvListener,
		readonly auxiliaryDir: string = tmpdir(),
	) {}

	// Returns the latest session of every camera.
	snapshot(): DarvSnapshot {
		return { sessions: Array.from(this.#sessions.values(), (session) => session.summary) }
	}

	// Responds with a complete session, or 404 when it is not the latest of its camera.
	session(sessionId: string): Response {
		const session = this.#find(sessionId)
		return session ? Response.json(this.#complete(session)) : errorResponse('DARV session not found', 404, 'notFound')
	}

	// Starts a session and its first measurement, replacing the idle or finished session of the camera. Responds 202
	// with DarvStartResponse once accepted (a repeated token answers its first measurement); progress and outcome
	// arrive as darv:updated and operation:updated events. Responds 404 for an unknown camera or mount, 409 when
	// either is disconnected or held by another operation or the camera's session is measuring, and 422 when the
	// mount cannot run DARV (not equatorial, no west-east motion or abort, no such slew rate, parked, not tracking
	// and unable to switch tracking, or tracking at another rate than sidereal).
	start(connectionId: string, deviceId: string, request: DarvRequest): Response {
		const repeated = this.#repeated(request.token)
		if (repeated) return repeated

		const camera = connectedDevice(this, connectionId, 'camera', deviceId, 'Camera')
		if (camera instanceof Response) return camera
		const mount = connectedDevice(this, request.mount.connectionId, 'mount', request.mount.deviceId, 'Mount')
		if (mount instanceof Response) return mount

		const key = resourceKey(camera)
		const previous = this.#sessions.get(key)
		if (previous?.running || previous?.finishing) return errorResponse('A DARV measurement or finish is running on this camera', 409, 'busy')

		const refused = this.#refusal(camera, mount, request.slewRate)
		if (refused) return refused

		const { mount: mountDevice, ...measurement } = request
		// An open session replaced on the same mount hands over the tracking it started, so the finish of the new one
		// still stops it.
		const inherited = previous?.summary.trackingStarted === true && previous.summary.state !== 'finished' && previous.summary.mount.connectionId === mountDevice.connectionId && previous.summary.mount.deviceId === mountDevice.deviceId
		const session: Session = {
			summary: { sessionId: crypto.randomUUID(), camera: { connectionId, deviceId }, cameraName: camera.name, mount: mountDevice, mountName: mount.name, state: 'idle', measurements: [], ...(inherited && { trackingStarted: true }), startedAt: Date.now(), revision: 0 },
			trails: [],
		}

		if (previous) this.#forget(previous)
		this.#sessions.set(key, session)
		return this.#measure(session, camera, mount, measurement)
	}

	// Starts another measurement of a session, with settings that may differ from the previous one. Responds 202 with
	// DarvStartResponse (a repeated token answers its measurement), 404 when the session is unknown or finished, 409
	// when it is measuring or a device is disconnected or busy, and 422 when the mount cannot run DARV.
	repeat(sessionId: string, request: DarvMeasurementRequest): Response {
		const repeated = this.#repeated(request.token)
		if (repeated) return repeated

		const session = this.#find(sessionId)
		if (!session || session.summary.state === 'finished') return errorResponse('No DARV session is open with this id', 404, 'notFound')
		if (session.running || session.finishing) return errorResponse('A DARV measurement or finish is running in this session', 409, 'busy')

		const { camera: cameraDevice, mount: mountDevice } = session.summary
		const camera = connectedDevice(this, cameraDevice.connectionId, 'camera', cameraDevice.deviceId, 'Camera')
		if (camera instanceof Response) return camera
		const mount = connectedDevice(this, mountDevice.connectionId, 'mount', mountDevice.deviceId, 'Mount')
		if (mount instanceof Response) return mount

		const refused = this.#refusal(camera, mount, request.slewRate)
		if (refused) return refused
		return this.#measure(session, camera, mount, request)
	}

	// Aborts the measurement of a session wherever it stands: the motion and the exposure are stopped, or the analysis
	// is cancelled. Resolves once the devices were released. Responds 204, 404 when the session is unknown, and 409
	// when it is not measuring.
	async abort(sessionId: string): Promise<Response> {
		const session = this.#find(sessionId)
		if (!session) return errorResponse('DARV session not found', 404, 'notFound')
		const running = session.running
		if (!running) return errorResponse('The DARV session is not measuring', 409, 'busy')

		running.aborted = true
		running.analysis?.abort(new Error('The DARV analysis was aborted'))
		await running.handle?.cancel('aborted')
		return new Response(null, { status: 204 })
	}

	// Finishes an idle session, stopping the tracking its measurements started when the request asks for it and the
	// mount is free; trackingStopped reports whether it was. Responds 204, 404 when the session is unknown or already
	// finished, and 409 when it is measuring.
	async finish(sessionId: string, request: DarvFinishRequest): Promise<Response> {
		const session = this.#find(sessionId)
		if (!session || session.summary.state === 'finished') return errorResponse('No DARV session is open with this id', 404, 'notFound')
		if (session.running || session.finishing) return errorResponse('A DARV measurement or finish is running in this session', 409, 'busy')

		let trackingStopped: boolean | undefined

		if (session.summary.trackingStarted && request.stopTracking) {
			// The mount is free between measurements, so stopping takes it for itself; another operation that holds it, or
			// a disconnection, leaves the tracking on.
			const { connectionId, deviceId } = session.summary.mount
			const client = this.client(connectionId)
			const mount = client && this.devices.mount(client, deviceId)
			session.finishing = true
			trackingStopped = mount !== undefined && (!mount.tracking || (mount.connected && this.operations.available(mount) && (await this.commander.setTracking(this.operations.coordinator, mount, false)).ok))
			session.finishing = false
		}

		this.#update(session, { state: 'finished', endedAt: Date.now(), ...(trackingStopped !== undefined && { trackingStopped }) })
		return new Response(null, { status: 204 })
	}

	// Answers the measurement a token already started, or undefined.
	#repeated(token: string): Response | undefined {
		const known = this.operations.started(token)
		const repeated = known && this.#byOperation.get(known.operationId)
		if (!repeated) return undefined
		return Response.json({ sessionId: repeated.session.summary.sessionId, operationId: known.operationId, generation: repeated.generation } satisfies DarvStartResponse, { status: 202 })
	}

	// Responds 422 when the mount cannot run DARV at slewRate, or 409 when a device is held; undefined when both can. A
	// mount that is not tracking is accepted when it can switch tracking, which the measurement starts.
	#refusal(camera: Camera, mount: Mount, slewRate: string): Response | undefined {
		const refused = polarAlignmentMountRefusal(mount.tracking || !mount.canTracking ? mount : { ...mount, tracking: true }, slewRate)
		if (refused) return unsupported(refused)
		if (!this.operations.available(camera) || !this.operations.available(mount)) return busy()
		return undefined
	}

	// Starts a measurement of a session in an operation holding its camera and mount, and follows its end.
	#measure(session: Session, camera: Camera, mount: Mount, { token, ...request }: DarvMeasurementRequest): Response {
		const generation = (session.summary.measurements.at(-1)?.generation ?? 0) + 1
		const running: Measurement = { generation }
		const record = this.operations.run('mount.darv', [session.summary.camera, session.summary.mount], token, () => {
			const handle = this.#run(session, generation, camera, mount, request)
			running.handle = handle
			return handle.result
		})

		const measurement: DarvMeasurement = { generation, operationId: record.operationId, request, state: 'preparing', exposure: darvExposureTime(request.legDuration), startedAt: Date.now() }
		const measurements = [...session.summary.measurements, measurement]
		while (measurements.length > MAXIMUM_MEASUREMENTS) this.#drop(session, measurements.shift()!)

		session.running = running
		this.#byOperation.set(record.operationId, { session, generation })
		this.#update(session, { state: 'measuring', measurements })

		void running.handle!.result.then((result) => this.#ended(session, running, mount, result))
		return Response.json({ sessionId: session.summary.sessionId, operationId: record.operationId, generation } satisfies DarvStartResponse, { status: 202 })
	}

	// Starts the operation of a measurement, which runs the runner and decodes the frame into the image store before
	// releasing the devices. Resolves the id of the capture document.
	#run(session: Session, generation: number, camera: Camera, mount: Mount, request: Omit<DarvMeasurementRequest, 'token'>): OperationHandle<string> {
		const resources: ResourceRequest[] = [
			{ key: resourceKey(camera), device: camera },
			{ key: resourceKey(mount), device: mount },
		]

		return this.operations.coordinator.start<string>('darvMeasurement', resources, async (context) => {
			const directory = await mkdtemp(join(this.auxiliaryDir, 'nebulosa-darv-'))

			try {
				// A drift measured on a mount that does not track is the sidereal motion, so the tracking is started first.
				if (!mount.tracking) {
					const started = await this.commander.setTracking(context, mount, true)
					if (!started.ok) return started
					this.#update(session, { trackingStarted: true })
				}

				const path = join(directory, `darv-${generation}.fit`)
				const result = await runDarv(
					context,
					mount,
					camera,
					{ direction: request.direction, slewRate: request.slewRate, legDuration: request.legDuration, capture: { ...request.capture, compressed: false } },
					{ mountCommander: this.commander, cameraCapturer: this.capturer, clock: { ...SYSTEM_CAMERA_CAPTURE_CLOCK, delay: abortableDelay }, framePath: path, listener: (event) => this.#progress(session, generation, event) },
				)

				if (!result.ok) return result

				const { sessionId, camera: device, cameraName } = session.summary
				const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
				const time = Date.now()
				const frameId = captureFrameId(sessionId, generation)
				const info = await this.images.openCapture(bytes, `darv-${generation}.fit`, { ...device, frameId, time })
				const { width, height, channels, cfa, acquisition } = info
				const bitpix = numericKeyword<number, undefined>(info.header, 'BITPIX', undefined)
				const record: CaptureFrame = { imageId: info.id, sessionId, ...device, generation, time, frameType: 'LIGHT', width, height, channels, cfa, bitpix, acquisition }
				this.frames.previewed(info, record, cameraName, 'darv')
				this.#patch(session, generation, { timing: result.value.timing, frameId, imageId: info.id })
				return successfulOperationResult(info.id)
			} finally {
				await rm(directory, { recursive: true, force: true })
			}
		})
	}

	// Follows the progress the runner reports.
	#progress(session: Session, generation: number, event: DarvRunEvent) {
		if (event.type === 'slewRate') this.#patch(session, generation, { previousSlewRate: event.previous })
		else this.#patch(session, generation, { state: event.phase, ...(event.phase === 'exposing' && { exposureStartedAt: Date.now() }) })
	}

	// Records the end of the operation of a measurement, restores the slew rate it replaced, and analyzes its frame.
	async #ended(session: Session, running: Measurement, mount: Mount, result: OperationResult<string>) {
		const { generation } = running

		if (!result.ok) {
			const state = result.reason === 'aborted' ? 'aborted' : 'failed'
			this.#patch(session, generation, { state, ...(state === 'failed' && { reason: result.reason }), ...(result.error !== undefined && { error: result.error }), endedAt: Date.now() })
		}

		await this.#restore(session, generation, mount)

		if (result.ok && running.aborted) {
			this.#patch(session, generation, { state: 'aborted', endedAt: Date.now() })
		} else if (result.ok) {
			const imageId = result.value
			const measurement = this.#measurement(session, generation)
			const analysis = new AbortController()
			running.analysis = analysis
			this.#patch(session, generation, { state: 'analyzing' })
			// The analysis retains the document, so a newer frame of the camera cannot pull it away meanwhile.
			const retained = this.images.retain(imageId) !== undefined

			try {
				const analyzed = await this.analyzer.analyze(imageId, measurement!.timing!, measurement!.request.direction, analysis.signal)
				const { trails, ...summary } = analyzed
				session.trails.push({ generation, imageId, trails })
				this.#patch(session, generation, { state: 'ready', result: summary, endedAt: Date.now() })
			} catch (error) {
				if (analysis.signal.aborted) this.#patch(session, generation, { state: 'aborted', endedAt: Date.now() })
				else this.#patch(session, generation, { state: 'failed', reason: 'commandFailed', error: Error.isError(error) ? error.message : String(error), endedAt: Date.now() })
			} finally {
				if (retained) this.images.release(imageId)
			}
		}

		session.running = undefined
		if (session.summary.state === 'measuring') this.#update(session, { state: 'idle' })
	}

	// Restores the slew-rate preset a measurement replaced, if the mount is free.
	async #restore(session: Session, generation: number, mount: Mount) {
		const previous = this.#measurement(session, generation)?.previousSlewRate
		if (previous === undefined || mount.slewRate === previous) return

		// The operation released the mount, so the restoration takes it again for itself; another operation that took
		// it first, or a disconnection, leaves the preset changed.
		const restored = mount.connected && this.operations.available(mount) ? await this.commander.setSlewRate(this.operations.coordinator, mount, previous) : undefined
		this.#patch(session, generation, { slewRateRestored: restored?.ok === true })
	}

	// Forgets a measurement dropped from the history of its session.
	#drop(session: Session, measurement: DarvMeasurement) {
		this.#byOperation.delete(measurement.operationId)
		const index = session.trails.findIndex((trails) => trails.generation === measurement.generation)
		if (index >= 0) session.trails.splice(index, 1)
	}

	// Forgets a session replaced by a newer one of its camera; its latest frame stays with the registry.
	#forget(session: Session) {
		for (const measurement of session.summary.measurements) this.#byOperation.delete(measurement.operationId)
	}

	// Returns the latest session with this id.
	#find(sessionId: string): Session | undefined {
		for (const session of this.#sessions.values()) if (session.summary.sessionId === sessionId) return session
		return undefined
	}

	// Returns a measurement of a session by its number.
	#measurement(session: Session, generation: number) {
		return session.summary.measurements.find((measurement) => measurement.generation === generation)
	}

	// Returns the complete record of a session.
	#complete(session: Session): DarvSession {
		return { ...session.summary, trails: session.trails }
	}

	// Changes a measurement of a session and publishes the session.
	#patch(session: Session, generation: number, patch: Partial<DarvMeasurement>) {
		this.#update(session, { measurements: session.summary.measurements.map((measurement) => (measurement.generation === generation ? { ...measurement, ...patch } : measurement)) })
	}

	// Publishes a changed session with the next revision; a session replaced by a newer one of its camera changes
	// silently.
	#update(session: Session, patch: Partial<DarvSessionSummary>) {
		session.summary = { ...session.summary, ...patch, revision: session.summary.revision + 1 }
		const latest = Array.from(this.#sessions.values()).includes(session)
		if (latest) this.listener({ type: 'darv:updated', session: session.summary })
	}
}

// Routes of the DARV sessions.
export function createDarvRoutes(darv: DarvSessions) {
	return {
		'/api/darv': {
			// The latest DARV session of every camera, started by any tab, without the trails of its measurements.
			GET: () => Response.json(darv.snapshot()),
		},
		'/api/darv/:sessionId': {
			// A DARV session with the trails of its analyzed measurements; 404 when it is not the latest of its camera.
			GET: (req) => darv.session(req.params.sessionId),
		},
		'/api/darv/:sessionId/measurements': {
			// Starts another measurement of an idle DARV session.
			POST: async (req) => darv.repeat(req.params.sessionId, (await req.json()) as DarvMeasurementRequest),
		},
		'/api/darv/:sessionId/abort': {
			// Aborts the measurement of a DARV session; the mount is stopped and the exposure discarded.
			POST: (req) => darv.abort(req.params.sessionId),
		},
		'/api/darv/:sessionId/finish': {
			// Finishes an idle DARV session, stopping the tracking it started when asked.
			POST: async (req) => darv.finish(req.params.sessionId, (await req.json()) as DarvFinishRequest),
		},
		'/api/connections/:id/cameras/:deviceId/darv': {
			// Starts a DARV session with this camera and its first measurement; progress arrives as darv:updated events.
			POST: async (req) => darv.start(req.params.id, req.params.deviceId, (await req.json()) as DarvRequest),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
