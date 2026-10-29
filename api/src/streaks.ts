import type { StreakClass, StreakClassification } from 'nebulosa/src/imaging/analysis/streak/classification.types'
import { DEFAULT_STREAK_DETECTION_OPTIONS, type Streak, type StreakDetectionOptions } from 'nebulosa/src/imaging/analysis/streak/types'
import type { Image } from 'nebulosa/src/imaging/model/types'
import type { DetectedStar } from 'nebulosa/src/imaging/stars/detector'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { type AnalysisCompletion, type AnalysisEntry, type AnalysisJob, type AnalysisJobState, AnalysisScheduler } from './analysis'
import { errorResponse } from './http'
import type { ImageStore } from './images'
import type { PlateSolvingService } from './platesolving'
import type { StarDetectionService } from './stars'

// Streak detection service of the Images workspace. A detection measures an image document of the image store,
// addressed by its id, with the toolkit's detectStreaks on a worker thread of its own (streaks.worker.ts), fed a full
// copy of the decoded samples in their own precision and layout: a mono, RGB, or trusted CFA image, never the
// debayered luminance copy Star Detection measures, so the analysis plane is a native one (mono, RGB green, or CFA
// green1 by default). Every streak is reported in 0-based pixel coordinates of the received image (origin at the
// upper-left sample, +X right, +Y down, integers at pixel centres), with its axial angle in radians in [0, PI).
//
// The worker then classifies the streaks with the toolkit's classifyStreaks, from the evidence of the same image only:
// its samples, its exposure and observation date, its WCS (the header's own, or the solution of a completed plate
// solving job of the image named by the request), and the accepted stars of a completed star detection job of the
// image named by the request. That context is resolved and frozen when the job is submitted; nothing is solved or
// detected implicitly, and no network or catalog is queried. A classification is an uncalibrated evidence weight,
// never a probability, and is kept apart from the detector's own confidence. A classification that fails leaves the
// measured streaks unclassified, with a warning, rather than failing the job.
//
// Jobs run in memory under the shared analysis scheduling (analysis.ts): one detection at a time, at most MAX_QUEUED
// jobs waiting. A job retains its image until it ends. An equivalent request (same image, settings, and context
// jobs) still waiting or running, or completed with its result kept, is answered instead of running again. Results
// are kept only in memory, keyed by job and grouped by image, until their image is released or the bounded store
// evicts them. Every change of a job is published as a compact streaks:updated event without the streaks, which are
// fetched on demand. The settings are not validated: the toolkit refuses invalid ones, and the job fails with its
// reason (detectionFailed).

// Options of detectStreaks a request runs with: all of them but the analysis area (the whole image is analyzed) and
// the saturation level, which the toolkit compares with normalized samples.
export type StreakDetectorSettings = Required<Omit<StreakDetectionOptions, 'area' | 'saturationLevel'>>

// What a job measures and with which context.
export interface StreakDetectionRequest {
	// Options of the detector.
	readonly settings: StreakDetectorSettings
	// Completed plate solving job of the same image whose solution gives the WCS of the classification; absent uses the
	// WCS of the image header, when valid.
	readonly plateSolveJobId?: string
	// Completed star detection job of the same image whose accepted stars feed the classification; absent uses none.
	readonly starDetectionJobId?: string
}

// Context sources a job's classification used, as resolved when it was submitted.
export interface StreakContextSources {
	// Where the WCS came from: the image header, or the solution of the plate solving job; absent when there was none.
	readonly wcs?: 'header' | 'plateSolve'
	// Plate solving job whose solution was used.
	readonly plateSolveJobId?: string
	// Star detection job whose accepted stars were used.
	readonly starDetectionJobId?: string
	// Accepted stars used, when a star detection job was.
	readonly starCount?: number
	// Exposure duration of the image, in seconds, when its header has one.
	readonly exposure?: number
	// Start of the observation as an ISO 8601 UTC date-time, when its header has one.
	readonly date?: string
}

