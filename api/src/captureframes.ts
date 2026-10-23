import { readFileSync } from 'fs'
import { stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, join } from 'path'
import type { CaptureFileState, CaptureFrame, CaptureSettings } from './captures'
import { errorResponse } from './commands'
import type { ServerEvent } from './connection'
import type { ImageAcquisition, ImageInfo, ImageStore } from './images'
import { errorCode, isRecord, writeAtomically } from './util'

// Capture frame registry: the index of the frames Camera Capture acquired, by physical camera (connection id +
// device id), so the Images workspace can open the latest or a recent frame of any camera and follow a camera
// live. It never holds pixels: a frame is available while its capture document is open in the image store, or
// while its saved file exists, which is opened as a new document when asked. A frame is identified by its
// frameId (capture session id and generation), which always names the same acquisition, whatever document
// currently holds its pixels.
//
// The registry owns the closing of capture documents: the latest previewed frame of each camera stays open,
// and an older one stays open only while a lease holds it. A lease belongs to a client (one browser tab, by
// the id it opens the event socket with); when the last socket of a client closes, its leases are released
// after LEASE_GRACE, so a phone whose screen locks finds its frames again when it comes back, and a tab that
// reopens its socket reconciles the leases it still uses. At most MAX_LEASED_FRAMES documents are kept open
// by leases besides the latest frames.
//
// The metadata of the latest FRAMES_PER_SOURCE frames of at most MAX_SOURCES cameras is persisted in a versioned
// JSON file, written at most every SAVE_DELAY after a change, so the frames of the last SAVE_DELAY may be lost
// in a crash. After a restart no frame is in memory: a saved frame is available again when its file exists,
// a frame that was only previewed is unavailable. No directory is ever scanned.

// File the registry is persisted in when none is given.
export const DEFAULT_CAPTURE_FRAMES_FILE = join(homedir(), 'Nebulosa', 'capture-frames.json')

// Version of the registry file format written by this version.
const CAPTURE_FRAMES_VERSION = 1

// Frames remembered per camera, newest first; older ones are forgotten.
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

// Why a frame cannot be opened:
// - expired: it was only previewed and its document was closed.
// - fileMissing: its saved file was removed or moved.
// - saveFailed: the write of its file failed and its document was closed.
// - restarted: it was only previewed before the server restarted.
export type CaptureFrameUnavailableReason = 'expired' | 'fileMissing' | 'saveFailed' | 'restarted'

// Metadata of a frame, as persisted. Every datum is the one of the acquisition, never changed later.
interface StoredFrame {
	// Identity of the frame: the capture session id and the generation.
	readonly frameId: string
	// Order of the frame among every frame of the registry; increases with every new frame.
	readonly sequence: number
	// Id of the connection that provided the camera.
	readonly connectionId: string
	// Exact id of the camera.
	readonly deviceId: string
	// Driver-reported camera name.
	readonly cameraName: string
	// Id of the capture session.
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
	// Id of the capture session.
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
	// Newest frame, available or not.
	readonly latestFrameId?: string
	// Newest frame that can be opened.
	readonly latestAvailableFrameId?: string
	// Frames remembered.
	readonly count: number
	// Revision of the latest change of the camera or one of its frames; a smaller one is older news.
	readonly revision: number
}

// Snapshot of GET /api/capture-frames.
export interface CaptureFramesSnapshot {
	// Identity of this run of the server; a different one means the server restarted.
	readonly epoch: string
	// Frames remembered per camera.
	readonly limit: number
	// Cameras with frames, the most recently updated first.
	readonly sources: readonly CaptureSourceSummary[]
}

// Page of recent frames of a camera, newest first.
export interface CaptureFramePage {
	// Frames of the page.
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

// Body of PUT /api/capture-frames/clients/:client/leases.
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
	// Frames, oldest first.
	readonly frames: FrameEntry[]
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
	// Frames by camera key.
	readonly sources: readonly { readonly connectionId: string; readonly deviceId: string; readonly cameraName: string; readonly frames: readonly StoredFrame[] }[]
	// Largest sequence read.
	readonly sequence: number
	// Whether the file was written by a newer version, so it must not be overwritten.
	readonly newer?: boolean
}

