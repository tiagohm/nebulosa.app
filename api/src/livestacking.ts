import { mkdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import type { Client } from 'nebulosa/src/devices/indi/device'
import { type FitsHeader, readFits } from 'nebulosa/src/io/formats/fits/fits'
import { uncompressedWidthKeyword } from 'nebulosa/src/io/formats/fits/util'
import { readXisf } from 'nebulosa/src/io/formats/xisf/xisf'
import { bufferSource } from 'nebulosa/src/io/io'
import type { CalibrationMasterDetail } from './calibrationlibrary'
import { fileDigest } from './calibrationlibrary.analysis'
import { type CalibrationMetadata, type MasterReference, matchesTarget, stableId } from './calibrationlibrary.compatibility'
import { type FileInspection, inspectFile, inspectHeader } from './calibrationlibrary.sources'
import type { CapturedFrame, CaptureFrameSink, CaptureOutputMode } from './captures'
import type { DeviceRegistry } from './devices'
import { errorResponse } from './http'
import type { ImageInfo, ImageStore } from './images'
import type { AnalysisCalibration } from './imagestacking.analysis'
import { productHeader } from './imagestacking.integration'
import {
	DEFAULT_LIVE_STACKING_RECIPE,
	type LiveEngineOutcome,
	LiveEngineError,
	type LiveExportTarget,
	type LiveFrameMeasurement,
	type LiveFrameRegistration,
	type LiveProcessorFactory,
	type LiveRejectionReason,
	type LiveSnapshot,
	type LiveStackingComposition,
	type LiveStackingProcessor,
	type LiveStackingRecipe,
	LiveWorkerFailure,
	LIVE_COVERAGE_FILE,
	LIVE_PRODUCT_FILE,
	WorkerProcessor,
} from './livestacking.engine'
import { calibrationPolicyId, classifyFilter, filterCalibration, filterGroupOf, frameTarget, geometryKeyOf, LIVE_MASTER_KINDS, type LiveFilterCalibration, type LiveStackingCalibration, missingMetadata, segmentKeyOf } from './livestacking.groups'
import type { LiveProductCohort, LiveStackingProduct, LiveStackingStore } from './livestacking.store'

// Live Stacking service: a server-owned analysis session per exact camera (connection id + device id) that integrates every
// LIGHT frame Camera Acquisition takes with that camera, across any number of captures, in Preview Only and Preview + Save
// alike, into online stacks grouped by field, filter, acquisition cohort, and calibration (see livestacking.engine.ts and
// livestacking.groups.ts). It never commands a device nor holds one in the operation registry: frames arrive through the
// frame sink of the capture service (captures.ts) and are accounted for one by one, from received to exactly one
// outcome: accepted into one stack, rejected after it was read, skipped on purpose (paused, aborted, not a light, unknown
// filter or metadata, no calibration chosen), or failed to be delivered (its file failed to be saved, the backlog limit,
// the worker). Preview-only frames are copied once and queued in memory, at most MAX_PENDING_PAYLOADS per camera: the
// capture waits before preparing its next exposure while the queue is full (never during an exposure), and is released by
// a stop, an abort, or a failure of either side. Saved frames queue only their path once their write succeeded, at most
// MAX_SAVED_BACKLOG. Frames are integrated one at a time, in order, on the worker of the session, within a memory budget
// shared by every session; nothing is ever evicted. The masters an operator chose for a filter are checked against each
// frame and leased while it is read; other filters are integrated uncalibrated in cohorts of their own, or skipped.
//
// A session lives in memory only: closing a tab never stops it, a restart forgets it, and its stacks are lost unless saved.
// Saving writes a linear Float32 FITS of one stack, or of a color composition of stacks of one field, as a product of
// live_stack_products (livestacking.store.ts); the frames themselves are never kept. Snapshots shown in Images are derived
// documents of the image store, made on demand at most every SNAPSHOT_INTERVAL per view and display-only: stretching
// them never changes a stack. Events carry a compact summary with the epoch of the service and a revision that only grows.

// The limits below were chosen from synthetic 16-bit star fields calibrated with a dark and a flat, measured with Bun
// 1.4.4 on an Intel Core i5-6500T (4 cores at 2.5 GHz, 8 GB), a slow host for this work. A frame integrated on the worker
// of its session (read, calibrate, detect stars, register, accumulate) takes 0.45 s for 1 MP mono (1280 × 800), 10.0 s
// for 26 MP mono (6248 × 4176), and 5.5 s for an 11.7 MP RGGB mosaic (4144 × 2822, debayered to color), so about 12 s
// for a 26 MP mosaic; star detection is 65 to 85% of it.

// Preview-only frames of a camera queued in memory, the one being integrated included, before its capture waits. One
// frame integrating and one waiting keep the camera busy whenever a frame integrates faster than the next one is exposed
// and downloaded; a deeper queue only absorbs bursts, never raises throughput, and costs the bytes of one more frame (2
// MiB at 1 MP, 50 MiB at 26 MP), which count against the memory budget.
export const MAX_PENDING_PAYLOADS = 2

// Saved frames of a camera waiting to be integrated; beyond it a frame fails with backlogLimit. A queued saved frame holds
// its path and record, never its pixels, so the limit bounds how far the stacks lag behind the capture rather than
// memory: 1000 frames are 7.5 minutes of integration at 1 MP and 2.8 hours at 26 MP.
export const MAX_SAVED_BACKLOG = 1000

// Memory every Live Stacking session together may retain for fields, stacks, candidates, masters, and queued frames, in
// bytes. What an engine retains matches liveStackerMemoryBytes with its field reference and masters exactly: a 26 MP mono
// field retains 1170 MiB for its first stack (846 MiB of stack, 100 MiB of reference, 224 MiB of dark and flat) and 846
// MiB for each other filter, and a 26 MP mosaic 2364 MiB for its first color stack (1060 MiB measured at 11.7 MP). 4 GiB
// holds four 26 MP mono filters of one field (3.6 GiB), or one 26 MP color stack with the candidates of a new field. It
// bounds retained memory only: the transient work of a 26 MP frame, snapshot, or composition peaked 1.0 to 1.4 GiB above
// it, so a full budget still fits a host of 8 GB.
export const DEFAULT_LIVE_STACKING_MEMORY_BUDGET = 4 * 1024 ** 3

// Frames whose outcome a session remembers, the newest first; older ones only count.
export const FRAME_HISTORY = 500

// Shortest time between two snapshots of one view, in milliseconds. A view is taken again only once a frame changed its
// stacks, on the worker between two integrations: a snapshot of a mono stack takes 20 ms at 1 MP and 0.45 s at 26 MP, a
// composition of two stacks with a luminance 0.13 s and 3.2 s. With frames of 1 MP every 0.45 s it keeps a view to at
// most 9% of the worker; frames slower than it are their own limit, 4.5% for a stack and 32% for a composition.
export const SNAPSHOT_INTERVAL = 1500

// Snapshot documents a session keeps open at most; the oldest is closed first.
const MAX_VIEW_DOCUMENTS = 4

// Largest page of frame outcomes.
const MAX_FRAME_PAGE = 200

// State of a session:
// - waiting: it admits frames and none is being integrated.
// - processing: a frame is being integrated.
// - paused: frames that arrive are skipped; those already admitted are still integrated.
// - stopping: no frame is admitted; those admitted are integrated, then it stops.
// - stopped: its stacks remain viewable and saveable until it is closed.
// - failed: its worker failed; its stacks are lost.
export type LiveStackingState = 'waiting' | 'processing' | 'paused' | 'stopping' | 'stopped' | 'failed'

// Why a frame was skipped on purpose, before it was integrated.
export type LiveSkipReason = 'paused' | 'aborted' | 'notLight' | 'unclassifiedFilter' | 'unknownMetadata' | 'calibrationNotChosen'

// Why a frame could not be delivered to the integration.
export type LiveDeliveryFailure = 'saveFailed' | 'frameUnavailable' | 'backlogLimit' | 'workerFailed' | 'sessionFailed'

// Why a frame was rejected after it was read: the engine's reasons, and chosen masters that cannot calibrate it.
export type LiveRejection = LiveRejectionReason | 'masterUnavailable' | 'masterIncompatible'

// Outcome of a frame; queued, processing, and held are not final.
export type LiveFrameOutcome = 'queued' | 'processing' | 'held' | 'accepted' | 'rejected' | 'skipped' | 'deliveryFailed'

// Frame counts of a session. Every received frame is in exactly one of the others: received = queued + processing + held +
// accepted + rejected + skipped + deliveryFailed.
export interface LiveStackingCounters {
	readonly received: number
	// Admitted and waiting, or waiting for its file to be written.
	readonly queued: number
	readonly processing: number
	// Candidates of a new field, waiting for it to be confirmed.
	readonly held: number
	readonly accepted: number
	readonly rejected: number
	readonly skipped: number
	readonly deliveryFailed: number
}

// What a session knows of one frame. Measurements and registration are present once it was read and accepted.
export interface LiveStackingFrame {
	// Order of arrival in the session, from 1.
	readonly sequence: number
	readonly frameId: string
	readonly captureSessionId: string
	readonly generation: number
	// Instant its exposure was commanded, Unix milliseconds (UTC).
	readonly time: number
	readonly outputMode: CaptureOutputMode
	readonly outcome: LiveFrameOutcome
	readonly reason?: LiveRejection | LiveSkipReason | LiveDeliveryFailure
	readonly detail?: string
	// Filter group; absent until its header was read, or when unclassified.
	readonly filter?: string
	readonly fieldId?: string
	readonly cohortId?: string
	readonly measurement?: LiveFrameMeasurement
	readonly registration?: LiveFrameRegistration
	// Fraction of the field it covers, the weight it was integrated with, and the scale of its normalization.
	readonly overlap?: number
	readonly weight?: number
	readonly scale?: number
	// Sensor temperature its header records, in degrees Celsius.
	readonly temperature?: number
	// Time from its arrival to its outcome, in milliseconds.
	readonly elapsed?: number
}

// Acquisition settings shared by the frames of a cohort, as their headers record them.
export interface LiveCohortAcquisition {
	readonly width: number
	readonly height: number
	readonly channels: number
	// Exposure of each frame, in seconds.
	readonly exposure: number
	readonly gain?: number
	readonly offset?: number
	readonly binX?: number
	readonly binY?: number
	readonly readoutMode?: string
	readonly cfa?: string
	readonly camera?: string
}

// A stack of one segment on one field.
export interface LiveStackingCohort {
	readonly cohortId: string
	readonly fieldId: string
	// Filter, exactly as the headers name it, or None.
	readonly filter: string
	readonly acquisition: LiveCohortAcquisition
	// Masters it is calibrated with; absent when uncalibrated.
	readonly calibration?: LiveFilterCalibration
	// Accepted frames and their total exposure, in seconds.
	readonly accepted: number
	readonly exposure: number
	// Lowest and highest sensor temperatures of its accepted frames, in degrees Celsius, when recorded.
	readonly temperature?: readonly [minimum: number, maximum: number]
	// When its first and latest frames were accepted, Unix milliseconds (UTC).
	readonly startedAt: number
	readonly updatedAt: number
}

// A field: one pointing and the grid its stacks share.
export interface LiveStackingFieldSummary {
	readonly fieldId: string
	// Order the fields were started in, from 1.
	readonly index: number
	readonly width: number
	readonly height: number
	readonly channels: number
	readonly createdAt: number
	// Frame that became its reference.
	readonly referenceFrameId: string
}

// Capture the session last received a frame from.
export interface LiveStackingCapture {
	readonly sessionId: string
	readonly outputMode: CaptureOutputMode
	// Whether that capture ended.
	readonly ended: boolean
}

// Published state of a session.
export interface LiveStackingSession {
	readonly sessionId: string
	readonly connectionId: string
	readonly deviceId: string
	readonly cameraName: string
	readonly state: LiveStackingState
	// Why it failed.
	readonly error?: string
	// When it started and stopped, Unix milliseconds (UTC).
	readonly startedAt: number
	readonly endedAt?: number
	readonly recipe: LiveStackingRecipe
	readonly calibration: LiveStackingCalibration
	readonly counters: LiveStackingCounters
	// Bytes of the preview-only frames queued in memory.
	readonly backlogBytes: number
	readonly capture?: LiveStackingCapture
	// Whether the next good frame starts a new field.
	readonly newFieldRequested: boolean
	readonly fields: readonly LiveStackingFieldSummary[]
	readonly cohorts: readonly LiveStackingCohort[]
	// Bytes its worker retains.
	readonly retainedBytes: number
	// Products saved from it.
	readonly products: readonly string[]
	// Revision of the session, increased by each change.
	readonly revision: number
}

// Snapshot of GET /api/live-stacking.
export interface LiveStackingSnapshot {
	// Identity of this run of the server; a new one means every earlier state is gone.
	readonly epoch: string
	readonly revision: number
	readonly sessions: readonly LiveStackingSession[]
	// Memory budget of every session together, and what they use now, in bytes.
	readonly memoryBudget: number
	readonly memoryUsed: number
}

// Body of POST /api/connections/:id/cameras/:deviceId/live-stacking.
export interface LiveStackingStartRequest {
	// Token of the request: repeating it returns the session it started.
	readonly token: string
	readonly recipe?: Partial<LiveStackingRecipe>
	readonly calibration?: LiveStackingCalibration
}

// What a view shows: one stack, or a color composition of stacks of one field.
export type LiveStackingViewTarget = { readonly cohortId: string } | { readonly composition: LiveStackingComposition }

// A snapshot of a view, as a derived document of the image store.
export interface LiveStackingView {
	readonly info: ImageInfo
	// Revision of what it shows: the accepted frames of its stacks when it was taken.
	readonly revision: number
	readonly frames: number
}

// A page of frame outcomes, newest first; next is the sequence to ask for the older ones with, absent on the last page.
export interface LiveStackingFramePage {
	readonly frames: readonly LiveStackingFrame[]
	readonly next?: number
}

// A product with the paths of its files, to open them in Images.
export interface LiveStackingProductDetail extends LiveStackingProduct {
	readonly path: string
	readonly coveragePath?: string
}

// Events of Live Stacking: a changed or closed session, and changed products.
export type LiveStackingEvent =
	| { readonly type: 'liveStacking:updated'; readonly epoch: string; readonly revision: number; readonly session: LiveStackingSession }
	| { readonly type: 'liveStacking:closed'; readonly epoch: string; readonly revision: number; readonly sessionId: string }
	| { readonly type: 'liveStacking:products'; readonly epoch: string; readonly revision: number }

// Stable code of a failed request.
export type LiveStackingErrorCode = 'notFound' | 'sessionConflict' | 'invalidState' | 'incompatibleFrame' | 'capacityExceeded' | 'saveFailed' | 'workerFailed'

// What Live Stacking reads of the Calibration Library: chosen masters with their metadata, and leases while a frame reads them.
export interface LiveStackingMasters {
	readonly pinnedMaster: (reference: MasterReference) => Promise<Pick<CalibrationMasterDetail, 'kind' | 'metadata' | 'path' | 'units' | 'fullScaleDn'> | undefined>
	readonly lease: (references: readonly Pick<MasterReference, 'masterId'>[]) => () => void
}

// Collaborators and settings of the service.
export interface LiveStackingOptions {
	// Creates the engine of a session; a worker of its own by default.
	readonly processor?: LiveProcessorFactory
	// Memory every session together may retain, in bytes.
	readonly memoryBudget?: number
}

// Failure of a request, with its status and stable code.
class LiveStackingError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: LiveStackingErrorCode,
	) {
		super(message)
	}
}

