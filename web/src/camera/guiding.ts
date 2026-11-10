import type {
	CameraCapabilities,
	CaptureSnoop,
	StarDetectionSettings,
	GuidingCalibrationCandidates,
	GuidingCalibrationEntry,
	GuidingCalibrationPatch,
	GuidingCalibrationProgress,
	GuidingCalibrationSummary,
	GuidingDarkCandidates,
	GuidingDarkChange,
	GuidingRestoreCalibrationRequest,
	GuidingSessionCalibration,
	GuidingDitherRequest,
	GuidingEventRecord,
	GuidingFrameOverlay,
	GuidingPage,
	GuidingPauseRequest,
	GuidingResumeRequest,
	GuidingSessionSummary,
	GuidingStartGuidingRequest,
	GuidingStartRequest,
	GuidingTelemetrySample,
	OperationDevice,
	ServerEvent,
} from 'api'
import { nanoid } from 'nanoid'
import { proxy } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { formatDegrees, formatFixed, MISSING } from '../format'
import { type ApiFetch, ApiResponseError, browserFetch, deviceUrl, fetchJson, jsonInit, responseError } from '../http'
import { type CameraExposureSettings, GUIDING_MAXIMUM_EXPOSURE, GUIDING_MAXIMUM_PULSE, GUIDING_MINIMUM_EXPOSURE, GUIDING_MINIMUM_PULSE, type GuidingSettings } from '../profile/schema'
import { SnapshotRefreshes } from '../refresh'
import type { TelescopeOptics } from '../sky/framing'
import { cameraKey, fitExposure } from './capture'
import { acceptSession, type CameraSessions, type CameraSessionSource, refreshSessions, sendSessionCommand } from './sessions'

// Guiding sessions as this tab knows them. The server owns every session, whichever tab started it, and every exposure,
// calibration, correction, and settle of it, so this store only mirrors it: the summary of the latest session of each
// guide camera arrives with every guiding:updated event and, on every socket (re)open, with the snapshot; the control
// events and the telemetry arrive one by one with their positions, and a gap (a missed event, a reconnection) is filled
// from the pages of the session after the last position known. Summaries are ordered by their revision, so a late
// event never replaces a newer state, and only the events, telemetry, and frame of each camera's latest session are
// kept. Cameras and guide outputs are addressed by their exact connection and device ids, never by role. A start and
// every durable command carry a token, so a retried request answers the first one; exposures go to the server in
// milliseconds.

// Most control events kept per session, as many as the server keeps.
export const GUIDING_EVENTS_KEPT = 500

// Most telemetry samples kept per session, as many as the server keeps (about half an hour at one frame per second).
export const GUIDING_TELEMETRY_KEPT = 2000

// Latest previewed guide frame of a session: the capture document holding its pixels and what the guider saw in it.
export interface GuidingFrame {
	// Number of the frame within the session.
	readonly frameId: number
	// Id of the capture document holding the frame.
	readonly imageId: string
	// Lock, search square, measurement, and stars of the frame, in pixels of the full frame from its top-left.
	readonly overlay: GuidingFrameOverlay
	// Document and overlay of the frame before it, kept until the tab shows the newer one, so its markers never blink
	// out while the tab still shows the older image.
	readonly previous?: { readonly imageId: string; readonly overlay: GuidingFrameOverlay }
}

// Guiding state of the tab.
export interface GuidingRuntime extends CameraSessions<GuidingSessionSummary> {
	// Control events of each session known, by session id, in sequence order, at most GUIDING_EVENTS_KEPT.
	events: Record<string, GuidingEventRecord[]>
	// Telemetry samples of each session known, by session id, in cursor order, at most GUIDING_TELEMETRY_KEPT.
	telemetry: Record<string, GuidingTelemetrySample[]>
	// Latest previewed frame of each session known, by session id.
	frames: Record<string, GuidingFrame>
}

