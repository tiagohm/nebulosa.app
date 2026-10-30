import type { CameraCapabilities, MountState, ServerEvent, TargetCenteringGuidingRestoration, TargetCenteringMode, TargetCenteringRequest, TargetCenteringSession, TargetCenteringSessionSummary, TargetCenteringSnapshot, TargetCenteringState, TargetCenteringStep } from 'api'
import { nanoid } from 'nanoid'
import { ASEC2RAD, DEG2RAD } from 'nebulosa/src/core/constants'
import { proxy } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { deviceUrl, jsonInit, responseError } from '../http'
import type { CameraExposureSettings, CameraPlateSolvingSettings, TargetCenteringSettings } from '../profile/schema'
import { SnapshotRefreshes } from '../refresh'
import { cameraKey, fitExposure } from './capture'

// Target Centering sessions as this tab knows them. The server owns every session, whichever tab started it, and every
// motion, exposure, and solve of it, so this store only mirrors it: the summary of the latest session of each camera arrives
// with every targetCentering:updated event and, on every socket (re)open, with the snapshot; the complete record, which adds
// the solution of each attempt, is fetched when a summary reports a new solution or an end. Summaries are ordered by their
// revision, and a snapshot leaves what an event changed during its fetch. Cameras and mounts are addressed by their exact
// connection and device ids, never by role. A start carries a token, so a retried request answers the session of the first
// one instead of starting another. The target being edited is tab memory: a saved framing is what lasts, in the profile.

// J2000 target being edited for a camera, in radians.
export interface TargetCenteringDraft {
	// Right ascension; absent until entered.
	readonly rightAscension?: number
	// Declination; absent until entered.
	readonly declination?: number
	// Name of the object or framing it came from.
	readonly label?: string
}

// Target Centering state of the tab.
export interface TargetCenteringRuntime {
	// Latest session of each camera, by camera key (cameraKey).
	sessions: Record<string, TargetCenteringSessionSummary>
	// Complete record of each session fetched so far, by session id.
	details: Record<string, TargetCenteringSession>
	// Target being edited for each camera, by camera key.
	drafts: Record<string, TargetCenteringDraft>
	// Cameras with a command of this tab waiting for the server.
	pending: Record<string, boolean>
	// Why this tab's last command to a camera failed; cleared by its next command.
	errors: Record<string, string>
}

// Target Centering state of the tab.
export const targetCenteringRuntime = proxy<TargetCenteringRuntime>({ sessions: {}, details: {}, drafts: {}, pending: {}, errors: {} })

// Refreshes of the sessions, by camera key.
const refreshes = new SnapshotRefreshes()

// Label of each session state.
export const TARGET_CENTERING_STATE_LABELS: Readonly<Record<TargetCenteringState, string>> = {
	preparing: 'Preparing',
	running: 'Running',
	stopping: 'Stopping…',
	blocked: 'Mount not confirmed stopped',
	completed: 'Completed',
	failed: 'Failed',
	cancelled: 'Stopped',
}

// Label of each step of a running session.
export const TARGET_CENTERING_STEP_LABELS: Readonly<Record<TargetCenteringStep, string>> = { stoppingGuiding: 'Stopping guiding', slewing: 'Slewing', settling: 'Settling', exposing: 'Exposing', solving: 'Solving', correcting: 'Correcting', restoringGuiding: 'Restoring guiding' }

// Returns why a mount can never move for a centering, from the state the server reports, or undefined when it can (or its
// state is not known yet). Verify Only commands nothing, so this does not concern it.
export function targetCenteringMountSupport(state: Pick<MountState, 'canGoTo' | 'canAbort'> | undefined): string | undefined {
	if (!state) return undefined
	if (!state.canGoTo) return 'The mount cannot go to a target.'
	if (!state.canAbort) return 'The mount cannot abort a motion, which a centering needs to stop safely.'
	return undefined
}

