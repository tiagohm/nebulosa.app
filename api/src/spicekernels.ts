import { spkFile } from 'nebulosa/src/adapters/ephemeris/horizons'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { errorResponse } from './http'
import { SPICE_KERNEL_CATALOG, type SpiceCatalogEntry } from './spicekernels.catalog'
import { type SpiceKernelJob, SpiceKernelJobs, type SpiceKernelJobContext, SpiceKernelQueueFullError } from './spicekernels.jobs'
import { openSpiceKernel, type SpiceKernelRuntime } from './spicekernels.runtime'
import { type SpiceEphemerisPolicy, type SpiceKernelRecord, type SpiceKernelSourceKind, type SpiceKernelStore, type SpiceSegmentRecord, SpiceKernelTooLargeError, type StagedSpiceKernel } from './spicekernels.store'
import { SsdBusyError, type SsdRequestQueue, SsdThrottledError } from './ssd'

// SPICE Kernel Library: the server-global set of SPK files the Sky ephemeris evaluates locally. Files come from three
// explicit actions of an operator, never from a position request: a curated NAIF download, a Horizons small-body
// generation through the shared JPL queue, or an upload. Each is streamed into staging, inspected, renamed into place,
// recorded, and published as a new runtime generation, one change at a time; a failure leaves the previous generation
// untouched. Enabling, reordering, verifying, and deleting kernels and changing the ephemeris policy follow the same path.
// Every change is announced by `spiceKernels:changed` with the epoch of the process and a new revision, and every job
// change by `spiceKernels:jobUpdated`; tabs read the snapshot again.

export type { SpiceCatalogEntry } from './spicekernels.catalog'
export type { SpiceKernelJob, SpiceKernelJobKind, SpiceKernelJobState } from './spicekernels.jobs'
export type { SpiceEphemerisPolicy, SpiceKernelRecord, SpiceKernelSourceKind, SpiceKernelState, SpiceSegmentRecord } from './spicekernels.store'

// Largest SPK file the library accepts, in bytes (1 GiB): covers de440s.bsp, the full de440.bsp and NAIF's full Saturnian
// satellite ephemeris sat441.bsp (631 MiB), the only NAIF source of Saturn's major moons.
export const MAX_SPICE_KERNEL_BYTES = 1024 * 1024 * 1024

// Longest wait for a curated download, in milliseconds: 30 minutes, so sat441.bsp completes at about 0.4 MB/s.
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000

// Longest wait for a Horizons SPK generation, in milliseconds, once it reaches the head of the JPL queue.
const GENERATION_TIMEOUT_MS = 120_000

// Stable code of an error of the library.
export type SpiceKernelErrorCode = 'notFound' | 'invalidSpk' | 'tooLarge' | 'queueFull' | 'downloadFailed' | 'generationFailed' | 'rateLimited' | 'cancelled' | 'processingFailed'

// What tabs see of a kernel in the snapshot:
// - ready: every evaluable segment resolves to the barycenter;
// - missingDependency: some need bodies no enabled kernel provides (`missingBodies`), such as the Sun of a small body;
// - unsupported: nothing in it can be evaluated (data types or frames the server cannot read);
// - disabled, loading, invalid (failing its integrity or format checks, see `failure`), missing (its file is gone).
export type SpiceKernelReadiness = 'ready' | 'missingDependency' | 'unsupported' | 'disabled' | 'loading' | 'invalid' | 'missing'

// A kernel in the snapshot.
export interface SpiceKernelSummary extends SpiceKernelRecord {
	readonly readiness: SpiceKernelReadiness
	// NAIF codes of the bodies it needs and no enabled kernel provides.
	readonly missingBodies?: readonly number[]
	// Why it is invalid, for people.
	readonly failure?: string
	// NAIF codes of the bodies it can evaluate, ascending.
	readonly targets: readonly number[]
	// Segments in the file, and those the server cannot evaluate.
	readonly segmentCount: number
	readonly unsupportedSegments: number
	// Earliest start and latest end of its segments, in TDB seconds past J2000; gaps between segments are not shown here.
	readonly start?: number
	readonly end?: number
}

