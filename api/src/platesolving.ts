import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { astapPlateSolve } from 'nebulosa/src/astrometry/solvers/astap'
import { localAstrometryNetPlateSolve } from 'nebulosa/src/astrometry/solvers/astrometrynet'
import { type PlateSolution, PlateSolveError, plateSolutionFrom } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { heightKeyword, widthKeyword } from 'nebulosa/src/io/formats/fits/util'
import { type AnalysisCompletion, type AnalysisEntry, type AnalysisJob, type AnalysisJobState, AnalysisScheduler } from './analysis'
import { type ExternalToolConfig, type ExternalToolId, type ExternalToolsStore, type ResolvedExternalTool, serviceUrl } from './externaltools'
import type { ImageStore } from './images'
import { type PlateSolveHints, type PlateSolveStrategy, POINTING_KEYWORDS, type ResolvedPlateSolveHints, resolvePlateSolveHints } from './platesolving.hints'
import { NOVA_POLL_INTERVAL, NovaError, type NovaStage, novaSolve } from './platesolving.nova'

// Plate solving service of the manual solves of the Images workspace, on files and camera frames alike. A solve finds the World Coordinate System of an image document
// of the image store, addressed by its id (a document never changes, so the id is its scientific identity), with
// one of three providers configured in External Tools, whose settings are resolved once per job (or once per
// capture session) and never come from a request: ASTAP and the local solve-field of astrometry.net, run on a FITS
// copy of the document in a directory of their own, and the nova.astrometry.net web service, to which the copy is
// uploaded once. There is no fallback between providers: a local failure never uploads an image.
//
// The result keeps the whole WCS header of the solver (CD matrix, SIP terms, frame) as the toolkit's PlateSolution,
// whose center, scale, orientation, parity, and field size are radians of the ICRS. A solution is accepted only when
// plateSolutionFrom proves it (an equatorial TAN or TAN-SIP solution in the ICRS or FK5 J2000) and it describes an
// image of the size of the document; a solver that ended normally without one found no solution, which is not a
// failure. Hints come from the operator, then from the header (see platesolving.hints.ts), and the job keeps those it
// used with their origins. The WCS a header already had is reported apart, never replaced, and no file is written.
//
// Jobs run in memory under the shared analysis scheduling (analysis.ts): one ASTAP and one solve-field process and
// two nova solves at a time, at most MAX_QUEUED jobs waiting, in arrival order. A job
// retains its image until it ends. An equivalent request is answered with the job already waiting or running, or
// with its kept result, so a repeated request never solves twice. Results are kept only in memory until their image
// is released; a nova job is not followed again after a restart. Every change of a job is published as a compact
// plateSolving:updated event without the WCS. No device is held, and nothing moves a mount.

// Plate solver of a job.
export type PlateSolverProvider = 'astap' | 'astrometryLocal' | 'nova'

// What a plate solve searches and how.
export interface PlateSolveRequest {
	// Solver.
	readonly provider: PlateSolverProvider
	// Search around a known position, or over the whole sky.
	readonly strategy: PlateSolveStrategy
	// Hints of the operator; the image supplies the missing ones.
	readonly hints?: PlateSolveHints
	// Fractional tolerance of the scale hint, in (0, 1); DEFAULT_SCALE_TOLERANCE when absent. Only nova takes it.
	readonly scaleTolerance?: number
	// Downsampling factor applied before detecting stars, a positive integer; the provider's default when absent.
	readonly downsample?: number
}

// Who asked for a plate solve: a person, in Images.
export type PlateSolveOrigin = { readonly kind: 'manual' }

// State of a job: waiting for its solver, running, or ended (completed, failed, or cancelled).
export type PlateSolveJobState = AnalysisJobState

// Step a running job reached: preparing the image, solving it locally, or a step of a nova solve.
export type PlateSolveStage = 'preparing' | 'solving' | NovaStage

