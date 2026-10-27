import type { CfaPattern, Image } from 'nebulosa/src/imaging/model/types'
import type { BackgroundColorMode, BackgroundExtractionClipping, BackgroundModelType } from 'nebulosa/src/imaging/processing/background'
import type { MultiscaleTransformLayerOptions } from 'nebulosa/src/imaging/processing/multiscale'
import type { BackgroundNeutralizationMode } from 'nebulosa/src/imaging/processing/neutralization'
import { type AnalysisCompletion, type AnalysisEntry, type AnalysisJob, AnalysisScheduler } from './analysis'
import { errorResponse } from './http'
import type { ImageInfo, ImageStore } from './images'

// Image processing pipelines of the Images workspace: an ordered list of single-image operations of the toolkit
// applied to a copy of the scientific pixels of an image document, whose result is adopted as one new derived
// document only when every step succeeded. The source document is never changed: the image store hands a full
// copy of it (ImageStore.processingImage) to a worker thread of its own (imageprocessing.worker.ts), which runs the
// steps in order and hands the result back to be adopted (ImageStore.adopt).
//
// Jobs run in memory under the shared analysis scheduling (analysis.ts): one pipeline at a time, at most
// MAX_QUEUED waiting, in arrival order, and at most one waiting or running pipeline per source image. A job retains
// its source until it ends, so closing the document never pulls the pixels from under it. A running pipeline is
// cancelled, or stopped after PROCESSING_TIMEOUT, by terminating its worker. What a pipeline can apply to an image
// is checked when it is submitted, from the channels and CFA pattern of the source (checkPipeline); the
// parameters are the toolkit's own, which clamps them. Every change of a job is published as a compact
// imageProcessing:updated event.
//
// The document a completed job adopted is handed to the client that asked for it by a claim; one never claimed
// within CLAIM_GRACE is closed, so a tab that disappeared leaves no orphan document behind. Nothing is persisted
// and no device is held.

// Time a pipeline may run, in milliseconds, before its worker is terminated: multiscale transforms and background
// extraction of a large RGB image take minutes.
const PROCESSING_TIMEOUT = 600000

// Time the adopted document of a completed job waits to be claimed, in milliseconds, before it is closed.
export const CLAIM_GRACE = 600000

// Pipelines running at once, one worker each: a run holds the working copy and the scratch buffers of its
// steps, several times the size of the image.
const PROCESSING_CONCURRENCY = 1

// Debayering of a mono CFA mosaic with the trusted pattern of the image (auto) or an explicit one.
export interface DebayerOperation {
	readonly type: 'debayer'
	// CFA pattern at the image origin, or auto for the trusted pattern of the image.
	readonly pattern: 'auto' | CfaPattern
}

// Automatic background extraction (the toolkit's automaticBackgroundExtraction); the correction never is none.
export interface BackgroundExtractionOperation {
	readonly type: 'backgroundExtraction'
	// Surface model of the background.
	readonly model: BackgroundModelType
	// Degree of the polynomial surface, 1 to 6.
	readonly degree: number
	// Thin-plate spline regularization, non-negative; ignored by the polynomial model.
	readonly smoothing: number
	// Sample boxes along the longer image axis, 2 to 128.
	readonly gridSize: number
	// Sigma multiple of the box dispersion that rejects a contaminated box, non-negative.
	readonly tolerance: number
	// Sigma multiple of the residual that rejects a sample below the surface, non-negative.
	readonly rejectionLow: number
	// Sigma multiple of the residual that rejects a sample above the surface, non-negative.
	readonly rejectionHigh: number
	// Fit, reject, and refit iterations, non-negative; 0 disables rejection.
	readonly rejectionIterations: number
	// How an RGB image is modeled: one surface per channel, or one from the luminance.
	readonly colorMode: BackgroundColorMode
	// How the background is removed from the image.
	readonly correction: 'subtract' | 'divide'
	// How out-of-range corrected values are brought back to [0, 1].
	readonly clipping: BackgroundExtractionClipping
	// Background level restored after the correction, in [0, 1]; absent for the mean of the model.
	readonly targetBackground?: number
}

