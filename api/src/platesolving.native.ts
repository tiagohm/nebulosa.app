import { readdir } from 'fs/promises'
import { extname, join } from 'path'
import { QUAD_INDEX_EXTENSION } from 'nebulosa/src/astrometry/solvers/quad.index.file'
import { AstapCatalog, type Astap1476Database } from 'nebulosa/src/catalogs/stars/astap'
import type { StarCatalog } from 'nebulosa/src/catalogs/stars/catalog'
import { HnskyCatalog, type Hnsky290Database } from 'nebulosa/src/catalogs/stars/hnsky'
import type { Image } from 'nebulosa/src/imaging/model/types'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'

// Built-in plate solver of the server: the toolkit's native solver (nativePlateSolve, after Astrometry.net) run on a
// worker of its own (platesolving.worker.ts), which detects the stars of the grayscale copy of an image, searches the
// quad index files of a folder (Nebulosa .nqi tiles and Astrometry.net index files) and, around a known position and
// scale, the quads it builds in memory from a local ASTAP or HNSKY star database. This module finds those files on the
// server's filesystem, for the worker, the check of External Tools, and the index generator of bin, and is the client
// of the worker: one worker kept between solves, so the indexes it opened stay open, asked to stop a solve by a
// message (the solver yields to its event loop between slices) and terminated only when it does not answer in time.

// Extension of the files of an ASTAP star database (.1476) and of an HNSKY one (.290), by kind.
const STAR_DATABASE_EXTENSIONS = { astap: '.1476', hnsky: '.290' } as const

// Star databases the toolkit's readers decode, by kind, shallowest first.
export const SUPPORTED_STAR_DATABASES = { astap: ['d05', 'd20', 'd50', 'd80'], hnsky: ['g14', 'g16'] } as const satisfies { readonly astap: readonly Astap1476Database[]; readonly hnsky: readonly Hnsky290Database[] }

// Kind of a local star database: ASTAP or HNSKY.
export type StarDatabaseKind = keyof typeof SUPPORTED_STAR_DATABASES

// A local star database: the files of one supported database in a folder, named <database>_<tile>.<extension>.
export interface StarDatabase {
	// Program whose format the files are in.
	readonly kind: StarDatabaseKind
	// Name of the database, lowercase, such as d50.
	readonly database: Astap1476Database | Hnsky290Database
	// Opens a new reader over the files; a reader caches every tile it reads until it is disposed.
	readonly open: () => StarCatalog & Disposable
}

// Quad index files of a folder and its subfolders, each list sorted by path.
export interface QuadIndexFiles {
	// Nebulosa quad index tiles (.nqi).
	readonly nebulosa: readonly string[]
	// Astrometry.net index files (index-*.fits or index-*.fit).
	readonly astrometryNet: readonly string[]
}

// Whether a file name is that of an Astrometry.net index file, as its build-index and its downloads name them.
function isAstrometryNetIndex(name: string) {
	const lower = name.toLowerCase()
	return lower.startsWith('index-') && (lower.endsWith('.fits') || lower.endsWith('.fit'))
}

// Returns the quad index files of a folder and its subfolders. Throws when the folder cannot be read.
export async function findQuadIndexFiles(directory: string): Promise<QuadIndexFiles> {
	const nebulosa: string[] = []
	const astrometryNet: string[] = []

	for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile()) continue
		const path = join(entry.parentPath, entry.name)
		if (extname(entry.name).toLowerCase() === QUAD_INDEX_EXTENSION) nebulosa.push(path)
		else if (isAstrometryNetIndex(entry.name)) astrometryNet.push(path)
	}

	return { nebulosa: nebulosa.sort(), astrometryNet: astrometryNet.sort() }
}

// Returns the supported star databases whose files are in a folder (not its subfolders), shallowest first within each
// kind, ASTAP first. Throws when the folder cannot be read.
export async function findStarDatabases(directory: string): Promise<StarDatabase[]> {
	const names = await readdir(directory)
	const databases: StarDatabase[] = []

	for (const kind of ['astap', 'hnsky'] as const) {
		const extension = STAR_DATABASE_EXTENSIONS[kind]
		const files = names.filter((name) => name.toLowerCase().endsWith(extension) && name.includes('_'))

		for (const database of SUPPORTED_STAR_DATABASES[kind]) {
			const members = files.filter((name) => name.toLowerCase().startsWith(`${database}_`))
			if (members.length === 0) continue
			const map = new Map(members.map((name) => [name.toLowerCase(), Bun.file(join(directory, name))] as const))
			const open = kind === 'astap' ? () => new AstapCatalog().open(map, database as Astap1476Database) : () => new HnskyCatalog().open(map, database as Hnsky290Database)
			databases.push({ kind, database, open })
		}
	}

	return databases
}

// Name of a star database for people, such as ASTAP D50.
export function starDatabaseName({ kind, database }: Pick<StarDatabase, 'kind' | 'database'>) {
	return `${kind.toUpperCase()} ${database.toUpperCase()}`
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
	// Folder of the star database of the search around a position; empty for none.
	readonly catalogDirectory: string
	// Size of the image, in pixels.
	readonly width: number
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

	// Solves the stars of the pixels with the indexes and the star database of the parameters, whose pixels are
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