// What a frame was routed to before it was integrated.
interface FrameRoute {
	readonly filter: string
	readonly metadata: CalibrationMetadata
	readonly calibration?: LiveFilterCalibration
}

// A frame while the session knows it.
interface FrameEntry {
	record: LiveStackingFrame
	// Bytes of a preview-only frame until they are handed to the worker.
	bytes?: Uint8Array<ArrayBuffer>
	// File of a saved frame, once written.
	path?: string
	// Whether a saved frame waits for its file.
	awaitingFile: boolean
	// Whether its capture snooped a filter wheel, so a header without a filter means an unknown one.
	readonly wheelSnooped: boolean
	readonly arrivedAt: number
	route?: FrameRoute
}

// A cached snapshot document of a view.
interface ViewDocument {
	readonly key: string
	readonly view: LiveStackingView
	readonly takenAt: number
}

// A session while the service knows it.
interface Session {
	summary: Omit<LiveStackingSession, 'state' | 'counters' | 'fields' | 'cohorts' | 'backlogBytes'>
	phase: 'active' | 'paused' | 'stopping' | 'stopped' | 'failed'
	readonly token: string
	readonly processor: LiveStackingProcessor
	counters: { -readonly [K in keyof LiveStackingCounters]: LiveStackingCounters[K] }
	readonly queue: FrameEntry[]
	// Held candidates of a new field, by frame id.
	readonly held: Map<string, FrameEntry>
	// Frame being integrated.
	current?: FrameEntry
	// Remembered final outcomes, oldest first.
	readonly history: LiveStackingFrame[]
	// Highest generation received from each capture, so a frame is counted once.
	readonly generations: Map<string, number>
	readonly fields: LiveStackingFieldSummary[]
	readonly cohorts: Map<string, LiveStackingCohort>
	// Header of the first frame of each cohort, for the header of its export.
	readonly cohortMetadata: Map<string, CalibrationMetadata>
	// Captures waiting at the gate, released when the queue frees or the session ends.
	readonly waiters: Set<() => void>
	readonly views: ViewDocument[]
	readonly viewRequests: Map<string, Promise<LiveStackingView>>
	sequence: number
	pumping: boolean
}

