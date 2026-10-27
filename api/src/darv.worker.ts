import { analyzeDarvImage } from 'nebulosa/src/observation/alignment/darv.analysis'
import type { DarvWorkerRequest, DarvWorkerResponse } from './darv.analysis'

// Worker thread of the DARV image analysis. It receives the grayscale copy of one frame at a time,
// transferred from the image worker through the server thread, runs the toolkit's analyzeDarvImage on it
// (streak detection, leg pairing and the drift of every trail), and answers the result, so the analysis
// never blocks the server event loop nor the renderings of the image worker. The copy is owned by this
// worker and dropped after the analysis. An analysis cannot be interrupted: the service terminates the
// worker to cancel one, or when it runs out of time.

declare const self: Worker

// Analyzes the frame of a request and posts the outcome.
function handle({ jobId, input }: DarvWorkerRequest): void {
	let response: DarvWorkerResponse

	try {
		response = { jobId, status: 'analyzed', result: analyzeDarvImage(input) }
	} catch (error) {
		response = { jobId, status: 'failed', error: Error.isError(error) ? error.message : String(error) }
	}

	self.postMessage(response, [])
}

self.addEventListener('message', (event: MessageEvent<DarvWorkerRequest>) => handle(event.data))
