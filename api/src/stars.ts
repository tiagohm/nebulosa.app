import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { AstapError, astapDetectStars } from 'nebulosa/src/astrometry/solvers/astap'
import type { Image } from 'nebulosa/src/imaging/model/types'
import type { DetectedStar, DetectStarOptions } from 'nebulosa/src/imaging/stars/detector'
import { medianOf } from 'nebulosa/src/math/numerical/statistics'
import { type AnalysisCompletion, type AnalysisEntry, type AnalysisJob, type AnalysisJobState, AnalysisScheduler } from './analysis'
import type { ExternalToolConfig, ExternalToolsStore } from './externaltools'
import type { DocumentSize, ImageStore } from './images'

// Star detection service shared by every consumer: manual runs of the Images workspace and the measurements of
// Auto Focus. A detection measures an image
// document of the image store, addressed by its id (a document never changes, so the id is its scientific
// identity), with one of two providers: the toolkit's detectStars on a worker thread of its own
// (stars.worker.ts), fed a grayscale copy of the decoded pixels, or ASTAP, run on a FITS copy of the
// document written into a directory of its own, with the executable and timeout of the External Tools
// settings resolved once per job (or once per Auto Focus session). Both give the toolkit's DetectedStar, in
// 0-based pixel coordinates of the image (origin at the upper-left sample, +X right, +Y down, integers at
// pixel centres); their HFDs, in pixels, are computed differently and are not comparable with each other.
//
// Jobs run in memory under the shared analysis scheduling (analysis.ts): one built-in detection and one ASTAP
// process at a time, at most MAX_QUEUED jobs waiting, in arrival order. A job retains its image until it ends, so
// closing the document never
// pulls the pixels from under it. Results are kept only in memory, keyed by job and grouped by image, until
// their image is released or the bounded store evicts them; they never survive a restart. Every change of
// a job is published as a compact stars:updated event without the stars, which are fetched on demand. No
// device is held: a detection only reads pixels.

// Star detector of a job.
export type StarDetectorProvider = 'builtin' | 'astap'

// Settings of the built-in detector (the toolkit's detectStars).
export interface BuiltinStarDetectionSettings {
	readonly provider: 'builtin'
	// Maximum number of stars kept, brightest first; the detector returns at most BUILTIN_STAR_LIMIT.
	readonly maxStars: number
	// Minimum SNR a detection must reach to be kept.
	readonly minSNR: number
	// Side of the uniqueness box of the detector, in pixels: pairs of stars of similar brightness closer
	// than it are removed; 0 disables the filter.
	readonly searchRegion: number
	// Largest signal-aperture radius, in pixels: above STAR_SIGNAL_RADIUS (4) the aperture grows to measure
	// defocused stars, such as the frames of an Auto Focus, whose HFD the fixed aperture saturates; absent keeps
	// the fixed aperture.
	readonly maximumRadius?: number
}

// Settings of ASTAP's star extraction.
export interface AstapStarDetectionSettings {
	readonly provider: 'astap'
	// Maximum number of stars kept, highest SNR first; 0 keeps all.
	readonly maxStars: number
	// Minimum SNR passed to ASTAP's -extract.
	readonly minSNR: number
}

// Settings of the detector of a job, by provider.
export type StarDetectionSettings = BuiltinStarDetectionSettings | AstapStarDetectionSettings

// Criteria a detected star must meet to enter the aggregate HFD. Saturation is not checked: a DetectedStar
// carries nothing that tells a saturated star apart.
export interface StarAcceptance {
	// Minimum SNR; 0 accepts any positive SNR.
	readonly minSNR: number
	// Minimum HFD, in pixels; 0 accepts any positive HFD.
	readonly minHfd: number
	// Maximum HFD, in pixels; 0 sets no upper limit.
	readonly maxHfd: number
	// Width of the border, in pixels, whose stars are rejected; 0 rejects only stars outside the image.
	readonly edgeMargin: number
}

// What a job measures and how.
export interface StarDetectionRequest {
	// Detector and its settings.
	readonly detector: StarDetectionSettings
	// Criteria of the accepted stars.
	readonly acceptance: StarAcceptance
}