// Background neutralization of an RGB image (the toolkit's backgroundNeutralization).
export interface BackgroundNeutralizationOperation {
	readonly type: 'backgroundNeutralization'
	// Lower limit of the reference background samples, in [0, 1].
	readonly lowerLimit: number
	// Upper limit of the reference background samples, in [0, 1].
	readonly upperLimit: number
	// Background level of the targetBackground mode, in [0, 1].
	readonly targetBackground: number
	// How the neutralized values are brought back to [0, 1].
	readonly mode: BackgroundNeutralizationMode
}

// Arcsinh stretch (the toolkit's arcsinhStretch), in the BT.709 working space when it uses one.
export interface ArcsinhStretchOperation {
	readonly type: 'arcsinhStretch'
	// Strength of the stretch, at least 1 (no stretch).
	readonly stretchFactor: number
	// Level clipped to black before stretching, in [0, 1].
	readonly blackPoint: number
	// Whether the colour ratios of the highlights are preserved by scaling the whole image instead of clipping.
	readonly protectHighlights: boolean
	// Whether an RGB image is stretched by its BT.709 luminance instead of the mean of its channels.
	readonly useRgbWorkingSpace: boolean
}

// Multiscale linear (MLT) or median (MMT) transform of the toolkit.
export interface MultiscaleOperation {
	readonly type: 'mlt' | 'mmt'
	// Dyadic detail layers, non-negative.
	readonly layers: number
	// Denoise threshold, amount, and bias of each detail layer, from the finest.
	readonly detailLayers: readonly MultiscaleTransformLayerOptions[]
	// Gain of the smooth residual layer; 1 keeps it.
	readonly residualGain: number
}

// Gaussian blur (the toolkit's gaussianBlur).
export interface GaussianBlurOperation {
	readonly type: 'gaussianBlur'
	// Standard deviation of the Gaussian, in pixels, 0.5 to 5.
	readonly sigma: number
	// Side of the kernel, in pixels: odd, at least 3.
	readonly size: number
}

// Automatic cosmetic correction of hot and cold pixels (the toolkit's cosmeticCorrection), by colour phase on a
// CFA mosaic.
export interface CosmeticCorrectionOperation {
	readonly type: 'cosmeticCorrection'
	// Sigma multiple above the local median that marks a hot pixel, non-negative; 0 disables it.
	readonly hotSigma: number
	// Sigma multiple below the local median that marks a cold pixel, non-negative; 0 disables it.
	readonly coldSigma: number
	// Half-size of the local median window, in pixels, at least 1.
	readonly windowRadius: number
	// Blend of the repair, in [0, 1]; 1 replaces the pixel.
	readonly amount: number
}

// Conversion of an RGB image to mono: the BT.709 luminance (GRAY) or one channel.
export interface GrayscaleOperation {
	readonly type: 'grayscale'
	// Luminance or channel kept.
	readonly channel: 'GRAY' | 'RED' | 'GREEN' | 'BLUE'
}

// Operation without parameters: a 3×3 sharpen kernel, or a mirror of the image (and its WCS and CFA phase).
export interface PlainOperation {
	readonly type: 'sharpen' | 'horizontalFlip' | 'verticalFlip'
}

// One operation of a pipeline and its parameters.
export type ImageProcessingOperation = DebayerOperation | BackgroundExtractionOperation | BackgroundNeutralizationOperation | ArcsinhStretchOperation | MultiscaleOperation | GaussianBlurOperation | CosmeticCorrectionOperation | GrayscaleOperation | PlainOperation

// Type of an operation.
export type ImageProcessingOperationType = ImageProcessingOperation['type']

// A step of a pipeline as submitted: only the enabled steps of the editor, in order.
export interface ImageProcessingStep {
	// Id of the step in the editor, unique within the pipeline; names the step a failure belongs to.
	readonly id: string
	// Operation applied.
	readonly operation: ImageProcessingOperation
}

// Body of POST /api/images/:id/processing.
export interface ImageProcessingRequest {
	// Steps to apply, in order; never empty.
	readonly steps: readonly ImageProcessingStep[]
}

// Why a pipeline was refused or did not complete:
// - notFound: the source image is not open, or the job is unknown.
// - busy: a pipeline of the source image is already waiting or running.
// - queueFull: too many pipelines were waiting.
// - incompatibleImage: a step cannot apply to the image it would receive (errorStepId names it).
// - processingFailed: a step threw (errorStepId names it).
// - workerFailed: the worker died.
// - timeout: the pipeline ran longer than PROCESSING_TIMEOUT.
// - cancelled: the job was cancelled.
// - expired: the source was released before the job could read it, or the output is no longer available.
// - invalidState: the job did not complete, so it has no output to claim.
export type ImageProcessingErrorCode = 'notFound' | 'busy' | 'queueFull' | 'incompatibleImage' | 'processingFailed' | 'workerFailed' | 'timeout' | 'cancelled' | 'expired' | 'invalidState'

