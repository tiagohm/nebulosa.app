import type {
	CalibrationMasterSummary,
	LiveExportTarget,
	LiveFrameOutcome,
	LiveMasterKind,
	LiveStackingCalibration,
	LiveStackingCohort,
	LiveStackingFrame,
	LiveStackingFramePage,
	LiveStackingProduct,
	LiveStackingProductDetail,
	LiveStackingRecipe,
	LiveStackingSession,
	LiveStackingSnapshot,
	LiveStackingState,
	ServerEvent,
} from 'api'
import { nanoid } from 'nanoid'
import { proxy, ref } from 'valtio'
import { jsonInit, responseError } from '../http'
import type { LiveStackingSettings } from '../profile/schema'
import { SnapshotRefreshes } from '../refresh'
import { COMPOSITION_PRESETS, type CompositionPreset, presetSources } from '../tools/imagestacking/presets'

// Live Stacking sessions as this tab knows them. The server owns every session, whichever tab started it, and every frame
// of it, so this store only mirrors them: each session arrives whole with its liveStacking:updated events, and with the
// snapshot on every socket (re)open. A session is addressed by its id and found by its exact camera (connection id +
// device id), never by a role. Sessions are ordered by their revision, so a late event or snapshot never replaces a
// newer state, and a new epoch (a restarted server) forgets them. Every start carries a token, so a retried request
// answers the session of the first one. The frame outcomes and the saved stacks are fetched on demand.

// Live Stacking state of the tab.
export interface LiveStackingRuntime {
	// Run of the server the sessions belong to.
	epoch?: string
	// Sessions, by id.
	sessions: Record<string, LiveStackingSession>
	// Memory budget of every session together, and what they use, in bytes.
	memoryBudget: number
	memoryUsed: number
	// Latest page of frame outcomes of each session, newest first.
	frames: Record<string, readonly LiveStackingFrame[]>
	// Saved stacks, newest first; absent before they were fetched.
	products?: readonly LiveStackingProduct[]
	// Commands in flight and their failures, by command key.
	pending: Record<string, boolean>
	errors: Record<string, string>
}

// Live Stacking state of the tab.
export const liveStackingRuntime = proxy<LiveStackingRuntime>({ sessions: {}, memoryBudget: 0, memoryUsed: 0, frames: {}, pending: {}, errors: {} })

// Base of the routes of Live Stacking.
const BASE_URL = '/api/live-stacking'

// Ordering of the snapshot refreshes against the session events.
const refreshes = new SnapshotRefreshes()

// Label of each session state.
export const LIVE_STACKING_STATE_LABELS: Readonly<Record<LiveStackingState, string>> = {
	waiting: 'Waiting for frames',
	processing: 'Integrating',
	paused: 'Paused',
	stopping: 'Stopping',
	stopped: 'Stopped',
	failed: 'Failed',
}

// Label of each frame outcome.
export const LIVE_FRAME_OUTCOME_LABELS: Readonly<Record<LiveFrameOutcome, string>> = {
	queued: 'Queued',
	processing: 'Integrating',
	held: 'Held',
	accepted: 'Accepted',
	rejected: 'Rejected',
	skipped: 'Skipped',
	deliveryFailed: 'Not delivered',
}

// Label of each combination method.
export const LIVE_METHOD_LABELS: Readonly<Record<LiveStackingRecipe['method'], string>> = { average: 'Average', 'weighted-average': 'Weighted average' }

// Label of each frame weighting of a weighted average.
export const LIVE_WEIGHTING_LABELS: Readonly<Record<LiveStackingRecipe['weighting'], string>> = { quality: 'Quality', snr: 'SNR', 'inverse-hfd': 'Inverse HFD', stars: 'Stars' }

// Label of each normalization.
export const LIVE_NORMALIZATION_LABELS: Readonly<Record<LiveStackingRecipe['normalization'], string>> = { 'background-scale': 'Background and scale', scale: 'Scale', none: 'None' }

// Label of each resampling kernel.
export const LIVE_INTERPOLATION_LABELS: Readonly<Record<LiveStackingRecipe['interpolation'], string>> = { bilinear: 'Bilinear', bicubic: 'Bicubic', nearest: 'Nearest' }

// Label of what a session does with a filter without masters.
export const LIVE_FALLBACK_LABELS: Readonly<Record<LiveStackingCalibration['otherwise'], string>> = { uncalibrated: 'Stack uncalibrated', skip: 'Skip its frames' }

// Forgets what a new server process makes meaningless.
function adoptEpoch(state: LiveStackingRuntime, epoch: string) {
	if (state.epoch === epoch) return
	state.epoch = epoch
	state.sessions = {}
	state.frames = {}
}