// Who asked for a job: a person (manual), or the measurement of an Auto Focus frame.
export type StarDetectionOrigin =
	| { readonly kind: 'manual' }
	| {
			readonly kind: 'autofocus'
			// Id of the Auto Focus session.
			readonly sessionId: string
			// Id of the open connection that provides the camera.
			readonly connectionId: string
			// Exact id of the camera.
			readonly deviceId: string
			// Identity of the frame: the session id and the capture ordinal.
			readonly frameId: string
			// Auxiliary frame number within the session, from 1.
			readonly capture: number
	  }

// State of a job: waiting for its detector, running, or ended (completed, failed, or cancelled).
export type StarDetectionJobState = AnalysisJobState

// Why a job did not complete:
// - queueFull: too many jobs were waiting when it was submitted.
// - workerFailed: the built-in detector failed or its worker died.
// - astapUnavailable: ASTAP is not configured, or its executable could not be started.
// - astapTimeout: ASTAP ran longer than its timeout and was killed.
// - astapFailed: ASTAP ended without a readable star list.
// - timeout: the built-in detection ran longer than BUILTIN_TIMEOUT.
// - invalidImage: the image could not be prepared for the detector.
// - cancelled: the job was cancelled.
// - expired: the image was released before the job could read it, or the result is no longer kept.
export type StarDetectionErrorCode = 'queueFull' | 'workerFailed' | 'astapUnavailable' | 'astapTimeout' | 'astapFailed' | 'timeout' | 'invalidImage' | 'cancelled' | 'expired'

// Outcome of the aggregate HFD of a completed job: measured, no star detected at all, or too few stars
// accepted for a median (fewer than MIN_AGGREGATE_STARS), which is never reported as an HFD of 0.
export type StarMeasurement = 'ok' | 'noStars' | 'unavailable'

// Counts and metric of a completed job.
export interface StarDetectionSummary {
	// Stars the detector returned.
	readonly detectedCount: number
	// Stars meeting the acceptance criteria.
	readonly acceptedCount: number
	// Median HFD of the accepted stars, in pixels; absent unless measurement is ok.
	readonly aggregateHfd?: number
	// Outcome of the aggregate HFD.
	readonly measurement: StarMeasurement
	// Time the job ran, from preparing the image to the measured result, in milliseconds.
	readonly elapsed: number
}

// A star detection job as published to clients; never carries the stars.
export interface StarDetectionJob extends AnalysisJob {
	// Id of the job.
	readonly jobId: string
	// Id of the image document measured.
	readonly imageId: string
	// Who asked for it.
	readonly origin: StarDetectionOrigin
	// What it measures and how.
	readonly request: StarDetectionRequest
	// State of the job.
	readonly state: StarDetectionJobState
	// When it was submitted, Unix milliseconds (UTC).
	readonly queuedAt: number
	// When it started running, Unix milliseconds (UTC).
	readonly startedAt?: number
	// When it ended, Unix milliseconds (UTC).
	readonly endedAt?: number
	// Why it did not complete, when it failed or was cancelled.
	readonly code?: StarDetectionErrorCode
	// Detail of the failure meant for people.
	readonly error?: string
	// Counts and metric, once completed.
	readonly summary?: StarDetectionSummary
}

// Full result of a completed job.
export interface StarDetectionResult extends StarDetectionSummary {
	// Id of the job.
	readonly jobId: string
	// Id of the image document measured.
	readonly imageId: string
	// What was measured and how.
	readonly request: StarDetectionRequest
	// Settings ASTAP ran with, for an ASTAP job.
	readonly tool?: Readonly<ExternalToolConfig>
	// Width of the image, in pixels.
	readonly width: number
	// Height of the image, in pixels.
	readonly height: number
	// Stars in the order of the detector (brightest first for the built-in one).
	readonly stars: readonly DetectedStar[]
	// Whether each star, by index in stars, meets the acceptance criteria.
	readonly accepted: readonly boolean[]
	// Time the job waited before running, in milliseconds.
	readonly queueTime: number
	// Conditions worth knowing about the result, meant for people.
	readonly warnings: readonly string[]
}

// Snapshot of GET /api/stars: the jobs waiting or running, and the latest ended ones.
export interface StarDetectionSnapshot {
	// Jobs, oldest first.
	readonly jobs: readonly StarDetectionJob[]
}

