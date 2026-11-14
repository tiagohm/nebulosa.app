import { mkdir, readdir, rmdir, stat } from 'fs/promises'
import { join } from 'path'
import { TIMEZONE } from 'nebulosa/src/astronomy/time/temporal'
import type { CameraCommander } from 'nebulosa/src/devices/commanders/camera'
import type { CoverCommander } from 'nebulosa/src/devices/commanders/cover'
import type { FlatPanelCommander } from 'nebulosa/src/devices/commanders/flatpanel'
import type { WheelCommander } from 'nebulosa/src/devices/commanders/wheel'
import type { Camera, Cover, Device, FlatPanel, Thermometer, Wheel } from 'nebulosa/src/devices/indi/device'
import { failedOperationResult, type OperationContext, type OperationFailureReason, type OperationHandle, type OperationResult, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { abortableDelay, abortReason } from 'nebulosa/src/devices/orchestration/operation.wait'
import { type ResourceRequest, resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import type { FlatPlane } from 'nebulosa/src/imaging/analysis/flat/types'
import { numericKeyword } from 'nebulosa/src/io/formats/fits/util'
import { medianOf } from 'nebulosa/src/math/numerical/statistics'
import type { CameraCapturer } from 'nebulosa/src/observation/capture/capture'
import { type CameraCaptureStart, type CameraCaptureTime, DEFAULT_CAMERA_CAPTURE_START, SYSTEM_CAMERA_CAPTURE_CLOCK } from 'nebulosa/src/observation/capture/types'
import type { DarkFrameRegistration } from './calibrationlibrary'
import { CameraSessionRegistry } from './camerasessions'
import { type CaptureFrameRegistry, captureFrameId } from './captureframes'
import { type CaptureSnoop, DEFAULT_CAPTURES_DIR, exposureProgressListener, frameName, snoopedDevices } from './captures'
import { busy, type ClientResolver, type CommandRequest, connectedDevice, unsupported } from './commands'
import {
	advanceTemperatureTrace,
	advanceThermalHold,
	assessDarkFrame,
	type DarkFrameAssessment,
	type DarkFrameBaseline,
	type DarkFrameExpectation,
	type DarkFrameMeasurement,
	type DarkLibraryWizardAnalyzer,
	type DarkLightSuspicion,
	type DarkPlaneMeasurement,
	type DarkTemperatureTrace,
	startTemperatureTrace,
} from './darklibrarywizard.analysis'
import { type DarkCapturePlan, type DarkFrameRecord, type DarkFrameVerdict, type DarkGroup, type DarkGroupProgress, type DarkPlanCapture, type DarkPlanGroup, type DarkProtection, type DarkThermalPolicy, darksDirectory, REJECTED_DIRECTORY, stagingDirectory } from './darklibrarywizard.plan'
import type { DeviceRegistry } from './devices'
import { type CameraBindings, NO_CAMERA_BINDINGS } from './equipmentcatalog'
import { publishFrame } from './flatwizard'
import { errorResponse } from './http'
import type { ImageStore } from './images'
import { type OperationDevice, type OperationProgressReporter, type OperationRegistry, settledResult } from './operations'

// Dark Library Wizard service: one server-owned session per camera that acquires the DARK frames of a capture plan, group
// after group, until each group has its accepted frames. A plan is immutable and lives in the memory of its session
// (darklibrarywizard.plan.ts); it is never listed, completed, or reused, and every start makes a new one. A session is what
// works on it, one `camera.darkLibraryWizard` operation of the process-wide registry holding the camera and the wheel,
// panel, and cover its protection selected from start to end, including while it is paused or waits for the operator. It
// only acquires: a plan may be for dark-flats and may ask for masters, but masters, reuse, and browsing are the Calibration
// Library's, which receives every accepted frame as it is published and the plan once its session ended, and can fail
// without touching it. Nothing is kept to resume: a session the server did not finish is acquired again.
//
// Protection is prepared in a safe order: the panel light off first, so a cover never moves with it on, then the wheel
// at the dark slot, then the cover closed, each confirmed by the state the device reports, never by the command. What
// hardware cannot verify is the operator's to ensure before starting, which the panel warns about: the manual cap, the
// opacity of a filter (a slot's name proves nothing), and an unlit panel as the only barrier. A start, or a resume, is that
// assertion, so no step asks for it. The verified state is read again synchronously right before every exposure, through
// the capturer's beforeExposure hook, and a change waits for the operator.
//
// Temperature is the sensor's, as reported. A command is only dispatched, so a group with a target waits until readings
// stay inside the tolerance for the hold time. Drivers report only changes, so a silent sensor holds its last reading;
// silence is recorded as the age of the reading and fails nothing. The cooler is switched on when it can be, and is never
// switched off, warmed, or given back a setpoint: thermal state after a session is the operator's.
//
// Every exposure goes through the shared camera capturer into the staging directory of its plan, is measured in the DN
// of the file by the analyzer, and is decided by assessDarkFrame. A proven failure is quarantined in the rejected
// directory of darks/ and never counts. A suspicion of light never rejects a frame, because only the operator can say
// whether the protection failed: on the first frame of a group, and on two suspicious frames in a row, the session waits for
// a decision. Continuing records the frame as accepted with warnings; stopping quarantines it. An accepted frame is
// published without ever replacing a file, and only then counts. Raw pixels are never modified.
//
// Pausing takes effect between frames and keeps every device held, since releasing them would let the protection be
// undone unnoticed. Stopping cancels the operation at once: the exposure in flight is lost and published files stay.
// Restoring what the session changed happens after the operation released its devices, because a cancelled operation
// cannot start new work: each device is taken again only if no other operation took it first, and what cannot be
// restored is reported. Durations are seconds, instants Unix milliseconds, temperatures degrees Celsius.

// Camera settings of a plan's frames, without the exposure and temperature of each group.
export type DarkLibraryWizardCaptureSettings = DarkPlanCapture

// Equipment a session uses, by exact ids; each is needed only when the protection selected it.
export interface DarkLibraryWizardEquipment {
	// Filter wheel holding the dark slot.
	readonly wheel?: OperationDevice
	// Flat panel switched off.
	readonly panel?: OperationDevice
	// Dust cover closed.
	readonly cover?: OperationDevice
	// Devices snooped into the frame headers.
	readonly snoop?: CaptureSnoop
}

// Body of POST /api/connections/:id/cameras/:deviceId/dark-library-wizard, which creates a plan.
export interface DarkLibraryWizardRequest extends CommandRequest, DarkLibraryWizardEquipment {
	// Camera settings of every frame.
	readonly capture: DarkLibraryWizardCaptureSettings
	// Groups to acquire; at least one.
	readonly groups: readonly DarkGroup[]
	// Light protection.
	readonly protection: DarkProtection
	// Thermal protocol of the groups with a target.
	readonly thermal: DarkThermalPolicy
	// Rejected frames allowed per group before the session fails.
	readonly maximumRejections: number
	// Absolute directory of the server the frames are saved under; DEFAULT_CAPTURES_DIR when absent.
	readonly directory?: string
	// What the frames are for; absent is an ordinary dark.
	readonly purpose?: 'darkFlat'
	// Whether the Calibration Library builds the masters of the complete groups once the acquisition ends.
	readonly generateMasters?: boolean
}

// What a session is doing:
// - preparing: acquiring the devices.
// - disablingPanel, movingDarkFilter, closingCover: the protection is being applied, in that order.
// - waitingForProtection: waiting for the operator to restore a lost protection.
// - cooling: the target was commanded and the sensor is outside the tolerance.
// - stabilizing: the sensor is inside the tolerance for the hold time.
// - exposing, measuring, publishing: a frame is being taken, examined, and saved.
// - waitingForDecision: a frame raised a suspicion of light and waits for the operator.
// - paused: between frames, every device held.
// - stopping: the operator stopped the session.
// - restoring: the devices were released and what the session changed is restored.
// - completed: every group has its accepted frames.
// - cancelled: the session was stopped; published frames stay.
// - failed: the session ended because of an error, given in reason and error.
export type DarkLibraryWizardState = 'preparing' | 'disablingPanel' | 'movingDarkFilter' | 'closingCover' | 'waitingForProtection' | 'cooling' | 'stabilizing' | 'exposing' | 'measuring' | 'publishing' | 'waitingForDecision' | 'paused' | 'stopping' | 'restoring' | 'completed' | 'cancelled' | 'failed'

// Stable code of a refused request or a failed session.
export type DarkLibraryWizardErrorCode =
	| 'notFound'
	| 'busy'
	| 'disconnected'
	| 'unsupported'
	| 'alreadyRunning'
	| 'protectionUnavailable'
	| 'protectionUnverified'
	| 'invalidFilterSlot'
	| 'temperatureUnavailable'
	| 'temperatureTimeout'
	| 'staleStep'
	| 'notPaused'
	| 'notRunning'
	| 'publicationFailed'
	| 'verificationFailed'
	| 'cameraNotCataloged'

// Progress of one group in a session: pending until reached, then acquiring, and complete, failed, or cancelled.
export type DarkLibraryWizardGroupState = 'pending' | 'acquiring' | 'completed' | 'failed' | 'cancelled'

// Progress of one group.
export interface DarkLibraryWizardGroupRun extends DarkGroup, DarkGroupProgress {
	// Progress of the group.
	readonly state: DarkLibraryWizardGroupState
	// Exposures this session took for it.
	readonly attempted: number
	// Exposures this session lost to a failed transfer.
	readonly failedTransfer: number
}

// One exposure of a session, without server paths.
export interface DarkLibraryWizardAttempt extends DarkFrameAssessment {
	// Number of the exposure within the session, from 1.
	readonly index: number
	// Index of its group.
	readonly group: number
	// Id of the frame in the capture frame registry; absent when it could not be decoded for the preview.
	readonly frameId?: string
	// Exposure, in seconds.
	readonly exposure: number
	// Instant the exposure started, Unix milliseconds (UTC).
	readonly time: number
	// Outcome; absent while the operator has not decided it.
	readonly verdict?: DarkFrameVerdict
	// Levels of its planes.
	readonly planes: readonly DarkPlaneMeasurement[]
	// Temperature during the exposure, as the driver reported it.
	readonly temperature?: Omit<DarkTemperatureTrace, 'at'>
	// Name of its file, without its directory.
	readonly file?: string
}

// Manual step a session waits for.
// - protectionLost: a device left the state it was verified in (message), and must return to it.
// - suspectedLight: a frame raised suspicions and waits for a decision.
export type DarkLibraryWizardPendingStep = { readonly stepId: string; readonly kind: 'protectionLost'; readonly message: string } | { readonly stepId: string; readonly kind: 'suspectedLight'; readonly group: number; readonly suspicions: readonly DarkLightSuspicion[] }

// Session record published to clients.
export interface DarkLibraryWizardSessionSummary {
	// Id of the session.
	readonly sessionId: string
	// Id of the operation holding the devices.
	readonly operationId: string
	// Id of the plan it works on.
	readonly planId: string
	// Camera taking the frames.
	readonly camera: OperationDevice
	// Name of the camera.
	readonly cameraName: string
	// Equipment the session uses.
	readonly wheel?: OperationDevice
	readonly wheelName?: string
	readonly panel?: OperationDevice
	readonly panelName?: string
	readonly cover?: OperationDevice
	readonly coverName?: string
	// Settings of the plan.
	readonly capture: DarkLibraryWizardCaptureSettings
	readonly protection: DarkProtection
	readonly thermal: DarkThermalPolicy
	readonly maximumRejections: number
	// What the session is doing.
	readonly state: DarkLibraryWizardState
	// Whether a pause was asked for and takes effect after the current frame.
	readonly pauseRequested: boolean
	// Index of the group in progress.
	readonly group: number
	// Every group, in acquisition order.
	readonly groups: readonly DarkLibraryWizardGroupRun[]
	// Latest reported sensor temperature, in degrees Celsius; absent when the camera reports none.
	readonly temperature?: number
	// Progress of the frame being exposed, as the driver reports it (times in microseconds, progress in percent).
	readonly exposure?: CameraCaptureTime
	// Latest examined exposure.
	readonly lastAttempt?: DarkLibraryWizardAttempt
	// Manual step the session waits for.
	readonly pending?: DarkLibraryWizardPendingStep
	// Why the latest frame could not be previewed; cleared by the next previewed frame.
	readonly previewError?: string
	// What the session could not restore, one problem each.
	readonly cleanupWarnings: readonly string[]
	// Why the session failed.
	readonly reason?: OperationFailureReason
	// Stable code of the failure, when it has one of its own.
	readonly code?: DarkLibraryWizardErrorCode
	// Detail of the failure.
	readonly error?: string
	// Instant the session started, Unix milliseconds (UTC).
	readonly startedAt: number
	// Instant the session ended, Unix milliseconds (UTC).
	readonly endedAt?: number
	// Number of changes published so far; increases with every change.
	readonly revision: number
}

// Complete session record.
export interface DarkLibraryWizardSession extends DarkLibraryWizardSessionSummary {
	// Latest exposures, oldest first; at most MAXIMUM_ATTEMPTS.
	readonly attempts: readonly DarkLibraryWizardAttempt[]
}

// Snapshot of GET /api/dark-library-wizard: the latest session of every camera.
export interface DarkLibraryWizardSnapshot {
	readonly sessions: readonly DarkLibraryWizardSessionSummary[]
}

// Response of an accepted start.
export interface DarkLibraryWizardStartResponse {
	// Id of the session, repeated by its darkLibraryWizard:updated events.
	readonly sessionId: string
	// Id of the operation holding the devices.
	readonly operationId: string
	// Id of the plan.
	readonly planId: string
}

// Body of POST /api/dark-library-wizard/:sessionId/continue.
export interface DarkLibraryWizardContinueRequest {
	// Id of the pending step being confirmed.
	readonly stepId: string
}

// Notification published whenever a session changes.
export type DarkLibraryWizardEvent = { readonly type: 'darkLibraryWizard:updated'; readonly session: DarkLibraryWizardSessionSummary }

// Receiver of Dark Library Wizard events.
export type DarkLibraryWizardListener = (event: DarkLibraryWizardEvent) => void

// Exposures kept in the detail of a session, the latest ones.
const MAXIMUM_ATTEMPTS = 200

// Interval between readings of the sensor temperature, in milliseconds. The value read stands between driver updates.
const TEMPERATURE_POLL = 1000

// Time an Alert of the thermometer stands, in milliseconds. A repeated Alert is notified again, but its end with an
// unchanged value is not, so an old one cannot be held against the sensor forever.
const ALERT_WINDOW = 30000

// Suspicious frames in a row after which a frame that is not the first of its group waits for a decision.
const SUSPICIONS_IN_A_ROW = 2

// Name of the saved frames.
const FILENAME_TEMPLATE = '{date}_{time}_{camera}_{type}_{seq}'

// A session while its service knows it.
interface Session {
	// Plan the session works on.
	readonly plan: DarkCapturePlan
	// Devices snooped into the frame headers.
	readonly snoop?: CaptureSnoop
	summary: DarkLibraryWizardSessionSummary
	attempts: DarkLibraryWizardAttempt[]
	// Operation holding the devices; absent only before it started.
	handle?: OperationHandle<void>
	// Reports progress to the status bar.
	report?: OperationProgressReporter
	// Confirmation of the manual step the session waits for.
	gate?: { readonly stepId: string; readonly confirm: VoidFunction }
	// Ends a pause.
	resume?: VoidFunction
	// Slot the wheel stood at when the session started.
	readonly wheelSlot?: number
	// Whether the session commanded the wheel; set before the command, so a move interrupted halfway is restored too.
	wheelMoved: boolean
	// Whether the session commanded the cover closed; set before the command, like wheelMoved.
	coverClosed: boolean
	// Target last commanded to the camera, in degrees Celsius.
	setpoint?: number
	// Target the sensor was last confirmed stable at; cleared by anything that may have moved it.
	stable?: number
	// Exposures taken so far, numbering the frames in the capture frame registry.
	exposures: number
	// Suspicious frames in a row.
	suspicious: number
	// Accepted planes per group, in acquisition order, for the baselines.
	readonly accepted: Map<number, (readonly DarkPlaneMeasurement[])[]>
	// Size of the first accepted frame per group.
	readonly sizes: Map<number, { readonly width: number; readonly height: number }>
	// Latest sequence number per group.
	readonly sequences: Map<number, number>
	// Settles once the session ended and its cleanup ran.
	readonly ended: PromiseWithResolvers<void>
}

// Devices of a session.
interface SessionDevices {
	readonly camera: Camera
	readonly wheel?: Wheel
	readonly panel?: FlatPanel
	readonly cover?: Cover
}

// One frame a session took and examined, not yet saved.
interface ExaminedFrame {
	// Staged file.
	readonly staged: string
	readonly sequence: number
	readonly time: number
	readonly generation: number
	readonly frameId?: string
	readonly measurement: DarkFrameMeasurement
	readonly assessment: DarkFrameAssessment
	readonly trace?: DarkTemperatureTrace
}

// What happened to one attempted frame.
type FrameOutcome =
	| { readonly status: 'taken'; readonly frame: ExaminedFrame }
	| { readonly status: 'unreadable'; readonly staged: string; readonly sequence: number; readonly time: number; readonly generation: number; readonly frameId?: string; readonly trace?: DarkTemperatureTrace; readonly error: string }
	| { readonly status: 'refused' }

// Thermometer readings of a camera beyond its value, kept by the service.
interface TemperatureActivity {
	// Instant the driver last changed the reading.
	readonly changedAt: number
	// Whether the driver reported an Alert on the vector.
	readonly alert: boolean
}

// Returns the part of the temperature of an exposure that is worth keeping, without its monotonic instant.
function temperatureRecord(trace: DarkTemperatureTrace | undefined) {
	if (!trace) return {}
	const { at: _, ...temperature } = trace
	return { temperature }
}

// Returns the equipment a protection selected, leaving out what it does not use, which stays free for other operations.
function selected<W, P, C>({ darkFilter, panelOff, closeCover }: DarkProtection, { wheel, panel, cover }: { readonly wheel?: W; readonly panel?: P; readonly cover?: C }) {
	return { wheel: darkFilter ? wheel : undefined, panel: panelOff ? panel : undefined, cover: closeCover ? cover : undefined }
}

// Returns the exact identity of the settings of a group's frames. Two groups are the same only when their exact values
// are: a rounded label never merges them.
export function darkGroupKey(group: Pick<DarkGroup, 'exposure' | 'temperature'>, capture: DarkPlanCapture, hardwareId: string) {
	const { gain, offset, binX, binY, subframe, x, y, width, height, frameFormat } = capture
	return JSON.stringify(['DARK', hardwareId, group.exposure, gain, offset, binX, binY, subframe ? [x, y, width, height] : 'full', frameFormat, group.temperature ?? 'uncontrolled'])
}

// Orders groups so those at one temperature run together, which avoids needless cooler changes: temperatures keep the
// order they first appear in, and each keeps the requested order of its groups.
export function orderDarkGroups<T extends Pick<DarkGroup, 'temperature'>>(groups: readonly T[]): T[] {
	const temperatures = Array.from(new Set(groups.map((group) => group.temperature)))
	return temperatures.flatMap((temperature) => groups.filter((group) => group.temperature === temperature))
}

// Returns the role of a dark as its file name writes it: DARK or DARKFLAT, the exposure of its group in seconds, and the
// target temperature of its group, or, without a target, the sensor temperature measured during the frame (the reading
// when the exposure started, else the one of its header), rounded to whole degrees Celsius. A frame with neither names no
// temperature.
export function darkFrameType(purpose: DarkCapturePlan['purpose'], { exposure, temperature }: Pick<DarkGroup, 'exposure' | 'temperature'>, measured: number | undefined) {
	const degrees = temperature ?? (measured === undefined ? undefined : Math.round(measured) || 0)
	return `${purpose === 'darkFlat' ? 'DARKFLAT' : 'DARK'}_${exposure}s${degrees === undefined ? '' : `_${degrees}C`}`
}

// Returns the size a frame must have, in output pixels, or undefined while the sensor is unknown.
export function expectedFrameSize({ subframe, width, height, binX, binY }: DarkPlanCapture, sensor: DarkCapturePlan['camera']['sensor']) {
	if (subframe) return { width: Math.floor(width / binX), height: Math.floor(height / binY) }
	return sensor && { width: Math.floor(sensor.width / binX), height: Math.floor(sensor.height / binY) }
}

// Returns the full sensor a camera reports, in unbinned pixels, or undefined while it reports none.
function sensorOf(camera: Camera) {
	const { max: width } = camera.frame.width
	const { max: height } = camera.frame.height
	return width > 0 && height > 0 ? { width, height } : undefined
}

// Returns the name of a slot as the wheel reports it.
function slotName(wheel: Pick<Wheel, 'names'>, slot: number) {
	return wheel.names[slot]?.trim() || `Filter ${slot + 1}`
}

// Returns a failure with a detail meant for people, keeping its reason.
function failedWith(result: OperationResult<unknown> & { readonly ok: false }, message: string) {
	return failedOperationResult(result.reason, result.error ? `${message}: ${result.error}` : message)
}

// Dark Library Wizard sessions of the cameras of every open connection.
export class DarkLibraryWizardSessions implements Disposable {
	// Latest session of each camera, and the session each start token started.
	readonly #sessions: CameraSessionRegistry<DarkLibraryWizardSessionSummary, Session>
	// Thermometer activity of each camera.
	readonly #temperatures = new Map<Thermometer, TemperatureActivity>()

	// Follows the thermometers: updates arrive only on changes, so the time of the last one is all a reading's age is.
	readonly #thermometers = {
		added: () => {},
		updated: (device: Thermometer, property: string, state?: string) => {
			if (property === 'temperature') this.#temperatures.set(device, { changedAt: Date.now(), alert: state === 'Alert' })
		},
		removed: (device: Thermometer) => {
			this.#temperatures.delete(device)
		},
	}

	// Creates the service. client resolves an open connection id to its client, operations holds and publishes every
	// session, capturer takes the frames (the one of the capture service), cameras, wheels, panels, and covers drive the
	// devices (the commanders of their commands), images receives the previews, frames records them and the published
	// frames, analyzer measures the frames in DN, and listener receives every session change synchronously. capturesDir is
	// the default output directory, framePublished receives every accepted frame once it was published, and sessionEnded the
	// plan of an ended session that asked for masters. catalog resolves the camera of the Equipment Catalog a camera is bound
	// to, which a plan records and without which no session starts.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
		readonly capturer: CameraCapturer,
		readonly cameras: CameraCommander,
		readonly wheels: WheelCommander,
		readonly panels: FlatPanelCommander,
		readonly covers: CoverCommander,
		readonly images: ImageStore,
		readonly frames: CaptureFrameRegistry,
		readonly analyzer: Pick<DarkLibraryWizardAnalyzer, 'measure'>,
		readonly listener: DarkLibraryWizardListener,
		readonly capturesDir: string = DEFAULT_CAPTURES_DIR,
		readonly framePublished: (frame: DarkFrameRegistration) => void = () => undefined,
		readonly sessionEnded: (plan: DarkCapturePlan) => void = () => undefined,
		readonly catalog: CameraBindings = NO_CAMERA_BINDINGS,
	) {
		this.#sessions = new CameraSessionRegistry(operations, (session) => listener({ type: 'darkLibraryWizard:updated', session }))
		devices.thermometers.addHandler(this.#thermometers)
	}

	// Stops following the thermometers.
	[Symbol.dispose]() {
		this.devices.thermometers.removeHandler(this.#thermometers)
	}

	// Returns the latest session of every camera.
	snapshot(): DarkLibraryWizardSnapshot {
		return { sessions: this.#sessions.summaries() }
	}

	// Responds with a complete session, or 404 when it is not the latest of its camera.
	session(sessionId: string): Response {
		const session = this.#sessions.find(sessionId)
		return session ? Response.json({ ...session.summary, attempts: session.attempts } satisfies DarkLibraryWizardSession) : errorResponse('Dark Library Wizard session not found', 404, 'notFound')
	}

	// Starts a session on a new plan, replacing the ended session of the camera. Responds 202 with
	// DarkLibraryWizardStartResponse once accepted, and a repeated token answers its session; progress and outcome arrive
	// as darkLibraryWizard:updated and operation:updated events.
	start(connectionId: string, deviceId: string, request: DarkLibraryWizardRequest): Response {
		const repeated = this.#sessions.repeated(request.token)
		return repeated ? startResponse(repeated) : this.#start(connectionId, deviceId, request)
	}

	// Checks everything a start depends on and starts the session; see start.
	#start(connectionId: string, deviceId: string, request: DarkLibraryWizardRequest): Response {
		const camera = connectedDevice(this, connectionId, 'camera', deviceId, 'Camera')
		if (camera instanceof Response) return camera
		const cameraId = this.catalog.cameraOf({ connectionId, deviceId })
		if (cameraId === undefined) return errorResponse('Bind the camera to a camera of the Equipment Catalog in the Equipment Setup first', 409, 'cameraNotCataloged')
		const wheel = request.wheel && connectedDevice(this, request.wheel.connectionId, 'wheel', request.wheel.deviceId, 'Filter wheel')
		if (wheel instanceof Response) return wheel
		const panel = request.panel && connectedDevice(this, request.panel.connectionId, 'flatPanel', request.panel.deviceId, 'Flat panel')
		if (panel instanceof Response) return panel
		const cover = request.cover && connectedDevice(this, request.cover.connectionId, 'cover', request.cover.deviceId, 'Cover')
		if (cover instanceof Response) return cover

		const key = resourceKey(camera)
		const previous = this.#sessions.of(key)
		if (previous && previous.summary.endedAt === undefined) return errorResponse('A Dark Library Wizard session is running on this camera', 409, 'alreadyRunning')

		const offered: SessionDevices = { camera, wheel, panel, cover }
		const plan = this.#newPlan(Bun.randomUUIDv7(), cameraId, request, offered)
		const { protection } = plan
		const refused = usable(plan, offered)
		if (refused) return refused

		const devices: SessionDevices = { camera, ...selected(protection, offered) }
		const equipment = selected(protection, request)
		const free = () => this.operations.available(camera) && [devices.wheel, devices.panel, devices.cover].every((device) => !device || this.operations.available(device))
		if (!free()) return busy()

		const session = this.#session(plan, connectionId, deviceId, equipment, request.snoop, devices)
		const held: OperationDevice[] = [{ connectionId, deviceId }, ...[equipment.wheel, equipment.panel, equipment.cover].filter((device) => device !== undefined)]

		const record = this.operations.run('camera.darkLibraryWizard', held, request.token, (report) => {
			session.report = report
			session.handle = this.#run(session, devices)
			return session.handle.result
		})

		this.#sessions.adopt(key, session, record.operationId)

		void settledResult(session.handle!.result).then((result) => this.#ended(session, devices, result))
		return startResponse(session)
	}

	// Builds the plan of a request for the camera of the Equipment Catalog the camera is bound to; the groups run in the
	// order that groups their temperatures.
	#newPlan(planId: string, cameraId: string, request: DarkLibraryWizardRequest, { camera, wheel, panel, cover }: SessionDevices): DarkCapturePlan {
		const directory = request.directory || this.capturesDir
		const hardwareId = resourceKey(camera)
		const { protection, capture, thermal, maximumRejections } = request
		const groups = orderDarkGroups(request.groups).map((group): DarkPlanGroup => ({
			exposure: group.exposure,
			temperature: group.temperature,
			count: group.count,
			groupId: Bun.randomUUIDv7(),
			key: darkGroupKey(group, capture, hardwareId),
		}))
		const device = (entry: Device) => ({ hardwareId: resourceKey(entry), name: entry.name })

		return {
			planId,
			createdAt: Date.now(),
			camera: { hardwareId, cameraId, name: camera.name, driver: { executable: camera.driver.executable, version: camera.driver.version }, sensor: sensorOf(camera) },
			...(protection.darkFilter && wheel && { wheel: { ...device(wheel), slotName: slotName(wheel, protection.darkFilter.slot) } }),
			...(protection.panelOff && panel && { panel: device(panel) }),
			...(protection.closeCover && cover && { cover: device(cover) }),
			directory,
			capture,
			groups,
			protection,
			...(request.purpose && { purpose: request.purpose }),
			...(request.generateMasters && { generateMasters: true }),
			thermal,
			maximumRejections,
		}
	}

	// Creates the record of a session on a new plan, with nothing acquired yet.
	#session(plan: DarkCapturePlan, connectionId: string, deviceId: string, { wheel, panel, cover }: Pick<DarkLibraryWizardEquipment, 'wheel' | 'panel' | 'cover'>, snoop: CaptureSnoop | undefined, { camera, wheel: wheelDevice, panel: panelDevice, cover: coverDevice }: SessionDevices): Session {
		const { protection, capture, thermal, maximumRejections, groups } = plan
		const groupRuns = groups.map(({ groupId, exposure, temperature, count }): DarkLibraryWizardGroupRun => ({
			exposure,
			temperature,
			count,
			groupId,
			required: count,
			accepted: 0,
			acceptedWithWarnings: 0,
			rejected: 0,
			incomplete: 0,
			missing: count,
			state: 'pending',
			attempted: 0,
			failedTransfer: 0,
		}))

		return {
			plan,
			snoop,
			summary: {
				sessionId: Bun.randomUUIDv7(),
				operationId: '',
				planId: plan.planId,
				camera: { connectionId, deviceId },
				cameraName: camera.name,
				...(wheel && { wheel, wheelName: wheelDevice?.name }),
				...(panel && { panel, panelName: panelDevice?.name }),
				...(cover && { cover, coverName: coverDevice?.name }),
				capture,
				protection,
				thermal,
				maximumRejections,
				state: 'preparing',
				pauseRequested: false,
				group: 0,
				groups: groupRuns,
				cleanupWarnings: [],
				startedAt: Date.now(),
				revision: 0,
			},
			attempts: [],
			wheelSlot: wheelDevice?.position,
			wheelMoved: false,
			coverClosed: false,
			exposures: 0,
			suspicious: 0,
			accepted: new Map(),
			sizes: new Map(),
			sequences: new Map(),
			ended: Promise.withResolvers(),
		}
	}

	// Confirms the manual step a session waits for. Responds 204, 404 when the session is unknown, and 409 when it waits
	// for no step or for another one, so a stale or repeated confirmation never skips a later step.
	continue(sessionId: string, { stepId }: DarkLibraryWizardContinueRequest): Response {
		const session = this.#sessions.find(sessionId)
		if (!session) return errorResponse('Dark Library Wizard session not found', 404, 'notFound')
		if (session.gate?.stepId !== stepId) return errorResponse('The Dark Library Wizard session is not waiting for this step', 409, 'staleStep')

		session.gate.confirm()
		return new Response(null, { status: 204 })
	}

	// Asks a running session to pause after the current frame, keeping every device held. Responds 204, repeated requests
	// included; 404 when the session is unknown; and 409 when it already ended.
	pause(sessionId: string): Response {
		const session = this.#sessions.find(sessionId)
		if (!session) return errorResponse('Dark Library Wizard session not found', 404, 'notFound')
		if (session.summary.endedAt !== undefined) return errorResponse('The Dark Library Wizard session already ended', 409, 'notRunning')
		if (!session.summary.pauseRequested) this.#update(session, { pauseRequested: true })
		return new Response(null, { status: 204 })
	}

	// Resumes a paused session, or withdraws a pause that has not taken effect. The protection and the temperature are
	// checked again before the next frame. Responds 204, 404 when the session is unknown, and 409 when it is not pausing.
	resume(sessionId: string): Response {
		const session = this.#sessions.find(sessionId)
		if (!session) return errorResponse('Dark Library Wizard session not found', 404, 'notFound')
		if (!session.summary.pauseRequested || session.summary.endedAt !== undefined) return errorResponse('The Dark Library Wizard session is not paused', 409, 'notPaused')
		this.#update(session, { pauseRequested: false })
		session.resume?.()
		return new Response(null, { status: 204 })
	}

	// Stops a running session wherever it stands: the exposure in flight is aborted and lost, a measurement, a pause, or a
	// manual step is abandoned, and published files stay. Resolves once the devices were released and what the session
	// changed was restored. Responds 204, 404 when the session is unknown, and 409 when it already ended.
	async stop(sessionId: string): Promise<Response> {
		const session = this.#sessions.find(sessionId)
		if (!session) return errorResponse('Dark Library Wizard session not found', 404, 'notFound')
		if (session.summary.endedAt !== undefined) return errorResponse('The Dark Library Wizard session already ended', 409, 'notRunning')

		if (session.summary.state !== 'stopping') this.#update(session, { state: 'stopping', pending: undefined })
		await session.handle?.cancel('aborted')
		await session.ended.promise
		return new Response(null, { status: 204 })
	}

	// Starts the operation of a session, holding its devices until every group ended.
	#run(session: Session, devices: SessionDevices): OperationHandle<void> {
		const resources = new Map<string, ResourceRequest>()
		for (const device of [devices.camera, devices.wheel, devices.panel, devices.cover]) if (device) resources.set(resourceKey(device), { key: resourceKey(device), device })

		return this.operations.coordinator.start<void>('darkLibraryWizardSession', Array.from(resources.values()), async (context) => {
			const prepared = await this.#protect(session, context, devices)
			if (!prepared.ok) return prepared

			for (let index = 0; index < session.plan.groups.length; index++) {
				const result = await this.#group(session, context, devices, index)
				if (!result.ok) return this.#failGroup(session, index, result)
			}

			return successfulOperationResult(undefined)
		})
	}

	// Applies the protection in its safe order, each step confirmed by the state the device reports: the light goes off
	// before anything moves, so a cover never travels with a lit panel behind it. A step that fails ends the session.
	async #protect(session: Session, context: OperationContext, { panel, wheel, cover }: SessionDevices): Promise<OperationResult<void>> {
		const { darkFilter, panelOff, closeCover } = session.plan.protection

		if (panelOff && panel) {
			this.#update(session, { state: 'disablingPanel' })
			const disabled = await this.panels.disable(context, panel)
			if (!disabled.ok) return this.#failWith(session, 'protectionUnverified', failedWith(disabled, 'The flat panel light did not switch off'))
		}

		if (darkFilter && wheel) {
			this.#update(session, { state: 'movingDarkFilter' })
			session.wheelMoved = wheel.position !== darkFilter.slot
			const moved = await this.wheels.moveTo(context, wheel, darkFilter.slot)
			if (!moved.ok) return this.#failWith(session, 'protectionUnverified', failedWith(moved, 'The wheel did not reach the dark slot'))
		}

		if (closeCover && cover && (!cover.parked || cover.parking)) {
			this.#update(session, { state: 'closingCover' })
			session.coverClosed = true
			const closed = await this.covers.park(context, cover)
			if (!closed.ok) return this.#failWith(session, 'protectionUnverified', failedWith(closed, `The cover ${cover.name} did not close`))
		}

		return successfulOperationResult(undefined)
	}

	// Waits for the operator to confirm a manual step, published with a fresh step id.
	async #gate(session: Session, context: OperationContext, state: DarkLibraryWizardState, step: (stepId: string) => DarkLibraryWizardPendingStep): Promise<OperationResult<void>> {
		const { signal } = context
		if (signal.aborted) return failedOperationResult(abortReason(signal))

		const stepId = Bun.randomUUIDv7()
		const { promise, resolve } = Promise.withResolvers<OperationResult<void>>()
		const onAbort = () => resolve(failedOperationResult(abortReason(signal)))
		signal.addEventListener('abort', onAbort, { once: true })
		session.gate = { stepId, confirm: () => resolve(successfulOperationResult(undefined)) }
		this.#update(session, { state, pending: step(stepId) })

		try {
			return await promise
		} finally {
			signal.removeEventListener('abort', onAbort)
			session.gate = undefined
			if (session.summary.pending?.stepId === stepId) this.#update(session, { pending: undefined })
		}
	}

	// Waits between frames while a pause is asked for, holding every device. Afterwards anything may have changed: Resume is
	// the operator's assertion of the protection, and the temperature is confirmed again.
	async #pausePoint(session: Session, context: OperationContext): Promise<OperationResult<void>> {
		if (!session.summary.pauseRequested) return successfulOperationResult(undefined)

		const { signal } = context
		if (signal.aborted) return failedOperationResult(abortReason(signal))

		const { promise, resolve } = Promise.withResolvers<OperationResult<void>>()
		const onAbort = () => resolve(failedOperationResult(abortReason(signal)))
		signal.addEventListener('abort', onAbort, { once: true })
		session.resume = () => resolve(successfulOperationResult(undefined))
		this.#update(session, { state: 'paused' })
		session.report?.({ step: 1, steps: 1, message: 'Paused, devices held' })

		try {
			const resumed = await promise
			if (!resumed.ok) return resumed
		} finally {
			signal.removeEventListener('abort', onAbort)
			session.resume = undefined
		}

		session.stable = undefined
		return successfulOperationResult(undefined)
	}

	// Returns what no longer stands of the verified protection, or undefined when everything does. Read synchronously, so
	// it can decide the very next exposure.
	#protectionFault({ plan: { protection } }: Session, { wheel, panel, cover }: SessionDevices): string | undefined {
		if (protection.darkFilter && wheel && (!wheel.connected || wheel.moving || wheel.position !== protection.darkFilter.slot)) return `${wheel.name} left the dark slot`
		if (protection.closeCover && cover && (!cover.connected || cover.parking || !cover.parked)) return `${cover.name} is no longer closed`
		if (protection.panelOff && panel && (!panel.connected || panel.enabled)) return `${panel.name} light is no longer off`
		return undefined
	}

	// Waits until the protection stands again, each time asking the operator to fix it and confirm.
	async #restoreProtection(session: Session, context: OperationContext, devices: SessionDevices): Promise<OperationResult<void>> {
		for (let fault = this.#protectionFault(session, devices); fault; fault = this.#protectionFault(session, devices)) {
			const message = fault
			const confirmed = await this.#gate(session, context, 'waitingForProtection', (stepId) => ({ stepId, kind: 'protectionLost', message }))
			if (!confirmed.ok) return confirmed
		}

		return successfulOperationResult(undefined)
	}

	// Commands a target once and waits until the sensor stays inside the tolerance for the hold time. Readings alone decide:
	// a command is only dispatched, and the wait restarts whenever a reading leaves the tolerance. A target already
	// stable returns at once when the sensor still reads inside the tolerance.
	async #stabilize(session: Session, context: OperationContext, camera: Camera, target: number): Promise<OperationResult<void>> {
		const { tolerance, hold, timeout } = session.plan.thermal
		const fault = this.#thermalFault(session, camera)
		if (fault) return fault
		if (session.stable === target && Math.abs(camera.temperature - target) <= tolerance) return successfulOperationResult(undefined)

		session.stable = undefined

		if (session.setpoint !== target) {
			if (camera.hasCoolerControl && !camera.cooler) {
				const cooler = await this.cameras.cooler(context, camera, true)
				if (!cooler.ok) return this.#failWith(session, 'temperatureUnavailable', failedWith(cooler, 'The cooler did not switch on'))
			}

			const commanded = await this.cameras.temperature(context, camera, target)
			if (!commanded.ok) return this.#failWith(session, 'temperatureUnavailable', failedWith(commanded, 'The target temperature was not accepted'))
			session.setpoint = target
		}

		const deadline = performance.now() + timeout * 1000
		let since: number | undefined

		for (;;) {
			const now = performance.now()
			const thermal = this.#thermalFault(session, camera)
			if (thermal) return thermal

			since = advanceThermalHold(since, camera.temperature, target, tolerance, now)
			this.#update(session, { state: since === undefined ? 'cooling' : 'stabilizing', temperature: camera.temperature })

			if (since !== undefined && now - since >= hold * 1000) {
				session.stable = target
				return successfulOperationResult(undefined)
			}

			if (now >= deadline) return this.#failWith(session, 'temperatureTimeout', failedOperationResult('timeout', `The sensor of ${camera.name} did not stay at ${target} °C within ${timeout} s`))

			const waited = await abortableDelay(TEMPERATURE_POLL, context.signal)
			if (!waited.ok) return waited
		}
	}

	// Returns the failure of a thermometer that stopped being evidence, or undefined.
	#thermalFault(session: Session, camera: Camera): (OperationResult<void> & { readonly ok: false }) | undefined {
		if (!camera.connected) return failedOperationResult('disconnected')
		if (!camera.hasThermometer) return this.#failWith(session, 'temperatureUnavailable', failedOperationResult('unexpectedState', `${camera.name} stopped reporting its temperature`))
		const activity = this.#temperatures.get(camera)
		if (activity?.alert && Date.now() - activity.changedAt < ALERT_WINDOW) return this.#failWith(session, 'temperatureUnavailable', failedOperationResult('alert', `The driver of ${camera.name} reports a temperature alert`))
		return undefined
	}

	// Takes frames of a group until it has the frames it misses.
	async #group(session: Session, context: OperationContext, devices: SessionDevices, index: number): Promise<OperationResult<void>> {
		const group = session.plan.groups[index]
		const { camera } = devices
		this.#update(session, { group: index })
		this.#patch(session, index, { state: 'acquiring' })
		let rejections = 0
		let first = true

		while (session.summary.groups[index].missing > 0) {
			if (rejections > session.plan.maximumRejections) return this.#failWith(session, 'verificationFailed', failedOperationResult('unexpectedState', `${rejections} frames of ${group.exposure} s were rejected; check the camera and its settings`))

			const paused = await this.#pausePoint(session, context)
			if (!paused.ok) return paused

			const restored = await this.#restoreProtection(session, context, devices)
			if (!restored.ok) return restored

			if (group.temperature !== undefined) {
				const stable = await this.#stabilize(session, context, camera, group.temperature)
				if (!stable.ok) return stable
			}

			const outcome = await this.#take(session, context, devices, index)
			if (!outcome.ok) return outcome

			const taken = outcome.value
			if (taken.status === 'refused') continue

			if (taken.status === 'unreadable') {
				rejections++
				const quarantined = await this.#reject(session, index, {
					staged: taken.staged,
					sequence: taken.sequence,
					time: taken.time,
					generation: taken.generation,
					frameId: taken.frameId,
					trace: taken.trace,
					measurement: { header: { width: 0, height: 0 }, planes: [] },
					assessment: { rejections: ['unreadable'], suspicions: [], notes: [] },
				})
				if (!quarantined.ok) return quarantined
				continue
			}

			const { frame } = taken

			if (frame.assessment.rejections.length > 0) {
				rejections++
				const quarantined = await this.#reject(session, index, frame)
				if (!quarantined.ok) return quarantined
				session.suspicious = 0
				continue
			}

			const decided = await this.#decide(session, context, index, frame, first)
			if (!decided.ok) return decided

			const saved = await this.#save(session, index, frame, decided.value)
			if (!saved.ok) return saved
			first = false
		}

		this.#patch(session, index, { state: 'completed' })
		return successfulOperationResult(undefined)
	}

	// Returns whether a frame was acknowledged: a suspicion stops for the operator on the first frame of a group, when the
	// plan asks to verify it, and on repeated suspicions, which are stronger evidence than one frame. Stopping ends the
	// session and the staged frame is quarantined with whatever else is left.
	async #decide(session: Session, context: OperationContext, index: number, frame: ExaminedFrame, first: boolean): Promise<OperationResult<boolean>> {
		const { suspicions } = frame.assessment

		if (suspicions.length === 0) {
			session.suspicious = 0
			return successfulOperationResult(false)
		}

		session.suspicious++
		if (!((first && session.plan.protection.verifyFirstFrame) || session.suspicious >= SUSPICIONS_IN_A_ROW)) return successfulOperationResult(false)

		const confirmed = await this.#gate(session, context, 'waitingForDecision', (stepId) => ({ stepId, kind: 'suspectedLight', group: index, suspicions }))
		return confirmed.ok ? successfulOperationResult(true) : confirmed
	}

	// Exposes one frame into the staging directory of its plan and measures it in DN. The protection and the temperature
	// are read again right before the exposure is dispatched; a refusal returns to the loop, which takes care of them.
	async #take(session: Session, context: OperationContext, devices: SessionDevices, index: number): Promise<OperationResult<FrameOutcome>> {
		const { camera } = devices
		const group = session.plan.groups[index]
		const staging = stagingDirectory(session.plan)
		const sequence = this.#sequence(session, index)
		// A sequence number is never reused in a group, so the position of the group and the sequence never repeat in a plan.
		const name = `${index + 1}_${sequence}.fit`
		const staged = join(staging, name)
		const { tolerance } = session.plan.thermal

		try {
			await mkdir(staging, { recursive: true })
		} catch (error) {
			return this.#failWith(session, 'publicationFailed', failedOperationResult('commandFailed', `Unable to create the output directory: ${Error.isError(error) ? error.message : String(error)}`))
		}

		this.#update(session, { state: 'exposing', temperature: camera.hasThermometer ? camera.temperature : undefined })

		let refused = false
		let trace: DarkTemperatureTrace | undefined
		const sample = () => {
			if (!camera.hasThermometer || trace === undefined) return
			trace = advanceTemperatureTrace(trace, camera.temperature, performance.now(), this.#temperatureAge(camera), group.temperature, tolerance)
			this.#update(session, { temperature: camera.temperature })
		}
		const timer = setInterval(sample, TEMPERATURE_POLL)

		const beforeExposure = () => {
			const fault = this.#protectionFault(session, devices)
			const drifted = group.temperature !== undefined && Math.abs(camera.temperature - group.temperature) > tolerance
			if (fault || drifted) {
				refused = true
				if (drifted) session.stable = undefined
				return failedOperationResult('unexpectedState', fault ?? 'The sensor left the tolerance')
			}

			if (camera.hasThermometer) trace = startTemperatureTrace(camera.temperature, performance.now(), this.#temperatureAge(camera))
			return undefined
		}

		const captured = await this.capturer.start(context, camera, this.#captureRequest(session, camera, index, staging, name), { clock: SYSTEM_CAMERA_CAPTURE_CLOCK, beforeExposure, listener: exposureProgressListener((exposure) => this.#update(session, { exposure })) }).result
		clearInterval(timer)
		sample()
		this.#update(session, { exposure: undefined })

		if (!captured.ok) {
			if (refused) return successfulOperationResult({ status: 'refused' })
			if (!context.signal.aborted) this.#patch(session, index, { failedTransfer: session.summary.groups[index].failedTransfer + 1 })
			return captured
		}

		const run = session.summary.groups[index]
		this.#patch(session, index, { attempted: run.attempted + 1 })
		session.sequences.set(index, sequence)

		const time = captured.value.frames[0]?.exposureStartedAt ?? Date.now()
		const generation = ++session.exposures
		const frameId = await this.#preview(session, staged, name, generation, time)
		this.#update(session, { state: 'measuring' })

		try {
			const measurement = await this.analyzer.measure(staged, context.signal)
			const assessment = assessDarkFrame(measurement, this.#expectation(session, index), this.#baseline(session, index), trace, group.temperature)
			return successfulOperationResult({ status: 'taken', frame: { staged, sequence, time, generation, frameId, measurement, assessment, trace } })
		} catch (error) {
			if (context.signal.aborted) return failedOperationResult(abortReason(context.signal))
			return successfulOperationResult({ status: 'unreadable', staged, sequence, time, generation, frameId, trace, error: Error.isError(error) ? error.message : String(error) })
		}
	}

	// Returns the age of the latest reading of a camera, in seconds, or undefined until a change was seen.
	#temperatureAge(camera: Camera) {
		const activity = this.#temperatures.get(camera)
		return activity && (Date.now() - activity.changedAt) / 1000
	}

	// Returns the next sequence number of a group: past every frame of the plan, so a file name never repeats.
	#sequence(session: Session, index: number) {
		return (session.sequences.get(index) ?? 0) + 1
	}

	// Returns what a frame of a group was requested with.
	#expectation({ plan }: Session, index: number): DarkFrameExpectation {
		const { exposure } = plan.groups[index]
		const { gain, offset, binX, binY } = plan.capture
		return { exposure, gain, offset, binX, binY, ...expectedFrameSize(plan.capture, plan.camera.sensor) }
	}

	// Returns the baseline a frame of a group is compared with: the frames this session accepted for it, and the nearest
	// shorter exposure of the plan at the same operating point, whose accepted frames this session saw.
	#baseline(session: Session, index: number): DarkFrameBaseline {
		const { groups } = session.plan
		const group = groups[index]
		const reference = groups
			.map((candidate, position) => ({ candidate, position }))
			.filter(({ candidate, position }) => position !== index && candidate.exposure < group.exposure && candidate.temperature === group.temperature && session.accepted.has(position))
			.sort((a, b) => b.candidate.exposure - a.candidate.exposure)[0]

		return { frames: session.accepted.get(index) ?? [], size: session.sizes.get(index), ...(reference && { shorter: { exposure: reference.candidate.exposure, levels: medianLevels(session.accepted.get(reference.position)!) } }) }
	}

	// Quarantines a frame that does not count. The file is kept; failing to do so ends the session.
	async #reject(session: Session, index: number, frame: ExaminedFrame): Promise<OperationResult<void>> {
		const rejected = join(darksDirectory(session.plan), REJECTED_DIRECTORY)
		this.#update(session, { state: 'publishing' })

		try {
			await mkdir(rejected, { recursive: true })
			await publishFrame(frame.staged, join(rejected, this.#fileName(session, index, frame)))
		} catch (error) {
			return this.#failWith(session, 'publicationFailed', failedOperationResult('commandFailed', `Unable to keep a rejected frame: ${Error.isError(error) ? error.message : String(error)}`))
		}

		const run = session.summary.groups[index]
		this.#patch(session, index, { rejected: run.rejected + 1 })
		this.#attempt(session, index, frame, 'rejected')
		return successfulOperationResult(undefined)
	}

	// Saves an accepted frame: published without replacing anything, and only then counted and handed to the Calibration
	// Library. A failure leaves the frame uncounted.
	async #save(session: Session, index: number, frame: ExaminedFrame, acknowledged: boolean): Promise<OperationResult<void>> {
		const group = session.plan.groups[index]
		const { assessment, measurement, time, generation, staged } = frame
		const warned = assessment.suspicions.length > 0 || assessment.notes.includes('temperatureTransient')
		const verdict: DarkFrameVerdict = warned ? 'acceptedWithWarnings' : 'accepted'
		const name = this.#fileName(session, index, frame)
		const path = join(darksDirectory(session.plan), name)
		this.#update(session, { state: 'publishing' })

		let record: DarkFrameRecord

		try {
			const { size } = await stat(staged)
			record = { ...this.#frameRecord(session, index, frame, path, size, verdict), ...(acknowledged && { acknowledged }) }
			await publishFrame(staged, path)
		} catch (error) {
			return this.#failWith(session, 'publicationFailed', failedOperationResult('commandFailed', `Unable to save ${name}: ${Error.isError(error) ? error.message : String(error)}`))
		}

		const { sessionId, camera: device, cameraName } = session.summary
		this.frames.published({ sessionId, generation, ...device, cameraName, time, frameType: 'DARK', path }, 'darkLibraryWizard')
		this.framePublished({ plan: session.plan, groupId: group.groupId, frame: record })

		const accepted = session.accepted.get(index) ?? []
		accepted.push(measurement.planes)
		session.accepted.set(index, accepted)
		if (!session.sizes.has(index)) session.sizes.set(index, { width: measurement.header.width, height: measurement.header.height })

		const run = session.summary.groups[index]
		this.#patch(session, index, { ...(warned ? { acceptedWithWarnings: run.acceptedWithWarnings + 1 } : { accepted: run.accepted + 1 }), missing: run.missing - 1 })
		this.#attempt(session, index, frame, verdict, name)
		return successfulOperationResult(undefined)
	}

	// Returns the name of a frame's file: when it was taken, its camera, its role with its exposure and temperature
	// (darkFrameType), and its sequence, so frames of every plan can share one directory and still say what they are.
	#fileName({ summary: { cameraName }, plan }: Session, index: number, { time, sequence, trace, measurement }: Pick<ExaminedFrame, 'time' | 'sequence' | 'trace' | 'measurement'>) {
		const type = darkFrameType(plan.purpose, plan.groups[index], trace?.start ?? measurement.header.temperature)
		return `${frameName(FILENAME_TEMPLATE, { camera: cameraName, type, time, generation: sequence, timezoneOffset: TIMEZONE })}.fit`
	}

	// Returns the record of a frame.
	#frameRecord(session: Session, index: number, { sequence, time, measurement, assessment, trace }: ExaminedFrame, path: string, size: number, verdict: DarkFrameVerdict): DarkFrameRecord {
		return { frameId: Bun.randomUUIDv7(), groupId: session.plan.groups[index].groupId, sequence, path, size, time, verdict, planes: measurement.planes, header: measurement.header, ...assessment, ...temperatureRecord(trace) }
	}

	// Publishes an examined frame as the latest attempt of the session.
	#attempt(session: Session, index: number, { generation, frameId, time, measurement, assessment, trace }: ExaminedFrame, verdict: DarkFrameVerdict, file?: string) {
		const attempt: DarkLibraryWizardAttempt = {
			index: generation,
			group: index,
			frameId: file ? captureFrameId(session.summary.sessionId, generation) : frameId,
			exposure: session.plan.groups[index].exposure,
			time,
			verdict,
			planes: measurement.planes,
			...assessment,
			...temperatureRecord(trace),
			...(file && { file }),
		}
		session.attempts.push(attempt)
		if (session.attempts.length > MAXIMUM_ATTEMPTS) session.attempts.shift()
		this.#update(session, { lastAttempt: attempt })
	}

	// Decodes a frame from its staging file into the image store and records it as the latest frame of its camera (origin
	// darkLibraryWizard, frame id sessionId:generation), previewed only until published() names its final path. Resolves
	// the frame id, or undefined when the frame could not be decoded, which is reported and never fails the session.
	async #preview(session: Session, path: string, name: string, generation: number, time: number): Promise<string | undefined> {
		const { sessionId, camera: device, cameraName } = session.summary
		const frameId = captureFrameId(sessionId, generation)

		try {
			const info = await this.images.openCapture(await Bun.file(path).bytes(), name, { ...device, frameId, time })
			const bitpix = numericKeyword<number, undefined>(info.header, 'BITPIX', undefined)
			const { width, height, channels, cfa, acquisition } = info
			this.frames.previewed(info, { imageId: info.id, sessionId, ...device, generation, time, frameType: 'DARK', width, height, channels, cfa, bitpix, acquisition }, cameraName, 'darkLibraryWizard')
			if (session.summary.previewError !== undefined) this.#update(session, { previewError: undefined })
			return frameId
		} catch (error) {
			this.#update(session, { previewError: `Unable to decode the frame: ${Error.isError(error) ? error.message : String(error)}` })
			return undefined
		}
	}

	// Builds the capture request of one frame: a DARK frame of the plan's camera settings at the group's exposure,
	// written uncompressed as FITS to name inside staging, with the devices snooped into its header.
	#captureRequest(session: Session, camera: Camera, index: number, staging: string, name: string): CameraCaptureStart {
		const { exposure } = session.plan.groups[index]
		const { snoop } = session
		const { wheel } = session.summary
		const snoopWheel = wheel && wheel.connectionId === session.summary.camera.connectionId ? wheel.deviceId : snoop?.wheel

		return {
			...structuredClone(DEFAULT_CAMERA_CAPTURE_START),
			...session.plan.capture,
			exposureTime: exposure,
			exposureTimeUnit: 'second',
			frameType: 'DARK',
			exposureMode: 'single',
			count: 1,
			delay: 0,
			autoSave: true,
			autoSubFolderMode: 'off',
			transferFormat: 'FITS',
			compressed: false,
			outputPath: staging,
			outputName: name,
			...snoopedDevices(this.devices, camera, { ...snoop, wheel: snoopWheel }),
		}
	}

	// Ends a session: quarantines what its staging directories hold, restores what it changed in a safe order, publishes
	// its outcome, and hands its plan to the Calibration Library when it asked for masters. The panel stays off whatever it was, the wheel returns while the path is still
	// closed, and the cover opens last and only with the panel known to be off. The cooler is never touched. Every step
	// runs whatever the others did; what could not be done is reported in cleanupWarnings.
	async #ended(session: Session, { panel, wheel, cover }: SessionDevices, result: OperationResult<void>) {
		const warnings: string[] = []
		this.#update(session, { state: 'restoring', exposure: undefined, pending: undefined })

		try {
			await this.#quarantine(session)
		} catch (error) {
			warnings.push(`Unexamined frames could not be quarantined: ${Error.isError(error) ? error.message : String(error)}`)
		}

		const { protection } = session.plan
		let panelOff = !protection.panelOff || !panel

		if (protection.panelOff && panel) {
			if (panel.connected && !panel.enabled) panelOff = true
			else {
				const disabled = panel.connected && this.operations.available(panel) ? await this.panels.disable(this.operations.coordinator, panel) : undefined
				panelOff = disabled?.ok === true
				if (!panelOff) warnings.push(`The light of ${panel.name} may be on: ${disabled && !disabled.ok ? (disabled.error ?? disabled.reason) : 'the panel was not available'}`)
			}
		}

		if (session.wheelMoved && wheel && session.wheelSlot !== undefined) {
			const moved = wheel.connected && this.operations.available(wheel) ? await this.wheels.moveTo(this.operations.coordinator, wheel, session.wheelSlot) : undefined
			if (!moved?.ok) warnings.push(`${wheel.name} stayed away from slot ${session.wheelSlot + 1}: ${moved && !moved.ok ? (moved.error ?? moved.reason) : 'the wheel was not available'}`)
		}

		if (session.coverClosed && cover) {
			if (!panelOff) warnings.push(`The cover ${cover.name} stayed closed because the panel light could not be confirmed off`)
			else {
				const opened = cover.connected && this.operations.available(cover) ? await this.covers.unpark(this.operations.coordinator, cover) : undefined
				if (!opened?.ok) warnings.push(`The cover ${cover.name} was left closed: ${opened && !opened.ok ? (opened.error ?? opened.reason) : 'the cover was not available'}`)
			}
		}

		const groups = session.summary.groups.map((group) => (group.state === 'acquiring' ? { ...group, state: 'cancelled' as const } : group))

		if (warnings.length > 0) this.#update(session, { cleanupWarnings: warnings })

		if (result.ok) this.#update(session, { state: 'completed', groups, pending: undefined, pauseRequested: false, endedAt: Date.now() })
		else if (result.reason === 'aborted') this.#update(session, { state: 'cancelled', groups, pending: undefined, pauseRequested: false, endedAt: Date.now() })
		else this.#update(session, { state: 'failed', groups, pending: undefined, pauseRequested: false, reason: result.reason, ...(result.error !== undefined && { error: result.error }), endedAt: Date.now() })

		session.ended.resolve()
		if (session.plan.generateMasters) this.sessionEnded(session.plan)
	}

	// Moves whatever the staging directory of a session holds into the rejected directory: the session examined none of it,
	// so it must neither count nor vanish. The staging directory of the session goes once it is empty.
	async #quarantine({ plan }: Session) {
		const staging = stagingDirectory(plan)
		const files = await readdir(staging).catch(() => [] as string[])

		if (files.length > 0) {
			const rejected = join(darksDirectory(plan), REJECTED_DIRECTORY)
			await mkdir(rejected, { recursive: true })
			for (const file of files) await publishFrame(join(staging, file), join(rejected, `incomplete_${Bun.randomUUIDv7()}.fit`))
		}

		await rmdir(staging).catch(() => undefined)
	}

	// Remembers the stable code of a failure for clients, and returns the failure.
	#failWith<T extends OperationResult<void> & { readonly ok: false }>(session: Session, code: DarkLibraryWizardErrorCode, result: T): T {
		this.#update(session, { code })
		return result
	}

	// Marks a group as failed, or cancelled when the session was stopped, and returns the failure.
	#failGroup(session: Session, index: number, result: OperationResult<void> & { readonly ok: false }): OperationResult<void> {
		this.#patch(session, index, { state: result.reason === 'aborted' ? 'cancelled' : 'failed' })
		return result
	}

	// Changes a group of a session and publishes the session.
	#patch(session: Session, index: number, patch: Partial<DarkLibraryWizardGroupRun>) {
		this.#update(session, { groups: session.summary.groups.map((group, i) => (i === index ? { ...group, ...patch } : group)) })
	}

	// Publishes a changed session with the next revision; a session replaced by a newer one of its camera changes silently.
	#update(session: Session, patch: Partial<DarkLibraryWizardSessionSummary>) {
		// A stop request keeps the session stopping until its cleanup starts, whatever step was running.
		const state = session.summary.state === 'stopping' && patch.state !== undefined && !AFTER_STOPPING.has(patch.state) ? 'stopping' : (patch.state ?? session.summary.state)
		this.#sessions.replace(session, { ...session.summary, ...patch, state })
	}
}

