import { readdir, realpath, stat } from 'fs/promises'
import { extname, join } from 'path'
import { QUAD_INDEX_EXTENSION } from 'nebulosa/src/astrometry/solvers/quad.index.file'
import type { Image } from 'nebulosa/src/imaging/model/types'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'

// Built-in plate solver of the server: the toolkit's native solver (nativePlateSolve, after Astrometry.net) run on a
// worker of its own (platesolving.worker.ts), which detects the stars of the grayscale copy of an image, searches the
// quad index files of a folder (Nebulosa .nqi tiles and Astrometry.net index files). This module finds those files on
// the server's filesystem, for the worker and the check of External Tools, and is the client of the worker: one worker kept between solves, so the indexes it opened stay open, asked to stop a solve by a
// message (the solver yields to its event loop between slices) and terminated only when it does not answer in time.

// Quad index files of a folder and its subfolders, each list sorted by path.
export interface QuadIndexFiles {
	// Nebulosa quad index tiles (.nqi).
	readonly nebulosa: readonly string[]
	// Astrometry.net index files (index-*.fits or index-*.fit).
	readonly astrometryNet: readonly string[]
	// Subfolders that could not be read, left out of the lists.
	readonly unreadable: readonly string[]
}

// Whether a file name is that of an Astrometry.net index file, as its build-index and its downloads name them.
function isAstrometryNetIndex(name: string) {
	const lower = name.toLowerCase()
	return lower.startsWith('index-') && (lower.endsWith('.fits') || lower.endsWith('.fit'))
}

// Returns the quad index files of a folder and its subfolders, following symbolic links to files and folders (a folder
// reached twice, such as through a link cycle, is read once). A subfolder that cannot be read, such as a system folder
// of a drive root, is listed as unreadable instead of failing the search. Throws when the folder itself cannot be read.
export async function findQuadIndexFiles(directory: string): Promise<QuadIndexFiles> {
	const nebulosa: string[] = []
	const astrometryNet: string[] = []
	const unreadable: string[] = []
	const visited = new Set<string>()

	// Reads one folder and walks its subfolders; throws only for the top folder.
	async function walk(folder: string, top: boolean) {
		let entries

		try {
			const real = await realpath(folder)
			if (visited.has(real)) return
			visited.add(real)
			entries = await readdir(folder, { withFileTypes: true })
		} catch (error) {
			if (top) throw error
			unreadable.push(folder)
			return
		}

		for (const entry of entries) {
			const path = join(folder, entry.name)
			let file = entry.isFile()
			let subfolder = entry.isDirectory()

			if (entry.isSymbolicLink()) {
				// A link is followed to what it points at; a broken one is left out.
				const target = await stat(path).catch(() => undefined)
				file = target?.isFile() ?? false
				subfolder = target?.isDirectory() ?? false
			}

			if (subfolder) await walk(path, false)
			else if (file && extname(entry.name).toLowerCase() === QUAD_INDEX_EXTENSION) nebulosa.push(path)
			else if (file && isAstrometryNetIndex(entry.name)) astrometryNet.push(path)
		}
	}

	await walk(directory, true)
	return { nebulosa: nebulosa.sort(), astrometryNet: astrometryNet.sort(), unreadable: unreadable.sort() }
}

// Pixels a native solve measures: the grayscale copy of an image, or a FITS file of private pixels (see
// PlateSolvePixels), decoded by the worker.
export type NativeSolvePixels = { readonly kind: 'image'; readonly image: Image } | { readonly kind: 'fits'; readonly bytes: Uint8Array<ArrayBuffer> }

// What a native solve searches. Angles are radians.
export interface NativeSolveParameters {
	// Pixels to measure; the buffer of a grayscale copy is transferred to the worker, and private pixels are copied.
	readonly pixels: NativeSolvePixels
	// Folder of the quad index files; empty for none.
	readonly indexDirectory: string
	// Width of the image, in pixels.
	readonly width: number
	// Height of the image, in pixels.
	readonly height: number
	// Search cone of the image center, absent for the whole sky: ICRS center and radius, radians.
	readonly position?: { readonly rightAscension: number; readonly declination: number; readonly radius: number }
	// Range of the image scale, radians per pixel; absent searches every scale of the indexes.
	readonly scale?: { readonly lower: number; readonly upper: number }
	// Longest time of the whole solve, detection included, in milliseconds.
	readonly timeout: number
}

// Request to the native solver worker: a solve, or the stop of one.
export type NativeWorkerRequest = ({ readonly type: 'solve'; readonly jobId: string } & NativeSolveParameters) | { readonly type: 'cancel'; readonly jobId: string }

// Why a native solve did not complete: it ran out of time, was cancelled, could not read its pixels, failed, or its
// worker died (never answered by the worker itself).
export type NativeSolveErrorCode = 'timeout' | 'cancelled' | 'invalidImage' | 'failed' | 'workerFailed'

// Response of the native solver worker: the WCS header of the solution, a search that ended without one, both with
// the conditions worth knowing about the search (for people), or why the solve did not complete.
export type NativeWorkerResponse =
	| { readonly jobId: string; readonly status: 'solved'; readonly header: FitsHeader; readonly warnings: readonly string[] }
	| { readonly jobId: string; readonly status: 'noSolution'; readonly warnings: readonly string[] }
	| { readonly jobId: string; readonly status: 'failed'; readonly code: NativeSolveErrorCode; readonly error: string }

// Outcome of a native solve that completed: the WCS header of its solution, absent when none was found, and the
// conditions worth knowing about the search, meant for people.
export interface NativeSolveOutcome {
	// FITS WCS header of the solution, TAN or TAN-SIP in the ICRS.
	readonly header?: FitsHeader
	// Conditions worth knowing about the search, such as index files that were skipped.
	readonly warnings: readonly string[]
}

