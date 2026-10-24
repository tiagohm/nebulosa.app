import type { CameraCapabilities, MountState, ServerEvent, TppaRequest, TppaSession, TppaSessionSummary, TppaSnapshot, TppaState } from 'api'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import { proxy } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { deviceUrl, jsonInit, responseError } from '../http'
import type { CameraExposureSettings, TppaSettings } from '../profile/schema'
import { cameraKey, fitExposure } from './capture'

// TPPA sessions as this tab knows them. The server owns every session, whichever tab started it, and every motion,
// exposure, and solve of it, so this store only mirrors it: the compact summary of the latest session of each camera
// arrives with every tppa:updated event and, on every socket (re)open, with the snapshot; the complete record (poses,
// attempts, the initial estimate, and the overlay of the latest frame) is fetched when a summary reports a new frame,
// pose, estimate, or an end. Summaries are ordered by their revision, so a late event never replaces a newer state.
// Cameras and mounts are addressed by their exact connection and device ids, never by role. A start carries a token,
// so a retried request answers the session of the first one instead of starting another.

// TPPA state of the tab.
export interface TppaRuntime {
	// Latest session of each camera, by camera key (cameraKey).
	sessions: Record<string, TppaSessionSummary>
	// Complete record of each session fetched so far, by session id.
	details: Record<string, TppaSession>
	// Cameras with a command of this tab waiting for the server.
	pending: Record<string, boolean>
	// Why this tab's last command to a camera failed; cleared by its next command.
	errors: Record<string, string>
}

// TPPA state of the tab.
export const tppaRuntime = proxy<TppaRuntime>({ sessions: {}, details: {}, pending: {}, errors: {} })

// Counter of snapshot refreshes; a response is applied only if no later refresh started.
let generation = 0

// Label of each session state.
export const TPPA_STATE_LABELS: Readonly<Record<TppaState, string>> = {
	preparing: 'Preparing',
	moving: 'Rotating in RA',
	capturing: 'Exposing',
	solving: 'Solving',
	readyToRefine: 'Ready to Refine',
	refining: 'Refining',
	refinementPaused: 'Refinement Paused',
	stopping: 'Stopping…',
	completed: 'Completed',
	failed: 'Failed',
	cancelled: 'Stopped',
}

// Label of each RA direction.
export const TPPA_DIRECTION_LABELS: Readonly<Record<TppaSettings['direction'], string>> = { WEST: 'West', EAST: 'East' }

// RA directions, in selector order.
export const TPPA_DIRECTIONS = Object.keys(TPPA_DIRECTION_LABELS) as TppaSettings['direction'][]

// Returns why the mount can never run a TPPA, from the state the server reports, or undefined when it can (or its
// state is not known yet): an alt-az mount, no west-east motion, no abort, or no slew-rate preset to choose.
export function tppaMountSupport(state: Pick<MountState, 'mountType' | 'canMove' | 'canMoveWE' | 'canAbort' | 'slewRates'> | undefined): string | undefined {
	if (!state) return undefined
	if (state.mountType === 'ALTAZ') return 'The mount is not equatorial; TPPA aligns the polar axis of an equatorial mount.'
	if (!state.canMove || !state.canMoveWE) return 'The mount cannot move west-east, which the TPPA needs.'
	if (!state.canAbort) return 'The mount cannot abort a motion, which the TPPA needs to stop safely.'
	if (state.slewRates.length === 0) return 'The mount offers no slew rate to choose.'
	return undefined
}