// States a stopping session may move on to.
const AFTER_STOPPING: ReadonlySet<DarkLibraryWizardState> = new Set(['restoring', 'completed', 'cancelled', 'failed'])

// Returns the response of an accepted start.
function startResponse({ summary: { sessionId, operationId, planId } }: Session) {
	return Response.json({ sessionId, operationId, planId } satisfies DarkLibraryWizardStartResponse, { status: 202 })
}

// Returns the median level per plane of accepted frames.
function medianLevels(frames: readonly (readonly DarkPlaneMeasurement[])[]) {
	const levels = new Map<FlatPlane, number[]>()

	for (const planes of frames) {
		for (const { plane, median } of planes) {
			if (median === undefined) continue
			const values = levels.get(plane)
			if (values) values.push(median)
			else levels.set(plane, [median])
		}
	}

	return Object.fromEntries(Array.from(levels, ([plane, values]) => [plane, medianOf(Float64Array.from(values).sort())]))
}

// Returns the response refusing a plan on the devices of a session, or undefined when they can run it. These are facts
// about the devices, not about the request: a selected device that is missing or cannot do its part blocks the start
// rather than being replaced by a manual step, and a wheel would otherwise clamp a slot it does not have to one it has.
function usable(plan: DarkCapturePlan, { camera, wheel, panel, cover }: SessionDevices): Response | undefined {
	const { darkFilter, closeCover, panelOff } = plan.protection
	const missing = (what: string) => errorResponse(`${what} is selected but not available`, 409, 'protectionUnavailable')

	if (darkFilter && !wheel) return missing('The filter wheel')
	if (closeCover && !cover) return missing('The cover')
	if (panelOff && !panel) return missing('The flat panel')
	if (closeCover && cover && !cover.canPark) return unsupported('The cover cannot be opened and closed')
	if (darkFilter && wheel && !(darkFilter.slot < wheel.count)) return errorResponse(`The wheel has no slot ${darkFilter.slot + 1}`, 422, 'invalidFilterSlot')
	if (plan.groups.some((group) => group.temperature !== undefined) && !(camera.canSetTemperature && camera.hasThermometer)) return errorResponse('The camera cannot set and report a target temperature', 422, 'temperatureUnavailable')
	return undefined
}