// Guiding state of the tab.
export const guidingRuntime = proxy<GuidingRuntime>({ sessions: {}, events: {}, telemetry: {}, frames: {}, pending: {}, errors: {} })

// Where the sessions are read and the refreshes of their snapshot (sessions.ts); a session keeps its history instead of a
// complete record.
const GUIDING_SESSIONS: CameraSessionSource = { url: '/api/guiding', refreshes: new SnapshotRefreshes() }

// Label of each guider state.
export const GUIDING_STATE_LABELS: Readonly<Record<GuidingSessionSummary['state'], string>> = {
	stopped: 'Stopped',
	looping: 'Looping',
	selected: 'Star selected',
	calibrating: 'Calibrating',
	guiding: 'Guiding',
	lostLock: 'Star lost',
	paused: 'Paused',
}

// Returns whether a session is running: it has not ended.
export function guidingRunning(session: Pick<GuidingSessionSummary, 'active'> | undefined): boolean {
	return session?.active === true
}

// Returns the session of a camera that a session id names, among the latest sessions known.
function sessionById(state: GuidingRuntime, sessionId: string): GuidingSessionSummary | undefined {
	return Object.values(state.sessions).find((session) => session.sessionId === sessionId)
}

// Returns the range of the guide exposure of a camera, in seconds: that of the guiding form, within the range the
// camera reports (exposure, in seconds, when known).
export function guidingExposureRange(exposure: CameraCapabilities['exposure'] | undefined): NonNullable<CameraCapabilities['exposure']> {
	return { min: Math.max(GUIDING_MINIMUM_EXPOSURE, exposure?.min ?? 0), max: Math.min(GUIDING_MAXIMUM_EXPOSURE, exposure?.max ?? GUIDING_MAXIMUM_EXPOSURE) }
}

// Builds the start request of the guiding form of a camera, guiding through the GUIDE_OUTPUT of the Equipment Setup and
// holding the MOUNT it drives while guiding (absent when the setup has none): the guide exposures in milliseconds, the camera settings
// of the camera fitted to its capabilities as a capture is (never its exposure time), the controller, the calibration
// (with the orthogonal DEC assumption), the client settings (dither pattern, search square, sticky lock, DEC reversal
// after a flip, declination compensation), the reuse of saved calibrations, the stop on a slew and the master dark of the form, the
// devices snooped into the frame headers, and the star detector of the profile's Star Detection with its settings (its
// acceptance criteria are not sent: the tracker filters the stars). The effective focal length of the guide optics, in
// mm (see guideFocalLength), is sent only when known.
export function guidingRequest(
	settings: Readonly<GuidingSettings>,
	exposure: Readonly<CameraExposureSettings>,
	{ guideOutput, mount }: { readonly guideOutput: OperationDevice; readonly mount?: OperationDevice },
	snoop: CaptureSnoop,
	detection: Readonly<StarDetectionSettings>,
	focalLength: number | undefined,
	capabilities?: CameraCapabilities,
): Omit<GuidingStartRequest, 'token'> {
	const { exposureTime: _, ...camera } = fitExposure(exposure, capabilities)

	return {
		guideOutput,
		...(mount && { mount }),
		exposure: Math.round(settings.exposureTime * 1000),
		camera,
		trackingMode: settings.trackingMode,
		...(focalLength !== undefined && { optics: { focalLength } }),
		calibration: { raPulse: settings.calibrationPulse, decPulse: settings.calibrationPulse, assumeDecOrthogonalToRa: settings.assumeDecOrthogonalToRa },
		guider: {
			aggressivenessRA: settings.aggressivenessRA,
			aggressivenessDEC: settings.aggressivenessDEC,
			maxPulseMsRA: settings.maximumPulseRA,
			maxPulseMsDEC: settings.maximumPulseDEC,
			decBacklashCompensation: settings.decBacklash.enabled ? { mode: 'adaptive', initialMs: Math.min(settings.decBacklash.initialMs, settings.decBacklash.maximumMs), maxCompensationMs: settings.decBacklash.maximumMs, adaptationRate: settings.decBacklash.adaptationRate } : { mode: 'off' },
		},
		client: { ditherMode: settings.ditherMode, searchRegion: settings.searchRegion, stickyLockPosition: settings.stickyLockPosition, fastRecenter: settings.fastRecenter, reverseDecOutputAfterMeridianFlip: settings.reverseDecOutputAfterMeridianFlip, declinationCompensation: settings.declinationCompensation },
		calibrationPolicy: { autoRestore: settings.autoRestoreCalibration, recalibrateOnEveryStart: settings.recalibrateOnEveryStart },
		stopGuidingOnSlew: settings.stopGuidingOnSlew,
		...(settings.useCalibrationLibraryDark && { dark: {} }),
		snoop,
		detection: { ...detection },
	}
}