// Returns why no session can start now, or undefined when one can, from the availability of the camera and of the
// setup's mount (unsupported per tppaMountSupport), the mount's reported state (undefined while unknown), the slew
// rate a start would send (tppaSlewRate), and whether the plate solver is configured. The server checks again.
export function tppaBlocker(camera: RoleAvailability, mount: RoleAvailability, state: MountState | undefined, slewRate: string | undefined, solverConfigured: boolean): string | undefined {
	if (camera.status !== 'ready') return camera.message
	if (mount.status !== 'ready') return mount.message
	if (!state) return 'The mount state is not known yet.'
	if (slewRate === undefined || !state.slewRates.some((rate) => rate.name === slewRate)) return 'Choose a slew rate.'
	if (state.site.latitude === 0 && state.site.longitude === 0) return 'The mount reports no site; send it from Equipment Control.'
	if (state.parked || state.parking) return 'The mount is parked.'
	if (!state.tracking) return 'The mount is not tracking; start tracking first.'
	if (!solverConfigured) return 'The plate solver is not configured.'
	return undefined
}

// Returns the slew rate a start sends: the form's when the mount still announces it, else the preset the mount uses
// now, else undefined, so a preset of another mount or one the driver dropped is never sent.
export function tppaSlewRate(settings: Pick<TppaSettings, 'slewRate'>, state: Pick<MountState, 'slewRates' | 'slewRate'> | undefined): string | undefined {
	const announced = (name: string | undefined) => name !== undefined && state?.slewRates.some((rate) => rate.name === name) === true
	return announced(settings.slewRate) ? settings.slewRate : announced(state?.slewRate) ? state?.slewRate : undefined
}

// Builds the start request of the TPPA form of a camera for a mount and slew rate. The frames take the exposure and
// camera settings of the camera, fitted to its capabilities as a capture is; the rotation is sent in radians.
export function tppaRequest(settings: Readonly<TppaSettings>, exposure: Readonly<CameraExposureSettings>, mount: { readonly connectionId: string; readonly deviceId: string }, slewRate: string, capabilities?: CameraCapabilities): Omit<TppaRequest, 'token'> {
	const { provider, strategy, downsample } = settings.solver

	return {
		mount,
		capture: fitExposure(exposure, capabilities),
		solving: { provider, strategy, ...(downsample !== undefined && { downsample }) },
		direction: settings.direction,
		slewRate,
		rotation: settings.rotation * DEG2RAD,
		settleDelay: settings.settleDelay,
		refinementDelay: settings.refinementDelay,
	}
}

// Returns whether a session is still running.
export function tppaRunning(session: Pick<TppaSessionSummary, 'endedAt'> | undefined): boolean {
	return session !== undefined && session.endedAt === undefined
}

// Role of a TPPA frame in its session.
export interface TppaFrameRole {
	// Pose the frame became, when accepted.
	readonly point?: 1 | 2 | 3
	// Whether the frame was a candidate of a pose that was not accepted.
	readonly rejected: boolean
	// Whether the frame belongs to the refinement.
	readonly refinement: boolean
}

// Returns what a frame of a session (by its session id and frame number) was in the session's record: a pose, a
// rejected candidate, or a refinement frame; undefined for a frame of another session or one not recorded yet.
export function tppaFrameRole(session: Pick<TppaSession, 'sessionId' | 'points' | 'attempts' | 'initialAlignment'> | undefined, frame: { readonly sessionId: string; readonly generation: number }): TppaFrameRole | undefined {
	if (!session || session.sessionId !== frame.sessionId) return undefined
	const pose = session.points.find((p) => p.frame === frame.generation)
	if (pose) return { point: pose.point, rejected: false, refinement: false }
	if (session.attempts.some((a) => a.frame === frame.generation)) return { rejected: true, refinement: false }
	if (session.initialAlignment && frame.generation > session.initialAlignment.frame) return { rejected: false, refinement: true }
	return undefined
}

// Fetches the complete record of a session; a record older than the one known (a late response) never replaces it,
// and a session the server no longer keeps is forgotten.
export async function loadTppaSession(state: TppaRuntime, sessionId: string, request: typeof fetch = fetch) {
	try {
		const response = await request(`/api/tppa/${encodeURIComponent(sessionId)}`)

		if (response.status === 404) {
			delete state.details[sessionId]
			return
		}

		if (!response.ok) return
		const session = (await response.json()) as TppaSession
		const known = state.details[sessionId]
		if (!known || session.revision > known.revision) state.details[sessionId] = session
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	}
}