// Why a job did not complete:
// - queueFull: too many jobs were waiting when it was submitted.
// - notConfigured: the provider is not configured in External Tools (nova: not signed in).
// - unavailable: the solver could not be started.
// - timeout: the solve ran longer than the provider's timeout.
// - failed: the solver reported an error, or the service refused the upload.
// - invalidSolution: the solver produced a WCS that is not a valid solution of the image.
// - invalidImage: the image could not be prepared for the solver.
// - cancelled: the job was cancelled (for nova, only the following of the remote job).
// - expired: the image was released before the job could read it, or the result is no longer kept.
// - sessionExpired: nova refused the saved session; signing in again is needed.
// - network: nova could not be reached.
export type PlateSolveErrorCode = 'queueFull' | 'notConfigured' | 'unavailable' | 'timeout' | 'failed' | 'invalidSolution' | 'invalidImage' | 'cancelled' | 'expired' | 'sessionExpired' | 'network'

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

// Ids of a nova job on the service.
export interface PlateSolveRemote {
	// Id of the submission of the upload.
	readonly submissionId?: number
	// Id of the job the service created for it.
	readonly jobId?: number
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
	// Ids of a nova job on the service.
	readonly remote?: PlateSolveRemote
	// Why it did not complete, when it failed or was cancelled.
	readonly code?: PlateSolveErrorCode
	// Detail of the failure meant for people.
	readonly error?: string
	// Summary, once completed.
	readonly summary?: PlateSolveSummary
}

// Settings a job ran with, without the session of nova.
export type PlateSolverSettings = Readonly<ExternalToolConfig>

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
	// Settings of the provider.
	readonly tool: PlateSolverSettings
	// The solution, with the whole WCS header of the solver, when solved.
	readonly solution?: PlateSolution
	// Ids of a nova job on the service.
	readonly remote?: PlateSolveRemote
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

// Request whose provider settings were resolved, ready to be submitted: they are a snapshot taken when it was
// prepared, so a later save of the External Tools settings applies to later preparations.
export interface PlateSolvePreparation {
	// What to search and how.
	readonly request: PlateSolveRequest
	// Settings of the provider, with the session of nova.
	readonly tool: Readonly<ResolvedExternalTool>
}

// Outcome of a submission: a new job, the job of an equivalent request still waiting or running (active), the
// completed job of an equivalent earlier one (cached), or why there is none.
export type PlateSolveSubmitOutcome =
	| { readonly status: 'accepted'; readonly job: PlateSolveJob }
	| { readonly status: 'active'; readonly job: PlateSolveJob }
	| { readonly status: 'cached'; readonly job: PlateSolveJob }
	| { readonly status: 'missing' }
	| { readonly status: 'notConfigured' }
	| { readonly status: 'queueFull' }

// Options of the service.
export interface PlateSolvingOptions {
	// Wait between two polls of a nova job, in milliseconds.
	readonly novaPollInterval?: number
}

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

// External Tools entry of each provider.
const PROVIDER_TOOLS: Readonly<Record<PlateSolverProvider, ExternalToolId>> = { astap: 'astap', astrometryLocal: 'astrometryLocal', nova: 'nova' }

// Name of each provider, for messages.
const PROVIDER_NAMES: Readonly<Record<PlateSolverProvider, string>> = { astap: 'ASTAP', astrometryLocal: 'Astrometry.net Local', nova: 'Nova Astrometry.net' }

// Solves running at once: one ASTAP and one solve-field process, each a full multithreaded program with a FITS copy on
// disk; two nova solves, which mostly wait for the service.
const PROVIDER_LIMITS: Readonly<Record<PlateSolverProvider, number>> = { astap: 1, astrometryLocal: 1, nova: 2 }

// Fractional tolerance of a scale hint when the request gives none.
export const DEFAULT_SCALE_TOLERANCE = 0.2