// Key of a camera.
export function sourceKey(connectionId: string, deviceId: string) {
	return `${connectionId}:${deviceId}`
}

// Identity of a frame of a capture session.
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

// Parses the content of the registry file. Content that is not a registry document is read as empty; a
// document of a newer version is read as far as it is understood and marked as newer.
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
		if (!isRecord(source) || typeof source.connectionId !== 'string' || typeof source.deviceId !== 'string' || !Array.isArray(source.frames)) continue
		const { connectionId, deviceId } = source
		const frames = source.frames.map((frame) => parseFrame(frame, connectionId, deviceId)).filter((frame) => frame !== undefined)
		for (const frame of frames) sequence = Math.max(sequence, frame.sequence)
		sources.push({ connectionId, deviceId, cameraName: typeof source.cameraName === 'string' ? source.cameraName : (frames.at(-1)?.cameraName ?? ''), frames })
	}

	return (data.version as number) > CAPTURE_FRAMES_VERSION ? { sources, sequence, newer: true } : { sources, sequence }
}

// Returns the persisted part of a frame.
function storedFrame({ frameId, sequence, connectionId, deviceId, cameraName, sessionId, generation, time, frameType, width, height, channels, bitpix, cfa, acquisition, path, file }: FrameEntry): StoredFrame {
	return { frameId, sequence, connectionId, deviceId, cameraName, sessionId, generation, time, frameType, width, height, channels, bitpix, cfa, acquisition, path, file }
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

		for (const { connectionId, deviceId, cameraName, frames } of loaded.sources) {
			// A write still in progress when the file was last written may have completed since: the file is checked
			// before it is opened, and a partial one fails to decode.
			const entries: FrameEntry[] = []
			for (const frame of frames) entries.push({ ...frame, file: frame.file === 'saving' ? 'saved' : frame.file, revision: frame.sequence, restored: true })
			entries.sort((a, b) => a.sequence - b.sequence)
			this.#sources.set(sourceKey(connectionId, deviceId), { connectionId, deviceId, cameraName, frames: entries.slice(-FRAMES_PER_SOURCE), revision: entries.at(-1)?.sequence ?? 0 })
		}

		return this.#sources
	}

	// Returns the cameras with frames, the most recently updated first.
	snapshot(): CaptureFramesSnapshot {
		const sources = Array.from(this.#load().values(), (source) => this.#sourceSummary(source)).sort((a, b) => b.revision - a.revision)
		return { epoch: this.epoch, limit: FRAMES_PER_SOURCE, sources }
	}

	// Returns the frames of a camera, newest first, checking that the saved files of the frames not in memory
	// still exist; undefined for an unknown camera. The cursor is reserved for later pages; there is only one.
	async recent(connectionId: string, deviceId: string): Promise<CaptureFramePage | undefined> {
		const source = this.#load().get(sourceKey(connectionId, deviceId))
		if (!source) return undefined
		await Promise.all(source.frames.map((frame) => this.#check(source, frame)))
		return { frames: source.frames.toReversed().map((frame) => this.#summary(frame)) }
	}

	// Returns a frame, or undefined for an unknown one.
	async frame(frameId: string): Promise<CaptureFrameSummary | undefined> {
		const found = this.#find(frameId)
		if (!found) return undefined
		await this.#check(found.source, found.frame)
		return this.#summary(found.frame)
	}

	// Records a frame the capture service decoded into the image store, which becomes the latest frame of its
	// camera. The document of the previous latest frame is closed unless a lease holds it.
	previewed(info: ImageInfo, frame: CaptureFrame, cameraName: string) {
		const { sessionId, generation, connectionId, deviceId, time, path, file, frameType, width, height, channels, cfa, bitpix, acquisition } = frame
		const key = sourceKey(connectionId, deviceId)
		const source = this.#source(connectionId, deviceId, cameraName)
		const frameId = captureFrameId(sessionId, generation)
		let entry = source.frames.find((e) => e.frameId === frameId)

		if (entry) {
			Object.assign(entry, { width, height, channels, cfa, bitpix, acquisition })
			// The write may have completed before the frame was decoded.
			if (entry.file !== 'saved' && entry.file !== 'failed') entry.file = file
		} else {
			entry = { frameId, sequence: ++this.#counter, connectionId, deviceId, cameraName, sessionId, generation, time, frameType, width, height, channels, cfa, bitpix, acquisition, path, file, revision: 0, restored: false }
			this.#append(source, entry)
		}

		entry.imageId = info.id
		entry.info = info
		const previous = this.#latest.get(key)
		this.#latest.set(key, info.id)
		this.#changed(source, entry)
		if (previous !== undefined && previous !== info.id) this.#closeIfUnused(previous)
	}

	// Records the outcome of the write of a frame's file. A saved frame the preview skipped becomes a frame of
	// its own, available from its file; a failed one the preview skipped is not recorded.
	written(frame: Pick<CaptureFrame, 'sessionId' | 'generation' | 'connectionId' | 'deviceId' | 'time' | 'frameType'> & { readonly path: string; readonly cameraName: string }, file: CaptureFileState) {
		const { sessionId, generation, connectionId, deviceId, time, frameType, path, cameraName } = frame
		const frameId = captureFrameId(sessionId, generation)
		const found = this.#find(frameId)

		if (found) {
			found.frame.file = file
			this.#changed(found.source, found.frame)
		} else if (file === 'saved') {
			const source = this.#source(connectionId, deviceId, cameraName)
			const entry: FrameEntry = { frameId, sequence: ++this.#counter, connectionId, deviceId, cameraName, sessionId, generation, time, frameType, path, file, revision: 0, restored: false }
			this.#append(source, entry)
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
	deviceChanged(event: ServerEvent) {
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
				sources: Array.from(sources.values(), ({ connectionId, deviceId, cameraName, frames }) => ({ connectionId, deviceId, cameraName, frames: frames.map(storedFrame) })),
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
			source = { connectionId, deviceId, cameraName, frames: [], revision: 0 }
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

	// Appends a frame to its camera, forgetting the oldest beyond FRAMES_PER_SOURCE. A forgotten frame's document
	// stays open while it is the latest or leased.
	#append(source: SourceEntry, entry: FrameEntry) {
		source.frames.push(entry)
		if (source.frames.length > FRAMES_PER_SOURCE) source.frames.splice(0, source.frames.length - FRAMES_PER_SOURCE)
	}

	// Finds a frame by id.
	#find(frameId: string): { readonly source: SourceEntry; readonly frame: FrameEntry } | undefined {
		for (const source of this.#load().values()) {
			const frame = source.frames.find((entry) => entry.frameId === frameId)
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
			for (const frame of source.frames) {
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
		const { frameId, sequence, revision, connectionId, deviceId, cameraName, sessionId, generation, time, frameType, width, height, channels, bitpix, cfa, acquisition, path, file, imageId } = frame
		return { frameId, sequence, revision, connectionId, deviceId, cameraName, sessionId, generation, time, frameType, width, height, channels, bitpix, cfa, acquisition, fileName: path && basename(path), file, imageId, ...this.#availability(frame) }
	}

	// Returns a camera as published.
	#sourceSummary(source: SourceEntry): CaptureSourceSummary {
		const { connectionId, deviceId, cameraName, frames, revision } = source
		const latest = frames.at(-1)
		const available = frames.findLast((frame) => {
			const { availability } = this.#availability(frame)
			return availability === 'memory' || availability === 'file'
		})
		return { connectionId, deviceId, cameraName, connected: this.#connected(connectionId, deviceId), latestFrameId: latest?.frameId, latestAvailableFrameId: available?.frameId, count: frames.length, revision }
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
			// Frames of a camera, newest first (CaptureFramePage); 404 for a camera without frames.
			GET: async (req) => {
				const page = await registry.recent(req.params.connectionId, req.params.deviceId)
				return page ? Response.json(page) : errorResponse('No frames of this camera', 404, 'notFound')
			},
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
				return Response.json({ error: message, code: outcome.code }, { status })
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
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