// Returns the effective focal length of the guide telescope in mm, its focal length times its reducer or Barlow, or
// undefined while it is absent or not a positive number, which leaves the pixel scale of guiding unknown.
export function guideFocalLength(telescope: Readonly<TelescopeOptics> | undefined): number | undefined {
	const focalLength = telescope ? telescope.focalLength * telescope.focalMultiplier : 0
	return Number.isFinite(focalLength) && focalLength > 0 ? focalLength : undefined
}

// Image travel a calibration leg aims at, in guide-camera pixels: the calibration distance of PHD2.
export const GUIDING_CALIBRATION_DISTANCE = 25

// Calibration steps a leg aims at for that travel, as PHD2 sizes its calibration step.
export const GUIDING_CALIBRATION_STEPS = 12

// Sidereal rate, in arcseconds of RA per second of time.
const SIDEREAL_RATE = 15.0410686

// Arcseconds per radian, the pixel scale constant: arcsec/px = 206264.8 × pixel size / focal length (same units).
const ARCSEC_PER_RADIAN = 206264.80624709636

// Returns the calibration pulse, in whole milliseconds within [GUIDING_MINIMUM_PULSE, GUIDING_MAXIMUM_PULSE], that moves
// the guide star GUIDING_CALIBRATION_DISTANCE pixels in GUIDING_CALIBRATION_STEPS RA steps, as the PHD2 calibration step
// calculator does: from the focal length of the guide optics in mm, the unbinned pixel size in µm, the binning, the RA
// guide rate as a fraction of the sidereal rate, and the declination the mount points at in radians, since an RA
// pulse moves the sky by the cosine of the declination. Undefined when an input is unknown or the motion vanishes
// (a zero rate, or the pole). A pulse beyond the bounds is clamped, so the calibration may then fall short of the
// distance.
export function guidingCalibrationPulse(focalLength: number, pixelSize: number, binning: number, guideRate: number, declination: number): number | undefined {
	const scale = (ARCSEC_PER_RADIAN * pixelSize * 1e-3 * binning) / focalLength
	const speed = guideRate * SIDEREAL_RATE * Math.cos(declination)
	if (!(scale > 0 && Number.isFinite(scale)) || !(speed > 1e-6)) return undefined
	const pulse = Math.round(((GUIDING_CALIBRATION_DISTANCE * scale) / speed / GUIDING_CALIBRATION_STEPS) * 1000)
	return Math.min(GUIDING_MAXIMUM_PULSE, Math.max(GUIDING_MINIMUM_PULSE, pulse))
}

// Inputs of the calibration step calculator that a guiding panel knows; each is absent while unknown.
export interface GuidingCalibrationInputs {
	// Effective focal length of the guide telescope, in mm.
	readonly focalLength?: number
	// Unbinned pixel size of the guide camera, in µm.
	readonly pixelSize?: number
	// RA guide rate of the guide output, as a fraction of the sidereal rate.
	readonly guideRate?: number
	// Declination the mount points at, in radians.
	readonly declination?: number
}

