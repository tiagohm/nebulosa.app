import type { AutoFocusRequest, AutoFocusSession, AutoFocusSessionSummary, AutoFocusState, AutoFocusVerification, CameraCapabilities, CaptureSnoop, ServerEvent, StarDetectionRequest } from 'api'
import { nanoid } from 'nanoid'
import { proxy } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { formatPixelLength } from '../format'
import { type ApiFetch, browserFetch, deviceUrl, jsonInit } from '../http'
import type { AutoFocusSettings, CameraExposureSettings } from '../profile/schema'
import { SnapshotRefreshes } from '../refresh'
import { DEFAULT_APERTURE_RADIUS } from '../stars/stars'
import { cameraKey, fitExposure } from './capture'
import { applySession, type CameraSessionKind, type CameraSessionRecords, refreshSessionRecords, sendSessionCommand } from './sessions'

// Auto Focus sessions as this tab knows them. The server owns every session, whichever tab started it, so
// this store only mirrors it: the compact summary of the latest session of each camera arrives with every
// autofocus:updated event and, on every socket (re)open, with the snapshot; the complete record (every
// measurement and the fitted curve) is fetched when a summary reports a new measurement or an end, never
// recomputed here. Cameras are addressed by their exact connection and device ids, never by role. A start
// carries a token, so a retried request answers the session of the first one instead of starting another.

// Auto Focus state of the tab.
export type AutoFocusRuntime = CameraSessionRecords<AutoFocusSessionSummary, AutoFocusSession>

// Auto Focus state of the tab.
export const autoFocusRuntime = proxy<AutoFocusRuntime>({ sessions: {}, details: {}, pending: {}, errors: {} })

// How the sessions are mirrored (sessions.ts): the complete record is fetched again when the summary reports
// a new measurement, a best focus, or an end.
const AUTO_FOCUS_SESSIONS: CameraSessionKind<AutoFocusSessionSummary, AutoFocusSession> = {
	url: '/api/autofocus',
	refreshes: new SnapshotRefreshes(),
	stale: (session, _, details) => !details || details.measurements.length !== session.measurementCount || details.estimatedPosition !== session.estimatedPosition || (session.endedAt !== undefined && details.endedAt === undefined),
}

// Label of each session state.
export const AUTO_FOCUS_STATE_LABELS: Readonly<Record<AutoFocusState, string>> = {
	preparing: 'Preparing',
	moving: 'Moving',
	settling: 'Settling',
	exposing: 'Exposing',
	measuring: 'Measuring',
	applying: 'Moving to Best Focus',
	verifying: 'Verifying',
	restoring: 'Restoring Start Position',
	stopping: 'Stopping…',
	completed: 'Completed',
	failed: 'Failed',
	cancelled: 'Stopped',
}

// Label of each verification outcome.
export const VERIFICATION_LABELS: Readonly<Record<AutoFocusVerification, string>> = { pending: 'Pending', measured: 'Verified', noStars: 'Not verified: too few stars', failed: 'Not verified', skipped: 'Not verified' }

// Label of each fitting mode, in selector order.
export const FITTING_MODE_LABELS: Readonly<Record<AutoFocusRequest['fittingMode'], string>> = {
	HYPERBOLIC: 'Hyperbolic',
	PARABOLIC: 'Parabolic',
	TRENDLINES: 'Trend Lines',
	TREND_HYPERBOLIC: 'Hyperbolic + Trend Lines',
	TREND_PARABOLIC: 'Parabolic + Trend Lines',
}

// Fitting modes, in selector order.
export const FITTING_MODES = Object.keys(FITTING_MODE_LABELS) as AutoFocusRequest['fittingMode'][]

// Why an Auto Focus cannot run on a camera that has no focuser associated with it.
export const NO_FOCUSER = 'Auto Focus moves the Focuser of the Equipment Setup, which belongs to its Main Camera; assign this camera as the Main Camera to focus with it.'

// Positions the first pass of a sweep visits, in steps: the runner moves to the far end, then one step at a time
// back past the start position by one step, and only then extends the side that lacks positions.
export interface AutoFocusSweep {
	// Position the sweep starts at, Positions per Side steps outward (inward when reversed) of the start.
	readonly far: number
	// Position the first pass ends at, one step past the start on the other side.
	readonly near: number
}

// Returns the first pass of a sweep from a start position (steps) with the routine of a form and its step size
// (steps), as the toolkit's runner plans it.
export function autoFocusSweep(position: number, settings: Pick<AutoFocusSettings, 'initialOffsetSteps' | 'reversed'>, stepSize: number): AutoFocusSweep {
	const direction = settings.reversed ? -1 : 1
	return { far: position + direction * settings.initialOffsetSteps * stepSize, near: position - direction * stepSize }
}

