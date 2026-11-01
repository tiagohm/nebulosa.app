import { integrateMaster, IntegrationError, type MasterWorkerRequest, type MasterWorkerResponse } from './calibrationlibrary.analysis'

// Worker thread of the Calibration Library: integrates one master from files at a time, so a stack that takes hours never
// blocks the event loop of the server. It only reads the frames and writes inside the staging directory of its job.

declare const self: Worker

// Runs a job and posts its progress and outcome.
async function handle(request: MasterWorkerRequest): Promise<void> {
	const { jobId } = request
	let response: MasterWorkerResponse

	try {
		response = { jobId, status: 'finished', result: await integrateMaster(request, (progress) => self.postMessage({ jobId, status: 'progress', progress } satisfies MasterWorkerResponse, [])) }
	} catch (error) {
		response = { jobId, status: 'failed', code: error instanceof IntegrationError ? error.code : 'processingFailed', error: Error.isError(error) ? error.message : String(error) }
	}

	self.postMessage(response, [])
}

self.addEventListener('message', (event: MessageEvent<MasterWorkerRequest>) => void handle(event.data))
