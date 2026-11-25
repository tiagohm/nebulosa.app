import { type PlateSolution, plateSolutionFrom } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { heightKeyword, widthKeyword } from 'nebulosa/src/io/formats/fits/util'
import { type AnalysisCompletion, type AnalysisEntry, type AnalysisJob, type AnalysisJobState, AnalysisScheduler } from './analysis'
import type { ExternalToolConfig, ExternalToolsStore } from './externaltools'
import { errorResponse } from './http'
import type { ImageStore } from './images'
import { type PlateSolveHints, type PlateSolveStrategy, type ResolvedPlateSolveHints, resolvePlateSolveHints } from './platesolving.hints'
import { NativePlateSolver, NativeSolveError } from './platesolving.native'

// Plate solving service of the manual solves of the Images workspace, on files and camera frames alike. A solve finds
// the World Coordinate System of an image document of the image store, addressed by its id (a document never changes,
// so the id is its scientific identity), with the built-in solver (platesolving.native.ts), run on a worker of its own
// over the grayscale copy of the document with the index files of the folder set in External Tools,
// whose settings are resolved once per job (or once per capture session) and never come from a request.
//
// The result keeps the whole WCS header of the solver (CD matrix, SIP terms, frame) as the toolkit's PlateSolution,
// whose center, scale, orientation, parity, and field size are radians of the ICRS. A solution is accepted only when
// plateSolutionFrom proves it (an equatorial TAN or TAN-SIP solution in the ICRS or FK5 J2000) and it describes an
// image of the size of the document; a solver that ended normally without one found no solution, which is not a
// failure. Hints come from the operator, then from the header (see platesolving.hints.ts), and the job keeps those it
// used with their origins. The WCS a header already had is reported apart, never replaced, and no file is written.
//
// Jobs run in memory under the shared analysis scheduling (analysis.ts): one solve at a time, at most MAX_QUEUED jobs
// waiting, in arrival order. A job retains its image until it ends. An equivalent request is answered with the job
// already waiting or running, or with its kept result, so a repeated request never solves twice. Results are kept only
// in memory until their image is released. Every change of a job is published as a compact plateSolving:updated event
// without the WCS. No device is held, and nothing moves a mount.

// What a plate solve searches and how.
export interface PlateSolveRequest {
	// Search around a known position, or over the whole sky.
	readonly strategy: PlateSolveStrategy
	// Hints of the operator; the image supplies the missing ones.
	readonly hints?: PlateSolveHints
	// Fractional tolerance of the scale hint, in (0, 1); DEFAULT_SCALE_TOLERANCE when absent.
	readonly scaleTolerance?: number
}

// Who asked for a plate solve: a person, in Images, or the solve of a TPPA, iPolar, mount pointing, or Target Centering frame.
export type PlateSolveOrigin =
	| { readonly kind: 'manual' }
	| {
			readonly kind: 'tppa'
			// Id of the TPPA session.
			readonly sessionId: string
			// Id of the open connection that provides the camera.
			readonly connectionId: string
			// Exact id of the camera.
			readonly deviceId: string
			// Identity of the frame: the session id and the frame ordinal.
			readonly frameId: string
			// Pose being acquired (1, 2 or 3), absent for a refinement frame.
			readonly point?: 1 | 2 | 3
	  }
	| {
			readonly kind: 'ipolar'
			// Id of the iPolar session.
			readonly sessionId: string
			// Id of the open connection that provides the camera.
			readonly connectionId: string
			// Exact id of the camera.
			readonly deviceId: string
			// Identity of the frame: the session id and the frame ordinal.
			readonly frameId: string
			// Step of the frame: the reference pose, the second-pose candidate, or a refinement frame.
			readonly step: 'reference' | 'second' | 'refinement'
	  }
	| {
			readonly kind: 'mountPointing'
			// Id of the mount pointing session.
			readonly sessionId: string
			// Id of the open connection that provides the camera.
			readonly connectionId: string
			// Exact id of the camera.
			readonly deviceId: string
			// Identity of the frame: the session id and the frame ordinal.
			readonly frameId: string
	  }
	| {
			readonly kind: 'targetCentering'
			// Id of the Target Centering session.
			readonly sessionId: string
			// Id of the open connection that provides the camera.
			readonly connectionId: string
			// Exact id of the camera.
			readonly deviceId: string
			// Identity of the frame: the session id and the frame ordinal.
			readonly frameId: string
	  }

