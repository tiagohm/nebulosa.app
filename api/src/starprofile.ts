import { errorResponse } from './http'
import type { DocumentSize, ImageRect, ImageRegion, ImageStore } from './images'
import { regionAround, regionHalfSize, type StarProfileRequest, type StarProfileResult, type StarProfileWorkerRequest, type StarProfileWorkerResponse } from './starprofile.analysis'

// Star Profile Inspector service: measures the star a person pointed at in an image document, for as long as one HTTP
// request lasts. The image store hands out a small grayscale region around the point, and a worker of its own
// (starprofile.worker.ts) finds and measures the star on it, so a click never copies the whole image. It is a short,
// explicit interaction: nothing is kept, published, or scheduled as a job, unlike the analyses of analysis.ts, and no
// device is held. A request retains its image until it ends, and measurements run one at a time, in arrival order, at
// most MAX_QUEUED of them waiting. A request that aborts leaves the queue; one already on the worker cannot be
// interrupted, so it finishes and its result is dropped, leaving any other request of the same image alone.

// Requests waiting at most; a request beyond it is refused as queueFull.
export const MAX_QUEUED = 8

// Time a measurement may run on the worker, in milliseconds, before it is terminated; a measurement of a small region
// takes a fraction of a second, so only a wedged worker reaches it.
const MEASUREMENT_TIMEOUT = 10000

// Why a measurement failed: the worker failed or died, or ran longer than MEASUREMENT_TIMEOUT.
export type StarProfileErrorCode = 'workerFailed' | 'timeout'

// Outcome of a request: its result, or why there is none: the image is not open (missing), it was aborted (cancelled), or
// too many requests are waiting (queueFull).
export type StarProfileOutcome = { readonly status: 'completed'; readonly result: StarProfileResult } | { readonly status: 'missing' } | { readonly status: 'cancelled' } | { readonly status: 'queueFull' }

// Error of a measurement that failed, with its reason.
export class StarProfileError extends Error {
	// Creates the error of a reason.
	constructor(
		readonly code: StarProfileErrorCode,
		message: string,
	) {
		super(message)
	}
}

// Worker thread of the service. `unref` is a Bun extension that the DOM Worker type lacks.
type StarProfileWorker = Worker & Pick<Bun.Worker, 'unref'>

// A request waiting for its turn.
interface Waiting {
	// Settles the wait: true when the turn came, false when the request aborted first.
	readonly resolve: (granted: boolean) => void
}

// Measurements of the stars of the image documents, one at a time.
export class StarProfileService {
	// Requests waiting for the worker, oldest first.
	readonly #waiting: Waiting[] = []
	// Whether a request holds the turn.
	#busy = false
	// Id of the next message to the worker.
	#id = 0
	// Worker started on first use, and replaced when it dies or runs out of time.
	#worker?: StarProfileWorker

	// Creates the service over the image store.
	constructor(readonly images: ImageStore) {}

	// Measures the star near a point of an open image and resolves to the outcome; aborting signal gives up the request.
	// Throws StarProfileError when the measurement fails.
	async inspect(imageId: string, request: StarProfileRequest, signal?: AbortSignal): Promise<StarProfileOutcome> {
		const size = this.images.retain(imageId)
		if (!size) return { status: 'missing' }

		try {
			if (this.#busy && this.#waiting.length >= MAX_QUEUED) return { status: 'queueFull' }
			if (!(await this.#turn(signal))) return { status: 'cancelled' }

			try {
				return await this.#measure(imageId, request, size, signal)
			} finally {
				this.#next()
			}
		} finally {
			this.images.release(imageId)
		}
	}

	// Measures a star during the turn of a request.
	async #measure(imageId: string, request: StarProfileRequest, size: DocumentSize, signal?: AbortSignal): Promise<StarProfileOutcome> {
		if (signal?.aborted) return { status: 'cancelled' }

		const rect = regionAround(request, regionHalfSize(request), size)
		const region = await this.images.detectionRegion(imageId, rect)
		if (!region) return { status: 'missing' }
		if (signal?.aborted) return { status: 'cancelled' }

		const result = await this.#post(imageId, region, rect, size, request)
		return signal?.aborted ? { status: 'cancelled' } : { status: 'completed', result }
	}

	// Resolves when a request may use the worker: true at once while it is free, or once the requests before it ended;
	// false when signal aborts first, which leaves the queue.
	#turn(signal?: AbortSignal): Promise<boolean> {
		if (!this.#busy) {
			this.#busy = true
			return Promise.resolve(true)
		}

		const { promise, resolve } = Promise.withResolvers<boolean>()

		const waiting: Waiting = {
			resolve: (granted) => {
				signal?.removeEventListener('abort', abort)
				resolve(granted)
			},
		}

		const abort = () => {
			this.#waiting.splice(this.#waiting.indexOf(waiting), 1)
			waiting.resolve(false)
		}

		signal?.addEventListener('abort', abort, { once: true })
		this.#waiting.push(waiting)
		return promise
	}

	// Gives the turn to the oldest request waiting, or frees it.
	#next(): void {
		const waiting = this.#waiting.shift()
		if (waiting) waiting.resolve(true)
		else this.#busy = false
	}

