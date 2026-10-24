import { readFileSync } from 'fs'
import { stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, join } from 'path'
import type { CaptureFileState, CaptureFrame, CaptureSettings } from './captures'
import type { ConnectionRegistryEvent } from './connection'
import { errorResponse } from './http'
import type { ImageAcquisition, ImageInfo, ImageStore } from './images'
import { errorCode, isRecord, writeAtomically } from './util'

// Capture frame registry: the index of the frames acquired by Camera Capture and Auto Focus, by physical camera
// (connection id + device id), so the Images workspace can show the latest frame of any camera and its recent saved
// frames. It never holds pixels: a frame is available while its capture document is open in the image store, or
// while its saved file exists, which is opened as a new document when asked. A frame is identified by its frameId
// (session id and generation), which always names the same acquisition, whatever document currently holds its
// pixels, and its origin names the operation that took it. Both producers share one latest frame per camera,
// ordered by the order the registry received them, never by their session numbering.
//
// Each camera keeps two collections with their own retention: its latest frame, the newest one the preview
// decoded (previewed only, being saved, or saved), and its saved frames, the newest FRAMES_PER_SOURCE frames whose
// file was written, which is the only history. A frame the preview decoded is never added to the saved frames
// unless its file is written, so any number of previewed-only frames never evicts a saved one; the latest frame
// counts among the saved frames only when it was saved itself. Auto Focus, TPPA, and DARV frames are never saved: their files are
// auxiliary and deleted after each measurement, so they only ever become the latest frame. A previous latest frame that was not saved is kept
// in memory among the transient frames of its camera (at most FRAMES_PER_SOURCE), only so its state can still be
// asked for, and is never listed.
//
// The registry owns the closing of capture documents: the latest previewed frame of each camera stays open,
// and an older one stays open only while a lease holds it. A lease belongs to a client (one browser tab, by
// the id it opens the event socket with); when the last socket of a client closes, its leases are released
// after LEASE_GRACE, so a phone whose screen locks finds its frames again when it comes back, and a tab that
// reopens its socket reconciles the leases it still uses. At most MAX_LEASED_FRAMES documents are kept open
// by leases besides the latest frames.
//
// The metadata of the saved frames of at most MAX_SOURCES cameras is persisted in a versioned JSON file, written
// at most every SAVE_DELAY after a change, so the frames of the last SAVE_DELAY may be lost in a crash. After a
// restart no frame is in memory and no camera has a latest frame: a saved frame is available again when its file
// exists. A version 1 file, which mixed previewed-only and saved frames, is read keeping its saved frames only. No
// directory is ever scanned.

// File the registry is persisted in when none is given.
export const DEFAULT_CAPTURE_FRAMES_FILE = join(homedir(), 'Nebulosa', 'capture-frames.json')

// Version of the registry file format written by this version.
const CAPTURE_FRAMES_VERSION = 2

// Saved frames remembered per camera, newest first; older ones are forgotten. Also the number of transient frames
// kept in memory per camera.
export const FRAMES_PER_SOURCE = 20

// Cameras remembered; the one updated least recently is forgotten first.
export const MAX_SOURCES = 32

// Documents kept open by leases besides the latest frame of each camera.
export const MAX_LEASED_FRAMES = 16

// Time the leases of a client survive after its last socket closed, in milliseconds.
export const LEASE_GRACE = 10 * 60 * 1000

// Delay between a change and the write of the registry file, in milliseconds.
const SAVE_DELAY = 2000

// Whether the pixels of a frame can be opened:
// - memory: its document is open in the image store.
// - file: its saved file exists and is opened as a new document.
// - saving: its file is being written and its document is closed; it can be opened once written.
// - unavailable: neither, for the reason given.
export type CaptureFrameAvailability = 'memory' | 'file' | 'saving' | 'unavailable'

// Operation that took a frame:
// - capture: Camera Capture, previewed only or saved.
// - autofocus: an Auto Focus session, sampled or verifying; never saved.
// - tppa: a TPPA session, a pose or a refinement frame; never saved.
// - darv: a DARV measurement, one frame per measurement; never saved.
export type CaptureFrameOrigin = 'capture' | 'autofocus' | 'tppa' | 'darv'

// Why a frame cannot be opened:
// - expired: it was only previewed and its document was closed.
// - fileMissing: its saved file was removed or moved.
// - saveFailed: the write of its file failed and its document was closed.
// - restarted: it was only previewed before the server restarted.
export type CaptureFrameUnavailableReason = 'expired' | 'fileMissing' | 'saveFailed' | 'restarted'

