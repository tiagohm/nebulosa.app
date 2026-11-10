import type { GatewayState, ObservatoryCamera, ObservatoryCameraEvent, ObservatoryCameraSaveRequest, ObservatoryCameraSecretKeyState, ObservatoryCamerasSnapshot, ObservatoryCameraStream, ObservatoryCameraStreamCode, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { type ApiFetch, browserFetch, jsonInit, responseError } from '../../http'

// Mirror of the observatory cameras of the server: their definitions, the state of their streams on the server, the
// media gateway, and the key of their addresses, fed by GET /api/observatory-cameras and the observatoryCamera:* events,
// and the requests this tab sends to save, reorder, and delete cameras. Revisions order the snapshot and the events
// within one server process (epoch), so a snapshot older than an event already applied never brings back a deleted
// camera. Addresses are never read back: an edit sends a new one or none.

// Cameras known to the tab.
export interface ObservatoryCamerasState {
	// Server process the state belongs to; absent before the first snapshot or event.
	epoch?: string
	// Latest revision applied from the server.
	revision: number
	// Cameras by id.
	cameras: Record<string, ObservatoryCamera>
	// Streams by camera id; a camera without one is idle.
	streams: Record<string, ObservatoryCameraStream>
	// Media gateway; absent before the first snapshot.
	gateway?: GatewayState
	// Key of the addresses; absent before the first snapshot.
	secretKey?: ObservatoryCameraSecretKeyState
	// UDP port of WebRTC media the browser must reach.
	icePort?: number
	// Whether the first snapshot was received.
	loaded: boolean
	// Why the last snapshot could not be fetched.
	loadError?: string
}

// Outcome of a save: the camera saved, a refusal because another client saved first (the store then holds the newer
// camera), or an error message.
export type CameraSaveResult = { readonly status: 'saved'; readonly camera: ObservatoryCamera } | { readonly status: 'conflict' } | { readonly status: 'error'; readonly error: string }

// Settings a camera is saved with, as the editor holds them.
export type CameraDraft = Omit<ObservatoryCameraSaveRequest, 'revision' | 'sortOrder'>

// Text of each reason a stream is unavailable.
export const STREAM_CODE_LABELS: Readonly<Record<ObservatoryCameraStreamCode, string>> = {
	sourceAuthFailed: 'Authentication failed',
	sourceNotFound: 'Path not found',
	sourceUnreachable: 'Camera unreachable',
	sourceFailed: 'Stream failed',
	sourceUnavailable: 'Stream failed',
	secretKeyUnavailable: 'Key unavailable',
	secretKeyMismatch: 'Saved with another key',
	controlFailed: 'Gateway refused it',
	unsupportedCodec: 'Unsupported codec',
}

// Cameras of the server, shared by every view of the tab.
export const observatoryCamerasState = proxy<ObservatoryCamerasState>({ revision: 0, cameras: {}, streams: {}, loaded: false })

// Generation of the latest snapshot request; an older response is dropped.
let generation = 0

// Base URL of the routes of a camera.
export function cameraUrl(id: string) {
	return `/api/observatory-cameras/${encodeURIComponent(id)}`
}

// Returns the cameras by position, then id.
export function sortedCameras(cameras: Readonly<Record<string, ObservatoryCamera>>): ObservatoryCamera[] {
	return Object.values(cameras).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
}

// Returns the cameras shown for a site filter: 'site' shows the cameras of the active site and the shared ones (every
// camera when there is no active site), 'all' every camera, and any other value the cameras of that site.
export function filterCameras(cameras: readonly ObservatoryCamera[], filter: string, activeSiteId: string | undefined): ObservatoryCamera[] {
	if (filter === 'all' || (filter === 'site' && !activeSiteId)) return [...cameras]
	const siteId = filter === 'site' ? activeSiteId : filter
	return cameras.filter((camera) => camera.observingSiteId === undefined || camera.observingSiteId === siteId)
}

// Replaces the state with a snapshot of the server, unless it is older than the events already applied.
export function applyObservatoryCamerasSnapshot(state: ObservatoryCamerasState, snapshot: ObservatoryCamerasSnapshot) {
	if (snapshot.epoch === state.epoch && snapshot.revision < state.revision) return
	state.epoch = snapshot.epoch
	state.revision = snapshot.revision
	state.cameras = Object.fromEntries(snapshot.cameras.map((camera) => [camera.id, camera]))
	state.streams = Object.fromEntries(snapshot.streams.map((stream) => [stream.cameraId, stream]))
	state.gateway = snapshot.gateway
	state.secretKey = snapshot.secretKey
	state.icePort = snapshot.icePort
	state.loaded = true
	state.loadError = undefined
}

// Fetches the snapshot again; called on every socket (re)open, since the cameras may have changed while it was closed.
export async function refreshObservatoryCameras(state: ObservatoryCamerasState, request: ApiFetch = browserFetch) {
	const current = ++generation

	try {
		const response = await request('/api/observatory-cameras')
		if (current !== generation) return

		if (!response.ok) {
			state.loadError = await responseError(response)
			return
		}

		const snapshot = (await response.json()) as ObservatoryCamerasSnapshot
		if (current === generation) applyObservatoryCamerasSnapshot(state, snapshot)
	} catch {
		if (current === generation) state.loadError = 'Unable to reach the server'
	}
}

// Whether a server event is one of Observatory Cameras.
export function isCameraEvent(event: ServerEvent): event is ObservatoryCameraEvent {
	return event.type.startsWith('observatoryCamera:')
}

// Applies an event of Observatory Cameras; any other event is ignored. An event of another server process starts over
// from it, and an event already contained in what the tab knows is dropped.
export function handleObservatoryCameraEvent(state: ObservatoryCamerasState, event: ServerEvent) {
	if (!isCameraEvent(event)) return

	if (event.epoch !== state.epoch) {
		state.epoch = event.epoch
		state.cameras = {}
		state.streams = {}
		void refreshObservatoryCameras(state)
	} else if (event.revision <= state.revision) {
		return
	}

	state.revision = event.revision

	switch (event.type) {
		case 'observatoryCamera:updated':
			state.cameras[event.camera.id] = event.camera
			break
		case 'observatoryCamera:removed':
			delete state.cameras[event.cameraId]
			delete state.streams[event.cameraId]
			break
		case 'observatoryCamera:streamUpdated':
			state.streams[event.stream.cameraId] = event.stream
			break
		case 'observatoryCamera:gatewayUpdated':
			state.gateway = event.gateway
			state.secretKey = event.secretKey
			break
	}
}

// Keeps a camera answered by the server unless an event already brought a later revision of it.
function keep(state: ObservatoryCamerasState, camera: ObservatoryCamera) {
	const known = state.cameras[camera.id]
	if (!known || known.revision < camera.revision) state.cameras[camera.id] = camera
}

// Saves a camera edited from revision (0 to create); an empty source keeps the saved address.
export async function saveCamera(state: ObservatoryCamerasState, id: string, draft: CameraDraft, revision: number, sortOrder?: number, request: ApiFetch = browserFetch): Promise<CameraSaveResult> {
	const body: ObservatoryCameraSaveRequest = { ...draft, source: draft.source?.trim() || undefined, revision, ...(sortOrder !== undefined && { sortOrder }) }

	try {
		const response = await request(cameraUrl(id), jsonInit('PUT', body))

		if (response.ok) {
			const camera = (await response.json()) as ObservatoryCamera
			keep(state, camera)
			return { status: 'saved', camera }
		}

		if (response.status === 409) {
			const conflict = (await response.json()) as { readonly code: string; readonly error: string; readonly camera?: ObservatoryCamera | null }

			if (conflict.code === 'conflict') {
				if (conflict.camera) keep(state, conflict.camera)
				return { status: 'conflict' }
			}

			return { status: 'error', error: conflict.error }
		}

		return { status: 'error', error: await responseError(response) }
	} catch {
		return { status: 'error', error: 'Unable to reach the server' }
	}
}

// Deletes a camera. Returns an error message, or undefined once deleted.
export async function removeCamera(state: ObservatoryCamerasState, id: string, request: ApiFetch = browserFetch): Promise<string | undefined> {
	try {
		const response = await request(cameraUrl(id), { method: 'DELETE' })
		if (!response.ok) return await responseError(response)
		delete state.cameras[id]
		delete state.streams[id]
		return undefined
	} catch {
		return 'Unable to reach the server'
	}
}

// Swaps the position of a camera with its neighbor in direction (-1 up, 1 down) among cameras, saving both. Returns an
// error message, or undefined once both are saved.
export async function moveCamera(state: ObservatoryCamerasState, cameras: readonly ObservatoryCamera[], id: string, direction: -1 | 1, request: ApiFetch = browserFetch): Promise<string | undefined> {
	const index = cameras.findIndex((camera) => camera.id === id)
	const other = cameras[index + direction]
	if (index < 0 || !other) return undefined

	const camera = cameras[index]
	// Equal positions are split, so the swap always changes the order.
	const [first, second] = camera.sortOrder === other.sortOrder ? [other.sortOrder + direction, other.sortOrder] : [other.sortOrder, camera.sortOrder]

	for (const [target, sortOrder] of [
		[camera, first],
		[other, second],
	] as const) {
		const { name, observingSiteId, enabled, rtspTransport, revision } = target
		const result = await saveCamera(state, target.id, { name, observingSiteId, enabled, rtspTransport }, revision, sortOrder, request)
		if (result.status === 'conflict') return 'A camera was changed by another client; try again.'
		if (result.status === 'error') return result.error
	}

	return undefined
}