// State of a job: waiting for the solver, running, or ended (completed, failed, or cancelled).
export type PlateSolveJobState = AnalysisJobState

// Step a running job reached: preparing the image, or detecting its stars and solving them.
export type PlateSolveStage = 'preparing' | 'solving'

// Why a job did not complete:
// - queueFull: too many jobs were waiting when it was submitted.
// - workerFailed: the worker of the solver died.
// - timeout: the solve ran longer than the timeout of the solver.
// - failed: the solver reported an error.
// - invalidSolution: the solver produced a WCS that is not a valid solution of the image.
// - invalidImage: the image could not be prepared for the solver.
// - cancelled: the job was cancelled.
// - expired: the image was released before the job could read it, or the result is no longer kept.
export type PlateSolveErrorCode = 'queueFull' | 'workerFailed' | 'timeout' | 'failed' | 'invalidSolution' | 'invalidImage' | 'cancelled' | 'expired'

// Outcome of a completed job: a solution, or a search that ended without one.
export type PlateSolveOutcome = 'solved' | 'noSolution'

// Summary of a completed job. Angles are radians; the center is ICRS.
export interface PlateSolveSummary {
	// Whether a solution was found.
	readonly outcome: PlateSolveOutcome
	// Right ascension of the image center, in [0, 2π).
	readonly rightAscension?: number
	// Declination of the image center, in [-π/2, π/2].
	readonly declination?: number
	// Geometric-mean image scale, radians per pixel.
	readonly scale?: number
	// Field rotation from the CD matrix, as the toolkit's PlateSolution orientation.
	readonly orientation?: number
	// Image handedness relative to the sky.
	readonly parity?: PlateSolution['parity']
	// Field width.
	readonly width?: number
	// Field height.
	readonly height?: number
	// Time the job ran, from preparing the image to the validated result, in milliseconds.
	readonly elapsed: number
}

// A plate solving job as published to clients; never carries the WCS.
export interface PlateSolveJob extends AnalysisJob {
	// Who asked for it.
	readonly origin: PlateSolveOrigin
	// What it searches and how.
	readonly request: PlateSolveRequest
	// Hints it uses, with their origins.
	readonly hints: ResolvedPlateSolveHints
	// Step it reached while running.
	readonly stage?: PlateSolveStage
	// Why it did not complete, when it failed or was cancelled.
	readonly code?: PlateSolveErrorCode
	// Detail of the failure meant for people.
	readonly error?: string
	// Summary, once completed.
	readonly summary?: PlateSolveSummary
}

// Full result of a completed job.
export interface PlateSolveResult extends PlateSolveSummary {
	// Id of the job.
	readonly jobId: string
	// Id of the image document solved.
	readonly imageId: string
	// What was searched and how.
	readonly request: PlateSolveRequest
	// Hints used, with their origins.
	readonly hints: ResolvedPlateSolveHints
	// Settings of the solver.
	readonly tool: Readonly<ExternalToolConfig>
	// The solution, with the whole WCS header of the solver, when solved.
	readonly solution?: PlateSolution
	// Width of the image, in pixels.
	readonly widthInPixels: number
	// Height of the image, in pixels.
	readonly heightInPixels: number
	// Time the job waited before running, in milliseconds.
	readonly queueTime: number
	// Conditions worth knowing about the result, meant for people.
	readonly warnings: readonly string[]
}

// Solutions known for an image: the WCS its header already had, and the completed jobs whose results are kept.
export interface PlateSolutions {
	// Solution read from the header of the image, when it holds a valid one; never written by a job.
	readonly header?: PlateSolution
	// Completed jobs of the image, oldest first.
	readonly jobs: readonly PlateSolveJob[]
}