// Returns why no session can start now, or undefined when one can, from the availability of the camera and of its
// focuser (undefined when the camera has no focuser associated with it), the focuser's reported state (undefined
// while unknown), whether the detector is ASTAP while ASTAP is not configured, and the first pass of the sweep, which
// must stay within the travel the focuser reports. The server checks again.
export function autoFocusBlocker(camera: RoleAvailability, focuser: RoleAvailability | undefined, focuserState: { readonly canAbsoluteMove: boolean; readonly position?: { readonly min: number; readonly max: number } } | undefined, astapMissing: boolean, sweep?: AutoFocusSweep): string | undefined {
	if (camera.status !== 'ready') return camera.message
	if (!focuser) return NO_FOCUSER
	if (focuser.status !== 'ready') return focuser.message
	if (!focuserState) return 'The focuser state is not known yet.'
	if (!focuserState.canAbsoluteMove) return 'The focuser cannot move to absolute positions, which the Auto Focus needs.'

	if (sweep && focuserState.position) {
		const { min, max } = focuserState.position
		const beyond = [sweep.far, sweep.near].find((position) => position < min || position > max)
		if (beyond !== undefined) return `The sweep would move the focuser to ${beyond} steps, outside its travel of ${min} to ${max} steps. Lower Step Size or Positions per Side.`
	}

	if (astapMissing) return 'ASTAP is not configured.'
	return undefined
}

// Description of each failure reason of a session without a detail, completing "Auto Focus failed: <text>."; the
// same words as the server's notification.
const FAILURE_REASON_TEXT: Readonly<Record<NonNullable<AutoFocusSessionSummary['reason']>, string>> = {
	busy: 'the device was busy',
	aborted: 'it was aborted',
	disconnected: 'a device disconnected',
	removed: 'a device was removed',
	timeout: 'it timed out',
	alert: 'the driver reported an alert',
	commandFailed: 'a command failed',
	unexpectedState: 'a device reached an unexpected state',
}

// Returns why a failed session failed, as its notification words it.
export function autoFocusFailureText(session: Pick<AutoFocusSessionSummary, 'reason' | 'error'>): string {
	return `Auto Focus failed: ${session.error ?? (session.reason ? FAILURE_REASON_TEXT[session.reason] : 'the cause was not reported')}.`
}

// Returns what to change before running again after a failed session, from its cause and the request it ran; undefined
// when nothing in the form would help.
export function autoFocusRemedy(session: Pick<AutoFocusSessionSummary, 'failure' | 'reason' | 'request'>): string | undefined {
	if (session.failure === 'outOfRange') return 'Lower Step Size or Positions per Side so the sweep stays within the focuser’s travel.'
	if (session.failure === 'curveRejected') return `Widen Step Size so the sweep crosses focus well on both sides${session.request.rmsdThreshold > 0 ? ', or raise Max RMSD / HFD' : ''}.`
	if (session.reason === 'timeout') return `Raise Measurement Timeout, ${session.request.measureTimeout} s, in Advanced Settings.`
	return undefined
}

// Returns where a session that did not complete left the focuser, from whether it stands at the start position and the
// position the focuser reports now (steps; undefined while unknown); undefined for a running or completed session, or a
// failure that never knew the start position.
export function autoFocusLeftAt(session: Pick<AutoFocusSessionSummary, 'state' | 'restored' | 'initialPosition'>, position: number | undefined): string | undefined {
	if (session.state !== 'failed' && session.state !== 'cancelled') return undefined
	const now = position === undefined ? '' : ` and stands at ${position} steps`
	if (session.restored && session.initialPosition !== undefined) return `The focuser stands at its start position, ${session.initialPosition} steps.`
	if (session.restored === false) return `The focuser could not be moved back to its start position${session.initialPosition === undefined ? '' : `, ${session.initialPosition} steps,`}${now}.`
	if (session.state === 'cancelled') return `The focuser was left where the stop found it${position === undefined ? '' : `, at ${position} steps`}.`
	return undefined
}

// Returns the one-line summary of a session: its state, and once completed the position reached and the HFD verified
// there.
export function autoFocusSummaryText(session: Pick<AutoFocusSessionSummary, 'state' | 'finalPosition' | 'verification' | 'verifiedHfd'>): string {
	const parts = [AUTO_FOCUS_STATE_LABELS[session.state]]

	if (session.state === 'completed') {
		if (session.finalPosition !== undefined) parts.push(`${session.finalPosition} steps`)
		if (session.verification === 'measured' && session.verifiedHfd !== undefined) parts.push(formatPixelLength(session.verifiedHfd))
	}

	return parts.join(' · ')
}

// Focuser position of an Auto Focus frame, as its session recorded it.
export interface AutoFocusFrameFocus {
	// Logical focuser position the frame was taken at, in steps.
	readonly position: number
	// Whether the frame is the verification frame at the best focus rather than a sample.
	readonly verification: boolean
}

// Returns where the focuser stood for a frame of a session (by its session id, frame number, and document), from the
// session's record: the observed position of its measurement, or the final position for the verification frame; undefined
// for a frame of another session or one not recorded yet, never a guess.
export function autoFocusFrameFocus(session: Pick<AutoFocusSession, 'sessionId' | 'measurements' | 'verificationImageId' | 'finalPosition'> | undefined, frame: { readonly sessionId: string; readonly generation: number; readonly imageId?: string }): AutoFocusFrameFocus | undefined {
	if (!session || session.sessionId !== frame.sessionId) return undefined
	const measurement = session.measurements.find((m) => m.capture === frame.generation)
	if (measurement) return { position: measurement.observedPosition, verification: false }
	if (frame.imageId !== undefined && frame.imageId === session.verificationImageId && session.finalPosition !== undefined) return { position: session.finalPosition, verification: true }
	return undefined
}