// Routes of the Dark Library Wizard sessions.
export function createDarkLibraryWizardRoutes(wizard: DarkLibraryWizardSessions) {
	return {
		'/api/dark-library-wizard': {
			// The latest Dark Library Wizard session of every camera, started by any tab.
			GET: () => Response.json(wizard.snapshot()),
		},
		'/api/dark-library-wizard/:sessionId': {
			// A session with its latest exposures; 404 when it is not the latest of its camera.
			GET: (req) => wizard.session(req.params.sessionId),
		},
		'/api/dark-library-wizard/:sessionId/continue': {
			// Confirms the manual step a session waits for.
			POST: async (req) => wizard.continue(req.params.sessionId, (await req.json()) as DarkLibraryWizardContinueRequest),
		},
		'/api/dark-library-wizard/:sessionId/pause': {
			// Pauses a session after the current frame; its devices stay held.
			POST: (req) => wizard.pause(req.params.sessionId),
		},
		'/api/dark-library-wizard/:sessionId/resume': {
			// Resumes a paused session after checking the protection and the temperature again.
			POST: (req) => wizard.resume(req.params.sessionId),
		},
		'/api/dark-library-wizard/:sessionId/stop': {
			// Stops a session; the exposure in flight is lost and published frames stay.
			POST: (req) => wizard.stop(req.params.sessionId),
		},
		'/api/connections/:id/cameras/:deviceId/dark-library-wizard': {
			// Starts a session on a new plan; progress arrives as darkLibraryWizard:updated events.
			POST: async (req) => wizard.start(req.params.id, req.params.deviceId, (await req.json()) as DarkLibraryWizardRequest),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