// Snapshot of GET /api/plate-solving: the jobs waiting or running, and the latest ended ones.
export interface PlateSolveSnapshot {
	// Jobs, oldest first.
	readonly jobs: readonly PlateSolveJob[]
}

// Notification published whenever a job changes.
export interface PlateSolvingEvent {
	readonly type: 'plateSolving:updated'
	// New state of the job.
	readonly job: PlateSolveJob
}

// Receiver of plate solving events.
export type PlateSolvingListener = (event: PlateSolvingEvent) => void

// Request whose solver settings were resolved, ready to be submitted: they are a snapshot taken when it was prepared,
// so a later save of the External Tools settings applies to later preparations.
export interface PlateSolvePreparation {
	// What to search and how.
	readonly request: PlateSolveRequest
	// Settings of the solver.
	readonly tool: Readonly<ExternalToolConfig>
}

// Pixels a job solves in place of its image, for a consumer that solves a private, calibrated copy of an image while the
// job, its hints, its size check, and its result stay bound to the image itself, such as an iPolar frame less a master
// dark. The FITS has the image's size and pixel grid. Never a route input.
export interface PlateSolvePixels {
	// Complete FITS file of the pixels.
	readonly bytes: Uint8Array<ArrayBuffer>
	// Stable identity of what was done to the image, such as "dark:<masterId>:<digest>": part of the cache key, so a
	// solve of the image itself and one of these pixels are never answered for each other.
	readonly fingerprint: string
}

// Preparation of one job: the preparation of its request and, for one job only, the pixels it solves.
type JobPreparation = PlateSolvePreparation & { readonly pixels?: PlateSolvePixels }

// Outcome of a submission: a new job, the job of an equivalent request still waiting or running (active), the
// completed job of an equivalent earlier one (cached), or why there is none.
export type PlateSolveSubmitOutcome = { readonly status: 'accepted'; readonly job: PlateSolveJob } | { readonly status: 'active'; readonly job: PlateSolveJob } | { readonly status: 'cached'; readonly job: PlateSolveJob } | { readonly status: 'missing' } | { readonly status: 'queueFull' }

// Error of a job that did not complete, with its reason.
export class PlateSolvingError extends Error {
	// Creates the error of a reason.
	constructor(
		readonly code: PlateSolveErrorCode,
		message: string,
	) {
		super(message)
	}
}

// Solves running at once: one, which takes the single thread of the worker of the solver.
const CONCURRENCY = 1

// Fractional tolerance of a scale hint when the request gives none.
export const DEFAULT_SCALE_TOLERANCE = 0.2

// Pixels a solution's image size may differ from the document: a header solved by ASTAP, which rebuilds
// NAXIS1/NAXIS2 from CRPIX, rounds an odd size down by one.
const SIZE_TOLERANCE = 1

// Fields the toolkit's PlateSolution derives from a header, left out when a solution is rebuilt from its header.
const DERIVED_FIELDS = new Set(['orientation', 'scale', 'width', 'height', 'parity', 'radius', 'widthInPixels', 'heightInPixels', 'rightAscension', 'declination'])

// Origin of a solve a person asked for.
const MANUAL_ORIGIN: PlateSolveOrigin = { kind: 'manual' }

// Returns the key of an equivalent solve: the same image, strategy, effective hints, tolerance, index folder,
// pixels (the fingerprint of private pixels, empty for the image itself), and generation of the downloaded index
// bands, which advances when one is installed or removed. The timeout is left out, since it does not change a result;
// so are the other changes of the contents of the folder, so a solve after its index files changed by hand answers
// with the kept result of the same request.
export function plateSolveCacheKey(imageId: string, { strategy, scaleTolerance }: PlateSolveRequest, hints: ResolvedPlateSolveHints, tool: ExternalToolConfig, fingerprint: string = '', indexGeneration: number = 0): string {
	const values = [hints.rightAscension?.value, hints.declination?.value, hints.radius?.value, hints.scale?.value]
	return JSON.stringify([imageId, strategy, values, scaleTolerance ?? DEFAULT_SCALE_TOLERANCE, tool.indexDirectory ?? '', fingerprint, indexGeneration])
}

