import { type FileHandle, mkdir, open, readdir, rename, rm, stat } from 'fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'path'
import { pipeline } from 'stream/promises'
import { createZstdDecompress } from 'zlib'
import { DEFAULT_DATA_DIRECTORY } from './database'
import { errorResponse } from './http'
import { errorCode } from './util'

// Downloadable quad index files of the built-in plate solver: one zstd-compressed tarball per band, built by Nebulosa from
// a star database and shared on Google Drive, installed on an explicit request into the default index folder of the
// data directory, one subfolder per source. The solver searches that folder when the Index Folder of its settings is
// empty. A download streams the archive from Google Drive through its SHA-256, the zstd decompressor and a tar reader
// into a staging folder, never holding a band in memory; its files replace the installed ones of the band only once the
// archive has the exact size and SHA-256 of the catalog, so an interrupted, cancelled or damaged download leaves the
// installed files untouched. Downloads run one at a time in request order; they live in memory only, so a restart
// forgets them, and the staging folder is cleared at the next start. Whether a band is installed is read from the files
// of its source folder, so files copied there by hand count too. Angles are radians.

// Source of a set of bands: the star database they were built from.
export type QuadIndexSourceId = 'astap-d20'

// Source of a set of bands, as people read it.
export interface QuadIndexSource {
	// Stable id, also the name of its subfolder of the index folder.
	readonly id: QuadIndexSourceId
	// Name of the star database the bands were built from.
	readonly name: string
	// Where its stars come from and how deep they go, for people.
	readonly description: string
}

// A downloadable band: the quad index tiles of one band of quad sizes, from one source.
export interface QuadIndexBand {
	// Stable id, sent to download, cancel or remove it.
	readonly id: string
	readonly source: QuadIndexSourceId
	// Start of the names of its tile files, nqi-<band>-<tileNside>, followed by -<tile>.nqi.
	readonly prefix: string
	// Shortest quad of the band, radians.
	readonly scaleLower: number
	// Longest quad of the band, radians.
	readonly scaleUpper: number
	// HEALPix NSIDE of its tiles; 0 for one whole-sky file.
	readonly tileNside: number
	// Number of tile files, which together cover the whole sky.
	readonly files: number
	// Total size of the tile files once installed, bytes.
	readonly bytes: number
	// Size of the compressed archive, bytes.
	readonly archiveBytes: number
	// SHA-256 of the compressed archive, lowercase hexadecimal.
	readonly sha256: string
	// Id of the shared archive on Google Drive; a band without one is listed but cannot be downloaded yet.
	readonly driveId?: string
}

// Installation state of a band: none of its files, some of them (or files of other sizes), or all of them.
export type QuadIndexInstallState = 'missing' | 'partial' | 'installed'

// Stage of a download: waiting its turn, transferring and unpacking, moving its files into place, or failed.
export type QuadIndexJobState = 'queued' | 'downloading' | 'installing' | 'failed'

// Download of a band in progress, or the last one that failed.
export interface QuadIndexJob {
	readonly state: QuadIndexJobState
	// Compressed bytes received so far, and in total.
	readonly bytes: number
	readonly totalBytes: number
	// Why it failed, for people.
	readonly error?: string
}

// A band as the settings show it.
export interface QuadIndexBandItem extends Omit<QuadIndexBand, 'driveId' | 'sha256'> {
	// Whether its archive is shared, so it can be downloaded.
	readonly published: boolean
	// Shorter side of the fields it suits best, radians, smallest and largest: those whose quads of 20% to 57% of the
	// shorter side (the bands the solver builds itself around a known position) fall within the band.
	readonly bestShortSide: readonly [number, number]
	// Smallest diagonal of a field the solver searches the band for, radians: its shortest quad.
	readonly minDiagonal: number
	// Largest shorter side of a field the solver searches the band for, radians: ten times its longest quad.
	readonly maxShortSide: number
	readonly installed: QuadIndexInstallState
	// Tile files of the band found in its source folder, and their total size in bytes.
	readonly installedFiles: number
	readonly installedBytes: number
	// Its download in progress, or the last one that failed.
	readonly job?: QuadIndexJob
}