// Applies a session unless a newer revision of it is known.
function applySession(state: LiveStackingRuntime, session: LiveStackingSession) {
	const known = state.sessions[session.sessionId]
	if (known && known.revision > session.revision) return
	state.sessions[session.sessionId] = ref(session)
}

// Applies a Live Stacking event; any other event is ignored.
export function handleLiveStackingEvent(state: LiveStackingRuntime, event: ServerEvent) {
	if (event.type === 'liveStacking:updated') {
		adoptEpoch(state, event.epoch)
		refreshes.updated(event.session.sessionId)
		applySession(state, event.session)
	} else if (event.type === 'liveStacking:closed') {
		adoptEpoch(state, event.epoch)
		refreshes.updated(event.sessionId)
		delete state.sessions[event.sessionId]
		delete state.frames[event.sessionId]
	} else if (event.type === 'liveStacking:products') {
		adoptEpoch(state, event.epoch)
		if (state.products) void loadLiveProducts(state)
	}
}

// Fetches the snapshot; a session an event changed meanwhile keeps the event's state. The server being away leaves what
// is known.
export async function refreshLiveStacking(state: LiveStackingRuntime, request: typeof fetch = fetch) {
	const token = refreshes.start()

	try {
		const response = await request(BASE_URL)
		if (!response.ok || !refreshes.current(token)) return
		const snapshot = (await response.json()) as LiveStackingSnapshot
		if (!refreshes.current(token)) return
		adoptEpoch(state, snapshot.epoch)
		const merged = refreshes.merge(state.sessions, snapshot.sessions, (session) => session.sessionId)
		const sessions: Record<string, LiveStackingSession> = {}

		for (const [id, session] of Object.entries(merged)) {
			const known = state.sessions[id]
			sessions[id] = ref(known && known.revision > session.revision ? known : session)
		}

		state.sessions = sessions
		state.memoryBudget = snapshot.memoryBudget
		state.memoryUsed = snapshot.memoryUsed
	} catch {
		// The server is unreachable; the next socket open refreshes the snapshot.
	} finally {
		refreshes.end(token)
	}
}

// Returns the session of a camera, if any.
export function cameraLiveSession(state: Pick<LiveStackingRuntime, 'sessions'>, connectionId: string, deviceId: string): LiveStackingSession | undefined {
	for (const session of Object.values(state.sessions)) if (session.connectionId === connectionId && session.deviceId === deviceId) return session
	return undefined
}

// Whether a session admits frames.
export function liveSessionActive(session: Pick<LiveStackingSession, 'state'> | undefined) {
	return session !== undefined && session.state !== 'stopping' && session.state !== 'stopped' && session.state !== 'failed'
}

// Sends a command and records its failure. Resolves its JSON answer, or undefined when it failed.
async function command<T>(state: LiveStackingRuntime, key: string, url: string, init: RequestInit, request: typeof fetch): Promise<T | undefined> {
	if (state.pending[key]) return undefined
	state.pending[key] = true
	delete state.errors[key]

	try {
		const response = await request(url, init)

		if (!response.ok) {
			state.errors[key] = await responseError(response)
			return undefined
		}

		return (await response.json()) as T
	} catch {
		state.errors[key] = 'Unable to reach the server.'
		return undefined
	} finally {
		delete state.pending[key]
	}
}

// Command key of a camera.
export function liveCameraKey(connectionId: string, deviceId: string) {
	return `camera:${connectionId}:${deviceId}`
}

// Starts the session of a camera with the form of the camera, under a new token.
export async function startLiveStacking(state: LiveStackingRuntime, connectionId: string, deviceId: string, settings: LiveStackingSettings, request: typeof fetch = fetch) {
	const url = `/api/connections/${encodeURIComponent(connectionId)}/cameras/${encodeURIComponent(deviceId)}/live-stacking`
	const session = await command<LiveStackingSession>(state, liveCameraKey(connectionId, deviceId), url, jsonInit('POST', { token: nanoid(), recipe: settings.recipe, calibration: settings.calibration }), request)
	if (session) applySession(state, session)
	return session
}

// Sends a command of a session: pause, resume, stop, abort, reset, or a new field.
export async function liveSessionCommand(state: LiveStackingRuntime, sessionId: string, action: 'pause' | 'resume' | 'stop' | 'abort' | 'reset' | 'fields', request: typeof fetch = fetch) {
	const session = await command<LiveStackingSession>(state, `session:${sessionId}`, `${BASE_URL}/sessions/${encodeURIComponent(sessionId)}/${action}`, jsonInit('POST'), request)
	if (session) applySession(state, session)
	return session
}