// Downsampling of each provider when the request gives none: ASTAP chooses (0), solve-field and nova halve.
const DEFAULT_DOWNSAMPLE: Readonly<Record<PlateSolverProvider, number>> = { astap: 0, astrometryLocal: 2, nova: 2 }

// Pixels a solution's image size may differ from the document: ASTAP rebuilds NAXIS1/NAXIS2 from CRPIX, which rounds an
// odd size down by one.
const SIZE_TOLERANCE = 1

// Fields the toolkit's PlateSolution derives from a header, left out when a solution is rebuilt from its header.
const DERIVED_FIELDS = new Set(['orientation', 'scale', 'width', 'height', 'parity', 'radius', 'widthInPixels', 'heightInPixels', 'rightAscension', 'declination'])

// Origin of a solve a person asked for.
const MANUAL_ORIGIN: PlateSolveOrigin = { kind: 'manual' }

// Returns the key of an equivalent solve: the same image, provider, strategy, effective hints, tolerance,
// downsampling, and provider settings. The timeout and the session are left out, since they do not change a result.
export function plateSolveCacheKey(imageId: string, { provider, strategy, scaleTolerance, downsample }: PlateSolveRequest, hints: ResolvedPlateSolveHints, tool: ExternalToolConfig): string {
	const values = [hints.rightAscension?.value, hints.declination?.value, hints.radius?.value, hints.scale?.value]
	return JSON.stringify([imageId, provider, strategy, values, scaleTolerance ?? DEFAULT_SCALE_TOLERANCE, downsample || DEFAULT_DOWNSAMPLE[provider], tool.executable, tool.config ?? '', tool.endpoint ?? ''])
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
type JobEntry = AnalysisEntry<PlateSolveJob, PlateSolvePreparation>

// Plate solving jobs of the server, their scheduling (see analysis.ts), and their results.
export class PlateSolvingService {
	// Queue, limits, reservations, and kept results.
	readonly #scheduler: AnalysisScheduler<PlateSolveJob, PlateSolveResult, PlateSolvePreparation, PlateSolverProvider>
	// Wait between two polls of a nova job, in milliseconds.
	readonly #pollInterval: number

	// Creates the service over the image store and the External Tools settings, publishing every job change to
	// listener. The results of an image are dropped when the store releases it.
	constructor(
		readonly images: ImageStore,
		readonly tools: ExternalToolsStore,
		readonly listener: PlateSolvingListener,
		{ novaPollInterval = NOVA_POLL_INTERVAL }: PlateSolvingOptions = {},
	) {
		this.#pollInterval = novaPollInterval
		this.#scheduler = new AnalysisScheduler<PlateSolveJob, PlateSolveResult, PlateSolvePreparation, PlateSolverProvider>(images, {
			limits: PROVIDER_LIMITS,
			provider: (preparation) => preparation.request.provider,
			execute: (entry) => this.#execute(entry),
			failed: (entry, error) => failure(entry, error),
			cancelled: () => ({ code: 'cancelled', error: 'The plate solve was cancelled' }),
			publish: (job) => this.listener({ type: 'plateSolving:updated', job }),
		})
	}

	// Resolves the provider settings of a request, read once, here. Resolves to undefined when the provider is not
	// configured (nova: not signed in).
	async prepare(request: PlateSolveRequest): Promise<PlateSolvePreparation | undefined> {
		const tool = await this.tools.resolve(PROVIDER_TOOLS[request.provider])
		return tool && { request, tool }
	}

	// Returns the hints a solve of an open or retained image would use with a strategy and the operator's hints, or
	// undefined when the image is neither.
	hints(imageId: string, strategy: PlateSolveStrategy, hints?: PlateSolveHints): ResolvedPlateSolveHints | undefined {
		const metadata = this.images.metadata(imageId)
		return metadata && resolvePlateSolveHints(strategy, metadata.header, metadata.acquisition, hints)
	}

	// Submits a solve of an open image with the manual priority, as origin (manual by default). An equivalent job still
	// waiting or running, or completed with its result kept, is answered instead of solving again. A preparation,
	// resolved earlier by prepare, keeps the settings it captured instead of reading them again.
	async submit(imageId: string, request: PlateSolveRequest | PlateSolvePreparation, origin: PlateSolveOrigin = MANUAL_ORIGIN): Promise<PlateSolveSubmitOutcome> {
		const preparation = 'provider' in request ? await this.prepare(request) : request
		if (!preparation) return { status: 'notConfigured' }
		if (this.images.name(imageId) === undefined) return { status: 'missing' }

		const job = this.#job(imageId, preparation, origin)
		if (!job) return { status: 'missing' }

		const active = this.#scheduler.active(job.key)
		if (active) return { status: 'active', job: active }
		const cached = this.#scheduler.cached(imageId, job.key)
		if (cached) return { status: 'cached', job: cached.job }
		if (this.#scheduler.full()) return { status: 'queueFull' }

		const queued = this.#scheduler.enqueue(imageId, preparation, job.key, job.fields)
		return queued ? { status: 'accepted', job: queued } : { status: 'missing' }
	}

	// Cancels a job: a waiting one ends at once, a running one is interrupted (ASTAP and solve-field are killed; nova
	// stops being followed, while the service may still solve it). Returns false when the job is not waiting or running.
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

	// Returns the fields and the key of a job of an image, with the hints it uses; undefined when the image is not open.
	#job(imageId: string, preparation: PlateSolvePreparation, origin: PlateSolveOrigin) {
		const hints = this.hints(imageId, preparation.request.strategy, preparation.request.hints)
		if (!hints) return undefined
		return { key: plateSolveCacheKey(imageId, preparation.request, hints, preparation.tool), fields: { origin, request: preparation.request, hints } }
	}

	// Runs a job with its provider and validates the WCS it found.
	async #execute(entry: JobEntry): Promise<AnalysisCompletion<PlateSolveJob, PlateSolveResult>> {
		const { jobId, imageId, hints } = entry.job
		const { request } = entry.preparation
		this.#scheduler.update(jobId, { stage: 'preparing' })

		const bytes = await this.images.detectionFile(imageId, request.strategy === 'blind' ? POINTING_KEYWORDS : undefined)
		if (!bytes) throw new PlateSolvingError('expired', 'The image was released before it could be solved')
		if (entry.controller.signal.aborted) throw new PlateSolvingError('cancelled', 'The plate solve was cancelled')

		const header = request.provider === 'nova' ? await this.#solveNova(entry, bytes) : await this.#solveLocal(entry, bytes)
		const { width, height } = entry.size
		const solution = header && validatedSolution(header, width, height)
		if (header && !solution) throw new PlateSolvingError('invalidSolution', `${PROVIDER_NAMES[request.provider]} produced a WCS that is not a solution of this ${width}×${height} image`)

		const elapsed = performance.now() - entry.started!
		const queueTime = entry.job.startedAt! - entry.job.queuedAt
		const summary: PlateSolveSummary = solution
			? { outcome: 'solved', rightAscension: solution.rightAscension, declination: solution.declination, scale: solution.scale, orientation: solution.orientation, parity: solution.parity, width: solution.width, height: solution.height, elapsed }
			: { outcome: 'noSolution', elapsed }
		const { session: _, ...tool } = entry.preparation.tool
		const remote = this.#scheduler.job(jobId)?.remote
		const result: PlateSolveResult = { ...summary, jobId, imageId, request, hints, tool, ...(solution && { solution }), ...(remote && { remote }), widthInPixels: width, heightInPixels: height, queueTime, warnings: warnings(request, hints, solution) }
		return { patch: { summary }, result }
	}

	// Solves a job with ASTAP or solve-field on a FITS copy of the image, in a directory of its own removed afterwards.
	// Resolves to the WCS header, or undefined when the search ended without a solution.
	async #solveLocal(entry: JobEntry, bytes: Uint8Array<ArrayBuffer>): Promise<FitsHeader | undefined> {
		const { request, tool } = entry.preparation
		const { hints } = entry.job
		const { width, height } = entry.size
		const { signal } = entry.controller
		const directory = await mkdtemp(join(tmpdir(), 'nebulosa-solve-'))
		const position = hints.rightAscension && hints.declination && hints.radius ? { rightAscension: hints.rightAscension.value, declination: hints.declination.value, radius: hints.radius.value } : {}
		const downsample = request.downsample || DEFAULT_DOWNSAMPLE[request.provider]
		const scale = hints.scale?.value

		try {
			const input = join(directory, 'image.fits')
			await Bun.write(input, bytes)
			this.#scheduler.update(entry.job.jobId, { stage: 'solving' })

			// ASTAP takes the field height, solve-field the field width, both radians; 0 lets the solver find it.
			if (request.provider === 'astap') return await astapPlateSolve(input, { executable: tool.executable, timeout: tool.timeout, downsample, fov: scale === undefined ? 0 : scale * height, ...position }, signal)
			return await localAstrometryNetPlateSolve(input, { executable: tool.executable, config: tool.config, timeout: tool.timeout, downsample, fov: scale === undefined ? 0 : scale * width, ...position }, signal)
		} catch (error) {
			if (!(error instanceof PlateSolveError)) throw error
			if (error.code === 'aborted') throw new PlateSolvingError('cancelled', 'The plate solve was cancelled')
			throw new PlateSolvingError(error.code, error.message)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	}

	// Solves a job on nova, publishing every step and the remote ids. Resolves to the WCS header, or undefined when the
	// remote job failed.
	async #solveNova(entry: JobEntry, image: Uint8Array<ArrayBuffer>): Promise<FitsHeader | undefined> {
		const { request, tool } = entry.preparation
		const apiUrl = serviceUrl(tool.endpoint)
		if (!apiUrl || !tool.session) throw new PlateSolvingError('notConfigured', 'Nova Astrometry.net is not signed in')

		try {
			return await novaSolve({
				apiUrl,
				session: tool.session,
				image,
				hints: entry.job.hints,
				scaleTolerance: request.scaleTolerance ?? DEFAULT_SCALE_TOLERANCE,
				downsample: request.downsample || DEFAULT_DOWNSAMPLE.nova,
				timeout: tool.timeout,
				pollInterval: this.#pollInterval,
				signal: entry.controller.signal,
				progress: ({ stage, submissionId, jobId }) => this.#scheduler.update(entry.job.jobId, { stage, ...(submissionId !== undefined && { remote: { submissionId, ...(jobId !== undefined && { jobId }) } }) }),
			})
		} catch (error) {
			if (!(error instanceof NovaError)) throw error
			if (error.code === 'rejected') throw new PlateSolvingError('failed', error.message)
			if (error.code === 'invalidWcs') throw new PlateSolvingError('invalidSolution', error.message)
			throw new PlateSolvingError(error.code, error.message)
		}
	}
}

