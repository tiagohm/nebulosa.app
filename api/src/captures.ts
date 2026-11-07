import { basename, join } from 'path'
import { formatTemporal, TIMEZONE } from 'nebulosa/src/astronomy/time/temporal'
import { type Camera, type CameraTransferFormat, CLIENT, type Client } from 'nebulosa/src/devices/indi/device'
import type { FailedOperationResult, OperationFailureReason, OperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { type ResourceReservation, resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { numericKeyword } from 'nebulosa/src/io/formats/fits/util'
import { type CameraCaptureHandle, type CameraCaptureSuspension, CameraCapturer, type CameraFrameGate, type CameraFramePathRequest, type CameraFramePreparation, writeFrameExclusively } from 'nebulosa/src/observation/capture/capture'
import type { CameraCaptureListener } from 'nebulosa/src/observation/capture/reporter'
import { type CameraCaptureEvent, type CameraCaptureStart, type CameraCaptureTime, DEFAULT_CAMERA_CAPTURE_START } from 'nebulosa/src/observation/capture/types'
import type { CaptureFrameRegistry } from './captureframes'
import { type CommandErrorCode, type CommandRefusal, type CommandRequest, refusal, refusalResponse } from './commands'
import { DEFAULT_DATA_DIRECTORY } from './database'
import type { DeviceRegistry } from './devices'
import { type CaptureDither, type CaptureDitherErrorCode, type CaptureDitherLoan, type CaptureDitherPlan, type CaptureDithering, ditherBoundary } from './dithering'
import { errorResponse } from './http'
import type { ImageAcquisition, ImageInfo, ImageStore } from './images'
import type { OperationRegistry, ToolInvocation } from './operations'

// Camera Capture service: single, fixed-count, and loop acquisitions of one camera, run on the server through
// the toolkit's CameraCapturer under the process-wide operation registry, so the camera stays held for the
// whole capture (inter-frame delays included) and no other operation can expose it meanwhile. A capture is
// addressed by the exact connection and device ids of the camera, never by a role, and belongs to the
// server: tabs only start, stop, abort, and observe it, through the routes and the capture:updated and
// capture:frame events, and the snapshot of GET /api/captures after any reconnect.
//
// The delay is the wait between the end of one frame (exposure, transfer, decoding, and the confirmed write
// when saving) and the start of the next, never a cadence: there is none before the first frame or after the
// last, and stopping during it ends the capture at once. With Preview + Save each frame is written as the
// bytes the driver sent, under the configured directory and filename template, by an exclusive write that
// never replaces a file; the saved count rises only once the write completed, and a failed write ends the
// capture. Every frame is also decoded into the image store as its own capture document, independently of
// the write, and recorded in the capture frame registry (captureframes.ts), which keeps the latest frame of each
// camera open and closes the previous one unless the Images workspace holds it. Decoding never delays the
// capture: while a frame of a camera is being decoded, only the newest of the frames arriving meanwhile is
// kept for decoding next, so a fast loop previews fewer frames than it saves. Exposure and delay times are
// in seconds in requests and microseconds in progress. The mount, focuser, filter wheel and rotator a request
// names by id on the connection of the camera are snooped into the frame headers, never acquired.
//
// A fixed or loop LIGHT capture may dither between its frames (dithering.ts): the capture keeps the cadence, dithering
// before the frame that follows each `everyFrames` frames taken, after the delay and never before the first frame or
// after the last, and the dithering service runs each dither with the method of the request. The dither phase is
// published, a failed dither ends the capture, and the capture ends only once its dithers gave back what they held.
//
// A capture never analyzes or solves its frames: star detection and plate solving are run on demand on the frames the
// Images workspace shows, and Auto Focus measures its own frames.
//
// Every start carries a token the tab generates for it, so a repeated request answers the session it started instead of
// exposing again. A capture is stopped or aborted by its session id, so a late command never reaches the session that
// replaced it. A service composing tools inside the process admits a capture (admit) under the ToolInvocation of the
// reservation it holds, may hold each next frame back with a gate of its own, and awaits the final session of the exact
// capture it admitted, which stays known after a newer session of the camera replaced it.
//
// A capture started by a tab can be paused between two frames by a tool of the process that needs its camera, such as the
// Meridian Flip Executor (suspendForMotion): the pause takes effect after the frame in flight was exposed, received and
// written, before the next frame's gate and dither, and lends the camera, and the reservation of its mount dithers, to the
// tool's reservation. The session keeps its id, counters, file sequence and dither cadence, publishes the paused phase,
// counts none of the borrower's frames, and goes on from its next frame when the tool resumes it. A tool that cannot let
// it go on releases it instead: the capture takes its camera back and stays paused until the operator resumes it (the
// resume route) or stops it.

// Directory saved frames go into when a request names none, and the published path of previewed frames.
export const DEFAULT_CAPTURES_DIR = join(DEFAULT_DATA_DIRECTORY, 'captures')

// Filename template of saved frames when a request names none.
export const DEFAULT_FILENAME_TEMPLATE = '{date}_{time}_{camera}_{type}_{seq}'

// Time allowed for the payload of a frame to arrive, in milliseconds: after the requested exposure for the
// exposure completion and BLOB rendezvous, and after a stop for the exposure to report it is no longer Busy.
// INDI delivers in order, so a stop's answer arrives only after the BLOB in transit, which for a 93.5 MB
// unbinned ASI294MM Pro frame (124.8 MB in base64) took about 130 s over a 1.2 MB/s network link. Ten
// minutes covers such a frame down to about 0.2 MB/s; a frame that is really lost fails only after it.
const FRAME_TRANSFER_TIMEOUT = 600000

// What a capture does with its frames: preview and write each one to a file of the server, or only preview it.
export type CaptureOutputMode = 'preview-save' | 'preview-only'

// Payload format a frame is transferred and saved in; NATIVE payloads cannot be decoded or saved as frames.
export type CaptureFormat = Exclude<CameraTransferFormat, 'NATIVE'>

// Destination of the frames of a capture.
export interface CaptureOutput {
	// Whether frames are saved as well as previewed.
	readonly mode: CaptureOutputMode
	// Absolute directory of the server saved frames go into; DEFAULT_CAPTURES_DIR when absent.
	readonly directory?: string
	// Name of each saved frame without its extension, with the placeholders {camera}, {type}, {date}
	// (YYYY-MM-DD), {time} (HH-mm-ss-SSS), and {seq} (the frame number, from 0001), all in the server's local
	// time at the moment the exposure is commanded; DEFAULT_FILENAME_TEMPLATE when absent.
	readonly filenameTemplate?: string
	// Format the driver transfers and the frame is saved in.
	readonly format: CaptureFormat
}

// Camera settings and acquisition of a capture, the toolkit's request fields with the exposure in seconds.
// Gain, offset, binning, subframe, and readout mode a camera does not support are left unchanged.
export type CaptureSettings = Pick<CameraCaptureStart, 'exposureMode' | 'count' | 'delay' | 'exposureTime' | 'frameType' | 'gain' | 'offset' | 'binX' | 'binY' | 'subframe' | 'x' | 'y' | 'width' | 'height' | 'frameFormat'>

// Devices whose state the driver of a camera stamps into the frame headers, by exact device id on the connection of
// the camera. A device that is absent, or an id the connection does not have, is not snooped.
export interface CaptureSnoop {
	// Id of the mount.
	readonly mount?: string
	// Id of the focuser.
	readonly focuser?: string
	// Id of the filter wheel.
	readonly wheel?: string
	// Id of the rotator.
	readonly rotator?: string
}

// Request of a capture, as its session keeps it. exposureTime and delay are in seconds.
export interface CaptureRequest extends CaptureSettings {
	// Destination of the frames.
	readonly output: CaptureOutput
	// Devices snooped into the frame headers; absent snoops none.
	readonly snoop?: CaptureSnoop
	// Automatic dither between the frames of a fixed or loop LIGHT capture (see dithering.ts); absent, or on a single
	// exposure or another frame type, the capture never dithers.
	readonly dither?: CaptureDither
}

// Body of POST /api/connections/:id/cameras/:deviceId/capture: a capture request and the token of the request.
export interface CaptureStartRequest extends CaptureRequest, CommandRequest {}

// Body of POST /api/connections/:id/cameras/:deviceId/capture/stop and .../abort: the session to stop or abort.
export interface CaptureControlRequest {
	// Id of the capture session, which must be the running session of the camera.
	readonly sessionId: string
}

// Options of a capture admitted inside the process.
export interface CaptureAdmissionOptions {
	// Reservation the capture runs inside; absent, the camera must be available, as for a manual capture.
	readonly invocation?: ToolInvocation
	// Awaited before each frame is prepared, after the gate of the frame sink, never before the exposure in flight. It
	// receives the generation the frame opens and a signal aborted by a stop, an abort, or a failure, and must settle when
	// it aborts. Resolving undefined lets the frame go; a failure, or a rejection (commandFailed), ends the capture with it.
	readonly beforeFrame?: CameraFrameGate
}

// Capture admitted inside the process: its identity, its start, and its end.
export interface CaptureAdmitted {
	readonly ok: true
	// Id of the capture session, repeated by its capture events.
	readonly sessionId: string
	// Id of the operation holding the camera, repeated by its operation:updated events.
	readonly operationId: string
	// Whether the token had already started the capture, which this request did not start again.
	readonly repeated: boolean
	// Settles once the camera was configured and the first exposure was dispatched, or with why it was not.
	readonly started: Promise<OperationResult<void>>
	// Final session once the capture ended and its cleanup released the camera: phase completed or stopped (with
	// Preview + Save, saved equals captured, since a failed write fails the capture), aborted, or failed with its
	// reason and error. Never rejects.
	readonly ended: Promise<CaptureSession>
}

// Outcome of asking for a capture inside the process: the capture admitted, or why it was refused, the refusals of the
// dither preflight included.
export type CaptureAdmission = CaptureAdmitted | CommandRefusal<CommandErrorCode | CaptureDitherErrorCode>

// Tool of the process asking to pause a capture (see CameraCaptures.suspendForMotion). Never serialized.
export interface CaptureSuspensionRequester {
	// Identity of the request: the same id asking again gets the same answer, any other is refused while one is pending.
	readonly id: string
	// Name of the tool, meant for people.
	readonly holder: string
	// Reservation the camera, and the dither reservation of the capture, are lent to.
	readonly reservation: ResourceReservation
}

// Paused capture as the tool that paused it holds it. Never serialized: only that tool can resume or release it.
export interface CaptureSuspensionHandle {
	// Id of the paused capture session.
	readonly sessionId: string
	// Frames dispatched before the pause; the next frame opens generation + 1.
	readonly generation: number
	// Final session once the capture ended, however it ended; never rejects.
	readonly ended: Promise<CaptureSession>
	// Takes the camera and the dither reservation back from the tool's reservation, still paused, at once: busy while an
	// operation of the tool still holds one of them, ended once the capture ended.
	readonly reclaim: () => 'reclaimed' | 'busy' | 'ended'
	// Takes everything back and lets the capture go on with its next frame; busy or ended as reclaim. Once resumed, the
	// handle does nothing more.
	readonly resume: () => 'resumed' | 'busy' | 'ended'
	// Takes everything back and leaves the capture paused, for the operator to resume or stop; busy or ended as reclaim.
	readonly release: () => 'released' | 'busy' | 'ended'
}

// Outcome of asking to pause a capture: paused, with the handle; ended before reaching a frame boundary, with its final
// session; withdrawn, when the signal aborted before the boundary and the capture goes on; or refused.
export type CaptureSuspensionAdmission = { readonly status: 'suspended'; readonly handle: CaptureSuspensionHandle } | { readonly status: 'captureEnded'; readonly session: CaptureSession } | { readonly status: 'withdrawn' } | CommandRefusal<'notFound' | 'busy' | 'unsupported' | 'deviceError'>

// Pause of a capture as its session publishes it: requested while it waits for the frame boundary, suspended while a tool
// holds the camera, released once the tool gave it back and the capture waits for the operator.
export interface CaptureSuspensionState {
	// Tool that asked for the pause, meant for people.
	readonly holder: string
	// Where the pause stands.
	readonly state: 'requested' | 'suspended' | 'released'
}

// Response of an accepted capture.
export interface CaptureStartResponse {
	// Id of the capture session, repeated by its capture events.
	readonly sessionId: string
	// Id of the operation holding the camera, repeated by its operation:updated events.
	readonly operationId: string
}

// What a capture is doing, as far as the camera and the service report it:
// - starting: the capture is acquiring the camera and applying its settings.
// - exposing: an exposure was commanded or is running.
// - reading: the exposure finished and its frame is being transferred and decoded.
// - saving: the frame is being written to its file.
// - waiting: the delay before the next frame is running.
// - dithering: a dither before the next frame is moving the mount or the guide lock, or waiting for its settle.
// - paused: the capture is paused between two frames (see CaptureSession.suspension).
// - completed: every requested frame was taken.
// - stopped: the capture was stopped and ended after its last frame.
// - aborted: the capture was aborted; the exposure in flight was lost.
// - failed: the capture ended because of an error, given in reason and error.
export type CapturePhase = 'starting' | 'exposing' | 'reading' | 'saving' | 'waiting' | 'dithering' | 'paused' | 'completed' | 'stopped' | 'aborted' | 'failed'

// Dithers of a capture that dithers, as its session publishes them.
export interface CaptureDitherProgress {
	// Dithers that settled.
	readonly completed: number
	// Whether the dither running waits for its mechanical settle; a guided settle is shown by its guiding session.
	readonly settling: boolean
	// Why the latest dither failed, which ended the capture; absent while none failed.
	readonly error?: string
}

// State of the write of a saved frame's file, independent of the capture's outcome:
// - saving: the write has not completed yet.
// - saved: the file was completely written.
// - failed: the write failed, which also ends the capture.
export type CaptureFileState = 'saving' | 'saved' | 'failed'

// Frame of a capture that was decoded into the image store.
export interface CaptureFrame {
	// Id of the capture document of the frame in the image store.
	readonly imageId: string
	// Id of the capture session that took it.
	readonly sessionId: string
	// Id of the open connection that provides the camera.
	readonly connectionId: string
	// Exact id of the camera.
	readonly deviceId: string
	// Frame number within the session, from 1.
	readonly generation: number
	// Instant the frame's exposure was commanded, Unix milliseconds (UTC).
	readonly time: number
	// Absolute path of the file the frame is saved to; absent when it is only previewed.
	readonly path?: string
	// State of the write of the frame's file; absent when the frame is only previewed.
	readonly file?: CaptureFileState
	// Frame type the capture requested.
	readonly frameType: CaptureSettings['frameType']
	// Width of the image, in pixels.
	readonly width: number
	// Height of the image, in pixels.
	readonly height: number
	// Number of channels: 1 for grayscale or a raw CFA mosaic, 3 for RGB.
	readonly channels: number
	// CFA pattern at the image origin of a mono CFA mosaic (ImageInfo cfa); absent otherwise.
	readonly cfa?: ImageInfo['cfa']
	// FITS BITPIX of the frame: 8, 16, or 32 for integers, -32 or -64 for floats; absent when not reported.
	readonly bitpix?: number
	// Acquisition data the driver wrote into the frame's header.
	readonly acquisition: ImageAcquisition
}

// State of a capture session as published to clients. It stays listed after it ends, until the next capture
// of the same camera replaces it, so its outcome can still be shown.
export interface CaptureSession {
	// Id of the capture session.
	readonly sessionId: string
	// Id of the operation holding the camera.
	readonly operationId: string
	// Id of the open connection that provides the camera.
	readonly connectionId: string
	// Exact id of the camera.
	readonly deviceId: string
	// Driver-reported camera name.
	readonly cameraName: string
	// Request the session runs, as received; it never changes while the session runs.
	readonly request: CaptureRequest
	// What the capture is doing, or how it ended.
	readonly phase: CapturePhase
	// Whether a stop was requested: the capture ends after the exposure in flight.
	readonly stopping: boolean
	// Frames taken and decoded, whether or not they were saved.
	readonly captured: number
	// Frames whose file was completely written.
	readonly saved: number
	// Frames requested; absent for a loop.
	readonly count?: number
	// Progress of the current exposure, in microseconds; absent when the driver reported none.
	readonly exposure?: CameraCaptureTime
	// Progress of the current delay, in microseconds; absent while not waiting, and for delays under 1 s.
	readonly delay?: CameraCaptureTime
	// Instant the capture started, Unix milliseconds (UTC).
	readonly startedAt: number
	// Instant the capture ended, Unix milliseconds (UTC); absent while it runs.
	readonly endedAt?: number
	// Why the capture failed or was aborted; present only when the phase is failed or aborted.
	readonly reason?: OperationFailureReason
	// Human-readable detail of the failure, when there is one.
	readonly error?: string
	// Why the latest frame could not be previewed; cleared by the next previewed frame.
	readonly previewError?: string
	// Dithers of the capture; absent when it does not dither.
	readonly dither?: CaptureDitherProgress
	// Pause asked by a tool of the process; absent when none was asked or the capture went on.
	readonly suspension?: CaptureSuspensionState
}

// Snapshot of GET /api/captures: the latest session and the latest previewed frame of each camera.
export interface CaptureSnapshot {
	// Latest session of each camera, running or ended.
	readonly sessions: readonly CaptureSession[]
	// Latest previewed frame of each camera.
	readonly frames: readonly CaptureFrame[]
}

// Notification published when a capture session changes, and when a frame is previewed or saved.
export type CaptureEvent = { readonly type: 'capture:updated'; readonly session: CaptureSession } | { readonly type: 'capture:frame'; readonly frame: CaptureFrame }

// Receiver of capture events.
export type CaptureListener = (event: CaptureEvent) => void

// LIGHT frame of a capture session as a frame sink receives it, once per frame whatever the preview keeps.
export interface CapturedFrame {
	// Identity of the frame, unique across captures: the capture session id and the frame generation.
	readonly frameId: string
	// Id of the capture session that took it.
	readonly sessionId: string
	// Frame number within the session, from 1.
	readonly generation: number
	// Id of the open connection that provides the camera.
	readonly connectionId: string
	// Exact id of the camera.
	readonly deviceId: string
	// Driver-reported camera name.
	readonly cameraName: string
	// Instant the frame's exposure was commanded, Unix milliseconds (UTC).
	readonly time: number
	// Request of the session, as received; it never changes while the session runs.
	readonly request: CaptureRequest
}

// Consumer of every LIGHT frame of the capture sessions, such as Live Stacking, fed from the decoded frames
// before the lossy preview and from the confirmed writes. It never commands the camera. Every call is
// synchronous, but the gate, and none may throw into the capture: a throwing sink is ignored for that call.
export interface CaptureFrameSink {
	// Whether the frames of a camera are wanted now; asked for each LIGHT frame as it is decoded.
	readonly wants: (connectionId: string, deviceId: string) => boolean
	// A wanted frame was decoded. Preview-only frames carry bytes, a copy the sink owns; a saved frame carries none,
	// and its file follows with saved or saveFailed once its write completed.
	readonly captured: (frame: CapturedFrame, bytes?: Uint8Array<ArrayBuffer>) => void
	// The file of a saved LIGHT frame was completely written at path.
	readonly saved: (frameId: string, path: string) => void
	// The write of a saved LIGHT frame failed; the capture fails with it.
	readonly saveFailed: (frameId: string) => void
	// Awaited before each frame of a capture is prepared, so the sink can hold the next exposure back while it
	// cannot take another frame; never the exposure in flight. It must settle when signal aborts (stop, abort,
	// failure of the capture) and its result, or a rejection, never ends the capture.
	readonly gate: (connectionId: string, deviceId: string, signal: AbortSignal) => Promise<void> | undefined
	// A capture session ended, however it ended; no frame of it arrives afterwards.
	readonly captureEnded: (sessionId: string, connectionId: string, deviceId: string) => void
}

// Frames of a session remembered behind the newest one, so a loop keeps a bounded record. Only the newest
// frame waits for preview, so a frame being decoded is at most a few generations old.
const FRAME_HISTORY = 8

// What the service knows of one frame of a running session.
interface FrameRecord {
	// Instant the frame's exposure was commanded, Unix milliseconds (UTC).
	readonly time: number
	// File the frame is saved to, when saving.
	readonly path?: string
	// State of the write of that file, when saving.
	file?: CaptureFileState
}

// Frame of a running session waiting to be decoded, or being decoded.
interface PendingFrame {
	// Copy of the frame bytes, owned by the service until they are transferred to the image worker.
	readonly bytes: Uint8Array<ArrayBuffer>
	// Frame number within the session.
	readonly generation: number
	// Instant the frame's exposure was commanded, Unix milliseconds (UTC).
	readonly time: number
	// File the frame is saved to, when saving.
	readonly path?: string
}

// Capture of one camera, with what the service needs to follow it while it runs and to answer it once it ended.
interface ActiveCapture {
	// Published state, replaced on every change.
	session: CaptureSession
	// Interruptions of the toolkit capture, once it started.
	handle?: Pick<CameraCaptureHandle, 'stop' | 'cancel' | 'suspend'>
	// Admission answered to the request that started it, once it started.
	admitted?: CaptureAdmitted
	// Resolved with the final session once the capture ended.
	readonly ended: PromiseWithResolvers<CaptureSession>
	// Gate of the caller that admitted it, awaited before each frame after the gate of the frame sink and the dither.
	readonly beforeFrame?: CameraFrameGate
	// Token the capture was started with, which names each of its dithers.
	readonly token: string
	// Dithers of the capture, when its request asks for them.
	readonly dither?: CaptureDitherPlan
	// Camera taking the frames.
	readonly camera: Camera
	// Latest frames of the session, by generation; older ones are forgotten (see FRAME_HISTORY).
	readonly frames: Map<number, FrameRecord>
	// Generation of the exposure currently open.
	generation: number
	// Reservation the capture was admitted under; such a capture already belongs to a tool and is never paused for another.
	readonly invocation?: ToolInvocation
	// Generation whose boundary dither already settled, so a gate run again for the same frame after a pause never dithers
	// twice.
	ditheredGeneration?: number
	// Pause a tool asked for, while it is pending or effective.
	suspension?: Suspension
}

// Pause of a capture, from its request to its resumption.
interface Suspension {
	// Tool that asked for it.
	readonly requester: CaptureSuspensionRequester
	// Answer to the request, shared by a repeated request of the same tool.
	readonly admission: Promise<CaptureSuspensionAdmission>
	// Paused toolkit capture, once the pause took effect.
	paused?: CameraCaptureSuspension
	// What the dither reservation lent to the tool, while it is lent.
	loan?: CaptureDitherLoan
	// Whether the camera is lent to the tool, so frames the capturer publishes are the tool's, not this capture's.
	lent: boolean
}

// Preview state of one camera: the frame shown, and decoding in progress.
interface CameraPreview {
	// Latest previewed frame.
	frame?: CaptureFrame
	// Whether a frame is being decoded.
	decoding: boolean
	// Frame received while decoding, decoded next; a newer one replaces it.
	next?: PendingFrame & { readonly session: ActiveCapture }
}

// Characters no file name may contain on some supported platform, besides the control characters.
const FORBIDDEN_FILE_NAME_CHARACTERS: ReadonlySet<string> = new Set(['\\', '/', '<', '>', ':', '"', '|', '?', '*'])

// Replaces the characters a file name cannot contain on any platform (separators, control characters, and
// the ones Windows forbids) with `_`, and drops trailing dots and spaces, which Windows strips.
export function sanitizeFileName(name: string) {
	let sanitized = ''
	for (const character of name) sanitized += character.charCodeAt(0) < 32 || FORBIDDEN_FILE_NAME_CHARACTERS.has(character) ? '_' : character
	return sanitized.replace(/[. ]+$/, '')
}

// Fields a filename template is filled with.
export interface FrameNameFields {
	// Camera name.
	readonly camera: string
	// Frame type, such as LIGHT.
	readonly type: string
	// Instant the exposure is commanded, Unix milliseconds (UTC).
	readonly time: number
	// Frame number within the session, from 1.
	readonly generation: number
	// Offset of the local time zone at time, in minutes east of UTC.
	readonly timezoneOffset: number
}

// Fills a filename template with a frame's fields and sanitizes the result (see CaptureOutput for the
// placeholders); an unknown placeholder is kept as written. Returns `frame` when nothing usable is left.
export function frameName(template: string, { camera, type, time, generation, timezoneOffset }: FrameNameFields) {
	const values: Readonly<Record<string, string>> = {
		camera,
		type,
		date: formatTemporal(time, 'YYYY-MM-DD', timezoneOffset),
		time: formatTemporal(time, 'HH-mm-ss-SSS', timezoneOffset),
		seq: String(generation).padStart(4, '0'),
	}

	return sanitizeFileName(template.replaceAll(/\{(\w+)\}/g, (placeholder, key: string) => values[key] ?? placeholder)) || 'frame'
}

// Returns the names of the devices a request snoops on the connection of its camera, as the capture request of the
// toolkit names them; an id the connection does not have resolves to no device.
export function snoopedDevices(devices: DeviceRegistry, camera: Camera, snoop: CaptureSnoop | undefined): Pick<CameraCaptureStart, 'mount' | 'focuser' | 'wheel' | 'rotator'> {
	const client = camera[CLIENT]

	return {
		mount: snoop?.mount && devices.get(client, snoop.mount, 'mount')?.name,
		focuser: snoop?.focuser && devices.get(client, snoop.focuser, 'focuser')?.name,
		wheel: snoop?.wheel && devices.get(client, snoop.wheel, 'wheel')?.name,
		rotator: snoop?.rotator && devices.get(client, snoop.rotator, 'rotator')?.name,
	}
}

// Returns a capture listener that follows the progress of the frame being exposed for an operation that takes its own
// frames: report receives undefined when a new exposure starts, then the driver's countdown (times in microseconds,
// progress in percent) while it exposes and once it finished. A report with a path is the frame itself, which carries
// no progress, so the caller clears the progress once the frame was read.
export function exposureProgressListener(report: (exposure: CameraCaptureTime | undefined) => void): CameraCaptureListener {
	return (event, path) => {
		if (path !== undefined) return
		if (event.state === 'exposureStarted') report(undefined)
		else if (event.state === 'exposing' || event.state === 'exposureFinished') report({ ...event.frameProgress })
	}
}

// Captures remembered by operation id after they ended, so a repeated token and the caller that admitted one still find
// it once a newer session of the camera replaced it; the oldest are forgotten, as command tokens are.
const MAX_RECENT_CAPTURES = 256

// Returns a session with fields replaced.
function changed(session: CaptureSession, patch: Partial<CaptureSession>): CaptureSession {
	return { ...session, ...patch }
}

// Captures of the cameras of every open connection.
export class CameraCaptures implements Disposable {
	// Toolkit capturer shared by every camera; it routes the callbacks of each camera to its own capture.
	readonly #capturer: CameraCapturer
	// Running capture of each camera, by camera resource key.
	readonly #active = new Map<string, ActiveCapture>()
	// Recent captures, running or ended, by operation id, oldest first (see MAX_RECENT_CAPTURES).
	readonly #recent = new Map<string, ActiveCapture>()
	// Latest session of each camera, running or ended, by camera resource key.
	readonly #sessions = new Map<string, CaptureSession>()
	// Preview state of each camera, by camera resource key.
	readonly #previews = new Map<string, CameraPreview>()
	// Capture and generation of each frame path being saved, so the write can be attributed to its frame.
	readonly #writes = new Map<string, { readonly capture: ActiveCapture; readonly generation: number }>()
	// Consumer of every LIGHT frame, when one listens.
	#sink?: CaptureFrameSink

	// Creates the service over the device registry. client resolves an open connection id to its client,
	// operations holds and publishes every capture, images receives the frames, frames records them and closes their
	// documents, and listener receives every capture event synchronously. capturesDir replaces DEFAULT_CAPTURES_DIR, and
	// dithering runs the dithers requests ask for; without it, a request that dithers is refused.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: (connectionId: string) => Client | undefined,
		readonly operations: OperationRegistry,
		readonly images: ImageStore,
		readonly frames: CaptureFrameRegistry,
		readonly listener: CaptureListener,
		readonly capturesDir: string = DEFAULT_CAPTURES_DIR,
		readonly dithering?: CaptureDithering,
	) {
		this.#capturer = new CameraCapturer(devices.cameras, operations.arbiter, {
			capturesDir,
			// The mount, focuser, filter wheel and rotator a request names are snooped into the frame headers.
			devices: { mount: devices.mounts, focuser: devices.focusers, wheel: devices.wheels, rotator: devices.rotators },
			frameGraceTime: FRAME_TRANSFER_TIMEOUT,
			quiesceTimeout: FRAME_TRANSFER_TIMEOUT,
			publish: (frame, _, camera) => this.#published(frame, camera),
			write: (path, data) => this.#write(path, data),
		})
	}

	// Toolkit capturer of every camera, for composite features such as the Auto Focus that take their own frames
	// inside their operation; frames it takes for them never enter the capture sessions or previews of this service.
	get capturer(): CameraCapturer {
		return this.#capturer
	}

	// Feeds every LIGHT frame of the capture sessions to sink, which replaces any previous one, and returns the
	// function that detaches it. A capture already running delivers its next frames.
	listenFrames(sink: CaptureFrameSink) {
		this.#sink = sink

		return () => {
			if (this.#sink === sink) this.#sink = undefined
		}
	}

	// Calls the frame sink, if any, keeping its failures out of the capture.
	#notify(call: (sink: CaptureFrameSink) => void) {
		const sink = this.#sink
		if (!sink) return

		try {
			call(sink)
		} catch (error) {
			console.error('the capture frame sink failed:', error)
		}
	}

	// Awaits the gate of the frame sink, then the dither of the boundary, when the capture dithers before this frame, then
	// the gate of the caller that admitted the capture, before a frame of a capture is prepared. The sink never fails the
	// capture: a failing sink gate lets the frame go. A failed dither ends the capture with its failure, without exposing.
	// The caller's gate answers for the frame (see CaptureAdmissionOptions.beforeFrame).
	async #gate(capture: ActiveCapture, frame: CameraFramePreparation, signal: AbortSignal) {
		const sink = this.#sink

		if (sink) {
			try {
				await sink.gate(capture.session.connectionId, capture.session.deviceId, signal)
			} catch (error) {
				if (!signal.aborted) console.error('the capture frame gate failed:', error)
			}
		}

		// A pause that came after this dither runs the gate again for the same frame, which must not dither twice.
		if (capture.dither && !signal.aborted && capture.ditheredGeneration !== frame.generation && ditherBoundary(frame.generation, capture.dither.everyFrames)) {
			const failed = await this.#dither(capture, capture.dither, frame.generation, signal)
			if (failed) return failed
			if (!signal.aborted) capture.ditheredGeneration = frame.generation
		}

		return capture.beforeFrame && !signal.aborted ? await capture.beforeFrame(frame, signal) : undefined
	}

	// Dithers a capture before the frame opening generation, publishing the dither phase and its outcome. Resolves the
	// failure that ends the capture, or undefined once the dither settled or the capture was interrupted.
	async #dither(capture: ActiveCapture, plan: CaptureDitherPlan, generation: number, signal: AbortSignal): Promise<FailedOperationResult | undefined> {
		const progress = () => capture.session.dither ?? { completed: 0, settling: false }
		this.#update(capture, { phase: 'dithering', exposure: undefined, delay: undefined, dither: { ...progress(), settling: false } })

		const result = await plan.dither(`${capture.token}:dither:${generation}`, signal, (phase) => {
			if (phase === 'settling' && !signal.aborted) this.#update(capture, { dither: { ...progress(), settling: true } })
		})

		if (signal.aborted) return undefined
		if (!result.ok) {
			this.#update(capture, { dither: { ...progress(), settling: false, error: result.error ?? result.reason } })
			return result
		}

		this.#update(capture, { dither: { completed: progress().completed + 1, settling: false } })
		return undefined
	}

	// Returns the latest session and previewed frame of every camera.
	snapshot(): CaptureSnapshot {
		const frames: CaptureFrame[] = []
		for (const preview of this.#previews.values()) if (preview.frame) frames.push(preview.frame)
		return { sessions: Array.from(this.#sessions.values()), frames }
	}

	// Responds with the capabilities of a camera, or 404 when the connection is not open or has no such camera.
	capabilities(connectionId: string, deviceId: string): Response {
		const client = this.client(connectionId)
		const capabilities = client && this.devices.cameraCapabilities(client, deviceId)
		return capabilities ? Response.json(capabilities) : errorResponse('Camera not found', 404, 'notFound')
	}

	// Starts a capture. Responds 202 with CaptureStartResponse once it is accepted (a repeated token answers the session
	// it started); its progress and outcome arrive as capture:updated events. Responds 404 for an unknown camera, 409
	// when it is disconnected or held by another operation, such as a capture started by another tab.
	start(connectionId: string, deviceId: string, request: CaptureStartRequest): Response {
		const admitted = this.admit(connectionId, deviceId, request)
		return admitted.ok ? Response.json({ sessionId: admitted.sessionId, operationId: admitted.operationId } satisfies CaptureStartResponse, { status: 202 }) : refusalResponse(admitted)
	}

	// Admits a capture, under the reservation of options.invocation when given, and returns its identity and end, or why
	// it was refused, as start answers it. A repeated token answers the capture it started, running or ended, while it is
	// remembered.
	admit(connectionId: string, deviceId: string, { token, ...request }: CaptureStartRequest, options: CaptureAdmissionOptions = {}): CaptureAdmission {
		const known = this.operations.repeated(token)

		if (known) {
			const admitted = this.#recent.get(known.record.operationId)?.admitted
			return admitted ? { ...admitted, repeated: true } : refusal('The capture of this request is no longer known', 404, 'notFound')
		}

		const client = this.client(connectionId)
		const camera = client && this.devices.camera(client, deviceId)
		if (!camera) return refusal('Camera not found', 404, 'notFound')
		if (!camera.connected) return refusal('The camera is disconnected', 409, 'disconnected')

		const key = resourceKey(camera)
		if (this.#active.has(key) || !this.operations.admits(camera, options.invocation)) return refusal('The camera is busy', 409, 'busy')

		// Only the fixed and loop LIGHT captures dither; nothing after the preparation refuses the capture, so what it took
		// is always given back by the end of the capture.
		let dither: CaptureDitherPlan | undefined

		if (request.dither && request.frameType === 'LIGHT' && request.exposureMode !== 'single') {
			if (!this.dithering) return refusal('Dithering is not available', 422, 'unsupported')
			const prepared = this.dithering.prepare(request.dither, options.invocation)
			if (!prepared.ok) return prepared
			dither = prepared
		}

		const saving = request.output.mode === 'preview-save'
		const start: CameraCaptureStart = {
			...structuredClone(DEFAULT_CAMERA_CAPTURE_START),
			exposureMode: request.exposureMode,
			count: request.count,
			delay: request.delay,
			exposureTime: request.exposureTime,
			exposureTimeUnit: 'second',
			frameType: request.frameType,
			gain: request.gain,
			offset: request.offset,
			binX: request.binX,
			binY: request.binY,
			subframe: request.subframe,
			x: request.x,
			y: request.y,
			width: request.width,
			height: request.height,
			frameFormat: request.frameFormat,
			autoSave: saving,
			transferFormat: request.output.format,
			...snoopedDevices(this.devices, camera, request.snoop),
		}

		const capture: ActiveCapture = {
			session: {
				sessionId: '',
				operationId: '',
				connectionId,
				deviceId,
				cameraName: camera.name,
				request,
				phase: 'starting',
				stopping: false,
				captured: 0,
				saved: 0,
				count: request.exposureMode === 'loop' ? undefined : request.exposureMode === 'single' ? 1 : request.count,
				startedAt: Date.now(),
				...(dither && { dither: { completed: 0, settling: false } }),
			},
			camera,
			frames: new Map(),
			generation: 0,
			ended: Promise.withResolvers(),
			beforeFrame: options.beforeFrame,
			token,
			dither,
			invocation: options.invocation,
		}

		this.#active.set(key, capture)

		const handle = this.#capturer.start(this.operations.scope(options.invocation), camera, start, {
			listener: (event, path) => this.#reported(capture, event, path),
			framePath: (frame) => this.#framePath(capture, frame),
			beforeFrame: (frame, signal) => this.#gate(capture, frame, signal),
			suspendable: true,
		})

		const { operationId } = this.operations.admit('camera.capture', [{ connectionId, deviceId }], token, () => handle.result).record
		capture.handle = handle
		capture.admitted = { ok: true, sessionId: handle.id, operationId, repeated: false, started: handle.started, ended: capture.ended.promise }
		this.#recent.set(operationId, capture)
		if (this.#recent.size > MAX_RECENT_CAPTURES) this.#recent.delete(this.#recent.keys().next().value!)
		this.#update(capture, { sessionId: handle.id, operationId })

		// A capture that dithers stays the running capture of its camera until its dithers gave back what they held, so its
		// end, and a new capture of the camera, come only once nothing it commanded still moves.
		void handle.result.then(async (result) => {
			for (const [path, write] of this.#writes) if (write.capture === capture) this.#writes.delete(path)
			this.#notify((sink) => sink.captureEnded(handle.id, connectionId, deviceId))
			if (capture.dither) await capture.dither.finish()
			if (this.#active.get(key) === capture) this.#active.delete(key)

			// A dither interrupted by a stop or an abort no longer settles once the capture ended, and a pause ends with it.
			const ended = { endedAt: Date.now(), exposure: undefined, delay: undefined, suspension: undefined, ...(capture.session.dither && { dither: { ...capture.session.dither, settling: false } }) }
			if (result.ok) this.#update(capture, { phase: capture.session.stopping ? 'stopped' : 'completed', ...ended })
			else this.#update(capture, { phase: result.reason === 'aborted' ? 'aborted' : 'failed', reason: result.reason, error: result.error, ...ended })
			capture.ended.resolve(capture.session)
		})

		return capture.admitted
	}

	// Stops the capture of a camera after the exposure in flight, which is still saved, when sessionId is its running
	// session. Responds 204 once requested (the end arrives as a capture:updated event), and 404 when the camera
	// captures nothing or runs another session, which a late stop must not reach.
	stop(connectionId: string, deviceId: string, { sessionId }: CaptureControlRequest): Response {
		if (this.#running(connectionId, deviceId)?.session.sessionId !== sessionId) return errorResponse('No capture with this id is running on this camera', 404, 'notFound')
		this.stopSession(sessionId)
		return new Response(null, { status: 204 })
	}

	// Aborts the capture of a camera when sessionId is its running session: the exposure in flight is aborted on the
	// driver and its frame lost. Resolves once the camera is idle and released. Responds 204, 404 when the camera
	// captures nothing or runs another session, and 409 when its driver cannot abort an exposure.
	async abort(connectionId: string, deviceId: string, { sessionId }: CaptureControlRequest): Promise<Response> {
		if (this.#running(connectionId, deviceId)?.session.sessionId !== sessionId) return errorResponse('No capture with this id is running on this camera', 404, 'notFound')
		const aborted = await this.abortSession(sessionId)
		return aborted === 'unsupported' ? errorResponse('The camera cannot abort an exposure', 409, 'unsupported') : new Response(null, { status: 204 })
	}

	// Stops a running capture session after the exposure in flight, which is still saved. Returns whether the session
	// was running; an ended or unknown one is left as it is.
	stopSession(sessionId: string): boolean {
		const capture = this.#session(sessionId)
		if (!capture?.handle) return false

		capture.handle.stop()
		if (!capture.session.stopping) this.#update(capture, { stopping: true })
		return true
	}

	// Aborts a running capture session, resolving once the camera is idle and released: aborted, notRunning for an
	// ended or unknown session, or unsupported when the driver cannot abort an exposure.
	async abortSession(sessionId: string): Promise<'aborted' | 'notRunning' | 'unsupported'> {
		const capture = this.#session(sessionId)
		if (!capture?.handle) return 'notRunning'
		// A paused capture has no exposure in flight, so ending it commands nothing the driver must support.
		if (!capture.camera.canAbort && capture.suspension?.paused === undefined) return 'unsupported'

		await capture.handle.cancel()
		return 'aborted'
	}

	// Resumes a capture the tool that paused it released (see CaptureSuspensionHandle.release), when sessionId is the
	// running session of the camera. Responds 204, 404 when the camera captures nothing or runs another session, and 409
	// while the capture is not paused, a tool still holds it, or its camera cannot be taken back.
	resume(connectionId: string, deviceId: string, { sessionId }: CaptureControlRequest): Response {
		const capture = this.#running(connectionId, deviceId)
		if (capture?.session.sessionId !== sessionId) return errorResponse('No capture with this id is running on this camera', 404, 'notFound')

		const suspension = capture.suspension
		if (suspension?.paused === undefined || capture.session.suspension?.state !== 'released') return errorResponse(suspension ? `${suspension.requester.holder} still holds the capture` : 'The capture is not paused', 409, 'busy')

		const resumed = this.#resume(capture, suspension)
		return resumed === 'resumed' ? new Response(null, { status: 204 }) : errorResponse(resumed === 'ended' ? 'The capture has ended' : 'The camera cannot be taken back now', 409, 'busy')
	}

	// Pauses the running capture session sessionId at its next frame boundary for a tool of the process, and lends its
	// camera, and the reservation of its mount dithers, to the tool's reservation (see CaptureSuspensionHandle). The camera
	// joins the reservation at once, so nothing else can take it while the frame in flight finishes. The same requester
	// asking again gets the same answer. Refused: notFound for an unknown session, busy while another tool asked or the
	// reservation cannot take the camera, unsupported for a capture admitted under a reservation, and deviceError when the
	// camera did not become idle at the boundary. An abort of signal before the boundary withdraws the request; the capture
	// goes on and the camera stays in the tool's reservation until it is released.
	suspendForMotion(sessionId: string, requester: CaptureSuspensionRequester, signal: AbortSignal): Promise<CaptureSuspensionAdmission> {
		const capture = this.#session(sessionId)

		if (!capture?.handle) {
			const session = this.#sessions.values().find((session) => session.sessionId === sessionId)
			return Promise.resolve(session?.endedAt !== undefined ? { status: 'captureEnded', session } : refusal('No capture with this id is running', 404, 'notFound'))
		}

		if (capture.invocation) return Promise.resolve(refusal('The capture already runs for a tool', 409, 'unsupported'))

		if (capture.suspension) {
			if (capture.suspension.requester.id === requester.id) return capture.suspension.admission
			return Promise.resolve(refusal(`${capture.suspension.requester.holder} already paused the capture`, 409, 'busy'))
		}

		const { handle } = capture
		const admission = Promise.withResolvers<CaptureSuspensionAdmission>()
		const suspension: Suspension = { requester, admission: admission.promise, lent: false }
		capture.suspension = suspension
		this.#update(capture, { suspension: { holder: requester.holder, state: 'requested' } })

		void handle.suspend(requester.reservation, signal).then(async (result) => {
			if (!result.ok) {
				if (capture.suspension === suspension) capture.suspension = undefined
				if (capture.session.suspension !== undefined && capture.session.endedAt === undefined) this.#update(capture, { suspension: undefined })

				if (result.reason === 'ended') admission.resolve({ status: 'captureEnded', session: await capture.ended.promise })
				else if (result.reason === 'withdrawn') admission.resolve({ status: 'withdrawn' })
				else if (result.reason === 'unexpectedState') admission.resolve(refusal(result.error ?? 'The camera did not become idle', 502, 'deviceError'))
				else admission.resolve(refusal(result.error ?? 'The camera cannot be lent', 409, result.reason === 'unsupported' ? 'unsupported' : 'busy'))
				return
			}

			suspension.paused = result.suspension
			suspension.lent = true

			// No dither runs at the boundary, so what the capture reserved for its dithers is free to lend.
			const lending = capture.dither?.lend(requester.reservation) ?? { ok: true }

			if (!lending.ok) {
				suspension.lent = false
				result.suspension.resume()
				capture.suspension = undefined
				this.#update(capture, { suspension: undefined })
				admission.resolve(refusal(lending.error, 409, 'busy'))
				return
			}

			suspension.loan = lending.loan
			this.#update(capture, { phase: 'paused', exposure: undefined, delay: undefined, suspension: { holder: requester.holder, state: 'suspended' } })
			admission.resolve({ status: 'suspended', handle: this.#suspensionHandle(capture, suspension, result.suspension) })
		})

		return admission.promise
	}

	// Builds the handle of a paused capture, which acts only while that pause is the capture's.
	#suspensionHandle(capture: ActiveCapture, suspension: Suspension, paused: CameraCaptureSuspension): CaptureSuspensionHandle {
		const current = () => capture.suspension === suspension && capture.session.endedAt === undefined

		return Object.freeze({
			sessionId: capture.session.sessionId,
			generation: paused.generation,
			ended: capture.ended.promise,
			reclaim: () => (current() ? this.#reclaim(suspension) : 'ended'),
			resume: () => (current() ? this.#resume(capture, suspension) : 'ended'),
			release: () => {
				if (!current()) return 'ended'
				const reclaimed = this.#reclaim(suspension)
				if (reclaimed !== 'reclaimed') return reclaimed
				this.#update(capture, { suspension: { holder: suspension.requester.holder, state: 'released' } })
				return 'released'
			},
		})
	}

	// Takes the camera and the dither reservation of a paused capture back from the tool, still paused.
	#reclaim(suspension: Suspension): 'reclaimed' | 'busy' {
		const paused = suspension.paused
		if (paused === undefined) return 'busy'

		if (suspension.lent) {
			if (!paused.reclaim().ok) return 'busy'
			suspension.lent = false
		}

		if (suspension.loan) {
			// A capture that finished already gave its dither reservation up; what was lent then goes with the tool's.
			if (!suspension.loan.return()) return 'busy'
			suspension.loan = undefined
		}

		return 'reclaimed'
	}

	// Takes everything back and lets a paused capture go on with its next frame.
	#resume(capture: ActiveCapture, suspension: Suspension): 'resumed' | 'busy' | 'ended' {
		if (capture.session.endedAt !== undefined) return 'ended'
		const reclaimed = this.#reclaim(suspension)
		if (reclaimed !== 'reclaimed') return reclaimed
		if (!suspension.paused?.resume().ok) return 'busy'

		capture.suspension = undefined
		this.#update(capture, { phase: 'starting', suspension: undefined })
		return 'resumed'
	}

	// Returns the running capture of a camera, if any.
	#running(connectionId: string, deviceId: string): ActiveCapture | undefined {
		const client = this.client(connectionId)
		const camera = client && this.devices.camera(client, deviceId)
		return camera && this.#active.get(resourceKey(camera))
	}

	// Returns the running capture of a session, if any.
	#session(sessionId: string): ActiveCapture | undefined {
		for (const capture of this.#active.values()) if (capture.session.sessionId === sessionId) return capture
		return undefined
	}

	// Publishes a changed session.
	#update(capture: ActiveCapture, patch: Partial<CaptureSession>) {
		capture.session = changed(capture.session, patch)
		this.#sessions.set(resourceKey(capture.camera), capture.session)
		this.listener({ type: 'capture:updated', session: capture.session })
	}

	// Resolves the file of a saved frame from the request's directory and template.
	#framePath(capture: ActiveCapture, { generation, time, camera }: CameraFramePathRequest) {
		const { output, frameType } = capture.session.request
		const name = frameName(output.filenameTemplate ?? DEFAULT_FILENAME_TEMPLATE, { camera: camera.name, type: frameType, time, generation, timezoneOffset: TIMEZONE })
		const path = join(output.directory || this.capturesDir, `${name}.${output.format === 'XISF' ? 'xisf' : 'fit'}`)
		capture.frames.set(generation, { time, path, file: 'saving' })
		capture.frames.delete(generation - FRAME_HISTORY)
		this.#writes.set(path, { capture, generation })
		return path
	}

	// Follows the presentation events of a capture. A path marks a frame that finished processing.
	#reported(capture: ActiveCapture, event: CameraCaptureEvent, path?: string) {
		if (event.generation > capture.generation) {
			capture.generation = event.generation
			// A frame that is not saved resolves no path, so its record starts when its exposure is commanded.
			if (!capture.frames.has(event.generation)) capture.frames.set(event.generation, { time: Date.now() })
			capture.frames.delete(event.generation - FRAME_HISTORY)
		}

		if (path !== undefined) {
			const more = event.remainingCount > 0 && !capture.session.stopping
			this.#update(capture, { phase: more && capture.session.request.delay > 0 ? 'waiting' : capture.session.phase, exposure: undefined, delay: undefined })
			return
		}

		switch (event.state) {
			case 'exposureStarted':
				this.#update(capture, { phase: 'exposing', exposure: undefined, delay: undefined })
				break
			case 'exposing':
				this.#update(capture, { phase: 'exposing', exposure: event.frameProgress })
				break
			case 'exposureFinished':
				this.#update(capture, { phase: 'reading', exposure: event.frameProgress })
				break
			case 'waiting':
				this.#update(capture, { phase: 'waiting', delay: event.frameProgress })
				break
		}
	}

	// Counts a decoded frame and queues it for preview. The bytes are the toolkit's buffer, copied here
	// because it is not ours to keep.
	#published(frame: Buffer, camera: Camera) {
		const key = resourceKey(camera)
		const capture = this.#active.get(key)
		// The frames of a tool the camera is lent to are the tool's own, never this capture's.
		if (!capture || capture.suspension?.lent) return

		const generation = capture.generation
		const resolved = capture.frames.get(generation)
		this.#update(capture, { captured: capture.session.captured + 1, phase: capture.session.request.output.mode === 'preview-save' ? 'saving' : capture.session.phase })

		// Every LIGHT frame reaches the sink, before the preview below drops any of them.
		const { sessionId, connectionId, deviceId, cameraName, request } = capture.session

		if (request.frameType === 'LIGHT') {
			this.#notify((sink) => {
				if (!sink.wants(connectionId, deviceId)) return
				const captured: CapturedFrame = { frameId: `${sessionId}:${generation}`, sessionId, generation, connectionId, deviceId, cameraName, time: resolved?.time ?? Date.now(), request }
				sink.captured(captured, request.output.mode === 'preview-only' ? new Uint8Array(frame) : undefined)
			})
		}

		let preview = this.#previews.get(key)

		if (!preview) {
			preview = { decoding: false }
			this.#previews.set(key, preview)
		}

		// Only the newest frame waits while another one is decoded.
		preview.next = { bytes: new Uint8Array(frame), generation, time: resolved?.time ?? Date.now(), path: resolved?.path, session: capture }
		if (!preview.decoding) void this.#preview(key, preview)
	}

	// Decodes the waiting frame of a camera into the image store, then the one that arrived meanwhile, if any, and
	// replaces the camera's previewed frame with each, recording it in the frame registry, which closes the previous
	// document unless it is held.
	async #preview(key: string, preview: CameraPreview) {
		preview.decoding = true

		for (let next = preview.next; next; next = preview.next) {
			preview.next = undefined
			const { bytes, generation, time, path, session: capture } = next
			const { sessionId, connectionId, deviceId, cameraName } = capture.session

			try {
				const info = await this.images.openCapture(bytes, path === undefined ? `${cameraName} #${generation}` : basename(path), { connectionId, deviceId, frameId: `${sessionId}:${generation}`, time, path })
				const bitpix = numericKeyword<number, undefined>(info.header, 'BITPIX', undefined)
				const { width, height, channels, cfa, acquisition } = info
				const file = path === undefined ? undefined : (capture.frames.get(generation)?.file ?? 'saving')
				preview.frame = { imageId: info.id, sessionId, connectionId, deviceId, generation, time, path, file, frameType: capture.session.request.frameType, width, height, channels, cfa, bitpix, acquisition }
				this.frames.previewed(info, preview.frame, cameraName)
				this.listener({ type: 'capture:frame', frame: preview.frame })
				if (capture.session.previewError !== undefined) this.#update(capture, { previewError: undefined })
			} catch (error) {
				this.#update(capture, { previewError: `Unable to decode the frame: ${Error.isError(error) ? error.message : String(error)}` })
			}
		}

		preview.decoding = false
	}

	// Writes a saved frame exclusively, and counts it once the write completed. A failed write marks the
	// frame's file as failed and is rethrown, so the capture fails.
	async #write(path: string, data: Buffer) {
		try {
			await writeFrameExclusively(path, data)
		} catch (error) {
			this.#written(path, 'failed')
			throw error
		}

		const capture = this.#written(path, 'saved')
		if (capture) this.#update(capture, { saved: capture.session.saved + 1 })
	}

	// Records the outcome of the write of a frame's file, and republishes the previewed frame when it is
	// that frame. Returns the capture the file belongs to, or undefined when the path is unknown.
	#written(path: string, file: CaptureFileState) {
		const write = this.#writes.get(path)
		if (!write) return undefined
		this.#writes.delete(path)

		const { capture, generation } = write
		const record = capture.frames.get(generation)
		if (record) record.file = file

		const { sessionId, connectionId, deviceId, cameraName, request } = capture.session
		this.frames.written({ sessionId, generation, connectionId, deviceId, cameraName, time: record?.time ?? Date.now(), frameType: request.frameType, path }, file)

		if (request.frameType === 'LIGHT') {
			const frameId = `${sessionId}:${generation}`
			this.#notify((sink) => (file === 'saved' ? sink.saved(frameId, path) : sink.saveFailed(frameId)))
		}

		const preview = this.#previews.get(resourceKey(capture.camera))

		if (preview?.frame?.path === path) {
			preview.frame = { ...preview.frame, file }
			this.listener({ type: 'capture:frame', frame: preview.frame })
		}

		return capture
	}

	// Stops routing camera callbacks; running captures end by their own cleanup or the registry's disposal.
	[Symbol.dispose]() {
		this.#capturer.dispose()
	}
}