// Returns a cleared set of counters.
function emptyCounters(): Session['counters'] {
	return { received: 0, queued: 0, processing: 0, held: 0, accepted: 0, rejected: 0, skipped: 0, deliveryFailed: 0 }
}

// Returns whether bytes hold an XISF file, by its signature.
function isXisf(bytes: Uint8Array) {
	return bytes.length >= 8 && String.fromCharCode(...bytes.subarray(0, 8)) === 'XISF0100'
}

// Reads what the header of a frame in memory says, without decoding its pixels. Undefined when it holds no image.
async function inspectBytes(bytes: Uint8Array<ArrayBuffer>): Promise<FileInspection | undefined> {
	const source = bufferSource(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))

	if (isXisf(bytes)) {
		const image = (await readXisf(source))?.images[0]
		return image && inspectHeader(image.header, 'xisf', false, image.imageType)
	}

	const hdu = (await readFits(source))?.hdus.find((candidate) => uncompressedWidthKeyword(candidate.header, 0) > 0)
	return hdu && inspectHeader(hdu.header, 'fits', false)
}

// Returns the acquisition summary of a cohort from the header of its first frame.
function acquisitionOf(metadata: CalibrationMetadata): LiveCohortAcquisition {
	return {
		width: metadata.width,
		height: metadata.height,
		channels: metadata.channels,
		exposure: (metadata.exposure.value ?? 0) / 1000000,
		...(metadata.gain.value !== undefined && { gain: metadata.gain.value }),
		...(metadata.offset.value !== undefined && { offset: metadata.offset.value }),
		...(metadata.binX.value !== undefined && { binX: metadata.binX.value }),
		...(metadata.binY.value !== undefined && { binY: metadata.binY.value }),
		...(metadata.readoutMode.value !== undefined && { readoutMode: metadata.readoutMode.value }),
		...(metadata.cfa !== undefined && { cfa: metadata.cfa }),
		...(metadata.cameraName !== undefined && { camera: metadata.cameraName }),
	}
}

// Returns what a product records of one of its stacks.
function productCohort(cohort: LiveStackingCohort): LiveProductCohort {
	const product: LiveProductCohort = { cohortId: cohort.cohortId, filter: cohort.filter, frames: cohort.accepted, exposure: cohort.exposure }
	return cohort.calibration ? { ...product, calibration: cohort.calibration } : product
}

// Returns a recipe completed with the defaults, its numbers kept in their domains.
function recipeOf(recipe: Partial<LiveStackingRecipe> | undefined): LiveStackingRecipe {
	const merged = { ...DEFAULT_LIVE_STACKING_RECIPE, ...recipe }
	return { ...merged, minStars: Math.max(3, Math.trunc(merged.minStars)), minOverlap: Math.min(1, Math.max(0, merged.minOverlap)) }
}

// Returns the key of a view target.
function viewKey(target: LiveStackingViewTarget) {
	return 'cohortId' in target ? `cohort:${target.cohortId}` : `composite:${stableId(JSON.stringify(target.composition))}`
}

// Live Stacking sessions of every camera.
export class LiveStacking implements Disposable {
	readonly epoch = crypto.randomUUID()
	readonly #sessions = new Map<string, Session>()
	readonly #processor: LiveProcessorFactory
	readonly memoryBudget: number
	readonly #detach: () => void
	#revision = 0
	#opened?: Promise<void>