// Metadata of a frame, as persisted. Every datum is the one of the acquisition, never changed later.
interface StoredFrame {
	// Identity of the frame: the session id and the generation.
	readonly frameId: string
	// Order of the frame among every frame of the registry; increases with every new frame.
	readonly sequence: number
	// Id of the connection that provided the camera.
	readonly connectionId: string
	// Exact id of the camera.
	readonly deviceId: string
	// Driver-reported camera name.
	readonly cameraName: string
	// Id of the capture or Auto Focus session.
	readonly sessionId: string
	// Frame number within the session, from 1.
	readonly generation: number
	// Instant the frame's exposure was commanded, Unix milliseconds (UTC).
	readonly time: number
	// Frame type the capture requested.
	readonly frameType: CaptureSettings['frameType']
	// Width, in pixels; absent for a saved frame never decoded.
	width?: number
	// Height, in pixels; absent for a saved frame never decoded.
	height?: number
	// Number of channels; absent for a saved frame never decoded.
	channels?: number
	// FITS BITPIX; absent when not reported.
	bitpix?: number
	// CFA pattern of a mono CFA mosaic.
	cfa?: CaptureFrame['cfa']
	// Acquisition data read from the header; absent for a saved frame never decoded.
	acquisition?: ImageAcquisition
	// Absolute path of the saved file; absent when only previewed. Never sent to clients.
	readonly path?: string
	// State of the write of the file; absent when only previewed.
	file?: CaptureFileState
}

// Frame of the registry, with what only lives in memory.
interface FrameEntry extends StoredFrame {
	// Operation that took the frame; a frame read from the file is a capture, the only frames ever saved.
	readonly origin: CaptureFrameOrigin
	// Id of the open document holding the pixels; absent when none is open.
	imageId?: string
	// Description of that document.
	info?: ImageInfo
	// Revision of the latest change of the frame.
	revision: number
	// Whether the frame was read from the file, so it was never in memory since the server started.
	readonly restored: boolean
	// Whether the saved file was found missing by the latest check.
	missing?: boolean
}

// Frame as published to clients.
export interface CaptureFrameSummary {
	// Identity of the frame.
	readonly frameId: string
	// Operation that took the frame.
	readonly origin: CaptureFrameOrigin
	// Order of the frame among every frame; a larger one is newer.
	readonly sequence: number
	// Revision of the latest change of the frame; a smaller one is older news.
	readonly revision: number
	// Id of the connection that provided the camera.
	readonly connectionId: string
	// Exact id of the camera.
	readonly deviceId: string
	// Driver-reported camera name.
	readonly cameraName: string
	// Id of the capture or Auto Focus session.
	readonly sessionId: string
	// Frame number within the session, from 1.
	readonly generation: number
	// Instant the frame's exposure was commanded, Unix milliseconds (UTC).
	readonly time: number
	// Frame type the capture requested.
	readonly frameType: CaptureSettings['frameType']
	// Width, in pixels; absent for a saved frame never decoded.
	readonly width?: number
	// Height, in pixels; absent for a saved frame never decoded.
	readonly height?: number
	// Number of channels; absent for a saved frame never decoded.
	readonly channels?: number
	// FITS BITPIX; absent when not reported.
	readonly bitpix?: number
	// CFA pattern of a mono CFA mosaic.
	readonly cfa?: CaptureFrame['cfa']
	// Acquisition data read from the header; absent for a saved frame never decoded.
	readonly acquisition?: ImageAcquisition
	// Name of the saved file, without its directory; absent when only previewed.
	readonly fileName?: string
	// State of the write of the file; absent when only previewed.
	readonly file?: CaptureFileState
	// Id of the open document holding the pixels; absent when none is open.
	readonly imageId?: string
	// Whether the frame can be opened.
	readonly availability: CaptureFrameAvailability
	// Why it cannot; present only when unavailable.
	readonly reason?: CaptureFrameUnavailableReason
}

// Camera of the registry, as published to clients.
export interface CaptureSourceSummary {
	// Id of the connection that provides the camera.
	readonly connectionId: string
	// Exact id of the camera.
	readonly deviceId: string
	// Driver-reported camera name, as of its latest frame.
	readonly cameraName: string
	// Whether the camera is connected now.
	readonly connected: boolean
	// Latest frame the preview decoded since the server started, available or not; absent before the first one.
	readonly latestFrameId?: string
	// Newest frame that can be opened: the latest frame, or the newest saved frame whose file exists when the latest
	// cannot be opened or there is none.
	readonly latestAvailableFrameId?: string
	// Whether the camera has no latest frame since the server started, so latestAvailableFrameId, when present, is a
	// saved frame of an earlier run rather than a preview still in memory.
	readonly latestRestored: boolean
	// Saved frames remembered, at most FRAMES_PER_SOURCE.
	readonly count: number
	// Revision of the latest change of the camera or one of its frames; a smaller one is older news.
	readonly revision: number
}

// Snapshot of GET /api/capture-frames.
export interface CaptureFramesSnapshot {
	// Identity of this run of the server; a different one means the server restarted.
	readonly epoch: string
	// Saved frames remembered per camera.
	readonly limit: number
	// Cameras with frames, the most recently updated first.
	readonly sources: readonly CaptureSourceSummary[]
}

// Frames of a camera: its latest frame and a page of its saved frames, newest first.
export interface CaptureFramePage {
	// Latest frame the preview decoded since the server started; absent before the first one. It is also among the
	// saved frames when it was saved.
	readonly latest?: CaptureFrameSummary
	// Saved frames of the page, newest first.
	readonly frames: readonly CaptureFrameSummary[]
	// Opaque cursor of the next page; absent on the last one.
	readonly next?: string
}

// Body of POST /api/capture-frames/frames/:frameId/open.
export interface CaptureFrameOpenRequest {
	// Client the lease belongs to: the id the tab opened its event socket with.
	readonly client: string
}

