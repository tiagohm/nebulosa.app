import { inspectStarRegion, type StarProfileWorkerRequest, type StarProfileWorkerResponse } from './starprofile.analysis'

// Worker thread of the Star Profile Inspector. It receives the grayscale copy of one small region at a time,
// transferred from the image worker through the server thread, finds and measures the star near the point asked about
// (inspectStarRegion), and answers the result, so a Moffat fit never blocks the server event loop nor the renderings of
// the image worker. The copy is owned by this worker and dropped after the measurement.

declare const self: Worker

// Measures the star of a request and posts the outcome.
function handle({ id, imageId, region, rect, size, request }: StarProfileWorkerRequest): void {
	let response: StarProfileWorkerResponse

	try {
		response = { id, status: 'completed', result: inspectStarRegion(imageId, region, rect, size, request) }
	} catch (error) {
		response = { id, status: 'failed', error: Error.isError(error) ? error.message : String(error) }
	}

	self.postMessage(response, [])
}

self.addEventListener('message', (event: MessageEvent<StarProfileWorkerRequest>) => handle(event.data))
