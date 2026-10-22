import type { CameraCapabilities, CaptureFrame, CaptureRequest, CaptureSession, CaptureSnapshot, CaptureSnoop, ServerEvent } from 'api'
import { proxy } from 'valtio'
import type { EquipmentSetup } from '../equipment/roles'
import { type ImagesIo, ORIGINAL_DISPLAY_SETTINGS, browserIo } from '../images/images'

// Camera captures as this tab knows them. The server owns every capture, whichever tab started it, so this
// store only mirrors it: sessions and previewed frames are fed by capture:updated and capture:frame events
// and, on every socket (re)open, by the capture snapshot, so a reloaded tab or another tab shows a capture
// in progress and never starts a second one because it found no local state. Cameras are addressed by
// their exact connection and device ids, never by role. The store also keeps the capabilities of the
// cameras the panel shows, the outcome of this tab's last command to each camera, and the rendering of
// each camera's latest frame, which replaces the previous one only once it is ready, so the viewer never
// goes blank while the next frame is exposed or a rendering fails.

// Phases of a capture that has ended.
const ENDED_PHASES: ReadonlySet<CaptureSession['phase']> = new Set(['completed', 'stopped', 'aborted', 'failed'])

// Rendering of a camera's latest frame.
export interface FrameRendering {
	// Image document the rendering was made from.
	readonly imageId: string
	// Object URL of the rendered JPEG, owned by the store.
	readonly url: string
	// Width of the image, in pixels.
	readonly width: number
	// Height of the image, in pixels.
	readonly height: number
}

// Capture state of the tab, by camera key (cameraKey).
export interface CaptureRuntime {
	// Latest session of each camera, running or ended.
	sessions: Record<string, CaptureSession>
	// Latest previewed frame of each camera.
	frames: Record<string, CaptureFrame>
	// Capabilities of each camera fetched or published so far.
	capabilities: Record<string, CameraCapabilities>
	// Cameras with a start, stop, or abort of this tab waiting for the server.
	pending: Record<string, boolean>
	// Why this tab's last command to a camera failed; cleared by its next command.
	errors: Record<string, string>
	// Rendering shown for each camera's latest frame.
	renderings: Record<string, FrameRendering>
	// Why the latest frame of a camera could not be rendered; cleared by its next rendering.
	renderErrors: Record<string, string>
}

// Capture state of the tab.
export const captureRuntime = proxy<CaptureRuntime>({ sessions: {}, frames: {}, capabilities: {}, pending: {}, errors: {}, renderings: {}, renderErrors: {} })

// Counter of snapshot refreshes; a response is applied only if no later refresh started.
let generation = 0

// Rendering request in flight of each camera, by camera key.
const renders = new Map<string, { readonly imageId: string; readonly controller: AbortController }>()

// Returns the key of a camera: its connection id and exact device id.
export function cameraKey(connectionId: string, deviceId: string) {
	return `${connectionId}:${deviceId}`
}

// Returns the URL of a camera's routes.
function cameraUrl(connectionId: string, deviceId: string) {
	return `/api/connections/${encodeURIComponent(connectionId)}/cameras/${encodeURIComponent(deviceId)}`
}

// Returns whether a session is still running.
export function captureRunning(session: Pick<CaptureSession, 'phase'> | undefined): boolean {
	return session !== undefined && !ENDED_PHASES.has(session.phase)
}

// Returns the error message of a failed response, or a generic one.
async function responseError(response: Response, fallback: string) {
	try {
		const body = (await response.json()) as { readonly error?: string }
		return body.error ?? fallback
	} catch {
		return fallback
	}
}