// A kernel and its segments.
export interface SpiceKernelDetails extends SpiceKernelSummary {
	readonly segments: readonly SpiceSegmentRecord[]
}

// Snapshot of the library (GET /api/spice-kernels).
export interface SpiceKernelLibrarySnapshot {
	// Random id of the server process; a different one means the revisions started again.
	readonly epoch: string
	// Increased by every change of the kernels, the policy, or a job.
	readonly revision: number
	// Whether the kernels of the previous run are still being opened.
	readonly loading: boolean
	// Generation of the runtime set the ephemeris evaluates.
	readonly generation: number
	readonly policy: SpiceEphemerisPolicy
	// Bytes of every file of the library.
	readonly bytes: number
	// Kernels by priority, lowest first.
	readonly kernels: readonly SpiceKernelSummary[]
	// Acquisition jobs, active ones first.
	readonly jobs: readonly SpiceKernelJob[]
}

// A curated download and whether the library has it.
export interface SpiceCatalogItem extends SpiceCatalogEntry {
	// Kernel downloaded from it, when installed.
	readonly kernelId?: string
}

// Answer of an upload: the kernel, and whether an identical file was already installed.
export interface SpiceKernelImportResponse {
	readonly kernel: SpiceKernelSummary
	readonly alreadyInstalled: boolean
}

// Body of PATCH /api/spice-kernels/:id: turns a kernel on or off, or moves it in the load order (0 is the lowest precedence).
export interface SpiceKernelUpdateRequest {
	readonly enabled?: boolean
	readonly priority?: number
}

// Body of PATCH /api/spice-kernels/settings.
export interface SpiceKernelSettingsRequest {
	readonly policy: SpiceEphemerisPolicy
}

// Body of POST /api/spice-kernels/download.
export interface SpiceKernelDownloadRequest {
	// Id of a curated entry.
	readonly sourceId: string
}

// Body of POST /api/spice-kernels/generate: a small body by its canonical SBDB SPK-ID and an interval in Unix
// milliseconds (UTC); name is the designation shown to people.
export interface SpiceKernelGenerateRequest {
	readonly spkId: string
	readonly name?: string
	readonly start: number
	readonly end: number
}

// Answer of GET /api/spice-kernels/coverage: whether the current set resolves a NAIF body at an instant (Unix
// milliseconds), and if not, which body of its chain stopped it and why.
export interface SpiceKernelCoverage {
	readonly target: number
	readonly time: number
	readonly generation: number
	readonly available: boolean
	readonly kernels?: readonly string[]
	readonly reason?: 'missing' | 'coverage' | 'cycle' | 'dataType' | 'frame'
	readonly body?: number
}

// Events of the library.
export type SpiceKernelEvent = { readonly type: 'spiceKernels:changed'; readonly epoch: string; readonly revision: number } | { readonly type: 'spiceKernels:jobUpdated'; readonly epoch: string; readonly revision: number; readonly job: SpiceKernelJob }

// Error of a request to the library, with its status and stable code.
export class SpiceKernelError extends Error {
	// Creates the error.
	constructor(
		message: string,
		readonly status: number,
		readonly code: SpiceKernelErrorCode,
	) {
		super(message)
	}
}

// Generator of Horizons SPK files, as spkFile.
export type SpkGenerator = typeof spkFile

// Optional dependencies of the library, replaced by tests.
export interface SpiceKernelLibraryOptions {
	// Fetch of the curated downloads.
	readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
	// Generator of Horizons SPK files.
	readonly generate?: SpkGenerator
	// Clock, Unix milliseconds.
	readonly now?: () => number
}

// Provenance of a file being published.
interface Provenance {
	readonly name: string
	readonly sourceKind: SpiceKernelSourceKind
	readonly sourceRef?: string
	readonly requestedStart?: number
	readonly requestedEnd?: number
	// NAIF code the file must contain a segment for.
	readonly target?: number
}