// Fields of the final state of a job that did not complete.
function failure(entry: JobEntry, error: unknown): Partial<PlateSolveJob> {
	const remote = entry.preparation.request.provider === 'nova' && entry.job.remote?.submissionId !== undefined
	const cancelled = remote ? 'The plate solve was cancelled; the remote job on nova was not stopped' : 'The plate solve was cancelled'
	if (entry.controller.signal.aborted) return { state: 'cancelled', code: 'cancelled', error: cancelled }
	if (error instanceof PlateSolvingError) return { state: error.code === 'cancelled' ? 'cancelled' : 'failed', code: error.code, error: error.code === 'cancelled' ? cancelled : error.message }
	return { state: 'failed', code: 'invalidImage', error: Error.isError(error) ? error.message : String(error) }
}

// Conditions worth knowing about a result, meant for people.
function warnings(request: PlateSolveRequest, hints: ResolvedPlateSolveHints, solution: PlateSolution | undefined): string[] {
	const warnings: string[] = []
	if (request.strategy === 'blind' && hints.scale) warnings.push(`The blind search used the scale of the ${hints.scale.source === 'user' ? 'request' : 'optics in the header'}.`)
	if (request.strategy === 'assisted' && !hints.rightAscension) warnings.push('No position was known: the search covered the whole sky.')
	if (hints.rightAscension?.source === 'header') warnings.push('The search center is the pointing recorded in the header.')
	if (hints.radius?.source === 'default') warnings.push('The search radius is the default one.')
	if (request.scaleTolerance !== undefined && request.provider !== 'nova') warnings.push(`${PROVIDER_NAMES[request.provider]} applies its own scale tolerance.`)
	if (!solution && request.provider !== 'nova') warnings.push('A search without a solution may need index files or a star database covering this field and scale.')
	return warnings
}