	// Creates the service. captures feeds it the frames of every capture, devices and client resolve a camera by its exact
	// ids, masters gives the chosen calibration masters, images keeps the snapshots, store the saved stacks, and
	// listener receives every event.
	constructor(
		captures: { readonly listenFrames: (sink: CaptureFrameSink) => () => void },
		readonly devices: DeviceRegistry,
		readonly client: (connectionId: string) => Client | undefined,
		readonly masters: LiveStackingMasters,
		readonly images: Pick<ImageStore, 'adopt' | 'close'>,
		readonly store: LiveStackingStore,
		readonly listener: (event: LiveStackingEvent) => void,
		options: LiveStackingOptions = {},
	) {
		this.#processor = options.processor ?? ((recipe) => new WorkerProcessor(recipe))
		this.memoryBudget = options.memoryBudget ?? DEFAULT_LIVE_STACKING_MEMORY_BUDGET

		this.#detach = captures.listenFrames({
			wants: (connectionId, deviceId) => this.#wants(connectionId, deviceId),
			captured: (frame, bytes) => this.#captured(frame, bytes),
			saved: (frameId, path) => this.#saved(frameId, path),
			saveFailed: (frameId) => this.#saveFailed(frameId),
			gate: (connectionId, deviceId, signal) => this.#gate(connectionId, deviceId, signal),
			captureEnded: (sessionId, connectionId, deviceId) => this.#captureEnded(sessionId, connectionId, deviceId),
		})
	}

	// Finishes what a crash interrupted and clears the staged exports; resolves once the products can be used.
	ready() {
		this.#opened ??= this.#recoverProducts()
		return this.#opened
	}

	// Returns every session and the memory they use.
	snapshot(): LiveStackingSnapshot {
		const sessions = Array.from(this.#sessions.values(), (session) => this.#summary(session))
		return { epoch: this.epoch, revision: this.#revision, sessions, memoryBudget: this.memoryBudget, memoryUsed: this.#memoryUsed() }
	}

	// Returns a session. Throws notFound.
	session(sessionId: string) {
		return this.#summary(this.#session(sessionId))
	}

	// Starts a session for a camera, or returns the one its token already started. Throws notFound for an unknown camera and
	// sessionConflict while another session of the camera runs; a stopped or failed one is closed first.
	start(connectionId: string, deviceId: string, request: LiveStackingStartRequest): { readonly session: LiveStackingSession; readonly created: boolean } {
		const client = this.client(connectionId)
		const camera = client && this.devices.camera(client, deviceId)
		if (!camera) throw new LiveStackingError('Camera not found', 404, 'notFound')

		const existing = this.#cameraSession(connectionId, deviceId)

		if (existing) {
			if (existing.phase !== 'stopped' && existing.phase !== 'failed') {
				if (existing.token === request.token) return { session: this.#summary(existing), created: false }
				throw new LiveStackingError('Live Stacking already runs for this camera', 409, 'sessionConflict')
			}

			this.#close(existing)
		}

		const recipe = recipeOf(request.recipe)
		const calibration = request.calibration ?? { filters: {}, otherwise: 'uncalibrated' }
		const sessionId = crypto.randomUUID()

		const session: Session = {
			summary: { sessionId, connectionId, deviceId, cameraName: camera.name, startedAt: Date.now(), recipe, calibration, newFieldRequested: false, retainedBytes: 0, products: [], revision: 0 },
			phase: 'active',
			token: request.token,
			processor: this.#processor(recipe),
			counters: emptyCounters(),
			queue: [],
			held: new Map(),
			history: [],
			generations: new Map(),
			fields: [],
			cohorts: new Map(),
			cohortMetadata: new Map(),
			waiters: new Set(),
			views: [],
			viewRequests: new Map(),
			sequence: 0,
			pumping: false,
		}

		this.#sessions.set(sessionId, session)
		this.#publish(session)
		return { session: this.#summary(session), created: true }
	}

	// Pauses a session: frames that arrive are skipped, the admitted ones still integrated. Throws invalidState once it stops.
	pause(sessionId: string) {
		const session = this.#session(sessionId)
		if (session.phase === 'paused') return this.#summary(session)
		if (session.phase !== 'active') throw new LiveStackingError('Only a running session can be paused', 409, 'invalidState')
		session.phase = 'paused'
		this.#release(session)
		return this.#publish(session)
	}

	// Resumes a paused session with the frames that arrive from now on.
	resume(sessionId: string) {
		const session = this.#session(sessionId)
		if (session.phase === 'active') return this.#summary(session)
		if (session.phase !== 'paused') throw new LiveStackingError('Only a paused session can be resumed', 409, 'invalidState')
		session.phase = 'active'
		return this.#publish(session)
	}

	// Stops admitting frames; the admitted ones are integrated, and the session then stops with its stacks.
	stop(sessionId: string) {
		const session = this.#session(sessionId)
		if (session.phase === 'stopping' || session.phase === 'stopped' || session.phase === 'failed') return this.#summary(session)
		session.phase = 'stopping'
		this.#release(session)
		this.#publish(session)
		void this.#pump(session)
		return this.#summary(session)
	}

	// Stops at once: the queued frames are skipped as aborted, the one being integrated completes, and the stacks are kept.
	abort(sessionId: string) {
		const session = this.#session(sessionId)
		if (session.phase === 'stopped' || session.phase === 'failed') return this.#summary(session)
		session.phase = 'stopping'
		for (const entry of session.queue.splice(0)) this.#finish(session, entry, { outcome: 'skipped', reason: 'aborted', detail: 'The session was aborted' })
		this.#release(session)
		this.#publish(session)
		void this.#pump(session)
		return this.#summary(session)
	}

	// Discards the stacks, fields, and frame history of a session; frames already admitted go on into new stacks. Captures
	// and their files are never touched.
	async reset(sessionId: string) {
		const session = this.#session(sessionId)
		if (session.phase === 'failed') throw new LiveStackingError('A failed session cannot be reset', 409, 'invalidState')
		const result = await this.#call(session, () => session.processor.reset())
		this.#settle(session, result.outcomes)
		session.fields.length = 0
		session.cohorts.clear()
		session.cohortMetadata.clear()
		session.history.length = 0
		this.#closeViews(session)
		const inFlight = session.counters.queued + session.counters.processing + session.counters.held
		session.counters = { ...emptyCounters(), received: inFlight, queued: session.counters.queued, processing: session.counters.processing, held: session.counters.held }
		session.summary = { ...session.summary, newFieldRequested: false, retainedBytes: result.retainedBytes }
		return this.#publish(session)
	}

	// Makes the next good frame of a session the reference of a new field; held candidates are rejected.
	async startNewField(sessionId: string) {
		const session = this.#session(sessionId)
		if (session.phase === 'stopped' || session.phase === 'failed') throw new LiveStackingError('The session no longer admits frames', 409, 'invalidState')
		const result = await this.#call(session, () => session.processor.startNewField())
		this.#settle(session, result.outcomes)
		session.summary = { ...session.summary, newFieldRequested: true, retainedBytes: result.retainedBytes }
		return this.#publish(session)
	}

	// Replaces the masters chosen per filter, for the frames integrated from now on: a filter whose masters change starts
	// other stacks, and its stacks so far are never recalibrated.
	setCalibration(sessionId: string, calibration: LiveStackingCalibration) {
		const session = this.#session(sessionId)
		if (session.phase === 'stopped' || session.phase === 'failed') throw new LiveStackingError('The session no longer admits frames', 409, 'invalidState')
		session.summary = { ...session.summary, calibration }
		return this.#publish(session)
	}

	// Closes a stopped or failed session, releasing its stacks and snapshots.
	close(sessionId: string) {
		const session = this.#session(sessionId)
		if (session.phase !== 'stopped' && session.phase !== 'failed') throw new LiveStackingError('Stop the session before closing it', 409, 'invalidState')
		this.#close(session)
	}

	// Returns a page of the frame outcomes of a session, newest first, before a sequence.
	frames(sessionId: string, before?: number, limit = 50): LiveStackingFramePage {
		const session = this.#session(sessionId)
		const all = [...session.history, ...Array.from(session.held.values(), (entry) => entry.record), ...(session.current ? [session.current.record] : []), ...session.queue.map((entry) => entry.record)].sort((a, b) => b.sequence - a.sequence)
		const older = before === undefined ? all : all.filter((frame) => frame.sequence < before)
		const page = older.slice(0, Math.min(MAX_FRAME_PAGE, Math.max(1, Math.trunc(limit))))
		return { frames: page, ...(older.length > page.length && { next: page.at(-1)!.sequence }) }
	}

	// Returns a snapshot document of a view of a session, taken again when its stacks changed and the last one is older than
	// SNAPSHOT_INTERVAL. Throws notFound for an unknown stack, incompatibleFrame for an invalid composition.
	view(sessionId: string, target: LiveStackingViewTarget): Promise<LiveStackingView> {
		const session = this.#session(sessionId)
		if (session.phase === 'failed') throw new LiveStackingError('The stacks of the session were lost', 409, 'workerFailed')
		const key = viewKey(target)
		const revision = this.#viewRevision(session, target)
		const cached = session.views.find((view) => view.key === key)
		if (cached && (cached.view.revision === revision || Date.now() - cached.takenAt < SNAPSHOT_INTERVAL)) return Promise.resolve(cached.view)

		const pending = session.viewRequests.get(key)
		if (pending) return pending

		const request = this.#takeView(session, key, target, revision).finally(() => session.viewRequests.delete(key))
		session.viewRequests.set(key, request)
		return request
	}

	// Saves a stack, or a composition of stacks of one field, of a session as a product: a linear Float32 FITS of one
	// consistent revision. Resolves to the product with the paths of its files.
	async export(sessionId: string, target: LiveExportTarget): Promise<LiveStackingProductDetail> {
		await this.ready()
		const session = this.#session(sessionId)
		if (session.phase === 'failed') throw new LiveStackingError('The stacks of the session were lost', 409, 'workerFailed')

		const cohorts = 'cohortId' in target ? [target.cohortId] : target.composition.sources.map((source) => source.cohortId)
		const known = cohorts.map((cohortId) => session.cohorts.get(cohortId))
		if (known.some((cohort) => !cohort)) throw new LiveStackingError('The stack is unknown', 404, 'notFound')
		const stacks = known as LiveStackingCohort[]
		const metadata = session.cohortMetadata.get(stacks[0].cohortId)!
		const frames = stacks.reduce((total, cohort) => total + cohort.accepted, 0)
		const exposure = stacks.reduce((total, cohort) => total + cohort.exposure, 0)
		const name = 'cohortId' in target ? stacks[0].filter : target.composition.preset
		const header = this.#exportHeader(session, target, stacks, metadata, name, frames, exposure)
		const productId = crypto.randomUUID()
		const staging = this.store.stagingDirectory(productId)

		try {
			const files = await this.#call(session, () => session.processor.export(staging, target, header))

			const product: LiveStackingProduct = {
				productId,
				sessionId,
				connectionId: session.summary.connectionId,
				deviceId: session.summary.deviceId,
				cameraName: session.summary.cameraName,
				kind: 'cohortId' in target ? 'stack' : 'composite',
				name,
				createdAt: Date.now(),
				contentDigest: files.contentDigest,
				bytes: files.bytes,
				...(files.coverageDigest !== undefined && { coverageDigest: files.coverageDigest, coverageBytes: files.coverageBytes }),
				width: files.width,
				height: files.height,
				channels: files.channels,
				frames,
				exposure,
				recipe: session.summary.recipe,
				cohorts: stacks.map(productCohort),
				...('composition' in target && { composition: target.composition }),
			}

			this.store.beginProduct(product)

			try {
				await mkdir(this.store.productsDirectory, { recursive: true })
				await rename(staging, this.store.productDirectory(productId))
			} catch {
				this.store.discardProduct(productId)
				throw new LiveStackingError('The stack could not be saved', 500, 'saveFailed')
			}

			this.store.setPublication(productId, 'published')
			session.summary = { ...session.summary, products: [...session.summary.products, productId] }
			this.#publish(session)
			this.listener({ type: 'liveStacking:products', epoch: this.epoch, revision: ++this.#revision })
			return this.#detail(product)
		} finally {
			await rm(staging, { recursive: true, force: true })
		}
	}

	// Lists the saved stacks, newest first.
	async products() {
		await this.ready()
		return this.store.products()
	}

	// Returns a saved stack with the paths of its files. Throws notFound.
	async product(productId: string) {
		await this.ready()
		const product = this.store.product(productId)
		if (!product) throw new LiveStackingError('Product not found', 404, 'notFound')
		return this.#detail(product)
	}

	// Deletes a saved stack and its files. Throws notFound.
	async deleteProduct(productId: string) {
		await this.ready()
		if (!this.store.product(productId)) throw new LiveStackingError('Product not found', 404, 'notFound')
		this.store.setPublication(productId, 'deleting')
		await rm(this.store.productDirectory(productId), { recursive: true, force: true })
		this.store.discardProduct(productId)
		this.listener({ type: 'liveStacking:products', epoch: this.epoch, revision: ++this.#revision })
	}

	// Stops every session, releasing their workers, gates, and snapshots, and stops receiving frames.
	[Symbol.dispose]() {
		this.#detach()
		for (const session of this.#sessions.values()) this.#close(session, false)
	}

	// Whether the frames of a camera are wanted: a session admits them, or is paused or failed and accounts for them.
	#wants(connectionId: string, deviceId: string) {
		const session = this.#cameraSession(connectionId, deviceId)
		return session !== undefined && session.phase !== 'stopping' && session.phase !== 'stopped'
	}

	// Admits a frame decoded by a capture of the camera of a session, once.
	#captured(frame: CapturedFrame, bytes: Uint8Array<ArrayBuffer> | undefined) {
		const session = this.#cameraSession(frame.connectionId, frame.deviceId)
		if (!session || session.phase === 'stopping' || session.phase === 'stopped') return
		if ((session.generations.get(frame.sessionId) ?? 0) >= frame.generation) return
		session.generations.set(frame.sessionId, frame.generation)

		const outputMode = frame.request.output.mode
		session.summary = { ...session.summary, capture: { sessionId: frame.sessionId, outputMode, ended: false } }
		const record: LiveStackingFrame = { sequence: ++session.sequence, frameId: frame.frameId, captureSessionId: frame.sessionId, generation: frame.generation, time: frame.time, outputMode, outcome: 'queued' }
		const entry: FrameEntry = { record, awaitingFile: outputMode === 'preview-save', wheelSnooped: !!frame.request.snoop?.wheel, arrivedAt: Date.now() }
		session.counters.received++
		session.counters.queued++

		if (session.phase === 'failed') return this.#finish(session, entry, { outcome: 'deliveryFailed', reason: 'sessionFailed', detail: 'The session failed' })
		if (session.phase === 'paused') return this.#finish(session, entry, { outcome: 'skipped', reason: 'paused', detail: 'The session was paused' })

		if (outputMode === 'preview-only') {
			if (!bytes) return this.#finish(session, entry, { outcome: 'deliveryFailed', reason: 'frameUnavailable', detail: 'The frame arrived without its pixels' })
			// The gate keeps the queue within its limit; a frame beyond it arrived while the session could not hold the capture.
			if (this.#pendingPayloads(session) > MAX_PENDING_PAYLOADS) return this.#finish(session, entry, { outcome: 'deliveryFailed', reason: 'backlogLimit', detail: 'Too many unsaved frames were waiting' })
			entry.bytes = bytes
		} else if (session.queue.length >= MAX_SAVED_BACKLOG) {
			return this.#finish(session, entry, { outcome: 'deliveryFailed', reason: 'backlogLimit', detail: `More than ${MAX_SAVED_BACKLOG} saved frames were waiting` })
		}

		session.queue.push(entry)
		this.#publish(session)
		void this.#pump(session)
	}

	// The file of a saved frame was written: it can be integrated.
	#saved(frameId: string, path: string) {
		for (const session of this.#sessions.values()) {
			const entry = session.queue.find((candidate) => candidate.record.frameId === frameId)
			if (!entry) continue
			entry.path = path
			entry.awaitingFile = false
			void this.#pump(session)
			return
		}
	}

	// The file of a saved frame could not be written: it fails, never read from a partial file.
	#saveFailed(frameId: string) {
		for (const session of this.#sessions.values()) {
			const index = session.queue.findIndex((candidate) => candidate.record.frameId === frameId)
			if (index < 0) continue
			const [entry] = session.queue.splice(index, 1)
			this.#finish(session, entry, { outcome: 'deliveryFailed', reason: 'saveFailed', detail: 'Its file could not be written' })
			this.#publish(session)
			void this.#pump(session)
			return
		}
	}

	// A capture ended: saved frames of it still waiting for their file never get one.
	#captureEnded(sessionId: string, connectionId: string, deviceId: string) {
		const session = this.#cameraSession(connectionId, deviceId)
		if (!session) return

		for (const entry of session.queue.filter((candidate) => candidate.awaitingFile && candidate.record.captureSessionId === sessionId)) {
			session.queue.splice(session.queue.indexOf(entry), 1)
			this.#finish(session, entry, { outcome: 'deliveryFailed', reason: 'frameUnavailable', detail: 'Its capture ended before its file was written' })
		}

		if (session.summary.capture?.sessionId === sessionId) session.summary = { ...session.summary, capture: { ...session.summary.capture, ended: true } }
		this.#publish(session)
		void this.#pump(session)
	}

	// Holds the next exposure of a capture while the session of its camera holds as many preview-only frames as it may.
	#gate(connectionId: string, deviceId: string, signal: AbortSignal) {
		const session = this.#cameraSession(connectionId, deviceId)
		if (!session || !this.#holding(session)) return undefined

		return new Promise<void>((resolve) => {
			const release = () => {
				session.waiters.delete(check)
				signal.removeEventListener('abort', release)
				resolve()
			}

			const check = () => {
				if (!this.#holding(session)) release()
			}

			session.waiters.add(check)
			signal.addEventListener('abort', release, { once: true })
		})
	}

	// Whether a session must hold the next exposure of its camera.
	#holding(session: Session) {
		return session.phase === 'active' && this.#pendingPayloads(session) >= MAX_PENDING_PAYLOADS
	}

	// Lets the captures waiting at the gate of a session go on when they no longer need to wait.
	#release(session: Session) {
		for (const check of session.waiters) check()
	}

	// Preview-only frames of a session held in memory, the one being integrated included.
	#pendingPayloads(session: Session) {
		let count = session.current?.record.outputMode === 'preview-only' ? 1 : 0
		for (const entry of session.queue) if (entry.bytes) count++
		return count
	}

	// Integrates the admitted frames of a session one at a time, in order, then stops it when it was stopping.
	async #pump(session: Session) {
		if (session.pumping) return
		session.pumping = true

		try {
			while (session.phase !== 'failed' && !session.current) {
				const entry = session.queue[0]
				if (!entry || entry.awaitingFile) break
				session.queue.shift()
				session.current = entry
				session.counters.queued--
				session.counters.processing++
				entry.record = { ...entry.record, outcome: 'processing' }
				this.#publish(session)

				try {
					await this.#integrate(session, entry)
				} catch (error) {
					if (error instanceof LiveWorkerFailure) this.#fail(session, entry, error.message)
					else this.#finish(session, entry, { outcome: 'deliveryFailed', reason: 'workerFailed', detail: Error.isError(error) ? error.message : String(error) }, true)
				} finally {
					session.current = undefined
					this.#release(session)
				}

				this.#publish(session)
			}

			if (session.phase === 'stopping' && !session.current && session.queue.length === 0) await this.#stopped(session)
		} finally {
			session.pumping = false
		}
	}

	// Reads the header of a frame, routes it to its segment and calibration, and integrates it on the worker.
	async #integrate(session: Session, entry: FrameEntry) {
		const { bytes, path } = entry
		entry.bytes = undefined
		let inspection: FileInspection | undefined

		try {
			inspection = bytes ? await inspectBytes(bytes) : path ? await inspectFile(path) : undefined
		} catch {
			inspection = undefined
		}

		if (!inspection) return this.#finish(session, entry, { outcome: 'deliveryFailed', reason: 'frameUnavailable', detail: path ? 'Its file could not be read' : 'Its pixels could not be read' }, true)
		if (inspection.kind !== undefined || inspection.rejectedRole === 'master') return this.#finish(session, entry, { outcome: 'skipped', reason: 'notLight', detail: 'Its header says it is not a light frame' }, true)

		const { metadata } = inspection
		const missing = missingMetadata(metadata)
		if (missing) return this.#finish(session, entry, { outcome: 'skipped', reason: 'unknownMetadata', detail: missing }, true)

		const filter = filterGroupOf(classifyFilter(metadata.filter.value, entry.wheelSnooped))
		const temperature = metadata.sensorTemperature.value
		entry.record = { ...entry.record, ...(filter !== undefined && { filter }), ...(temperature !== undefined && { temperature }) }
		if (filter === undefined) return this.#finish(session, entry, { outcome: 'skipped', reason: 'unclassifiedFilter', detail: 'A filter wheel was snooped but the header names no filter' }, true)

		const chosen = filterCalibration(session.summary.calibration, filter)
		if (!chosen && session.summary.calibration.otherwise === 'skip') return this.#finish(session, entry, { outcome: 'skipped', reason: 'calibrationNotChosen', detail: `No masters were chosen for ${filter}` }, true)

		const calibration: { -readonly [K in keyof AnalysisCalibration]: AnalysisCalibration[K] } = {}
		const pins: MasterReference[] = []
		const target = frameTarget(metadata)

		for (const kind of LIVE_MASTER_KINDS) {
			const pin = chosen?.[kind]
			if (!pin) continue
			const master = await this.masters.pinnedMaster(pin)
			if (!master) return this.#finish(session, entry, { outcome: 'rejected', reason: 'masterUnavailable', detail: `The ${kind} chosen for ${filter} is no longer available` }, true)
			if (master.kind !== kind || !matchesTarget(kind, master.metadata, target)) return this.#finish(session, entry, { outcome: 'rejected', reason: 'masterIncompatible', detail: `The ${kind} chosen for ${filter} does not match the frame` }, true)
			calibration[kind] = { path: master.path, fullScale: master.units === 'dimensionless' ? 1 : master.fullScaleDn }
			pins.push(pin)
		}

		entry.route = { filter, metadata, ...(chosen && { calibration: chosen }) }
		const segment = segmentKeyOf(filter, metadata, calibrationPolicyId(chosen))
		const release = this.masters.lease(pins)

		try {
			const source = bytes ? ({ kind: 'bytes', bytes } as const) : ({ kind: 'file', path: path! } as const)
			const budget = this.memoryBudget - (this.#memoryUsed() - session.summary.retainedBytes)
			const result = await session.processor.integrate({ frameId: entry.record.frameId, source, segment, geometry: geometryKeyOf(metadata), ...(pins.length > 0 && { calibration }), budget })
			session.summary = { ...session.summary, retainedBytes: result.retainedBytes }
			this.#settle(session, result.outcomes, entry)
		} finally {
			release()
		}
	}

	// Applies the outcomes of the engine: the frame being integrated, and the held candidates it settled.
	#settle(session: Session, outcomes: readonly LiveEngineOutcome[], current?: FrameEntry) {
		for (const outcome of outcomes) {
			const entry = current?.record.frameId === outcome.frameId ? current : session.held.get(outcome.frameId)
			if (!entry) continue
			const wasHeld = session.held.delete(outcome.frameId)

			if (outcome.status === 'held') {
				session.held.set(outcome.frameId, entry)
				session.counters.processing--
				session.counters.held++
				entry.record = { ...entry.record, outcome: 'held', measurement: outcome.measurement }
				continue
			}

			if (outcome.status === 'rejected') {
				this.#finish(session, entry, { outcome: 'rejected', reason: outcome.reason, detail: outcome.detail, ...(outcome.measurement && { measurement: outcome.measurement }) }, !wasHeld)
				continue
			}

			const route = entry.route!

			if (outcome.newField) {
				const { width, height, channels } = route.metadata
				session.fields.push({ fieldId: outcome.fieldId, index: session.fields.length + 1, width, height, channels, createdAt: Date.now(), referenceFrameId: outcome.frameId })
				session.summary = { ...session.summary, newFieldRequested: false }
			}

			this.#accept(session, outcome.cohortId, outcome.fieldId, route, entry.record.temperature)
			this.#finish(session, entry, { outcome: 'accepted', fieldId: outcome.fieldId, cohortId: outcome.cohortId, measurement: outcome.measurement, registration: outcome.registration, overlap: outcome.overlap, weight: outcome.weight, scale: outcome.scale }, !wasHeld)
		}
	}

	// Counts an accepted frame into its cohort, creating the cohort with its first frame.
	#accept(session: Session, cohortId: string, fieldId: string, route: FrameRoute, temperature: number | undefined) {
		const now = Date.now()
		const exposure = (route.metadata.exposure.value ?? 0) / 1000000
		const cohort = session.cohorts.get(cohortId)

		if (!cohort) {
			session.cohortMetadata.set(cohortId, route.metadata)
			session.cohorts.set(cohortId, {
				cohortId,
				fieldId,
				filter: route.filter,
				acquisition: acquisitionOf(route.metadata),
				...(route.calibration && { calibration: route.calibration }),
				accepted: 1,
				exposure,
				...(temperature !== undefined && { temperature: [temperature, temperature] }),
				startedAt: now,
				updatedAt: now,
			})
			return
		}

		const range = temperature === undefined ? cohort.temperature : cohort.temperature ? ([Math.min(cohort.temperature[0], temperature), Math.max(cohort.temperature[1], temperature)] as const) : ([temperature, temperature] as const)
		session.cohorts.set(cohortId, { ...cohort, accepted: cohort.accepted + 1, exposure: cohort.exposure + exposure, ...(range && { temperature: range }), updatedAt: now })
	}

	// Gives a frame its final outcome and moves it into the history. processing says it was being integrated, otherwise
	// it was queued or held.
	#finish(session: Session, entry: FrameEntry, patch: Partial<LiveStackingFrame> & Pick<LiveStackingFrame, 'outcome'>, processing = false) {
		if (processing) session.counters.processing--
		else if (entry.record.outcome === 'held') session.counters.held--
		else session.counters.queued--

		entry.bytes = undefined
		entry.record = { ...entry.record, ...patch, elapsed: Date.now() - entry.arrivedAt }
		session.counters[patch.outcome === 'accepted' ? 'accepted' : patch.outcome === 'rejected' ? 'rejected' : patch.outcome === 'skipped' ? 'skipped' : 'deliveryFailed']++
		session.history.push(entry.record)
		if (session.history.length > FRAME_HISTORY) session.history.splice(0, session.history.length - FRAME_HISTORY)
		this.#publish(session)
	}

	// Ends a stopping session once its admitted frames were integrated: held candidates are rejected.
	async #stopped(session: Session) {
		try {
			const result = await session.processor.flush()
			this.#settle(session, result.outcomes)
			session.summary = { ...session.summary, retainedBytes: result.retainedBytes }
		} catch (error) {
			if (error instanceof LiveWorkerFailure) return this.#fail(session, undefined, error.message)
			throw error
		}

		session.phase = 'stopped'
		session.summary = { ...session.summary, endedAt: Date.now() }
		this.#release(session)
		this.#publish(session)
	}

	// Fails a session whose worker failed: its stacks are lost, its frames fail, and its captures go on.
	#fail(session: Session, current: FrameEntry | undefined, message: string) {
		if (session.phase === 'failed') return
		session.phase = 'failed'
		if (current) this.#finish(session, current, { outcome: 'deliveryFailed', reason: 'workerFailed', detail: message }, true)
		for (const entry of session.queue.splice(0)) this.#finish(session, entry, { outcome: 'deliveryFailed', reason: 'workerFailed', detail: message })
		for (const entry of session.held.values()) this.#finish(session, entry, { outcome: 'deliveryFailed', reason: 'workerFailed', detail: message })
		session.held.clear()
		session.summary = { ...session.summary, error: message, endedAt: Date.now(), retainedBytes: 0 }
		session.processor[Symbol.dispose]()
		this.#closeViews(session)
		this.#release(session)
		this.#publish(session)
	}

	// Calls the processor of a session, failing the session when its worker failed, and answering a refusal as a request
	// error.
	async #call<T>(session: Session, call: () => Promise<T>): Promise<T> {
		if (session.phase === 'failed') throw new LiveStackingError('The stacks of the session were lost', 409, 'workerFailed')

		try {
			return await call()
		} catch (error) {
			if (error instanceof LiveWorkerFailure) {
				this.#fail(session, undefined, error.message)
				throw new LiveStackingError(error.message, 500, 'workerFailed')
			}

			if (error instanceof LiveEngineError) throw new LiveStackingError(error.message, 422, 'incompatibleFrame')
			throw error
		}
	}

	// Returns the revision of a view: the accepted frames of the stacks it shows.
	#viewRevision(session: Session, target: LiveStackingViewTarget) {
		const cohorts = 'cohortId' in target ? [target.cohortId] : target.composition.sources.map((source) => source.cohortId)
		let revision = 0

		for (const cohortId of cohorts) {
			const cohort = session.cohorts.get(cohortId)
			if (!cohort) throw new LiveStackingError('The stack is unknown', 404, 'notFound')
			revision += cohort.accepted
		}

		return revision
	}

	// Takes a snapshot of a view as a derived document, closing the oldest documents of the session beyond its limit.
	async #takeView(session: Session, key: string, target: LiveStackingViewTarget, revision: number): Promise<LiveStackingView> {
		const snapshot: LiveSnapshot | undefined = await this.#call(session, () => ('cohortId' in target ? session.processor.snapshot(target.cohortId) : session.processor.compose(target.composition)))
		if (!snapshot) throw new LiveStackingError('The stack has no frame', 404, 'notFound')
		const sourceName = 'cohortId' in target ? (session.cohorts.get(target.cohortId)?.filter ?? 'Stack') : target.composition.preset
		const info = await this.images.adopt(snapshot.image, { kind: 'liveStacking', sessionId: session.summary.sessionId, sourceName, frames: snapshot.frames, createdAt: new Date().toISOString() })
		const view: LiveStackingView = { info, revision, frames: snapshot.frames }

		const index = session.views.findIndex((cached) => cached.key === key)
		if (index >= 0) this.images.close(session.views.splice(index, 1)[0].view.info.id)
		session.views.push({ key, view, takenAt: Date.now() })
		while (session.views.length > MAX_VIEW_DOCUMENTS) this.images.close(session.views.shift()!.view.info.id)
		return view
	}

	// Closes the snapshot documents of a session.
	#closeViews(session: Session) {
		for (const cached of session.views.splice(0)) this.images.close(cached.view.info.id)
	}

	// Builds the header of an export: the header of the first frame of its first stack, the frames, exposure, method, and
	// masters it integrates, and the grid convention.
	#exportHeader(session: Session, target: LiveExportTarget, stacks: readonly LiveStackingCohort[], metadata: CalibrationMetadata, name: string, frames: number, exposure: number): FitsHeader {
		const each = stacks.length === 1 ? stacks[0].acquisition.exposure : undefined
		const header = productHeader(metadata, name, frames, { ...(each !== undefined && { each }), total: exposure })
		const { recipe } = session.summary
		if ('composition' in target) delete header.FILTER

		const history = [
			`Linear live stack of ${frames} accepted light frames on the grid of its field; NaN marks pixels no frame covered`,
			`Live stacking: ${recipe.method}${recipe.method === 'weighted-average' ? ` (${recipe.weighting})` : ''}, ${recipe.normalization} normalization, ${recipe.interpolation} resampling`,
			...stacks.map(
				(cohort) =>
					`Stack ${cohort.filter}: ${cohort.accepted} frames, ${cohort.exposure} s, ${cohort.calibration ? LIVE_MASTER_KINDS.flatMap((kind) => (cohort.calibration?.[kind] ? [`${kind} #${cohort.calibration[kind].masterId} ${cohort.calibration[kind].digest.slice(0, 16)}`] : [])).join(', ') : 'uncalibrated'}`,
			),
		]

		header.HISTORY = history.join('\n')
		return header
	}

	// Returns a product with the paths of its files.
	#detail(product: LiveStackingProduct): LiveStackingProductDetail {
		const directory = this.store.productDirectory(product.productId)
		return { ...product, path: join(directory, LIVE_PRODUCT_FILE), ...(product.coverageDigest !== undefined && { coveragePath: join(directory, LIVE_COVERAGE_FILE) }) }
	}

	// Finishes the products a crash left being published or deleted, sets aside unknown directories, and clears staging.
	async #recoverProducts() {
		for (const { product, publication } of this.store.pendingProducts()) {
			const { productId } = product
			const path = join(this.store.productDirectory(productId), LIVE_PRODUCT_FILE)

			try {
				if (publication === 'publishing' && (await stat(path).catch(() => undefined))?.size === product.bytes && (await fileDigest(path)) === product.contentDigest) {
					this.store.setPublication(productId, 'published')
				} else {
					await rm(this.store.productDirectory(productId), { recursive: true, force: true })
					this.store.discardProduct(productId)
				}
			} catch (error) {
				console.error('live stacking: unable to finish product', productId, error)
			}
		}

		for (const name of await this.store.productDirectories()) {
			if (this.store.hasProduct(name)) continue
			const target = join(this.store.orphanedDirectory, `${name}-${crypto.randomUUID()}`)

			try {
				await mkdir(this.store.orphanedDirectory, { recursive: true })
				await rename(this.store.productDirectory(name), target)
				console.warn(`live stacking: ${name} has no record and was moved to ${target}`)
			} catch (error) {
				console.error('live stacking: unable to move an orphaned product', name, error)
			}
		}

		await this.store.clearStaging()
	}

	// Closes a session: its worker, gates, and snapshots are released. published says whether tabs are told.
	#close(session: Session, published = true) {
		this.#sessions.delete(session.summary.sessionId)
		if (session.phase !== 'stopped' && session.phase !== 'failed') session.phase = 'stopped'
		session.processor[Symbol.dispose]()
		this.#closeViews(session)
		this.#release(session)
		if (published) this.listener({ type: 'liveStacking:closed', epoch: this.epoch, revision: ++this.#revision, sessionId: session.summary.sessionId })
	}

	// Returns the session of a camera.
	#cameraSession(connectionId: string, deviceId: string) {
		for (const session of this.#sessions.values()) if (session.summary.connectionId === connectionId && session.summary.deviceId === deviceId) return session
		return undefined
	}

	// Returns a session by id. Throws notFound.
	#session(sessionId: string) {
		const session = this.#sessions.get(sessionId)
		if (!session) throw new LiveStackingError('Live Stacking session not found', 404, 'notFound')
		return session
	}

	// Memory every session retains, with the preview-only frames they queue.
	#memoryUsed() {
		let bytes = 0

		for (const session of this.#sessions.values()) {
			bytes += session.summary.retainedBytes
			for (const entry of session.queue) bytes += entry.bytes?.byteLength ?? 0
		}

		return bytes
	}

	// Returns the published state of a session.
	#summary(session: Session): LiveStackingSession {
		const state: LiveStackingState = session.phase === 'active' ? (session.current ? 'processing' : 'waiting') : session.phase
		let backlogBytes = 0
		for (const entry of session.queue) backlogBytes += entry.bytes?.byteLength ?? 0
		return { ...session.summary, state, counters: { ...session.counters }, backlogBytes, fields: [...session.fields], cohorts: [...session.cohorts.values()] }
	}

	// Publishes a changed session and returns its state.
	#publish(session: Session) {
		session.summary = { ...session.summary, revision: session.summary.revision + 1 }
		const summary = this.#summary(session)
		if (this.#sessions.get(session.summary.sessionId) === session) this.listener({ type: 'liveStacking:updated', epoch: this.epoch, revision: ++this.#revision, session: summary })
		return summary
	}
}

