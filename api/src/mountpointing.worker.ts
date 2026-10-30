import { computePointingFit, type PointingFitWorkerRequest, type PointingFitWorkerResponse } from './mountpointing.fit'

// Worker thread of the mount pointing fits. It receives one fit at a time as plain numbers and answers the model and its
// measures, so the leave-one-out refits never block the server event loop. A fit cannot be interrupted: the service
// terminates the worker to cancel one, or when it runs out of time.

declare const self: Worker

// Fits a request and posts the outcome.
function handle({ jobId, request }: PointingFitWorkerRequest): void {
	let response: PointingFitWorkerResponse

	try {
		response = { jobId, status: 'fitted', result: computePointingFit(request) }
	} catch (error) {
		response = { jobId, status: 'failed', error: Error.isError(error) ? error.message : String(error) }
	}

	self.postMessage(response, [])
}

self.addEventListener('message', (event: MessageEvent<PointingFitWorkerRequest>) => handle(event.data))
