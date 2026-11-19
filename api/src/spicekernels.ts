import { spkFile } from 'nebulosa/src/adapters/ephemeris/horizons'
import type { PositionAndVelocity } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { equatorialToEclipticJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { eraC2s } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { spkSeconds } from 'nebulosa/src/astronomy/ephemeris/kernels/spk'
import type { SpkChainLink, SpkCoverageInterval, SpkKernelSet, SpkMissReason } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import { timeUnix, toJulianDay, tdb } from 'nebulosa/src/astronomy/time/time'
import { AU_KM, DAYSEC, SPEED_OF_LIGHT } from 'nebulosa/src/core/constants'
import { normalizeAngle } from 'nebulosa/src/math/units/angle'
import { errorResponse } from './http'
import { SPICE_KERNEL_CATALOG, type SpiceCatalogEntry } from './spicekernels.catalog'
import { type SpiceKernelJob, SpiceKernelJobs, type SpiceKernelJobContext, SpiceKernelQueueFullError } from './spicekernels.jobs'
import { inspectSpiceKernel, openSpiceKernel, type SpiceKernelRuntime } from './spicekernels.runtime'
import type { SpiceKernelRecord, SpiceKernelSourceKind, SpiceKernelStore, SpiceSegmentRecord, StagedSpiceKernel } from './spicekernels.store'
import { SsdBusyError, type SsdRequestQueue, SsdThrottledError } from './ssd'

// SPICE Kernel Library: the server-global set of SPK files the Sky ephemeris evaluates locally. Files come from three
// explicit actions of an operator, never from a position request: a curated NASA/JPL download, a Horizons small-body
// generation through the shared JPL queue, or an upload. Each is streamed into staging, inspected, renamed into place,
// recorded, and published as a new runtime generation, one change at a time; a failure leaves the previous generation
// untouched. Enabling, reordering, verifying, and deleting kernels, preferring a kernel for a body, and changing the
// offline switch of the ephemeris sources follow the same path. The library also explains the selection of the current generation body by
// body (which segment is used where, and which never is) and evaluates a body at an instant, through the selection or
// from one chosen segment, for an operator checking the kernels.
// Every change is announced by `spiceKernels:changed` with the epoch of the process and a new revision, and every job
// change by `spiceKernels:jobUpdated`; tabs read the snapshot again.

export type { SpiceCatalogEntry, SpiceCatalogSystem } from './spicekernels.catalog'
export type { SpiceKernelJob, SpiceKernelJobKind, SpiceKernelJobState } from './spicekernels.jobs'
export type { SpiceKernelRecord, SpiceKernelSourceKind, SpiceKernelState, SpiceSegmentRecord } from './spicekernels.store'

// Longest wait for a curated download without receiving a byte, in milliseconds (2 minutes). The whole download has no
// time limit, since the satellite ephemerides reach 2 GiB; a stalled one fails instead.
const DOWNLOAD_STALL_MS = 2 * 60 * 1000

// Longest wait for a Horizons SPK generation, in milliseconds, once it reaches the head of the JPL queue.
const GENERATION_TIMEOUT_MS = 120_000

// Stable code of an error of the library.
export type SpiceKernelErrorCode = 'notFound' | 'invalidSpk' | 'queueFull' | 'downloadFailed' | 'generationFailed' | 'rateLimited' | 'cancelled' | 'processingFailed'

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

// A segment of a kernel and, while the kernel is in the current set, how much of its coverage it is selected for.
export interface SpiceKernelSegment extends SpiceSegmentRecord {
	readonly usage?: SpiceSegmentUsage
}

// A kernel and its segments.
export interface SpiceKernelDetails extends SpiceKernelSummary {
	readonly segments: readonly SpiceKernelSegment[]
}

// Snapshot of the library (GET /api/spice-kernels).
export interface SpiceKernelLibrarySnapshot {
	// Random id of the server process; a different one means the revisions started again.
	readonly epoch: string
	// Increased by every change of the kernels, the offline switch, or a job.
	readonly revision: number
	// Whether the kernels of the previous run are still being opened.
	readonly loading: boolean
	// Generation of the runtime set the ephemeris evaluates.
	readonly generation: number
	// Whether no automatic request reaches JPL (Horizons, SBDB, CAD), for every ephemeris of the server.
	readonly offline: boolean
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
	// Whether no automatic request may reach JPL.
	readonly offline: boolean
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

// How much of its coverage a segment is selected for in the current set: all of it, part of it (another segment of
// higher precedence covers the rest), or none (it is never used).
export type SpiceSegmentUsage = 'full' | 'partial' | 'never'

// A segment of a body in the current set, in selection order, and where it is selected. Epochs are TDB seconds past J2000.
export interface SpiceBodySegment {
	readonly kernelId: string
	// Position of the segment in its file, from 0.
	readonly segment: number
	readonly center: number
	readonly frame: number
	readonly dataType: number
	readonly start: number
	readonly end: number
	readonly supported: boolean
	readonly reason?: 'dataType' | 'frame'
	// Whether its kernel is the preferred one of the body.
	readonly preferred: boolean
	readonly usage: SpiceSegmentUsage
}

// One interval of the effective coverage of a body: the segment selected from start to end, TDB seconds past J2000.
export interface SpiceBodyInterval {
	readonly start: number
	readonly end: number
	readonly kernelId: string
	readonly segment: number
	readonly preferred: boolean
	// An unsupported selected segment makes the body unavailable over the interval.
	readonly supported: boolean
}

// How the current set selects the segments of one body.
export interface SpiceBody {
	// NAIF code.
	readonly body: number
	// Kernel the operator prefers for the body, whether or not it is enabled.
	readonly preferredKernelId?: string
	// Kernels of the set with segments of the body, in selection order.
	readonly kernelIds: readonly string[]
	// Segments of the body in selection order: those of the preferred kernel first, then the load order, highest first.
	readonly segments: readonly SpiceBodySegment[]
	// Disjoint intervals, by increasing time, with the segment selected in each.
	readonly coverage: readonly SpiceBodyInterval[]
}

// Answer of GET /api/spice-kernels/bodies: every body of the current set, by NAIF code.
export interface SpiceBodiesResponse {
	readonly generation: number
	readonly bodies: readonly SpiceBody[]
}

// Body of PUT /api/spice-kernels/bodies/:body/preference: the kernel to prefer for the body, or none to follow the load
// order alone.
export interface SpiceBodyPreferenceRequest {
	readonly kernelId?: string
}

// Body of POST /api/spice-kernels/evaluate: the state of target relative to center at time (Unix milliseconds, UTC),
// through the selection of the current set, or, with source, from that segment of the target.
export interface SpiceEvaluationRequest {
	readonly target: number
	readonly center: number
	readonly time: number
	readonly source?: { readonly kernelId: string; readonly segment: number }
}

// One segment of a chain of the current set.
export interface SpiceChainLink {
	readonly body: number
	readonly center: number
	readonly kernelId: string
	readonly segment: number
	readonly preferred: boolean
}

// State of a target relative to a center, in the J2000 (ICRF) axes. The direction is geometric: no light time,
// aberration, or deflection is applied.
export interface SpiceEvaluation {
	readonly ok: true
	readonly generation: number
	readonly target: number
	readonly center: number
	// Instant, Unix milliseconds (UTC), and the same instant in TDB seconds past J2000 and as a TDB Julian date.
	readonly time: number
	readonly tdbSeconds: number
	readonly tdbJulianDate: number
	// Position (km) and velocity (km/s).
	readonly position: readonly [number, number, number]
	readonly velocity: readonly [number, number, number]
	// Distance (km), speed (km/s), rate of change of the distance (km/s), and one-way light time (s).
	readonly distance: number
	readonly speed: number
	readonly rangeRate: number
	readonly lightTime: number
	// Direction of the target from the center: right ascension and declination (ICRF), and longitude and latitude on the
	// J2000 mean ecliptic, radians.
	readonly rightAscension: number
	readonly declination: number
	readonly eclipticLongitude: number
	readonly eclipticLatitude: number
	// Segments behind the state: the chosen source segment, if any, then the chains of the bodies resolved to the
	// barycenter (empty when the source segment is relative to the center itself).
	readonly source?: SpiceChainLink
	readonly targetChain: readonly SpiceChainLink[]
	readonly centerChain: readonly SpiceChainLink[]
}

// Why an evaluation has no state: the reason and the body where resolution stopped, the segment when it is the
// unsupported one selected, and which side stopped (the source segment, the target, or the center).
export interface SpiceEvaluationMiss {
	readonly ok: false
	readonly generation: number
	readonly side: 'source' | 'target' | 'center'
	readonly reason: SpkMissReason
	readonly body: number
	readonly kernelId?: string
	readonly segment?: number
}

// Answer of POST /api/spice-kernels/evaluate.
export type SpiceEvaluationResult = SpiceEvaluation | SpiceEvaluationMiss

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
	// Longest wait for a curated download without receiving a byte, in milliseconds; DOWNLOAD_STALL_MS by default.
	readonly downloadStallMs?: number
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
	readonly #downloadStallMs: number

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
		this.#downloadStallMs = options.downloadStallMs ?? DOWNLOAD_STALL_MS
		this.#jobs = new SpiceKernelJobs((job) => this.publish({ type: 'spiceKernels:jobUpdated', epoch: this.#epoch, revision: ++this.#revision, job }), failureOf, this.#now)
	}

	// Finishes what a previous run left, then opens the enabled kernels: clears staging, completes pending deletions,
	// marks kernels whose file is gone as missing and those whose content changed as invalid, records again which segments
	// the toolkit can evaluate, and publishes the first generation. Never rejects; a kernel that cannot be opened is marked
	// invalid and the others still load.
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
					} else {
						if (kernel.enabled || kernel.state !== 'ready') this.#check(kernel, (await this.store.hashObject(kernel.sha256)) === kernel.sha256)
						if (this.store.kernel(kernel.id)?.state === 'ready') await this.#refreshSupport(kernel)
					}
				}
			} catch (error) {
				console.error('The SPICE kernels could not be checked', error)
			}

			this.#loading = false

			try {
				await this.#rebuild()
			} catch (error) {
				console.error('The SPICE kernels could not be opened', error)
			}

			// Published whatever happened, so the tabs stop showing the library as loading.
			this.#changed()
		})
	}

	// Snapshot of the library.
	snapshot(): SpiceKernelLibrarySnapshot {
		const { generation, offline } = this.runtime.current()
		const segments = this.store.allSegments()
		const kernels = this.store.kernels().map((e) => this.#summary(e, segments.get(e.id) ?? []))
		return { epoch: this.#epoch, revision: this.#revision, loading: this.#loading, generation, offline, bytes: kernels.reduce((sum, e) => sum + e.bytes, 0), kernels, jobs: this.#jobs.list() }
	}

	// A kernel and its segments; throws notFound.
	details(id: string): SpiceKernelDetails {
		const kernel = this.#kernel(id)
		const segments = this.store.segments(id)
		const { set } = this.runtime.current()
		const inSet = set?.kernels.includes(id) ?? false
		const coverage = new Map<number, SpkCoverageInterval[]>()

		function usage(segment: SpiceSegmentRecord) {
			if (!set || !inSet) return undefined
			let intervals = coverage.get(segment.target)

			if (!intervals) {
				intervals = set.coverage(segment.target)
				coverage.set(segment.target, intervals)
			}

			return usageOf(intervals, id, segment.index, segment.start, segment.end)
		}

		return { ...this.#summary(kernel, segments), segments: segments.map((e): SpiceKernelSegment => Object.assign(e, { usage: usage(e) })) }
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

	// How the current set selects the segments of each of its bodies, by NAIF code. Makes no request.
	bodies(): SpiceBodiesResponse {
		const { generation, set } = this.runtime.current()
		if (!set) return { generation, bodies: [] }
		const preferences = this.store.preferences()
		const bodies = [...set.bodies].sort((a, b) => a - b).map((body) => bodyOf(set, body, preferences.get(body)))
		return { generation, bodies }
	}

	// Prefers a kernel for a NAIF body, or removes the preference without kernel, then publishes a new generation; throws
	// notFound for an unknown kernel.
	setPreference(body: number, request: SpiceBodyPreferenceRequest): Promise<SpiceBodiesResponse> {
		return this.#exclusive(async () => {
			if (!Number.isSafeInteger(body)) throw new SpiceKernelError('Unknown body.', 404, 'notFound')
			if (request.kernelId !== undefined) this.#kernel(request.kernelId)
			this.store.setPreference(body, request.kernelId)
			await this.#rebuild()
			this.#changed()
			return this.bodies()
		})
	}

	// State of a target relative to a center at an instant in Unix milliseconds, through the selection of the current set
	// or from one chosen segment of the target. Makes no request.
	evaluate(request: SpiceEvaluationRequest): SpiceEvaluationResult {
		const { generation, set } = this.runtime.current()
		const time = timeUnix(request.time / 1000, true)
		const miss = (side: SpiceEvaluationMiss['side'], reason: SpkMissReason, body: number, kernelId?: string, segment?: number): SpiceEvaluationMiss => ({ ok: false, generation, side, reason, body, kernelId, segment })

		if (!set) return miss('target', 'missing', request.target)

		let target: PositionAndVelocity
		let targetChain: readonly SpiceChainLink[] = []
		let centerChain: readonly SpiceChainLink[] = []
		let source: SpiceChainLink | undefined

		if (request.source) {
			const { kernelId, segment } = request.source
			const candidate = set.candidates(request.target).find((e) => e.kernel === kernelId && e.descriptor.index === segment)
			if (!candidate) return miss('source', 'missing', request.target, kernelId, segment)
			const state = set.segmentStateAt(kernelId, segment, time)
			if (!state.ok) return miss('source', state.reason, request.target, kernelId, segment)
			source = { body: state.target, center: state.center, kernelId, segment, preferred: candidate.preferred }

			// Relative to its own center, the segment alone answers.
			if (state.center === request.center) return evaluation(generation, request, time, state.state, source, [], [])

			const origin = set.stateAt(state.center, time)
			if (!origin.ok) return miss('target', origin.reason, origin.body, origin.kernel, origin.segment)
			target = addStates(state.state, origin.state)
			targetChain = origin.chain.map(linkOf)
		} else {
			const state = set.stateAt(request.target, time)
			if (!state.ok) return miss('target', state.reason, state.body, state.kernel, state.segment)
			target = state.state
			targetChain = state.chain.map(linkOf)
		}

		const center = set.stateAt(request.center, time)
		if (!center.ok) return miss('center', center.reason, center.body, center.kernel, center.segment)
		centerChain = center.chain.map(linkOf)

		return evaluation(generation, request, time, subtractStates(target, center.state), source, targetChain, centerChain)
	}

	// Adds an uploaded file, streamed from body; an identical file returns the installed kernel.
	async importFile(name: string, body: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<SpiceKernelImportResponse> {
		const staged = await this.store.stage(Bun.randomUUIDv7(), body, signal)
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

	// Hashes and inspects the file of a kernel again, marking it ready, invalid, or missing, and records again which of its
	// segments the toolkit can evaluate; never downloads it again.
	verify(id: string): Promise<SpiceKernelDetails> {
		return this.#exclusive(async () => {
			const kernel = this.#kernel(id)

			if (!(await this.store.hasObject(kernel.sha256))) this.store.setState(id, 'missing')
			else this.#check(kernel, (await this.store.hashObject(kernel.sha256)) === kernel.sha256)

			if (this.store.kernel(id)?.state === 'ready') {
				try {
					await (await openSpiceKernel(this.store.objectPath(kernel.sha256))).source.close()
					await this.#refreshSupport(kernel)
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

	// Turns the offline switch of the ephemeris sources on or off.
	setOffline(offline: boolean): Promise<SpiceKernelLibrarySnapshot> {
		return this.#exclusive(() => {
			this.store.setOffline(offline)
			this.runtime.setOffline(offline)
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

	// Downloads a curated entry into staging and publishes it. It fails as downloadFailed when the host cannot be reached,
	// answers an error, or sends nothing for the stall wait, however long the whole transfer takes.
	async #download(entry: SpiceCatalogEntry, context: SpiceKernelJobContext) {
		const host = new URL(entry.url).host
		const stall = new AbortController()
		const signal = AbortSignal.any([context.signal, stall.signal])
		const stallMs = this.#downloadStallMs
		const stalled = () => new SpiceKernelError(`${host} sent nothing for ${Math.round(stallMs / 1000)} s.`, 502, 'downloadFailed')
		let timer: ReturnType<typeof setTimeout> | undefined

		// Restarts the wait for the next bytes.
		function alive() {
			clearTimeout(timer)
			timer = setTimeout(() => stall.abort(), stallMs)
		}

		alive()

		try {
			let response: Response

			try {
				response = await this.#fetch(entry.url, { signal, redirect: 'error' })
			} catch (error) {
				if (context.signal.aborted) throw error
				if (stall.signal.aborted) throw stalled()
				throw new SpiceKernelError(`${host} could not be reached: ${Error.isError(error) ? error.message : String(error)}`, 502, 'downloadFailed')
			}

			if (!response.ok || !response.body) {
				await response.body?.cancel()
				throw new SpiceKernelError(`${host} answered ${response.status}.`, 502, 'downloadFailed')
			}

			const total = Number(response.headers.get('content-length')) || entry.bytes
			let staged: StagedSpiceKernel

			try {
				staged = await this.store.stage(Bun.randomUUIDv7(), response.body, signal, (bytes) => {
					alive()
					context.progress(bytes, total)
				})
			} catch (error) {
				if (!context.signal.aborted && stall.signal.aborted) throw stalled()
				throw error
			}

			clearTimeout(timer)
			context.stage('validating')
			return await this.#exclusive(() => this.#publishFile(staged, { name: entry.name, sourceKind: 'naif', sourceRef: entry.id }, context))
		} finally {
			clearTimeout(timer)
		}
	}

	// Asks Horizons for a small-body SPK through the JPL queue, stages it, and publishes it.
	async #generateFile(request: SpiceKernelGenerateRequest, label: string, context: SpiceKernelJobContext) {
		const id = Number(request.spkId)
		const file = await this.queue.run((signal) => this.#generate(id, request.start, request.end, signal, { headers: this.queue.headers }), { timeoutMs: GENERATION_TIMEOUT_MS, signal: context.signal, key: `spk:${request.spkId}:${request.start}:${request.end}` })

		if (!file.spk) throw new SpiceKernelError(file.error?.trim() || 'Horizons did not generate the kernel.', 502, 'generationFailed')

		const bytes = Buffer.from(file.spk, 'base64')
		context.progress(bytes.byteLength, bytes.byteLength)
		const staged = await this.store.stage(Bun.randomUUIDv7(), new Blob([bytes]).stream(), context.signal)
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

	// Records again which segments of a kernel the toolkit can evaluate, from the descriptors of its file, so a kernel added
	// before the toolkit learned a data type shows those segments as supported. A file that cannot be inspected is left as
	// it is: its integrity check and the rebuild judge it.
	async #refreshSupport(kernel: SpiceKernelRecord) {
		try {
			this.store.setSegmentSupport(kernel.id, await inspectSpiceKernel(this.store.objectPath(kernel.sha256)))
		} catch {
			// The file is judged by the integrity check and the rebuild.
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
			this.store.offline(),
			this.store.preferences(),
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

// A chain link of the toolkit with the kernel id named for tabs.
function linkOf(link: SpkChainLink): SpiceChainLink {
	return { body: link.body, center: link.center, kernelId: link.kernel, segment: link.segment, preferred: link.preferred }
}

// Sum of two states (AU, AU/day), as a new one.
function addStates([p, v]: PositionAndVelocity, [q, w]: PositionAndVelocity): PositionAndVelocity {
	return [
		[p[0] + q[0], p[1] + q[1], p[2] + q[2]],
		[v[0] + w[0], v[1] + w[1], v[2] + w[2]],
	]
}

// Difference of two states (AU, AU/day), as a new one.
function subtractStates([p, v]: PositionAndVelocity, [q, w]: PositionAndVelocity): PositionAndVelocity {
	return [
		[p[0] - q[0], p[1] - q[1], p[2] - q[2]],
		[v[0] - w[0], v[1] - w[1], v[2] - w[2]],
	]
}

// Evaluation of a relative state (AU, AU/day) in the units and directions shown to people.
function evaluation(generation: number, request: SpiceEvaluationRequest, time: ReturnType<typeof timeUnix>, [p, v]: PositionAndVelocity, source: SpiceChainLink | undefined, targetChain: readonly SpiceChainLink[], centerChain: readonly SpiceChainLink[]): SpiceEvaluation {
	const kmps = AU_KM / DAYSEC
	const position = [p[0] * AU_KM, p[1] * AU_KM, p[2] * AU_KM] as const
	const velocity = [v[0] * kmps, v[1] * kmps, v[2] * kmps] as const
	const distance = Math.hypot(...position)
	const speed = Math.hypot(...velocity)
	const rangeRate = distance > 0 ? (position[0] * velocity[0] + position[1] * velocity[1] + position[2] * velocity[2]) / distance : 0
	const [ra, declination] = eraC2s(...p)
	const rightAscension = normalizeAngle(ra)
	const [longitude, eclipticLatitude] = equatorialToEclipticJ2000(rightAscension, declination)

	return {
		ok: true,
		generation,
		target: request.target,
		center: request.center,
		time: request.time,
		tdbSeconds: spkSeconds(time),
		tdbJulianDate: toJulianDay(tdb(time)),
		position,
		velocity,
		distance,
		speed,
		rangeRate,
		lightTime: (distance * 1000) / SPEED_OF_LIGHT,
		rightAscension,
		declination,
		eclipticLongitude: normalizeAngle(longitude),
		eclipticLatitude,
		source,
		targetChain,
		centerChain,
	}
}

// How set selects the segments of body, with the kernel the operator prefers for it.
function bodyOf(set: SpkKernelSet, body: number, preferredKernelId: string | undefined): SpiceBody {
	const coverage = set.coverage(body)
	const segments = set.candidates(body).map(({ kernel, descriptor, preferred }): SpiceBodySegment => {
		const { index, center, frame, dataType, start, end, supported, reason } = descriptor
		return { kernelId: kernel, segment: index, center, frame, dataType, start, end, supported, reason, preferred, usage: usageOf(coverage, kernel, index, start, end) }
	})

	return {
		body,
		preferredKernelId,
		kernelIds: [...new Set(segments.map((e) => e.kernelId))],
		segments,
		coverage: coverage.map((e) => ({ start: e.start, end: e.end, kernelId: e.kernel, segment: e.segment, preferred: e.preferred, supported: e.supported })),
	}
}

// How much of its coverage, from start to end (TDB seconds past J2000), the segment of a kernel is selected for.
function usageOf(coverage: readonly SpkCoverageInterval[], kernel: string, segment: number, start: number, end: number): SpiceSegmentUsage {
	const selected = coverage.filter((e) => e.kernel === kernel && e.segment === segment)
	if (selected.length === 0) return 'never'
	const length = selected.reduce((sum, e) => sum + (e.end - e.start), 0)
	return length >= end - start ? 'full' : 'partial'
}

// Answers a failure of a route with its status and code.
function failure(error: unknown) {
	if (error instanceof SpiceKernelError) return errorResponse(error.message, error.status, error.code)
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
			// Curated NASA/JPL downloads (SpiceCatalogItem[]).
			GET: () => Response.json(library.catalog() satisfies SpiceCatalogItem[]),
		},
		'/api/spice-kernels/coverage': {
			// Whether the current set resolves ?target (NAIF code) at ?time (Unix milliseconds, default now) (SpiceKernelCoverage).
			GET: (req) => {
				const params = new URL(req.url).searchParams
				return Response.json(library.coverage(Number(params.get('target')), Number(params.get('time') ?? Date.now())) satisfies SpiceKernelCoverage)
			},
		},
		'/api/spice-kernels/bodies': {
			// How the current set selects the segments of each body (SpiceBodiesResponse).
			GET: () => Response.json(library.bodies() satisfies SpiceBodiesResponse),
		},
		'/api/spice-kernels/bodies/:body/preference': {
			// Prefers a kernel for a body, or removes the preference (SpiceBodyPreferenceRequest, SpiceBodiesResponse); 404 notFound.
			PUT: (req) => answer(async () => library.setPreference(Number(req.params.body), (await req.json()) as SpiceBodyPreferenceRequest)),
		},
		'/api/spice-kernels/evaluate': {
			// State of a body relative to another at an instant, through the selection or from one segment (SpiceEvaluationRequest, SpiceEvaluationResult).
			POST: (req) => answer(async () => library.evaluate((await req.json()) as SpiceEvaluationRequest)),
		},
		'/api/spice-kernels/settings': {
			// Turns the offline switch of the ephemeris sources on or off (SpiceKernelSettingsRequest, SpiceKernelLibrarySnapshot).
			PATCH: (req) => answer(async () => library.setOffline(((await req.json()) as SpiceKernelSettingsRequest).offline)),
		},
		'/api/spice-kernels/import': {
			// Adds the SPK file of the application/octet-stream body, named by ?name (SpiceKernelImportResponse); 201 when
			// added, 200 when an identical file was installed; 422 invalidSpk.
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
