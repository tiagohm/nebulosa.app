import { BACKGROUND_NOISE_VERSION, type BackgroundNoiseStatus, type BackgroundNoiseWarning, type ImageBackgroundNoise } from 'nebulosa/src/imaging/analysis/background.noise'
import type { ImageHistogram, ImagePlaneStatistics, ImageStatisticsPlane, QuantileMethod } from 'nebulosa/src/imaging/analysis/statistics'
import { type AnalysisCompletion, type AnalysisEntry, type AnalysisJob, type AnalysisJobState, AnalysisScheduler } from './analysis'
import { errorResponse } from './http'
import type { DocumentStatistics, ImageRect, ImageStore, SampleConversion } from './images'

// Image statistics service of the Images workspace. A job measures the original decoded samples of an image document
// of the image store, addressed by its id, whole or inside a rectangle, with the toolkit's image statistics scan on the
// image worker that holds the pixels (ImageStore.statistics), so the image is never copied and renderings proceed while
// it runs. The planes follow the image: mono, the RGB channels and their BT.709 luminance, or each phase of a mosaic
// with a trusted CFA pattern (red, green1, green2, blue, selected by absolute image coordinates); a mosaic whose pattern
// is not trusted is measured as one mono plane. Display settings never change what is measured.
//
// Results are in the scale of the source (SampleConversion): levels such as the mean, median, percentiles, extrema,
// histogram domains and background level as scale × sample + offset, dispersions such as the standard deviation, MAD,
// robust sigma and background noise as |scale| × sample. The unit is ADU for unscaled integer data and the unit of the
// source otherwise; nothing is converted to electrons. Order statistics say whether they are exact, binned to integer
// codes, or sampled. The counts at the numeric limits are reported only when the source is unsigned integer data that
// the read did not rescale; they are never called saturation. The background is a spatial estimate of each native
// plane (see the toolkit's local background noise), not a read noise.
//
// Jobs run in memory under the shared analysis scheduling (analysis.ts): one scan at a time, at most MAX_QUEUED jobs
// waiting. A job retains its image until it ends. An equivalent request (same image and area) still waiting or running,
// or completed with its result kept, is answered instead of running again. Results are kept only in memory, keyed by
// job and grouped by image, until their image is released or the bounded store evicts them. Every change of a job is
// published as a compact statistics:updated event without the planes, which are fetched on demand. Requests are not
// validated: the area is trusted to lie inside the image.

// Version of the statistics a result was computed with, part of the cache key; bumped with the toolkit rules.
const STATISTICS_VERSION = `1.${BACKGROUND_NOISE_VERSION}`

// Scans running at once: the image worker runs one at a time anyway, interleaved with renderings.
const CONCURRENCY = 1

// What a job measures.
export interface ImageStatisticsRequest {
	// Rectangle of image pixels to measure, inside the image; the whole image when absent.
	readonly area?: ImageRect
}

// State of a job: waiting, running, or ended (completed, failed, or cancelled).
export type ImageStatisticsJobState = AnalysisJobState

// Why a job did not complete, or a submission was refused:
// - queueFull: too many jobs were waiting when it was submitted.
// - analysisFailed: the scan failed, such as for an area outside the image.
// - cancelled: the job was cancelled.
// - expired: the image was released before the job could read it, or the result is no longer kept.
export type ImageStatisticsErrorCode = 'queueFull' | 'analysisFailed' | 'cancelled' | 'expired'

// Headline numbers of a completed job, in source units.
export interface ImageStatisticsSummary {
	// Plane the numbers describe: the luminance of an RGB image, otherwise the first plane.
	readonly plane: ImageStatisticsPlane
	// Median of that plane.
	readonly median?: number
	// Population standard deviation of that plane.
	readonly standardDeviation?: number
	// Time the scan ran, in milliseconds.
	readonly elapsed: number
}