// Response of an opened frame: the lease that keeps its document open, the document, and the frame.
export interface CaptureFrameOpened {
	// Id of the lease, released by DELETE /api/capture-frames/leases/:lease.
	readonly lease: string
	// Document holding the pixels of the frame.
	readonly info: ImageInfo
	// Frame opened.
	readonly frame: CaptureFrameSummary
}

// Body of PUT (or POST, for a beacon) /api/capture-frames/clients/:client/leases.
export interface CaptureLeaseReconcileRequest {
	// Leases the client still uses; its other leases are released.
	readonly leases: readonly string[]
}

// Response of a lease reconciliation.
export interface CaptureLeaseReconcileResponse {
	// Leases of the request that no longer exist, whose documents may be gone.
	readonly lost: readonly string[]
}

// Stable code of a refused frame open: notFound (unknown frame), expired, fileMissing, saveFailed (see
// CaptureFrameUnavailableReason; restarted is answered as expired), saving (the file is being written and the
// document is closed), limit (MAX_LEASED_FRAMES reached), unreadable (the saved file cannot be decoded).
export type CaptureFrameErrorCode = 'notFound' | 'expired' | 'fileMissing' | 'saveFailed' | 'saving' | 'limit' | 'unreadable'

// Outcome of a frame open.
export type CaptureFrameOpenOutcome = ({ readonly status: 'opened' } & CaptureFrameOpened) | { readonly status: 'refused'; readonly code: CaptureFrameErrorCode }

// Notification published when a frame is added or changes, and when a camera changes (connection, removal of
// its frames).
export type CaptureFrameEvent = { readonly type: 'captureFrame:updated'; readonly frame: CaptureFrameSummary; readonly source: CaptureSourceSummary } | { readonly type: 'captureSource:updated'; readonly source: CaptureSourceSummary }

// Receiver of registry events.
export type CaptureFrameListener = (event: CaptureFrameEvent) => void

// Whether a camera is connected now.
export type CameraConnectedResolver = (connectionId: string, deviceId: string) => boolean

// Options of the registry.
export interface CaptureFrameRegistryOptions {
	// File the registry is persisted in; DEFAULT_CAPTURE_FRAMES_FILE when absent.
	readonly file?: string
	// Time the leases of a client survive its last socket, in milliseconds; LEASE_GRACE when absent.
	readonly leaseGrace?: number
	// Whether a camera is connected; every camera is reported disconnected when absent.
	readonly connected?: CameraConnectedResolver
}

// Camera of the registry.
interface SourceEntry {
	// Id of the connection that provides the camera.
	readonly connectionId: string
	// Exact id of the camera.
	readonly deviceId: string
	// Camera name of the latest frame.
	cameraName: string
	// Latest frame the preview decoded since the server started; it is also among the saved frames once saved.
	latest?: FrameEntry
	// Frames whose file was written, oldest first, at most FRAMES_PER_SOURCE.
	readonly saved: FrameEntry[]
	// Former latest frames that were not saved (previewed only, being saved, or failed), oldest first, at most
	// FRAMES_PER_SOURCE; kept in memory only, never listed nor persisted.
	readonly transient: FrameEntry[]
	// Revision of the latest change.
	revision: number
}

// Lease keeping the document of a frame open.
interface Lease {
	// Frame opened.
	readonly frameId: string
	// Document held.
	readonly imageId: string
	// Client the lease belongs to.
	readonly client: string
}

// Registry content read from its file.
interface LoadedFrames {
	// Saved frames of each camera; a camera without any is left out.
	readonly sources: readonly { readonly connectionId: string; readonly deviceId: string; readonly cameraName: string; readonly saved: readonly StoredFrame[] }[]
	// Largest sequence read.
	readonly sequence: number
	// Whether the file was written by a newer version, so it must not be overwritten.
	readonly newer?: boolean
}

// Key of a camera.
export function sourceKey(connectionId: string, deviceId: string) {
	return `${connectionId}:${deviceId}`
}

// Identity of a frame of a capture or Auto Focus session.
export function captureFrameId(sessionId: string, generation: number) {
	return `${sessionId}:${generation}`
}

// Whether value is a finite number.
function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

// Reads a persisted frame, whose content is not trusted; undefined when its identity is unusable.
function parseFrame(value: unknown, connectionId: string, deviceId: string): StoredFrame | undefined {
	if (!isRecord(value)) return undefined
	const { frameId, sequence, cameraName, sessionId, generation, time, frameType, width, height, channels, bitpix, cfa, acquisition, path, file } = value
	if (typeof frameId !== 'string' || typeof sessionId !== 'string' || !Number.isInteger(sequence) || !Number.isInteger(generation) || !isFiniteNumber(time)) return undefined

	return {
		frameId,
		sequence: sequence as number,
		connectionId,
		deviceId,
		cameraName: typeof cameraName === 'string' ? cameraName : '',
		sessionId,
		generation: generation as number,
		time,
		frameType: (typeof frameType === 'string' ? frameType : 'LIGHT') as CaptureSettings['frameType'],
		width: isFiniteNumber(width) ? width : undefined,
		height: isFiniteNumber(height) ? height : undefined,
		channels: isFiniteNumber(channels) ? channels : undefined,
		bitpix: isFiniteNumber(bitpix) ? bitpix : undefined,
		cfa: typeof cfa === 'string' ? (cfa as CaptureFrame['cfa']) : undefined,
		acquisition: isRecord(acquisition) ? acquisition : undefined,
		path: typeof path === 'string' ? path : undefined,
		file: file === 'saving' || file === 'saved' || file === 'failed' ? file : undefined,
	}
}