// A pipeline job as published to clients; never carries pixels, headers, or paths.
export interface ImageProcessingJob extends AnalysisJob {
	// Steps applied, in order: the immutable snapshot of the submission.
	readonly steps: readonly ImageProcessingStep[]
	// Index in steps of the step running; absent while waiting and once ended.
	readonly currentStepIndex?: number
	// Steps finished.
	readonly completedSteps: number
	// Id of the derived document adopted; only once completed.
	readonly outputImageId?: string
	// Why it did not complete.
	readonly code?: ImageProcessingErrorCode
	// Description of the failure, for people.
	readonly error?: string
	// Id of the step that failed, when the failure belongs to one.
	readonly errorStepId?: string
}

// Snapshot of GET /api/image-processing: the jobs waiting or running, and the latest ended ones.
export interface ImageProcessingSnapshot {
	// Jobs, oldest first.
	readonly jobs: readonly ImageProcessingJob[]
}

// Notification published whenever a job changes.
export interface ImageProcessingEvent {
	readonly type: 'imageProcessing:updated'
	// New state of the job.
	readonly job: ImageProcessingJob
}

// Receiver of image processing events.
export type ImageProcessingListener = (event: ImageProcessingEvent) => void

// What a pipeline is checked against: the channels and CFA pattern of an image.
export interface ImageDescriptor {
	// Number of channels: 1 for grayscale or a raw CFA mosaic, 3 for RGB.
	readonly channels: number
	// Trusted CFA pattern of a raw mosaic; absent otherwise.
	readonly cfa?: CfaPattern
}

// A step that cannot apply to the image it would receive, and why.
export interface IncompatibleStep {
	// Id of the step.
	readonly stepId: string
	// Why, for people.
	readonly error: string
}

// Operations with a defined meaning on a raw CFA mosaic: they follow the colour phases (cosmetic correction),
// keep them in phase (flips), or turn the mosaic into RGB (debayer).
const CFA_OPERATIONS: ReadonlySet<ImageProcessingOperationType> = new Set(['debayer', 'cosmeticCorrection', 'horizontalFlip', 'verticalFlip'])

// Returns the first step that cannot apply to the image it would receive, following what each step makes of the
// channels and CFA pattern of image: debayer needs a mono image and a pattern (the trusted one for auto) and makes
// RGB; grayscale makes mono; background neutralization needs RGB; a raw CFA mosaic takes only CFA_OPERATIONS.
// Returns undefined when every step applies.
export function checkPipeline(image: ImageDescriptor, steps: readonly ImageProcessingStep[]): IncompatibleStep | undefined {
	let { channels, cfa } = image

	for (const { id, operation } of steps) {
		const mosaic = channels === 1 && cfa !== undefined
		if (mosaic && !CFA_OPERATIONS.has(operation.type)) return { stepId: id, error: 'This step cannot apply to a raw CFA mosaic; debayer it first' }

		if (operation.type === 'debayer') {
			if (channels !== 1) return { stepId: id, error: 'Debayer needs a mono CFA mosaic' }
			if (operation.pattern === 'auto' && cfa === undefined) return { stepId: id, error: 'The image has no known CFA pattern; choose one to debayer it' }
			channels = 3
			cfa = undefined
		} else if (operation.type === 'backgroundNeutralization') {
			if (channels !== 3) return { stepId: id, error: 'Background neutralization needs an RGB image' }
		} else if (operation.type === 'grayscale') {
			channels = 1
		}
	}

	return undefined
}

// Request to the processing worker: the working copy it owns from now on and the steps to apply.
export interface ProcessingWorkerRequest {
	// Id of the job, echoed by the responses.
	readonly jobId: string
	// Full copy of the source image (see ImageStore.processingImage).
	readonly image: Image
	// Steps to apply, in order.
	readonly steps: readonly ImageProcessingStep[]
}

