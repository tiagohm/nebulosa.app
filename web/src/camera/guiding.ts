// oxfmt-ignore
import type { CameraCapabilities, CaptureSnoop, StarDetectionSettings, GuidingDitherRequest, GuidingEventRecord, GuidingFrameOverlay, GuidingPage, GuidingPauseRequest, GuidingResumeRequest, GuidingSessionSummary, GuidingSnapshot, GuidingStartGuidingRequest, GuidingStartRequest, GuidingTelemetrySample, OperationDevice, ServerEvent } from 'api'
import { nanoid } from 'nanoid'
import { proxy } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { deviceUrl, jsonInit, responseError } from '../http'
import { type CameraExposureSettings, GUIDING_MAXIMUM_PULSE, GUIDING_MINIMUM_PULSE, type GuidingSettings } from '../profile/schema'
import type { TelescopeOptics } from '../sky/framing'
import { cameraKey, fitExposure } from './capture'

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
}

// Guiding state of the tab.
export interface GuidingRuntime {
	// Latest session of each guide camera, by camera key (cameraKey).
	sessions: Record<string, GuidingSessionSummary>
	// Control events of each session known, by session id, in sequence order, at most GUIDING_EVENTS_KEPT.
	events: Record<string, GuidingEventRecord[]>
	// Telemetry samples of each session known, by session id, in cursor order, at most GUIDING_TELEMETRY_KEPT.
	telemetry: Record<string, GuidingTelemetrySample[]>
	// Latest previewed frame of each session known, by session id.
	frames: Record<string, GuidingFrame>
	// Cameras with a command of this tab waiting for the server.
	pending: Record<string, boolean>
	// Why this tab's last command to a camera failed; cleared by its next command.
	errors: Record<string, string>
}

// Guiding state of the tab.
export const guidingRuntime = proxy<GuidingRuntime>({ sessions: {}, events: {}, telemetry: {}, frames: {}, pending: {}, errors: {} })

// Counter of snapshot refreshes; a response is applied only if no later refresh started.
let generation = 0

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

