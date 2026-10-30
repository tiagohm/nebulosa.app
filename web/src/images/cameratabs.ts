import type { CaptureFrameOpened, CaptureFrameSummary, CaptureLeaseReconcileResponse, ServerEvent } from 'api'
import { ref } from 'valtio'
import { clientId } from '../events'
import { jsonInit, responseError } from '../http'
import { adaptView } from '../viewer/transform'
import { type CaptureFramesState, captureFrameUrl, frameSourceKey } from './captureframes'
import { ORIGINAL_DISPLAY_SETTINGS } from './display'
import { applyingSettings, browserIo, copySettings, documentOf, type ImageDocument, type ImagesIo, type ImagesState, type ImageToolContext, type ImageViewState, initialDisplaySettings, message, newView, releaseLease, removeDocument, requestRendering, settleApplying } from './images'

// Camera tabs of the Images workspace. Every connected camera of the watched connection has a camera tab, created and
// removed with the camera and never closed by the operator. A camera tab shows one frame of the server's capture frame
// registry at a time, chosen by its selection: the latest frame of the camera, which it follows as new frames arrive, a
// saved frame, or a frame held for a manual analysis. Every frame it shows uses the same view state: zoom and pan
// (adapted when the image size changes), the applied display settings (those its camera saved in the profile before
// any, never the settings being edited in a popup of the viewer toolbar), and Show Original.
// Showing a frame is a transaction: the frame is opened under a lease and rendered while the previous frame stays
// shown, and only then are the frame, its document, and its rendering committed together, so pixels, metadata, and
// overlays never mix two frames; a frame asked for later supersedes one still being opened, whose lease is released,
// and a failure keeps the frame shown. Leases belong to the page (clientId); every socket reopen reconciles them, and a
// tab whose lease was lost shows its selection again rather than another frame. The view state of a camera that
// disconnects is kept in memory and given back to its tab when it reconnects.

// Frame a camera tab shows: the latest frame of the camera, followed as new frames arrive; a saved frame; or a frame
// held because a manual analysis was started on it while it was the latest.
export type CameraFrameSelection = { readonly kind: 'latest' } | { readonly kind: 'saved'; readonly frameId: string } | { readonly kind: 'inspect'; readonly frameId: string }

// Frame shown by a camera tab.
export interface CameraFrameShown {
	// Frame, as the registry describes it.
	frame: CaptureFrameSummary
	// Lease keeping the document of the frame open on the server; absent once lost.
	lease?: string
}

// Frames of a camera tab: what the operator selected, what is shown, and what is being opened.
export interface CameraTabState {
	// Frame selected by the operator; shown once opened and rendered.
	selection: CameraFrameSelection
	// Frame shown with the document and rendering of the tab; absent before the first one.
	shown?: CameraFrameShown
	// Id of the frame being opened and rendered; only the latest one asked for counts.
	requested?: string
	// Why the frame selected could not be shown, or why the frame shown was lost.
	error?: string
}

// Camera of the watched connection a camera tab belongs to.
export interface CameraTabSource {
	// Id of the connection that provides it.
	readonly connectionId: string
	// Exact id of the camera.
	readonly id: string
	// Driver-reported camera name.
	readonly name: string
}

// View state and tool context of each camera tab removed with its camera, by document key; given back when the
// camera reconnects. They hold no rendering.
const parked = new Map<string, { readonly view: ImageViewState; readonly tool: ImageToolContext }>()

// Opens a captured frame on the server under a lease of client. Resolves to the opened frame, or to the message
// of the refusal.
async function requestFrame(frameId: string, io: ImagesIo, client: string): Promise<CaptureFrameOpened | string> {
	try {
		const response = await io.fetch(`${captureFrameUrl(frameId)}/open`, jsonInit('POST', { client }))
		if (!response.ok) return await responseError(response)
		return (await response.json()) as CaptureFrameOpened
	} catch (error) {
		return message(error)
	}
}

// Returns the document key of the camera tab of a camera; stable, so a camera that reconnects gets its tab back.
export function cameraTabKey(connectionId: string, deviceId: string): string {
	return `camera:${frameSourceKey(connectionId, deviceId)}`
}

