import type { CaptureFramePage, CaptureFramesSnapshot, CaptureFrameSummary, CaptureSourceSummary, ConnectionStatus, ServerEvent } from 'api'
import { proxy, ref } from 'valtio'
import { type Connection, serverOf } from '../connection/connection'
import { type ApiFetch, browserFetch, responseError } from '../http'

// Captured frames of every camera as this tab knows them, mirrored from the server's capture frame registry: the
// cameras with frames come from the snapshot on every socket (re)open and from captureFrame:updated and
// captureSource:updated events; the latest frame and the saved frames of a camera are fetched when it is shown, then
// kept current by the same events, so a frame joins the saved frames only once its file is written. Older saved frames
// are fetched a page at a time on request (loadOlderFrames), and the frames of a camera that has some are never trimmed. A change
// carries a revision, so a late event never replaces newer news, and a snapshot or page fetched while newer events
// arrived keeps them. Nothing here holds pixels or opens documents; the Images workspace opens frames through
// images.ts.

// Captured frames of the tab.
export interface CaptureFramesState {
	// Identity of the server run of the snapshot; a different one means the server restarted.
	epoch?: string
	// Saved frames the server remembers per camera.
	limit: number
	// Cameras with frames, by camera key (frameSourceKey).
	sources: Record<string, CaptureSourceSummary>
	// Latest frame of the cameras fetched so far, by camera key; absent for a camera without one.
	latest: Record<string, CaptureFrameSummary>
	// Saved frames of the cameras fetched so far, newest first, by camera key.
	frames: Record<string, CaptureFrameSummary[]>
	// Cursor of the page of older saved frames of each camera, by camera key; absent when none is older.
	next: Record<string, string>
	// Cameras whose older saved frames were fetched, by camera key; their frames are kept whole.
	extended: Record<string, boolean>
	// Cameras whose recent frames are being fetched.
	loading: Record<string, boolean>
	// Why the snapshot or the recent frames of a camera could not be fetched; '' keys the snapshot.
	errors: Record<string, string>
	// Whether the snapshot was fetched once.
	loaded: boolean
}

// Captured frames of the tab.
export const captureFramesState = proxy<CaptureFramesState>({ limit: 20, sources: {}, latest: {}, frames: {}, next: {}, extended: {}, loading: {}, errors: {}, loaded: false })

// Counter of snapshot refreshes; a response is applied only if no later refresh started.
let generation = 0

// Returns the key of a camera: its connection id and exact device id.
export function frameSourceKey(connectionId: string, deviceId: string) {
	return `${connectionId}:${deviceId}`
}

// Returns the URL of a frame's routes.
export function captureFrameUrl(frameId: string) {
	return `/api/capture-frames/frames/${encodeURIComponent(frameId)}`
}

// Inserts, replaces, or removes a frame in the saved frames of its camera, newest first, keeping at most limit frames
// when given: a frame whose file is not written is not a saved frame. An older revision of a known frame is ignored.
// Returns whether frames were dropped beyond limit.
function mergeFrame(frames: CaptureFrameSummary[], frame: CaptureFrameSummary, limit?: number) {
	const index = frames.findIndex((f) => f.frameId === frame.frameId)

	if (index >= 0) {
		if (frames[index].revision >= frame.revision) return false
		if (frame.file === 'saved') frames[index] = ref(frame)
		else frames.splice(index, 1)
		return false
	}

	if (frame.file !== 'saved') return false
	const at = frames.findIndex((f) => f.sequence < frame.sequence)
	frames.splice(at < 0 ? frames.length : at, 0, ref(frame))
	if (limit === undefined || frames.length <= limit) return false
	frames.splice(limit)
	return true
}

// Makes the oldest saved frame known of a camera the cursor of its older ones, once frames were dropped from its page.
function trimmed(state: CaptureFramesState, key: string) {
	const oldest = state.frames[key]?.at(-1)
	if (oldest) state.next[key] = String(oldest.sequence)
}

// Applies a registry event; any other event is ignored. A frame that is the latest of its camera replaces the latest
// frame known, unless that one is newer.
export function handleCaptureFramesEvent(state: CaptureFramesState, event: ServerEvent) {
	if (event.type !== 'captureFrame:updated' && event.type !== 'captureSource:updated') return

	const { source } = event
	const key = frameSourceKey(source.connectionId, source.deviceId)
	const known = state.sources[key]
	if (!known || known.revision < source.revision) state.sources[key] = ref(source)

	if (event.type === 'captureFrame:updated') {
		const { frame } = event
		const frames = state.frames[key]
		if (frames && mergeFrame(frames, frame, state.extended[key] ? undefined : state.limit)) trimmed(state, key)
		const latest = state.latest[key]
		if (latest?.frameId === frame.frameId ? latest.revision < frame.revision : frame.frameId === source.latestFrameId && (!latest || latest.sequence < frame.sequence)) state.latest[key] = ref(frame)
	}
}