// Response of the processing worker: a step started (by index), the result, which the worker no longer owns, or
// the step that threw.
export type ProcessingWorkerResponse = { readonly jobId: string; readonly status: 'step'; readonly index: number } | { readonly jobId: string; readonly status: 'processed'; readonly image: Image } | { readonly jobId: string; readonly status: 'failed'; readonly stepId: string; readonly error: string }

// What a job runs with: its steps and the name of its source when it was submitted.
export interface ImageProcessingPreparation {
	// Steps to apply, in order.
	readonly steps: readonly ImageProcessingStep[]
	// Name of the source document, which names the output.
	readonly sourceName: string
}

// Full result of a completed job.
export interface ImageProcessingResult {
	// Id of the derived document adopted.
	readonly outputImageId: string
}

// Outcome of a submission: the queued job, or why there is none.
export type ImageProcessingSubmitOutcome = { readonly status: 'accepted'; readonly job: ImageProcessingJob } | { readonly status: 'missing' } | { readonly status: 'busy'; readonly job: ImageProcessingJob } | { readonly status: 'incompatible'; readonly step: IncompatibleStep } | { readonly status: 'queueFull' }

// Outcome of a claim: the output document, or why there is none (see ImageProcessingErrorCode).
export type ImageProcessingClaimOutcome = { readonly status: 'claimed'; readonly info: ImageInfo } | { readonly status: 'notFound' } | { readonly status: 'expired' } | { readonly status: 'invalidState' }

// Error of a job that did not complete, with its reason and the step it belongs to.
export class ImageProcessingError extends Error {
	// Creates the error of a reason.
	constructor(
		readonly code: ImageProcessingErrorCode,
		message: string,
		readonly stepId?: string,
	) {
		super(message)
	}
}

// Worker thread of the pipelines. `unref` is a Bun extension that the DOM Worker type lacks.
type ProcessingWorker = Worker & Pick<Bun.Worker, 'unref'>

// A job of the service while it waits or runs, with its scheduling state.
type JobEntry = AnalysisEntry<ImageProcessingJob, ImageProcessingPreparation>

// Adopted document of a completed job, kept for its claim.
interface ProcessingOutput {
	// Description of the document.
	readonly info: ImageInfo
	// Closes the document when it is not claimed in time; cleared by the claim.
	timer?: ReturnType<typeof setTimeout>
}

// Image processing jobs of the server, their scheduling (see analysis.ts), and their output documents.
export class ImageProcessingService {
	// Queue, limit, and retention of the sources.
	readonly #scheduler: AnalysisScheduler<ImageProcessingJob, ImageProcessingResult, ImageProcessingPreparation, 'builtin'>
	// Idle workers.
	readonly #idle: ProcessingWorker[] = []
	// Output documents of completed jobs still open, by job id.
	readonly #outputs = new Map<string, ProcessingOutput>()

