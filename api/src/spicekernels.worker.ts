import { extendedPermanentAsteroidNumber } from 'nebulosa/src/astronomy/ephemeris/kernels/naif'
import { prepareSpkKernelSet, type SpkKernelSet } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import { type Time, timeUnix } from 'nebulosa/src/astronomy/time/time'
import type { FileHandleSource } from 'nebulosa/src/io/file'
import { elementsOrbit, type ElementsWorkerRequest, type ElementsWorkerResponse } from './spicekernels.elements'
import { BATCH_INTEGRATION, integrateSmallBodySegment, MpcKernelError } from './spicekernels.mpc'
import { openSpiceKernel } from './spicekernels.runtime'

// Worker thread of the integrations of element sets of the SPICE Kernel Library. It opens its own read-only copy of the
// enabled kernels once, then integrates the chunks of objects the server hands it, one object at a time, with the batch
// force model, and posts each segment with its tables transferred. A missing planetary body ends the batch; any other
// failure of one object is posted and the next goes on. On close it stops the integration under way, which yields between
// chunks of steps, closes its files, and says so, before the server terminates it.

declare const self: Worker

// Kernel set of the worker, its files, and the window.
let set: SpkKernelSet | undefined
const sources: FileHandleSource[] = []
let start: Time
let end: Time
// Aborted on close, which stops the integration under way at its next yield.
const controller = new AbortController()

// Posts a response, transferring the tables of a segment.
function post(response: ElementsWorkerResponse) {
	self.postMessage(response, response.type === 'segment' ? [response.segment.epochs.buffer, response.segment.states.buffer] : [])
}

// Message of an error.
function messageOf(error: unknown) {
	return Error.isError(error) ? error.message : String(error)
}

// Opens the kernels and the window, then says it is ready.
async function open(request: Extract<ElementsWorkerRequest, { type: 'open' }>) {
	try {
		const entries = []

		for (const kernel of request.kernels) {
			try {
				const opened = await openSpiceKernel(kernel.path)
				sources.push(opened.source)
				entries.push({ id: kernel.id, daf: opened.daf, segments: opened.segments })
			} catch {
				// A file that cannot be opened is judged by the rebuild of the library; the batch goes on without it.
			}
		}

		set = await prepareSpkKernelSet(entries, { preferences: new Map(request.preferences) })
		start = timeUnix(request.start / 1000, true)
		end = timeUnix(request.end / 1000, true)
		post({ type: 'ready' })
	} catch (error) {
		post({ type: 'error', missingDependency: false, message: messageOf(error), bodies: [] })
	}
}

// Integrates a chunk of objects, posting each segment or failure, then says the chunk is done.
async function integrate(request: Extract<ElementsWorkerRequest, { type: 'integrate' }>) {
	for (const object of request.objects) {
		if (controller.signal.aborted) return

		try {
			const integrated = await integrateSmallBodySegment(elementsOrbit(object), extendedPermanentAsteroidNumber(object.number), object.name.slice(0, 40), start, end, set!, controller.signal, BATCH_INTEGRATION)
			post({ type: 'segment', segment: integrated.segment, kernelIds: integrated.kernelIds })
		} catch (error) {
			if (controller.signal.aborted) return

			if (error instanceof MpcKernelError && error.reason === 'missingDependency') {
				post({ type: 'error', missingDependency: true, message: error.message, bodies: error.bodies })
				return
			}

			post({ type: 'failed', failure: { number: object.number, name: object.name, message: messageOf(error) } })
		}
	}

	post({ type: 'chunkDone' })
}

// Stops the integration under way, closes the files, and says so.
async function close() {
	controller.abort()
	await Promise.allSettled(sources.map((e) => e.close()))
	post({ type: 'closed' })
}

self.addEventListener('message', (event: MessageEvent<ElementsWorkerRequest>) => {
	const request = event.data
	if (request.type === 'open') void open(request)
	else if (request.type === 'integrate') void integrate(request)
	else void close()
})
