import { open } from 'fs/promises'
import { type Daf, readDaf } from 'nebulosa/src/astronomy/ephemeris/kernels/daf'
import { inspectSpk, type SpkSegmentDescriptor } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.inspect'
import { prepareSpkKernelSet, type SpkKernelEntry, type SpkKernelSet } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import { Timescale, time } from 'nebulosa/src/astronomy/time/time'
import { DAYSEC, J2000 } from 'nebulosa/src/core/constants'
import { type FileHandleSource, fileHandleSource } from 'nebulosa/src/io/file'
import type { SpiceEphemerisPolicy } from './spicekernels.store'

// Runtime of the SPICE Kernel Library: the open SPK files of the enabled kernels and the immutable snapshot the
// ephemeris reads, made of a generation, the ephemeris policy, and the prepared kernel set. A rebuild opens and
// inspects only the files that joined, prepares a complete new set beside the current one, swaps the reference, and
// only then closes the files that left. Every SPK evaluation runs synchronously from current() to its result, so no
// calculation ever sees a half-built set or a closed file, and no lease is needed. One instance is shared by the
// library, which serializes its rebuilds, and by the ephemeris, which only reads.

// Readiness of an enabled kernel in the current set: every evaluable target resolves to the barycenter, some need a
// body no enabled kernel provides (such as a heliocentric small body without a planetary kernel), or nothing in it can
// be evaluated.
export type SpiceKernelSetReadiness = { readonly status: 'ready' } | { readonly status: 'missingDependency'; readonly bodies: readonly number[] } | { readonly status: 'unsupported' }

// What the ephemeris reads of the library at one instant. Immutable; a change makes a new snapshot.
export interface SpiceKernelSnapshot {
	// Increased by every change of the set or the policy; part of the keys of the results computed from it.
	readonly generation: number
	readonly policy: SpiceEphemerisPolicy
	// Whether the files of the previous run are still being opened at the start of the server.
	readonly loading: boolean
	// Prepared set of the enabled kernels; absent when none is enabled.
	readonly set?: SpkKernelSet
	// Readiness of each kernel of the set, by kernel id.
	readonly readiness: ReadonlyMap<string, SpiceKernelSetReadiness>
}

// A kernel to load: its id and the path of its file.
export interface SpiceKernelFile {
	readonly id: string
	readonly path: string
}

// An open kernel file and its inspection.
interface PreparedKernel {
	readonly path: string
	readonly source: FileHandleSource
	readonly daf: Daf
	readonly segments: readonly SpkSegmentDescriptor[]
}

// Snapshot before the library has loaded anything.
const LOADING_SNAPSHOT: SpiceKernelSnapshot = { generation: 0, policy: 'automatic', loading: true, readiness: new Map() }

// Opens a kernel file, reads its DAF, inspects it, and initializes its segments alone, so a file that cannot be read
// fails here, by itself, and never the rebuild of the whole set. Closes the file on failure.
export async function openSpiceKernel(path: string): Promise<PreparedKernel> {
	const handle = await open(path, 'r')
	const source = fileHandleSource(handle)

	try {
		const { size } = await handle.stat()
		const daf = await readDaf(source)
		const inspection = inspectSpk(daf, size)
		if (!inspection.ok) throw new Error(inspection.error)
		await prepareSpkKernelSet([{ id: path, daf, segments: inspection.segments }])
		return { path, source, daf, segments: inspection.segments }
	} catch (error) {
		await source.close()
		throw error
	}
}

// Readiness of a kernel in set: each evaluable segment is resolved at the middle of its coverage, where its own target
// is covered, so a miss names a center no enabled kernel covers there.
function readinessOf(segments: readonly SpkSegmentDescriptor[], set: SpkKernelSet): SpiceKernelSetReadiness {
	const bodies = new Set<number>()
	let evaluable = false

	for (const segment of segments) {
		if (!segment.supported) continue
		evaluable = true
		const middle = time(J2000, (segment.start + segment.end) / 2 / DAYSEC, Timescale.TDB)
		const result = set.stateAt(segment.target, middle)
		if (!result.ok && result.body !== segment.target && (result.reason === 'missing' || result.reason === 'coverage')) bodies.add(result.body)
	}

	if (!evaluable) return { status: 'unsupported' }
	return bodies.size > 0 ? { status: 'missingDependency', bodies: [...bodies].sort((a, b) => a - b) } : { status: 'ready' }
}

