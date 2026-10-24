import type { CameraCapabilities, CaptureFrame, CaptureRequest, CaptureSession, CaptureSnapshot, CaptureSnoop, ServerEvent } from 'api'
import { proxy } from 'valtio'
import type { EquipmentSetup } from '../equipment/roles'
import { deviceUrl, jsonInit, responseError } from '../http'
import type { CameraAcquisitionSettings, CameraExposureSettings } from '../profile/profile'

// Camera captures as this tab knows them. The server owns every capture, whichever tab started it, so this
// store only mirrors it: sessions and previewed frames are fed by capture:updated and capture:frame events
// and, on every socket (re)open, by the capture snapshot, so a reloaded tab or another tab shows a capture
// in progress and never starts a second one because it found no local state. Cameras are addressed by
// their exact connection and device ids, never by role; their capabilities are the camera states the control
// runtime mirrors. The store also keeps the outcome of this tab's last command to each camera. Frames are shown by the
// Images camera tabs through the capture frame registry, never rendered here.

// Phases of a capture that has ended.
const ENDED_PHASES: ReadonlySet<CaptureSession['phase']> = new Set(['completed', 'stopped', 'aborted', 'failed'])

// Capture state of the tab, by camera key (cameraKey).
export interface CaptureRuntime {
	// Latest session of each camera, running or ended.
	sessions: Record<string, CaptureSession>
	// Latest previewed frame of each camera.
	frames: Record<string, CaptureFrame>
	// Cameras with a start, stop, or abort of this tab waiting for the server.
	pending: Record<string, boolean>
	// Why this tab's last command to a camera failed; cleared by its next command.
	errors: Record<string, string>
}

// Capture state of the tab.
export const captureRuntime = proxy<CaptureRuntime>({ sessions: {}, frames: {}, pending: {}, errors: {} })

// Counter of snapshot refreshes; a response is applied only if no later refresh started.
let generation = 0

// Returns the key of a camera: its connection id and exact device id.
export function cameraKey(connectionId: string, deviceId: string) {
	return `${connectionId}:${deviceId}`
}

// Returns whether a session is still running.
export function captureRunning(session: Pick<CaptureSession, 'phase'> | undefined): boolean {
	return session !== undefined && !ENDED_PHASES.has(session.phase)
}

// Applies a capture event; any other event is ignored. A frame older than the one known for its
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

// Sends a command to a camera's capture route and records its failure. When the server cannot be reached,
// the command may still have been applied, so the snapshot is fetched again before the camera accepts
// another command, instead of assuming nothing happened.
async function command(state: CaptureRuntime, connectionId: string, deviceId: string, path: string, body: unknown, fallback: string, request: typeof fetch) {
	const key = cameraKey(connectionId, deviceId)
	if (state.pending[key]) return
	state.pending[key] = true
	delete state.errors[key]

	try {
		const response = await request(deviceUrl(connectionId, 'camera', deviceId, path), jsonInit('POST', body))
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

// Fits the exposure and camera settings of a camera to its capabilities, since the server sends every value to the
// driver as given: the exposure, gain, offset, and binning are limited to the ranges the driver publishes, a subframe
// is sent only to a camera that can take one and is kept inside its sensor, and an unknown readout mode is replaced
// by the driver's default. Without known capabilities the settings are sent as they are.
export function fitExposure(settings: Readonly<CameraExposureSettings>, capabilities?: CameraCapabilities): CameraExposureSettings {
	const { exposureTime, gain, offset, binX, binY, subframe, x, y, width, height, frameFormat } = settings
	if (!capabilities) return { exposureTime, gain, offset, binX, binY, subframe, x, y, width, height, frameFormat }

	const { exposure, bin } = capabilities
	const fitted = { width: capabilities.subframe ? clamp(width, 0, capabilities.subframe.width) : 0, height: capabilities.subframe ? clamp(height, 0, capabilities.subframe.height) : 0 }

	return {
		exposureTime: exposure && exposure.min > 0 ? clamp(exposureTime, exposure.min, exposure.max) : clamp(exposureTime, undefined, exposure?.max),
		gain: capabilities.gain ? clamp(gain, capabilities.gain.min, capabilities.gain.max) : gain,
		offset: capabilities.offset ? clamp(offset, capabilities.offset.min, capabilities.offset.max) : offset,
		binX: bin ? clamp(binX, 1, bin.x) : 1,
		binY: bin ? clamp(binY, 1, bin.y) : 1,
		subframe: capabilities.subframe !== undefined && subframe && fitted.width > 0 && fitted.height > 0,
		x: capabilities.subframe ? clamp(x, 0, capabilities.subframe.width - fitted.width) : 0,
		y: capabilities.subframe ? clamp(y, 0, capabilities.subframe.height - fitted.height) : 0,
		...fitted,
		frameFormat: capabilities.frameFormats.some((format) => format.name === frameFormat) ? frameFormat : '',
	}
}

// Builds the request of a capture from the exposure settings and the Camera Acquisition form of a camera, fitted to
// its capabilities (see fitExposure); XISF is sent only to a driver that offers it.
export function captureRequest(exposure: Readonly<CameraExposureSettings>, acquisition: Readonly<CameraAcquisitionSettings>, capabilities?: CameraCapabilities): CaptureRequest {
	const { exposureMode, count, delay, frameType, output } = acquisition
	const format = output.format === 'XISF' && capabilities && !capabilities.transferFormats.includes('XISF') ? 'FITS' : output.format
	return { ...fitExposure(exposure, capabilities), exposureMode, count, delay, frameType, output: { ...output, format } }
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

// State of a frame's file: not-saved for a frame that is only previewed, otherwise its CaptureFileState.
export type FileState = 'not-saved' | NonNullable<CaptureFrame['file']>

// Label of each file state.
export const FILE_STATE_LABELS: Readonly<Record<FileState, string>> = { 'not-saved': 'Not Saved', saving: 'Saving', saved: 'Saved', failed: 'Save Failed' }

// Returns the state of a frame's file.
export function fileState(frame: Pick<CaptureFrame, 'file'>): FileState {
	return frame.file ?? 'not-saved'
}

// Returns the time a session has run, or ran, in seconds; now is Unix milliseconds.
export function captureElapsed(session: Pick<CaptureSession, 'startedAt' | 'endedAt'>, now: number) {
	return Math.max(0, ((session.endedAt ?? now) - session.startedAt) / 1000)
}