// State of a job: waiting, running, or ended (completed, failed, or cancelled).
export type StreakDetectionJobState = AnalysisJobState

// Why a job did not complete, or a submission was refused:
// - queueFull: too many jobs were waiting when it was submitted.
// - workerFailed: the detector worker died.
// - timeout: the detection ran longer than its timeout.
// - invalidImage: the image could not be prepared for the detector.
// - detectionFailed: the toolkit refused the image or the settings, or exceeded its bounded work budget.
// - contextUnavailable: a context job named by the request is unknown, not kept, of another image, or without the
//   solution or stars it should give.
// - cancelled: the job was cancelled.
// - expired: the image was released before the job could read it, or the result is no longer kept.
export type StreakDetectionErrorCode = 'queueFull' | 'workerFailed' | 'timeout' | 'invalidImage' | 'detectionFailed' | 'contextUnavailable' | 'cancelled' | 'expired'

// Counts of a completed job.
export interface StreakDetectionSummary {
	// Streaks the detector reported.
	readonly detectedCount: number
	// Whether the streaks were classified; false when the classification failed.
	readonly classified: boolean
	// Streaks of each class, unknown included; empty when not classified.
	readonly classes: Partial<Record<StreakClass, number>>
	// Time the job ran, from preparing the image to the result, in milliseconds.
	readonly elapsed: number
}

// A streak detection job as published to clients; never carries the streaks.
export interface StreakDetectionJob extends AnalysisJob {
	// Id of the job.
	readonly jobId: string
	// Id of the image document measured.
	readonly imageId: string
	// What it measures and with which context.
	readonly request: StreakDetectionRequest
	// Context sources its classification uses.
	readonly context: StreakContextSources
	// State of the job.
	readonly state: StreakDetectionJobState
	// When it was submitted, Unix milliseconds (UTC).
	readonly queuedAt: number
	// When it started running, Unix milliseconds (UTC).
	readonly startedAt?: number
	// When it ended, Unix milliseconds (UTC).
	readonly endedAt?: number
	// Why it did not complete, when it failed or was cancelled.
	readonly code?: StreakDetectionErrorCode
	// Detail of the failure meant for people.
	readonly error?: string
	// Counts, once completed.
	readonly summary?: StreakDetectionSummary
}

// Full result of a completed job.
export interface StreakDetectionResult extends StreakDetectionSummary {
	// Id of the job.
	readonly jobId: string
	// Id of the image document measured.
	readonly imageId: string
	// What was measured and with which context.
	readonly request: StreakDetectionRequest
	// Context sources its classification used.
	readonly context: StreakContextSources
	// Width of the image, in pixels.
	readonly width: number
	// Height of the image, in pixels.
	readonly height: number
	// Streaks in the order of the detector (highest detector confidence first).
	readonly streaks: readonly Streak[]
	// Classification of each streak, by index in streaks; absent when the classification failed.
	readonly classifications?: readonly StreakClassification[]
	// Time the job waited before running, in milliseconds.
	readonly queueTime: number
	// Conditions worth knowing about the result, meant for people.
	readonly warnings: readonly string[]
}

// Snapshot of GET /api/streaks: the jobs waiting or running, and the latest ended ones.
export interface StreakDetectionSnapshot {
	// Jobs, oldest first.
	readonly jobs: readonly StreakDetectionJob[]
}

// Notification published whenever a job changes.
export interface StreakDetectionEvent {
	readonly type: 'streaks:updated'
	// New state of the job.
	readonly job: StreakDetectionJob
}

// Receiver of streak detection events.
export type StreakDetectionListener = (event: StreakDetectionEvent) => void

