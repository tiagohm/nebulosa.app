import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { geodeticLocation } from 'nebulosa/src/astronomy/observer/location'
import { timeToUnixMillis } from 'nebulosa/src/astronomy/time/time'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import type { MountCommander } from 'nebulosa/src/devices/commanders/mount'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import { failedOperationResult, type OperationFailureReason, type OperationHandle, type OperationResult, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { abortableDelay } from 'nebulosa/src/devices/orchestration/operation.wait'
import { type ResourceRequest, resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { numericKeyword } from 'nebulosa/src/io/formats/fits/util'
import type { ThreePointPolarAlignment, ThreePointPolarAlignmentInput, ThreePointPolarAlignmentResult } from 'nebulosa/src/observation/alignment/polaralignment'
import { DEFAULT_POLAR_ALIGNMENT_GEOMETRY_LIMITS, type PolarAlignmentDirection, type PolarAlignmentGeometryQuality, type PolarAlignmentGeometryRejection } from 'nebulosa/src/observation/alignment/polaralignment.geometry'
import { computeThreePointPolarAlignmentOverlay, type ThreePointPolarAlignmentOverlay, type ThreePointPolarAlignmentOverlayFailureReason } from 'nebulosa/src/observation/alignment/polaralignment.overlay'
// oxfmt-ignore
import { acquireThreePointPolarAlignment, refineThreePointPolarAlignment, type ThreePointPolarAlignmentEvent, type ThreePointPolarAlignmentFrame, type ThreePointPolarAlignmentServices } from 'nebulosa/src/observation/alignment/polaralignment.runner'
import type { CameraCapturer } from 'nebulosa/src/observation/capture/capture'
import { type CameraCaptureTime, SYSTEM_CAMERA_CAPTURE_CLOCK } from 'nebulosa/src/observation/capture/types'
import type { CenteringCaptureOptions } from 'nebulosa/src/observation/mount/centering'
import { type CaptureFrameRegistry, captureFrameId } from './captureframes'
import { type CaptureFrame, type CaptureSettings, exposureProgressListener, listenedCapturer } from './captures'
import { busy, type ClientResolver, type CommandRequest, connectedDevice, unsupported } from './commands'
import type { DeviceRegistry } from './devices'
import { errorResponse } from './http'
import type { ImageStore } from './images'
import type { OperationDevice, OperationRegistry } from './operations'
import type { PlateSolvePreparation, PlateSolveRequest, PlateSolverProvider, PlateSolvingService } from './platesolving'

// TPPA service: runs the toolkit's automatic three-point polar alignment for one camera and one mount inside a
// single operation of the process-wide registry, which holds both devices from the first frame until the session
// ends, so no GoTo, nudge, or capture can come between the poses or the refinement frames. The runner owns the timed
// RA motions at the requested slew-rate preset, the acceptance of each pose from its solve, the geometry check, and
// the alignment; this service adapts the shared services to it: the mount commander of the mount commands, the
// camera capturer of the capture service (auxiliary FITS frames in a temporary directory, deleted after each solve,
// never saved as captures), and the plate solving service, whose provider settings are resolved once when the session
// starts. Each frame is decoded into the image store and recorded in the capture frame registry as the latest frame
// of its camera (origin tppa) before it is solved; the registry owns its closing.
//
// After the three poses the session waits for the operator to start the refinement, which captures and solves
// without commanding the mount and follows the knob adjustments; it can be paused and resumed while the session keeps
// the devices. The overlay of every solved estimate is computed here from the toolkit's overlay geometry, referenced
// to the center of the third pose. A session belongs to the server: it survives tab reloads and workspace changes,
// and is stopped only by its stop route, an Equipment Control stop of its camera or mount, or a disconnection. When it
// starts, the tracking of a mount that is not tracking is started; when it ends, the slew-rate preset it replaced is
// restored and the tracking it started is stopped if the mount is free; otherwise the session says it was not. The
// progress of the frame being exposed is published as the driver reports it.
// Angles are radians, durations seconds, instants Unix milliseconds. Records live in memory, the latest per camera.

// Settings of the frames of a session; the exposure in seconds. The frame type is always LIGHT.
export type TppaCaptureSettings = Pick<CaptureSettings, 'exposureTime' | 'gain' | 'offset' | 'binX' | 'binY' | 'subframe' | 'x' | 'y' | 'width' | 'height' | 'frameFormat'>

// Body of POST /api/connections/:id/cameras/:deviceId/tppa.
export interface TppaRequest extends CommandRequest {
	// Mount to rotate, by its exact connection and device ids; it is snooped into every frame.
	readonly mount: OperationDevice
	// Camera settings of every frame.
	readonly capture: TppaCaptureSettings
	// Plate solver of every frame, resolved once when the session starts.
	readonly solving: PlateSolveRequest
	// Direction of the RA motions.
	readonly direction: PolarAlignmentDirection
	// Name of the slew-rate preset of the motions; one the mount announces.
	readonly slewRate: string
	// RA rotation aimed at between consecutive poses, in radians.
	readonly rotation: number
	// Wait after the mount stopped and before each exposure, in seconds.
	readonly settleDelay: number
	// Wait before each refinement exposure, in seconds.
	readonly refinementDelay: number
}

// What a session is doing:
// - preparing: the session is acquiring the devices, starting the tracking, and applying the slew rate.
// - moving: the mount rotates in RA towards the next pose, then settles.
// - capturing: the camera takes a frame.
// - solving: the frame is being solved and judged.
// - readyToRefine: the three poses gave an estimate; the refinement has not started.
// - refining: refinement frames are taken and solved while the operator adjusts the knobs.
// - refinementPaused: the refinement is paused; the devices stay held.
// - stopping: a stop was requested and the session is ending.
// - completed: the session was stopped after an estimate.
// - failed: the session ended because of an error, given in reason and error.
// - cancelled: the session was stopped before an estimate.
export type TppaState = 'preparing' | 'moving' | 'capturing' | 'solving' | 'readyToRefine' | 'refining' | 'refinementPaused' | 'stopping' | 'completed' | 'failed' | 'cancelled'

// An accepted pose of the acquisition.
export interface TppaPoint {
	// Pose number, 1 to 3.
	readonly point: 1 | 2 | 3
	// Frame number within the session, from 1.
	readonly frame: number
	// ICRS right ascension of the solved center, in radians.
	readonly rightAscension: number
	// ICRS declination of the solved center, in radians.
	readonly declination: number
	// Midpoint of the exposure, Unix milliseconds (UTC).
	readonly time: number
	// Id of the capture document of the frame; open while it is the latest frame of its camera or leased.
	readonly imageId?: string
}

// A solved candidate for the second or third pose and how it was judged.
export interface TppaAttempt {
	// Pose being acquired.
	readonly point: 2 | 3
	// Frame number within the session, from 1.
	readonly frame: number
	// Rotation since the previous accepted pose, in radians, positive towards the west.
	readonly rotation: number
	// Rotation since the first pose, in radians, positive towards the west.
	readonly totalRotation: number
	// Great-circle separation from the previous accepted pose, in radians.
	readonly separation: number
	// Whether the candidate became the pose.
	readonly accepted: boolean
	// Why it was not, when rejected.
	readonly reason?: PolarAlignmentGeometryRejection
}

// Conditioning of the three accepted poses (radians, and the dimensionless area and quality).
export type TppaGeometry = PolarAlignmentGeometryQuality

// A polar alignment estimate.
export interface TppaAlignment {
	// Whether the estimate comes from the three poses or from a refinement frame.
	readonly stage: 'acquisition' | 'refinement'
	// Frame number of the solve it belongs to.
	readonly frame: number
	// Id of the capture document of that frame.
	readonly imageId?: string
	// Mount-pole azimuth error, in radians; positive sense per hemisphere.
	readonly azimuthError: number
	// Mount-pole altitude error, in radians; positive raises the pole in the north.
	readonly altitudeError: number
	// Great-circle distance between the mount pole and the refracted celestial pole, in radians.
	readonly totalError: number
	// Azimuth knob change inferred from the last refinement frame, in radians; 0 for the initial estimate.
	readonly azimuthAdjustment: number
	// Altitude knob change inferred from the last refinement frame, in radians; 0 for the initial estimate.
	readonly altitudeAdjustment: number
	// Midpoint of the exposure, Unix milliseconds (UTC).
	readonly time: number
}

// Correction guide of the latest estimate over its frame, in the continuous WCS pixel convention of the toolkit.
export interface TppaOverlay {
	// Id of the capture document of the frame the geometry belongs to.
	readonly imageId?: string
	// Frame number within the session.
	readonly frame: number
	// Geometry, absent when it could not be computed.
	readonly geometry?: ThreePointPolarAlignmentOverlay
	// Why it could not be computed.
	readonly failure?: ThreePointPolarAlignmentOverlayFailureReason
}

// Session record published to clients, without its poses, attempts, and overlay.
export interface TppaSessionSummary {
	// Id of the session.
	readonly sessionId: string
	// Id of the operation holding the camera and the mount.
	readonly operationId: string
	// Camera taking the frames.
	readonly camera: OperationDevice
	// Name of the camera.
	readonly cameraName: string
	// Mount being rotated.
	readonly mount: OperationDevice
	// Name of the mount.
	readonly mountName: string
	// Request the session runs with.
	readonly request: Omit<TppaRequest, 'token'>
	// Plate solver of every frame.
	readonly provider: PlateSolverProvider
	// What the session is doing.
	readonly state: TppaState
	// Pose being acquired, during acquisition.
	readonly point?: 1 | 2 | 3
	// Frames taken so far.
	readonly frameCount: number
	// Poses accepted so far.
	readonly pointCount: number
	// Conditioning of the three poses, once judged.
	readonly geometry?: TppaGeometry
	// Latest estimate.
	readonly alignment?: TppaAlignment
	// Refinement frames that updated the estimate.
	readonly refinementCount: number
	// Slew-rate preset the mount used before the session changed it; absent when it reported none.
	readonly previousSlewRate?: string
	// Whether the previous preset was restored when the session ended; absent before it ended or when there was
	// nothing to restore.
	readonly slewRateRestored?: boolean
	// Whether the session started the tracking of a mount that was not tracking; absent when it was already on.
	readonly trackingStarted?: boolean
	// Whether the tracking the session started was stopped again when it ended; absent before it ended or when it
	// started none.
	readonly trackingStopped?: boolean
	// Progress of the frame being exposed, as the driver reports it (times in microseconds, progress in percent);
	// absent outside an exposure and before the driver reported any.
	readonly exposure?: CameraCaptureTime
	// Problems meant for people, latest last, such as frames that did not solve.
	readonly warnings: readonly string[]
	// Why the session failed.
	readonly reason?: OperationFailureReason
	// Detail of the failure meant for people.
	readonly error?: string
	// Instant the session started, Unix milliseconds (UTC).
	readonly startedAt: number
	// Instant the session ended, Unix milliseconds (UTC).
	readonly endedAt?: number
	// Number of changes published so far; increases with every change.
	readonly revision: number
}

// Complete session record.
export interface TppaSession extends TppaSessionSummary {
	// Accepted poses, in order.
	readonly points: readonly TppaPoint[]
	// Solved candidates of the second and third poses, in order.
	readonly attempts: readonly TppaAttempt[]
	// Estimate of the three poses.
	readonly initialAlignment?: TppaAlignment
	// Correction guide of the latest estimate.
	readonly overlay?: TppaOverlay
}

// Snapshot of GET /api/tppa: the latest session of every camera.
export interface TppaSnapshot {
	readonly sessions: readonly TppaSessionSummary[]
}

// Response of an accepted session.
export interface TppaStartResponse {
	// Id of the session, repeated by its tppa:updated events.
	readonly sessionId: string
	// Id of the operation holding the camera and the mount.
	readonly operationId: string
}

// Notification published whenever a session changes.
export type TppaEvent = { readonly type: 'tppa:updated'; readonly session: TppaSessionSummary }

// Receiver of TPPA events.
export type TppaListener = (event: TppaEvent) => void

// Longest wait for one solve, queue included, in seconds; the provider's own timeout normally ends it first.
const SOLVE_TIMEOUT = 600

// Watchdog after an aborted solve before it is reported unresponsive, in seconds.
const SOLVE_ABORT_GRACE = 10

// First RA motion, in seconds, before the rotation rate of the preset is known.
const INITIAL_MOTION = 1

// Longest single RA motion, in seconds.
const MAXIMUM_MOTION = 60

// Captures allowed while looking for the second and for the third pose, each.
const MAXIMUM_ATTEMPTS = 12

// Consecutive refinement frames without solution tolerated before the session fails.
const MAXIMUM_REFINEMENT_FAILURES = 3

// Largest shift of the field between refinement frames, in radians (5°); knob adjustments stay well below it.
const MAXIMUM_REFINEMENT_SHIFT = 5 * DEG2RAD

// Warnings kept per session.
const MAXIMUM_WARNINGS = 20

// A session while its service knows it.
interface Session {
	summary: TppaSessionSummary
	readonly points: TppaPoint[]
	readonly attempts: TppaAttempt[]
	initialAlignment?: TppaAlignment
	overlay?: TppaOverlay
	// Mount of the session, for the restoration of its slew rate.
	readonly mount: Mount
	// Operation holding the devices; absent only before it started.
	handle?: OperationHandle<void>
	// Refinement in progress, cancelled by a pause.
	refinement?: OperationHandle<void>
	// Settles with true when the refinement is started, false when the session is stopped first.
	resume?: PromiseWithResolvers<boolean>
	// Frame being solved: its number and the document it was decoded into.
	frame?: { readonly number: number; readonly point?: 1 | 2 | 3; readonly time: number; imageId?: string; observedAt?: number }
	// Last solve fed to the alignment, the start of the next refinement.
	last?: ThreePointPolarAlignmentInput
	// Center of the third pose, the persistent reference of the overlay.
	reference?: { readonly rightAscension: number; readonly declination: number }
}

// TPPA sessions of the cameras of every open connection.
export class TppaSessions {
	// Latest session of each camera, by camera resource key.
	readonly #sessions = new Map<string, Session>()
	// Session of each operation a command token started, so a repeated start answers it.
	readonly #byOperation = new Map<string, Session>()

	// Creates the service. client resolves an open connection id to its client, operations holds and publishes every
	// session, commander rotates the mounts (the one of the mount commands), capturer takes the frames (the one of the
	// capture service), images receives the frames, frames records them as the latest frame of their camera and
	// closes them, plateSolving solves them, and listener receives every session change synchronously. auxiliaryDir
	// is the parent of the temporary directory of each session.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
		readonly commander: MountCommander,
		readonly capturer: CameraCapturer,
		readonly images: ImageStore,
		readonly frames: CaptureFrameRegistry,
		readonly plateSolving: Pick<PlateSolvingService, 'prepare' | 'solve'>,
		readonly listener: TppaListener,
		readonly auxiliaryDir: string = tmpdir(),
	) {}

	// Returns the latest session of every camera.
	snapshot(): TppaSnapshot {
		return { sessions: Array.from(this.#sessions.values(), (session) => session.summary) }
	}

	// Responds with a complete session, or 404 when it is not the latest of its camera.
	session(sessionId: string): Response {
		const session = this.#find(sessionId)
		return session ? Response.json(this.#complete(session)) : errorResponse('TPPA session not found', 404, 'notFound')
	}

	// Starts a session. Responds 202 with TppaStartResponse once accepted (a repeated token answers its first session);
	// its progress and outcome arrive as tppa:updated and operation:updated events. Responds 404 for an unknown camera
	// or mount, 409 when either is disconnected or held by another operation, and 422 when the plate solver is not
	// configured or the mount cannot run a polar alignment (not equatorial, no west-east motion or abort, no such slew
	// rate, no site, parked, or not tracking and unable to switch tracking).
	async start(connectionId: string, deviceId: string, request: TppaRequest): Promise<Response> {
		const known = this.operations.started(request.token)
		const repeated = known && this.#byOperation.get(known.operationId)
		if (repeated) return Response.json({ sessionId: repeated.summary.sessionId, operationId: repeated.summary.operationId } satisfies TppaStartResponse, { status: 202 })

		// The provider settings are resolved first, so nothing can take the devices between the checks below and the start.
		const preparation = await this.plateSolving.prepare(request.solving)
		if (!preparation) return unsupported('The plate solver is not configured; set it up in Settings → External Tools')

		const camera = connectedDevice(this, connectionId, 'camera', deviceId, 'Camera')
		if (camera instanceof Response) return camera
		const mount = connectedDevice(this, request.mount.connectionId, 'mount', request.mount.deviceId, 'Mount')
		if (mount instanceof Response) return mount
		const refused = mountRefusal(mount, request.slewRate)
		if (refused) return unsupported(refused)
		if (!this.operations.available(camera) || !this.operations.available(mount)) return busy()

		const { token, ...settings } = request
		const cameraDevice = { connectionId, deviceId }
		const session: Session = {
			summary: {
				sessionId: crypto.randomUUID(),
				operationId: '',
				camera: cameraDevice,
				cameraName: camera.name,
				mount: request.mount,
				mountName: mount.name,
				request: settings,
				provider: request.solving.provider,
				state: 'preparing',
				frameCount: 0,
				pointCount: 0,
				refinementCount: 0,
				warnings: [],
				startedAt: Date.now(),
				revision: 0,
			},
			points: [],
			attempts: [],
			mount,
		}

		const record = this.operations.run('mount.tppa', [cameraDevice, request.mount], token, () => {
			const handle = this.#run(session, camera, mount, preparation)
			session.handle = handle
			return handle.result
		})

		const key = resourceKey(camera)
		const previous = this.#sessions.get(key)
		if (previous) this.#forget(previous)
		this.#sessions.set(key, session)
		this.#byOperation.set(record.operationId, session)
		this.#update(session, { operationId: record.operationId })

		void session.handle!.result.then((result) => this.#ended(session, result))
		return Response.json({ sessionId: session.summary.sessionId, operationId: record.operationId } satisfies TppaStartResponse, { status: 202 })
	}

	// Stops a session: the motion, exposure, or solve in progress is cancelled (the mount is stopped) and nothing more
	// is commanded. Resolves once the operation released the devices. Responds 204, and 404 when the session is
	// unknown or already ended.
	async stop(sessionId: string): Promise<Response> {
		const session = this.#find(sessionId)
		if (!session?.handle || session.summary.endedAt !== undefined) return errorResponse('No TPPA session is running with this id', 404, 'notFound')

		if (session.summary.state !== 'stopping') this.#update(session, { state: 'stopping' })
		await session.handle.cancel('aborted')
		return new Response(null, { status: 204 })
	}

	// Starts or resumes the refinement of a session that has an estimate. Responds 204, 404 when the session is
	// unknown or ended, and 409 when it is not waiting for the refinement.
	startRefinement(sessionId: string): Response {
		const session = this.#find(sessionId)
		if (!session || session.summary.endedAt !== undefined) return errorResponse('No TPPA session is running with this id', 404, 'notFound')
		if (!session.resume) return errorResponse('The TPPA session is not waiting for the refinement', 409, 'busy')

		session.resume.resolve(true)
		return new Response(null, { status: 204 })
	}

	// Pauses the refinement of a session; the frame in progress is cancelled and the devices stay held. Resolves once
	// it stopped. Responds 204, 404 when the session is unknown or ended, and 409 when it is not refining.
	async stopRefinement(sessionId: string): Promise<Response> {
		const session = this.#find(sessionId)
		if (!session || session.summary.endedAt !== undefined) return errorResponse('No TPPA session is running with this id', 404, 'notFound')
		if (!session.refinement) return errorResponse('The TPPA session is not refining', 409, 'busy')

		await session.refinement.cancel('aborted')
		return new Response(null, { status: 204 })
	}

	// Starts the operation of a session holding its camera and mount, and runs the acquisition and the refinement
	// inside it.
	#run(session: Session, camera: Camera, mount: Mount, preparation: PlateSolvePreparation): OperationHandle<void> {
		const resources: ResourceRequest[] = [
			{ key: resourceKey(camera), device: camera },
			{ key: resourceKey(mount), device: mount },
		]

		return this.operations.coordinator.start<void>('tppaSession', resources, async (context) => {
			const directory = await mkdtemp(join(this.auxiliaryDir, 'nebulosa-tppa-'))

			try {
				// The poses are solved against the sky the mount tracks, so the tracking is started first.
				if (!mount.tracking) {
					const started = await this.commander.setTracking(context, mount, true)
					if (!started.ok) return started
					this.#update(session, { trackingStarted: true })
				}

				const { request } = session.summary
				const { latitude, longitude, elevation } = mount.geographicCoordinate
				const capture: CenteringCaptureOptions = { ...request.capture, exposureTimeUnit: 'second', frameType: 'LIGHT', compressed: false }
				const services: ThreePointPolarAlignmentServices = {
					mountCommander: this.commander,
					cameraCapturer: listenedCapturer(
						this.capturer,
						exposureProgressListener((exposure) => this.#update(session, { exposure })),
					),
					solver: (frame, signal) => this.#solve(session, frame, preparation, signal),
					auxiliaryPath: (stage, index) => join(directory, `tppa-${stage}-${index}.fit`),
					clock: { ...SYSTEM_CAMERA_CAPTURE_CLOCK, delay: abortableDelay },
					location: geodeticLocation(longitude, latitude, elevation),
					listener: (event) => this.#progress(session, event),
				}

				const acquired = await acquireThreePointPolarAlignment(
					context,
					mount,
					camera,
					{
						direction: request.direction,
						slewRate: request.slewRate,
						capture,
						settle: request.settleDelay,
						initialMotion: INITIAL_MOTION,
						maximumMotion: MAXIMUM_MOTION,
						maximumAttempts: MAXIMUM_ATTEMPTS,
						solveTimeout: SOLVE_TIMEOUT,
						abortGrace: SOLVE_ABORT_GRACE,
						limits: { ...DEFAULT_POLAR_ALIGNMENT_GEOMETRY_LIMITS, targetRotation: request.rotation },
					},
					services,
				)

				if (!acquired.ok) return acquired

				const { alignment, pierSide } = acquired.value
				const refinement = { capture, delay: request.refinementDelay, maximumFailures: MAXIMUM_REFINEMENT_FAILURES, maximumShift: MAXIMUM_REFINEMENT_SHIFT, solveTimeout: SOLVE_TIMEOUT, abortGrace: SOLVE_ABORT_GRACE }
				this.#update(session, { state: 'readyToRefine', point: undefined })

				while (true) {
					if (!(await this.#refinementRequested(session, context.signal))) return failedOperationResult('aborted')

					const from = session.last!
					const handle = context.start<void>('tppaRefinement', [], (child) => refineThreePointPolarAlignment(child, mount, camera, alignment, from, pierSide, refinement, services, session.summary.frameCount + 1))
					session.refinement = handle
					this.#update(session, { state: 'refining' })
					const result = await handle.result
					session.refinement = undefined

					if (context.signal.aborted) return failedOperationResult('aborted')
					if (result.ok || result.reason !== 'aborted') return result.ok ? successfulOperationResult(undefined) : result
					this.#update(session, { state: 'refinementPaused', exposure: undefined })
				}
			} finally {
				await rm(directory, { recursive: true, force: true })
			}
		})
	}

	// Waits until the operator starts the refinement; resolves false when the session is stopped first.
	async #refinementRequested(session: Session, signal: AbortSignal): Promise<boolean> {
		if (signal.aborted) return false

		const resume = Promise.withResolvers<boolean>()
		const abort = () => resume.resolve(false)
		session.resume = resume
		signal.addEventListener('abort', abort, { once: true })

		try {
			return await resume.promise
		} finally {
			signal.removeEventListener('abort', abort)
			session.resume = undefined
		}
	}

	// Decodes a frame file into the image store, records it as the latest frame of the camera in the capture frame
	// registry, and solves it with the prepared provider, whose job retains the document until it ends. Resolves the
	// solution, or undefined when the search found none; any other failure is recorded as a warning and rejects, so
	// the runner counts the frame as unsolved, while a cancellation ends the session.
	async #solve(session: Session, frame: ThreePointPolarAlignmentFrame, preparation: PlateSolvePreparation, signal: AbortSignal): Promise<PlateSolution | undefined> {
		const { camera, cameraName, sessionId } = session.summary
		const current = session.frame
		const number = current?.number ?? session.summary.frameCount
		this.#update(session, { exposure: undefined })
		this.#phase(session, 'solving')

		try {
			const bytes = new Uint8Array(await Bun.file(frame.path).arrayBuffer())
			const time = current?.time ?? Date.now()
			const frameId = captureFrameId(sessionId, number)
			const info = await this.images.openCapture(bytes, basename(frame.path), { ...camera, frameId, time })
			const { width, height, channels, cfa, acquisition } = info
			const bitpix = numericKeyword<number, undefined>(info.header, 'BITPIX', undefined)
			const record: CaptureFrame = { imageId: info.id, sessionId, ...camera, generation: number, time, frameType: 'LIGHT', width, height, channels, cfa, bitpix, acquisition }
			this.frames.previewed(info, record, cameraName, 'tppa')
			if (current) Object.assign(current, { imageId: info.id, observedAt: frame.observedAt })

			const result = await this.plateSolving.solve(info.id, preparation, signal, { kind: 'tppa', sessionId, ...camera, frameId, ...(frame.point !== undefined && { point: frame.point }) })
			if (!result.solution) this.#warn(session, `Frame ${number} did not solve.`)
			return result.solution
		} catch (error) {
			if (!signal.aborted) this.#warn(session, `Frame ${number} could not be solved: ${Error.isError(error) ? error.message : String(error)}`)
			throw error
		}
	}

	// Follows the progress the runner reports.
	#progress(session: Session, event: ThreePointPolarAlignmentEvent) {
		if (session.summary.state === 'stopping') return

		switch (event.type) {
			case 'slewRate':
				this.#update(session, { previousSlewRate: event.previous })
				break
			case 'move':
				this.#update(session, { state: 'moving', point: event.point })
				break
			case 'capture': {
				const number = session.summary.frameCount + 1
				session.frame = { number, point: event.point, time: Date.now() }
				this.#update(session, { frameCount: number, ...(event.point !== undefined && { point: event.point }) })
				this.#phase(session, 'capturing')
				break
			}
			case 'solved':
				// The solve itself was reported by #solve; the judgment follows as a candidate or a pose.
				break
			case 'candidate': {
				const { point, classification } = event
				const attempt: TppaAttempt = {
					point,
					frame: session.frame?.number ?? session.summary.frameCount,
					rotation: classification.displacement.rotation,
					totalRotation: classification.totalRotation,
					separation: classification.displacement.separation,
					accepted: classification.accepted,
					...(!classification.accepted && { reason: classification.reason }),
				}
				session.attempts.push(attempt)
				this.#update(session, {})
				break
			}
			case 'accepted': {
				const frame = session.frame
				const pose: TppaPoint = {
					point: event.point,
					frame: frame?.number ?? session.summary.frameCount,
					rightAscension: event.sample[0],
					declination: event.sample[1],
					time: frame?.observedAt ?? timeToUnixMillis(event.sample[2]),
					...(frame?.imageId !== undefined && { imageId: frame.imageId }),
				}
				session.points.push(pose)
				session.last = event.sample
				if (event.point === 3) session.reference = { rightAscension: event.solution.rightAscension, declination: event.solution.declination }
				this.#update(session, { pointCount: session.points.length })
				break
			}
			case 'geometry':
				this.#update(session, { geometry: event.quality })
				break
			case 'result':
				this.#estimated(session, event.stage, event.result, event.solution, event.sample)
				break
		}
	}

	// Records an estimate and the overlay of its frame.
	#estimated(session: Session, stage: TppaAlignment['stage'], result: ThreePointPolarAlignmentResult, solution: PlateSolution, sample: ThreePointPolarAlignmentInput) {
		const frame = session.frame
		const number = frame?.number ?? session.summary.frameCount
		const reference = session.reference ?? { rightAscension: solution.rightAscension, declination: solution.declination }
		const computed = computeThreePointPolarAlignmentOverlay(result, solution, sample[2], { reference: { type: 'equatorial', ...reference } })
		const totalError = computed.success ? computed.overlay.error.total : Math.hypot(result.azimuthError, result.altitudeError)

		const alignment: TppaAlignment = {
			stage,
			frame: number,
			...(frame?.imageId !== undefined && { imageId: frame.imageId }),
			azimuthError: result.azimuthError,
			altitudeError: result.altitudeError,
			totalError,
			azimuthAdjustment: result.azimuthAdjustment,
			altitudeAdjustment: result.altitudeAdjustment,
			time: frame?.observedAt ?? timeToUnixMillis(sample[2]),
		}

		session.last = sample
		session.overlay = { frame: number, ...(frame?.imageId !== undefined && { imageId: frame.imageId }), ...(computed.success ? { geometry: computed.overlay } : { failure: computed.reason }) }
		if (stage === 'acquisition') session.initialAlignment = alignment
		this.#update(session, { alignment, ...(stage === 'refinement' && { refinementCount: session.summary.refinementCount + 1 }) })
	}

	// Reports the step of the acquisition a session is in; the refinement stays refining throughout its frames.
	#phase(session: Session, state: Extract<TppaState, 'capturing' | 'solving'>) {
		if (!session.refinement && session.summary.state !== state) this.#update(session, { state })
	}

	// Records the end of a session from the result of its operation, then restores the slew rate it replaced and stops
	// the tracking it started.
	async #ended(session: Session, result: OperationResult<void>) {
		session.frame = undefined
		const endedAt = Date.now()
		const estimated = session.summary.alignment !== undefined

		if (result.ok || (result.reason === 'aborted' && estimated)) this.#update(session, { state: 'completed', exposure: undefined, endedAt })
		else if (result.reason === 'aborted') this.#update(session, { state: 'cancelled', exposure: undefined, endedAt })
		else this.#update(session, { state: 'failed', exposure: undefined, reason: result.reason, ...(result.error !== undefined && { error: result.error }), endedAt })

		const previous = session.summary.previousSlewRate
		const { mount } = session

		// The operation released the mount, so each restoration takes it again for itself; another operation that took
		// it first, or a disconnection, leaves the mount as the session left it.
		if (previous !== undefined && mount.slewRate !== previous) {
			const restored = mount.connected && this.operations.available(mount) ? await this.commander.setSlewRate(this.operations.coordinator, mount, previous) : undefined
			if (restored?.ok) this.#update(session, { slewRateRestored: true })
			else this.#update(session, { slewRateRestored: false, warnings: appendWarning(session.summary.warnings, `The slew rate of ${mount.name} was left at ${mount.slewRate ?? 'an unknown preset'} instead of ${previous}.`) })
		}

		if (session.summary.trackingStarted) {
			const stopped = !mount.tracking || (mount.connected && this.operations.available(mount) && (await this.commander.setTracking(this.operations.coordinator, mount, false)).ok)
			if (stopped) this.#update(session, { trackingStopped: true })
			else this.#update(session, { trackingStopped: false, warnings: appendWarning(session.summary.warnings, `The tracking of ${mount.name} that the session started was left on.`) })
		}
	}

	// Records a warning of a session.
	#warn(session: Session, warning: string) {
		this.#update(session, { warnings: appendWarning(session.summary.warnings, warning) })
	}

	// Forgets a session replaced by a newer one of its camera; its latest frame stays with the registry.
	#forget(session: Session) {
		this.#byOperation.delete(session.summary.operationId)
	}

	// Returns the latest session with this id.
	#find(sessionId: string): Session | undefined {
		for (const session of this.#sessions.values()) if (session.summary.sessionId === sessionId) return session
		return undefined
	}

	// Returns the complete record of a session.
	#complete(session: Session): TppaSession {
		return { ...session.summary, points: session.points, attempts: session.attempts, ...(session.initialAlignment && { initialAlignment: session.initialAlignment }), ...(session.overlay && { overlay: session.overlay }) }
	}

	// Publishes a changed session with the next revision; a session replaced by a newer one of its camera changes
	// silently.
	#update(session: Session, patch: Partial<TppaSessionSummary>) {
		session.summary = { ...session.summary, ...patch, revision: session.summary.revision + 1 }
		const latest = Array.from(this.#sessions.values()).includes(session)
		if (latest) this.listener({ type: 'tppa:updated', session: session.summary })
	}
}