	// Sends a region to the worker, transferring its buffer, and resolves to its result. Throws StarProfileError, and
	// replaces the worker when it died or did not answer in time.
	async #post(imageId: string, region: ImageRegion, rect: ImageRect, size: DocumentSize, request: StarProfileRequest): Promise<StarProfileResult> {
		const worker = (this.#worker ??= this.#start())
		const id = this.#id++
		const { promise, resolve, reject } = Promise.withResolvers<StarProfileResult>()

		const discard = () => {
			worker.terminate()
			this.#worker = undefined
		}

		const onMessage = (event: MessageEvent<StarProfileWorkerResponse>) => {
			const response = event.data
			if (response.id !== id) return
			if (response.status === 'completed') resolve(response.result)
			else reject(new StarProfileError('workerFailed', `The measurement failed: ${response.error}`))
		}

		const onError = (event: ErrorEvent) => {
			discard()
			reject(new StarProfileError('workerFailed', `The star profile worker died: ${event.message}`))
		}

		const timer = setTimeout(() => {
			discard()
			reject(new StarProfileError('timeout', `The measurement did not finish within ${MEASUREMENT_TIMEOUT / 1000} s`))
		}, MEASUREMENT_TIMEOUT)

		worker.addEventListener('message', onMessage)
		worker.addEventListener('error', onError)

		try {
			worker.postMessage({ id, imageId, region, rect, size, request } satisfies StarProfileWorkerRequest, [region.image.raw.buffer])
			return await promise
		} finally {
			clearTimeout(timer)
			worker.removeEventListener('message', onMessage)
			worker.removeEventListener('error', onError)
		}
	}

	// Starts the worker.
	#start(): StarProfileWorker {
		// The compiled executable defines the embedded path of the worker (see app/build.ts); elsewhere it is resolved next
		// to this module.
		const worker = new Worker(process.env.NEBULOSA_STAR_PROFILE_WORKER ?? new URL('./starprofile.worker.ts', import.meta.url)) as StarProfileWorker
		// An idle worker must not keep the process alive on its own.
		worker.unref()
		return worker
	}
}

// Creates the Star Profile Inspector routes over a service.
export function createStarProfileRoutes(service: StarProfileService) {
	return {
		'/api/images/:id/star-profile': {
			// Measures the star near a point of an image document (StarProfileRequest). Responds with the StarProfileResult,
			// which may be noStar, 404 when the document is not open, 409 when the request was aborted, 503 when too many
			// requests are waiting, and 500 when the measurement failed.
			POST: async (req) => {
				try {
					const outcome = await service.inspect(req.params.id, (await req.json()) as StarProfileRequest, req.signal)
					if (outcome.status === 'missing') return errorResponse('Image not found', 404, 'notFound')
					if (outcome.status === 'cancelled') return errorResponse('Measurement superseded', 409, 'superseded')
					if (outcome.status === 'queueFull') return errorResponse('Too many star measurements are waiting; try again', 503, 'queueFull')
					return Response.json(outcome.result)
				} catch (error) {
					return errorResponse(Error.isError(error) ? error.message : String(error), 500, error instanceof StarProfileError ? error.code : 'workerFailed')
				}
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
