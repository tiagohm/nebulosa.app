import type { DarvAnalysisFailureReason, DarvAnalysisInput, DarvImageAnalysisResult, DarvTrailMeasurement } from 'nebulosa/src/observation/alignment/darv.analysis'
import type { DarvRunTiming } from 'nebulosa/src/observation/alignment/darv.runner'
import type { PolarAlignmentDirection } from 'nebulosa/src/observation/alignment/polaralignment'
import type { ImageStore } from './images'

// Analysis of DARV frames: the toolkit's analyzeDarvImage on a worker of its own (`darv.worker.ts`), fed the
// grayscale copy of a document prepared by the image worker, with the timing the runner measured and no sky
// transform, since DARV never solves its frames. The drift is therefore unsigned and in pixels per second, and
// it is never converted into a polar error. Analyses run one at a time, in arrival order; a cancelled or timed
// out analysis terminates its worker. No device is held, and nothing is kept: the DARV session owns the result.

// Outcome of one measurement, as the operator reads it:
// - measured: at least one trail gave the separation of its legs.
// - limited: trails were found, but only clipped, saturated, or unresolved ones, so the drift is at most a bound.
// - inconclusive: no outbound and return legs could be paired.
export type DarvMeasurementStatus = 'measured' | 'limited' | 'inconclusive'

// Result of a DARV frame without its trails.
export interface DarvMeasurementResult {
	// Outcome of the analysis.
	readonly status: DarvMeasurementStatus
	// Robust aggregate of the unsigned drift of the usable trails, in pixels per second across the RA direction;
	// absent unless measured, and never a zero standing for an unresolved separation.
	readonly driftMagnitude?: number
	// Number of paired trails, usable or not.
	readonly trailCount: number
	// Number of trails the aggregate used.
	readonly usableCount: number
	// Fit quality in [0, 1]; not the probability of a correct alignment.
	readonly confidence: number
	// Reasons for missing or rejected information, as the toolkit names them.
	readonly diagnostics: readonly DarvAnalysisFailureReason[]
}

// One paired trail, in 0-based pixel coordinates of the frame, origin at the upper-left sample, +X right, +Y down.
// Without a sky transform the order of the outer endpoints may be arbitrary (`directionResolved`).
export interface DarvTrail {
	// Outer endpoint of the outbound leg.
	readonly start: { readonly x: number; readonly y: number }
	// End of the outbound leg.
	readonly turn: { readonly x: number; readonly y: number }
	// Start of the return leg.
	readonly returnStart: { readonly x: number; readonly y: number }
	// Outer endpoint of the return leg.
	readonly end: { readonly x: number; readonly y: number }
	// Unsigned drift across the RA direction, in pixels per second.
	readonly driftMagnitude: number
	// Whether the timing told which outer endpoint was exposed first.
	readonly directionResolved: boolean
	// Whether the trail touches the border of the frame; excluded from the aggregate.
	readonly clipped: boolean
	// Whether the legs could not be told apart; only a bound.
	readonly unresolved: boolean
}

// Complete analysis of a DARV frame.
export interface DarvAnalysis extends DarvMeasurementResult {
	// Every paired trail.
	readonly trails: readonly DarvTrail[]
}

// Request to the DARV worker: the input of analyzeDarvImage, whose grayscale image it owns from now on.
export interface DarvWorkerRequest {
	// Id of the job, echoed by the response.
	readonly jobId: string
	// Image, timing, and direction.
	readonly input: DarvAnalysisInput
}

// Response of the DARV worker.
export type DarvWorkerResponse = { readonly jobId: string; readonly status: 'analyzed'; readonly result: DarvImageAnalysisResult } | { readonly jobId: string; readonly status: 'failed'; readonly error: string }

// Time an analysis may run, in milliseconds, before its worker is terminated.
const ANALYSIS_TIMEOUT = 120000

// Worker thread of the analysis. `unref` is a Bun extension that the DOM Worker type lacks.
type DarvWorker = Worker & Pick<Bun.Worker, 'unref'>

// Analyzes DARV frames of the image store.
export class DarvAnalyzer {
	// Worker kept between analyses.
	#idle?: DarvWorker
	// Settles when the previous analysis ended; analyses run one at a time.
	#queue: Promise<unknown> = Promise.resolve()

	// Creates the analyzer over the documents of images.
	constructor(readonly images: Pick<ImageStore, 'detectionImage'>) {}