// Returns the key of the camera tab a connection's equipment opens an operation in: the tab of the preferred camera
// (such as the Main Camera of the equipment setup) when it is open, otherwise the first camera tab of the connection;
// undefined when the connection has none.
export function connectionCameraTab(state: { readonly documents: readonly Pick<ImageDocument, 'key' | 'source'>[] }, connectionId: string, preferred?: string): string | undefined {
	const tabs = state.documents.filter((document) => document.source.kind === 'camera' && document.source.connectionId === connectionId)
	return (tabs.find((document) => document.source.kind === 'camera' && document.source.deviceId === preferred) ?? tabs[0])?.key
}

// Returns the camera tab with key, if open.
function cameraTabOf(state: ImagesState, key: string): (ImageDocument & { camera: CameraTabState }) | undefined {
	const document = documentOf(state, key)
	return document?.camera ? (document as ImageDocument & { camera: CameraTabState }) : undefined
}

// Returns the names of camera tabs: the camera name, followed by the start of its id when another camera of the
// list has the same name.
function cameraTabNames(cameras: readonly CameraTabSource[]): Map<string, string> {
	const counts = new Map<string, number>()
	for (const camera of cameras) counts.set(camera.name, (counts.get(camera.name) ?? 0) + 1)
	return new Map(cameras.map((camera) => [cameraTabKey(camera.connectionId, camera.id), (counts.get(camera.name) ?? 0) > 1 ? `${camera.name} · ${camera.id.slice(0, 6)}` : camera.name]))
}

// Makes the camera tabs match the connected cameras of the watched connection: a tab is added for each camera
// without one, with the view state it had when its camera disconnected, and shows the latest frame of the camera
// when frames knows one; the tab of a camera no longer listed is removed, releasing its lease, and its view state is
// kept for its return. Camera tabs come first, ordered by camera name then id, never by the time of their frames;
// the other documents keep their order. The active document changes only when it was removed, or when there was
// none.
export function reconcileCameraTabs(state: ImagesState, cameras: readonly CameraTabSource[], frames: Pick<CaptureFramesState, 'sources'>, io: ImagesIo = browserIo, client: string = clientId) {
	const sorted = cameras.toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
	const names = cameraTabNames(sorted)
	const added: string[] = []

	for (const document of state.documents.toReversed()) {
		if (!document.camera || names.has(document.key)) continue
		const view = state.views[document.key]
		const tool = state.tools[document.key]
		removeDocument(state, document.key, io)
		if (view && tool) parked.set(document.key, { view: { ...view, rendering: undefined, renderPending: false, error: undefined, display: { ...view.display, original: undefined } }, tool })
	}

	for (const camera of sorted) {
		const key = cameraTabKey(camera.connectionId, camera.id)
		const name = names.get(key) ?? camera.name
		const existing = documentOf(state, key)

		if (existing) {
			if (existing.name !== name) existing.name = name
			continue
		}

		const restored = parked.get(key)
		parked.delete(key)
		state.documents.push({ key, name, source: { kind: 'camera', connectionId: camera.connectionId, deviceId: camera.id }, status: 'ready', unsaved: false, camera: { selection: { kind: 'latest' } } })
		state.views[key] = restored?.view ?? newView()
		state.tools[key] = restored?.tool ?? { tool: 'inspector' }
		added.push(key)
	}

	const order = [...sorted.map((camera) => cameraTabKey(camera.connectionId, camera.id)), ...state.documents.filter((d) => !d.camera).map((d) => d.key)]
	if (order.some((key, i) => state.documents[i]?.key !== key)) state.documents = order.map((key) => state.documents.find((d) => d.key === key)!)
	state.activeKey ??= state.documents[0]?.key

	for (const key of added) void selectCameraFrame(state, key, { kind: 'latest' }, frames, io, client)
}

