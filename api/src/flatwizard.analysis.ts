import type { FlatSequenceSample } from 'nebulosa/src/imaging/analysis/flat/sequence'
import type { FlatAnalysis, FlatFrame, FlatSequenceOptions } from 'nebulosa/src/imaging/analysis/flat/types'

// Measurement of Flat Wizard frames: the toolkit's flat analysis on a worker of its own
// (`flatwizard.worker.ts`), reading the acquired FITS file in the digital-number scale of its source. The
// viewer's documents are normalized for display and never reach this path, so every level, clipping fraction,
// and target check is in the DN the camera wrote. Only compact results cross back to the server thread: the
// single-frame analysis without maps and, for a final frame, the reduced temporal sample that replaces its
// image in the sequence analysis. Measurements run one at a time, in arrival order; a cancelled or timed out
// one terminates its worker. No device is held and no file is modified.

// Acquisition context of a frame, everything a FlatFrame carries besides its image: identity, exposure in
// seconds, timestamp in Unix milliseconds, filter, illumination, CFA offset, and operating point.
export type FlatFrameContext = Omit<FlatFrame, 'image'>

// Single-frame analysis options of a run: target ranges, effective clipping limits in DN, criteria, tiles,
// and planes. Full-resolution maps and artifacts are never produced.
export type FlatMeasurementOptions = NonNullable<FlatSequenceOptions['analysis']>

// Result of measuring one frame.
export interface FlatFrameMeasurement {
	// Single-frame analysis in DN, without maps.
	readonly analysis: FlatAnalysis
	// Reduced temporal sample, present only when it was requested for a final frame.
	readonly sample?: FlatSequenceSample
}

// Request to the Flat Wizard worker.
export interface FlatWorkerRequest {
	// Id of the job, echoed by the response.
	readonly jobId: string
	// Absolute path of the FITS file to read; it is only read.
	readonly path: string
	// Acquisition context of the frame.
	readonly context: FlatFrameContext
	// Single-frame analysis options.
	readonly options: FlatMeasurementOptions
	// Whether to keep the temporal sample of a final frame.
	readonly sample: boolean
}

// Response of the Flat Wizard worker.
export type FlatWorkerResponse = { readonly jobId: string; readonly status: 'measured'; readonly result: FlatFrameMeasurement } | { readonly jobId: string; readonly status: 'failed'; readonly error: string }

// Time a measurement may run, in milliseconds, before its worker is terminated. It covers reading the file
// and the robust statistics of a large sensor with margin.
export const MEASUREMENT_TIMEOUT = 120000

// Worker thread of the measurement. `unref` is a Bun extension that the DOM Worker type lacks.
type FlatWorker = Worker & Pick<Bun.Worker, 'unref'>

// Starts a measurement worker; injectable so tests can observe the worker lifecycle.
export type FlatWorkerFactory = () => FlatWorker

// Measures acquired flat frames in digital numbers.
export class FlatWizardAnalyzer {
	// Worker kept between measurements.
	#idle?: FlatWorker
	// Settles when the previous measurement ended; measurements run one at a time.
	#queue: Promise<unknown> = Promise.resolve()

	// Creates the analyzer; timeout bounds every measurement in milliseconds and startWorker creates workers.
	constructor(
		readonly timeout: number = MEASUREMENT_TIMEOUT,
		readonly startWorker: FlatWorkerFactory = startFlatWorker,
	) {}

	// Measures the FITS file at path with the frame context and options; sample also keeps the temporal sample
	// of a final frame. Resolves the measurement; rejects when the file is not a readable FITS image, the
	// worker failed or timed out, or signal aborted it.
	measure(path: string, context: FlatFrameContext, options: FlatMeasurementOptions, sample: boolean, signal: AbortSignal): Promise<FlatFrameMeasurement> {
		const run = this.#queue.then(() => this.#measure({ jobId: crypto.randomUUID(), path, context, options, sample }, signal))
		this.#queue = run.catch(() => undefined)
		return run
	}

	// Terminates the idle worker. Measurements still queued start a new one.
	dispose() {
		this.#idle?.terminate()
		this.#idle = undefined
	}

	// Same as dispose, so the analyzer can be scoped with `using`.
	[Symbol.dispose]() {
		this.dispose()
	}

	// Runs one measurement on the worker.
	async #measure(request: FlatWorkerRequest, signal: AbortSignal): Promise<FlatFrameMeasurement> {
		signal.throwIfAborted()

		const worker = this.#idle ?? this.startWorker()
		this.#idle = undefined
		const { promise, resolve, reject } = Promise.withResolvers<FlatFrameMeasurement>()
		let reusable = false

		const onMessage = (event: MessageEvent<FlatWorkerResponse>) => {
			const response = event.data
			if (response.jobId !== request.jobId) return
			// A measurement that threw leaves the worker usable; only a crash, a timeout, or a cancel does not.
			reusable = true
			if (response.status === 'measured') resolve(response.result)
			else reject(new Error(`The flat measurement failed: ${response.error}`))
		}

		const onError = (event: ErrorEvent) => reject(new Error(`The flat measurement worker died: ${event.message}`))
		const onAbort = () => reject(signal.reason)
		const timer = setTimeout(() => reject(new Error(`The flat measurement did not finish within ${this.timeout / 1000} s`)), this.timeout)

		worker.addEventListener('message', onMessage)
		worker.addEventListener('error', onError)
		signal.addEventListener('abort', onAbort, { once: true })

		try {
			worker.postMessage(request, [])
			return await promise
		} finally {
			clearTimeout(timer)
			worker.removeEventListener('message', onMessage)
			worker.removeEventListener('error', onError)
			signal.removeEventListener('abort', onAbort)
			// The measurement cannot be interrupted, so a worker still running one is terminated.
			if (reusable) this.#idle = worker
			else worker.terminate()
		}
	}
}

// Starts a measurement worker. The compiled executable defines the embedded path of the worker (see
// app/build.ts); elsewhere it is resolved next to this module.
function startFlatWorker(): FlatWorker {
	const worker = new Worker(process.env.NEBULOSA_FLATWIZARD_WORKER ?? new URL('./flatwizard.worker.ts', import.meta.url)) as FlatWorker
	// An idle worker must not keep the process alive on its own.
	worker.unref()
	return worker
}