// Returns why the calibration step cannot be calculated from the inputs, naming each missing one and where it comes
// from, or undefined when guidingCalibrationPulse can compute it (binning in pixels).
export function guidingCalibrationBlocker({ focalLength, pixelSize, guideRate, declination }: GuidingCalibrationInputs, binning: number): string | undefined {
	const missing = [
		focalLength === undefined && 'the focal length of the Guide Telescope, entered in Equipment Setup',
		pixelSize === undefined && 'the pixel size of the guide camera, which it reports once connected',
		guideRate === undefined && 'the RA guide rate of the guide output, which its mount or camera reports once connected',
		declination === undefined && 'the declination of the Mount of the Equipment Setup, once connected',
	].filter((reason) => reason !== false)

	if (missing.length > 0) return `Calculate needs ${missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}`}.`
	if (focalLength === undefined || pixelSize === undefined || guideRate === undefined || declination === undefined) return undefined
	if (guidingCalibrationPulse(focalLength, pixelSize, binning, guideRate, declination) === undefined) return 'The RA motion of a pulse vanishes: the guide rate is zero or the mount points at the pole. Calibrate away from the pole.'
	return undefined
}

// Labels of the phases of a calibration, as the session shows them.
export const GUIDING_CALIBRATION_PHASE_LABELS: Readonly<Record<GuidingCalibrationProgress['phase'], string>> = {
	idle: 'Starting',
	precheck: 'Checking the star',
	acquireLock: 'Locking on the star',
	raForwardPulse: 'Moving in RA',
	raForwardMeasure: 'Measuring the RA move',
	raForwardComplete: 'RA leg done',
	raClearPulse: 'Returning in RA',
	raClearMeasure: 'Measuring the RA return',
	decForwardPulse: 'Moving in DEC',
	decForwardMeasure: 'Measuring the DEC move',
	decBacklashClearing: 'Clearing the DEC backlash',
	decForwardComplete: 'DEC leg done',
	solving: 'Solving the calibration',
	validating: 'Validating the calibration',
	decReturnPulse: 'Returning in DEC',
	decReturnMeasure: 'Measuring the DEC return',
	completed: 'Completed',
	failed: 'Failed',
}

// Where a calibration was measured or is used: the declination of the mount in radians and its side of the pier, each
// when known.
export interface GuidingCalibrationPlace {
	// Declination of the mount, radians.
	readonly declination?: number
	// Side of the pier as the driver reports it; NEITHER is unknown.
	readonly pierSide?: string
}

// Returns where a calibration was measured or is used: "DEC 12.3°, pier east", or "DEC unknown, pier side unknown" for
// what is not known.
export function formatCalibrationPlace({ declination, pierSide }: GuidingCalibrationPlace) {
	return `${declination === undefined ? 'DEC unknown' : `DEC ${formatDegrees(declination, 1)}`}, ${pierSide && pierSide !== 'NEITHER' ? `pier ${pierSide.toLowerCase()}` : 'pier side unknown'}`
}

// Returns a calibration rate in pixels per millisecond as pixels per second, followed by arcseconds per second when the
// guide pixel scale (arcsec/px) is known: "4.12 px/s", "4.12 px/s (9.3″/s)", or MISSING when it is not finite.
export function formatCalibrationRate(rate: number, pixelScale?: number) {
	if (!Number.isFinite(rate)) return MISSING
	const perSecond = rate * 1000
	const pixels = `${formatFixed(perSecond, 2)} px/s`
	return pixelScale === undefined ? pixels : `${pixels} (${formatFixed(perSecond * pixelScale, 1)}″/s)`
}

// Returns how the calibration in use was adapted from the one measured: flipped for the other side of the pier, and its
// RA response scaled for the declination ("flipped for the pier side, RA ×0.87 for the declination"), or undefined when
// it is used as measured.
export function formatCalibrationAdaptation({ transformations, declinationScale }: Pick<GuidingCalibrationSummary, 'transformations' | 'declinationScale'>) {
	if (transformations.length === 0) return undefined
	return transformations.map((transformation) => (transformation === 'pierFlip' ? 'flipped for the pier side' : `RA ×${formatFixed(declinationScale, 2)} for the declination`)).join(', ')
}

// Builds the Start Guiding request of the guiding form; recalibrate is Force Recalibrate, which calibrates whatever the
// session or the saved calibrations hold.
export function guidingStartRequest(settings: Readonly<GuidingSettings>, recalibrate = false): Omit<GuidingStartGuidingRequest, 'token'> {
	return { recalibrate, settle: { ...settings.settle } }
}

// Builds the dither request of the guiding form: one dither of its size, in guide-camera pixels, with its settle.
export function guidingDitherRequest(settings: Readonly<GuidingSettings>): Omit<GuidingDitherRequest, 'token'> {
	return { amount: { unit: 'guidePixel', value: settings.ditherPixels }, raOnly: settings.ditherRaOnly, settle: { ...settings.settle } }
}

// Returns why no session can start now, or undefined when one can, from the availability of the camera and of the
// guide output of the setup (absent when the camera is not the Guide Camera), and whether the star detector is ASTAP
// while ASTAP is not configured. A busy guide output does not block the start, since looping never pulses; Start
// Guiding is refused while it stays busy. The server checks again.
export function guidingBlocker(camera: RoleAvailability, guideOutput: RoleAvailability | undefined, settings: Readonly<GuidingSettings>, astapMissing: boolean): string | undefined {
	if (camera.status !== 'ready') return camera.message
	if (!guideOutput) return 'Only the Guide Camera of the Equipment Setup guides.'
	if (guideOutput.status !== 'ready' && guideOutput.status !== 'busy') return guideOutput.message
	if (!(settings.exposureTime > 0)) return 'Set a guide exposure.'
	if (astapMissing) return 'ASTAP is not configured.'
	return undefined
}

// A page of a session that is fetched: its items, their position, its route, and its bound.
interface PageKind<T> {
	// Lists of the runtime the items go to, by session id.
	readonly list: (state: GuidingRuntime) => Record<string, T[]>
	// Position of an item in its session, from 1, without gaps.
	readonly position: (item: T) => number
	// Last segment of the route of the page.
	readonly route: 'events' | 'telemetry'
	// Most items kept per session.
	readonly kept: number
}

// Control events of a session.
const EVENTS: PageKind<GuidingEventRecord> = { list: (state) => state.events, position: (record) => record.sequence, route: 'events', kept: GUIDING_EVENTS_KEPT }

// Telemetry samples of a session.
const TELEMETRY: PageKind<GuidingTelemetrySample> = { list: (state) => state.telemetry, position: (sample) => sample.cursor, route: 'telemetry', kept: GUIDING_TELEMETRY_KEPT }

// Pages being fetched for each runtime, by route and session id, and whether another fetch was asked for meanwhile.
const loadings = new WeakMap<GuidingRuntime, Map<string, { again: boolean }>>()

// Returns the position of the last item of a list, or 0 for an empty one.
function lastPosition<T>(kind: PageKind<T>, list: readonly T[]) {
	const last = list.at(-1)
	return last === undefined ? 0 : kind.position(last)
}

// Appends items newer than the last one of a session's list, dropping the oldest beyond the bound. With reset, a
// truncated page replaces the list, since the items between them were forgotten. The kept list is extended in place, so
// one sample per frame never copies the whole history.
function append<T>(state: GuidingRuntime, kind: PageKind<T>, sessionId: string, items: readonly T[], reset = false) {
	const lists = kind.list(state)

	if (reset || !lists[sessionId]) {
		lists[sessionId] = items.slice(-kind.kept)
		return
	}

	const list = lists[sessionId]
	const last = lastPosition(kind, list)
	const fresh = items.filter((item) => kind.position(item) > last)
	if (fresh.length === 0) return
	list.push(...fresh)
	if (list.length > kind.kept) list.splice(0, list.length - kind.kept)
}

// Fetches the items of a session after the last one known and appends them; a session the server no longer keeps is
// forgotten. One fetch runs per session and kind: one asked for meanwhile runs again once it ends.
async function loadPage<T>(state: GuidingRuntime, kind: PageKind<T>, sessionId: string, request: ApiFetch) {
	const key = `${kind.route}:${sessionId}`
	let loading = loadings.get(state)
	if (!loading) loadings.set(state, (loading = new Map()))
	const running = loading.get(key)

	if (running) {
		running.again = true
		return
	}

	const entry = { again: true }
	loading.set(key, entry)

	try {
		while (entry.again) {
			entry.again = false
			const after = lastPosition(kind, kind.list(state)[sessionId] ?? [])
			const response = await request(`/api/guiding/${encodeURIComponent(sessionId)}/${kind.route}?after=${after}`)

			if (response.status === 404) {
				forgetSession(state, sessionId)
				return
			}

			if (!response.ok) return
			const page = (await response.json()) as GuidingPage<T>
			if (!sessionById(state, sessionId)) return
			append(state, kind, sessionId, page.items, page.truncated)
		}
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	} finally {
		loading.delete(key)
	}
}

// Fetches the control events and the telemetry of a session after the last ones known.
export function loadGuidingHistory(state: GuidingRuntime, sessionId: string, request: ApiFetch = browserFetch) {
	return Promise.all([loadPage(state, EVENTS, sessionId, request), loadPage(state, TELEMETRY, sessionId, request)])
}

// Forgets the events, telemetry, and frame of a session.
function forgetSession(state: GuidingRuntime, sessionId: string) {
	delete state.events[sessionId]
	delete state.telemetry[sessionId]
	delete state.frames[sessionId]
}

// Appends one item a session published at its position; a gap is filled from the session's page instead.
function receive<T>(state: GuidingRuntime, kind: PageKind<T>, sessionId: string, item: T, request: ApiFetch) {
	if (!sessionById(state, sessionId)) return
	const last = lastPosition(kind, kind.list(state)[sessionId] ?? [])
	const position = kind.position(item)
	if (position <= last) return
	if (position === last + 1) append(state, kind, sessionId, [item])
	else void loadPage(state, kind, sessionId, request)
}

// Applies a guiding event; any other event is ignored. A session older than the one known for its camera, or an
// earlier revision of the same one, never replaces it; a newer session of a camera drops the history of the previous
// one and fetches its own. Events, telemetry, and frames of a session that is not the latest of its camera are ignored.
export function handleGuidingEvent(state: GuidingRuntime, event: ServerEvent, request: ApiFetch = browserFetch) {
	switch (event.type) {
		case 'guiding:updated': {
			const { session } = event
			const accepted = acceptSession(state, GUIDING_SESSIONS.refreshes, session)
			if (!accepted || accepted.known?.sessionId === session.sessionId) return
			if (accepted.known) forgetSession(state, accepted.known.sessionId)
			if (session.eventSequence > 0 || session.telemetryCursor > 0) void loadGuidingHistory(state, session.sessionId, request)
			return
		}
		case 'guiding:event':
			receive(state, EVENTS, event.sessionId, event.record, request)
			return
		case 'guiding:telemetry':
			receive(state, TELEMETRY, event.sessionId, event.sample, request)
			return
		case 'guiding:frame': {
			if (!sessionById(state, event.sessionId)) return
			const known = state.frames[event.sessionId]
			if (!known || event.frameId > known.frameId) state.frames[event.sessionId] = { frameId: event.frameId, imageId: event.imageId, overlay: event.overlay, ...(known && { previous: { imageId: known.imageId, overlay: known.overlay } }) }
		}
	}
}

// Replaces the sessions with the server's snapshot (refreshSessions), forgets the history of the sessions no longer
// kept, and fetches the events and telemetry missed meanwhile.
export function refreshGuiding(state: GuidingRuntime, request: ApiFetch = browserFetch) {
	return refreshSessions(state, GUIDING_SESSIONS, request, async (sessionIds) => {
		const kept = new Set(sessionIds)
		for (const id of new Set([...Object.keys(state.events), ...Object.keys(state.telemetry), ...Object.keys(state.frames)])) if (!kept.has(id)) forgetSession(state, id)
		await Promise.all(sessionIds.map((id) => loadGuidingHistory(state, id, request)))
	})
}

// Sends a command of a camera (sendSessionCommand); resolves to the response body of an accepted command, or undefined.
async function command(state: GuidingRuntime, key: string, url: string, body: unknown, request: ApiFetch): Promise<unknown> {
	const response = await sendSessionCommand(state, key, url, jsonInit('POST', body), () => refreshGuiding(state, request), request)
	return response && response.status !== 204 ? await response.json() : undefined
}

// Session a command addresses.
type SessionRef = Pick<GuidingSessionSummary, 'sessionId' | 'camera'>

// Sends a command of a session to its route.
function sessionCommand(state: GuidingRuntime, session: SessionRef, action: string, body: unknown, request: ApiFetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/guiding/${encodeURIComponent(session.sessionId)}/${action}`, body, request)
}

