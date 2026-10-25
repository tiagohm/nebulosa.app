import type { CameraCapabilities, DarvCaptureSettings, DarvFinishRequest, DarvMeasurement, DarvMeasurementRequest, DarvMeasurementState, DarvMeasurementStatus, DarvRequest, DarvSession, DarvSessionSummary, DarvSnapshot, MountState, ServerEvent } from 'api'
import { nanoid } from 'nanoid'
import type { DarvAnalysisFailureReason } from 'nebulosa/src/observation/alignment/polaralignment.darv.analysis'
import { proxy } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { deviceUrl, jsonInit, responseError } from '../http'
import type { CameraExposureSettings, DarvSettings } from '../profile/schema'
import { cameraKey, fitExposure } from './capture'

// DARV sessions as this tab knows them. The server owns every session, whichever tab started it, and every motion,
// exposure, and analysis of it, so this store only mirrors it: the compact summary of the latest session of each
// camera, with its measurements, arrives with every darv:updated event and, on every socket (re)open, with the
// snapshot; the complete record (the trails of the analyzed measurements) is fetched when a summary reports a new
// result or an end. Summaries are ordered by their revision, so a late event never replaces a newer state. Cameras and
// mounts are addressed by their exact connection and device ids, never by role. Every start carries a token, so a
// retried request answers the measurement of the first one instead of starting another.

// DARV state of the tab.
export interface DarvRuntime {
	// Latest session of each camera, by camera key (cameraKey).
	sessions: Record<string, DarvSessionSummary>
	// Complete record of each session fetched so far, by session id.
	details: Record<string, DarvSession>
	// Cameras with a command of this tab waiting for the server.
	pending: Record<string, boolean>
	// Why this tab's last command to a camera failed; cleared by its next command.
	errors: Record<string, string>
}

// DARV state of the tab.
export const darvRuntime = proxy<DarvRuntime>({ sessions: {}, details: {}, pending: {}, errors: {} })

// Counter of snapshot refreshes; a response is applied only if no later refresh started.
let generation = 0

// Label of each measurement state.
export const DARV_STATE_LABELS: Readonly<Record<DarvMeasurementState, string>> = {
	preparing: 'Preparing',
	exposing: 'Exposing, stars still',
	outbound: 'Moving out in RA',
	reversing: 'Reversing',
	inbound: 'Moving back in RA',
	finishing: 'Finishing the exposure',
	analyzing: 'Analyzing the trails',
	ready: 'Ready',
	failed: 'Failed',
	aborted: 'Aborted',
}

// Phases a measurement goes through while it runs, in order.
export const DARV_PHASES = ['preparing', 'exposing', 'outbound', 'reversing', 'inbound', 'finishing', 'analyzing'] as const satisfies readonly DarvMeasurementState[]

// Phases during which the shutter is open.
const EXPOSING_PHASES: ReadonlySet<DarvMeasurementState> = new Set(['exposing', 'outbound', 'reversing', 'inbound', 'finishing'])

// Progress of a running measurement at now (Unix milliseconds): the 1-based step of its phase among DARV_PHASES
// (undefined once it ended), and the fraction of its exposure elapsed, in [0, 1], while the shutter is open
// (undefined before it opened and during the analysis, whose length is unknown). The elapsed time runs from the
// instant the exposure was requested, so it leads the shutter by the camera's start latency.
export function darvProgress(measurement: Pick<DarvMeasurement, 'state' | 'exposure' | 'exposureStartedAt'>, now: number): { readonly step?: number; readonly elapsed?: number; readonly fraction?: number } {
	const index = (DARV_PHASES as readonly DarvMeasurementState[]).indexOf(measurement.state)
	const step = index >= 0 ? index + 1 : undefined
	if (measurement.exposureStartedAt === undefined || !EXPOSING_PHASES.has(measurement.state)) return { step }
	const elapsed = Math.min(measurement.exposure, Math.max(0, (now - measurement.exposureStartedAt) / 1000))
	return { step, elapsed, fraction: elapsed / measurement.exposure }
}