// Notification published whenever a job changes.
export interface StarDetectionEvent {
	readonly type: 'stars:updated'
	// New state of the job.
	readonly job: StarDetectionJob
}

// Receiver of star detection events.
export type StarDetectionListener = (event: StarDetectionEvent) => void

// Request to the built-in detector worker: the grayscale image it owns from now on.
export interface StarWorkerRequest {
	// Id of the job, echoed by the response.
	readonly jobId: string
	// Grayscale image without a Bayer pattern.
	readonly image: Image
	// Options of detectStars.
	readonly options: Partial<DetectStarOptions>
}

// Response of the built-in detector worker.
export type StarWorkerResponse = { readonly jobId: string; readonly status: 'detected'; readonly stars: DetectedStar[] } | { readonly jobId: string; readonly status: 'failed'; readonly error: string }

// Request whose provider settings were resolved, ready to be submitted: ASTAP's settings are a snapshot
// taken when it was prepared, so a later save of the External Tools settings applies to later preparations.
export interface StarDetectionPreparation {
	// What to measure and how.
	readonly request: StarDetectionRequest
	// Settings ASTAP runs with, for an ASTAP request.
	readonly tool?: Readonly<ExternalToolConfig>
}

// Outcome of a manual submission: a new job, the completed job of an equivalent earlier request of the
// same image (cached), or why there is none.
export type StarDetectionSubmitOutcome = { readonly status: 'accepted'; readonly job: StarDetectionJob } | { readonly status: 'cached'; readonly job: StarDetectionJob } | { readonly status: 'missing' } | { readonly status: 'astapUnavailable' } | { readonly status: 'queueFull' }

// Error of a job that did not complete, with its reason.
export class StarDetectionError extends Error {
	// Creates the error of a reason.
	constructor(
		readonly code: StarDetectionErrorCode,
		message: string,
	) {
		super(message)
	}
}

// Defaults of the built-in detector: the 500 brightest stars, any SNR, no uniqueness filter.
export const DEFAULT_BUILTIN_SETTINGS: BuiltinStarDetectionSettings = { provider: 'builtin', maxStars: 500, minSNR: 0, searchRegion: 0 }

// Defaults of ASTAP: every star of SNR 10 or more, ASTAP's own default extraction threshold.
export const DEFAULT_ASTAP_SETTINGS: AstapStarDetectionSettings = { provider: 'astap', maxStars: 0, minSNR: 10 }

// Acceptance of every star with finite, positive measurements inside the image.
export const DEFAULT_STAR_ACCEPTANCE: StarAcceptance = { minSNR: 0, minHfd: 0, maxHfd: 0, edgeMargin: 0 }

// Origin of a detection a person asked for.
const MANUAL_ORIGIN: StarDetectionOrigin = { kind: 'manual' }

export { MAX_QUEUED } from './analysis'

// Most stars the built-in detector returns, whatever maxStars asks for (the capacity of its star list).
export const BUILTIN_STAR_LIMIT = 2000

// Fewest accepted stars an aggregate HFD is computed from: below three, a median is one or two stars.
export const MIN_AGGREGATE_STARS = 3

// Built-in detections running at once, one worker each: a detection holds two copies of the image plus
// integral images of 16 bytes per pixel, so a large frame costs hundreds of megabytes while it runs.
const BUILTIN_CONCURRENCY = 1

// ASTAP processes running at once; each one is a full multithreaded process with a FITS copy on disk.
const ASTAP_CONCURRENCY = 1

// Time a built-in detection may run, in milliseconds, before its worker is terminated.
const BUILTIN_TIMEOUT = 120000

// Whether a star meets the acceptance criteria inside an image of width × height pixels: finite
// coordinates within the pixel area of the image less the edge margin ([-0.5, width - 0.5) since pixel
// centres are integers), a finite positive HFD within the limits, a finite positive SNR of at least
// minSNR, and a finite positive flux.
export function isAcceptedStar({ x, y, hfd, snr, flux }: DetectedStar, width: number, height: number, { minSNR, minHfd, maxHfd, edgeMargin }: StarAcceptance): boolean {
	const low = edgeMargin - 0.5
	if (!(x >= low && x < width - 0.5 - edgeMargin && y >= low && y < height - 0.5 - edgeMargin)) return false
	if (!(Number.isFinite(hfd) && hfd > 0 && hfd >= minHfd && (maxHfd <= 0 || hfd <= maxHfd))) return false
	if (!(Number.isFinite(snr) && snr > 0 && snr >= minSNR)) return false
	return Number.isFinite(flux) && flux > 0
}