// Starts a guiding session with a guide camera, which loops its exposures until stopped; progress arrives as events.
export function startGuidingSession(state: GuidingRuntime, connectionId: string, deviceId: string, body: Omit<GuidingStartRequest, 'token'>, request: ApiFetch = browserFetch) {
	const url = deviceUrl(connectionId, 'camera', deviceId, 'guiding')
	return command(state, cameraKey(connectionId, deviceId), url, { ...body, token: nanoid() } satisfies GuidingStartRequest, request)
}

// Selects the star nearest a pixel of the current guide frame (pixels of the full frame from its top-left), or the
// best star the tracker offers without one.
export function selectGuidingTarget(state: GuidingRuntime, session: SessionRef, position?: readonly [number, number], request: ApiFetch = browserFetch) {
	return sessionCommand(state, session, 'target', position ? { position } : {}, request)
}

// Clears the selected star; refused while guiding.
export function clearGuidingTarget(state: GuidingRuntime, session: SessionRef, request: ApiFetch = browserFetch) {
	return sessionCommand(state, session, 'target/clear', undefined, request)
}

// Starts guiding on the selected star, calibrating first when asked or when uncalibrated; the outcome arrives as the
// command of the session.
export function startGuiding(state: GuidingRuntime, session: SessionRef, body: Omit<GuidingStartGuidingRequest, 'token'>, request: ApiFetch = browserFetch) {
	return sessionCommand(state, session, 'start', { ...body, token: nanoid() } satisfies GuidingStartGuidingRequest, request)
}