// Responds with an error message, its code, and a status.
function errorResponse(message: string, code: PlateSolveErrorCode | 'notFound', status: number): Response {
	return Response.json({ error: message, code }, { status })
}

// Creates the plate solving routes over a service.
export function createPlateSolvingRoutes(service: PlateSolvingService) {
	return {
		'/api/images/:id/plate-solving': {
			// Submits a manual solve (PlateSolveRequest) of an open image. Responds 202 with the queued job, 200 with the job
			// of an equivalent request still waiting or running or completed with its result kept, 404 when the image is not
			// open, 422 when the provider is not configured, and 503 when too many jobs are waiting.
			POST: async (req) => {
				const request = (await req.json()) as PlateSolveRequest
				const outcome = await service.submit(req.params.id, request)
				if (outcome.status === 'missing') return errorResponse('Image not found', 'notFound', 404)
				if (outcome.status === 'notConfigured') return errorResponse(`${PROVIDER_NAMES[request.provider]} is not configured; set it up in Settings → External Tools`, 'notConfigured', 422)
				if (outcome.status === 'queueFull') return errorResponse('Too many plate solves are waiting; try again later', 'queueFull', 503)
				return Response.json(outcome.job, { status: outcome.status === 'accepted' ? 202 : 200 })
			},
		},
		'/api/images/:id/plate-solving/hints': {
			// Hints a solve of an image would use with ?strategy=assisted|blind (assisted by default) and no hint of the
			// operator, with their origins; 404 when the image is not open.
			GET: (req) => {
				const strategy = new URL(req.url).searchParams.get('strategy') === 'blind' ? 'blind' : 'assisted'
				const hints = service.hints(req.params.id, strategy)
				return hints ? Response.json(hints) : errorResponse('Image not found', 'notFound', 404)
			},
		},
		'/api/images/:id/plate-solutions': {
			// Solutions of an image: the WCS of its header and the completed jobs whose results are kept; 404 when the image
			// is not open.
			GET: (req) => {
				const solutions = service.solutions(req.params.id)
				return solutions ? Response.json(solutions) : errorResponse('Image not found', 'notFound', 404)
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
				return job ? Response.json(job) : errorResponse('Plate solve not found', 'notFound', 404)
			},
		},
		'/api/plate-solving/:jobId/result': {
			// The full result of a completed job, with the WCS; 404 with code expired when it is not kept (anymore).
			GET: (req) => {
				const result = service.result(req.params.jobId)
				return result ? Response.json(result) : errorResponse('The result is not available', 'expired', 404)
			},
		},
		'/api/plate-solving/:jobId/cancel': {
			// Cancels a waiting or running job; the end arrives as a plateSolving:updated event. 404 when it is neither.
			POST: (req) => new Response(null, { status: service.cancel(req.params.jobId) ? 204 : 404 }),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