// Returns why a mode cannot start now, or undefined when it can, from the availability of the camera and of the setup's
// mount, the mount's reported state (undefined while unknown), the target, and whether the plate solver is configured. A
// mount that is not tracking is accepted when it can switch tracking, which the server starts for the session. Recenter needs
// a saved framing, which names the reference it recovers. The server checks again.
export function targetCenteringBlocker(mode: TargetCenteringMode, camera: RoleAvailability, mount: RoleAvailability, state: MountState | undefined, draft: TargetCenteringDraft | undefined, framingId: string | undefined, solverConfigured: boolean): string | undefined {
	if (camera.status !== 'ready') return camera.message
	if (mount.status !== 'ready') return mount.message
	if (!state) return 'The mount state is not known yet.'

	if (mode !== 'verifyOnly') {
		const unsupported = targetCenteringMountSupport(state)
		if (unsupported) return unsupported
		if (state.site.latitude === 0 && state.site.longitude === 0) return 'The mount reports no site; send it from Equipment Control.'
		if (state.parked || state.parking) return 'The mount is parked.'
		if (!state.tracking && !state.canTracking) return 'The mount is not tracking and cannot start tracking.'
	}

	if (mode === 'recenter' && framingId === undefined) return 'Recenter needs a saved framing: load or save one first.'
	if (draft?.rightAscension === undefined || draft.declination === undefined) return 'Enter the coordinates of the target.'
	if (!solverConfigured) return 'The plate solver is not configured.'
	return undefined
}

// Builds the start request of a mode from the form of a camera, for a mount. The frames take the exposure time of the form
// and the camera settings of exposure, whose own exposure time is never sent, fitted to the camera's capabilities as a
// capture is, and are solved with the plate solving settings of the camera; the angles are sent in radians. Everything is
// copied, so the session never depends on the profile.
export function targetCenteringRequest(
	mode: TargetCenteringMode,
	target: { readonly rightAscension: number; readonly declination: number; readonly label?: string },
	settings: Readonly<TargetCenteringSettings>,
	exposure: Readonly<CameraExposureSettings>,
	solving: Readonly<CameraPlateSolvingSettings>,
	mount: { readonly connectionId: string; readonly deviceId: string },
	capabilities?: CameraCapabilities,
): Omit<TargetCenteringRequest, 'token'> {
	const { rightAscension, declination, label } = target
	const { framingId, exposureTime, tolerance, maximumCorrections, noSolutionRetries, maximumFrames, settleDelay, maximumCorrection, blindRetry, coordinateGuiding } = settings

	return {
		mount,
		mode,
		target: { frame: 'J2000', rightAscension, declination, ...(label !== undefined && { label }), ...(framingId !== undefined && { framingId }) },
		capture: fitExposure({ ...exposure, exposureTime }, capabilities),
		solving: { ...solving },
		tolerance: tolerance * ASEC2RAD,
		maximumCorrections,
		noSolutionRetries,
		maximumFrames,
		settleDelay,
		maximumCorrection: maximumCorrection * DEG2RAD,
		blindRetry,
		guiding: coordinateGuiding ? 'coordinate' : 'requireIdle',
	}
}

// Label of what became of guiding, when something did.
export const TARGET_CENTERING_GUIDING_LABELS: Readonly<Record<Exclude<TargetCenteringGuidingRestoration, 'notNeeded'>, string>> = { restored: 'Restored', failed: 'Not restored', externallyChanged: 'Changed by someone else' }

// Returns whether a session has not ended; a blocked one has not, until it is dismissed.
export function targetCenteringRunning(session: Pick<TargetCenteringSessionSummary, 'endedAt'> | undefined): boolean {
	return session !== undefined && session.endedAt === undefined
}

// Returns what a session measured at its latest solution against its tolerance: within, outside, or undefined before one.
export function targetCenteringVerdict({ finalSeparation, request: { tolerance } }: Pick<TargetCenteringSessionSummary, 'finalSeparation' | 'request'>): 'within' | 'outside' | undefined {
	if (finalSeparation === undefined) return undefined
	return finalSeparation <= tolerance ? 'within' : 'outside'
}

// Steps of the radial scale of the bullseye, in arcseconds: each ring is one step, and the largest step that keeps every
// point inside RINGS rings is used.
const BULLSEYE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600, 7200, 18000, 36000] as const

// Rings of the bullseye.
export const BULLSEYE_RINGS = 3

// Returns the arcseconds of one ring of a bullseye holding a distance in arcseconds: the smallest step of the scale whose
// rings hold it, or the largest step.
export function bullseyeRing(distance: number): number {
	return BULLSEYE_STEPS.find((step) => step * BULLSEYE_RINGS >= distance) ?? BULLSEYE_STEPS.at(-1)!
}