// Stops guiding and releases the guide output; the session keeps looping.
export function stopGuiding(state: GuidingRuntime, session: SessionRef, request: ApiFetch = browserFetch) {
	return sessionCommand(state, session, 'stop-guiding', { token: nanoid() }, request)
}

// Pauses the corrections, or the exposures too.
export function pauseGuiding(state: GuidingRuntime, session: SessionRef, mode: GuidingPauseRequest['mode'], request: ApiFetch = browserFetch) {
	return sessionCommand(state, session, 'pause', { mode, token: nanoid() } satisfies GuidingPauseRequest, request)
}

// Resumes a paused session and waits for its settle.
export function resumeGuiding(state: GuidingRuntime, session: SessionRef, settle: GuidingStartGuidingRequest['settle'], request: ApiFetch = browserFetch) {
	return sessionCommand(state, session, 'resume', { settle, token: nanoid() } satisfies GuidingResumeRequest, request)
}

// Dithers the lock position and waits for the settle.
export function ditherGuiding(state: GuidingRuntime, session: SessionRef, body: Omit<GuidingDitherRequest, 'token'>, request: ApiFetch = browserFetch) {
	return sessionCommand(state, session, 'dither', { ...body, token: nanoid() } satisfies GuidingDitherRequest, request)
}

// Changes the guide exposure of the next frames, in seconds.
export function setGuidingExposure(state: GuidingRuntime, session: SessionRef, exposureTime: number, request: ApiFetch = browserFetch) {
	return sessionCommand(state, session, 'exposure', { exposure: Math.round(exposureTime * 1000) }, request)
}