// Applies a capture or camera event; any other event is ignored. A frame older than the one known for its
// camera, as a late event can be, never replaces it.
export function handleCaptureEvent(state: CaptureRuntime, event: ServerEvent) {
	if (event.type === 'capture:updated') {
		const { session } = event
		state.sessions[cameraKey(session.connectionId, session.deviceId)] = session
	} else if (event.type === 'capture:frame') {
		const { frame } = event
		const key = cameraKey(frame.connectionId, frame.deviceId)
		const known = state.frames[key]
		if (!known || known.imageId === frame.imageId || frame.time >= known.time) state.frames[key] = frame
	} else if (event.type === 'camera:capabilities') {
		const { capabilities } = event
		state.capabilities[cameraKey(capabilities.connectionId, capabilities.id)] = capabilities
	} else if (event.type === 'device:removed') {
		delete state.capabilities[cameraKey(event.connectionId, event.id)]
	} else if (event.type === 'connection:close') {
		for (const key of Object.keys(state.capabilities)) if (state.capabilities[key].connectionId === event.id) delete state.capabilities[key]
	}
}

// Replaces the sessions and frames with the server's snapshot, which may have changed while the socket was
// closed. A response is dropped when another refresh started meanwhile.
export async function refreshCaptures(state: CaptureRuntime, request: typeof fetch = fetch) {
	const current = ++generation

	try {
		const response = await request('/api/captures')
		if (!response.ok || current !== generation) return
		const snapshot = (await response.json()) as CaptureSnapshot
		if (current !== generation) return

		state.sessions = {}
		for (const session of snapshot.sessions) state.sessions[cameraKey(session.connectionId, session.deviceId)] = session
		state.frames = {}
		for (const frame of snapshot.frames) state.frames[cameraKey(frame.connectionId, frame.deviceId)] = frame
	} catch {
		// The server is unreachable; the next socket open refreshes the captures.
	}
}

// Fetches the capabilities of a camera; a camera that is not found has none.
export async function refreshCapabilities(state: CaptureRuntime, connectionId: string, deviceId: string, request: typeof fetch = fetch) {
	const key = cameraKey(connectionId, deviceId)

	try {
		const response = await request(cameraUrl(connectionId, deviceId))
		if (response.ok) state.capabilities[key] = (await response.json()) as CameraCapabilities
		else if (response.status === 404) delete state.capabilities[key]
	} catch {
		// The server is unreachable; the next socket open refreshes them.
	}
}

// Fetches again the capabilities of every camera known so far, which may have changed while the event
// socket was closed.
export function refreshCameraCapabilities(state: CaptureRuntime, request: typeof fetch = fetch) {
	for (const { connectionId, id } of Object.values(state.capabilities)) void refreshCapabilities(state, connectionId, id, request)
}