// Parses the content of the registry file, keeping the saved frames of each camera, the newest FRAMES_PER_SOURCE in
// sequence order. Version 2 lists them as saved; version 1 listed every recent frame as frames, of which those
// saved, or still being saved when the file was written (checked before they are opened), are kept, and the
// previewed-only and failed ones dropped. Content that is not a registry document is read as empty; a document of
// a newer version is read as far as it is understood and marked as newer.
export function parseCaptureFrames(text: string): LoadedFrames {
	let data: unknown

	try {
		data = JSON.parse(text)
	} catch {
		return { sources: [], sequence: 0 }
	}

	if (!isRecord(data) || !Array.isArray(data.sources) || !Number.isInteger(data.version)) return { sources: [], sequence: 0 }

	let sequence = Number.isInteger(data.sequence) ? (data.sequence as number) : 0
	const sources: LoadedFrames['sources'][number][] = []

	for (const source of data.sources) {
		if (!isRecord(source) || typeof source.connectionId !== 'string' || typeof source.deviceId !== 'string') continue
		const { connectionId, deviceId } = source
		const list: unknown = Array.isArray(source.saved) ? source.saved : source.frames
		if (!Array.isArray(list)) continue
		const frames = list.map((frame) => parseFrame(frame, connectionId, deviceId)).filter((frame) => frame !== undefined)
		for (const frame of frames) sequence = Math.max(sequence, frame.sequence)
		const saved = frames
			.filter((frame) => frame.path !== undefined && (frame.file === 'saved' || frame.file === 'saving'))
			.sort((a, b) => a.sequence - b.sequence)
			.slice(-FRAMES_PER_SOURCE)
		for (const frame of saved) frame.file = 'saved'
		if (saved.length > 0) sources.push({ connectionId, deviceId, cameraName: typeof source.cameraName === 'string' ? source.cameraName : (saved.at(-1)?.cameraName ?? ''), saved })
	}

	return (data.version as number) > CAPTURE_FRAMES_VERSION ? { sources, sequence, newer: true } : { sources, sequence }
}

// Returns the persisted part of a frame.
function storedFrame({ frameId, sequence, connectionId, deviceId, cameraName, sessionId, generation, time, frameType, width, height, channels, bitpix, cfa, acquisition, path, file }: FrameEntry): StoredFrame {
	return { frameId, sequence, connectionId, deviceId, cameraName, sessionId, generation, time, frameType, width, height, channels, bitpix, cfa, acquisition, path, file }
}

// Removes an item from a list, if present.
function remove<T>(list: T[], item: T) {
	const index = list.indexOf(item)
	if (index >= 0) list.splice(index, 1)
}

// Appends an item to a list, oldest first, dropping the oldest beyond FRAMES_PER_SOURCE.
function pushLimited<T>(list: T[], item: T) {
	list.push(item)
	if (list.length > FRAMES_PER_SOURCE) list.splice(0, list.length - FRAMES_PER_SOURCE)
}

// Whether a file exists.
async function exists(path: string) {
	try {
		await stat(path)
		return true
	} catch {
		return false
	}
}

// Index of the frames of every camera and the leases on their documents.
export class CaptureFrameRegistry implements Disposable {
	// Identity of this run of the server.
	readonly epoch = crypto.randomUUID()
	// Cameras by key, read from the file on first use.
	#sources?: Map<string, SourceEntry>
	// Document of the latest previewed frame of each camera, by camera key; kept open without a lease.
	readonly #latest = new Map<string, string>()
	// Leases by id.
	readonly #leases = new Map<string, Lease>()
	// Number of leases of each document, by image id.
	readonly #holds = new Map<string, number>()
	// Open sockets of each client.
	readonly #sockets = new Map<string, number>()
	// Pending release of the leases of each client whose sockets all closed.
	readonly #graces = new Map<string, Timer>()
	// Files being opened for a frame, by frame id, so concurrent opens share one document.
	readonly #opening = new Map<string, Promise<ImageInfo>>()
	// Last sequence or revision handed out.
	#counter = 0
	// Whether the file was written by a newer version.
	#newer = false
	// Pending write of the file.
	#saveTimer?: Timer
	// Tail of the writes in progress, which run one at a time.
	#queue: Promise<unknown> = Promise.resolve()
	// Unregistration of the discard listener.
	readonly #unlisten: VoidFunction
	// File the registry is persisted in.
	readonly file: string
	// Time the leases of a client survive its last socket, in milliseconds.
	readonly leaseGrace: number
	// Whether a camera is connected.
	readonly #connected: CameraConnectedResolver

	// Creates the registry over the image store, publishing every change to listener synchronously. Reading the
	// file waits for the first use.
	constructor(
		readonly images: ImageStore,
		readonly listener: CaptureFrameListener,
		{ file = DEFAULT_CAPTURE_FRAMES_FILE, leaseGrace = LEASE_GRACE, connected = () => false }: CaptureFrameRegistryOptions = {},
	) {
		this.file = file
		this.leaseGrace = leaseGrace
		this.#connected = connected
		this.#unlisten = images.onDiscard((id) => this.#discarded(id))
	}