// Selects the frame a camera tab shows and shows it (see showCameraFrame): the latest frame of the camera (the newest
// one that can be opened, as frames knows it), a saved frame, or a frame held for an analysis. A frame already shown
// is not opened again. Without a latest frame, the tab waits for the first one.
export async function selectCameraFrame(state: ImagesState, key: string, selection: CameraFrameSelection, frames: Pick<CaptureFramesState, 'sources'>, io: ImagesIo = browserIo, client: string = clientId) {
	const document = cameraTabOf(state, key)
	if (!document || document.source.kind !== 'camera') return
	const camera = document.camera
	camera.selection = selection
	const frameId = selection.kind === 'latest' ? frames.sources[frameSourceKey(document.source.connectionId, document.source.deviceId)]?.latestAvailableFrameId : selection.frameId

	if (!frameId) {
		camera.requested = undefined
		return
	}

	if (camera.shown?.frame.frameId === frameId && camera.shown.lease) {
		camera.requested = undefined
		camera.error = undefined
		return
	}

	await showCameraFrame(state, key, frameId, io, client)
}

// Shows a frame in a camera tab as one transaction: opens it under a new lease and renders it with the applied
// display settings of the tab (before any, those its camera saved in the profile, or the defaults of the frame), plus
// the original rendering during Show Original, while the previous frame stays shown; then, unless another frame was
// asked for meanwhile or the tab was removed, commits the frame, its document, and its renderings together, adapts
// zoom and pan to its size, clears the selected star and solution of the previous frame, and releases the previous
// lease. Settings being edited in a popup of the viewer toolbar are never applied. A refusal or failed rendering keeps the frame shown and is the tab's error; a superseded frame
// releases its lease and renderings.
export async function showCameraFrame(state: ImagesState, key: string, frameId: string, io: ImagesIo = browserIo, client: string = clientId) {
	const asked = cameraTabOf(state, key)
	if (!asked) return
	asked.camera.requested = frameId
	const current = () => {
		const document = cameraTabOf(state, key)
		return document?.camera.requested === frameId ? document : undefined
	}

	const opened = await requestFrame(frameId, io, client)

	if (typeof opened === 'string') {
		const document = current()

		if (document) {
			document.camera.requested = undefined
			document.camera.error = opened
		}

		return
	}

	const view = state.views[key]

	if (!current() || !view) {
		releaseLease(opened.lease, io)
		return
	}

	// Settings being applied are those of the tab once this frame shows; the rendering of the previous frame they were
	// applied to is aborted by this one.
	const applying = applyingSettings(key)
	const settings = copySettings(applying ?? view.display.applied ?? initialDisplaySettings(opened.info, io.loadDisplay(asked.source)))
	const rendering = await requestRendering(state, key, opened.info.id, settings, io)
	const original = rendering && view.display.showOriginal ? await requestRendering(state, key, opened.info.id, ORIGINAL_DISPLAY_SETTINGS, io) : undefined
	const document = current()
	const committed = state.views[key]

	if (!document || !committed || !rendering || (committed.display.showOriginal && !original)) {
		if (rendering) io.revokeObjectURL(rendering.url)
		if (original) io.revokeObjectURL(original.url)
		releaseLease(opened.lease, io)

		if (document) {
			document.camera.requested = undefined
			document.camera.error = committed?.error ?? 'The frame was not shown; select it again'
		}

		return
	}

	const previous = document.camera.shown?.lease
	const size = document.info

	if (size) committed.view = adaptView(committed.view, size, opened.info)
	document.info = ref(opened.info)
	document.status = 'ready'
	document.error = undefined
	document.camera.shown = { frame: ref(opened.frame), lease: opened.lease }
	document.camera.requested = undefined
	document.camera.error = undefined

	if (committed.rendering) io.revokeObjectURL(committed.rendering.url)
	if (committed.display.original) io.revokeObjectURL(committed.display.original.url)
	committed.rendering = rendering
	committed.display.original = original

	if (applying) {
		// The rendering of the settings being applied was aborted by this frame, so they are saved here instead.
		committed.display.applied = settings
		settleApplying(key, applying)
		io.saveDisplay(document.source, settings)
	} else {
		committed.display.applied ??= settings
	}

	committed.stars.selected = undefined
	committed.streaks.selected = undefined
	committed.annotation.selected = undefined
	committed.plateSolving.selected = undefined
	// Measurements and markers are pixels of the previous frame; a target typed or chosen in Sky is not, and stays.
	const { target } = committed.astrometry
	committed.astrometry = { measurements: [], markers: [], ...(target && target.source !== 'marker' && { target }) }
	if (previous) releaseLease(previous, io)
}

