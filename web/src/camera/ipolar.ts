import type { CameraCapabilities, DarkEvidence, IPolarDarkRequest, IPolarDarkStatus, IPolarRequest, IPolarSession, IPolarSessionSummary, IPolarState, MountState, ServerEvent } from 'api'
import { nanoid } from 'nanoid'
import { ASEC2RAD, DEG2RAD } from 'nebulosa/src/core/constants'
import type { IPolarRejection } from 'nebulosa/src/observation/alignment/ipolar'
import { proxy } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { deviceUrl, jsonInit } from '../http'
import type { ObservingSite } from '../location/site'
import type { CameraExposureSettings, CameraPlateSolvingSettings, IPolarDarkSettings, IPolarSettings } from '../profile/schema'
import { SnapshotRefreshes } from '../refresh'
import { cameraKey, fitExposure } from './capture'
import { applySession, type CameraSessionKind, type CameraSessionRecords, refreshSessionRecords, sendSessionCommand } from './sessions'

// iPolar sessions as this tab knows them. The server owns every session, whichever tab started it, and every motion,
// exposure, and solve of it, so this store only mirrors it: the compact summary of the latest session of each camera
// arrives with every ipolar:updated event and, on every socket (re)open, with the snapshot; the complete record (poses,
// rejected candidates, and the overlay of the latest measurement) is fetched when a summary reports a new frame,
// candidate, measurement, or rejection, or an end. Summaries are ordered by their revision, so a late event never
// replaces a newer state. Cameras and mounts are addressed by their exact connection and device ids, never by role. A
// start carries a token, so a retried request answers the session of the first one instead of starting another.

// iPolar state of the tab.
export type IPolarRuntime = CameraSessionRecords<IPolarSessionSummary, IPolarSession>

// iPolar state of the tab.
export const ipolarRuntime = proxy<IPolarRuntime>({ sessions: {}, details: {}, pending: {}, errors: {} })

// How the sessions are mirrored (sessions.ts): the complete record is fetched again when the summary reports a new
// frame, candidate, measurement, rejection, or dark outcome, or an end.
const IPOLAR_SESSIONS: CameraSessionKind<IPolarSessionSummary, IPolarSession> = {
	url: '/api/ipolar',
	refreshes: new SnapshotRefreshes(),
	stale: (session, _, details) =>
		!details ||
		details.frameCount !== session.frameCount ||
		details.attemptCount !== session.attemptCount ||
		details.measurement?.frame !== session.measurement?.frame ||
		details.rejection?.frame !== session.rejection?.frame ||
		details.dark?.frame !== session.dark?.frame ||
		details.dark?.state !== session.dark?.state ||
		(session.endedAt !== undefined && details.endedAt === undefined),
}

// Label of each session state.
export const IPOLAR_STATE_LABELS: Readonly<Record<IPolarState, string>> = {
	preparing: 'Preparing',
	capturing: 'Exposing',
	solving: 'Solving',
	waitingForRotation: 'Waiting for the RA Rotation',
	rotating: 'Rotating in RA',
	readyToRefine: 'Ready to Refine',
	refining: 'Refining',
	refinementPaused: 'Refinement Paused',
	stopping: 'Stopping…',
	completed: 'Completed',
	failed: 'Failed',
	cancelled: 'Stopped',
}

// Label of each mode.
export const IPOLAR_MODE_LABELS: Readonly<Record<IPolarSettings['mode'], string>> = { manual: 'Manual', automatic: 'Automatic' }

// Modes, in selector order.
export const IPOLAR_MODES = Object.keys(IPOLAR_MODE_LABELS) as IPolarSettings['mode'][]

// Label of each RA direction.
export const IPOLAR_DIRECTION_LABELS: Readonly<Record<IPolarSettings['direction'], string>> = { WEST: 'West', EAST: 'East' }

