import { integrateMaster, IntegrationError, type MasterWorkerRequest, type MasterWorkerResponse } from './calibrationlibrary.analysis'
import { errorCode } from './util'

// Worker thread of the Calibration Library: integrates one master from files at a time, so a stack that takes hours never
// blocks the event loop of the server. It only reads the frames and writes inside the staging directory of its job. A
// failure it did not name becomes a code, because a filesystem message holds paths, and job errors reach every tab.

declare const self: Worker

// Runs a job and posts its progress and outcome.
async function handle(request: MasterWorkerRequest): Promise<void> {
	const { jobId } = request
	let response: MasterWorkerResponse

	try {
		response = { jobId, status: 'finished', result: await integrateMaster(request, (progress) => self.postMessage({ jobId, status: 'progress', progress } satisfies MasterWorkerResponse, [])) }
	} catch (error) {
		response = error instanceof IntegrationError ? { jobId, status: 'failed', code: error.code, error: error.message } : { jobId, status: 'failed', code: 'processingFailed', error: `The integration failed (${errorCode(error) ?? 'unexpected error'})` }
	}

	self.postMessage(response, [])
}

self.addEventListener('message', (event: MessageEvent<MasterWorkerRequest>) => void handle(event.data))
