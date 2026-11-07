import { mkdir, readdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import type { SpkSegmentDescriptor, SpkUnsupportedReason } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.inspect'
import { type AppDatabase, DEFAULT_DATA_DIRECTORY } from './database'

// Durable part of the SPICE Kernel Library: the SPK files, their segments, and the ephemeris policy, as rows of
// spice_kernels, spice_segments, and spice_settings in the operational database, and the bytes of each file under
// spice-kernels/objects/<sha256>.bsp. A file is streamed into spice-kernels/staging/, hashed while it is written,
// renamed into objects/ once inspected, and only then recorded, so no row ever names a partial file. Content
// addressing makes an identical file one entry. Shared by every profile.

// Directory of the files of the SPICE Kernel Library.
export const DEFAULT_SPICE_KERNEL_DIRECTORY = join(DEFAULT_DATA_DIRECTORY, 'spice-kernels')

// Where a kernel came from: a curated NAIF download, a Horizons small-body generation, or an upload.
export type SpiceKernelSourceKind = 'naif' | 'horizons' | 'import'

// Lifecycle of a kernel: usable, being deleted, failing its integrity or format checks, or without its file.
export type SpiceKernelState = 'ready' | 'pendingDelete' | 'invalid' | 'missing'

// Source of accurate solar-system positions: SPK then Horizons, SPK then the local models without any request to JPL,
// or SPK alone.
export type SpiceEphemerisPolicy = 'automatic' | 'offline' | 'spkOnly'

// One SPK file of the library.
export interface SpiceKernelRecord {
	readonly id: string
	// SHA-256 of the file, in lowercase hexadecimal.
	readonly sha256: string
	// Name shown to people.
	readonly name: string
	readonly sourceKind: SpiceKernelSourceKind
	// Id of the curated source, or SPK-ID of the generated small body.
	readonly sourceRef?: string
	// Interval asked of Horizons for a generated kernel, Unix milliseconds (UTC).
	readonly requestedStart?: number
	readonly requestedEnd?: number
	// Size of the file, in bytes.
	readonly bytes: number
	// When it was added, Unix milliseconds (UTC).
	readonly createdAt: number
	// Whether the operator wants it in the ephemeris.
	readonly enabled: boolean
	// Load order from 0; higher takes precedence where segments overlap.
	readonly priority: number
	readonly state: SpiceKernelState
}

// One segment of a kernel, as inspected when the kernel was added. Epochs are TDB seconds past J2000.
export interface SpiceSegmentRecord {
	// Position in the file, from 0.
	readonly index: number
	readonly name: string
	// NAIF codes of the target, the center, and the reference frame.
	readonly target: number
	readonly center: number
	readonly frame: number
	readonly dataType: number
	// Coverage, inclusive, in TDB seconds past J2000.
	readonly start: number
	readonly end: number
	readonly supported: boolean
	// Why it cannot be evaluated; absent when supported.
	readonly reason?: SpkUnsupportedReason
}

// What a new kernel is recorded with; its id, priority, enabled flag, and state are set by the store.
export type NewSpiceKernel = Omit<SpiceKernelRecord, 'priority' | 'enabled' | 'state'>

// A file streamed into staging: where it is, its SHA-256, and its size in bytes.
export interface StagedSpiceKernel {
	readonly path: string
	readonly sha256: string
	readonly bytes: number
}

// Raised by stage when a stream exceeds its size limit.
export class SpiceKernelTooLargeError extends Error {
	// Creates the error for a limit, in bytes.
	constructor(readonly limit: number) {
		super(`The file is larger than ${Math.round(limit / 1048576)} MiB.`)
	}
}

// Row of spice_kernels.
interface KernelRow {
	readonly kernel_id: string
	readonly sha256: string
	readonly name: string
	readonly source_kind: SpiceKernelSourceKind
	readonly source_ref: string | null
	readonly requested_start: number | null
	readonly requested_end: number | null
	readonly bytes: number
	readonly created_at: number
	readonly enabled: number
	readonly priority: number
	readonly state: SpiceKernelState
}

// Row of spice_segments.
interface SegmentRow {
	readonly segment_index: number
	readonly name: string
	readonly target: number
	readonly center: number
	readonly frame: number
	readonly data_type: number
	readonly start_et: number
	readonly end_et: number
	readonly supported: number
	readonly unsupported_reason: SpkUnsupportedReason | null
}

// Converts a row of spice_kernels.
function kernelOf(row: KernelRow): SpiceKernelRecord {
	return {
		id: row.kernel_id,
		sha256: row.sha256,
		name: row.name,
		sourceKind: row.source_kind,
		sourceRef: row.source_ref ?? undefined,
		requestedStart: row.requested_start ?? undefined,
		requestedEnd: row.requested_end ?? undefined,
		bytes: row.bytes,
		createdAt: row.created_at,
		enabled: row.enabled === 1,
		priority: row.priority,
		state: row.state,
	}
}

// Converts a row of spice_segments.
function segmentOf(row: SegmentRow): SpiceSegmentRecord {
	return {
		index: row.segment_index,
		name: row.name,
		target: row.target,
		center: row.center,
		frame: row.frame,
		dataType: row.data_type,
		start: row.start_et,
		end: row.end_et,
		supported: row.supported === 1,
		reason: row.unsupported_reason ?? undefined,
	}
}

// Kernels and settings of the SPICE Kernel Library in the operational database, and their files in directory. Reads are
// snapshots; every write is one transaction.
export class SpiceKernelStore {
	// Creates the store of the library in database, with its files in directory.
	constructor(
		readonly database: AppDatabase,
		readonly directory: string = DEFAULT_SPICE_KERNEL_DIRECTORY,
	) {}

	// Returns every kernel, by priority, lowest first.
	kernels(): SpiceKernelRecord[] {
		return this.database.db.query<KernelRow, []>('SELECT * FROM spice_kernels ORDER BY priority, created_at').all().map(kernelOf)
	}

	// Returns a kernel, or undefined when unknown.
	kernel(id: string): SpiceKernelRecord | undefined {
		const row = this.database.db.query<KernelRow, [string]>('SELECT * FROM spice_kernels WHERE kernel_id = ?').get(id)
		return row ? kernelOf(row) : undefined
	}

	// Returns the kernel of a file by its SHA-256, or undefined when no kernel has it.
	kernelBySha(sha256: string): SpiceKernelRecord | undefined {
		const row = this.database.db.query<KernelRow, [string]>('SELECT * FROM spice_kernels WHERE sha256 = ?').get(sha256)
		return row ? kernelOf(row) : undefined
	}

	// Returns the segments of a kernel, in file order.
	segments(id: string): SpiceSegmentRecord[] {
		return this.database.db.query<SegmentRow, [string]>('SELECT * FROM spice_segments WHERE kernel_id = ? ORDER BY segment_index').all(id).map(segmentOf)
	}

	// Returns the segments of every kernel, by kernel id, in file order.
	allSegments(): Map<string, SpiceSegmentRecord[]> {
		const segments = new Map<string, SpiceSegmentRecord[]>()

		for (const row of this.database.db.query<SegmentRow & { readonly kernel_id: string }, []>('SELECT * FROM spice_segments ORDER BY kernel_id, segment_index').all()) {
			let list = segments.get(row.kernel_id)

			if (!list) {
				list = []
				segments.set(row.kernel_id, list)
			}

			list.push(segmentOf(row))
		}

		return segments
	}

	// Records a kernel and its segments, enabled, ready, and with the highest priority, in one transaction.
	insert(kernel: NewSpiceKernel, segments: readonly SpkSegmentDescriptor[]): SpiceKernelRecord {
		const { db } = this.database

		return this.database.write(() => {
			const { next } = db.query<{ next: number }, []>('SELECT COALESCE(MAX(priority) + 1, 0) AS next FROM spice_kernels').get()!
			db.query('INSERT INTO spice_kernels VALUES (:id, :sha256, :name, :sourceKind, :sourceRef, :requestedStart, :requestedEnd, :bytes, :createdAt, 1, :priority, :state)').run({
				id: kernel.id,
				sha256: kernel.sha256,
				name: kernel.name,
				sourceKind: kernel.sourceKind,
				sourceRef: kernel.sourceRef ?? null,
				requestedStart: kernel.requestedStart ?? null,
				requestedEnd: kernel.requestedEnd ?? null,
				bytes: kernel.bytes,
				createdAt: kernel.createdAt,
				priority: next,
				state: 'ready',
			})

			const insert = db.query('INSERT INTO spice_segments VALUES (:id, :index, :name, :target, :center, :frame, :dataType, :start, :end, :supported, :reason)')

			for (const segment of segments) {
				insert.run({ id: kernel.id, index: segment.index, name: segment.name, target: segment.target, center: segment.center, frame: segment.frame, dataType: segment.dataType, start: segment.start, end: segment.end, supported: segment.supported ? 1 : 0, reason: segment.reason ?? null })
			}

			return { ...kernel, enabled: true, priority: next, state: 'ready' }
		})
	}

	// Turns a kernel on or off.
	setEnabled(id: string, enabled: boolean) {
		this.database.db.query('UPDATE spice_kernels SET enabled = ? WHERE kernel_id = ?').run(enabled ? 1 : 0, id)
	}

	// Moves a kernel to position priority of the load order, clamped to it, and renumbers every kernel from 0.
	setPriority(id: string, priority: number) {
		const { db } = this.database

		this.database.write(() => {
			const ids = db
				.query<{ kernel_id: string }, []>('SELECT kernel_id FROM spice_kernels ORDER BY priority, created_at')
				.all()
				.map((e) => e.kernel_id)
				.filter((e) => e !== id)
			ids.splice(Math.max(0, Math.min(ids.length, priority)), 0, id)
			const update = db.query('UPDATE spice_kernels SET priority = ? WHERE kernel_id = ?')
			for (const [i, e] of ids.entries()) update.run(i, e)
		})
	}

	// Sets the lifecycle state of a kernel.
	setState(id: string, state: SpiceKernelState) {
		this.database.db.query('UPDATE spice_kernels SET state = ? WHERE kernel_id = ?').run(state, id)
	}

	// Deletes a kernel and its segments.
	delete(id: string) {
		this.database.db.query('DELETE FROM spice_kernels WHERE kernel_id = ?').run(id)
	}

	// Returns the ephemeris policy; automatic when never changed.
	policy(): SpiceEphemerisPolicy {
		return this.database.db.query<{ policy: SpiceEphemerisPolicy }, []>('SELECT policy FROM spice_settings WHERE singleton = 1').get()?.policy ?? 'automatic'
	}

	// Sets the ephemeris policy.
	setPolicy(policy: SpiceEphemerisPolicy) {
		this.database.db.query('INSERT INTO spice_settings VALUES (1, ?) ON CONFLICT (singleton) DO UPDATE SET policy = excluded.policy').run(policy)
	}

	// Path of the file of a kernel by its SHA-256.
	objectPath(sha256: string) {
		return join(this.directory, 'objects', `${sha256}.bsp`)
	}

	// Streams bytes into staging/<id>.part while hashing them, rejecting with SpiceKernelTooLargeError past limit bytes;
	// progress receives the bytes written so far. The partial file is removed when anything fails, including signal.
	async stage(id: string, stream: ReadableStream<Uint8Array>, limit: number, signal?: AbortSignal, progress?: (bytes: number) => void): Promise<StagedSpiceKernel> {
		const directory = join(this.directory, 'staging')
		await mkdir(directory, { recursive: true })
		const path = join(directory, `${id}.part`)
		const writer = Bun.file(path).writer()
		const hasher = new Bun.CryptoHasher('sha256')
		const reader = stream.getReader()
		const abort = () => void reader.cancel(signal?.reason).catch(() => undefined)
		signal?.addEventListener('abort', abort, { once: true })
		let bytes = 0

		try {
			signal?.throwIfAborted()

			while (true) {
				const { done, value } = await reader.read()
				signal?.throwIfAborted()
				if (done) break
				bytes += value.byteLength
				if (bytes > limit) throw new SpiceKernelTooLargeError(limit)
				hasher.update(value)
				await writer.write(value)
				await writer.flush()
				progress?.(bytes)
			}

			await writer.end()
			return { path, sha256: hasher.digest('hex'), bytes }
		} catch (error) {
			await Promise.resolve(writer.end()).catch(() => undefined)
			await reader.cancel().catch(() => undefined)
			await rm(path, { force: true, maxRetries: 3, retryDelay: 100 })
			throw error
		} finally {
			signal?.removeEventListener('abort', abort)
			reader.releaseLock()
		}
	}

	// Moves a staged file to its content-addressed place; an identical file already there is kept.
	async promote(staged: StagedSpiceKernel) {
		const path = this.objectPath(staged.sha256)
		await mkdir(join(this.directory, 'objects'), { recursive: true })
		await rename(staged.path, path)
		return path
	}

	// Removes a staged file.
	async discard(staged: StagedSpiceKernel) {
		await rm(staged.path, { force: true, maxRetries: 3, retryDelay: 100 })
	}

	// Removes the file of a kernel by its SHA-256, retrying while Windows still holds it.
	async removeObject(sha256: string) {
		await rm(this.objectPath(sha256), { force: true, maxRetries: 10, retryDelay: 100 })
	}

	// Whether the file of a kernel exists, by its SHA-256.
	async hasObject(sha256: string) {
		try {
			return (await stat(this.objectPath(sha256))).isFile()
		} catch {
			return false
		}
	}

	// SHA-256 of the file of a kernel, read again from disk.
	async hashObject(sha256: string) {
		const hasher = new Bun.CryptoHasher('sha256')
		for await (const chunk of Bun.file(this.objectPath(sha256)).stream()) hasher.update(chunk)
		return hasher.digest('hex')
	}

	// Removes what a previous run left in staging.
	async clearStaging() {
		const directory = join(this.directory, 'staging')
		const names = await readdir(directory).catch(() => [])
		await Promise.all(names.map((name) => rm(join(directory, name), { force: true, recursive: true })))
	}
}