// RA directions, in selector order.
export const IPOLAR_DIRECTIONS = Object.keys(IPOLAR_DIRECTION_LABELS) as IPolarSettings['direction'][]

// Text of each reason a frame gave no measurement or a candidate did not calibrate.
export const IPOLAR_REJECTION_LABELS: Readonly<Record<IPolarRejection | 'unsolved', string>> = {
	unsolved: 'the frame did not solve',
	inconsistentSensor: 'the sensor geometry changed',
	badTime: 'the frame times are out of order',
	badWcs: 'the plate solution is unusable',
	poorConditioning: 'the field is too small to fix the attitude',
	unstableFit: 'the frames are not related by a rigid rotation',
	insufficientRotation: 'the RA rotation is too small',
	excessiveRotation: 'the RA rotation is too large',
	wrongAxis: 'the rotation axis is far from the pole (a DEC move?)',
	geometryMismatch: 'the camera geometry changed since the calibration',
	fieldJump: 'the field jumped, as after a slew',
	singularGeometry: 'the pole is at the zenith',
}

// What each unverified fact of an applied dark means, for people.
export const IPOLAR_DARK_EVIDENCE_LABELS: Readonly<Record<DarkEvidence, string>> = {
	camera: 'camera',
	temperature: 'temperature',
	gain: 'gain',
	offset: 'offset',
	binning: 'binning',
	readoutMode: 'readout mode',
	origin: 'subframe origin',
}

// Returns how the pinned dark went for the latest frame, for people: pending, applied (with what could not be checked),
// or not applied and why, with what the frame was then solved with.
export function ipolarDarkText(status: IPolarDarkStatus, onUnavailable: IPolarDarkRequest['onUnavailable']): string {
	if (status.state === 'pending') return `Subtracting dark #${status.masterId} from frame #${status.frame}…`
	if (status.state === 'applied') {
		const unverified = (status.unverified ?? []).map((evidence) => IPOLAR_DARK_EVIDENCE_LABELS[evidence])
		return `Dark #${status.masterId} subtracted from frame #${status.frame}${unverified.length > 0 ? `; not verified: ${unverified.join(', ')}` : ''}.`
	}
	return `Dark #${status.masterId} not subtracted from frame #${status.frame}: ${status.reason ?? status.code}. ${onUnavailable === 'stop' ? 'The session stopped.' : 'The frame was solved without it.'}`
}

// Returns why the mount can never run an automatic rotation, from the state the server reports, or undefined when it
// can (or its state is not known yet): an alt-az mount, no west-east motion, no abort, or no slew-rate preset.
export function ipolarMountSupport(state: Pick<MountState, 'mountType' | 'canMove' | 'canMoveWE' | 'canAbort' | 'slewRates'> | undefined): string | undefined {
	if (!state) return undefined
	if (state.mountType === 'ALTAZ') return 'The mount is not equatorial; the automatic rotation turns the RA axis of an equatorial mount.'
	if (!state.canMove || !state.canMoveWE) return 'The mount cannot move west-east, which the automatic rotation needs.'
	if (!state.canAbort) return 'The mount cannot abort a motion, which the automatic rotation needs to stop safely.'
	if (state.slewRates.length === 0) return 'The mount offers no slew rate to choose.'
	return undefined
}

// Inputs of a start the blocker judges.
export interface IPolarStartContext {
	// Availability of the camera of the tab.
	readonly camera: RoleAvailability
	// Availability of the setup's mount; unsupported only in automatic mode (ipolarMountSupport).
	readonly mount: RoleAvailability
	// Mode of the form.
	readonly mode: IPolarSettings['mode']
	// State the mount reports, undefined while unknown or without one.
	readonly mountState: MountState | undefined
	// Slew rate an automatic start would send (ipolarSlewRate).
	readonly slewRate: string | undefined
	// Active observing site of the profile.
	readonly site: ObservingSite | undefined
	// Whether the plate solver is configured.
	readonly solverConfigured: boolean
	// Master dark of the form; absent subtracts none.
	readonly dark?: Pick<IPolarDarkSettings, 'enabled' | 'masterId'>
}