// Describes an error of the library as a message and a code.
function failureOf(error: unknown): { message: string; code: SpiceKernelErrorCode } {
	if (error instanceof SpiceKernelError) return { message: error.message, code: error.code }
	if (error instanceof SpiceKernelTooLargeError) return { message: error.message, code: 'tooLarge' }
	if (error instanceof SpiceKernelQueueFullError) return { message: error.message, code: 'queueFull' }
	if (error instanceof SsdThrottledError || error instanceof SsdBusyError) return { message: 'JPL is busy or asked to slow down. Try again later.', code: 'rateLimited' }
	if (Error.isError(error) && error.name === 'TimeoutError') return { message: 'Horizons did not answer in time.', code: 'generationFailed' }
	return { message: Error.isError(error) ? error.message : String(error), code: 'processingFailed' }
}

// Display name of an upload: its base name, without any directory a browser sent.
function displayName(name: string) {
	return name.split(/[\\/]/).pop()?.trim().slice(0, 200) || 'kernel.bsp'
}

// SPICE Kernel Library of the server.
export class SpiceKernelLibrary implements Disposable {
	readonly #epoch = Bun.randomUUIDv7()
	#revision = 0
	#loading = true
	#chain: Promise<unknown> = Promise.resolve()
	readonly #failures = new Map<string, string>()
	readonly #jobs: SpiceKernelJobs
	readonly #fetch: NonNullable<SpiceKernelLibraryOptions['fetch']>
	readonly #generate: SpkGenerator
	readonly #now: () => number

	// Creates the library over its store and the runtime the ephemeris reads; publish announces its events and queue
	// carries the Horizons generations.
	constructor(
		readonly store: SpiceKernelStore,
		readonly runtime: SpiceKernelRuntime,
		private readonly publish: (event: SpiceKernelEvent) => void,
		private readonly queue: SsdRequestQueue,
		options: SpiceKernelLibraryOptions = {},
	) {
		this.#fetch = options.fetch ?? ((url, init) => fetch(url, init))
		this.#generate = options.generate ?? spkFile
		this.#now = options.now ?? Date.now
		this.#jobs = new SpiceKernelJobs((job) => this.publish({ type: 'spiceKernels:jobUpdated', epoch: this.#epoch, revision: ++this.#revision, job }), failureOf, this.#now)
	}