// Fetches the complete record of a session; a record older than the one known (a late response) never replaces it, and a
// session the server no longer keeps is forgotten.
export async function loadTargetCenteringSession(state: TargetCenteringRuntime, sessionId: string, request: typeof fetch = fetch) {
	try {
		const response = await request(`/api/target-centering/${encodeURIComponent(sessionId)}`)

		if (response.status === 404) {
			delete state.details[sessionId]
			return
		}

		if (!response.ok) return
		const session = (await response.json()) as TargetCenteringSession
		const known = state.details[sessionId]
		if (!known || session.revision > known.revision) state.details[sessionId] = session
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	}
}

// Applies a Target Centering event; any other event is ignored. A session older than the one known for its camera, or an
// earlier revision of the same one, never replaces it. The complete record is fetched again when the summary reports a new
// solution or an end.
export function handleTargetCenteringEvent(state: TargetCenteringRuntime, event: ServerEvent, request: typeof fetch = fetch) {
	if (event.type !== 'targetCentering:updated') return

	const { session } = event
	const key = cameraKey(session.camera.connectionId, session.camera.deviceId)
	const known = state.sessions[key]
	if (known && known.sessionId !== session.sessionId && known.startedAt > session.startedAt) return
	if (known?.sessionId === session.sessionId && known.revision >= session.revision) return

	refreshes.updated(key)
	state.sessions[key] = session
	if (known?.sessionId !== session.sessionId) for (const id of Object.keys(state.details)) if (id !== session.sessionId) delete state.details[id]

	const details = state.details[session.sessionId]
	const solved = (each: Pick<TargetCenteringSessionSummary, 'attempts'>) => each.attempts.filter(({ outcome }) => outcome === 'solved').length
	if (!details || solved(details) !== solved(session) || (session.endedAt !== undefined && details.endedAt === undefined)) void loadTargetCenteringSession(state, session.sessionId, request)
}

// Replaces the sessions with the server's snapshot, which may have changed while the socket was closed, leaving what an event
// changed meanwhile, and fetches their complete records.
export async function refreshTargetCentering(state: TargetCenteringRuntime, request: typeof fetch = fetch) {
	const token = refreshes.start()

	try {
		const response = await request('/api/target-centering')
		if (!response.ok || !refreshes.current(token)) return
		const snapshot = (await response.json()) as TargetCenteringSnapshot
		if (!refreshes.current(token)) return

		const sessions: Record<string, TargetCenteringSessionSummary> = {}
		for (const [key, session] of Object.entries(state.sessions)) if (refreshes.changed(key)) sessions[key] = session

		for (const session of snapshot.sessions) {
			const key = cameraKey(session.camera.connectionId, session.camera.deviceId)
			if (!refreshes.changed(key)) sessions[key] = session
		}

		state.sessions = sessions
		const kept = Object.values(sessions).map(({ sessionId }) => sessionId)
		for (const id of Object.keys(state.details)) if (!kept.includes(id)) delete state.details[id]
		for (const id of kept) void loadTargetCenteringSession(state, id, request)
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	} finally {
		refreshes.end(token)
	}
}

// Sends a command of a camera and records its failure. When the server cannot be reached, the command may still have been
// applied, so the snapshot is fetched again instead of assuming nothing happened.
async function command(state: TargetCenteringRuntime, key: string, url: string, body: unknown, request: typeof fetch) {
	if (state.pending[key]) return
	state.pending[key] = true
	delete state.errors[key]

	try {
		const response = await request(url, jsonInit('POST', body))
		if (!response.ok) state.errors[key] = await responseError(response)
	} catch {
		state.errors[key] = 'Unable to reach the server.'
		await refreshTargetCentering(state, request)
	} finally {
		delete state.pending[key]
	}
}

// Starts a session with a camera; its progress arrives as events.
export function startTargetCentering(state: TargetCenteringRuntime, connectionId: string, deviceId: string, body: Omit<TargetCenteringRequest, 'token'>, request: typeof fetch = fetch) {
	const url = deviceUrl(connectionId, 'camera', deviceId, 'target-centering')
	return command(state, cameraKey(connectionId, deviceId), url, { ...body, token: nanoid() } satisfies TargetCenteringRequest, request)
}

// Stops the session of a camera, or dismisses a blocked one.
export function stopTargetCentering(state: TargetCenteringRuntime, session: Pick<TargetCenteringSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/target-centering/${encodeURIComponent(session.sessionId)}/stop`, undefined, request)
}