// Replaces the masters chosen per filter of a running session, for the frames that follow.
export async function setLiveCalibration(state: LiveStackingRuntime, sessionId: string, calibration: LiveStackingCalibration, request: typeof fetch = fetch) {
	const session = await command<LiveStackingSession>(state, `session:${sessionId}`, `${BASE_URL}/sessions/${encodeURIComponent(sessionId)}/calibration`, jsonInit('PUT', calibration), request)
	if (session) applySession(state, session)
	return session
}

// Closes a stopped or failed session.
export async function closeLiveSession(state: LiveStackingRuntime, sessionId: string, request: typeof fetch = fetch) {
	const closed = await command<{ readonly closed: boolean }>(state, `session:${sessionId}`, `${BASE_URL}/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }, request)

	if (closed) {
		delete state.sessions[sessionId]
		delete state.frames[sessionId]
	}

	return closed
}

// Saves a stack or a composition of a session as a product. Resolves the product with the paths of its files.
export function saveLiveStack(state: LiveStackingRuntime, sessionId: string, target: LiveExportTarget, request: typeof fetch = fetch) {
	return command<LiveStackingProductDetail>(state, `export:${sessionId}`, `${BASE_URL}/sessions/${encodeURIComponent(sessionId)}/exports`, jsonInit('POST', target), request)
}

// Fetches the latest frame outcomes of a session.
export async function loadLiveFrames(state: LiveStackingRuntime, sessionId: string, limit = 50, request: typeof fetch = fetch) {
	try {
		const response = await request(`${BASE_URL}/sessions/${encodeURIComponent(sessionId)}/frames?limit=${limit}`)
		if (response.ok) state.frames[sessionId] = ref(((await response.json()) as LiveStackingFramePage).frames)
	} catch {
		// The server is unreachable; the frames shown stay.
	}
}

// Fetches the saved stacks.
export async function loadLiveProducts(state: LiveStackingRuntime, request: typeof fetch = fetch) {
	try {
		const response = await request(`${BASE_URL}/products`)
		if (response.ok) state.products = ref((await response.json()) as LiveStackingProduct[])
	} catch {
		// The server is unreachable; the products shown stay.
	}
}

// Fetches a saved stack with the paths of its files.
export async function loadLiveProduct(productId: string, request: typeof fetch = fetch) {
	try {
		const response = await request(`${BASE_URL}/products/${encodeURIComponent(productId)}`)
		return response.ok ? ((await response.json()) as LiveStackingProductDetail) : undefined
	} catch {
		return undefined
	}
}

// Most masters of each kind offered for a filter.
const MASTERS_LIMIT = 200

// Fetches the usable masters of a kind of the Calibration Library, newest first; none when they cannot be fetched. The
// server checks each chosen master again against every frame, so the list only offers them.
export async function loadLiveMasters(kind: LiveMasterKind, request: typeof fetch = fetch): Promise<readonly CalibrationMasterSummary[]> {
	try {
		const response = await request(`/api/calibration-library/masters?kind=${kind}&limit=${MASTERS_LIMIT}`)
		if (!response.ok) return []
		const page = (await response.json()) as { readonly items: readonly CalibrationMasterSummary[] }
		return page.items.filter((master) => master.status === 'ready' || master.status === 'warning')
	} catch {
		return []
	}
}

// Returns the composition a preset makes of the mono stacks of one field, the most recently updated stack of each filter,
// or the filters it misses.
export function resolveLivePreset(preset: CompositionPreset, cohorts: readonly LiveStackingCohort[], fieldId: string) {
	const candidates = cohorts.filter((cohort) => cohort.fieldId === fieldId && cohort.acquisition.channels === 1).toSorted((a, b) => b.updatedAt - a.updatedAt)
	const resolved = presetSources(preset, candidates, (cohort) => cohort.filter)
	if ('missing' in resolved) return resolved
	const sources = resolved.sources.map((cohort) => ({ cohortId: cohort.cohortId, gain: 1, offset: 0 }))
	return { composition: { preset: preset.name, sources, mix: resolved.mix, ...(resolved.luminance !== undefined && { luminance: { source: resolved.luminance, alpha: 1, match: 'robustLinear' as const } }) } }
}

// Presets a field can be composed with, with the composition of each or what it misses.
export function livePresets(cohorts: readonly LiveStackingCohort[], fieldId: string) {
	return COMPOSITION_PRESETS.map((preset) => ({ preset, resolution: resolveLivePreset(preset, cohorts, fieldId) }))
}