// Downloadable bands and their state.
export interface QuadIndexDownloadsSnapshot {
	// Increases with every snapshot of a run of the server, so a client keeps the latest of two it received.
	readonly revision: number
	// Default index folder, where downloads are installed, one subfolder per source.
	readonly directory: string
	// Whether the solver searches the default index folder: the saved Index Folder is empty, or holds it.
	readonly searched: boolean
	readonly sources: readonly QuadIndexSource[]
	// Bands from the shortest quads to the longest.
	readonly bands: readonly QuadIndexBandItem[]
}

// Notification published when the downloadable bands, their installation, or their downloads change.
export interface QuadIndexDownloadsEvent {
	readonly type: 'quadIndexes:updated'
	readonly snapshot: QuadIndexDownloadsSnapshot
}

// Stable code of a refused or failed request: an unknown band, a band not shared yet, a band whose download runs, or a
// download that failed.
export type QuadIndexErrorCode = 'notFound' | 'notPublished' | 'busy' | 'downloadFailed'

// Error of a request of the downloads, with its HTTP status.
export class QuadIndexError extends Error {
	// Creates the error.
	constructor(
		message: string,
		readonly status: number,
		readonly code: QuadIndexErrorCode,
	) {
		super(message)
	}
}

// Default index folder of the built-in plate solver, searched when its Index Folder is empty.
export const DEFAULT_QUAD_INDEX_DIRECTORY = join(DEFAULT_DATA_DIRECTORY, 'quad-indexes')

// Subfolder of the index folder holding the files of the downloads in progress.
const STAGING = '.staging'

// Sources of the downloadable bands.
export const QUAD_INDEX_SOURCES: readonly QuadIndexSource[] = [
	{
		id: 'astap-d20',
		name: 'ASTAP D20',
		description: 'Built by Nebulosa from the D20 star database of ASTAP, by Han Kleijn, which keeps the brightest stars of every part of the sky up to a density of about 2,000 per square degree. Every band covers the whole sky; the bands of the shortest quads are split into HEALPix tiles.',
	},
]