// Error of a native solve that did not complete, with its reason.
export class NativeSolveError extends Error {
	// Creates the error of a reason.
	constructor(
		readonly code: NativeSolveErrorCode,
		message: string,
	) {
		super(message)
	}
}

// Time a worker may take to stop a cancelled solve before it is terminated, in milliseconds: the solver checks its
// signal between slices of at most 50 ms, but the star detection and the opening of an index cannot be interrupted.
const CANCEL_GRACE = 10000

// Time a worker may run past the timeout of a solve before it is terminated, in milliseconds, for the same reason.
const TIMEOUT_GRACE = 30000

// Worker thread of the native solver. `unref` is a Bun extension that the DOM Worker type lacks.
type NativeWorker = Worker & Pick<Bun.Worker, 'unref'>

// A solve waiting for the answer of the worker.
interface PendingSolve {
	// Worker running it.
	readonly worker: Worker
	// Ends the solve with its outcome.
	readonly resolve: (outcome: NativeSolveOutcome) => void
	// Ends the solve with a failure.
	readonly reject: (error: Error) => void
}

// Client of the native solver worker, which keeps the indexes it opened between solves. Solves posted together run on
// the same worker, interleaved by its event loop. A worker that crashes, or does not answer a cancel or a timeout in
// time, is terminated, failing every solve it was running, and the next solve starts another.
export class NativePlateSolver implements Disposable {
	// Worker of the solves, started by the first one.
	#worker?: NativeWorker
	// Solves posted to the worker and not answered yet, by job id.
	readonly #pending = new Map<string, PendingSolve>()

	// Solves the stars of the pixels with the indexes of the parameters, whose pixels are
	// transferred to the worker. Resolves to the outcome of a search that ended, with or without a solution; rejects with NativeSolveError when it ran out of time, was cancelled by signal, could not read its pixels, or
	// failed, or when the worker died.
	solve(parameters: NativeSolveParameters, signal: AbortSignal): Promise<NativeSolveOutcome> {
		if (signal.aborted) return Promise.reject(new NativeSolveError('cancelled', 'The plate solve was cancelled'))

		const worker = this.#start()
		const jobId = Bun.randomUUIDv7()
		const { promise, resolve, reject } = Promise.withResolvers<NativeSolveOutcome>()
		let stop: Timer | undefined

		// The worker is asked to stop, and terminated when it does not within the grace time.
		const onAbort = () => {
			worker.postMessage({ type: 'cancel', jobId } satisfies NativeWorkerRequest, [])
			stop ??= setTimeout(() => this.#terminate(worker, jobId, new NativeSolveError('cancelled', 'The plate solve was cancelled')), CANCEL_GRACE)
		}

		const deadline = setTimeout(() => this.#terminate(worker, jobId, new NativeSolveError('timeout', `The plate solve did not finish within ${parameters.timeout / 1000} s`)), parameters.timeout + TIMEOUT_GRACE)

		const settle = () => {
			clearTimeout(stop)
			clearTimeout(deadline)
			signal.removeEventListener('abort', onAbort)
			this.#pending.delete(jobId)
		}

		this.#pending.set(jobId, {
			worker,
			resolve: (outcome) => {
				settle()
				resolve(outcome)
			},
			reject: (error) => {
				settle()
				reject(error)
			},
		})

		signal.addEventListener('abort', onAbort, { once: true })
		// A grayscale copy is the caller's to hand over; private pixels stay its own, so they are copied.
		const transfer = parameters.pixels.kind === 'image' ? [parameters.pixels.image.raw.buffer] : []
		worker.postMessage({ type: 'solve', jobId, ...parameters } satisfies NativeWorkerRequest, transfer)
		return promise
	}

	// Terminates the worker, failing the solves it was running, for a server stopping in place.
	[Symbol.dispose]() {
		if (this.#worker) this.#terminate(this.#worker)
	}

	// Returns the worker, started when there is none.
	#start(): NativeWorker {
		if (this.#worker) return this.#worker

		// The compiled executable defines the embedded path of the worker (see app/build.ts); elsewhere it is resolved
		// next to this module.
		const worker = new Worker(process.env.NEBULOSA_PLATESOLVING_WORKER ?? new URL('./platesolving.worker.ts', import.meta.url)) as NativeWorker
		// An idle worker must not keep the process alive on its own.
		worker.unref()

		worker.addEventListener('message', ({ data }: MessageEvent<NativeWorkerResponse>) => {
			const pending = this.#pending.get(data.jobId)
			if (!pending) return
			if (data.status === 'solved') pending.resolve({ header: data.header, warnings: data.warnings })
			else if (data.status === 'noSolution') pending.resolve({ warnings: data.warnings })
			else pending.reject(new NativeSolveError(data.code, data.error))
		})

		worker.addEventListener('error', (event: ErrorEvent) => this.#terminate(worker, undefined, new NativeSolveError('workerFailed', `The plate solving worker died: ${event.message}`)))

		this.#worker = worker
		return worker
	}

	// Terminates a worker and fails the solves it was running: with error, only jobId's when given, and the others with
	// the stop of the worker.
	#terminate(worker: NativeWorker, jobId?: string, error?: NativeSolveError) {
		worker.terminate()
		if (this.#worker === worker) this.#worker = undefined
		const stopped = new NativeSolveError('cancelled', 'The plate solving worker was stopped')

		// A rejected solve leaves the map while it is iterated, which a Map allows.
		for (const [id, pending] of this.#pending) {
			if (pending.worker === worker) pending.reject((jobId === undefined || id === jobId) && error ? error : stopped)
		}
	}
}