// Returns whether each star meets the acceptance criteria (see isAcceptedStar), by index.
export function acceptStars(stars: readonly DetectedStar[], width: number, height: number, acceptance: StarAcceptance): boolean[] {
	return stars.map((star) => isAcceptedStar(star, width, height, acceptance))
}

// Returns the aggregate HFD of the accepted stars, in pixels: the median of their HFDs (the mean of the two
// middle ones for an even count), robust to a few outliers such as a double star; undefined with fewer
// than MIN_AGGREGATE_STARS accepted stars.
export function aggregateHfd(stars: readonly DetectedStar[], accepted: readonly boolean[]): number | undefined {
	const hfds: number[] = []
	for (let i = 0; i < stars.length; i++) if (accepted[i]) hfds.push(stars[i].hfd)
	if (hfds.length < MIN_AGGREGATE_STARS) return undefined
	hfds.sort((a, b) => a - b)
	return medianOf(hfds)
}

// Returns the key of an equivalent detection: the same image, detector settings, acceptance criteria, and
// ASTAP executable. The timeout is left out, since it does not change a result.
export function cacheKey(imageId: string, { detector, acceptance }: StarDetectionRequest, tool?: Readonly<ExternalToolConfig>): string {
	const settings = detector.provider === 'builtin' ? [detector.provider, detector.maxStars, detector.minSNR, detector.searchRegion, detector.maximumRadius] : [detector.provider, detector.maxStars, detector.minSNR, tool?.executable]
	return JSON.stringify([imageId, settings, acceptance.minSNR, acceptance.minHfd, acceptance.maxHfd, acceptance.edgeMargin])
}

// Worker thread of the built-in detector. `unref` is a Bun extension that the DOM Worker type lacks.
type StarWorker = Worker & Pick<Bun.Worker, 'unref'>

// A job of the service while it waits or runs, with its scheduling state.
type JobEntry = AnalysisEntry<StarDetectionJob, StarDetectionPreparation>

// Star detection jobs of the server, their scheduling (see analysis.ts), and their results.
export class StarDetectionService {
	// Queue, limits, reservations, and kept results.
	readonly #scheduler: AnalysisScheduler<StarDetectionJob, StarDetectionResult, StarDetectionPreparation, StarDetectorProvider>
	// Idle built-in workers.
	readonly #idle: StarWorker[] = []