// Downloadable bands, from the shortest quads to the longest: the default bands of bun make:quads (8′ to 724′ in steps
// of √2) built from ASTAP D20, packed one archive per band by zstd at level 19.
export const QUAD_INDEX_BANDS: readonly QuadIndexBand[] = [
	{
		id: 'astap-d20-480',
		source: 'astap-d20',
		prefix: 'nqi-480-8',
		scaleLower: 0.0023271056693257726,
		scaleUpper: 0.003291024398635827,
		tileNside: 8,
		files: 768,
		bytes: 1045484672,
		archiveBytes: 808264688,
		sha256: '96ce4d76a50a74f150f742010c92e1022b5f055e810fcf68be412d6701038be3',
		driveId: '1FNUTxTSajGsR781lRGRGqe93az5Ffb3l',
	},
	{
		id: 'astap-d20-679',
		source: 'astap-d20',
		prefix: 'nqi-679-8',
		scaleLower: 0.0032918848947337495,
		scaleUpper: 0.004655428263903597,
		tileNside: 8,
		files: 768,
		bytes: 542765248,
		archiveBytes: 427936223,
		sha256: '62c4fa0b663fbe4f9ff4e0de4dbd395d1312b5689956ff80a2f3f18fa7ba59cc',
		driveId: '1RizUS2cEf1ea_xUNXz1ovjlNyg1BQOtj',
	},
	{
		id: 'astap-d20-960',
		source: 'astap-d20',
		prefix: 'nqi-960-4',
		scaleLower: 0.004654211338651545,
		scaleUpper: 0.006582048797271654,
		tileNside: 4,
		files: 192,
		bytes: 261302208,
		archiveBytes: 203970434,
		sha256: '9fc7b1b6940e22da968739e8f378cddcabfac48d488c9e6cb0c660c02079e540',
		driveId: '1GNFeoVh1oaFF7M_uiIvCYXrJgRQP_-DE',
	},
	{
		id: 'astap-d20-1358',
		source: 'astap-d20',
		prefix: 'nqi-1358-4',
		scaleLower: 0.006583769789467499,
		scaleUpper: 0.009310856527807195,
		tileNside: 4,
		files: 192,
		bytes: 135677504,
		archiveBytes: 107870638,
		sha256: 'c1e5c4646f4b12097de0ac50c84e8c9a28b6de3033d5b4dafc0fd562e8cf3e3b',
		driveId: '1zuLaE5vrhXhW2eU6MPODjWpmYKNLkXQu',
	},
	{
		id: 'astap-d20-1920',
		source: 'astap-d20',
		prefix: 'nqi-1920-2',
		scaleLower: 0.00930842267730309,
		scaleUpper: 0.013164097594543308,
		tileNside: 2,
		files: 48,
		bytes: 65290240,
		archiveBytes: 51381252,
		sha256: '1b0ccf5d4d6d96733493c33ae4cb7b57a723d978caff3c87d4b8865f9734c602',
		driveId: '1NK2Pk26UpN3hUrbnPOuESbgq6ZCLQkag',
	},
	{
		id: 'astap-d20-2715',
		source: 'astap-d20',
		prefix: 'nqi-2715-2',
		scaleLower: 0.013162691442123902,
		scaleUpper: 0.018614856754783898,
		tileNside: 2,
		files: 48,
		bytes: 33911104,
		archiveBytes: 27152773,
		sha256: 'c6117a56522fb154e1bf35b460df6632c5a07db694d358c1493fbb8f0031f7b3',
		driveId: '16YZNQGZgrkKa9pbmA8nraGDQjqVxPYow',
	},
	{
		id: 'astap-d20-3840',
		source: 'astap-d20',
		prefix: 'nqi-3840-0',
		scaleLower: 0.01861684535460618,
		scaleUpper: 0.026328195189086617,
		tileNside: 0,
		files: 1,
		bytes: 21226688,
		archiveBytes: 13750973,
		sha256: '91b25f9fe678964f7d13870c53665fd38678bd41376aaae5c83f342fa939132a',
		driveId: '1sFI1Q1V9nUFGruQ3KxsmLz9ipOezHVE-',
	},
	{
		id: 'astap-d20-5431',
		source: 'astap-d20',
		prefix: 'nqi-5431-0',
		scaleLower: 0.0263302310210589,
		scaleUpper: 0.03723656981039829,
		tileNside: 0,
		files: 1,
		bytes: 10984320,
		archiveBytes: 7232964,
		sha256: '6a3cf783791a44d84e71da5f00de3ecfc939eca6ed5c5592cf47f1547fb9ff9a',
		driveId: '1xPbnSpqj055G5GqyVo2gk1y5A6TPhuiL',
	},
	{
		id: 'astap-d20-7680',
		source: 'astap-d20',
		prefix: 'nqi-7680-0',
		scaleLower: 0.03723369070921236,
		scaleUpper: 0.05265639037817323,
		tileNside: 0,
		files: 1,
		bytes: 5296768,
		archiveBytes: 3392055,
		sha256: 'ed8b514e75cee0803bf1c8d0e54207ae330987936dc0be3d71acc5d84a6f223a',
		driveId: '1w9b8nJvr7YtI35ugOyZ0rV0aoIR7Hz8c',
	},
	{
		id: 'astap-d20-10861',
		source: 'astap-d20',
		prefix: 'nqi-10861-0',
		scaleLower: 0.0526556139053067,
		scaleUpper: 0.07446628331996608,
		tileNside: 0,
		files: 1,
		bytes: 2156480,
		archiveBytes: 1790854,
		sha256: '8a76e42a53312b00763987cec3cc0db565ad4a68dd2f828eb8d8224a21de7021',
		driveId: '1-uZBUYb5JGlgfClR4rN1muRKPcn7h64P',
	},
	{
		id: 'astap-d20-15360',
		source: 'astap-d20',
		prefix: 'nqi-15360-0',
		scaleLower: 0.07446738141842472,
		scaleUpper: 0.10531278075634647,
		tileNside: 0,
		files: 1,
		bytes: 1043264,
		archiveBytes: 832556,
		sha256: '28b45e9fd31407fdd4f1a4bf483f01ed7c42cda9ad1236e164c7ed26b4c515af',
		driveId: '1XhCzEUpGP3Y10OHuOh2-W3AYsyDWhJWV',
	},
	{
		id: 'astap-d20-21722',
		source: 'astap-d20',
		prefix: 'nqi-21722-0',
		scaleLower: 0.1053112278106134,
		scaleUpper: 0.14893256663993215,
		tileNside: 0,
		files: 1,
		bytes: 539584,
		archiveBytes: 439266,
		sha256: '488b3c461418378f4443549b50b4c825eef68d0a6b9071cded14ce09dcb4d76f',
		driveId: '19VIn34UqwHBACp-YMk52KX9WHuW3yvAn',
	},
	{
		id: 'astap-d20-30720',
		source: 'astap-d20',
		prefix: 'nqi-30720-0',
		scaleLower: 0.14893476283684945,
		scaleUpper: 0.21062556151269293,
		tileNside: 0,
		files: 1,
		bytes: 260032,
		archiveBytes: 202898,
		sha256: '77f4dd00c20218740e93311a5c251655abd7a8935a4ed66d98438aa3b80e8ca7',
		driveId: '1usuLQTcf-Lxr31amoKYsIgNMV39B9cZz',
	},
]

