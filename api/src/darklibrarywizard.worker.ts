import { type DarkWorkerRequest, type DarkWorkerResponse, measureDarkFile } from './darklibrarywizard.analysis'

// Worker thread of the Dark Library Wizard frame analysis. It reads one acquired FITS file at a time from disk in the
// digital-number scale of its source and answers compact statistics. The decoded image lives only for one job, so memory
// never grows with the frames of a run. A job cannot be interrupted: the service terminates the worker to cancel one, or
// when it runs out of time.

declare const self: Worker

// Measures the frame of a request and posts the outcome.
async function handle({ jobId, path }: DarkWorkerRequest): Promise<void> {
	let response: DarkWorkerResponse

	try {
		response = { jobId, status: 'measured', result: await measureDarkFile(path) }
	} catch (error) {
		response = { jobId, status: 'failed', error: Error.isError(error) ? error.message : String(error) }
	}

	self.postMessage(response, [])
}

self.addEventListener('message', (event: MessageEvent<DarkWorkerRequest>) => void handle(event.data))