	// Returns the cameras, reading the file on first use. A file that cannot be read gives an empty registry.
	#load(): Map<string, SourceEntry> {
		if (this.#sources) return this.#sources

		let loaded: LoadedFrames = { sources: [], sequence: 0 }

		try {
			loaded = parseCaptureFrames(readFileSync(this.file, 'utf-8'))
		} catch (error) {
			const code = errorCode(error)
			if (code !== 'ENOENT' && code !== 'ENOTDIR') console.warn('capture frames: the registry file cannot be read', error)
		}

		this.#counter = loaded.sequence
		this.#newer = loaded.newer === true
		this.#sources = new Map()

		for (const { connectionId, deviceId, cameraName, saved } of loaded.sources) {
			// A write still in progress when the file was last written may have completed since: the file is checked
			// before it is opened, and a partial one fails to decode.
			const entries = saved.map((frame): FrameEntry => Object.assign(frame, { origin: 'capture' as const, revision: frame.sequence, restored: true }))
			this.#sources.set(sourceKey(connectionId, deviceId), { connectionId, deviceId, cameraName, saved: entries, transient: [], revision: entries.at(-1)?.sequence ?? 0 })
		}

		return this.#sources
	}

	// Returns every frame of a camera once: its latest, saved, and transient frames.
	#frames(source: SourceEntry): FrameEntry[] {
		const frames = [...source.saved, ...source.transient]
		if (source.latest && !frames.includes(source.latest)) frames.push(source.latest)
		return frames
	}

	// Returns the cameras with frames, the most recently updated first.
	snapshot(): CaptureFramesSnapshot {
		const sources = Array.from(this.#load().values(), (source) => this.#sourceSummary(source)).sort((a, b) => b.revision - a.revision)
		return { epoch: this.epoch, limit: FRAMES_PER_SOURCE, sources }
	}

	// Returns the latest frame of a camera and its saved frames, newest first, checking that the saved files of the
	// frames not in memory still exist; an empty page for a camera without frames, which may simply not have taken
	// any yet. The cursor is reserved for later pages; there is only one.
	async recent(connectionId: string, deviceId: string): Promise<CaptureFramePage> {
		const source = this.#load().get(sourceKey(connectionId, deviceId))
		if (!source) return { frames: [] }
		await Promise.all(source.saved.map((frame) => this.#check(source, frame)))
		const frames = source.saved.toReversed().map((frame) => this.#summary(frame))
		return source.latest ? { latest: this.#summary(source.latest), frames } : { frames }
	}

	// Returns a frame, or undefined for an unknown one.
	async frame(frameId: string): Promise<CaptureFrameSummary | undefined> {
		const found = this.#find(frameId)
		if (!found) return undefined
		await this.#check(found.source, found.frame)
		return this.#summary(found.frame)
	}

	// Records a frame Camera Capture or Auto Focus (origin) decoded into the image store, which becomes the latest
	// frame of its camera, and is among its saved frames when its file was already written. The previous latest frame
	// stays among the saved frames when it was saved, and becomes a transient frame otherwise; its document is closed
	// unless a lease holds it. The registry owns the closing of the document from then on.
	previewed(info: ImageInfo, frame: CaptureFrame, cameraName: string, origin: CaptureFrameOrigin = 'capture') {
		const { sessionId, generation, connectionId, deviceId, time, path, file, frameType, width, height, channels, cfa, bitpix, acquisition } = frame
		const key = sourceKey(connectionId, deviceId)
		const source = this.#source(connectionId, deviceId, cameraName)
		const frameId = captureFrameId(sessionId, generation)
		let entry = this.#frames(source).find((e) => e.frameId === frameId)

		if (entry) {
			Object.assign(entry, { width, height, channels, cfa, bitpix, acquisition })
			// The write may have completed before the frame was decoded.
			if (entry.file !== 'saved' && entry.file !== 'failed') entry.file = file
		} else {
			entry = { frameId, origin, sequence: ++this.#counter, connectionId, deviceId, cameraName, sessionId, generation, time, frameType, width, height, channels, cfa, bitpix, acquisition, path, file, revision: 0, restored: false }
		}

		entry.imageId = info.id
		entry.info = info
		const previous = source.latest

		if (previous !== entry) {
			remove(source.transient, entry)
			if (previous && !source.saved.includes(previous)) pushLimited(source.transient, previous)
			source.latest = entry
		}

		if (entry.file === 'saved') this.#save(source, entry)

		const previousImageId = this.#latest.get(key)
		this.#latest.set(key, info.id)
		this.#changed(source, entry)
		if (previousImageId !== undefined && previousImageId !== info.id) this.#closeIfUnused(previousImageId)
	}

	// Records the outcome of the write of a frame's file. A saved frame joins the saved frames of its camera, and one
	// the preview skipped becomes a frame of its own, available from its file; a failed frame never joins them, and
	// one the preview skipped is not recorded.
	written(frame: Pick<CaptureFrame, 'sessionId' | 'generation' | 'connectionId' | 'deviceId' | 'time' | 'frameType'> & { readonly path: string; readonly cameraName: string }, file: CaptureFileState) {
		const { sessionId, generation, connectionId, deviceId, time, frameType, path, cameraName } = frame
		const frameId = captureFrameId(sessionId, generation)
		const found = this.#find(frameId)

		if (found) {
			found.frame.file = file

			if (file === 'saved') {
				remove(found.source.transient, found.frame)
				this.#save(found.source, found.frame)
			} else if (found.source.saved.includes(found.frame)) {
				remove(found.source.saved, found.frame)
				if (found.source.latest !== found.frame) pushLimited(found.source.transient, found.frame)
			}

			this.#changed(found.source, found.frame)
		} else if (file === 'saved') {
			const source = this.#source(connectionId, deviceId, cameraName)
			const entry: FrameEntry = { frameId, origin: 'capture', sequence: ++this.#counter, connectionId, deviceId, cameraName, sessionId, generation, time, frameType, path, file, revision: 0, restored: false }
			this.#save(source, entry)
			this.#changed(source, entry)
		}
	}

	// Opens a frame for a client: leases its open document, or opens its saved file as a new document and
	// leases it. Refuses an unknown or unavailable frame, and a new document beyond MAX_LEASED_FRAMES.
	async open(frameId: string, client: string): Promise<CaptureFrameOpenOutcome> {
		const found = this.#find(frameId)
		if (!found) return { status: 'refused', code: 'notFound' }
		const { source, frame } = found

		if (frame.imageId === undefined || !frame.info) {
			if (frame.file === 'saving') return { status: 'refused', code: 'saving' }
			if (frame.file !== 'saved' || !frame.path) return { status: 'refused', code: frame.file === 'failed' ? 'saveFailed' : 'expired' }
			if (this.#leasedDocuments() >= MAX_LEASED_FRAMES) return { status: 'refused', code: 'limit' }

			if (!(await this.#check(source, frame))) return { status: 'refused', code: 'fileMissing' }

			if (frame.imageId === undefined || !frame.info) {
				let opening = this.#opening.get(frameId)

				if (!opening) {
					opening = this.images.open(frame.path)
					this.#opening.set(frameId, opening)
				}

				try {
					const info = await opening
					// The first of concurrent opens records the document.
					if (frame.imageId !== info.id) {
						frame.imageId = info.id
						frame.info = info
						this.#changed(source, frame)
					}
				} catch {
					return { status: 'refused', code: 'unreadable' }
				} finally {
					this.#opening.delete(frameId)
				}
			}
		} else if (!this.#holds.has(frame.imageId) && !this.#isLatest(frame.imageId) && this.#leasedDocuments() >= MAX_LEASED_FRAMES) {
			return { status: 'refused', code: 'limit' }
		}

		const { imageId, info } = frame
		// The document may have been lost with the image worker while its file was opened.
		if (!info) return { status: 'refused', code: 'expired' }
		const lease = crypto.randomUUID()
		this.#leases.set(lease, { frameId, imageId, client })
		this.#holds.set(imageId, (this.#holds.get(imageId) ?? 0) + 1)
		return { status: 'opened', lease, info, frame: this.#summary(frame) }
	}

	// Releases a lease, closing its document when nothing else keeps it open. Returns false for an unknown lease.
	release(lease: string): boolean {
		const found = this.#leases.get(lease)
		if (!found) return false
		this.#leases.delete(lease)

		const holds = (this.#holds.get(found.imageId) ?? 1) - 1
		if (holds > 0) this.#holds.set(found.imageId, holds)
		else this.#holds.delete(found.imageId)

		this.#closeIfUnused(found.imageId)
		return true
	}

	// Releases the leases of a client it no longer uses, and returns those of leases it named that no longer
	// exist.
	reconcile(client: string, leases: readonly string[]): CaptureLeaseReconcileResponse {
		const used = new Set(leases)
		for (const [id, lease] of this.#leases) if (lease.client === client && !used.has(id)) this.release(id)
		return { lost: leases.filter((id) => this.#leases.get(id)?.client !== client) }
	}

	// Counts a socket of a client that opened, keeping its leases.
	connected(client: string) {
		this.#sockets.set(client, (this.#sockets.get(client) ?? 0) + 1)
		clearTimeout(this.#graces.get(client))
		this.#graces.delete(client)
	}

	// Counts a socket of a client that closed; once its last one closed, its leases are released after the grace.
	disconnected(client: string) {
		const sockets = (this.#sockets.get(client) ?? 1) - 1

		if (sockets > 0) {
			this.#sockets.set(client, sockets)
			return
		}

		this.#sockets.delete(client)
		const timer = setTimeout(() => {
			this.#graces.delete(client)
			for (const [id, lease] of this.#leases) if (lease.client === client) this.release(id)
		}, this.leaseGrace)
		timer.unref()
		this.#graces.set(client, timer)
	}

	// Republishes the cameras a connection or device event changes the state of.
	deviceChanged(event: ConnectionRegistryEvent) {
		if (event.type !== 'connection:close' && event.type !== 'device:removed' && event.type !== 'device:updated' && event.type !== 'device:added') return
		const connectionId = event.type === 'connection:close' ? event.id : event.type === 'device:added' ? event.device.connectionId : event.connectionId
		const deviceId = event.type === 'device:added' ? event.device.id : event.type === 'connection:close' ? undefined : event.id

		for (const source of this.#load().values()) {
			if (source.connectionId !== connectionId || (deviceId !== undefined && source.deviceId !== deviceId)) continue
			source.revision = ++this.#counter
			this.listener({ type: 'captureSource:updated', source: this.#sourceSummary(source) })
		}
	}

	// Writes the pending changes of the file now. Resolves once written; never rejects.
	flush(): Promise<void> {
		clearTimeout(this.#saveTimer)
		this.#saveTimer = undefined
		const sources = this.#sources
		if (!sources || this.#newer) return this.#queue.then(() => undefined)

		const text = `${JSON.stringify(
			{
				version: CAPTURE_FRAMES_VERSION,
				sequence: this.#counter,
				sources: Array.from(sources.values())
					.filter((source) => source.saved.length > 0)
					.map(({ connectionId, deviceId, cameraName, saved }) => ({ connectionId, deviceId, cameraName, saved: saved.map(storedFrame) })),
			},
			undefined,
			'\t',
		)}\n`

		this.#queue = this.#queue.then(() => writeAtomically(this.file, text)).catch((error: unknown) => console.warn('capture frames: the registry file cannot be written', error))
		return this.#queue.then(() => undefined)
	}

	// Returns the camera of a key, created when missing, forgetting the least recently updated camera beyond
	// MAX_SOURCES.
	#source(connectionId: string, deviceId: string, cameraName: string): SourceEntry {
		const sources = this.#load()
		const key = sourceKey(connectionId, deviceId)
		let source = sources.get(key)

		if (!source) {
			source = { connectionId, deviceId, cameraName, saved: [], transient: [], revision: 0 }
			sources.set(key, source)

			if (sources.size > MAX_SOURCES) {
				const oldest = Array.from(sources.entries())
					.filter(([k]) => k !== key)
					.sort(([, a], [, b]) => a.revision - b.revision)[0]
				if (oldest) sources.delete(oldest[0])
			}
		}

		source.cameraName = cameraName
		return source
	}

	// Adds a frame whose file was written to the saved frames of its camera, in sequence order, forgetting the oldest
	// beyond FRAMES_PER_SOURCE. A forgotten frame stays the latest when it is; its document stays open while it is
	// the latest or leased.
	#save(source: SourceEntry, entry: FrameEntry) {
		if (source.saved.includes(entry)) return
		const at = source.saved.findIndex((frame) => frame.sequence > entry.sequence)
		source.saved.splice(at < 0 ? source.saved.length : at, 0, entry)
		if (source.saved.length > FRAMES_PER_SOURCE) source.saved.splice(0, source.saved.length - FRAMES_PER_SOURCE)
	}

	// Finds a frame by id: a latest, saved, or transient frame.
	#find(frameId: string): { readonly source: SourceEntry; readonly frame: FrameEntry } | undefined {
		for (const source of this.#load().values()) {
			const frame = this.#frames(source).find((entry) => entry.frameId === frameId)
			if (frame) return { source, frame }
		}

		return undefined
	}

	// Checks that the saved file of a frame not in memory exists, publishing a change of the outcome. Returns
	// whether the file exists.
	async #check(source: SourceEntry, frame: FrameEntry): Promise<boolean> {
		if (frame.imageId !== undefined || frame.file !== 'saved' || !frame.path) return false
		const missing = !(await exists(frame.path))

		if (missing !== (frame.missing === true)) {
			frame.missing = missing
			this.#changed(source, frame)
		}

		return !missing
	}

	// Whether a document is the latest frame of a camera.
	#isLatest(imageId: string) {
		for (const id of this.#latest.values()) if (id === imageId) return true
		return false
	}

	// Number of documents leases keep open besides the latest frames.
	#leasedDocuments() {
		let count = 0
		for (const imageId of this.#holds.keys()) if (!this.#isLatest(imageId)) count++
		return count
	}

	// Closes a document that is neither the latest frame of a camera nor leased.
	#closeIfUnused(imageId: string) {
		if (this.#holds.has(imageId) || this.#isLatest(imageId)) return
		// The discard listener clears the frame, unless an analysis still retains the document.
		this.images.close(imageId)
		this.#forget(imageId)
	}

	// Clears the document of the frame that held it, once it is closed or its pixels were released.
	#forget(imageId: string) {
		for (const source of this.#load().values()) {
			for (const frame of this.#frames(source)) {
				if (frame.imageId !== imageId) continue
				frame.imageId = undefined
				frame.info = undefined
				this.#changed(source, frame)
			}
		}
	}

	// Follows a document whose pixels were released, such as every document lost with the image worker: its
	// frame is no longer in memory, and its leases no longer hold anything.
	#discarded(imageId: string) {
		for (const [key, id] of this.#latest) if (id === imageId) this.#latest.delete(key)
		for (const [id, lease] of this.#leases) if (lease.imageId === imageId) this.#leases.delete(id)
		this.#holds.delete(imageId)
		this.#forget(imageId)
	}

	// Publishes a changed frame of a camera and schedules the write of the file.
	#changed(source: SourceEntry, frame: FrameEntry) {
		frame.revision = ++this.#counter
		source.revision = frame.revision
		this.listener({ type: 'captureFrame:updated', frame: this.#summary(frame), source: this.#sourceSummary(source) })

		if (!this.#saveTimer && !this.#newer) {
			this.#saveTimer = setTimeout(() => void this.flush(), SAVE_DELAY)
			this.#saveTimer.unref()
		}
	}

	// Returns whether a frame can be opened, and why not.
	#availability(frame: FrameEntry): Pick<CaptureFrameSummary, 'availability' | 'reason'> {
		if (frame.imageId !== undefined) return { availability: 'memory' }
		if (frame.file === 'saved') return frame.missing ? { availability: 'unavailable', reason: 'fileMissing' } : { availability: 'file' }
		if (frame.file === 'saving') return { availability: 'saving' }
		if (frame.file === 'failed') return { availability: 'unavailable', reason: 'saveFailed' }
		return { availability: 'unavailable', reason: frame.restored ? 'restarted' : 'expired' }
	}

	// Returns a frame as published.
	#summary(frame: FrameEntry): CaptureFrameSummary {
		const { frameId, origin, sequence, revision, connectionId, deviceId, cameraName, sessionId, generation, time, frameType, width, height, channels, bitpix, cfa, acquisition, path, file, imageId } = frame
		return { frameId, origin, sequence, revision, connectionId, deviceId, cameraName, sessionId, generation, time, frameType, width, height, channels, bitpix, cfa, acquisition, fileName: path && basename(path), file, imageId, ...this.#availability(frame) }
	}

	// Returns a camera as published.
	#sourceSummary(source: SourceEntry): CaptureSourceSummary {
		const { connectionId, deviceId, cameraName, latest, saved, revision } = source
		const isAvailable = (frame: FrameEntry) => {
			const { availability } = this.#availability(frame)
			return availability === 'memory' || availability === 'file'
		}
		const available = latest && isAvailable(latest) ? latest : saved.findLast(isAvailable)
		return { connectionId, deviceId, cameraName, connected: this.#connected(connectionId, deviceId), latestFrameId: latest?.frameId, latestAvailableFrameId: available?.frameId, latestRestored: !latest, count: saved.length, revision }
	}

	// Stops following the image store and cancels the pending releases and write; leases are forgotten.
	[Symbol.dispose]() {
		this.#unlisten()
		clearTimeout(this.#saveTimer)
		for (const timer of this.#graces.values()) clearTimeout(timer)
		this.#graces.clear()
	}
}

// Status of each refusal of a frame open.
const OPEN_FAILURES: Readonly<Record<CaptureFrameErrorCode, readonly [number, string]>> = {
	notFound: [404, 'Frame not found'],
	expired: [410, 'The frame is no longer in memory and was not saved'],
	fileMissing: [410, 'The saved file of the frame was removed or moved'],
	saveFailed: [410, 'The frame could not be saved and is no longer in memory'],
	saving: [409, 'The frame is being saved; try again once it is written'],
	limit: [409, 'Too many captured frames are open; close some image tabs first'],
	unreadable: [422, 'The saved file of the frame cannot be read'],
}

// Routes of the registry.
export function createCaptureFrameRoutes(registry: CaptureFrameRegistry) {
	return {
		'/api/capture-frames': {
			// Cameras with frames, for a tab that (re)connects.
			GET: () => Response.json(registry.snapshot()),
		},
		'/api/capture-frames/sources/:connectionId/:deviceId': {
			// Latest frame and saved frames of a camera, newest first (CaptureFramePage); empty for a camera without frames.
			GET: async (req) => Response.json(await registry.recent(req.params.connectionId, req.params.deviceId)),
		},
		'/api/capture-frames/frames/:frameId': {
			// A frame; 404 when unknown or forgotten.
			GET: async (req) => {
				const frame = await registry.frame(decodeURIComponent(req.params.frameId))
				return frame ? Response.json(frame) : errorResponse('Frame not found', 404, 'notFound')
			},
		},
		'/api/capture-frames/frames/:frameId/open': {
			// Opens a frame (CaptureFrameOpenRequest) and answers CaptureFrameOpened, or a refusal with its code.
			POST: async (req) => {
				const { client } = (await req.json()) as CaptureFrameOpenRequest
				const outcome = await registry.open(decodeURIComponent(req.params.frameId), client)
				if (outcome.status === 'opened') return Response.json({ lease: outcome.lease, info: outcome.info, frame: outcome.frame } satisfies CaptureFrameOpened)
				const [status, message] = OPEN_FAILURES[outcome.code]
				return errorResponse(message, status, outcome.code)
			},
		},
		'/api/capture-frames/leases/:lease': {
			// Releases a lease; 404 when it is unknown.
			DELETE: (req) => new Response(null, { status: registry.release(req.params.lease) ? 204 : 404 }),
		},
		'/api/capture-frames/clients/:client/leases': {
			// Reconciles the leases of a client (CaptureLeaseReconcileRequest) and answers the lost ones.
			PUT: async (req) => {
				const { leases } = (await req.json()) as CaptureLeaseReconcileRequest
				return Response.json(registry.reconcile(req.params.client, leases) satisfies CaptureLeaseReconcileResponse)
			},
			// The same, for the beacon a page sends when it unloads, which can only POST.
			POST: async (req) => {
				const { leases } = (await req.json()) as CaptureLeaseReconcileRequest
				return Response.json(registry.reconcile(req.params.client, leases) satisfies CaptureLeaseReconcileResponse)
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