// Forgets the calibration solved in the session, so the next Start Guiding calibrates; refused while guiding.
export function clearGuidingCalibration(state: GuidingRuntime, session: SessionRef, request: ApiFetch = browserFetch) {
	return sessionCommand(state, session, 'calibration/clear', undefined, request)
}

// Reads the calibration a session uses, with the review of its measured steps; rejects with the API error, a 404 when
// the session has none.
export function loadSessionCalibration(sessionId: string, request: ApiFetch = browserFetch): Promise<GuidingSessionCalibration> {
	return fetchJson({ fetch: (input, init) => request(input, init) }, `/api/guiding/${encodeURIComponent(sessionId)}/calibration`)
}

// Reads a saved calibration with the review of its measured steps, its evidence and its grade.
export function loadSavedCalibration(calibrationId: string, request: ApiFetch = browserFetch): Promise<GuidingCalibrationEntry> {
	return fetchJson({ fetch: (input, init) => request(input, init) }, `/api/guiding/calibrations/${encodeURIComponent(calibrationId)}`)
}

// Reads the saved calibrations of the equipment of a session, each with how it fits the session now.
export function loadGuidingCalibrationCandidates(sessionId: string, request: ApiFetch = browserFetch): Promise<GuidingCalibrationCandidates> {
	return fetchJson({ fetch: (input, init) => request(input, init) }, `/api/guiding/${encodeURIComponent(sessionId)}/calibration/candidates`)
}