// Classification context of a job, frozen when it was submitted; the worker adds the image itself.
export interface StreakWorkerContext {
	// WCS of the image, a TAN or TAN-SIP header with 1-based CRPIX.
	readonly wcs?: FitsHeader
	// Accepted stars of the star detection job, in 0-based pixel coordinates.
	readonly stars?: readonly DetectedStar[]
	// Exposure duration, in seconds.
	readonly exposure?: number
	// Start of the observation as an ISO 8601 UTC date-time.
	readonly date?: string
}

// Request to the detector worker: the image copy it owns from now on.
export interface StreakWorkerRequest {
	// Id of the job, echoed by the response.
	readonly jobId: string
	// Copy of the decoded samples, mono, RGB, or CFA with its trusted pattern.
	readonly image: Image
	// Options of detectStreaks.
	readonly settings: StreakDetectorSettings
	// Classification context.
	readonly context: StreakWorkerContext
}

// Response of the detector worker: the streaks with their classifications (or why they could not be classified), or
// why the detector refused the request.
export type StreakWorkerResponse = { readonly jobId: string; readonly status: 'detected'; readonly streaks: readonly Streak[]; readonly classifications?: readonly StreakClassification[]; readonly classificationError?: string } | { readonly jobId: string; readonly status: 'failed'; readonly error: string }

// Request whose context was resolved, ready to be scheduled.
export interface StreakDetectionPreparation {
	// What to measure.
	readonly request: StreakDetectionRequest
	// Context sources, as published.
	readonly sources: StreakContextSources
	// Context the worker classifies with.
	readonly context: StreakWorkerContext
}

// Outcome of a submission: a new job, the job of an equivalent request still waiting or running (active), the
// completed job of an equivalent earlier one (cached), or why there is none.
export type StreakDetectionSubmitOutcome =
	| { readonly status: 'accepted'; readonly job: StreakDetectionJob }
	| { readonly status: 'active'; readonly job: StreakDetectionJob }
	| { readonly status: 'cached'; readonly job: StreakDetectionJob }
	| { readonly status: 'missing' }
	| { readonly status: 'contextUnavailable'; readonly error: string }
	| { readonly status: 'queueFull' }

// Options of the service.
export interface StreakDetectionServiceOptions {
	// Time a detection may run, in milliseconds, before its worker is terminated.
	readonly timeout?: number
}

// Error of a job that did not complete, with its reason.
export class StreakDetectionError extends Error {
	// Creates the error of a reason.
	constructor(
		readonly code: StreakDetectionErrorCode,
		message: string,
	) {
		super(message)
	}
}

export { MAX_QUEUED } from './analysis'

// Options of the detector, in the fixed order of the cache key.
const SETTING_KEYS = Object.keys(DEFAULT_STREAK_DETECTION_OPTIONS) as readonly (keyof StreakDetectorSettings)[]

// Detections running at once, one worker each: a detection holds the image copy plus its plane, background, and Hough
// workspaces, so a large frame costs hundreds of megabytes while it runs.
const CONCURRENCY = 1

// Time a detection may run by default, in milliseconds, before its worker is terminated.
const DEFAULT_TIMEOUT = 120000

// Returns the key of an equivalent detection: the same image, detector options, and context jobs. The WCS of the
// header and the acquisition data never change for an image, so they are implied by its id.
export function streakCacheKey(imageId: string, { settings, plateSolveJobId, starDetectionJobId }: StreakDetectionRequest): string {
	return JSON.stringify([imageId, SETTING_KEYS.map((key) => settings[key]), plateSolveJobId ?? null, starDetectionJobId ?? null])
}

// Returns how many streaks each class has.
export function countClasses(classifications: readonly StreakClassification[]): Partial<Record<StreakClass, number>> {
	const classes: Partial<Record<StreakClass, number>> = {}
	for (const classification of classifications) classes[classification.class] = (classes[classification.class] ?? 0) + 1
	return classes
}

// Worker thread of the detector. `unref` is a Bun extension that the DOM Worker type lacks.
type StreakWorker = Worker & Pick<Bun.Worker, 'unref'>