// Reason a connected mount cannot run a polar alignment at slewRate, or undefined when it can.
function mountRefusal(mount: Mount, slewRate: string) {
	if (mount.mountType === 'ALTAZ') return `${mount.name} is not an equatorial mount`
	if (!mount.canMove || !mount.canMoveWE) return `${mount.name} cannot move west-east`
	if (!mount.canAbort) return `${mount.name} cannot abort a motion`
	if (!mount.slewRates.some((e) => e.name === slewRate)) return `${mount.name} has no slew rate ${slewRate}`
	const { latitude, longitude } = mount.geographicCoordinate
	if (latitude === 0 && longitude === 0) return `${mount.name} reports no site`
	if (mount.parked || mount.parking) return `${mount.name} is parked`
	if (!mount.tracking && !mount.canTracking) return `${mount.name} is not tracking and cannot start tracking`
	return undefined
}

// Returns the warnings with one more, keeping the latest MAXIMUM_WARNINGS.
function appendWarning(warnings: readonly string[], warning: string) {
	return [...warnings, warning].slice(-MAXIMUM_WARNINGS)
}

// Routes of the TPPA sessions.
export function createTppaRoutes(tppa: TppaSessions) {
	return {
		'/api/tppa': {
			// The latest TPPA session of every camera, started by any tab, without its poses and overlay.
			GET: () => Response.json(tppa.snapshot()),
		},
		'/api/tppa/:sessionId': {
			// A TPPA session with its poses, attempts, and the overlay of its latest estimate; 404 when it is not the latest of its camera.
			GET: (req) => tppa.session(req.params.sessionId),
		},
		'/api/tppa/:sessionId/stop': {
			// Stops a TPPA session; the mount is stopped and its previous slew rate restored when possible.
			POST: (req) => tppa.stop(req.params.sessionId),
		},
		'/api/tppa/:sessionId/refinement/start': {
			// Starts or resumes the refinement of a TPPA session that has an estimate.
			POST: (req) => tppa.startRefinement(req.params.sessionId),
		},
		'/api/tppa/:sessionId/refinement/stop': {
			// Pauses the refinement of a TPPA session, keeping its devices.
			POST: (req) => tppa.stopRefinement(req.params.sessionId),
		},
		'/api/connections/:id/cameras/:deviceId/tppa': {
			// Starts a TPPA with this camera; its progress and outcome arrive as tppa:updated and operation:updated events.
			POST: async (req) => tppa.start(req.params.id, req.params.deviceId, (await req.json()) as TppaRequest),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