// Returns the solution of a WCS header for an image of width × height pixels, or undefined when plateSolutionFrom
// refuses it or it describes an image of another size (beyond SIZE_TOLERANCE). A size within the tolerance is
// replaced by the document's, so the derived geometry is that of the image solved.
export function validatedSolution(header: FitsHeader, width: number, height: number): PlateSolution | undefined {
	const wcs: FitsHeader = {}
	for (const [key, value] of Object.entries(header)) if (!DERIVED_FIELDS.has(key)) wcs[key] = value

	const solvedWidth = widthKeyword(wcs, 0)
	const solvedHeight = heightKeyword(wcs, 0)
	if (!(Math.abs(solvedWidth - width) <= SIZE_TOLERANCE && Math.abs(solvedHeight - height) <= SIZE_TOLERANCE)) return undefined

	return plateSolutionFrom({ ...wcs, NAXIS: 2, NAXIS1: width, NAXIS2: height })
}

// A job of the service while it waits or runs, with its scheduling state.
type JobEntry = AnalysisEntry<PlateSolveJob, JobPreparation>

// Plate solving jobs of the server, their scheduling (see analysis.ts), and their results.
export class PlateSolvingService implements Disposable {
	// Queue, limits, reservations, and kept results.
	readonly #scheduler: AnalysisScheduler<PlateSolveJob, PlateSolveResult, JobPreparation, 'builtin'>
	// Client of the worker of the solver.
	readonly #native = new NativePlateSolver()
	// Generation of the downloaded index bands of the solver, part of the key of its solves.
	#indexGeneration = 0