// A job of the service while it waits or runs, with its scheduling state.
type JobEntry = AnalysisEntry<StreakDetectionJob, StreakDetectionPreparation>

// Streak detection jobs of the server, their scheduling (see analysis.ts), and their results.
export class StreakDetectionService {
	// Queue, limits, reservations, and kept results.
	readonly #scheduler: AnalysisScheduler<StreakDetectionJob, StreakDetectionResult, StreakDetectionPreparation, 'builtin'>
	// Idle workers.
	readonly #idle: StreakWorker[] = []
	// Time a detection may run, in milliseconds.
	readonly #timeout: number

	// Creates the service over the image store and the plate solving and star detection results it reads its context
	// from, publishing every job change to listener. The results of an image are dropped when the store releases it.
	constructor(
		readonly images: ImageStore,
		readonly plateSolving: Pick<PlateSolvingService, 'result' | 'solutions'>,
		readonly stars: Pick<StarDetectionService, 'result'>,
		readonly listener: StreakDetectionListener,
		{ timeout = DEFAULT_TIMEOUT }: StreakDetectionServiceOptions = {},
	) {
		this.#timeout = timeout
		this.#scheduler = new AnalysisScheduler<StreakDetectionJob, StreakDetectionResult, StreakDetectionPreparation, 'builtin'>(images, {
			limits: { builtin: CONCURRENCY },
			provider: () => 'builtin',
			execute: (entry) => this.#execute(entry),
			failed: (entry, error) => {
				if (entry.controller.signal.aborted) return { state: 'cancelled', code: 'cancelled', error: 'The streak detection was cancelled' }
				if (error instanceof StreakDetectionError) return { state: 'failed', code: error.code, error: error.message }
				return { state: 'failed', code: 'invalidImage', error: Error.isError(error) ? error.message : String(error) }
			},
			cancelled: () => ({ code: 'cancelled', error: 'The streak detection was cancelled' }),
			publish: (job) => this.listener({ type: 'streaks:updated', job }),
		})
	}

	// Submits a detection of an open image. An equivalent job still waiting or running, or completed with its result
	// kept, is answered instead of running again. The context jobs are resolved here, once.
	submit(imageId: string, request: StreakDetectionRequest): StreakDetectionSubmitOutcome {
		if (this.images.name(imageId) === undefined) return { status: 'missing' }

		const preparation = this.#prepare(imageId, request)
		if (typeof preparation === 'string') return { status: 'contextUnavailable', error: preparation }

		const key = streakCacheKey(imageId, request)
		const active = this.#scheduler.active(key)
		if (active) return { status: 'active', job: active }
		const cached = this.#scheduler.cached(imageId, key)
		if (cached) return { status: 'cached', job: cached.job }
		if (this.#scheduler.full()) return { status: 'queueFull' }

		const job = this.#scheduler.enqueue(imageId, preparation, key, { request, context: preparation.sources })
		return job ? { status: 'accepted', job } : { status: 'missing' }
	}

	// Cancels a job: a waiting one ends at once, a running one is interrupted (its worker is terminated). Returns false
	// when the job is not waiting or running.
	cancel(jobId: string): boolean {
		return this.#scheduler.cancel(jobId)
	}

	// Returns a job waiting, running, recently ended, or completed with its result kept.
	job(jobId: string): StreakDetectionJob | undefined {
		return this.#scheduler.job(jobId)
	}

	// Returns the result of a completed job while it is kept.
	result(jobId: string): StreakDetectionResult | undefined {
		return this.#scheduler.result(jobId)
	}

	// Returns the completed jobs of an image whose results are kept, oldest first.
	results(imageId: string): StreakDetectionJob[] {
		return this.#scheduler.results(imageId)
	}

	// Returns the jobs waiting or running and the latest ended ones, oldest first.
	snapshot(): StreakDetectionSnapshot {
		return { jobs: this.#scheduler.snapshot() }
	}

	// Resolves the classification context of a request of an open image, or returns why a context job named by it
	// cannot be used.
	#prepare(imageId: string, request: StreakDetectionRequest): StreakDetectionPreparation | string {
		const acquisition = this.images.metadata(imageId)?.acquisition
		let wcs: FitsHeader | undefined
		let source: StreakContextSources['wcs']

		if (request.plateSolveJobId !== undefined) {
			const solved = this.plateSolving.result(request.plateSolveJobId)
			if (!solved || solved.imageId !== imageId) return 'The plate solution is not available for this image'
			if (!solved.solution) return 'The plate solving job found no solution'
			wcs = solved.solution
			source = 'plateSolve'
		} else {
			wcs = this.plateSolving.solutions(imageId)?.header
			if (wcs) source = 'header'
		}

		let stars: DetectedStar[] | undefined

		if (request.starDetectionJobId !== undefined) {
			const detected = this.stars.result(request.starDetectionJobId)
			if (!detected || detected.imageId !== imageId) return 'The detected stars are not available for this image'
			stars = detected.stars.filter((_, i) => detected.accepted[i])
		}

		const exposure = acquisition?.exposure
		const date = acquisition?.date
		const sources: StreakContextSources = {
			...(source && { wcs: source }),
			...(request.plateSolveJobId !== undefined && { plateSolveJobId: request.plateSolveJobId }),
			...(stars && { starDetectionJobId: request.starDetectionJobId, starCount: stars.length }),
			...(exposure !== undefined && { exposure }),
			...(date !== undefined && { date }),
		}

		const context: StreakWorkerContext = { ...(wcs && { wcs }), ...(stars && { stars }), ...(exposure !== undefined && { exposure }), ...(date !== undefined && { date }) }
		return { request, sources, context }
	}

	// Runs a job on a worker and builds its result.
	async #execute(entry: JobEntry): Promise<AnalysisCompletion<StreakDetectionJob, StreakDetectionResult>> {
		const image = await this.images.processingImage(entry.job.imageId)
		if (!image) throw new StreakDetectionError('expired', 'The image was released before it could be measured')
		if (entry.controller.signal.aborted) throw new StreakDetectionError('cancelled', 'The streak detection was cancelled')
		return this.#complete(entry, await this.#detect(entry, image))
	}

	// Detects and classifies the streaks of a job on a worker. Throws StreakDetectionError.
	async #detect(entry: JobEntry, image: Image): Promise<Extract<StreakWorkerResponse, { status: 'detected' }>> {
		const worker = this.#idle.pop() ?? this.#startWorker()
		const { promise, resolve, reject } = Promise.withResolvers<Extract<StreakWorkerResponse, { status: 'detected' }>>()
		const { signal } = entry.controller
		const { jobId } = entry.job
		const { request, context } = entry.preparation
		let reusable = false

		const onMessage = (event: MessageEvent<StreakWorkerResponse>) => {
			const response = event.data
			if (response.jobId !== jobId) return
			// A detection that threw leaves the worker usable; only a crash, a timeout, or a cancel does not.
			reusable = true
			if (response.status === 'detected') resolve(response)
			else reject(new StreakDetectionError('detectionFailed', `The streak detector refused the image or its settings: ${response.error}`))
		}

		const onError = (event: ErrorEvent) => reject(new StreakDetectionError('workerFailed', `The streak detector worker died: ${event.message}`))
		const onAbort = () => reject(new StreakDetectionError('cancelled', 'The streak detection was cancelled'))
		const timer = setTimeout(() => reject(new StreakDetectionError('timeout', `The streak detection did not finish within ${this.#timeout / 1000} s`)), this.#timeout)

		worker.addEventListener('message', onMessage)
		worker.addEventListener('error', onError)
		signal.addEventListener('abort', onAbort, { once: true })

		try {
			worker.postMessage({ jobId, image, settings: request.settings, context } satisfies StreakWorkerRequest, [image.raw.buffer])
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

	// Starts a detector worker.
	#startWorker(): StreakWorker {
		// The compiled executable defines the embedded path of the worker (see app/build.ts); elsewhere it is
		// resolved next to this module.
		const worker = new Worker(process.env.NEBULOSA_STREAK_WORKER ?? new URL('./streaks.worker.ts', import.meta.url)) as StreakWorker
		// An idle worker must not keep the process alive on its own.
		worker.unref()
		return worker
	}

	// Builds the summary and the full result of a completed job.
	#complete(entry: JobEntry, { streaks, classifications, classificationError }: Extract<StreakWorkerResponse, { status: 'detected' }>): AnalysisCompletion<StreakDetectionJob, StreakDetectionResult> {
		const { request, sources } = entry.preparation
		const { width, height } = entry.size
		const elapsed = performance.now() - entry.started!
		const queueTime = entry.job.startedAt! - entry.job.queuedAt
		const warnings: string[] = []

		if (streaks.length >= request.settings.maxStreaks) warnings.push('The streak limit was reached: fainter streaks were not reported.')
		if (classificationError !== undefined) warnings.push(`The streaks could not be classified: ${classificationError}`)

		const summary: StreakDetectionSummary = { detectedCount: streaks.length, classified: classifications !== undefined, classes: classifications ? countClasses(classifications) : {}, elapsed }
		const result: StreakDetectionResult = { ...summary, jobId: entry.job.jobId, imageId: entry.job.imageId, request, context: sources, width, height, streaks, ...(classifications && { classifications }), queueTime, warnings }
		return { patch: { summary }, result }
	}
}