// Routes of the camera captures.
export function createCaptureRoutes(captures: CameraCaptures) {
	return {
		'/api/captures': {
			// The latest capture session and previewed frame of every camera, started by any tab.
			GET: () => Response.json(captures.snapshot()),
		},
		'/api/connections/:id/cameras/:deviceId': {
			// Capture capabilities and thermal state of a camera; 404 when the connection is not open or has no such camera.
			GET: (req) => captures.capabilities(req.params.id, req.params.deviceId),
		},
		'/api/connections/:id/cameras/:deviceId/capture': {
			// Starts a capture; its progress and outcome arrive as capture:updated and operation:updated events.
			POST: async (req) => captures.start(req.params.id, req.params.deviceId, (await req.json()) as CaptureStartRequest),
		},
		'/api/connections/:id/cameras/:deviceId/capture/stop': {
			// Stops the running capture session of a camera after the exposure in flight.
			POST: async (req) => captures.stop(req.params.id, req.params.deviceId, (await req.json()) as CaptureControlRequest),
		},
		'/api/connections/:id/cameras/:deviceId/capture/abort': {
			// Aborts the exposure in flight and ends the running capture session of a camera.
			POST: async (req) => captures.abort(req.params.id, req.params.deviceId, (await req.json()) as CaptureControlRequest),
		},
		'/api/connections/:id/cameras/:deviceId/capture/resume': {
			// Resumes a capture session a tool paused and released, from its next frame.
			POST: async (req) => captures.resume(req.params.id, req.params.deviceId, (await req.json()) as CaptureControlRequest),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
