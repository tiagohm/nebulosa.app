import { installCachedEarthOrientation } from './astronomicaltime.eop'
import { computePointingFit, type PointingFitWorkerRequest, type PointingFitWorkerResponse } from './mountpointing.fit'

// Worker thread of the mount pointing fits. It receives one fit at a time as plain numbers and answers the model and its
// measures, so the leave-one-out refits never block the server event loop. The hour angles of a fit read the same Earth
// orientation data as the corrections on the server thread, when that thread has them. A fit cannot be interrupted: the
// service terminates the worker to cancel one, or when it runs out of time.

declare const self: Worker

// Fits a request and posts the outcome.
async function handle({ jobId, request, earthOrientation }: PointingFitWorkerRequest): Promise<void> {
	let response: PointingFitWorkerResponse

	try {
		if (earthOrientation) await installCachedEarthOrientation()
		response = { jobId, status: 'fitted', result: computePointingFit(request) }
	} catch (error) {
		response = { jobId, status: 'failed', error: Error.isError(error) ? error.message : String(error) }
	}

	self.postMessage(response, [])
}

self.addEventListener('message', (event: MessageEvent<PointingFitWorkerRequest>) => void handle(event.data))