// Returns why no session can start now, or undefined when one can. A manual session needs only a ready camera, a site
// and a solver; the setup's mount is used when ready, ignored when absent or disconnected, and blocks only while
// another operation holds it. An automatic session needs the mount ready and supported, a preset it announces,
// and unparked; its clearance is the operator's, warned beside the Start button. The server checks again.
export function ipolarBlocker({ camera, mount, mode, mountState, slewRate, site, solverConfigured, dark }: IPolarStartContext): string | undefined {
	if (camera.status !== 'ready') return camera.message
	if (!site) return 'Choose an active observing site for the profile.'
	if (!solverConfigured) return 'The plate solver is not configured.'
	if (dark?.enabled && dark.masterId === undefined) return 'Choose the master dark to subtract.'

	if (mode === 'manual') return mount.status === 'busy' ? mount.message : undefined

	if (mount.status !== 'ready') return mount.message
	if (!mountState) return 'The mount state is not known yet.'
	if (slewRate === undefined || !mountState.slewRates.some((rate) => rate.name === slewRate)) return 'Choose a slew rate.'
	if (mountState.parked || mountState.parking) return 'The mount is parked.'
	return undefined
}

// Returns the slew rate an automatic start sends: the form's when the mount still announces it, else the preset the
// mount uses now, else undefined, so a preset of another mount or one the driver dropped is never sent.
export function ipolarSlewRate(settings: Pick<IPolarSettings, 'slewRate'>, state: Pick<MountState, 'slewRates' | 'slewRate'> | undefined): string | undefined {
	const announced = (name: string | undefined) => name !== undefined && state?.slewRates.some((rate) => rate.name === name) === true
	return announced(settings.slewRate) ? settings.slewRate : announced(state?.slewRate) ? state?.slewRate : undefined
}

// Builds the start request of the iPolar form of a camera. The frames take the exposure time of the form and the
// camera settings of exposure, whose own exposure time is never sent, fitted to the camera's capabilities as a capture
// is, and are solved with the plate solving settings of the camera. The site is the active observing site, in radians
// and meters; the mount, when given, is the setup's; the rotation and the threshold are sent in radians. The master dark is
// sent only when it is enabled and pinned.
export function ipolarRequest(
	settings: Readonly<IPolarSettings>,
	exposure: Readonly<CameraExposureSettings>,
	solving: Readonly<CameraPlateSolvingSettings>,
	site: Pick<ObservingSite, 'name' | 'latitude' | 'longitude' | 'elevation'>,
	mount: { readonly connectionId: string; readonly deviceId: string } | undefined,
	slewRate: string | undefined,
	capabilities?: CameraCapabilities,
): Omit<IPolarRequest, 'token'> {
	return {
		mode: settings.mode,
		...(mount && { mount }),
		site: { name: site.name, latitude: site.latitude * DEG2RAD, longitude: site.longitude * DEG2RAD, elevation: site.elevation },
		refraction: settings.refraction,
		capture: fitExposure({ ...exposure, exposureTime: settings.exposureTime }, capabilities),
		solving: { ...solving },
		direction: settings.direction,
		...(settings.mode === 'automatic' && slewRate !== undefined && { slewRate }),
		rotation: settings.rotation * DEG2RAD,
		settleDelay: settings.settleDelay,
		refinementDelay: settings.refinementDelay,
		completionThreshold: settings.completionThreshold * ASEC2RAD,
		...(settings.dark?.enabled && settings.dark.masterId !== undefined && settings.dark.digest !== undefined && { dark: { masterId: settings.dark.masterId, digest: settings.dark.digest, onUnavailable: settings.dark.onUnavailable } }),
	}
}