	// Analyzes the open or retained document imageId as a DARV frame of the given timing, whose outbound motion
	// went in direction. Resolves the analysis; rejects when the document is no longer available, the worker
	// failed or timed out, or signal aborted it.
	analyze(imageId: string, timing: DarvRunTiming, direction: PolarAlignmentDirection, signal: AbortSignal): Promise<DarvAnalysis> {
		const run = this.#queue.then(() => this.#analyze(imageId, timing, direction, signal))
		this.#queue = run.catch(() => undefined)
		return run
	}

	// Runs one analysis on the worker.
	async #analyze(imageId: string, timing: DarvRunTiming, direction: PolarAlignmentDirection, signal: AbortSignal): Promise<DarvAnalysis> {
		signal.throwIfAborted()
		const image = await this.images.detectionImage(imageId)
		if (!image) throw new Error('The frame was released before it could be analyzed')
		signal.throwIfAborted()

		const worker = this.#idle ?? this.#startWorker()
		this.#idle = undefined
		const { promise, resolve, reject } = Promise.withResolvers<DarvImageAnalysisResult>()
		const jobId = crypto.randomUUID()
		let reusable = false

		const onMessage = (event: MessageEvent<DarvWorkerResponse>) => {
			const response = event.data
			if (response.jobId !== jobId) return
			// An analysis that threw leaves the worker usable; only a crash, a timeout, or a cancel does not.
			reusable = true
			if (response.status === 'analyzed') resolve(response.result)
			else reject(new Error(`The DARV analysis failed: ${response.error}`))
		}

		const onError = (event: ErrorEvent) => reject(new Error(`The DARV analysis worker died: ${event.message}`))
		const onAbort = () => reject(signal.reason)
		const timer = setTimeout(() => reject(new Error(`The DARV analysis did not finish within ${ANALYSIS_TIMEOUT / 1000} s`)), ANALYSIS_TIMEOUT)

		worker.addEventListener('message', onMessage)
		worker.addEventListener('error', onError)
		signal.addEventListener('abort', onAbort, { once: true })

		try {
			const input: DarvAnalysisInput = {
				image,
				exposure: timing.exposure,
				legDuration: (timing.outbound + timing.inbound) / 2,
				outboundDuration: timing.outbound,
				returnDuration: timing.inbound,
				turnaroundDuration: timing.turnaround,
				leadingDuration: timing.leading,
				trailingDuration: timing.trailing,
				firstDirection: direction === 'EAST' ? 'east' : 'west',
			}

			worker.postMessage({ jobId, input } satisfies DarvWorkerRequest, [image.raw.buffer])
			return darvAnalysis(await promise)
		} finally {
			clearTimeout(timer)
			worker.removeEventListener('message', onMessage)
			worker.removeEventListener('error', onError)
			signal.removeEventListener('abort', onAbort)
			// The analysis cannot be interrupted, so a worker still running one is terminated.
			if (reusable) this.#idle = worker
			else worker.terminate()
		}
	}

	// Starts an analysis worker.
	#startWorker(): DarvWorker {
		// The compiled executable defines the embedded path of the worker (see app/build.ts); elsewhere it is
		// resolved next to this module.
		const worker = new Worker(process.env.NEBULOSA_DARV_WORKER ?? new URL('./darv.worker.ts', import.meta.url)) as DarvWorker
		// An idle worker must not keep the process alive on its own.
		worker.unref()
		return worker
	}
}

// Adapts the toolkit's result to the operator's outcome. Without a sky transform the toolkit's best status is
// partial; the aggregate exists only when a trail was neither clipped nor unresolved, so a bound is reported as
// limited and never as a drift.
export function darvAnalysis(result: DarvImageAnalysisResult): DarvAnalysis {
	const trails = result.trails.map(darvTrail)
	const usableCount = result.trails.filter((trail) => !trail.clipped && !trail.unresolved).length
	const measured = result.driftMagnitude !== undefined && usableCount > 0
	const status: DarvMeasurementStatus = measured ? 'measured' : trails.length > 0 ? 'limited' : 'inconclusive'

	return {
		status,
		...(measured && { driftMagnitude: result.driftMagnitude }),
		trailCount: trails.length,
		usableCount,
		confidence: result.confidence,
		diagnostics: result.diagnostics,
		trails,
	}
}

// Copies a trail of the toolkit into the shape published to clients.
function darvTrail(trail: DarvTrailMeasurement): DarvTrail {
	const { start, turn, returnStart, end, driftMagnitude, directionResolved, clipped, unresolved } = trail
	return { start: { x: start.x, y: start.y }, turn: { x: turn.x, y: turn.y }, returnStart: { x: returnStart.x, y: returnStart.y }, end: { x: end.x, y: end.y }, driftMagnitude, directionResolved, clipped, unresolved }
}