// An image statistics job as published to clients; never carries the planes.
export interface ImageStatisticsJob extends AnalysisJob {
	// Id of the job.
	readonly jobId: string
	// Id of the image document measured.
	readonly imageId: string
	// What it measures.
	readonly request: ImageStatisticsRequest
	// State of the job.
	readonly state: ImageStatisticsJobState
	// When it was submitted, Unix milliseconds (UTC).
	readonly queuedAt: number
	// When it started running, Unix milliseconds (UTC).
	readonly startedAt?: number
	// When it ended, Unix milliseconds (UTC).
	readonly endedAt?: number
	// Why it did not complete, when it failed or was cancelled.
	readonly code?: ImageStatisticsErrorCode
	// Detail of the failure meant for people.
	readonly error?: string
	// Headline numbers, once completed.
	readonly summary?: ImageStatisticsSummary
}

// Chart histogram of one plane, its domain in source units.
export interface StatisticsHistogram {
	// Lower edge of the domain, in source units.
	readonly min: number
	// Upper edge of the domain, in source units; equal to min for a single-valued domain, whose samples are in bin 0.
	readonly max: number
	// Sample counts of equal bins between min and max; the last bin includes max.
	readonly counts: readonly number[]
	// Finite samples below the domain.
	readonly belowDomain: number
	// Finite samples above the domain.
	readonly aboveDomain: number
}

// Local background level and spatial noise of one native plane, in source units.
export interface StatisticsBackground {
	// Whether the estimate was measured, is qualified by its warnings, or is missing.
	readonly status: BackgroundNoiseStatus
	// Background level, in source units; absent when unavailable.
	readonly level?: number
	// Spatial noise, a Gaussian-scaled residual MAD, in source units; absent when unavailable.
	readonly noiseSigma?: number
	// Tiles accepted as background.
	readonly usedTiles: number
	// Tiles the plane was split into.
	readonly totalTiles: number
	// Samples contributing to the accepted tiles.
	readonly sampleCount: number
	// Fraction of the considered samples that did not contribute, 0..1.
	readonly rejectedFraction?: number
	// Spread of the tile baselines in noise sigmas.
	readonly gradientIndicator?: number
	// Quality flags.
	readonly warnings: readonly BackgroundNoiseWarning[]
	// Estimator identifier.
	readonly method: ImageBackgroundNoise['method']
	// Estimator rules version.
	readonly version: number
}

// Counts at the numeric limits of the source, with the limits themselves.
export interface StatisticsNumericLimits {
	// Lowest representable value, in source units.
	readonly low: number
	// Highest representable value, in source units.
	readonly high: number
	// Samples at or below low.
	readonly lowCount: number
	// Samples at or above high.
	readonly highCount: number
}

// Statistics of one plane, every level and dispersion in source units, absent when the plane has no finite sample.
export interface PlaneStatistics {
	// Plane these statistics describe.
	readonly plane: ImageStatisticsPlane
	// Finite samples considered.
	readonly finiteCount: number
	// NaN or infinite samples skipped.
	readonly nonFiniteCount: number
	// Smallest finite sample.
	readonly min?: number
	// Largest finite sample.
	readonly max?: number
	// Mean.
	readonly mean?: number
	// Population standard deviation (divided by N).
	readonly standardDeviation?: number
	// Median, the 50th percentile.
	readonly median?: number
	// Median absolute deviation about the median.
	readonly mad?: number
	// 1.4826 × MAD: a robust dispersion of the whole population, not a background noise.
	readonly robustSigma?: number
	// 1st percentile.
	readonly p01?: number
	// 99th percentile.
	readonly p99?: number
	// How the median, MAD and percentiles were obtained.
	readonly quantileMethod: QuantileMethod
	// Samples the order statistics were computed from.
	readonly quantileSamples: number
	// Counts at the numeric limits, present only when the source has known limits.
	readonly numericLimits?: StatisticsNumericLimits
	// Chart histograms over the robust P0.1..P99.9 domain and the full min..max one, absent without finite samples.
	readonly histograms?: { readonly robust: StatisticsHistogram; readonly full: StatisticsHistogram }
	// Local background of a native plane; absent for the luminance.
	readonly background?: StatisticsBackground
}