// Returns whether a session is still running.
export function ipolarRunning(session: Pick<IPolarSessionSummary, 'endedAt'> | undefined): boolean {
	return session !== undefined && session.endedAt === undefined
}

// Role of an iPolar frame in its session.
export interface IPolarFrameRole {
	// Calibration pose the frame became, when accepted: 1 the reference, 2 after the RA rotation.
	readonly pose?: 1 | 2
	// Whether the frame was a second-pose candidate that did not calibrate.
	readonly rejected: boolean
	// Whether the frame belongs to the refinement.
	readonly refinement: boolean
}

// Returns what a frame of a session (by its session id and frame number) was in the session's record: a pose, a
// rejected candidate, or a refinement frame; undefined for a frame of another session or one not recorded yet.
export function ipolarFrameRole(session: Pick<IPolarSession, 'sessionId' | 'poses' | 'attempts' | 'calibration'> | undefined, frame: { readonly sessionId: string; readonly generation: number }): IPolarFrameRole | undefined {
	if (!session || session.sessionId !== frame.sessionId) return undefined
	const pose = session.poses.find((p) => p.frame === frame.generation)
	if (pose) return { pose: pose.pose, rejected: false, refinement: false }
	if (session.attempts.some((a) => a.frame === frame.generation)) return { rejected: true, refinement: false }
	if (session.calibration && frame.generation > session.calibration.frame) return { rejected: false, refinement: true }
	return undefined
}

// Applies an iPolar event (applySession); any other event is ignored.
export function handleIPolarEvent(state: IPolarRuntime, event: ServerEvent, request: typeof fetch = fetch) {
	if (event.type === 'ipolar:updated') applySession(state, IPOLAR_SESSIONS, event.session, request)
}

// Replaces the sessions with the server's snapshot and fetches their complete records (refreshSessionRecords).
export function refreshIPolar(state: IPolarRuntime, request: typeof fetch = fetch) {
	return refreshSessionRecords(state, IPOLAR_SESSIONS, request)
}

// Sends a command of a camera (sendSessionCommand).
function command(state: IPolarRuntime, key: string, url: string, body: unknown, request: typeof fetch) {
	return sendSessionCommand(state, key, url, jsonInit('POST', body), () => refreshIPolar(state, request), request)
}

// Sends a command of a session by the last segments of its URL.
function sessionCommand(state: IPolarRuntime, session: Pick<IPolarSessionSummary, 'sessionId' | 'camera'>, path: string, request: typeof fetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/ipolar/${encodeURIComponent(session.sessionId)}/${path}`, undefined, request)
}

// Starts an iPolar alignment with a camera; its progress arrives as events.
export function startIPolar(state: IPolarRuntime, connectionId: string, deviceId: string, body: Omit<IPolarRequest, 'token'>, request: typeof fetch = fetch) {
	const url = deviceUrl(connectionId, 'camera', deviceId, 'ipolar')
	return command(state, cameraKey(connectionId, deviceId), url, { ...body, token: nanoid() } satisfies IPolarRequest, request)
}

// Tells a manual session that the operator turned the RA axis; nothing is moved.
export function confirmIPolarRotation(state: IPolarRuntime, session: Pick<IPolarSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'rotation/confirm', request)
}

// Starts or resumes the refinement of a calibrated session.
export function startIPolarRefinement(state: IPolarRuntime, session: Pick<IPolarSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'refinement/start', request)
}

// Pauses the refinement of a session; its devices stay held.
export function stopIPolarRefinement(state: IPolarRuntime, session: Pick<IPolarSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'refinement/stop', request)
}

// Finishes a calibrated session as completed.
export function finishIPolar(state: IPolarRuntime, session: Pick<IPolarSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'finish', request)
}

// Stops the session of a camera; the server stops an automatic rotation and restores its slew rate when it can.
export function stopIPolar(state: IPolarRuntime, session: Pick<IPolarSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'stop', request)
}