	// Creates the service over the image store and the External Tools settings, publishing every job change to
	// listener. The results of an image are dropped when the store releases it.
	constructor(
		readonly images: ImageStore,
		readonly tools: ExternalToolsStore,
		readonly listener: PlateSolvingListener,
	) {
		this.#scheduler = new AnalysisScheduler<PlateSolveJob, PlateSolveResult, JobPreparation, 'builtin'>(images, {
			limits: { builtin: CONCURRENCY },
			provider: () => 'builtin',
			execute: (entry) => this.#execute(entry),
			failed: (entry, error) => failure(entry, error),
			cancelled: () => ({ code: 'cancelled', error: 'The plate solve was cancelled' }),
			publish: (job) => this.listener({ type: 'plateSolving:updated', job }),
		})
	}

	// Resolves the settings of the solver for a request, read once, here.
	async prepare(request: PlateSolveRequest): Promise<PlateSolvePreparation> {
		// The built-in solver is always configured: an empty Index Folder stands for its default one.
		const tool = (await this.tools.resolve('nebulosa'))!
		return { request, tool }
	}

	// Returns the hints a solve of an open or retained image would use with a strategy and the operator's hints, or
	// undefined when the image is neither.
	hints(imageId: string, strategy: PlateSolveStrategy, hints?: PlateSolveHints): ResolvedPlateSolveHints | undefined {
		const metadata = this.images.metadata(imageId)
		return metadata && resolvePlateSolveHints(strategy, metadata.header, metadata.acquisition, hints)
	}

	// Submits a solve of an open image, queued in arrival order, as origin (manual by default). An equivalent job still
	// waiting or running, or completed with its result kept, is answered instead of solving again. A preparation,
	// resolved earlier by prepare, keeps the settings it captured instead of reading them again. pixels, given only by a
	// consumer inside the process, are solved in place of the image, for this job only.
	async submit(imageId: string, request: PlateSolveRequest | PlateSolvePreparation, origin: PlateSolveOrigin = MANUAL_ORIGIN, pixels?: PlateSolvePixels): Promise<PlateSolveSubmitOutcome> {
		const preparation = 'strategy' in request ? await this.prepare(request) : request
		if (this.images.name(imageId) === undefined) return { status: 'missing' }

		const job = this.#job(imageId, preparation, origin, pixels?.fingerprint)
		if (!job) return { status: 'missing' }

		const active = this.#scheduler.active(job.key)
		if (active) return { status: 'active', job: active }
		const cached = this.#scheduler.cached(imageId, job.key)
		if (cached) return { status: 'cached', job: cached.job }
		if (this.#scheduler.full()) return { status: 'queueFull' }

		const queued = this.#scheduler.enqueue(imageId, pixels ? { ...preparation, pixels } : preparation, job.key, job.fields)
		return queued ? { status: 'accepted', job: queued } : { status: 'missing' }
	}

	// Solves an open image and resolves to the result once the job completed, for a consumer that needs the
	// solution of one specific image, such as a TPPA frame: the job is bound to that image and is never
	// replaced by a newer frame. A completed job without solution resolves with `outcome: noSolution`. Aborting
	// signal cancels the job this call started; a job it joined, which another requester started and still waits for, is
	// left running and only stops being waited for. Throws PlateSolvingError when the job does not complete. A preparation keeps the
	// settings of the solver for a whole session, as submit does. Pixels are solved in place of the image, as submit does.
	async solve(imageId: string, request: PlateSolveRequest | PlateSolvePreparation, signal?: AbortSignal, origin?: PlateSolveOrigin, pixels?: PlateSolvePixels): Promise<PlateSolveResult> {
		const outcome = await this.submit(imageId, request, origin, pixels)
		if (outcome.status === 'missing') throw new PlateSolvingError('expired', 'The image is not open')
		if (outcome.status === 'queueFull') throw new PlateSolvingError('queueFull', 'Too many plate solves are waiting')

		const { jobId } = outcome.job
		const stored = this.#scheduler.stored(jobId)
		if (outcome.status === 'cached' && stored) return stored.result

		const settled = this.#scheduler.settled(jobId)
		const entry = this.#scheduler.entry(jobId)
		if (!settled || !entry) throw new PlateSolvingError('expired', 'The result is no longer kept')

		// A job this call joined belongs to whoever started it, so giving up only stops the wait.
		const abandoned = Promise.withResolvers<undefined>()
		const cancel = outcome.status === 'accepted' ? () => void this.cancel(jobId) : () => abandoned.resolve(undefined)
		// The signal may have aborted while the request was being submitted.
		if (signal?.aborted) cancel()
		else signal?.addEventListener('abort', cancel, { once: true })

		try {
			const result = await Promise.race([settled, abandoned.promise])
			if (result) return result
			if (signal?.aborted && outcome.status === 'active') throw new PlateSolvingError('cancelled', 'The plate solve stopped being waited for')
			const { code = 'cancelled', error = 'The plate solve did not complete' } = entry.job
			throw new PlateSolvingError(code, error)
		} finally {
			signal?.removeEventListener('abort', cancel)
		}
	}

	// Cancels a job: a waiting one ends at once, a running one is asked to stop between slices of its search. Returns
	// false when the job is not waiting or running.
	cancel(jobId: string): boolean {
		return this.#scheduler.cancel(jobId)
	}

	// Returns a job waiting, running, recently ended, or completed with its result kept.
	job(jobId: string): PlateSolveJob | undefined {
		return this.#scheduler.job(jobId)
	}

	// Returns the result of a completed job while it is kept.
	result(jobId: string): PlateSolveResult | undefined {
		return this.#scheduler.result(jobId)
	}

	// Returns the solutions of an open or retained image: the WCS of its header and the completed jobs whose results
	// are kept; undefined when the image is neither.
	solutions(imageId: string): PlateSolutions | undefined {
		const metadata = this.images.metadata(imageId)
		if (!metadata) return undefined
		const header = validatedSolution(metadata.header, metadata.width, metadata.height)
		return { ...(header && { header }), jobs: this.#scheduler.results(imageId) }
	}

	// Returns the jobs waiting or running and the latest ended ones, oldest first.
	snapshot(): PlateSolveSnapshot {
		return { jobs: this.#scheduler.snapshot() }
	}

	// Returns the fields and the key of a job of an image, with the hints it uses and the fingerprint of the pixels it solves
	// instead of the image; undefined when the image is not open.
	#job(imageId: string, preparation: PlateSolvePreparation, origin: PlateSolveOrigin, fingerprint?: string) {
		const hints = this.hints(imageId, preparation.request.strategy, preparation.request.hints)
		if (!hints) return undefined
		return { key: plateSolveCacheKey(imageId, preparation.request, hints, preparation.tool, fingerprint, this.#indexGeneration), fields: { origin, request: preparation.request, hints } }
	}

	// Tells the service that a downloaded index band of the solver was installed or removed, so a new solve with it
	// searches again instead of answering with a result kept from before, such as a search without a solution made
	// before the band was there. The kept results stay listed with their images.
	indexesChanged() {
		this.#indexGeneration++
	}

	// Runs a job and validates the WCS it found.
	async #execute(entry: JobEntry): Promise<AnalysisCompletion<PlateSolveJob, PlateSolveResult>> {
		const { jobId, hints } = entry.job
		const { request, tool } = entry.preparation
		this.#scheduler.update(jobId, { stage: 'preparing' })

		const { header, warnings: solverWarnings } = await this.#solve(entry)
		const { width, height } = entry.size
		const solution = header && validatedSolution(header, width, height)
		if (header && !solution) throw new PlateSolvingError('invalidSolution', `The solver produced a WCS that is not a solution of this ${width}×${height} image`)

		const elapsed = performance.now() - entry.started!
		const queueTime = entry.job.startedAt! - entry.job.queuedAt
		const summary: PlateSolveSummary = solution
			? { outcome: 'solved', rightAscension: solution.rightAscension, declination: solution.declination, scale: solution.scale, orientation: solution.orientation, parity: solution.parity, width: solution.width, height: solution.height, elapsed }
			: { outcome: 'noSolution', elapsed }
		const result: PlateSolveResult = { ...summary, jobId, imageId: entry.job.imageId, request, hints, tool, ...(solution && { solution }), widthInPixels: width, heightInPixels: height, queueTime, warnings: [...warnings(request, hints, solution), ...solverWarnings] }
		return { patch: { summary }, result }
	}

	// Solves a job on the worker of the solver, over the grayscale copy of the image or its private pixels, with the
	// scale hint widened by the scale tolerance. Resolves to the WCS header, undefined when the search ended without a
	// solution, with the warnings of the solver.
	async #solve(entry: JobEntry): Promise<{ readonly header?: FitsHeader; readonly warnings: readonly string[] }> {
		const { request, tool, pixels } = entry.preparation
		const { jobId, imageId, hints } = entry.job
		const { width, height } = entry.size
		const { signal } = entry.controller
		// Private pixels replace the copy of the image; the image stays retained, so its size and its result are its own.
		const image = pixels ? undefined : await this.images.detectionImage(imageId)
		if (!pixels && !image) throw new PlateSolvingError('expired', 'The image was released before it could be solved')
		if (signal.aborted) throw new PlateSolvingError('cancelled', 'The plate solve was cancelled')

		const tolerance = request.scaleTolerance ?? DEFAULT_SCALE_TOLERANCE
		const scale = hints.scale && { lower: hints.scale.value * (1 - tolerance), upper: hints.scale.value * (1 + tolerance) }
		const position = hints.rightAscension && hints.declination && hints.radius ? { rightAscension: hints.rightAscension.value, declination: hints.declination.value, radius: hints.radius.value } : undefined
		this.#scheduler.update(jobId, { stage: 'solving' })

		try {
			return await this.#native.solve(
				{
					pixels: pixels ? { kind: 'fits', bytes: pixels.bytes } : { kind: 'image', image: image! },
					indexDirectory: tool.indexDirectory?.trim() ?? '',
					width,
					height,
					...(position && { position }),
					...(scale && { scale }),
					timeout: tool.timeout,
				},
				signal,
			)
		} catch (error) {
			if (!(error instanceof NativeSolveError)) throw error
			throw new PlateSolvingError(error.code, error.message)
		}
	}

	// Stops a server in place: cancels every job waiting or running and terminates the worker of the solver, so none
	// outlives the run.
	[Symbol.dispose]() {
		this.#scheduler.cancelAll()
		this.#native[Symbol.dispose]()
	}
}