// Holds the frame a camera tab shows for a manual analysis started on it: a tab following the latest frame stops
// following it, and a frame being opened is dropped, so the frame analyzed stays shown. Ignored for any other
// document, and for a tab already showing a saved or held frame.
export function holdCameraFrame(state: ImagesState, key: string) {
	const camera = cameraTabOf(state, key)?.camera
	if (camera?.selection.kind !== 'latest' || !camera.shown) return
	camera.selection = { kind: 'inspect', frameId: camera.shown.frame.frameId }
	camera.requested = undefined
}

// Follows the registry events: a camera tab following the latest frame shows each newer frame of its camera that is
// in memory, and the frame a camera tab shows takes its latest description (such as its file being saved).
export function handleCapturedFrame(state: ImagesState, event: ServerEvent, io: ImagesIo = browserIo, client: string = clientId) {
	if (event.type !== 'captureFrame:updated') return
	const { frame, source } = event

	for (const document of state.documents) {
		const camera = document.camera
		if (!camera || document.source.kind !== 'camera' || document.source.connectionId !== frame.connectionId || document.source.deviceId !== frame.deviceId) continue
		if (camera.shown?.frame.frameId === frame.frameId && camera.shown.frame.revision < frame.revision) camera.shown.frame = ref(frame)

		if (camera.selection.kind !== 'latest' || frame.availability !== 'memory' || frame.frameId !== source.latestFrameId || camera.requested === frame.frameId) continue
		if (camera.shown && camera.shown.frame.sequence >= frame.sequence) continue
		void showCameraFrame(state, document.key, frame.frameId, io, client)
	}
}

// Sends the leases the camera tabs hold to the server, which releases the other leases of the page and answers those
// it no longer has, then shows again the selection of every tab whose lease was lost or that shows nothing yet: the
// latest frame of its camera, as frames knows it after the snapshot, or the same saved or held frame, reopened from
// its file when it was saved; never another frame in place of a saved or held one. Run on every socket open, after
// the snapshot of the frames.
export async function reconcileCapturedFrames(state: ImagesState, frames: Pick<CaptureFramesState, 'sources'>, io: ImagesIo = browserIo, client: string = clientId) {
	const leases = state.documents.flatMap((d) => (d.camera?.shown?.lease ? [d.camera.shown.lease] : []))

	if (leases.length > 0) {
		try {
			const response = await io.fetch(`/api/capture-frames/clients/${encodeURIComponent(client)}/leases`, jsonInit('PUT', { leases }))

			if (response.ok) {
				const { lost } = (await response.json()) as CaptureLeaseReconcileResponse

				for (const document of state.documents) {
					const camera = document.camera
					if (!camera?.shown?.lease || !lost.includes(camera.shown.lease)) continue
					camera.shown.lease = undefined
					camera.error = 'The frame shown is no longer available on the server'
				}
			}
		} catch {
			// The server is unreachable; the next socket open reconciles again.
			return
		}
	}

	for (const document of state.documents) {
		const camera = document.camera
		if (!camera || camera.requested || (camera.shown?.lease && camera.selection.kind !== 'latest')) continue
		void selectCameraFrame(state, document.key, camera.selection, frames, io, client)
	}
}

// Releases the leases of the page when it is hidden for good, since its documents do not survive a reload. Returns a
// function that stops it.
export function releaseLeasesOnHide(state: ImagesState, client: string = clientId): () => void {
	const listener = () => {
		if (state.documents.some((d) => d.camera?.shown?.lease)) navigator.sendBeacon(`/api/capture-frames/clients/${encodeURIComponent(client)}/leases`, new Blob([JSON.stringify({ leases: [] })], { type: 'application/json' }))
	}

	window.addEventListener('pagehide', listener)
	return () => window.removeEventListener('pagehide', listener)
}
