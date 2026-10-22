import { detectStars } from 'nebulosa/src/imaging/stars/detector'
import type { StarWorkerRequest, StarWorkerResponse } from './stars'

// Worker thread of the built-in star detector. It receives the grayscale copy of one image at a time,
// transferred from the image worker through the server thread, runs the toolkit's detectStars on it, and
// answers the detected stars, so the measurement never blocks the server event loop nor the renderings of
// the image worker. The copy is owned by this worker and dropped after the detection. A detection cannot be
// interrupted: the service terminates the worker to cancel one, or when it runs out of time.

declare const self: Worker

// Detects the stars of a request and posts the outcome.
function handle({ jobId, image, options }: StarWorkerRequest): void {
	let response: StarWorkerResponse

	try {
		response = { jobId, status: 'detected', stars: detectStars(image, options) }
	} catch (error) {
		response = { jobId, status: 'failed', error: Error.isError(error) ? error.message : String(error) }
	}

	self.postMessage(response, [])
}

self.addEventListener('message', (event: MessageEvent<StarWorkerRequest>) => handle(event.data))