// Full result of a completed job.
export interface ImageStatisticsReport {
	// Id of the job.
	readonly jobId: string
	// Id of the image document measured.
	readonly imageId: string
	// What was measured.
	readonly request: ImageStatisticsRequest
	// Width of the image, in pixels.
	readonly width: number
	// Height of the image, in pixels.
	readonly height: number
	// Rectangle measured: the request's area, or the whole image.
	readonly area: ImageRect
	// Unit of every level and dispersion: ADU of unscaled integer data, or the unit of the source.
	readonly unit: SampleConversion['unit']
	// Whether the read rescaled the image to fit 0..1, so its brightest pixel is not a full scale.
	readonly rescaled: boolean
	// Whether the image is a mosaic measured phase by phase (trusted) or as one mono plane (untrusted); absent otherwise.
	readonly mosaic?: DocumentStatistics['mosaic']
	// Statistics of each plane, in canonical order.
	readonly planes: readonly PlaneStatistics[]
	// Time the scan ran, in milliseconds.
	readonly elapsed: number
	// Time the job waited before running, in milliseconds.
	readonly queueTime: number
}

// Snapshot of GET /api/statistics: the jobs waiting or running, and the latest ended ones.
export interface ImageStatisticsSnapshot {
	// Jobs, oldest first.
	readonly jobs: readonly ImageStatisticsJob[]
}

// Notification published whenever a job changes.
export interface ImageStatisticsEvent {
	readonly type: 'statistics:updated'
	// New state of the job.
	readonly job: ImageStatisticsJob
}

// Receiver of image statistics events.
export type ImageStatisticsListener = (event: ImageStatisticsEvent) => void

// Outcome of a submission: a new job, the job of an equivalent request still waiting or running (active), the completed
// job of an equivalent earlier one (cached), or why there is none.
export type ImageStatisticsSubmitOutcome = { readonly status: 'accepted'; readonly job: ImageStatisticsJob } | { readonly status: 'active'; readonly job: ImageStatisticsJob } | { readonly status: 'cached'; readonly job: ImageStatisticsJob } | { readonly status: 'missing' } | { readonly status: 'queueFull' }

// Error of a job that did not complete, with its reason.
export class ImageStatisticsError extends Error {
	// Creates the error of a reason.
	constructor(
		readonly code: ImageStatisticsErrorCode,
		message: string,
	) {
		super(message)
	}
}

// A job of the service while it waits or runs, with its scheduling state.
type JobEntry = AnalysisEntry<ImageStatisticsJob, ImageStatisticsRequest>

// Returns the key of an equivalent scan: the same image and area, under the same statistics version.
export function statisticsCacheKey(imageId: string, { area }: ImageStatisticsRequest): string {
	return JSON.stringify([imageId, area ? [area.left, area.top, area.width, area.height] : null, STATISTICS_VERSION])
}