// Label of each analysis outcome.
export const DARV_STATUS_LABELS: Readonly<Record<DarvMeasurementStatus, string>> = { measured: 'Measured', limited: 'Limited', inconclusive: 'Inconclusive' }

// Label of each RA direction.
export const DARV_DIRECTION_LABELS: Readonly<Record<DarvSettings['direction'], string>> = { EAST: 'East', WEST: 'West' }

// RA directions, in selector order.
export const DARV_DIRECTIONS = Object.keys(DARV_DIRECTION_LABELS) as DarvSettings['direction'][]

// Label of each adjusted axis.
export const DARV_AXIS_LABELS: Readonly<Record<DarvSettings['axis'], string>> = { azimuth: 'Azimuth', altitude: 'Altitude' }

// Adjusted axes, in selector order.
export const DARV_AXES = Object.keys(DARV_AXIS_LABELS) as DarvSettings['axis'][]

// Where to point for each axis: the geometry where its polar error drifts fastest.
export const DARV_AXIS_HINTS: Readonly<Record<DarvSettings['axis'], string>> = {
	azimuth: 'Point at a star near the meridian and the celestial equator; the trails diverge with the azimuth error.',
	altitude: 'Point at a star low in the east or west, near the celestial equator; the trails diverge with the altitude error.',
}

// Explanation of each analysis diagnostic the operator can act on; the others need no explanation.
export const DARV_DIAGNOSTIC_LABELS: Readonly<Partial<Record<DarvAnalysisFailureReason, string>>> = {
	noStreaks: 'No trail was found.',
	noCompatibleLegPair: 'No outbound and return trails could be paired.',
	trailTooShort: 'Some trails are too short; lengthen the legs or use a faster rate.',
	trailClipped: 'Some trails leave the frame.',
	trailSaturated: 'Some trails are saturated; lower the gain or pick a fainter star.',
	ambiguousTrails: 'Some trails overlap others.',
	insufficientSnr: 'Some trails are too faint.',
	fitFailed: 'Some trails could not be fitted.',
	invalidTiming: 'The timing of the frame is inconsistent.',
	candidateLimit: 'Too many trails; only the brightest were measured.',
	outlierTrails: 'Some trails disagree with the others and were left out.',
}

// Returns why the mount can never run DARV, from the state the server reports, or undefined when it can (or its
// state is not known yet): an alt-az mount, no west-east motion, no abort, or no slew-rate preset to choose.
export function darvMountSupport(state: Pick<MountState, 'mountType' | 'canMove' | 'canMoveWE' | 'canAbort' | 'slewRates'> | undefined): string | undefined {
	if (!state) return undefined
	if (state.mountType === 'ALTAZ') return 'The mount is not equatorial; DARV aligns the polar axis of an equatorial mount.'
	if (!state.canMove || !state.canMoveWE) return 'The mount cannot move west-east, which DARV needs.'
	if (!state.canAbort) return 'The mount cannot abort a motion, which DARV needs to stop safely.'
	if (state.slewRates.length === 0) return 'The mount offers no slew rate to choose.'
	return undefined
}

// Returns why no measurement can start now, or undefined when one can, from the availability of the camera and of
// the setup's mount (unsupported per darvMountSupport), the mount's reported state (undefined while unknown), and the
// slew rate a start would send (darvSlewRate). A mount that is not tracking is accepted when it can switch tracking,
// which the server starts for the measurement. The server checks again.
export function darvBlocker(camera: RoleAvailability, mount: RoleAvailability, state: MountState | undefined, slewRate: string | undefined): string | undefined {
	if (camera.status !== 'ready') return camera.message
	if (mount.status !== 'ready') return mount.message
	if (!state) return 'The mount state is not known yet.'
	if (slewRate === undefined || !state.slewRates.some((rate) => rate.name === slewRate)) return 'Choose a slew rate.'
	if (state.parked || state.parking) return 'The mount is parked.'
	if (!state.tracking && !state.canTracking) return 'The mount is not tracking and cannot start tracking.'
	return undefined
}