// Builds the start request of the guiding form of a camera: the guide exposures in milliseconds, the camera settings
// of the camera fitted to its capabilities as a capture is (never its exposure time), the controller, the calibration
// and the client settings (dither pattern, search square, sticky lock, DEC reversal after a flip) of the form, the
// devices snooped into the frame headers, and the star detector of the profile's Star Detection with its settings (its
// acceptance criteria are not sent: the tracker filters the stars). The effective focal length of the guide optics, in
// mm (see guideFocalLength), is sent only when known.
export function guidingRequest(settings: Readonly<GuidingSettings>, exposure: Readonly<CameraExposureSettings>, guideOutput: OperationDevice, snoop: CaptureSnoop, detection: Readonly<StarDetectionSettings>, focalLength: number | undefined, capabilities?: CameraCapabilities): Omit<GuidingStartRequest, 'token'> {
	const { exposureTime: _, ...camera } = fitExposure(exposure, capabilities)

	return {
		guideOutput,
		exposure: Math.round(settings.exposureTime * 1000),
		camera,
		trackingMode: settings.trackingMode,
		...(focalLength !== undefined && { optics: { focalLength } }),
		calibration: { raPulse: settings.calibrationPulse, decPulse: settings.calibrationPulse },
		guider: { aggressivenessRA: settings.aggressivenessRA, aggressivenessDEC: settings.aggressivenessDEC, maxPulseMsRA: settings.maximumPulseRA, maxPulseMsDEC: settings.maximumPulseDEC },
		client: { ditherMode: settings.ditherMode, searchRegion: settings.searchRegion, stickyLockPosition: settings.stickyLockPosition, reverseDecOutputAfterMeridianFlip: settings.reverseDecOutputAfterMeridianFlip },
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

// Builds the Start Guiding request of the guiding form.
export function guidingStartRequest(settings: Readonly<GuidingSettings>): Omit<GuidingStartGuidingRequest, 'token'> {
	return { recalibrate: settings.recalibrate, settle: { ...settings.settle } }
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
async function loadPage<T>(state: GuidingRuntime, kind: PageKind<T>, sessionId: string, request: typeof fetch) {
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
export function loadGuidingHistory(state: GuidingRuntime, sessionId: string, request: typeof fetch = fetch) {
	return Promise.all([loadPage(state, EVENTS, sessionId, request), loadPage(state, TELEMETRY, sessionId, request)])
}

// Forgets the events, telemetry, and frame of a session.
function forgetSession(state: GuidingRuntime, sessionId: string) {
	delete state.events[sessionId]
	delete state.telemetry[sessionId]
	delete state.frames[sessionId]
}

// Appends one item a session published at its position; a gap is filled from the session's page instead.
function receive<T>(state: GuidingRuntime, kind: PageKind<T>, sessionId: string, item: T, request: typeof fetch) {
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
export function handleGuidingEvent(state: GuidingRuntime, event: ServerEvent, request: typeof fetch = fetch) {
	switch (event.type) {
		case 'guiding:updated': {
			const { session } = event
			const key = cameraKey(session.camera.connectionId, session.camera.deviceId)
			const known = state.sessions[key]
			if (known && known.sessionId !== session.sessionId && known.startedAt > session.startedAt) return
			if (known?.sessionId === session.sessionId && known.revision >= session.revision) return

			state.sessions[key] = session

			if (known?.sessionId !== session.sessionId) {
				if (known) forgetSession(state, known.sessionId)
				if (session.eventSequence > 0 || session.telemetryCursor > 0) void loadGuidingHistory(state, session.sessionId, request)
			}

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
			if (!known || event.frameId > known.frameId) state.frames[event.sessionId] = { frameId: event.frameId, imageId: event.imageId, overlay: event.overlay }
		}
	}
}

// Replaces the sessions with the server's snapshot, which may have changed while the socket was closed, forgets the
// history of the sessions it no longer lists, and fetches the events and telemetry missed meanwhile. A response is
// dropped when another refresh started meanwhile.
export async function refreshGuiding(state: GuidingRuntime, request: typeof fetch = fetch) {
	const current = ++generation

	try {
		const response = await request('/api/guiding')
		if (!response.ok || current !== generation) return
		const snapshot = (await response.json()) as GuidingSnapshot
		if (current !== generation) return

		state.sessions = {}
		for (const session of snapshot.sessions) state.sessions[cameraKey(session.camera.connectionId, session.camera.deviceId)] = session
		const listed = new Set(snapshot.sessions.map((session) => session.sessionId))
		for (const id of new Set([...Object.keys(state.events), ...Object.keys(state.telemetry), ...Object.keys(state.frames)])) if (!listed.has(id)) forgetSession(state, id)
		await Promise.all(snapshot.sessions.map((session) => loadGuidingHistory(state, session.sessionId, request)))
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	}
}

// Sends a command of a camera and records its failure; resolves to the response body of an accepted command, or
// undefined. When the server cannot be reached, the command may still have been applied, so the snapshot is fetched
// again instead of assuming nothing happened.
async function command(state: GuidingRuntime, key: string, url: string, body: unknown, request: typeof fetch): Promise<unknown> {
	if (state.pending[key]) return undefined
	state.pending[key] = true
	delete state.errors[key]

	try {
		const response = await request(url, jsonInit('POST', body))

		if (!response.ok) {
			state.errors[key] = await responseError(response)
			return undefined
		}

		return response.status === 204 ? undefined : await response.json()
	} catch {
		state.errors[key] = 'Unable to reach the server.'
		await refreshGuiding(state, request)
		return undefined
	} finally {
		delete state.pending[key]
	}
}

// Session a command addresses.
type SessionRef = Pick<GuidingSessionSummary, 'sessionId' | 'camera'>

// Sends a command of a session to its route.
function sessionCommand(state: GuidingRuntime, session: SessionRef, action: string, body: unknown, request: typeof fetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/guiding/${encodeURIComponent(session.sessionId)}/${action}`, body, request)
}

// Starts a guiding session with a guide camera, which loops its exposures until stopped; progress arrives as events.
export function startGuidingSession(state: GuidingRuntime, connectionId: string, deviceId: string, body: Omit<GuidingStartRequest, 'token'>, request: typeof fetch = fetch) {
	const url = deviceUrl(connectionId, 'camera', deviceId, 'guiding')
	return command(state, cameraKey(connectionId, deviceId), url, { ...body, token: nanoid() } satisfies GuidingStartRequest, request)
}

// Selects the star nearest a pixel of the current guide frame (pixels of the full frame from its top-left), or the
// best star the tracker offers without one.
export function selectGuidingTarget(state: GuidingRuntime, session: SessionRef, position?: readonly [number, number], request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'target', position ? { position } : {}, request)
}

// Clears the selected star; refused while guiding.
export function clearGuidingTarget(state: GuidingRuntime, session: SessionRef, request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'target/clear', undefined, request)
}

// Starts guiding on the selected star, calibrating first when asked or when uncalibrated; the outcome arrives as the
// command of the session.
export function startGuiding(state: GuidingRuntime, session: SessionRef, body: Omit<GuidingStartGuidingRequest, 'token'>, request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'start', { ...body, token: nanoid() } satisfies GuidingStartGuidingRequest, request)
}

// Stops guiding and releases the guide output; the session keeps looping.
export function stopGuiding(state: GuidingRuntime, session: SessionRef, request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'stop-guiding', { token: nanoid() }, request)
}

// Pauses the corrections, or the exposures too.
export function pauseGuiding(state: GuidingRuntime, session: SessionRef, mode: GuidingPauseRequest['mode'], request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'pause', { mode, token: nanoid() } satisfies GuidingPauseRequest, request)
}

// Resumes a paused session and waits for its settle.
export function resumeGuiding(state: GuidingRuntime, session: SessionRef, settle: GuidingStartGuidingRequest['settle'], request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'resume', { settle, token: nanoid() } satisfies GuidingResumeRequest, request)
}

// Dithers the lock position and waits for the settle.
export function ditherGuiding(state: GuidingRuntime, session: SessionRef, body: Omit<GuidingDitherRequest, 'token'>, request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'dither', { ...body, token: nanoid() } satisfies GuidingDitherRequest, request)
}

// Changes the guide exposure of the next frames, in seconds.
export function setGuidingExposure(state: GuidingRuntime, session: SessionRef, exposureTime: number, request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'exposure', { exposure: Math.round(exposureTime * 1000) }, request)
}

// Forgets the calibration solved in the session, so the next Start Guiding calibrates; refused while guiding.
export function clearGuidingCalibration(state: GuidingRuntime, session: SessionRef, request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'calibration/clear', undefined, request)
}

// Ends a session, releasing the guide camera and the guide output.
export function stopGuidingSession(state: GuidingRuntime, session: SessionRef, request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'stop', undefined, request)
}