// Converts the statistics of a plane from normalized samples to the scale of the source.
export function planeInSourceUnits(plane: ImagePlaneStatistics, conversion: SampleConversion): PlaneStatistics {
	const { scale, offset } = conversion
	const level = (value: number | undefined) => (value === undefined ? undefined : scale * value + offset)
	const delta = (value: number | undefined) => (value === undefined ? undefined : Math.abs(scale) * value)
	const histogram = ({ min, max, counts, belowDomain, aboveDomain }: ImageHistogram): StatisticsHistogram => ({ min: scale * min + offset, max: scale * max + offset, counts: Array.from(counts), belowDomain, aboveDomain })
	const background = plane.background && { ...plane.background, level: level(plane.background.level), noiseSigma: delta(plane.background.noiseSigma) }

	return {
		plane: plane.plane,
		finiteCount: plane.finiteCount,
		nonFiniteCount: plane.nonFiniteCount,
		min: level(plane.min),
		max: level(plane.max),
		mean: level(plane.mean),
		standardDeviation: delta(plane.standardDeviation),
		median: level(plane.median),
		mad: delta(plane.mad),
		robustSigma: delta(plane.robustSigma),
		p01: level(plane.p01),
		p99: level(plane.p99),
		quantileMethod: plane.quantileMethod,
		quantileSamples: plane.quantileSamples,
		...(plane.numericLimits && { numericLimits: { low: offset, high: scale + offset, ...plane.numericLimits } }),
		...(plane.histograms && { histograms: { robust: histogram(plane.histograms.robust), full: histogram(plane.histograms.full) } }),
		...(background && { background }),
	}
}

// Image statistics jobs of the server, their scheduling (see analysis.ts), and their results.
export class ImageStatisticsService implements Disposable {
	// Queue, limits, reservations, and kept results.
	readonly #scheduler: AnalysisScheduler<ImageStatisticsJob, ImageStatisticsReport, ImageStatisticsRequest, 'builtin'>

	// Creates the service over the image store, publishing every job change to listener. The results of an image are
	// dropped when the store releases it.
	constructor(
		readonly images: ImageStore,
		readonly listener: ImageStatisticsListener,
	) {
		this.#scheduler = new AnalysisScheduler<ImageStatisticsJob, ImageStatisticsReport, ImageStatisticsRequest, 'builtin'>(images, {
			limits: { builtin: CONCURRENCY },
			provider: () => 'builtin',
			execute: (entry) => this.#execute(entry),
			failed: (entry, error) => {
				if (entry.controller.signal.aborted) return { state: 'cancelled', code: 'cancelled', error: 'The image statistics were cancelled' }
				if (error instanceof ImageStatisticsError) return { state: error.code === 'cancelled' ? 'cancelled' : 'failed', code: error.code, error: error.message }
				return { state: 'failed', code: 'analysisFailed', error: Error.isError(error) ? error.message : String(error) }
			},
			cancelled: () => ({ code: 'cancelled', error: 'The image statistics were cancelled' }),
			publish: (job) => this.listener({ type: 'statistics:updated', job }),
		})
	}

	// Submits a scan of an open image. An equivalent job still waiting or running, or completed with its result kept,
	// is answered instead of running again.
	submit(imageId: string, request: ImageStatisticsRequest): ImageStatisticsSubmitOutcome {
		if (this.images.name(imageId) === undefined) return { status: 'missing' }
		const normalized: ImageStatisticsRequest = request.area ? { area: request.area } : {}
		const key = statisticsCacheKey(imageId, normalized)
		const active = this.#scheduler.active(key)
		if (active) return { status: 'active', job: active }
		const cached = this.#scheduler.cached(imageId, key)
		if (cached) return { status: 'cached', job: cached.job }
		if (this.#scheduler.full()) return { status: 'queueFull' }
		const job = this.#scheduler.enqueue(imageId, normalized, key, { request: normalized })
		return job ? { status: 'accepted', job } : { status: 'missing' }
	}

	// Cancels a job: a waiting one ends at once, a running scan stops at its next slice. Returns false when the job is
	// not waiting or running.
	cancel(jobId: string): boolean {
		return this.#scheduler.cancel(jobId)
	}

	// Returns a job waiting, running, recently ended, or completed with its result kept.
	job(jobId: string): ImageStatisticsJob | undefined {
		return this.#scheduler.job(jobId)
	}

	// Returns the result of a completed job while it is kept.
	result(jobId: string): ImageStatisticsReport | undefined {
		return this.#scheduler.result(jobId)
	}

	// Returns the completed jobs of an image whose results are kept, oldest first.
	results(imageId: string): ImageStatisticsJob[] {
		return this.#scheduler.results(imageId)
	}

	// Returns the jobs waiting or running and the latest ended ones, oldest first.
	snapshot(): ImageStatisticsSnapshot {
		return { jobs: this.#scheduler.snapshot() }
	}

	// Stops a server in place: cancels every job waiting or running, so none outlives the run.
	[Symbol.dispose]() {
		this.#scheduler.cancelAll()
	}

	// Scans a job's image on the image worker and builds its result.
	async #execute(entry: JobEntry): Promise<AnalysisCompletion<ImageStatisticsJob, ImageStatisticsReport>> {
		const { imageId, jobId, queuedAt, startedAt } = entry.job
		const request = entry.preparation
		const outcome = await this.images.statistics(imageId, request.area, entry.controller.signal)
		if (outcome.status === 'missing') throw new ImageStatisticsError('expired', 'The image was released before it could be measured')
		if (outcome.status === 'cancelled') throw new ImageStatisticsError('cancelled', 'The image statistics were cancelled')

		const { width, height } = entry.size
		const elapsed = performance.now() - entry.started!
		const planes = outcome.statistics.planes.map((plane) => planeInSourceUnits(plane, outcome.conversion))
		const headline = planes.find((plane) => plane.plane === 'luminance') ?? planes[0]
		const summary: ImageStatisticsSummary = { plane: headline.plane, median: headline.median, standardDeviation: headline.standardDeviation, elapsed }
		const area = request.area ?? { left: 0, top: 0, width, height }
		const result: ImageStatisticsReport = { jobId, imageId, request, width, height, area, unit: outcome.conversion.unit, rescaled: outcome.conversion.rescaled, ...(outcome.mosaic && { mosaic: outcome.mosaic }), planes, elapsed, queueTime: startedAt! - queuedAt }
		return { patch: { summary }, result }
	}
}