// Returns whether a session is still running.
export function autoFocusRunning(session: Pick<AutoFocusSessionSummary, 'endedAt'> | undefined): boolean {
	return session !== undefined && session.endedAt === undefined
}

// Returns the step size the routine starts with for a focuser travel [min, max] in steps when the profile has
// none: a two-hundredth of the travel, at least one step.
export function defaultStepSize(min: number, max: number) {
	return Math.max(1, Math.round((max - min) / 200))
}

// Step size of a form without a saved one while the focuser reports no travel, in steps.
const FALLBACK_STEP_SIZE = 100

// Returns the step size of a form, in steps: the saved one, else a two-hundredth of the travel of a connected focuser
// that reports one, else FALLBACK_STEP_SIZE.
export function autoFocusStepSize(saved: number | undefined, focuser: { readonly connected: boolean; readonly position: { readonly min: number; readonly max: number } } | undefined): number {
	if (saved !== undefined) return saved
	return focuser?.connected && focuser.position.max > focuser.position.min ? defaultStepSize(focuser.position.min, focuser.position.max) : FALLBACK_STEP_SIZE
}

// Builds the start request of the Auto Focus form of a camera for a focuser. The frames take the exposure time of the
// form and the camera settings (gain, offset, binning, subframe, readout mode) of exposure, whose own exposure time is
// never sent, fitted to the camera's capabilities as a capture is, and snoop the mount, filter wheel, and rotator of
// snoop besides the focuser; they are measured with detection, the star detection request of the profile. stepSize is
// the step size shown, in steps.
export function autoFocusRequest(
	settings: Readonly<AutoFocusSettings>,
	detection: Readonly<StarDetectionRequest>,
	exposure: Readonly<CameraExposureSettings>,
	focuser: { readonly connectionId: string; readonly deviceId: string },
	stepSize: number,
	snoop: Readonly<CaptureSnoop>,
	capabilities?: CameraCapabilities,
): Omit<AutoFocusRequest, 'token'> {
	const { detector, acceptance } = detection

	return {
		focuser,
		capture: fitExposure({ ...exposure, exposureTime: settings.exposureTime }, capabilities),
		snoop: { mount: snoop.mount, wheel: snoop.wheel, rotator: snoop.rotator },
		// The built-in detector always measures with a grown aperture, the profile's or the default one.
		detection: { acceptance: { ...acceptance }, detector: detector.provider === 'nebulosa' ? { ...detector, maximumRadius: detector.maximumRadius ?? DEFAULT_APERTURE_RADIUS } : { ...detector } },
		fittingMode: settings.fittingMode,
		initialOffsetSteps: settings.initialOffsetSteps,
		stepSize,
		reversed: settings.reversed,
		rmsdThreshold: settings.rmsdThreshold,
		settleDelay: settings.settleDelay,
		measureTimeout: settings.measureTimeout,
		restoreOnStop: settings.restoreOnStop,
	}
}

// Applies a Auto Focus event (applySession); any other event is ignored.
export function handleAutoFocusEvent(state: AutoFocusRuntime, event: ServerEvent, request: ApiFetch = browserFetch) {
	if (event.type === 'autofocus:updated') applySession(state, AUTO_FOCUS_SESSIONS, event.session, request)
}

// Replaces the sessions with the server's snapshot and fetches their complete records (refreshSessionRecords).
export function refreshAutoFocus(state: AutoFocusRuntime, request: ApiFetch = browserFetch) {
	return refreshSessionRecords(state, AUTO_FOCUS_SESSIONS, request)
}

// Sends a command of a camera (sendSessionCommand).
function command(state: AutoFocusRuntime, key: string, url: string, body: unknown, request: ApiFetch) {
	return sendSessionCommand(state, key, url, jsonInit('POST', body), () => refreshAutoFocus(state, request), request)
}

// Starts an Auto Focus with a camera; its progress arrives as events.
export function startAutoFocus(state: AutoFocusRuntime, connectionId: string, deviceId: string, body: Omit<AutoFocusRequest, 'token'>, request: ApiFetch = browserFetch) {
	const url = deviceUrl(connectionId, 'camera', deviceId, 'autofocus')
	return command(state, cameraKey(connectionId, deviceId), url, { ...body, token: nanoid() } satisfies AutoFocusRequest, request)
}

// Stops the session of a camera. A first stop of a session whose request restores on stop moves the focuser back to the
// start position; any other stop leaves it where it stands.
export function stopAutoFocus(state: AutoFocusRuntime, session: Pick<AutoFocusSessionSummary, 'sessionId' | 'camera'>, request: ApiFetch = browserFetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/autofocus/${encodeURIComponent(session.sessionId)}/stop`, undefined, request)
}