// Returns the slew rate a start sends: the form's when the mount still announces it, else the preset the mount uses
// now, else undefined, so a preset of another mount or one the driver dropped is never sent.
export function darvSlewRate(settings: Pick<DarvSettings, 'slewRate'>, state: Pick<MountState, 'slewRates' | 'slewRate'> | undefined): string | undefined {
	const announced = (name: string | undefined) => name !== undefined && state?.slewRates.some((rate) => rate.name === name) === true
	return announced(settings.slewRate) ? settings.slewRate : announced(state?.slewRate) ? state?.slewRate : undefined
}

// Builds the measurement request of the DARV form of a camera with a slew rate. The frame takes the camera settings of
// the camera, fitted to its capabilities as a capture is, but never its exposure time, which the server derives from
// the leg duration.
export function darvMeasurementRequest(settings: Readonly<DarvSettings>, exposure: Readonly<CameraExposureSettings>, slewRate: string, capabilities?: CameraCapabilities): Omit<DarvMeasurementRequest, 'token'> {
	const { exposureTime: _, ...capture } = fitExposure(exposure, capabilities)
	return { capture: capture satisfies DarvCaptureSettings, axis: settings.axis, direction: settings.direction, slewRate, legDuration: settings.legDuration }
}

// Returns whether a session is measuring.
export function darvMeasuring(session: Pick<DarvSessionSummary, 'state'> | undefined): boolean {
	return session?.state === 'measuring'
}

// Returns whether a session is open: it can measure again.
export function darvOpen(session: Pick<DarvSessionSummary, 'state'> | undefined): boolean {
	return session !== undefined && session.state !== 'finished'
}

// Returns the analyzed measurement before the latest one when both ran with the same settings, so their drifts can
// be compared; undefined otherwise (a different leg, rate, direction, or frame makes the numbers incomparable).
export function darvComparable(measurements: readonly DarvMeasurement[]): DarvMeasurement | undefined {
	const latest = measurements.at(-1)
	if (latest?.result?.driftMagnitude === undefined) return undefined

	for (let i = measurements.length - 2; i >= 0; i--) {
		const previous = measurements[i]
		if (previous.result?.driftMagnitude === undefined) continue
		return JSON.stringify(previous.request) === JSON.stringify(latest.request) ? previous : undefined
	}

	return undefined
}

// Returns the measurement a frame of a session (by its session id and generation) belongs to, or undefined.
export function darvFrameMeasurement(session: Pick<DarvSessionSummary, 'sessionId' | 'measurements'> | undefined, frame: { readonly sessionId: string; readonly generation: number }): DarvMeasurement | undefined {
	if (!session || session.sessionId !== frame.sessionId) return undefined
	return session.measurements.find((measurement) => measurement.generation === frame.generation)
}

// Fetches the complete record of a session; a record older than the one known (a late response) never replaces it,
// and a session the server no longer keeps is forgotten.
export async function loadDarvSession(state: DarvRuntime, sessionId: string, request: typeof fetch = fetch) {
	try {
		const response = await request(`/api/darv/${encodeURIComponent(sessionId)}`)

		if (response.status === 404) {
			delete state.details[sessionId]
			return
		}

		if (!response.ok) return
		const session = (await response.json()) as DarvSession
		const known = state.details[sessionId]
		if (!known || session.revision > known.revision) state.details[sessionId] = session
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	}
}

// Number of analyzed measurements of a session, which tells whether its record has new trails.
function analyzed(session: Pick<DarvSessionSummary, 'measurements'>) {
	return session.measurements.filter((measurement) => measurement.result !== undefined).length
}