// Creates the image statistics routes over a service.
export function createImageStatisticsRoutes(service: ImageStatisticsService) {
	return {
		'/api/images/:id/statistics': {
			// Completed jobs of an image whose results are kept, oldest first.
			GET: (req) => Response.json(service.results(req.params.id)),
			// Submits a scan (ImageStatisticsRequest) of an open image. Responds 202 with the queued job or the equivalent
			// job still waiting or running, 200 with the completed job of an equivalent earlier scan, 404 when the image is
			// not open, and 503 when too many jobs are waiting.
			POST: async (req) => {
				const outcome = service.submit(req.params.id, (await req.json()) as ImageStatisticsRequest)
				if (outcome.status === 'missing') return errorResponse('Image not found', 404, 'notFound')
				if (outcome.status === 'queueFull') return errorResponse('Too many image statistics are waiting; try again later', 503, 'queueFull')
				return Response.json(outcome.job, { status: outcome.status === 'cached' ? 200 : 202 })
			},
		},
		'/api/statistics': {
			// Jobs waiting or running and the latest ended ones, for a tab that (re)connects.
			GET: () => Response.json(service.snapshot()),
		},
		'/api/statistics/:jobId': {
			// A job; 404 when it is unknown or long forgotten.
			GET: (req) => {
				const job = service.job(req.params.jobId)
				return job ? Response.json(job) : errorResponse('Image statistics not found', 404, 'notFound')
			},
		},
		'/api/statistics/:jobId/result': {
			// The full result of a completed job; 404 with code expired when it is not kept (anymore).
			GET: (req) => {
				const result = service.result(req.params.jobId)
				return result ? Response.json(result) : errorResponse('The result is not available', 404, 'expired')
			},
		},
		'/api/statistics/:jobId/cancel': {
			// Cancels a waiting or running job; the end arrives as a statistics:updated event. 404 when it is neither.
			POST: (req) => (service.cancel(req.params.jobId) ? new Response(null, { status: 204 }) : errorResponse('The image statistics are not waiting or running', 404, 'notFound')),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