	// Creates the service over the image store, publishing every job change to listener. An output document not
	// claimed within claimGrace milliseconds is closed.
	constructor(
		readonly images: ImageStore,
		readonly listener: ImageProcessingListener,
		readonly claimGrace: number = CLAIM_GRACE,
	) {
		this.#scheduler = new AnalysisScheduler<ImageProcessingJob, ImageProcessingResult, ImageProcessingPreparation, 'builtin'>(images, {
			limits: { builtin: PROCESSING_CONCURRENCY },
			provider: () => 'builtin',
			execute: (entry) => this.#execute(entry),
			failed: (entry, error) => {
				if (entry.controller.signal.aborted) return { state: 'cancelled', code: 'cancelled', error: 'The image processing was cancelled', currentStepIndex: undefined }
				if (error instanceof ImageProcessingError) return { state: 'failed', code: error.code, error: error.message, ...(error.stepId !== undefined && { errorStepId: error.stepId }), currentStepIndex: undefined }
				return { state: 'failed', code: 'processingFailed', error: Error.isError(error) ? error.message : String(error), currentStepIndex: undefined }
			},
			cancelled: () => ({ code: 'cancelled', error: 'The image processing was cancelled' }),
			publish: (job) => this.listener({ type: 'imageProcessing:updated', job }),
		})

		images.onDiscard((id) => {
			for (const [jobId, output] of this.#outputs) {
				if (output.info.id !== id) continue
				clearTimeout(output.timer)
				this.#outputs.delete(jobId)
			}
		})
	}

	// Submits a pipeline of an open image: refused while another one of the same image waits or runs (busy), when a
	// step cannot apply to the image it would receive (incompatible), or when the queue is full.
	submit(imageId: string, { steps }: ImageProcessingRequest): ImageProcessingSubmitOutcome {
		const sourceName = this.images.name(imageId)
		const metadata = this.images.metadata(imageId)
		if (sourceName === undefined || !metadata) return { status: 'missing' }

		const active = this.#scheduler.active(imageId)
		if (active) return { status: 'busy', job: active }

		const incompatible = checkPipeline(metadata, steps)
		if (incompatible) return { status: 'incompatible', step: incompatible }
		if (this.#scheduler.full()) return { status: 'queueFull' }

		// The key is the image, so active finds any pipeline of it; results are never reused.
		const job = this.#scheduler.enqueue(imageId, { steps, sourceName }, imageId, { steps, completedSteps: 0 })
		return job ? { status: 'accepted', job } : { status: 'missing' }
	}

	// Cancels a job: a waiting one ends at once, a running one has its worker terminated. Returns false when the job
	// is not waiting or running.
	cancel(jobId: string): boolean {
		return this.#scheduler.cancel(jobId)
	}

	// Returns a job waiting, running, or recently ended.
	job(jobId: string): ImageProcessingJob | undefined {
		return this.#scheduler.job(jobId)
	}

	// Returns the jobs waiting or running and the latest ended ones, oldest first.
	snapshot(): ImageProcessingSnapshot {
		return { jobs: this.#scheduler.snapshot() }
	}

	// Hands the output document of a completed job to a client, which owns it from now on (it is no longer closed
	// after the grace period). Claiming it again answers the same document while it is open.
	claim(jobId: string): ImageProcessingClaimOutcome {
		const output = this.#outputs.get(jobId)

		if (output) {
			clearTimeout(output.timer)
			output.timer = undefined
			return { status: 'claimed', info: output.info }
		}

		const job = this.#scheduler.job(jobId)
		if (!job) return { status: 'notFound' }
		return job.state === 'completed' ? { status: 'expired' } : { status: 'invalidState' }
	}

	// Runs the steps of a job on a copy of its source and adopts the result as a new document.
	async #execute(entry: JobEntry): Promise<AnalysisCompletion<ImageProcessingJob, ImageProcessingResult>> {
		const { jobId, imageId } = entry.job
		const { steps, sourceName } = entry.preparation
		const { signal } = entry.controller
		const image = await this.images.processingImage(imageId)
		if (!image) throw new ImageProcessingError('expired', 'The image was released before it could be processed')
		if (signal.aborted) throw new ImageProcessingError('cancelled', 'The image processing was cancelled')

		const processed = await this.#process(entry, image)
		if (signal.aborted) throw new ImageProcessingError('cancelled', 'The image processing was cancelled')

		const info = await this.images.adopt(processed, { kind: 'processing', source: imageId, sourceName, steps, createdAt: new Date().toISOString() })

		// A cancel that arrived while the document was adopted wins: the document is not published.
		if (signal.aborted) {
			this.images.close(info.id)
			throw new ImageProcessingError('cancelled', 'The image processing was cancelled')
		}

		const timer = setTimeout(() => this.images.close(info.id), this.claimGrace)
		// A document waiting for its claim must not keep the process alive on its own.
		timer.unref()
		this.#outputs.set(jobId, { info, timer })

		return { patch: { outputImageId: info.id, completedSteps: steps.length, currentStepIndex: undefined }, result: { outputImageId: info.id } }
	}

	// Applies the steps of a job to its working copy on a worker, publishing the step running, and resolves to the
	// result. Throws ImageProcessingError.
	async #process(entry: JobEntry, image: Image): Promise<Image> {
		const { steps } = entry.preparation
		const { signal } = entry.controller
		const { jobId } = entry.job
		const worker = this.#idle.pop() ?? this.#startWorker()
		const { promise, resolve, reject } = Promise.withResolvers<Image>()
		let reusable = false

		const onMessage = (event: MessageEvent<ProcessingWorkerResponse>) => {
			const response = event.data
			if (response.jobId !== jobId) return

			if (response.status === 'step') {
				this.#scheduler.update(jobId, { currentStepIndex: response.index, completedSteps: response.index })
				return
			}

			// A step that threw leaves the worker usable; only a crash, a timeout, or a cancel does not.
			reusable = true
			if (response.status === 'processed') resolve(response.image)
			else reject(new ImageProcessingError('processingFailed', response.error, response.stepId))
		}

		const onError = (event: ErrorEvent) => reject(new ImageProcessingError('workerFailed', `The image processing worker died: ${event.message}`))
		const onAbort = () => reject(new ImageProcessingError('cancelled', 'The image processing was cancelled'))
		const timer = setTimeout(() => reject(new ImageProcessingError('timeout', `The image processing did not finish within ${PROCESSING_TIMEOUT / 60000} min`)), PROCESSING_TIMEOUT)

		worker.addEventListener('message', onMessage)
		worker.addEventListener('error', onError)
		signal.addEventListener('abort', onAbort, { once: true })

		try {
			worker.postMessage({ jobId, image, steps } satisfies ProcessingWorkerRequest, [image.raw.buffer])
			return await promise
		} finally {
			clearTimeout(timer)
			worker.removeEventListener('message', onMessage)
			worker.removeEventListener('error', onError)
			signal.removeEventListener('abort', onAbort)
			// The steps cannot be interrupted, so a worker still running one is terminated.
			if (reusable) this.#idle.push(worker)
			else worker.terminate()
		}
	}

	// Starts a processing worker.
	#startWorker(): ProcessingWorker {
		// The compiled executable defines the embedded path of the worker (see app/build.ts); elsewhere it is
		// resolved next to this module.
		const worker = new Worker(process.env.NEBULOSA_IMAGE_PROCESSING_WORKER ?? new URL('./imageprocessing.worker.ts', import.meta.url)) as ProcessingWorker
		// An idle worker must not keep the process alive on its own.
		worker.unref()
		return worker
	}
}