// Fields of the final state of a job that did not complete.
function failure(entry: JobEntry, error: unknown): Partial<PlateSolveJob> {
	if (entry.controller.signal.aborted) return { state: 'cancelled', code: 'cancelled', error: 'The plate solve was cancelled' }
	if (error instanceof PlateSolvingError) return { state: error.code === 'cancelled' ? 'cancelled' : 'failed', code: error.code, error: error.message }
	return { state: 'failed', code: 'invalidImage', error: Error.isError(error) ? error.message : String(error) }
}

// Conditions worth knowing about a result, meant for people.
function warnings(request: PlateSolveRequest, hints: ResolvedPlateSolveHints, solution: PlateSolution | undefined): string[] {
	const warnings: string[] = []
	if (request.strategy === 'blind' && hints.scale) warnings.push(`The blind search used the scale of the ${hints.scale.source === 'user' ? 'request' : 'optics in the header'}.`)
	if (request.strategy === 'assisted' && !hints.rightAscension) warnings.push('No position was known: the search covered the whole sky.')
	if (hints.rightAscension?.source === 'header') warnings.push('The search center is the pointing recorded in the header.')
	if (hints.radius?.source === 'default') warnings.push('The search radius is the default one.')
	if (!solution) warnings.push('A search without a solution may need index files covering this field and scale.')
	return warnings
}

