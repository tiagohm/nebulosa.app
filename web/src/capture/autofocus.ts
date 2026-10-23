import type { AutoFocusRequest, AutoFocusSession, AutoFocusSessionSummary, AutoFocusSnapshot, AutoFocusState, AutoFocusVerification, CameraCapabilities, CaptureSnoop, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { responseError } from '../http'
import { AUTO_FOCUS_APERTURE, type AutoFocusSettings, type CameraExposureSettings } from '../profile/profile'
import { cameraKey, fitExposure } from './capture'

// Auto Focus sessions as this tab knows them. The server owns every session, whichever tab started it, so
// this store only mirrors it: the compact summary of the latest session of each camera arrives with every
// autofocus:updated event and, on every socket (re)open, with the snapshot; the complete record (every
// measurement and the fitted curve) is fetched when a summary reports a new measurement or an end, never
// recomputed here. Cameras are addressed by their exact connection and device ids, never by role. A start
// carries a token, so a retried request answers the session of the first one instead of starting another.

// Auto Focus state of the tab.
export interface AutoFocusRuntime {
	// Latest session of each camera, by camera key (cameraKey).
	sessions: Record<string, AutoFocusSessionSummary>
	// Complete record of each session fetched so far, by session id.
	details: Record<string, AutoFocusSession>
	// Cameras with a start or stop of this tab waiting for the server.
	pending: Record<string, boolean>
	// Why this tab's last command to a camera failed; cleared by its next command.
	errors: Record<string, string>
}

// Auto Focus state of the tab.
export const autoFocusRuntime = proxy<AutoFocusRuntime>({ sessions: {}, details: {}, pending: {}, errors: {} })

// Counter of snapshot refreshes; a response is applied only if no later refresh started.
let generation = 0

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

// Returns whether a session is still running.
export function autoFocusRunning(session: Pick<AutoFocusSessionSummary, 'endedAt'> | undefined): boolean {
	return session !== undefined && session.endedAt === undefined
}

// Returns the step size the routine starts with for a focuser travel [min, max] in steps when the profile has
// none: a two-hundredth of the travel, at least one step.
export function defaultStepSize(min: number, max: number) {
	return Math.max(1, Math.round((max - min) / 200))
}

// Builds the start request of the Auto Focus form of a camera for a focuser. The frames take the exposure and camera
// settings (gain, offset, binning, subframe, readout mode) of the camera, fitted to its capabilities as a capture is,
// and snoop the mount, filter wheel, and rotator of snoop besides the focuser. stepSize is the step size shown, in
// steps.
export function autoFocusRequest(settings: Readonly<AutoFocusSettings>, exposure: Readonly<CameraExposureSettings>, focuser: { readonly connectionId: string; readonly deviceId: string }, stepSize: number, snoop: Readonly<CaptureSnoop>, capabilities?: CameraCapabilities): Omit<AutoFocusRequest, 'token'> {
	const { detector, acceptance } = settings.detection

	return {
		focuser,
		capture: fitExposure(exposure, capabilities),
		snoop: { mount: snoop.mount, wheel: snoop.wheel, rotator: snoop.rotator },
		// The built-in detector always measures with a grown aperture, the profile's or the default one.
		detection: { acceptance: { ...acceptance }, detector: detector.provider === 'builtin' ? { ...detector, maximumRadius: detector.maximumRadius ?? AUTO_FOCUS_APERTURE } : { ...detector } },
		fittingMode: settings.fittingMode,
		initialOffsetSteps: settings.initialOffsetSteps,
		stepSize,
		reversed: settings.reversed,
		rmsdThreshold: settings.rmsdThreshold,
		settleDelay: settings.settleDelay,
		measureTimeout: settings.measureTimeout,
	}
}

// Fetches the complete record of a session; a record with fewer measurements than the one known, as a late
// response can be, never replaces it, and a session the server no longer keeps is forgotten.
export async function loadAutoFocusSession(state: AutoFocusRuntime, sessionId: string, request: typeof fetch = fetch) {
	try {
		const response = await request(`/api/autofocus/${encodeURIComponent(sessionId)}`)

		if (response.status === 404) {
			delete state.details[sessionId]
			return
		}

		if (!response.ok) return
		const session = (await response.json()) as AutoFocusSession
		const known = state.details[sessionId]
		if (!known || session.measurements.length > known.measurements.length || (session.endedAt !== undefined && known.endedAt === undefined) || session.state !== known.state) state.details[sessionId] = session
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	}
}

// Applies an Auto Focus event; any other event is ignored. A session older than the one known for its camera
// never replaces it. The complete record is fetched again when the summary reports a new measurement, a
// best focus, or an end.
export function handleAutoFocusEvent(state: AutoFocusRuntime, event: ServerEvent, request: typeof fetch = fetch) {
	if (event.type !== 'autofocus:updated') return

	const { session } = event
	const key = cameraKey(session.camera.connectionId, session.camera.deviceId)
	const known = state.sessions[key]
	if (known && known.sessionId !== session.sessionId && known.startedAt > session.startedAt) return

	state.sessions[key] = session
	if (known?.sessionId !== session.sessionId) for (const id of Object.keys(state.details)) if (id !== session.sessionId) delete state.details[id]

	const details = state.details[session.sessionId]
	if (!details || details.measurements.length !== session.measurementCount || details.estimatedPosition !== session.estimatedPosition || (session.endedAt !== undefined && details.endedAt === undefined)) void loadAutoFocusSession(state, session.sessionId, request)
}

// Replaces the sessions with the server's snapshot, which may have changed while the socket was closed, and
// fetches their complete records. A response is dropped when another refresh started meanwhile.
export async function refreshAutoFocus(state: AutoFocusRuntime, request: typeof fetch = fetch) {
	const current = ++generation

	try {
		const response = await request('/api/autofocus')
		if (!response.ok || current !== generation) return
		const snapshot = (await response.json()) as AutoFocusSnapshot
		if (current !== generation) return

		state.sessions = {}
		for (const session of snapshot.sessions) state.sessions[cameraKey(session.camera.connectionId, session.camera.deviceId)] = session
		for (const id of Object.keys(state.details)) if (!snapshot.sessions.some((session) => session.sessionId === id)) delete state.details[id]
		for (const session of snapshot.sessions) void loadAutoFocusSession(state, session.sessionId, request)
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	}
}

// Sends a command of a camera and records its failure. When the server cannot be reached, the command may
// still have been applied, so the snapshot is fetched again instead of assuming nothing happened.
async function command(state: AutoFocusRuntime, key: string, url: string, body: unknown, request: typeof fetch) {
	if (state.pending[key]) return
	state.pending[key] = true
	delete state.errors[key]

	try {
		const response = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
		if (!response.ok) state.errors[key] = await responseError(response)
	} catch {
		state.errors[key] = 'Unable to reach the server.'
		await refreshAutoFocus(state, request)
	} finally {
		delete state.pending[key]
	}
}

// Starts an Auto Focus with a camera; its progress arrives as events.
export function startAutoFocus(state: AutoFocusRuntime, connectionId: string, deviceId: string, body: Omit<AutoFocusRequest, 'token'>, request: typeof fetch = fetch) {
	const url = `/api/connections/${encodeURIComponent(connectionId)}/cameras/${encodeURIComponent(deviceId)}/autofocus`
	return command(state, cameraKey(connectionId, deviceId), url, { ...body, token: crypto.randomUUID() } satisfies AutoFocusRequest, request)
}

// Stops the session of a camera where it stands; the focuser is not moved back.
export function stopAutoFocus(state: AutoFocusRuntime, session: Pick<AutoFocusSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/autofocus/${encodeURIComponent(session.sessionId)}/stop`, undefined, request)
}