	// Creates the service over the image store and the External Tools settings, publishing every job change
	// to listener. The results of an image are dropped when the store releases it.
	constructor(
		readonly images: ImageStore,
		readonly tools: ExternalToolsStore,
		readonly listener: StarDetectionListener,
	) {
		this.#scheduler = new AnalysisScheduler<StarDetectionJob, StarDetectionResult, StarDetectionPreparation, StarDetectorProvider>(images, {
			limits: { builtin: BUILTIN_CONCURRENCY, astap: ASTAP_CONCURRENCY },
			provider: (preparation) => preparation.request.detector.provider,
			execute: (entry) => this.#execute(entry),
			failed: (entry, error) => {
				if (entry.controller.signal.aborted) return { state: 'cancelled', code: 'cancelled', error: 'The star detection was cancelled' }
				if (error instanceof StarDetectionError) return { state: 'failed', code: error.code, error: error.message }
				return { state: 'failed', code: 'invalidImage', error: Error.isError(error) ? error.message : String(error) }
			},
			cancelled: () => ({ code: 'cancelled', error: 'The star detection was cancelled' }),
			publish: (job) => this.listener({ type: 'stars:updated', job }),
		})
	}

	// Resolves the provider settings of a request: ASTAP's executable and timeout are read once, here. Resolves
	// to undefined when the request uses ASTAP and it is not configured.
	async prepare(request: StarDetectionRequest): Promise<StarDetectionPreparation | undefined> {
		if (request.detector.provider === 'builtin') return { request }
		const tool = await this.tools.resolve('astap')
		return tool && { request, tool }
	}

	// Submits a detection of an open image with the manual priority, as origin (manual by default). An
	// equivalent completed detection of the same image is answered instead of running again (cached).
	// A preparation, resolved earlier by prepare, keeps the ASTAP settings it captured instead of reading them again.
	async submit(imageId: string, request: StarDetectionRequest | StarDetectionPreparation, origin: StarDetectionOrigin = MANUAL_ORIGIN): Promise<StarDetectionSubmitOutcome> {
		const preparation = 'detector' in request ? await this.prepare(request) : request
		if (!preparation) return { status: 'astapUnavailable' }
		if (this.images.name(imageId) === undefined) return { status: 'missing' }

		const key = cacheKey(imageId, preparation.request, preparation.tool)
		const cached = this.#scheduler.cached(imageId, key)
		if (cached) return { status: 'cached', job: cached.job }
		if (this.#scheduler.full()) return { status: 'queueFull' }

		const job = this.#scheduler.enqueue(imageId, preparation, key, { origin, request: preparation.request })
		return job ? { status: 'accepted', job } : { status: 'missing' }
	}

	// Detects the stars of an open image and resolves to the result once the job completed, for a consumer
	// that needs the measurement of one specific image, such as an Auto Focus step: the job runs with the
	// manual priority and is never replaced by a newer frame. Aborting signal cancels the job. Throws
	// StarDetectionError when the job does not complete. origin names the requester, manual by default; a
	// preparation keeps the ASTAP settings of a whole session, as submit does.
	async measure(imageId: string, request: StarDetectionRequest | StarDetectionPreparation, signal?: AbortSignal, origin?: StarDetectionOrigin): Promise<StarDetectionResult> {
		const outcome = await this.submit(imageId, request, origin)
		if (outcome.status === 'missing') throw new StarDetectionError('expired', 'The image is not open')
		if (outcome.status === 'astapUnavailable') throw new StarDetectionError('astapUnavailable', 'ASTAP is not configured')
		if (outcome.status === 'queueFull') throw new StarDetectionError('queueFull', 'Too many star detections are waiting')

		const { jobId } = outcome.job
		const stored = this.#scheduler.stored(jobId)
		if (outcome.status === 'cached' && stored) return stored.result

		const settled = this.#scheduler.settled(jobId)
		const entry = this.#scheduler.entry(jobId)
		if (!settled || !entry) throw new StarDetectionError('expired', 'The result is no longer kept')

		const cancel = () => this.cancel(jobId)
		// The signal may have aborted while the request was being submitted.
		if (signal?.aborted) cancel()
		else signal?.addEventListener('abort', cancel, { once: true })

		try {
			const result = await settled
			if (result) return result
			const { code = 'cancelled', error = 'The star detection did not complete' } = entry.job
			throw new StarDetectionError(code, error)
		} finally {
			signal?.removeEventListener('abort', cancel)
		}
	}

	// Cancels a job: a waiting one ends at once, a running one is interrupted (the built-in worker is
	// terminated, ASTAP is killed). Returns false when the job is not waiting or running.
	cancel(jobId: string): boolean {
		return this.#scheduler.cancel(jobId)
	}

	// Returns a job waiting, running, recently ended, or completed with its result kept.
	job(jobId: string): StarDetectionJob | undefined {
		return this.#scheduler.job(jobId)
	}

	// Returns the result of a completed job while it is kept.
	result(jobId: string): StarDetectionResult | undefined {
		return this.#scheduler.result(jobId)
	}

	// Returns the completed jobs of an image whose results are kept, oldest first.
	results(imageId: string): StarDetectionJob[] {
		return this.#scheduler.results(imageId)
	}

	// Returns the jobs waiting or running and the latest ended ones, oldest first.
	snapshot(): StarDetectionSnapshot {
		return { jobs: this.#scheduler.snapshot() }
	}

	// Runs a job with its provider and measures the stars it found.
	async #execute(entry: JobEntry): Promise<AnalysisCompletion<StarDetectionJob, StarDetectionResult>> {
		const stars = entry.preparation.request.detector.provider === 'builtin' ? await this.#detectBuiltin(entry) : await this.#detectAstap(entry)
		return this.#complete(entry, stars)
	}

	// Detects the stars of a job with the built-in detector on a worker. Throws StarDetectionError.
	async #detectBuiltin(entry: JobEntry): Promise<DetectedStar[]> {
		const detector = entry.preparation.request.detector as BuiltinStarDetectionSettings
		const image = await this.images.detectionImage(entry.job.imageId)
		if (!image) throw new StarDetectionError('expired', 'The image was released before it could be measured')
		if (entry.controller.signal.aborted) throw new StarDetectionError('cancelled', 'The star detection was cancelled')

		const worker = this.#idle.pop() ?? this.#startWorker()
		const { promise, resolve, reject } = Promise.withResolvers<DetectedStar[]>()
		const { signal } = entry.controller
		const { jobId } = entry.job
		let reusable = false

		const onMessage = (event: MessageEvent<StarWorkerResponse>) => {
			const response = event.data
			if (response.jobId !== jobId) return
			// A detection that threw leaves the worker usable; only a crash, a timeout, or a cancel does not.
			reusable = true
			if (response.status === 'detected') resolve(response.stars)
			else reject(new StarDetectionError('workerFailed', `The built-in detector failed: ${response.error}`))
		}

		const onError = (event: ErrorEvent) => reject(new StarDetectionError('workerFailed', `The built-in detector worker died: ${event.message}`))
		const onAbort = () => reject(new StarDetectionError('cancelled', 'The star detection was cancelled'))
		const timer = setTimeout(() => reject(new StarDetectionError('timeout', `The built-in detection did not finish within ${BUILTIN_TIMEOUT / 1000} s`)), BUILTIN_TIMEOUT)

		worker.addEventListener('message', onMessage)
		worker.addEventListener('error', onError)
		signal.addEventListener('abort', onAbort, { once: true })

		try {
			const options: Partial<DetectStarOptions> = { maxStars: detector.maxStars, minSNR: detector.minSNR, searchRegion: detector.searchRegion, ...(detector.maximumRadius !== undefined && { maximumRadius: detector.maximumRadius }) }
			worker.postMessage({ jobId, image, options } satisfies StarWorkerRequest, [image.raw.buffer])
			return await promise
		} finally {
			clearTimeout(timer)
			worker.removeEventListener('message', onMessage)
			worker.removeEventListener('error', onError)
			signal.removeEventListener('abort', onAbort)
			// The detection cannot be interrupted, so a worker still running one is terminated.
			if (reusable) this.#idle.push(worker)
			else worker.terminate()
		}
	}

	// Starts a built-in detector worker.
	#startWorker(): StarWorker {
		// The compiled executable defines the embedded path of the worker (see app/build.ts); elsewhere it is
		// resolved next to this module.
		const worker = new Worker(process.env.NEBULOSA_STAR_WORKER ?? new URL('./stars.worker.ts', import.meta.url)) as StarWorker
		// An idle worker must not keep the process alive on its own.
		worker.unref()
		return worker
	}

	// Detects the stars of a job with ASTAP on a FITS copy of the image, in a directory of its own removed
	// afterwards. Throws StarDetectionError.
	async #detectAstap(entry: JobEntry): Promise<DetectedStar[]> {
		const detector = entry.preparation.request.detector as AstapStarDetectionSettings
		const tool = entry.preparation.tool!
		const bytes = await this.images.detectionFile(entry.job.imageId)
		if (!bytes) throw new StarDetectionError('expired', 'The image was released before it could be measured')

		const directory = await mkdtemp(join(tmpdir(), 'nebulosa-stars-'))

		try {
			const input = join(directory, 'image.fits')
			await Bun.write(input, bytes)
			return await astapDetectStars(input, { executable: tool.executable, timeout: tool.timeout, minSNR: detector.minSNR, maxStars: detector.maxStars }, entry.controller.signal)
		} catch (error) {
			if (!(error instanceof AstapError)) throw error
			if (error.code === 'unavailable') throw new StarDetectionError('astapUnavailable', error.message)
			if (error.code === 'timeout') throw new StarDetectionError('astapTimeout', error.message)
			if (error.code === 'aborted') throw new StarDetectionError('cancelled', error.message)
			throw new StarDetectionError('astapFailed', error.message)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	}

	// Measures the stars of a completed job into its summary and full result.
	#complete(entry: JobEntry, stars: readonly DetectedStar[]): AnalysisCompletion<StarDetectionJob, StarDetectionResult> {
		const { request, tool } = entry.preparation
		const { width, height } = entry.size
		const accepted = acceptStars(stars, width, height, request.acceptance)
		let acceptedCount = 0
		for (const value of accepted) if (value) acceptedCount++
		const hfd = aggregateHfd(stars, accepted)
		const measurement: StarMeasurement = stars.length === 0 ? 'noStars' : hfd === undefined ? 'unavailable' : 'ok'
		const elapsed = performance.now() - entry.started!
		const queueTime = entry.job.startedAt! - entry.job.queuedAt
		const warnings: string[] = []

		if (request.detector.provider === 'builtin' && request.detector.maxStars > BUILTIN_STAR_LIMIT) warnings.push(`The built-in detector returns at most ${BUILTIN_STAR_LIMIT} stars.`)
		const limit = request.detector.provider === 'builtin' ? Math.min(request.detector.maxStars, BUILTIN_STAR_LIMIT) : request.detector.maxStars
		if (limit > 0 && stars.length >= limit) warnings.push('The star limit was reached: fainter stars were not measured.')
		if (measurement === 'unavailable') warnings.push(`Fewer than ${MIN_AGGREGATE_STARS} stars were accepted: no aggregate HFD.`)

		const summary: StarDetectionSummary = { detectedCount: stars.length, acceptedCount, ...(hfd !== undefined && { aggregateHfd: hfd }), measurement, elapsed }
		const result: StarDetectionResult = { ...summary, jobId: entry.job.jobId, imageId: entry.job.imageId, request, ...(tool && { tool }), width, height, stars, accepted, queueTime, warnings }
		return { patch: { summary }, result }
	}
}

