import type { CameraCapabilities, DarvCaptureSettings, DarvFinishRequest, DarvMeasurement, DarvMeasurementRequest, DarvMeasurementState, DarvMeasurementStatus, DarvRequest, DarvSession, DarvSessionSummary, MountState, ServerEvent } from 'api'
import { nanoid } from 'nanoid'
import type { DarvAnalysisFailureReason } from 'nebulosa/src/observation/alignment/darv.analysis'
import { proxy } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { type ApiFetch, browserFetch, deviceUrl, jsonInit } from '../http'
import type { CameraExposureSettings, DarvSettings } from '../profile/schema'
import { SnapshotRefreshes } from '../refresh'
import { cameraKey, fitExposure } from './capture'
import { applySession, type CameraSessionKind, type CameraSessionRecords, refreshSessionRecords, sendSessionCommand } from './sessions'

// DARV sessions as this tab knows them. The server owns every session, whichever tab started it, and every motion,
// exposure, and analysis of it, so this store only mirrors it: the compact summary of the latest session of each
// camera, with its measurements, arrives with every darv:updated event and, on every socket (re)open, with the
// snapshot; the complete record (the trails of the analyzed measurements) is fetched when a summary reports a new
// result or an end. Summaries are ordered by their revision, so a late event never replaces a newer state. Cameras and
// mounts are addressed by their exact connection and device ids, never by role. Every start carries a token, so a
// retried request answers the measurement of the first one instead of starting another. The drifts of a session are
// read here too: how the latest one moved since the previous comparable one, and what that says about the last turn of
// the knob, since the drift alone has no sign.

// DARV state of the tab.
export type DarvRuntime = CameraSessionRecords<DarvSessionSummary, DarvSession>

// DARV state of the tab.
export const darvRuntime = proxy<DarvRuntime>({ sessions: {}, details: {}, pending: {}, errors: {} })

// How the sessions are mirrored (sessions.ts): the complete record is fetched again when the summary reports
// a new analysis.
const DARV_SESSIONS: CameraSessionKind<DarvSessionSummary, DarvSession> = {
	url: '/api/darv',
	refreshes: new SnapshotRefreshes(),
	stale: (session, _, details) => !details || analyzed(details) !== analyzed(session),
}

