import type { CaptureFramePage, CaptureFramesSnapshot, CaptureFrameSummary, CaptureSourceSummary, ConnectionStatus, ServerEvent } from 'api'
import { proxy, ref } from 'valtio'
import { type Connection, serverOf } from '../connection/connection'
import { responseError } from '../http'

// Captured frames of every camera as this tab knows them, mirrored from the server's capture frame registry: the
// cameras with frames come from the snapshot on every socket (re)open and from captureFrame:updated and
// captureSource:updated events; the recent frames of a camera are fetched when it is shown, then kept current by
// the same events. A change carries a revision, so a late event never replaces newer news. Nothing here holds
// pixels or opens documents; the Images workspace opens frames through images.ts.

// Captured frames of the tab.
export interface CaptureFramesState {
	// Identity of the server run of the snapshot; a different one means the server restarted.
	epoch?: string
	// Frames the server remembers per camera.
	limit: number
	// Cameras with frames, by camera key (frameSourceKey).
	sources: Record<string, CaptureSourceSummary>
	// Recent frames of the cameras fetched so far, newest first, by camera key.
	frames: Record<string, CaptureFrameSummary[]>
	// Cameras whose recent frames are being fetched.
	loading: Record<string, boolean>
	// Why the snapshot or the recent frames of a camera could not be fetched; '' keys the snapshot.
	errors: Record<string, string>
	// Whether the snapshot was fetched once.
	loaded: boolean
}

// Captured frames of the tab.
export const captureFramesState = proxy<CaptureFramesState>({ limit: 20, sources: {}, frames: {}, loading: {}, errors: {}, loaded: false })

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

// Inserts or replaces a frame in the recent frames of its camera, newest first, keeping at most limit frames. An
// older revision of a known frame is ignored.
function mergeFrame(frames: CaptureFrameSummary[], frame: CaptureFrameSummary, limit: number) {
	const index = frames.findIndex((f) => f.frameId === frame.frameId)

	if (index >= 0) {
		if (frames[index].revision < frame.revision) frames[index] = ref(frame)
		return
	}

	const at = frames.findIndex((f) => f.sequence < frame.sequence)
	frames.splice(at < 0 ? frames.length : at, 0, ref(frame))
	if (frames.length > limit) frames.splice(limit)
}

// Applies a registry event; any other event is ignored.
export function handleCaptureFramesEvent(state: CaptureFramesState, event: ServerEvent) {
	if (event.type !== 'captureFrame:updated' && event.type !== 'captureSource:updated') return

	const { source } = event
	const key = frameSourceKey(source.connectionId, source.deviceId)
	const known = state.sources[key]
	if (!known || known.revision < source.revision) state.sources[key] = ref(source)

	if (event.type === 'captureFrame:updated') {
		const frames = state.frames[key]
		if (frames) mergeFrame(frames, event.frame, state.limit)
	}
}

// Replaces the cameras with the server's snapshot, and refetches the recent frames already fetched, since either may
// have changed while the socket was closed. A response is dropped when another refresh started meanwhile.
export async function refreshCaptureFrames(state: CaptureFramesState, request: typeof fetch = fetch) {
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

		state.epoch = snapshot.epoch
		state.limit = snapshot.limit
		state.sources = Object.fromEntries(snapshot.sources.map((source) => [frameSourceKey(source.connectionId, source.deviceId), ref(source)]))
		state.loaded = true
		delete state.errors['']

		for (const key of Object.keys(state.frames)) {
			const source = state.sources[key]
			if (source) void loadRecentFrames(state, source.connectionId, source.deviceId, request)
			else delete state.frames[key]
		}
	} catch {
		if (current === generation) state.errors[''] = 'Unable to reach the server'
	}
}

// Fetches the recent frames of a camera, newest first, replacing those known.
export async function loadRecentFrames(state: CaptureFramesState, connectionId: string, deviceId: string, request: typeof fetch = fetch) {
	const key = frameSourceKey(connectionId, deviceId)
	state.loading[key] = true

	try {
		const response = await request(`/api/capture-frames/sources/${encodeURIComponent(connectionId)}/${encodeURIComponent(deviceId)}`)

		if (!response.ok) {
			state.errors[key] = await responseError(response)
			return
		}

		const page = (await response.json()) as CaptureFramePage
		state.frames[key] = page.frames.map((frame) => ref(frame))
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

// Returns the name of a frame for people: its file name, or its camera and number when it was only previewed.
export function frameLabel(frame: Pick<CaptureFrameSummary, 'fileName' | 'cameraName' | 'generation'>): string {
	return frame.fileName ?? `${frame.cameraName} · Frame ${String(frame.generation).padStart(4, '0')}`
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