// Applies a TPPA event; any other event is ignored. A session older than the one known for its camera, or an earlier
// revision of the same one, never replaces it. The complete record is fetched again when the summary reports a new
// frame, pose, or estimate, or an end.
export function handleTppaEvent(state: TppaRuntime, event: ServerEvent, request: typeof fetch = fetch) {
	if (event.type !== 'tppa:updated') return

	const { session } = event
	const key = cameraKey(session.camera.connectionId, session.camera.deviceId)
	const known = state.sessions[key]
	if (known && known.sessionId !== session.sessionId && known.startedAt > session.startedAt) return
	if (known?.sessionId === session.sessionId && known.revision >= session.revision) return

	state.sessions[key] = session
	if (known?.sessionId !== session.sessionId) for (const id of Object.keys(state.details)) if (id !== session.sessionId) delete state.details[id]

	const details = state.details[session.sessionId]
	if (!details || details.frameCount !== session.frameCount || details.pointCount !== session.pointCount || details.alignment?.frame !== session.alignment?.frame || details.refinementCount !== session.refinementCount || (session.endedAt !== undefined && details.endedAt === undefined))
		void loadTppaSession(state, session.sessionId, request)
}

// Replaces the sessions with the server's snapshot, which may have changed while the socket was closed, and fetches
// their complete records. A response is dropped when another refresh started meanwhile.
export async function refreshTppa(state: TppaRuntime, request: typeof fetch = fetch) {
	const current = ++generation

	try {
		const response = await request('/api/tppa')
		if (!response.ok || current !== generation) return
		const snapshot = (await response.json()) as TppaSnapshot
		if (current !== generation) return

		state.sessions = {}
		for (const session of snapshot.sessions) state.sessions[cameraKey(session.camera.connectionId, session.camera.deviceId)] = session
		for (const id of Object.keys(state.details)) if (!snapshot.sessions.some((session) => session.sessionId === id)) delete state.details[id]
		for (const session of snapshot.sessions) void loadTppaSession(state, session.sessionId, request)
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	}
}

// Sends a command of a camera and records its failure. When the server cannot be reached, the command may still have
// been applied, so the snapshot is fetched again instead of assuming nothing happened.
async function command(state: TppaRuntime, key: string, url: string, body: unknown, request: typeof fetch) {
	if (state.pending[key]) return
	state.pending[key] = true
	delete state.errors[key]

	try {
		const response = await request(url, jsonInit('POST', body))
		if (!response.ok) state.errors[key] = await responseError(response)
	} catch {
		state.errors[key] = 'Unable to reach the server.'
		await refreshTppa(state, request)
	} finally {
		delete state.pending[key]
	}
}

// Starts a TPPA with a camera; its progress arrives as events.
export function startTppa(state: TppaRuntime, connectionId: string, deviceId: string, body: Omit<TppaRequest, 'token'>, request: typeof fetch = fetch) {
	const url = deviceUrl(connectionId, 'camera', deviceId, 'tppa')
	return command(state, cameraKey(connectionId, deviceId), url, { ...body, token: crypto.randomUUID() } satisfies TppaRequest, request)
}

// Stops the session of a camera; the server stops the mount and restores its slew rate when it can.
export function stopTppa(state: TppaRuntime, session: Pick<TppaSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/tppa/${encodeURIComponent(session.sessionId)}/stop`, undefined, request)
}

// Starts or resumes the refinement of a session that has an estimate.
export function startTppaRefinement(state: TppaRuntime, session: Pick<TppaSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/tppa/${encodeURIComponent(session.sessionId)}/refinement/start`, undefined, request)
}

// Pauses the refinement of a session; its devices stay held.
export function stopTppaRefinement(state: TppaRuntime, session: Pick<TppaSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/tppa/${encodeURIComponent(session.sessionId)}/refinement/stop`, undefined, request)
}
