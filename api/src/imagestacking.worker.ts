import { type AnalysisWorkerRequest, type AnalysisWorkerResponse, measureFrames } from './imagestacking.analysis'
import { errorCode } from './util'

// Worker thread of Image Stacking: measures the light frames of one analysis at a time, so reading and calibrating
// hundreds of frames never blocks the event loop of the server. It only reads files. A failure becomes a code, because
// a filesystem message holds paths, and job errors reach every tab.

declare const self: Worker

// Runs a job and posts each measurement and its outcome.
async function handle(request: AnalysisWorkerRequest): Promise<void> {
	const { jobId } = request
	let response: AnalysisWorkerResponse

	try {
		await measureFrames(request, (sourceId, measurement) => self.postMessage({ jobId, status: 'measured', sourceId, measurement } satisfies AnalysisWorkerResponse, []))
		response = { jobId, status: 'finished' }
	} catch (error) {
		response = { jobId, status: 'failed', error: `The analysis failed (${errorCode(error) ?? 'unexpected error'})` }
	}

	self.postMessage(response, [])
}

self.addEventListener('message', (event: MessageEvent<AnalysisWorkerRequest>) => void handle(event.data))