// Replaces the cameras with the server's snapshot, and refetches the frames already fetched, since either may have
// changed while the socket was closed. A camera an event of the same server run made newer than the snapshot keeps
// its newer state; after a restart (another epoch) only the snapshot counts. A response is dropped when another
// refresh started meanwhile. Resolves once the cameras are replaced, without waiting for their frames.
export async function refreshCaptureFrames(state: CaptureFramesState, request: ApiFetch = browserFetch) {
	const current = ++generation

	try {
		const response = await request('/api/capture-frames')
		if (current !== generation) return

		if (!response.ok) {
			state.errors[''] = await responseError(response)
			return
		}

		const snapshot = (await response.json()) as CaptureFramesSnapshot
		if (current !== generation) return

		const restarted = state.epoch !== snapshot.epoch
		const known = restarted ? {} : state.sources
		state.epoch = snapshot.epoch
		state.limit = snapshot.limit
		// Revisions are registry-wide, so a camera missing from the snapshot with a revision beyond all of it was
		// added by an event after the snapshot was taken.
		const taken = Math.max(0, ...snapshot.sources.map((source) => source.revision))
		const sources: Record<string, CaptureSourceSummary> = {}
		for (const [key, source] of Object.entries(known)) if (source.revision > taken) sources[key] = source

		for (const source of snapshot.sources) {
			const key = frameSourceKey(source.connectionId, source.deviceId)
			const newer = known[key]
			sources[key] = newer && newer.revision > source.revision ? newer : ref(source)
		}

		state.sources = sources
		state.loaded = true
		delete state.errors['']

		if (restarted) state.latest = {}

		for (const key of Object.keys(state.frames)) {
			const source = state.sources[key]
			if (restarted) state.frames[key] = []
			if (restarted) delete state.next[key]
			if (source) void loadRecentFrames(state, source.connectionId, source.deviceId, request)
			else delete state.frames[key]
			if (!source) delete state.next[key]
		}
	} catch {
		if (current === generation) state.errors[''] = 'Unable to reach the server'
	}
}

// Fetches the latest frame and the saved frames of a camera, newest first, replacing those known and the older ones
// fetched; the frames events made newer while the page was fetched are kept.
export async function loadRecentFrames(state: CaptureFramesState, connectionId: string, deviceId: string, request: ApiFetch = browserFetch) {
	const key = frameSourceKey(connectionId, deviceId)
	state.loading[key] = true

	try {
		const response = await request(`/api/capture-frames/sources/${encodeURIComponent(connectionId)}/${encodeURIComponent(deviceId)}`)

		if (!response.ok) {
			state.errors[key] = await responseError(response)
			return
		}

		const page = (await response.json()) as CaptureFramePage
		const frames = page.frames.map((frame) => ref(frame))
		const newest = frames[0]?.sequence ?? 0
		let dropped = false
		for (const frame of state.frames[key] ?? []) if ((frame.sequence > newest || frames.some((f) => f.frameId === frame.frameId)) && mergeFrame(frames, frame, state.limit)) dropped = true
		state.frames[key] = frames
		delete state.extended[key]
		if (page.next === undefined && !dropped) delete state.next[key]
		else if (dropped) trimmed(state, key)
		else state.next[key] = page.next!
		const latest = state.latest[key]
		if (page.latest && (!latest || (latest.frameId === page.latest.frameId ? latest.revision < page.latest.revision : latest.sequence < page.latest.sequence))) state.latest[key] = ref(page.latest)
		delete state.errors[key]
	} catch {
		state.errors[key] = 'Unable to reach the server'
	} finally {
		delete state.loading[key]
	}
}

// Fetches the next page of older saved frames of a camera, appending them to those known; nothing when none is older
// or a fetch of the camera is running. A page whose cursor was replaced meanwhile, by a fetch of the recent frames, is
// dropped.
export async function loadOlderFrames(state: CaptureFramesState, connectionId: string, deviceId: string, request: ApiFetch = browserFetch) {
	const key = frameSourceKey(connectionId, deviceId)
	const before = state.next[key]
	if (before === undefined || state.loading[key]) return
	state.loading[key] = true

	try {
		const response = await request(`/api/capture-frames/sources/${encodeURIComponent(connectionId)}/${encodeURIComponent(deviceId)}?before=${encodeURIComponent(before)}`)

		if (!response.ok) {
			state.errors[key] = await responseError(response)
			return
		}

		const page = (await response.json()) as CaptureFramePage
		if (state.next[key] !== before) return
		const frames = (state.frames[key] ??= [])
		for (const frame of page.frames) if (!frames.some((f) => f.frameId === frame.frameId)) frames.push(ref(frame))
		state.extended[key] = true
		if (page.next === undefined) delete state.next[key]
		else state.next[key] = page.next
		delete state.errors[key]
	} catch {
		state.errors[key] = 'Unable to reach the server'
	} finally {
		delete state.loading[key]
	}
}

// Returns the name people know a connection by: the name of the saved connection of its endpoint, the endpoint
// itself, or a generic name when the connection is not open.
export function connectionLabel(connectionId: string, servers: readonly ConnectionStatus[], connections: readonly Connection[]): string {
	const server = servers.find((s) => s.id === connectionId)
	if (!server) return 'Closed connection'
	const saved = connections.find((connection) => serverOf([server], connection))
	if (saved) return saved.name
	return server.type === 'SIMULATOR' ? 'Simulator' : `${server.host}:${server.port}`
}

// Returns why a frame cannot be opened, for people; undefined when it can.
export function frameUnavailableReason(frame: Pick<CaptureFrameSummary, 'availability' | 'reason'>): string | undefined {
	if (frame.availability === 'memory' || frame.availability === 'file') return undefined
	if (frame.availability === 'saving') return 'Being saved'
	if (frame.reason === 'fileMissing') return 'Saved file missing'
	if (frame.reason === 'saveFailed') return 'Save failed'
	if (frame.reason === 'restarted') return 'Lost when the server restarted'
	return 'No longer in memory'
}