// Label of each measurement state.
export const DARV_STATE_LABELS: Readonly<Record<DarvMeasurementState, string>> = {
	preparing: 'Preparing',
	exposing: 'Exposing, stars still',
	outbound: 'Moving out in RA',
	reversing: 'Reversing',
	inbound: 'Moving back in RA',
	finishing: 'Finishing the exposure',
	analyzing: 'Analyzing the trails',
	ready: 'Done',
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

// Returns the separation drift of a measurement in pixels per second: three decimals, or exponential notation below
// 0.01 px/s, so a nearly aligned axis never reads as no drift at all: "0.123 px/s", "4.2e-3 px/s".
export function formatDarvDrift(drift: number) {
	return `${drift < 0.01 ? drift.toExponential(1) : drift.toFixed(3)} px/s`
}

// Returns whether a session is measuring.
export function darvMeasuring(session: Pick<DarvSessionSummary, 'state'> | undefined): boolean {
	return session?.state === 'measuring'
}

// Returns whether a session is open: it can measure again.
export function darvOpen(session: Pick<DarvSessionSummary, 'state'> | undefined): boolean {
	return session !== undefined && session.state !== 'finished'
}

// Relative change of the separation drift within which two comparable measurements read as unchanged: 0.1 (10 %). A
// margin of this panel, not a measured scatter, so a smaller change is never taken as evidence that a turn of the
// knob helped or hurt.
export const DARV_UNCHANGED_DRIFT = 0.1

// How the drift of a measurement compares with the previous comparable one, as the knob loop reads it:
// - better: it fell, so the last turn went the right way.
// - worse: it grew, so the last turn went the wrong way.
// - passed: it grew right after it fell, so the last turn went past the best position.
// - unchanged: it moved by less than DARV_UNCHANGED_DRIFT.
export type DarvTrend = 'better' | 'worse' | 'passed' | 'unchanged'

// Words of each trend, as the history reads them.
export const DARV_TREND_LABELS: Readonly<Record<DarvTrend, string>> = { better: 'better', worse: 'worse', passed: 'worse, past the best', unchanged: 'about the same' }

// Returns how a drift moved since a previous measurement, in words, with the previous drift: "Better than #2
// (0.200 px/s)", "Worse than #2 (0.200 px/s), past the best", "About the same as #2 (0.200 px/s)".
export function darvTrendText(trend: DarvTrend, previous: Pick<DarvMeasurement, 'generation' | 'result'>): string {
	const than = `#${previous.generation} (${formatDarvDrift(previous.result!.driftMagnitude!)})`
	if (trend === 'unchanged') return `About the same as ${than}`
	return trend === 'better' ? `Better than ${than}` : trend === 'worse' ? `Worse than ${than}` : `Worse than ${than}, past the best`
}

// The latest drift of a session and how it moved.
export interface DarvDriftReading {
	// Latest measured measurement, which may precede a later aborted, failed, or unmeasured one.
	readonly measurement: DarvMeasurement
	// Measured measurement before it, when both ran with the same settings.
	readonly previous?: DarvMeasurement
	// Measured measurement before it whose settings differ, so the drifts are not compared.
	readonly changed?: DarvMeasurement
	// How the drift moved since previous; absent without one.
	readonly trend?: DarvTrend
}

// Returns the latest drift of a session's measurements (oldest first) and how it moved since the measured one before
// it, which counts only when both ran with the same settings (a different leg, rate, direction, axis, or frame makes
// the numbers incomparable); undefined before any measurement was measured.
export function darvDriftReading(measurements: readonly DarvMeasurement[]): DarvDriftReading | undefined {
	const index = measurements.findLastIndex(measured)
	if (index < 0) return undefined

	const measurement = measurements[index]
	const previous = earlierMeasured(measurements, index)
	if (previous === undefined) return { measurement }
	if (!sameSettings(previous.measurement, measurement)) return { measurement, changed: previous.measurement }

	const step = driftChange(previous.measurement, measurement)
	if (step !== 'worse') return { measurement, previous: previous.measurement, trend: step }

	const before = earlierMeasured(measurements, previous.index)
	const passed = before !== undefined && sameSettings(before.measurement, measurement) && driftChange(before.measurement, previous.measurement) === 'better'
	return { measurement, previous: previous.measurement, trend: passed ? 'passed' : 'worse' }
}

// Returns what the operator does next after the latest measurement of an open session, given its drift reading, or
// undefined while it runs or when it ended without an analysis: the knob loop for a measured drift (turn either way
// first, keep going while it falls, reverse when it grows, go back half way once it passed the best position), and
// the remedy of a frame whose trails could not be measured.
export function darvAdvice(latest: DarvMeasurement | undefined, reading: DarvDriftReading | undefined): string | undefined {
	if (latest?.state !== 'ready' || !latest.result) return undefined
	const knob = `the ${DARV_AXIS_LABELS[latest.request.axis].toLowerCase()} knob`

	if (latest.result.status === 'inconclusive') return 'No drift to compare: lengthen the legs or use a faster slew rate, check the focus and that a star is in the frame, then repeat the measurement.'
	if (latest.result.status === 'limited') return 'The trails could not be measured fully: judge the separation on the frame, or lengthen the legs and repeat the measurement.'
	if (reading?.measurement !== latest) return undefined

	switch (reading.trend) {
		case 'better':
			return `Keep turning ${knob} the same way, then repeat the measurement.`
		case 'worse':
			return `Turn ${knob} back the other way, past where it was for #${reading.previous!.generation}, then repeat the measurement.`
		case 'passed':
			return `The best position was passed: turn ${knob} back about half as far as the last turn, then repeat the measurement.`
		case 'unchanged':
			return `Turn ${knob} a little further the same way, then repeat the measurement.`
		default:
			return `Turn ${knob} a little either way, then repeat the measurement; the next drift tells whether to keep going or turn back.`
	}
}

// Returns whether a measurement has a measured drift.
function measured(measurement: DarvMeasurement) {
	return measurement.result?.driftMagnitude !== undefined
}

// Returns the measured measurement nearest before index, with its index, or undefined.
function earlierMeasured(measurements: readonly DarvMeasurement[], index: number) {
	for (let i = index - 1; i >= 0; i--) if (measured(measurements[i])) return { measurement: measurements[i], index: i }
	return undefined
}

// Returns whether two measurements ran with the same settings, so their drifts compare.
function sameSettings(a: DarvMeasurement, b: DarvMeasurement) {
	return JSON.stringify(a.request) === JSON.stringify(b.request)
}

// Returns how the drift of a measured measurement moved from an earlier measured one: better, worse, or unchanged
// within DARV_UNCHANGED_DRIFT of the earlier drift.
function driftChange(earlier: DarvMeasurement, later: DarvMeasurement): 'better' | 'worse' | 'unchanged' {
	const before = earlier.result!.driftMagnitude!
	const after = later.result!.driftMagnitude!
	if (Math.abs(after - before) <= DARV_UNCHANGED_DRIFT * before) return 'unchanged'
	return after < before ? 'better' : 'worse'
}

// Returns the measurement a frame of a session (by its session id and generation) belongs to, or undefined.
export function darvFrameMeasurement(session: Pick<DarvSessionSummary, 'sessionId' | 'measurements'> | undefined, frame: { readonly sessionId: string; readonly generation: number }): DarvMeasurement | undefined {
	if (!session || session.sessionId !== frame.sessionId) return undefined
	return session.measurements.find((measurement) => measurement.generation === frame.generation)
}

// Number of analyzed measurements of a session, which tells whether its record has new trails.
function analyzed(session: Pick<DarvSessionSummary, 'measurements'>) {
	return session.measurements.filter((measurement) => measurement.result !== undefined).length
}

// Applies a DARV event (applySession); any other event is ignored.
export function handleDarvEvent(state: DarvRuntime, event: ServerEvent, request: ApiFetch = browserFetch) {
	if (event.type === 'darv:updated') applySession(state, DARV_SESSIONS, event.session, request)
}

// Replaces the sessions with the server's snapshot and fetches their complete records (refreshSessionRecords).
export function refreshDarv(state: DarvRuntime, request: ApiFetch = browserFetch) {
	return refreshSessionRecords(state, DARV_SESSIONS, request)
}

// Sends a command of a camera (sendSessionCommand).
function command(state: DarvRuntime, key: string, url: string, body: unknown, request: ApiFetch) {
	return sendSessionCommand(state, key, url, jsonInit('POST', body), () => refreshDarv(state, request), request)
}

// Starts a DARV session with a camera and a mount, and its first measurement; progress arrives as events.
export function startDarv(state: DarvRuntime, connectionId: string, deviceId: string, mount: DarvRequest['mount'], body: Omit<DarvMeasurementRequest, 'token'>, request: ApiFetch = browserFetch) {
	const url = deviceUrl(connectionId, 'camera', deviceId, 'darv')
	return command(state, cameraKey(connectionId, deviceId), url, { ...body, mount, token: nanoid() } satisfies DarvRequest, request)
}

// Starts another measurement of an open session, after the operator adjusted the mount.
export function repeatDarv(state: DarvRuntime, session: Pick<DarvSessionSummary, 'sessionId' | 'camera'>, body: Omit<DarvMeasurementRequest, 'token'>, request: ApiFetch = browserFetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/darv/${encodeURIComponent(session.sessionId)}/measurements`, { ...body, token: nanoid() } satisfies DarvMeasurementRequest, request)
}

// Aborts the measurement of a session; the server stops the mount, discards the exposure, and restores the slew rate.
export function abortDarv(state: DarvRuntime, session: Pick<DarvSessionSummary, 'sessionId' | 'camera'>, request: ApiFetch = browserFetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/darv/${encodeURIComponent(session.sessionId)}/abort`, undefined, request)
}

// Finishes an idle session; stopTracking asks the server to stop the tracking its measurements started.
export function finishDarv(state: DarvRuntime, session: Pick<DarvSessionSummary, 'sessionId' | 'camera'>, stopTracking: boolean, request: ApiFetch = browserFetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/darv/${encodeURIComponent(session.sessionId)}/finish`, { stopTracking } satisfies DarvFinishRequest, request)
}