// Excludes a saved calibration from restoring, or includes it again; rejects with the API error.
export async function setSavedCalibrationDisabled(calibrationId: string, disabled: boolean, request: ApiFetch = browserFetch) {
	const response = await request(`/api/guiding/calibrations/${encodeURIComponent(calibrationId)}`, jsonInit('PATCH', { disabled } satisfies GuidingCalibrationPatch))
	if (!response.ok) throw new ApiResponseError(await responseError(response), response.status)
}

// Restores a saved calibration on a session that is not guiding; the session record then shows it.
export function restoreGuidingCalibration(state: GuidingRuntime, session: SessionRef, calibrationId: string, request: ApiFetch = browserFetch) {
	return sessionCommand(state, session, 'calibration/restore', { calibrationId } satisfies GuidingRestoreCalibrationRequest, request)
}

// Reads the master darks of the Calibration Library that match the latest frame of a session.
export function loadGuidingDarkCandidates(sessionId: string, request: ApiFetch = browserFetch): Promise<GuidingDarkCandidates> {
	return fetchJson({ fetch: (input, init) => request(input, init) }, `/api/guiding/${encodeURIComponent(sessionId)}/dark/candidates`)
}

// Changes the master dark of the next frames of a session: none, the best match, or a pinned master.
export function setGuidingDark(state: GuidingRuntime, session: SessionRef, change: GuidingDarkChange, request: ApiFetch = browserFetch) {
	return sessionCommand(state, session, 'dark', change, request)
}

// Ends a session, releasing the guide camera and the guide output.
export function stopGuidingSession(state: GuidingRuntime, session: SessionRef, request: ApiFetch = browserFetch) {
	return sessionCommand(state, session, 'stop', undefined, request)
}