// Creates the streak detection routes over a service.
export function createStreakDetectionRoutes(service: StreakDetectionService) {
	return {
		'/api/images/:id/streaks': {
			// Completed jobs of an image whose results are kept, oldest first.
			GET: (req) => Response.json(service.results(req.params.id)),
			// Submits a detection (StreakDetectionRequest) of an open image. Responds 202 with the queued job or the
			// equivalent job still waiting or running, 200 with the completed job of an equivalent earlier detection, 404
			// when the image is not open, 422 when a context job cannot be used, and 503 when too many jobs are waiting.
			POST: async (req) => {
				const outcome = service.submit(req.params.id, (await req.json()) as StreakDetectionRequest)
				if (outcome.status === 'missing') return errorResponse('Image not found', 404, 'notFound')
				if (outcome.status === 'contextUnavailable') return errorResponse(outcome.error, 422, 'contextUnavailable')
				if (outcome.status === 'queueFull') return errorResponse('Too many streak detections are waiting; try again later', 503, 'queueFull')
				return Response.json(outcome.job, { status: outcome.status === 'cached' ? 200 : 202 })
			},
		},
		'/api/streaks': {
			// Jobs waiting or running and the latest ended ones, for a tab that (re)connects.
			GET: () => Response.json(service.snapshot()),
		},
		'/api/streaks/:jobId': {
			// A job; 404 when it is unknown or long forgotten.
			GET: (req) => {
				const job = service.job(req.params.jobId)
				return job ? Response.json(job) : errorResponse('Streak detection not found', 404, 'notFound')
			},
		},
		'/api/streaks/:jobId/result': {
			// The full result of a completed job; 404 with code expired when it is not kept (anymore).
			GET: (req) => {
				const result = service.result(req.params.jobId)
				return result ? Response.json(result) : errorResponse('The result is not available', 404, 'expired')
			},
		},
		'/api/streaks/:jobId/cancel': {
			// Cancels a waiting or running job; the end arrives as a streaks:updated event. 404 when it is neither.
			POST: (req) => (service.cancel(req.params.jobId) ? new Response(null, { status: 204 }) : errorResponse('The streak detection is not waiting or running', 404, 'notFound')),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