// Sends a command to a camera's capture route and records its failure. When the server cannot be reached,
// the command may still have been applied, so the snapshot is fetched again before the camera accepts
// another command, instead of assuming nothing happened.
async function command(state: CaptureRuntime, connectionId: string, deviceId: string, path: string, body: unknown, fallback: string, request: typeof fetch) {
	const key = cameraKey(connectionId, deviceId)
	if (state.pending[key]) return
	state.pending[key] = true
	delete state.errors[key]

	try {
		const response = await request(`${cameraUrl(connectionId, deviceId)}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
		if (!response.ok) state.errors[key] = await responseError(response, fallback)
	} catch {
		state.errors[key] = 'Unable to reach the server.'
		await refreshCaptures(state, request)
	} finally {
		delete state.pending[key]
	}
}

// Starts a capture on a camera; its progress arrives as events.
export function startCapture(state: CaptureRuntime, connectionId: string, deviceId: string, capture: CaptureRequest, request: typeof fetch = fetch) {
	return command(state, connectionId, deviceId, 'capture', capture, 'Unable to start the capture.', request)
}

// Stops the capture of a camera after the exposure in flight.
export function stopCapture(state: CaptureRuntime, connectionId: string, deviceId: string, request: typeof fetch = fetch) {
	return command(state, connectionId, deviceId, 'capture/stop', undefined, 'Unable to stop the capture.', request)
}

// Aborts the exposure in flight and the capture of a camera.
export function abortCapture(state: CaptureRuntime, connectionId: string, deviceId: string, request: typeof fetch = fetch) {
	return command(state, connectionId, deviceId, 'capture/abort', undefined, 'Unable to abort the capture.', request)
}

// Returns a number limited to [min, max]; a bound that is undefined does not limit it.
function clamp(value: number, min?: number, max?: number) {
	return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value))
}

// Fits a Camera Capture form to the capabilities of the camera it is sent to, since the server sends
// every value to the driver as given: the exposure, gain, offset, and binning are limited to the ranges
// the driver publishes, a subframe is sent only to a camera that can take one and is kept inside its
// sensor, and XISF only to a driver that offers it. Without known capabilities the form is sent as is.
export function captureRequest(settings: Readonly<CaptureRequest>, capabilities?: CameraCapabilities): CaptureRequest {
	if (!capabilities) return { ...settings, output: { ...settings.output } }

	const { exposure, gain, offset, bin, subframe } = capabilities
	const binX = bin ? clamp(settings.binX, 1, bin.x) : 1
	const binY = bin ? clamp(settings.binY, 1, bin.y) : 1
	const width = subframe ? clamp(settings.width, 0, subframe.width) : 0
	const height = subframe ? clamp(settings.height, 0, subframe.height) : 0

	return {
		...settings,
		exposureTime: exposure && exposure.min > 0 ? clamp(settings.exposureTime, exposure.min, exposure.max) : clamp(settings.exposureTime, undefined, exposure?.max),
		gain: gain ? clamp(settings.gain, gain.min, gain.max) : settings.gain,
		offset: offset ? clamp(settings.offset, offset.min, offset.max) : settings.offset,
		binX,
		binY,
		subframe: subframe !== undefined && settings.subframe && width > 0 && height > 0,
		x: subframe ? clamp(settings.x, 0, subframe.width - width) : 0,
		y: subframe ? clamp(settings.y, 0, subframe.height - height) : 0,
		width,
		height,
		frameFormat: capabilities.frameFormats.some((format) => format.name === settings.frameFormat) ? settings.frameFormat : '',
		output: { ...settings.output, format: settings.output.format === 'XISF' && capabilities.transferFormats.includes('XISF') ? 'XISF' : 'FITS' },
	}
}

// Returns the devices every capture of a setup's cameras snoops into its frame headers: the mount, focuser, filter
// wheel, and rotator the setup assigns, by device id; a role with no device is not snooped.
export function captureSnoop(setup: Readonly<EquipmentSetup>): CaptureSnoop {
	return { mount: setup.MOUNT?.id, focuser: setup.FOCUSER?.id, wheel: setup.FILTER_WHEEL?.id, rotator: setup.ROTATOR?.id }
}

// Formats a duration in seconds with at most three decimals, such as 3.2 or 0.001.
function seconds(value: number) {
	return String(Math.round(value * 1000) / 1000)
}

// Returns what a session is doing, for the status line: the exposure progress, the delay left, or the
// outcome. Progress is shown only when the driver reports it; a delay under 1 s has no countdown.
export function captureStatus(session: CaptureSession): string {
	const { exposure, delay } = session
	const total = session.request.exposureTime

	switch (session.phase) {
		case 'starting':
			return 'Starting'
		case 'exposing':
			return exposure ? `Exposing — ${seconds(exposure.elapsedTime / 1000000)} / ${seconds(total)} s` : 'Exposing'
		case 'reading':
			return 'Reading Frame'
		case 'saving':
			return 'Saving Frame'
		case 'waiting':
			return delay ? `Waiting — ${seconds(delay.remainingTime / 1000000)} s` : 'Waiting'
		case 'analysisWait':
			return 'Waiting for Analysis Capacity'
		case 'completed':
			return 'Completed'
		case 'stopped':
			return 'Stopped'
		case 'aborted':
			return 'Aborted'
		case 'failed':
			return session.error ? `Failed: ${session.error}` : `Failed (${session.reason ?? 'unknown'})`
	}
}

// Returns the frame count of a session: taken out of requested, or taken so far for a loop.
export function captureCount(session: Pick<CaptureSession, 'captured' | 'count'>): string {
	return session.count === undefined ? `Captured ${session.captured}` : `Captured ${session.captured} / ${session.count}`
}

// State of a camera's latest frame in this tab, independent of the capture's outcome:
// - received: the frame arrived and is not rendered yet.
// - ready: the frame is rendered and shown.
// - error: the frame could not be decoded on the server or rendered here.
export type FrameState = 'received' | 'ready' | 'error'

// Label of each frame state.
export const FRAME_STATE_LABELS: Readonly<Record<FrameState, string>> = { received: 'Received', ready: 'Ready', error: 'Error' }

// State of a frame's file: not-saved for a frame that is only previewed, otherwise its CaptureFileState.
export type FileState = 'not-saved' | NonNullable<CaptureFrame['file']>

// Label of each file state.
export const FILE_STATE_LABELS: Readonly<Record<FileState, string>> = { 'not-saved': 'Not Saved', saving: 'Saving', saved: 'Saved', failed: 'Save Failed' }

// Returns the state of a camera's latest frame from its rendering, the error of its last rendering, and the
// session's preview error. A frame is ready once its own rendering is shown, whatever happened since.
export function frameState(frame: Pick<CaptureFrame, 'imageId'>, rendering?: Pick<FrameRendering, 'imageId'>, renderError?: string, previewError?: string): FrameState {
	if (rendering?.imageId === frame.imageId) return 'ready'
	return renderError || previewError ? 'error' : 'received'
}

// Returns the state of a frame's file.
export function fileState(frame: Pick<CaptureFrame, 'file'>): FileState {
	return frame.file ?? 'not-saved'
}

// Returns the time a session has run, or ran, in seconds; now is Unix milliseconds.
export function captureElapsed(session: Pick<CaptureSession, 'startedAt' | 'endedAt'>, now: number) {
	return Math.max(0, ((session.endedAt ?? now) - session.startedAt) / 1000)
}

// Renders a camera's latest frame with an auto stretch, debayering a mosaic with its own pattern, unless it
// is already rendered or being rendered. The rendering replaces the camera's previous one only once it is
// ready; a frame closed on the server meanwhile (a newer one replaced it) is skipped silently, and any
// other failure keeps the previous rendering and records why.
export async function renderFrame(state: CaptureRuntime, key: string, frame: Pick<CaptureFrame, 'imageId' | 'cfa' | 'width' | 'height'>, io: ImagesIo = browserIo) {
	if (state.renderings[key]?.imageId === frame.imageId || renders.get(key)?.imageId === frame.imageId) return

	renders.get(key)?.controller.abort()
	const controller = new AbortController()
	renders.set(key, { imageId: frame.imageId, controller })

	try {
		const settings = { ...ORIGINAL_DISPLAY_SETTINGS, ...(frame.cfa && { debayer: { enabled: true, pattern: 'auto' } as const }) }
		const response = await io.fetch(`/api/images/${encodeURIComponent(frame.imageId)}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }), signal: controller.signal })
		if (response.status === 404 || response.status === 409) return
		if (!response.ok) throw new Error(await responseError(response, 'Unable to render the frame.'))
		const blob = await response.blob()
		if (controller.signal.aborted) return

		const previous = state.renderings[key]
		state.renderings[key] = { imageId: frame.imageId, url: io.createObjectURL(blob), width: frame.width, height: frame.height }
		delete state.renderErrors[key]
		if (previous) io.revokeObjectURL(previous.url)
	} catch (error) {
		if (!controller.signal.aborted) state.renderErrors[key] = error instanceof Error ? error.message : 'Unable to reach the server.'
	} finally {
		if (renders.get(key)?.controller === controller) renders.delete(key)
	}
}