// Creates the plate solving routes over a service.
export function createPlateSolvingRoutes(service: PlateSolvingService) {
	return {
		'/api/images/:id/plate-solving': {
			// Submits a manual solve (PlateSolveRequest) of an open image. Responds 202 with the queued job, 200 with the job
			// of an equivalent request still waiting or running or completed with its result kept, 404 when the image is not
			// open, and 503 when too many jobs are waiting.
			POST: async (req) => {
				const request = (await req.json()) as PlateSolveRequest
				const outcome = await service.submit(req.params.id, request)
				if (outcome.status === 'missing') return errorResponse('Image not found', 404, 'notFound')
				if (outcome.status === 'queueFull') return errorResponse('Too many plate solves are waiting; try again later', 503, 'queueFull')
				return Response.json(outcome.job, { status: outcome.status === 'accepted' ? 202 : 200 })
			},
		},
		'/api/images/:id/plate-solving/hints': {
			// Hints a solve of an image would use with ?strategy=assisted|blind (assisted by default) and no hint of the
			// operator, with their origins; 404 when the image is not open.
			GET: (req) => {
				const strategy = new URL(req.url).searchParams.get('strategy') === 'blind' ? 'blind' : 'assisted'
				const hints = service.hints(req.params.id, strategy)
				return hints ? Response.json(hints) : errorResponse('Image not found', 404, 'notFound')
			},
		},
		'/api/images/:id/plate-solutions': {
			// Solutions of an image: the WCS of its header and the completed jobs whose results are kept; 404 when the image
			// is not open.
			GET: (req) => {
				const solutions = service.solutions(req.params.id)
				return solutions ? Response.json(solutions) : errorResponse('Image not found', 404, 'notFound')
			},
		},
		'/api/plate-solving': {
			// Jobs waiting or running and the latest ended ones, for a tab that (re)connects.
			GET: () => Response.json(service.snapshot()),
		},
		'/api/plate-solving/:jobId': {
			// A job; 404 when it is unknown or long forgotten.
			GET: (req) => {
				const job = service.job(req.params.jobId)
				return job ? Response.json(job) : errorResponse('Plate solve not found', 404, 'notFound')
			},
		},
		'/api/plate-solving/:jobId/result': {
			// The full result of a completed job, with the WCS; 404 with code expired when it is not kept (anymore).
			GET: (req) => {
				const result = service.result(req.params.jobId)
				return result ? Response.json(result) : errorResponse('The result is not available', 404, 'expired')
			},
		},
		'/api/plate-solving/:jobId/cancel': {
			// Cancels a waiting or running job; the end arrives as a plateSolving:updated event. 404 when it is neither.
			POST: (req) => (service.cancel(req.params.jobId) ? new Response(null, { status: 204 }) : errorResponse('The plate solve is not waiting or running', 404, 'notFound')),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