// Open SPK files of the enabled kernels and the snapshot the ephemeris reads.
export class SpiceKernelRuntime implements Disposable {
	#snapshot = LOADING_SNAPSHOT
	readonly #prepared = new Map<string, PreparedKernel>()
	// Whether the runtime was disposed: a rebuild still opening files then keeps none of them.
	#disposed = false

	// Current snapshot. Read it once per calculation and evaluate it synchronously.
	current(): SpiceKernelSnapshot {
		return this.#snapshot
	}

	// Makes files, in load order (lowest precedence first), the set of a new snapshot with policy. Files already open
	// are reused; a new file that cannot be opened, read, or inspected is left out and reported in the returned map, by
	// kernel id, with its error. Files that left the set are closed after the swap. A set whose files cannot be prepared together swaps
	// nothing and reports no file, since none can be blamed. Never rejects. The caller serializes rebuilds.
	async rebuild(files: readonly SpiceKernelFile[], policy: SpiceEphemerisPolicy): Promise<Map<string, Error>> {
		const failures = new Map<string, Error>()
		const opened = new Map<string, PreparedKernel>()

		for (const file of files) {
			const prepared = this.#prepared.get(file.id)

			if (prepared?.path === file.path) {
				opened.set(file.id, prepared)
				continue
			}

			try {
				opened.set(file.id, await openSpiceKernel(file.path))
			} catch (error) {
				failures.set(file.id, Error.isError(error) ? error : new Error(String(error)))
			}
		}

		const entries: SpkKernelEntry[] = []
		for (const [id, kernel] of opened) entries.push({ id, daf: kernel.daf, segments: kernel.segments })

		let set: SpkKernelSet | undefined

		try {
			set = entries.length > 0 ? await prepareSpkKernelSet(entries) : undefined
		} catch (error) {
			// Every file opened alone, so this is a read failure of a file that changed meanwhile, which no file can be blamed for:
			// nothing is swapped, the previous set stays in force, and the check of each file (on start, on verify) finds the one
			// that changed. Only the files that failed alone are reported.
			for (const [id, kernel] of opened) if (this.#prepared.get(id) !== kernel) await kernel.source.close().catch(() => undefined)
			console.error('The SPICE kernels could not be prepared together; the previous set stays in force', error)
			return failures
		}

		const readiness = new Map<string, SpiceKernelSetReadiness>()
		if (set) for (const [id, kernel] of opened) readiness.set(id, readinessOf(kernel.segments, set))

		// Disposed while the files were opened (a server stopping in place during a rebuild): nothing is swapped in, and the
		// files of this rebuild are closed, since the disposal could not see them.
		if (this.#disposed) {
			for (const kernel of opened.values()) await kernel.source.close().catch(() => undefined)
			return failures
		}

		const previous = [...this.#prepared.entries()]
		this.#snapshot = { generation: this.#snapshot.generation + 1, policy, loading: false, set, readiness }
		this.#prepared.clear()
		for (const [id, kernel] of opened) this.#prepared.set(id, kernel)

		for (const [id, kernel] of previous) {
			if (this.#prepared.get(id) !== kernel) await kernel.source.close().catch(() => undefined)
		}

		return failures
	}

	// Makes a new snapshot with policy and the same set.
	setPolicy(policy: SpiceEphemerisPolicy) {
		this.#snapshot = { ...this.#snapshot, generation: this.#snapshot.generation + 1, policy }
	}

	// Closes every file, in the background, and returns to the loading snapshot, for a server stopping in place.
	[Symbol.dispose]() {
		this.#disposed = true
		for (const kernel of this.#prepared.values()) void kernel.source.close().catch(() => undefined)
		this.#prepared.clear()
		this.#snapshot = LOADING_SNAPSHOT
	}
}