// Shortest quad, as a fraction of the shorter side of the image, of the bands the solver builds around a known position
// (DEFAULT_NEARBY_BAND_FRACTIONS of the toolkit's native solver).
const BEST_LOWER_FRACTION = 0.2

// Longest quad, as a fraction of the shorter side, of those bands: their widest one starts at 40% and spans √2.
const BEST_UPPER_FRACTION = 0.4 * Math.SQRT2

// Smallest shorter side of the image, as a multiple of the longest quad, for which the solver still searches a band:
// a band whose quads are all shorter than 10% of the shorter side is left out (see servesField of the worker).
const MAX_SHORT_SIDE_FACTOR = 10

// Time a download may wait for the next bytes from Google Drive before it fails, in milliseconds.
const DOWNLOAD_STALL_MS = 2 * 60 * 1000

// Shortest interval between two published progress updates, in milliseconds.
const PROGRESS_INTERVAL_MS = 250

// Size of a tar block, bytes.
const TAR_BLOCK = 512

// Returns the URL that downloads a file shared on Google Drive, past its page warning that a large file cannot be
// scanned for viruses.
export function googleDriveUrl(id: string) {
	return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`
}

// Writes the regular files of a tar stream into folder, each one chunk by chunk; returns their names. The archives hold
// only plain file names, so any other entry, or a name with a folder, makes it throw rather than write outside folder.
export async function extractTar(source: AsyncIterable<Uint8Array>, folder: string): Promise<string[]> {
	const names: string[] = []
	const decoder = new TextDecoder()
	let pending = new Uint8Array(0)
	let file: FileHandle | undefined
	// Bytes of the current file still to write, then of its padding (or of a skipped entry) to skip.
	let remaining = 0
	let padding = 0
	let ended = false

	// Reads a NUL-terminated ASCII field of a header.
	function field(header: Uint8Array, offset: number, length: number) {
		const bytes = header.subarray(offset, offset + length)
		const end = bytes.indexOf(0)
		return decoder.decode(end < 0 ? bytes : bytes.subarray(0, end)).trim()
	}

	try {
		for await (const chunk of source) {
			if (ended) continue
			let data = chunk
			if (pending.length > 0) {
				data = new Uint8Array(pending.length + chunk.length)
				data.set(pending)
				data.set(chunk, pending.length)
			}

			let offset = 0

			while (offset < data.length && !ended) {
				if (remaining > 0) {
					const part = data.subarray(offset, offset + remaining)
					for (let written = 0; written < part.length;) written += (await file!.write(part, written)).bytesWritten
					offset += part.length
					remaining -= part.length
					if (remaining > 0) break
					await file!.close()
					file = undefined
				} else if (padding > 0) {
					const skipped = Math.min(padding, data.length - offset)
					offset += skipped
					padding -= skipped
				} else if (data.length - offset < TAR_BLOCK) {
					break
				} else {
					const header = data.subarray(offset, offset + TAR_BLOCK)
					offset += TAR_BLOCK

					// The archive ends with zero blocks.
					if (header.every((byte) => byte === 0)) {
						ended = true
						break
					}

					const name = field(header, 0, 100)
					const size = Number.parseInt(field(header, 124, 12), 8)
					const type = header[156]
					const regular = type === 0 || type === 48

					if (regular && (name === '' || basename(name) !== name || name.includes('\\') || name === '..' || field(header, 345, 155) !== '')) throw new Error(`The archive holds a file outside its folder: ${name}`)
					if (!regular) throw new Error(`The archive holds an entry that is not a file: ${name}`)

					names.push(name)
					file = await open(join(folder, name), 'w')
					remaining = size
					padding = (TAR_BLOCK - (size % TAR_BLOCK)) % TAR_BLOCK

					if (remaining === 0) {
						await file.close()
						file = undefined
					}
				}
			}

			pending = offset < data.length ? data.slice(offset) : new Uint8Array(0)
		}
	} finally {
		await file?.close()
	}

	if (!ended || remaining > 0) throw new Error('The archive ends before its last file')
	return names
}

// Returns the fields of view a band suits, from its quad sizes.
function fieldsOf(band: QuadIndexBand) {
	return { bestShortSide: [band.scaleUpper / BEST_UPPER_FRACTION, band.scaleLower / BEST_LOWER_FRACTION] as const, minDiagonal: band.scaleLower, maxShortSide: MAX_SHORT_SIDE_FACTOR * band.scaleUpper }
}

// Whether a file name is a tile file of a band.
function isTileOf(band: QuadIndexBand, name: string) {
	return name.startsWith(`${band.prefix}-`) && name.endsWith('.nqi') && !name.endsWith('-region.nqi')
}

// What the downloads read of the external tool settings: the saved Index Folder of the built-in solver.
export interface QuadIndexSettings {
	// Saved Index Folder of the built-in solver, empty or undefined when none is set.
	readonly indexDirectory: () => Promise<string | undefined>
}

// Options of the downloads, for tests.
export interface QuadIndexDownloadsOptions {
	// Downloads a URL.
	readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
	// Downloadable bands and their sources.
	readonly bands?: readonly QuadIndexBand[]
	readonly sources?: readonly QuadIndexSource[]
	// Time a download may wait for the next bytes, in milliseconds.
	readonly stallMs?: number
}

// A download and what runs it.
interface JobEntry {
	job: QuadIndexJob
	readonly controller: AbortController
}

// Downloads and installations of the quad index bands.
export class QuadIndexDownloads implements Disposable {
	readonly #fetch: NonNullable<QuadIndexDownloadsOptions['fetch']>
	readonly #bands: readonly QuadIndexBand[]
	readonly #sources: readonly QuadIndexSource[]
	readonly #stallMs: number
	readonly #jobs = new Map<string, JobEntry>()
	readonly #queue: string[] = []
	// Installed tile files of each band, read from the folders after every change.
	readonly #installed = new Map<string, { readonly files: number; readonly bytes: number }>()
	#running = false
	#published = 0
	#revision = 0

	// Creates the downloads into directory (the default index folder); settings gives the saved Index Folder, and publish
	// announces every change.
	constructor(
		readonly directory: string,
		private readonly settings: QuadIndexSettings,
		private readonly publish: (event: QuadIndexDownloadsEvent) => void,
		options: QuadIndexDownloadsOptions = {},
	) {
		this.#fetch = options.fetch ?? ((url, init) => fetch(url, init))
		this.#bands = options.bands ?? QUAD_INDEX_BANDS
		this.#sources = options.sources ?? QUAD_INDEX_SOURCES
		this.#stallMs = options.stallMs ?? DOWNLOAD_STALL_MS
	}

	// Clears what downloads of a previous run left in staging and reads which bands are installed. Never rejects.
	async start() {
		try {
			await rm(join(this.directory, STAGING), { recursive: true, force: true })
		} catch (error) {
			console.error('The staging folder of the quad index downloads could not be cleared', error)
		}

		await this.#scan()
	}

	// Bands and their state, the installed files read again from the folders.
	async snapshot(): Promise<QuadIndexDownloadsSnapshot> {
		await this.#scan()
		return this.#snapshot()
	}

	// Publishes the bands again, such as when the Index Folder of the solver changed.
	async changed() {
		this.publish({ type: 'quadIndexes:updated', snapshot: await this.#snapshot() })
	}

	// Queues the download of a band, unless it is queued or running; throws notFound or notPublished at once.
	download(id: string): Promise<QuadIndexDownloadsSnapshot> {
		const band = this.#band(id)
		if (!band.driveId) throw new QuadIndexError('This band is not shared yet.', 409, 'notPublished')

		const active = this.#jobs.get(id)

		if (!active || active.job.state === 'failed') {
			this.#jobs.set(id, { job: { state: 'queued', bytes: 0, totalBytes: band.archiveBytes }, controller: new AbortController() })
			this.#queue.push(id)
			void this.#pump()
		}

		return this.#changedNow()
	}

	// Cancels the download of a band: a queued one is dropped, a running one stops and leaves the installed files as
	// they were; a failed one is forgotten. Throws notFound at once.
	cancel(id: string): Promise<QuadIndexDownloadsSnapshot> {
		this.#band(id)
		const entry = this.#jobs.get(id)

		if (entry) {
			const index = this.#queue.indexOf(id)
			if (index >= 0) this.#queue.splice(index, 1)
			if (entry.job.state === 'downloading' || entry.job.state === 'installing') entry.controller.abort(new DOMException('Cancelled', 'AbortError'))
			else this.#jobs.delete(id)
		}

		return this.#changedNow()
	}

	// Deletes the installed tile files of a band; throws notFound, and busy while it is being downloaded.
	async remove(id: string): Promise<QuadIndexDownloadsSnapshot> {
		const band = this.#band(id)
		const state = this.#jobs.get(id)?.job.state
		if (state && state !== 'failed') throw new QuadIndexError('The band is being downloaded.', 409, 'busy')

		await this.#removeTiles(band)
		this.#jobs.delete(id)
		await this.#scan()
		return this.#changedNow()
	}

	// Stops every download, for a server stopping in place.
	[Symbol.dispose]() {
		this.#queue.length = 0
		for (const entry of this.#jobs.values()) entry.controller.abort(new DOMException('Stopped', 'AbortError'))
	}

	// Returns a band by id; throws notFound.
	#band(id: string) {
		const band = this.#bands.find((e) => e.id === id)
		if (!band) throw new QuadIndexError('Unknown quad index band.', 404, 'notFound')
		return band
	}

	// Source folder of a band.
	#folder(band: QuadIndexBand) {
		return join(this.directory, band.source)
	}

	// Reads the installed tile files of every band from their folders; a missing folder holds none.
	async #scan() {
		for (const source of new Set(this.#bands.map((band) => band.source))) {
			let entries: { readonly name: string; readonly size: number }[] = []

			try {
				const folder = join(this.directory, source)
				const names = (await readdir(folder, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name)
				entries = await Promise.all(
					names.map(async (name) => ({
						name,
						size: await stat(join(folder, name)).then(
							(e) => e.size,
							() => 0,
						),
					})),
				)
			} catch (error) {
				if (errorCode(error) !== 'ENOENT') console.error(`The quad index folder of ${source} could not be read`, error)
			}

			for (const band of this.#bands) {
				if (band.source !== source) continue
				const tiles = entries.filter((e) => isTileOf(band, e.name))
				this.#installed.set(band.id, { files: tiles.length, bytes: tiles.reduce((sum, e) => sum + e.size, 0) })
			}
		}
	}

	// Builds the snapshot from the last scan.
	async #snapshot(): Promise<QuadIndexDownloadsSnapshot> {
		const indexDirectory = (await this.settings.indexDirectory())?.trim()
		const path = indexDirectory ? relative(resolve(indexDirectory), this.directory) : ''
		const searched = !indexDirectory || path === '' || (!path.startsWith('..') && !isAbsolute(path))

		const bands = this.#bands.map((band): QuadIndexBandItem => {
			const { driveId, sha256: _, ...rest } = band
			const { files = 0, bytes = 0 } = this.#installed.get(band.id) ?? {}
			const installed = files === 0 ? 'missing' : files === band.files && bytes === band.bytes ? 'installed' : 'partial'
			const job = this.#jobs.get(band.id)?.job
			return { ...rest, ...fieldsOf(band), published: !!driveId, installed, installedFiles: files, installedBytes: bytes, ...(job && { job }) }
		})

		return { revision: ++this.#revision, directory: this.directory, searched, sources: this.#sources, bands }
	}

	// Publishes the bands at once and returns them.
	async #changedNow() {
		const snapshot = await this.#snapshot()
		this.#published = Date.now()
		this.publish({ type: 'quadIndexes:updated', snapshot })
		return snapshot
	}

	// Runs the queued downloads one at a time.
	async #pump() {
		if (this.#running) return
		this.#running = true

		try {
			for (let id = this.#queue.shift(); id !== undefined; id = this.#queue.shift()) {
				const entry = this.#jobs.get(id)
				if (!entry) continue
				await this.#run(this.#band(id), entry)
			}
		} finally {
			this.#running = false
		}
	}

	// Runs one download to its end: installed and forgotten, failed and kept with its reason, or cancelled and forgotten.
	async #run(band: QuadIndexBand, entry: JobEntry) {
		const { signal } = entry.controller
		const staging = join(this.directory, STAGING, band.id)

		try {
			entry.job = { ...entry.job, state: 'downloading' }
			await this.#changedNow()
			const names = await this.#transfer(band, staging, signal, (bytes) => {
				entry.job = { ...entry.job, bytes }
				if (Date.now() - this.#published >= PROGRESS_INTERVAL_MS) void this.#changedNow()
			})

			entry.job = { ...entry.job, state: 'installing' }
			await this.#changedNow()
			signal.throwIfAborted()
			await this.#install(band, staging, names)
			this.#jobs.delete(band.id)
		} catch (error) {
			if (signal.aborted) this.#jobs.delete(band.id)
			else entry.job = { ...entry.job, state: 'failed', error: Error.isError(error) ? error.message : String(error) }
		} finally {
			await rm(staging, { recursive: true, force: true }).catch(() => undefined)
			await this.#scan()
			await this.#changedNow()
		}
	}

	// Downloads the archive of a band and unpacks it into staging; returns the names of its files. Throws downloadFailed
	// when Google Drive cannot be reached, answers an error or a page instead of the file, or sends nothing for the stall
	// wait, and when the archive differs from the catalog.
	async #transfer(band: QuadIndexBand, staging: string, signal: AbortSignal, progress: (bytes: number) => void) {
		const stall = new AbortController()
		const stopped = AbortSignal.any([signal, stall.signal])
		const stallMs = this.#stallMs
		const failed = (message: string) => new QuadIndexError(message, 502, 'downloadFailed')
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
				response = await this.#fetch(googleDriveUrl(band.driveId!), { signal: stopped })
			} catch (error) {
				if (signal.aborted) throw error
				if (stall.signal.aborted) throw failed(`Google Drive sent nothing for ${Math.round(stallMs / 1000)} s.`)
				throw failed(`Google Drive could not be reached: ${Error.isError(error) ? error.message : String(error)}`)
			}

			if (!response.ok || !response.body) {
				await response.body?.cancel()
				throw failed(`Google Drive answered ${response.status}.`)
			}

			// Google Drive answers a page instead of the file when the file reached its download quota or is not shared.
			if (response.headers.get('content-type')?.includes('text/html')) {
				await response.body.cancel()
				throw failed('Google Drive sent a page instead of the file: the file may have reached its download quota for today, or is no longer shared. Try again later.')
			}

			await rm(staging, { recursive: true, force: true })
			await mkdir(staging, { recursive: true })

			const hasher = new Bun.CryptoHasher('sha256')
			const body = response.body
			let received = 0

			// Hashes and counts the archive as it arrives.
			async function* counted() {
				for await (const chunk of body) {
					alive()
					hasher.update(chunk)
					received += chunk.byteLength
					progress(received)
					yield chunk
				}
			}

			let names: string[] = []

			try {
				await pipeline(counted(), createZstdDecompress(), async (source: AsyncIterable<Uint8Array>) => {
					names = await extractTar(source, staging)
				})
			} catch (error) {
				if (signal.aborted) throw error
				if (stall.signal.aborted) throw failed(`Google Drive sent nothing for ${Math.round(stallMs / 1000)} s.`)
				throw failed(`The archive could not be unpacked: ${Error.isError(error) ? error.message : String(error)}`)
			}

			if (received !== band.archiveBytes || hasher.digest('hex') !== band.sha256) throw failed('The downloaded archive is damaged: it differs from the published one. Try again.')
			if (names.length !== band.files || names.some((name) => !isTileOf(band, name))) throw failed('The downloaded archive does not hold the files of this band.')
			return names
		} finally {
			clearTimeout(timer)
		}
	}

	// Replaces the installed tile files of a band with the staged ones.
	async #install(band: QuadIndexBand, staging: string, names: readonly string[]) {
		const folder = this.#folder(band)
		await mkdir(folder, { recursive: true })
		await this.#removeTiles(band, new Set(names))
		for (const name of names) await rename(join(staging, name), join(folder, name))
	}

	// Deletes the tile files of a band from its folder, but those kept.
	async #removeTiles(band: QuadIndexBand, kept: ReadonlySet<string> = new Set()) {
		const folder = this.#folder(band)
		let names: string[]

		try {
			names = await readdir(folder)
		} catch (error) {
			if (errorCode(error) === 'ENOENT') return
			throw error
		}

		for (const name of names) if (isTileOf(band, name) && !kept.has(name)) await rm(join(folder, name), { force: true })
	}
}

// Responds to a failed request of the downloads.
function failure(error: unknown) {
	if (error instanceof QuadIndexError) return errorResponse(error.message, error.status, error.code)
	return errorResponse(Error.isError(error) ? error.message : String(error), 500, 'internal')
}

// Runs a handler, answering its snapshot as JSON.
async function answer(handler: () => Promise<QuadIndexDownloadsSnapshot>, status = 200) {
	try {
		return Response.json(await handler(), { status })
	} catch (error) {
		return failure(error)
	}
}

// Routes of the downloadable bands of the built-in solver. Errors are { error, code } with a QuadIndexErrorCode.
export function createQuadIndexDownloadRoutes(downloads: QuadIndexDownloads) {
	return {
		'/api/settings/external-tools/nebulosa/indexes': {
			// Downloadable bands and their state (QuadIndexDownloadsSnapshot).
			GET: () => answer(() => downloads.snapshot()),
		},
		'/api/settings/external-tools/nebulosa/indexes/:band/download': {
			// Queues the download of a band (QuadIndexDownloadsSnapshot); 404 notFound, 409 notPublished.
			POST: (req) => answer(() => downloads.download(req.params.band), 202),
		},
		'/api/settings/external-tools/nebulosa/indexes/:band/cancel': {
			// Cancels the download of a band, or forgets the one that failed (QuadIndexDownloadsSnapshot); 404 notFound.
			POST: (req) => answer(() => downloads.cancel(req.params.band)),
		},
		'/api/settings/external-tools/nebulosa/indexes/:band': {
			// Deletes the installed files of a band (QuadIndexDownloadsSnapshot); 404 notFound, 409 busy.
			DELETE: (req) => answer(() => downloads.remove(req.params.band)),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