// Applies a DARV event; any other event is ignored. A session older than the one known for its camera, or an earlier
// revision of the same one, never replaces it. The complete record is fetched again when the summary reports a new
// analysis.
export function handleDarvEvent(state: DarvRuntime, event: ServerEvent, request: typeof fetch = fetch) {
	if (event.type !== 'darv:updated') return

	const { session } = event
	const key = cameraKey(session.camera.connectionId, session.camera.deviceId)
	const known = state.sessions[key]
	if (known && known.sessionId !== session.sessionId && known.startedAt > session.startedAt) return
	if (known?.sessionId === session.sessionId && known.revision >= session.revision) return

	state.sessions[key] = session
	if (known?.sessionId !== session.sessionId) for (const id of Object.keys(state.details)) if (id !== session.sessionId) delete state.details[id]

	const details = state.details[session.sessionId]
	if (!details || analyzed(details) !== analyzed(session)) void loadDarvSession(state, session.sessionId, request)
}

// Replaces the sessions with the server's snapshot, which may have changed while the socket was closed, and fetches
// their complete records. A response is dropped when another refresh started meanwhile.
export async function refreshDarv(state: DarvRuntime, request: typeof fetch = fetch) {
	const current = ++generation

	try {
		const response = await request('/api/darv')
		if (!response.ok || current !== generation) return
		const snapshot = (await response.json()) as DarvSnapshot
		if (current !== generation) return

		state.sessions = {}
		for (const session of snapshot.sessions) state.sessions[cameraKey(session.camera.connectionId, session.camera.deviceId)] = session
		for (const id of Object.keys(state.details)) if (!snapshot.sessions.some((session) => session.sessionId === id)) delete state.details[id]
		for (const session of snapshot.sessions) void loadDarvSession(state, session.sessionId, request)
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	}
}

// Sends a command of a camera and records its failure. When the server cannot be reached, the command may still have
// been applied, so the snapshot is fetched again instead of assuming nothing happened.
async function command(state: DarvRuntime, key: string, url: string, body: unknown, request: typeof fetch) {
	if (state.pending[key]) return
	state.pending[key] = true
	delete state.errors[key]

	try {
		const response = await request(url, jsonInit('POST', body))
		if (!response.ok) state.errors[key] = await responseError(response)
	} catch {
		state.errors[key] = 'Unable to reach the server.'
		await refreshDarv(state, request)
	} finally {
		delete state.pending[key]
	}
}

// Starts a DARV session with a camera and a mount, and its first measurement; progress arrives as events.
export function startDarv(state: DarvRuntime, connectionId: string, deviceId: string, mount: DarvRequest['mount'], body: Omit<DarvMeasurementRequest, 'token'>, request: typeof fetch = fetch) {
	const url = deviceUrl(connectionId, 'camera', deviceId, 'darv')
	return command(state, cameraKey(connectionId, deviceId), url, { ...body, mount, token: nanoid() } satisfies DarvRequest, request)
}

// Starts another measurement of an open session, after the operator adjusted the mount.
export function repeatDarv(state: DarvRuntime, session: Pick<DarvSessionSummary, 'sessionId' | 'camera'>, body: Omit<DarvMeasurementRequest, 'token'>, request: typeof fetch = fetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/darv/${encodeURIComponent(session.sessionId)}/measurements`, { ...body, token: nanoid() } satisfies DarvMeasurementRequest, request)
}

// Aborts the measurement of a session; the server stops the mount, discards the exposure, and restores the slew rate.
export function abortDarv(state: DarvRuntime, session: Pick<DarvSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/darv/${encodeURIComponent(session.sessionId)}/abort`, undefined, request)
}

// Finishes an idle session; stopTracking asks the server to stop the tracking its measurements started.
export function finishDarv(state: DarvRuntime, session: Pick<DarvSessionSummary, 'sessionId' | 'camera'>, stopTracking: boolean, request: typeof fetch = fetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/darv/${encodeURIComponent(session.sessionId)}/finish`, { stopTracking } satisfies DarvFinishRequest, request)
}