// Answers a failure of a route with its status and code.
function failure(error: unknown) {
	if (error instanceof LiveStackingError) return errorResponse(error.message, error.status, error.code)
	return errorResponse(Error.isError(error) ? error.message : String(error), 500, 'workerFailed')
}

// Runs a handler, answering its result as JSON.
async function answer(handler: () => unknown, status = 200) {
	try {
		return Response.json(await handler(), { status })
	} catch (error) {
		return failure(error)
	}
}

// Routes of Live Stacking. A session is started on its camera and addressed by its id afterwards; none commands a device.
export function createLiveStackingRoutes(stacking: LiveStacking) {
	return {
		'/api/live-stacking': {
			// Every session, the epoch of the service, and the memory in use.
			GET: () => Response.json(stacking.snapshot()),
		},
		'/api/connections/:id/cameras/:deviceId/live-stacking': {
			// Starts the session of a camera: 201 when started, 200 for the session the same token started.
			POST: async (req) => {
				try {
					const { session, created } = stacking.start(req.params.id, req.params.deviceId, (await req.json()) as LiveStackingStartRequest)
					return Response.json(session, { status: created ? 201 : 200 })
				} catch (error) {
					return failure(error)
				}
			},
		},
		'/api/live-stacking/sessions/:sessionId': {
			GET: (req) => answer(() => stacking.session(req.params.sessionId)),
			// Closes a stopped or failed session.
			DELETE: (req) =>
				answer(() => {
					stacking.close(req.params.sessionId)
					return { closed: true }
				}),
		},
		'/api/live-stacking/sessions/:sessionId/pause': { POST: (req) => answer(() => stacking.pause(req.params.sessionId)) },
		'/api/live-stacking/sessions/:sessionId/resume': { POST: (req) => answer(() => stacking.resume(req.params.sessionId)) },
		'/api/live-stacking/sessions/:sessionId/stop': { POST: (req) => answer(() => stacking.stop(req.params.sessionId)) },
		'/api/live-stacking/sessions/:sessionId/abort': { POST: (req) => answer(() => stacking.abort(req.params.sessionId)) },
		'/api/live-stacking/sessions/:sessionId/reset': { POST: (req) => answer(() => stacking.reset(req.params.sessionId)) },
		'/api/live-stacking/sessions/:sessionId/fields': { POST: (req) => answer(() => stacking.startNewField(req.params.sessionId)) },
		'/api/live-stacking/sessions/:sessionId/calibration': {
			PUT: (req) => answer(async () => stacking.setCalibration(req.params.sessionId, (await req.json()) as LiveStackingCalibration)),
		},
		'/api/live-stacking/sessions/:sessionId/frames': {
			// Frame outcomes, newest first; ?before= the next cursor of the previous page, &limit=.
			GET: (req) =>
				answer(() => {
					const { searchParams } = new URL(req.url)
					const before = searchParams.get('before')
					return stacking.frames(req.params.sessionId, before === null ? undefined : Number(before), Number(searchParams.get('limit')) || undefined)
				}),
		},
		'/api/live-stacking/sessions/:sessionId/views': {
			// A snapshot of a stack or a composition as a derived document of the image store.
			POST: (req) => answer(async () => stacking.view(req.params.sessionId, (await req.json()) as LiveStackingViewTarget)),
		},
		'/api/live-stacking/sessions/:sessionId/exports': {
			// Saves a stack or a composition as a product.
			POST: (req) => answer(async () => stacking.export(req.params.sessionId, (await req.json()) as LiveExportTarget), 201),
		},
		'/api/live-stacking/products': {
			GET: () => answer(() => stacking.products()),
		},
		'/api/live-stacking/products/:productId': {
			GET: (req) => answer(() => stacking.product(req.params.productId)),
			DELETE: (req) =>
				answer(async () => {
					await stacking.deleteProduct(req.params.productId)
					return { deleted: true }
				}),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