// Creates the image processing routes over a service.
export function createImageProcessingRoutes(service: ImageProcessingService) {
	return {
		'/api/images/:id/processing': {
			// Submits a pipeline (ImageProcessingRequest) of an open image. Responds 202 with the queued job, 404 when
			// the image is not open, 409 busy with the job of the image already waiting or running, 422
			// incompatibleImage with the stepId of the first step that cannot apply, and 503 when too many jobs wait.
			POST: async (req) => {
				const outcome = service.submit(req.params.id, (await req.json()) as ImageProcessingRequest)
				if (outcome.status === 'missing') return errorResponse('Image not found', 404, 'notFound')
				if (outcome.status === 'busy') return errorResponse('The image is already being processed', 409, 'busy', { job: outcome.job })
				if (outcome.status === 'incompatible') return errorResponse(outcome.step.error, 422, 'incompatibleImage', { stepId: outcome.step.stepId })
				if (outcome.status === 'queueFull') return errorResponse('Too many image processing jobs are waiting; try again later', 503, 'queueFull')
				return Response.json(outcome.job, { status: 202 })
			},
		},
		'/api/image-processing': {
			// Jobs waiting or running and the latest ended ones, for a tab that (re)connects.
			GET: () => Response.json(service.snapshot()),
		},
		'/api/image-processing/:jobId': {
			// A job; 404 when it is unknown or long forgotten.
			GET: (req) => {
				const job = service.job(req.params.jobId)
				return job ? Response.json(job) : errorResponse('Image processing not found', 404, 'notFound')
			},
		},
		'/api/image-processing/:jobId/cancel': {
			// Cancels a waiting or running job; the end arrives as an imageProcessing:updated event. 404 when it is
			// neither.
			POST: (req) => new Response(null, { status: service.cancel(req.params.jobId) ? 204 : 404 }),
		},
		'/api/image-processing/:jobId/claim': {
			// Hands the output document of a completed job to the client: responds with its ImageInfo, 404 notFound for
			// an unknown job, 404 expired when its document was closed, and 409 invalidState when the job did not
			// complete.
			POST: (req) => {
				const outcome = service.claim(req.params.jobId)
				if (outcome.status === 'notFound') return errorResponse('Image processing not found', 404, 'notFound')
				if (outcome.status === 'expired') return errorResponse('The processed image is no longer available', 404, 'expired')
				if (outcome.status === 'invalidState') return errorResponse('The image processing did not complete', 409, 'invalidState')
				return Response.json(outcome.info)
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