// Responds with an error message, its code, and a status.
function errorResponse(message: string, code: StarDetectionErrorCode | 'notFound', status: number): Response {
	return Response.json({ error: message, code }, { status })
}

// Creates the star detection routes over a service.
export function createStarDetectionRoutes(service: StarDetectionService) {
	return {
		'/api/images/:id/stars': {
			// Completed jobs of an image whose results are kept, oldest first.
			GET: (req) => Response.json(service.results(req.params.id)),
			// Submits a manual detection (StarDetectionRequest) of an open image. Responds 202 with the queued job,
			// 200 with the completed job of an equivalent earlier detection, 404 when the image is not open, 422
			// when ASTAP is not configured, and 503 when too many jobs are waiting.
			POST: async (req) => {
				const outcome = await service.submit(req.params.id, (await req.json()) as StarDetectionRequest)
				if (outcome.status === 'missing') return errorResponse('Image not found', 'notFound', 404)
				if (outcome.status === 'astapUnavailable') return errorResponse('ASTAP is not configured; set it up in Settings → External Tools', 'astapUnavailable', 422)
				if (outcome.status === 'queueFull') return errorResponse('Too many star detections are waiting; try again later', 'queueFull', 503)
				return Response.json(outcome.job, { status: outcome.status === 'accepted' ? 202 : 200 })
			},
		},
		'/api/stars': {
			// Jobs waiting or running and the latest ended ones, for a tab that (re)connects.
			GET: () => Response.json(service.snapshot()),
		},
		'/api/stars/:jobId': {
			// A job; 404 when it is unknown or long forgotten.
			GET: (req) => {
				const job = service.job(req.params.jobId)
				return job ? Response.json(job) : errorResponse('Star detection not found', 'notFound', 404)
			},
		},
		'/api/stars/:jobId/result': {
			// The full result of a completed job; 404 with code expired when it is not kept (anymore).
			GET: (req) => {
				const result = service.result(req.params.jobId)
				return result ? Response.json(result) : errorResponse('The result is not available', 'expired', 404)
			},
		},
		'/api/stars/:jobId/cancel': {
			// Cancels a waiting or running job; the end arrives as a stars:updated event. 404 when it is neither.
			POST: (req) => new Response(null, { status: service.cancel(req.params.jobId) ? 204 : 404 }),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