	// Finishes what a previous run left, then opens the enabled kernels: clears staging, completes pending deletions,
	// marks kernels whose file is gone as missing and those whose content changed as invalid, and publishes the first
	// generation. Never rejects; a kernel that cannot be opened is marked invalid and the others still load.
	start() {
		return this.#exclusive(async () => {
			try {
				await this.store.clearStaging()

				for (const kernel of this.store.kernels()) {
					if (kernel.state === 'pendingDelete') {
						await this.store.removeObject(kernel.sha256)
						this.store.delete(kernel.id)
					} else if (!(await this.store.hasObject(kernel.sha256))) {
						this.store.setState(kernel.id, 'missing')
					} else if (kernel.enabled || kernel.state !== 'ready') {
						this.#check(kernel, (await this.store.hashObject(kernel.sha256)) === kernel.sha256)
					}
				}
			} catch (error) {
				console.error('The SPICE kernels could not be checked', error)
			}

			this.#loading = false
			await this.#rebuild()
			this.#changed()
		})
	}

	// Snapshot of the library.
	snapshot(): SpiceKernelLibrarySnapshot {
		const { generation, policy } = this.runtime.current()
		const segments = this.store.allSegments()
		const kernels = this.store.kernels().map((e) => this.#summary(e, segments.get(e.id) ?? []))
		return { epoch: this.#epoch, revision: this.#revision, loading: this.#loading, generation, policy, bytes: kernels.reduce((sum, e) => sum + e.bytes, 0), kernels, jobs: this.#jobs.list() }
	}

	// A kernel and its segments; throws notFound.
	details(id: string): SpiceKernelDetails {
		const kernel = this.#kernel(id)
		const segments = this.store.segments(id)
		return { ...this.#summary(kernel, segments), segments }
	}

	// Curated downloads and the kernels installed from them.
	catalog(): SpiceCatalogItem[] {
		const kernels = this.store.kernels()
		return SPICE_KERNEL_CATALOG.map((entry) => ({ ...entry, kernelId: kernels.find((e) => e.sourceKind === 'naif' && e.sourceRef === entry.id)?.id }))
	}

	// Whether the current set resolves a NAIF body at an instant in Unix milliseconds. Makes no request.
	coverage(target: number, time: number): SpiceKernelCoverage {
		const { generation, set } = this.runtime.current()
		const result = set?.stateAt(target, timeUnix(time / 1000, true))
		if (result?.ok) return { target, time, generation, available: true, kernels: result.kernels }
		return { target, time, generation, available: false, reason: result?.reason ?? 'missing', body: result?.body ?? target }
	}

	// Adds an uploaded file, streamed from body; an identical file returns the installed kernel.
	async importFile(name: string, body: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<SpiceKernelImportResponse> {
		const staged = await this.store.stage(Bun.randomUUIDv7(), body, MAX_SPICE_KERNEL_BYTES, signal)
		return this.#exclusive(() => this.#publishFile(staged, { name: displayName(name), sourceKind: 'import' }))
	}

	// Starts, or joins, the download of a curated entry; throws notFound for an unknown id.
	download(sourceId: string): SpiceKernelJob {
		const entry = SPICE_KERNEL_CATALOG.find((e) => e.id === sourceId)
		if (!entry) throw new SpiceKernelError('Unknown curated kernel.', 404, 'notFound')
		return this.#submit('download', `download:${entry.id}`, entry.name, (context) => this.#download(entry, context))
	}

	// Starts, or joins, the Horizons generation of a small-body SPK over an interval in Unix milliseconds (UTC).
	generate(request: SpiceKernelGenerateRequest): SpiceKernelJob {
		const label = request.name ? `${request.name} (${request.spkId})` : request.spkId
		return this.#submit('generate', `generate:${request.spkId}:${request.start}:${request.end}`, label, (context) => this.#generateFile(request, label, context))
	}

	// Cancels a job; throws notFound.
	cancel(jobId: string): SpiceKernelJob {
		const job = this.#jobs.cancel(jobId)
		if (!job) throw new SpiceKernelError('Unknown job.', 404, 'notFound')
		return job
	}

	// Turns a kernel on or off and moves it in the load order, then publishes a new generation; throws notFound.
	update(id: string, request: SpiceKernelUpdateRequest): Promise<SpiceKernelDetails> {
		return this.#exclusive(async () => {
			this.#kernel(id)
			if (request.enabled !== undefined) this.store.setEnabled(id, request.enabled)
			if (request.priority !== undefined) this.store.setPriority(id, request.priority)
			await this.#rebuild()
			this.#changed()
			return this.details(id)
		})
	}

	// Hashes and inspects the file of a kernel again, marking it ready, invalid, or missing; never downloads it again.
	verify(id: string): Promise<SpiceKernelDetails> {
		return this.#exclusive(async () => {
			const kernel = this.#kernel(id)

			if (!(await this.store.hasObject(kernel.sha256))) this.store.setState(id, 'missing')
			else this.#check(kernel, (await this.store.hashObject(kernel.sha256)) === kernel.sha256)

			if (this.store.kernel(id)?.state === 'ready') {
				try {
					await (await openSpiceKernel(this.store.objectPath(kernel.sha256))).source.close()
				} catch (error) {
					this.store.setState(id, 'invalid')
					this.#failures.set(id, Error.isError(error) ? error.message : String(error))
				}
			}

			await this.#rebuild()
			this.#changed()
			return this.details(id)
		})
	}

	// Deletes a kernel: leaves the runtime set first, so its file is closed, then removes the file and the rows. Throws notFound.
	remove(id: string): Promise<void> {
		return this.#exclusive(async () => {
			const kernel = this.#kernel(id)
			this.store.setState(id, 'pendingDelete')
			await this.#rebuild()
			await this.store.removeObject(kernel.sha256)
			this.store.delete(id)
			this.#failures.delete(id)
			this.#changed()
		})
	}

	// Changes the ephemeris policy.
	setPolicy(policy: SpiceEphemerisPolicy): Promise<SpiceKernelLibrarySnapshot> {
		return this.#exclusive(() => {
			this.store.setPolicy(policy)
			this.runtime.setPolicy(policy)
			this.#changed()
			return this.snapshot()
		})
	}

	// Aborts the jobs, for a server stopping in place.
	[Symbol.dispose]() {
		this.#jobs[Symbol.dispose]()
	}

	// Runs a change after every earlier one.
	#exclusive<T>(change: () => T | Promise<T>): Promise<T> {
		const result = this.#chain.then(change)
		this.#chain = result.catch(() => undefined)
		return result
	}

	// Submits a job, mapping a full queue.
	#submit(kind: SpiceKernelJob['kind'], key: string, label: string, task: (context: SpiceKernelJobContext) => Promise<{ kernelId: string; alreadyInstalled: boolean }>) {
		try {
			return this.#jobs.submit(kind, key, label, task)
		} catch (error) {
			if (error instanceof SpiceKernelQueueFullError) throw new SpiceKernelError(error.message, 503, 'queueFull')
			throw error
		}
	}

	// Downloads a curated entry into staging and publishes it.
	async #download(entry: SpiceCatalogEntry, context: SpiceKernelJobContext) {
		const signal = AbortSignal.any([context.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)])
		let response: Response

		try {
			response = await this.#fetch(entry.url, { signal, redirect: 'error' })
		} catch (error) {
			if (context.signal.aborted) throw error
			throw new SpiceKernelError(`NAIF could not be reached: ${Error.isError(error) ? error.message : String(error)}`, 502, 'downloadFailed')
		}

		if (!response.ok || !response.body) {
			await response.body?.cancel()
			throw new SpiceKernelError(`NAIF answered ${response.status}.`, 502, 'downloadFailed')
		}

		const length = Number(response.headers.get('content-length')) || undefined
		if (length !== undefined && length > MAX_SPICE_KERNEL_BYTES) throw new SpiceKernelTooLargeError(MAX_SPICE_KERNEL_BYTES)
		const total = length ?? entry.bytes
		const staged = await this.store.stage(Bun.randomUUIDv7(), response.body, MAX_SPICE_KERNEL_BYTES, signal, (bytes) => context.progress(bytes, total))
		context.stage('validating')
		return await this.#exclusive(() => this.#publishFile(staged, { name: entry.name, sourceKind: 'naif', sourceRef: entry.id }, context))
	}

	// Asks Horizons for a small-body SPK through the JPL queue, stages it, and publishes it.
	async #generateFile(request: SpiceKernelGenerateRequest, label: string, context: SpiceKernelJobContext) {
		const id = Number(request.spkId)
		const file = await this.queue.run((signal) => this.#generate(id, request.start, request.end, signal, { headers: this.queue.headers }), { timeoutMs: GENERATION_TIMEOUT_MS, signal: context.signal, key: `spk:${request.spkId}:${request.start}:${request.end}` })

		if (!file.spk) throw new SpiceKernelError(file.error?.trim() || 'Horizons did not generate the kernel.', 502, 'generationFailed')

		const bytes = Buffer.from(file.spk, 'base64')
		context.progress(bytes.byteLength, bytes.byteLength)
		const staged = await this.store.stage(Bun.randomUUIDv7(), new Blob([bytes]).stream(), MAX_SPICE_KERNEL_BYTES, context.signal)
		context.stage('validating')
		return await this.#exclusive(() => this.#publishFile(staged, { name: label, sourceKind: 'horizons', sourceRef: request.spkId, requestedStart: request.start, requestedEnd: request.end, target: id }, context))
	}

	// Inspects a staged file, moves it into place, records it, and publishes a new generation. An identical installed file
	// is returned instead. Removes the staged file on any failure.
	async #publishFile(staged: StagedSpiceKernel, provenance: Provenance, context?: SpiceKernelJobContext) {
		try {
			context?.signal.throwIfAborted()
			const prepared = await openSpiceKernel(staged.path).catch((error: unknown) => {
				throw new SpiceKernelError(`Not a usable SPK file: ${Error.isError(error) ? error.message : String(error)}`, 422, 'invalidSpk')
			})
			await prepared.source.close()

			if (provenance.target !== undefined && !prepared.segments.some((e) => e.target === provenance.target)) {
				throw new SpiceKernelError(`The generated kernel has no segment for ${provenance.target}.`, 502, 'generationFailed')
			}

			const existing = this.store.kernelBySha(staged.sha256)

			if (existing) {
				await this.store.discard(staged)
				return { kernel: this.#summary(existing, this.store.segments(existing.id)), kernelId: existing.id, alreadyInstalled: true }
			}

			context?.stage('publishing')
			await this.store.promote(staged)
			const { target: _, ...record } = provenance
			const kernel = this.store.insert({ ...record, id: Bun.randomUUIDv7(), sha256: staged.sha256, bytes: staged.bytes, createdAt: this.#now() }, prepared.segments)
			await this.#rebuild()
			this.#changed()
			return { kernel: this.#summary(kernel, this.store.segments(kernel.id)), kernelId: kernel.id, alreadyInstalled: false }
		} catch (error) {
			await this.store.discard(staged)
			throw error
		}
	}

	// Marks a kernel ready or invalid by the result of its integrity check.
	#check(kernel: SpiceKernelRecord, intact: boolean) {
		if (intact) {
			if (kernel.state !== 'ready') this.store.setState(kernel.id, 'ready')
			this.#failures.delete(kernel.id)
		} else {
			this.store.setState(kernel.id, 'invalid')
			this.#failures.set(kernel.id, 'The file changed since it was added.')
		}
	}

	// Publishes the enabled ready kernels as a new runtime generation; a kernel that cannot be opened is marked invalid.
	async #rebuild() {
		const kernels = this.store.kernels().filter((e) => e.enabled && e.state === 'ready')
		const failures = await this.runtime.rebuild(
			kernels.map((e) => ({ id: e.id, path: this.store.objectPath(e.sha256) })),
			this.store.policy(),
		)

		for (const [id, error] of failures) {
			this.store.setState(id, 'invalid')
			this.#failures.set(id, error.message)
		}
	}

	// Announces a change.
	#changed() {
		this.publish({ type: 'spiceKernels:changed', epoch: this.#epoch, revision: ++this.#revision })
	}

	// A kernel; throws notFound.
	#kernel(id: string) {
		const kernel = this.store.kernel(id)
		if (!kernel || kernel.state === 'pendingDelete') throw new SpiceKernelError('Unknown kernel.', 404, 'notFound')
		return kernel
	}

	// What tabs see of a kernel.
	#summary(kernel: SpiceKernelRecord, segments: readonly SpiceSegmentRecord[]): SpiceKernelSummary {
		const snapshot = this.runtime.current()
		const supported = segments.filter((e) => e.supported)
		const targets = [...new Set(supported.map((e) => e.target))].sort((a, b) => a - b)
		const start = segments.length > 0 ? Math.min(...segments.map((e) => e.start)) : undefined
		const end = segments.length > 0 ? Math.max(...segments.map((e) => e.end)) : undefined
		const base = { ...kernel, targets, segmentCount: segments.length, unsupportedSegments: segments.length - supported.length, start, end }

		if (kernel.state === 'missing') return { ...base, readiness: 'missing' }
		if (kernel.state === 'invalid') return { ...base, readiness: 'invalid', failure: this.#failures.get(kernel.id) }
		if (!kernel.enabled || kernel.state === 'pendingDelete') return { ...base, readiness: 'disabled' }
		if (this.#loading) return { ...base, readiness: 'loading' }

		const readiness = snapshot.readiness.get(kernel.id)
		if (!readiness) return { ...base, readiness: 'invalid', failure: this.#failures.get(kernel.id) }
		if (readiness.status === 'missingDependency') return { ...base, readiness: 'missingDependency', missingBodies: readiness.bodies }
		return { ...base, readiness: readiness.status }
	}
}

// Answers a failure of a route with its status and code.
function failure(error: unknown) {
	if (error instanceof SpiceKernelError) return errorResponse(error.message, error.status, error.code)
	if (error instanceof SpiceKernelTooLargeError) return errorResponse(error.message, 413, 'tooLarge')
	if (Error.isError(error) && error.name === 'AbortError') return errorResponse('Cancelled.', 499, 'cancelled')
	return errorResponse(Error.isError(error) ? error.message : String(error), 500, 'processingFailed')
}

// Runs a handler, answering its result as JSON.
async function answer(handler: () => unknown, status = 200) {
	try {
		const result = await handler()
		return result === undefined ? new Response(null, { status: 204 }) : Response.json(result, { status })
	} catch (error) {
		return failure(error)
	}
}

// Routes of the SPICE Kernel Library under /api/spice-kernels. Errors are { error, code } with a SpiceKernelErrorCode.
export function createSpiceKernelRoutes(library: SpiceKernelLibrary) {
	return {
		'/api/spice-kernels': {
			// Snapshot of the library (SpiceKernelLibrarySnapshot).
			GET: () => Response.json(library.snapshot() satisfies SpiceKernelLibrarySnapshot),
		},
		'/api/spice-kernels/catalog': {
			// Curated NAIF downloads (SpiceCatalogItem[]).
			GET: () => Response.json(library.catalog() satisfies SpiceCatalogItem[]),
		},
		'/api/spice-kernels/coverage': {
			// Whether the current set resolves ?target (NAIF code) at ?time (Unix milliseconds, default now) (SpiceKernelCoverage).
			GET: (req) => {
				const params = new URL(req.url).searchParams
				return Response.json(library.coverage(Number(params.get('target')), Number(params.get('time') ?? Date.now())) satisfies SpiceKernelCoverage)
			},
		},
		'/api/spice-kernels/settings': {
			// Changes the ephemeris policy (SpiceKernelSettingsRequest, SpiceKernelLibrarySnapshot).
			PATCH: (req) => answer(async () => library.setPolicy(((await req.json()) as SpiceKernelSettingsRequest).policy)),
		},
		'/api/spice-kernels/import': {
			// Adds the SPK file of the application/octet-stream body, named by ?name (SpiceKernelImportResponse); 201 when
			// added, 200 when an identical file was installed; 413 tooLarge, 422 invalidSpk.
			POST: async (req) => {
				const name = new URL(req.url).searchParams.get('name') ?? 'kernel.bsp'
				if (!req.body) return errorResponse('The request has no file.', 422, 'invalidSpk')
				const body = req.body
				try {
					const result = await library.importFile(name, body, req.signal)
					return Response.json(result satisfies SpiceKernelImportResponse, { status: result.alreadyInstalled ? 200 : 201 })
				} catch (error) {
					return failure(error)
				}
			},
		},
		'/api/spice-kernels/download': {
			// Starts or joins the download of a curated entry (SpiceKernelDownloadRequest, SpiceKernelJob); 404 notFound, 503 queueFull.
			POST: (req) => answer(async () => library.download(((await req.json()) as SpiceKernelDownloadRequest).sourceId), 202),
		},
		'/api/spice-kernels/generate': {
			// Starts or joins a Horizons small-body generation (SpiceKernelGenerateRequest, SpiceKernelJob); 503 queueFull.
			POST: (req) => answer(async () => library.generate((await req.json()) as SpiceKernelGenerateRequest), 202),
		},
		'/api/spice-kernels/jobs/:jobId/cancel': {
			// Cancels a queued or running job (SpiceKernelJob); 404 notFound.
			POST: (req) => answer(() => library.cancel(req.params.jobId)),
		},
		'/api/spice-kernels/:id': {
			// A kernel and its segments (SpiceKernelDetails); 404 notFound.
			GET: (req) => answer(() => library.details(req.params.id)),
			// Turns a kernel on or off or moves it in the load order (SpiceKernelUpdateRequest, SpiceKernelDetails); 404 notFound.
			PATCH: (req) => answer(async () => library.update(req.params.id, (await req.json()) as SpiceKernelUpdateRequest)),
			// Deletes a kernel and its file; 204, 404 notFound.
			DELETE: (req) => answer(() => library.remove(req.params.id)),
		},
		'/api/spice-kernels/:id/verify': {
			// Hashes and inspects the file of a kernel again (SpiceKernelDetails); 404 notFound.
			POST: (req) => answer(() => library.verify(req.params.id)),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
