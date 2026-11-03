import { type AnalysisWorkerRequest, type AnalysisWorkerResponse, measureFrames } from './imagestacking.analysis'
import { integrateGroups, type IntegrationWorkerRequest, type IntegrationWorkerResponse } from './imagestacking.integration'
import { errorCode } from './util'

// Worker thread of Image Stacking: measures the light frames of one analysis, or integrates the filter groups of one run,
// so reading, calibrating, and combining hundreds of frames never blocks the event loop of the server. It only reads the
// frames and writes inside the staging directory of its run. A failure it did not name becomes a code, because a
// filesystem message holds paths, and job errors reach every tab.

declare const self: Worker

// Request of the worker, by mode.
type StackingWorkerRequest = (AnalysisWorkerRequest & { readonly mode: 'analyze' }) | (IntegrationWorkerRequest & { readonly mode: 'integrate' })

// Measures frames and posts each measurement and the outcome.
async function analyze(request: AnalysisWorkerRequest): Promise<void> {
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

// Integrates groups and posts their progress, each staged master, and the outcome.
async function integrate(request: IntegrationWorkerRequest): Promise<void> {
	const { jobId } = request
	const post = (response: IntegrationWorkerResponse) => self.postMessage(response, [])
	let response: IntegrationWorkerResponse

	try {
		await integrateGroups(request, {
			onProgress: (progress) => post({ jobId, status: 'progress', progress }),
			onStaged: (product) => post({ jobId, status: 'staged', product }),
			onGroupFailed: (group, error) => post({ jobId, status: 'groupFailed', group, error }),
		})
		response = { jobId, status: 'finished' }
	} catch (error) {
		response = { jobId, status: 'failed', error: `The integration failed (${errorCode(error) ?? 'unexpected error'})` }
	}

	post(response)
}

self.addEventListener('message', (event: MessageEvent<StackingWorkerRequest>) => {
	const request = event.data
	void (request.mode === 'analyze' ? analyze(request) : integrate(request))
})
