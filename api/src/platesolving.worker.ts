import fs from 'fs'
import { open, stat } from 'fs/promises'
import { nativePlateSolve, type NativePlateSolveOptions, type NativePlateSolveResult } from 'nebulosa/src/astrometry/solvers/native'
import { PlateSolveError } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { QuadIndex } from 'nebulosa/src/astrometry/solvers/quad.index'
import { AstrometryNetQuadIndex } from 'nebulosa/src/astrometry/solvers/quad.index.astrometrynet'
import { decodeQuadIndexHeader, NebulosaQuadIndex } from 'nebulosa/src/astrometry/solvers/quad.index.file'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { detectStars } from 'nebulosa/src/imaging/stars/detector'
import { fileHandleSource } from 'nebulosa/src/io/file'
import { readFits } from 'nebulosa/src/io/formats/fits/fits'
import { bufferSource } from 'nebulosa/src/io/io'
import { luminanceImage, readImageFrom } from './imagedecode'
import { findQuadIndexFiles, type NativeSolveErrorCode, type NativeSolveParameters, type NativeWorkerRequest, type NativeWorkerResponse } from './platesolving.native'
import { errorCode } from './util'

// Worker thread of the built-in plate solver (see platesolving.native.ts). For each solve it detects the stars of the
// grayscale copy of an image, or of the FITS of private pixels it decodes, searches the quad index files of the folder
// of the solve with the toolkit's nativePlateSolve. The indexes of a folder stay open between solves while its files keep their sizes and times: the .nqi tiles of one band and
// source become one index, opened at once (of two files of the same tile, the one holding more quads, so the whole-sky
// file of a full run wins over the -region one of a regional run), while an Astrometry.net file, which is read whole where it cannot be mapped,
// is opened only once a field its band can serve needs it. A file that cannot be read is skipped with a warning. A
// solve stops at a cancel message, since the solver yields to the event loop between its slices, and when its time
// runs out, star detection included. Angles are radians.

declare const self: Worker

// Stars detected in an image for a solve, brightest first; the solver uses the brightest of them.
// TODO(Tiago): Reduzir o número de estrelas acelerou o plate solver, mas não sei qual o seu impacto em resolver diversos campos de visão.
const DETECTED_STARS = 100

// Size of the header of a .nqi file, bytes.
const QUAD_INDEX_HEADER_SIZE = 512

// An Astrometry.net index file of the folder, opened once a field needs it.
interface AstrometryNetFile {
	// Path of the file.
	readonly path: string
	// Shortest quad of its band, radians.
	readonly scaleLower: number
	// Longest quad of its band, radians.
	readonly scaleUpper: number
	// The index, once opened; null when it could not be.
	index?: AstrometryNetQuadIndex | null
}

// Whether a band of quads from scaleLower to scaleUpper radians can serve an image of width × height pixels at a range
// of scales (radians per pixel): its quads, seen at that range, reach 10% of the shorter side and fit in the diagonal,
// as nativePlateSolve selects its indexes.
function servesField(scaleLower: number, scaleUpper: number, width: number, height: number, scale: NativeSolveParameters['scale']) {
	const lower = scale ? scaleLower / scale.upper : 0
	const upper = scale && scale.lower > 0 ? scaleUpper / scale.lower : Infinity
	return upper >= 0.1 * Math.min(width, height) && lower <= Math.hypot(width, height)
}

// Returns the identity of the contents of files: their paths, sizes, and modification times.
async function signatureOf(paths: readonly string[]) {
	const parts = await Promise.all(
		paths.map(
			async (path) =>
				(await stat(path).then(
					({ size, mtimeMs }) => `${size}:${mtimeMs}`,
					() => 'missing',
				)) + `:${path}`,
		),
	)
	return parts.join('\n')
}

// Reads the 512-byte header of a .nqi file. Throws when it cannot be read or is too short.
function readQuadIndexHeader(path: string) {
	const fd = fs.openSync(path, 'r')

	try {
		const bytes = new Uint8Array(QUAD_INDEX_HEADER_SIZE)
		if (fs.readSync(fd, bytes, 0, QUAD_INDEX_HEADER_SIZE, 0) !== QUAD_INDEX_HEADER_SIZE) throw new Error('the file is shorter than its header')
		return decodeQuadIndexHeader(bytes)
	} finally {
		fs.closeSync(fd)
	}
}

// Returns the band of an Astrometry.net index file from its primary header, or undefined when it is not one.
async function astrometryNetBand(path: string): Promise<{ readonly scaleLower: number; readonly scaleUpper: number } | undefined> {
	await using source = fileHandleSource(await open(path, 'r'))
	const header = (await readFits(source))?.hdus[0]?.header
	const scaleLower = Number(header?.SCALE_L)
	const scaleUpper = Number(header?.SCALE_U)
	return header?.AN_FILE === 'QUAD' && scaleLower >= 0 && scaleUpper > scaleLower ? { scaleLower, scaleUpper } : undefined
}

// Indexes of the folder of the latest solve, kept open while its files are unchanged.
class IndexCache {
	// Folder the indexes come from.
	#directory = ''
	// Identity of the contents of its index files.
	#signature = ''
	// One index per band and source of the .nqi tiles.
	#nebulosa: NebulosaQuadIndex[] = []
	// Astrometry.net index files.
	#astrometryNet: AstrometryNetFile[] = []
	// Files skipped when the folder was opened, for the warnings of every solve.
	#skipped: string[] = []

	// Returns the indexes of a folder (none for an empty one, or for one that does not exist, such as the default index
	// folder before any download) that can serve an image of width × height pixels at a range of scales, opening them
	// when the folder or its files changed, with the warnings about the files skipped and whether the folder is missing.
	async indexes(directory: string, width: number, height: number, scale: NativeSolveParameters['scale']): Promise<{ readonly indexes: QuadIndex[]; readonly warnings: string[]; readonly missing?: boolean }> {
		if (!directory) {
			this.#close()
			return { indexes: [], warnings: [] }
		}

		let files

		try {
			files = await findQuadIndexFiles(directory)
		} catch (error) {
			if (errorCode(error) !== 'ENOENT') throw error
			this.#close()
			return { indexes: [], warnings: [`The index folder ${directory} does not exist: download index bands in the settings of the Nebulosa solver, or set another folder.`], missing: true }
		}

		const signature = await signatureOf([...files.nebulosa, ...files.astrometryNet])

		if (directory !== this.#directory || signature !== this.#signature) {
			this.#close()
			this.#directory = directory
			this.#signature = signature
			for (const folder of files.unreadable) this.#skipped.push(`The folder ${folder} was skipped: it cannot be read.`)
			this.#openNebulosa(files.nebulosa)
			await this.#listAstrometryNet(files.astrometryNet)
		}

		const warnings = [...this.#skipped]
		const indexes: QuadIndex[] = this.#nebulosa.filter((index) => servesField(index.scaleLower, index.scaleUpper, width, height, scale))

		for (const file of this.#astrometryNet) {
			if (file.index === null || !servesField(file.scaleLower, file.scaleUpper, width, height, scale)) continue

			if (file.index === undefined) {
				try {
					file.index = new AstrometryNetQuadIndex(file.path)
				} catch (error) {
					file.index = null
					this.#skipped.push(`The index file ${file.path} was skipped: ${Error.isError(error) ? error.message : String(error)}.`)
					warnings.push(this.#skipped.at(-1)!)
					continue
				}
			}

			indexes.push(file.index)
		}

		return { indexes, warnings }
	}

	// Opens the .nqi tiles as one index per band and source. Of two files of the same tile, the one holding more quads
	// (then more stars) is kept, since the other covers only a region, and the other is skipped.
	#openNebulosa(paths: readonly string[]) {
		const groups = new Map<string, Map<number, { readonly path: string; readonly quads: number; readonly stars: number }>>()

		for (const path of paths) {
			try {
				const header = readQuadIndexHeader(path)
				const key = [header.catalog, header.scaleLower, header.scaleUpper, header.nside, header.tileNside].join('|')
				const tiles = groups.get(key) ?? new Map()
				groups.set(key, tiles)
				const candidate = { path, quads: header.quadCount, stars: header.ownStarCount }
				const kept = tiles.get(header.tileId)

				if (kept === undefined) {
					tiles.set(header.tileId, candidate)
				} else {
					const better = candidate.quads > kept.quads || (candidate.quads === kept.quads && candidate.stars > kept.stars)
					this.#skipped.push(`The index file ${better ? kept.path : path} was skipped: ${better ? path : kept.path} holds more of the same tile.`)
					if (better) tiles.set(header.tileId, candidate)
				}
			} catch (error) {
				this.#skipped.push(`The index file ${path} was skipped: ${Error.isError(error) ? error.message : String(error)}.`)
			}
		}

		for (const tiles of groups.values()) {
			const paths = [...tiles.values()].map(({ path }) => path).sort()

			try {
				this.#nebulosa.push(new NebulosaQuadIndex(paths))
			} catch (error) {
				this.#skipped.push(`The index files of ${paths[0]} were skipped: ${Error.isError(error) ? error.message : String(error)}.`)
			}
		}
	}

	// Reads the band of every Astrometry.net index file, without opening it.
	async #listAstrometryNet(paths: readonly string[]) {
		for (const path of paths) {
			try {
				const band = await astrometryNetBand(path)
				if (band) this.#astrometryNet.push({ path, ...band })
				else this.#skipped.push(`The file ${path} was skipped: it is not an Astrometry.net index.`)
			} catch (error) {
				this.#skipped.push(`The index file ${path} was skipped: ${Error.isError(error) ? error.message : String(error)}.`)
			}
		}
	}

	// Closes every open index and forgets the folder.
	#close() {
		for (const index of this.#nebulosa) index[Symbol.dispose]()
		for (const file of this.#astrometryNet) file.index?.[Symbol.dispose]()
		this.#nebulosa = []
		this.#astrometryNet = []
		this.#skipped = []
		this.#directory = ''
		this.#signature = ''
	}
}

// Indexes of the latest folder, shared by the solves of this worker.
const cache = new IndexCache()

// Abort controllers of the solves running, by job id.
const running = new Map<string, AbortController>()

// Returns the grayscale image the stars of a solve are detected in. Throws when private pixels cannot be decoded.
async function imageOf({ pixels }: NativeSolveParameters): Promise<Image> {
	if (pixels.kind === 'image') return pixels.image
	const decoded = await readImageFrom(bufferSource(Buffer.from(pixels.bytes.buffer, pixels.bytes.byteOffset, pixels.bytes.byteLength)))
	if (!decoded) throw new Error('the pixels are not a FITS image')
	return luminanceImage(decoded.image)
}

// Error that ends a solve with a reason.
class SolveFailure extends Error {
	// Creates the failure of a reason.
	constructor(
		readonly code: NativeSolveErrorCode,
		message: string,
	) {
		super(message)
	}
}

// Solves the stars of a request with the indexes of its folder. Resolves to the solution, or undefined when none was
// found, with the warnings of the solve.
async function solve(request: NativeSolveParameters, signal: AbortSignal): Promise<{ readonly result?: NativePlateSolveResult; readonly warnings: string[] }> {
	const started = performance.now()
	// Time left of the whole solve, at least 1 ms, since a timeout of 0 means the solver's default.
	const remaining = () => {
		const left = request.timeout - (performance.now() - started)
		if (!(left > 0)) throw new SolveFailure('timeout', `The plate solve did not finish within ${request.timeout / 1000} s`)
		return left
	}

	let image: Image

	try {
		image = await imageOf(request)
	} catch (error) {
		throw new SolveFailure('invalidImage', `The pixels could not be read: ${Error.isError(error) ? error.message : String(error)}`)
	}

	const stars = detectStars(image, { maxStars: DETECTED_STARS })
	signal.throwIfAborted()
	const { width, height, position, scale } = request
	const options: NativePlateSolveOptions = { width, height, ...position, ...(scale && { scale }), timeout: remaining() }
	const { indexes, warnings, missing } = await cache.indexes(request.indexDirectory, width, height, scale)

	if (indexes.length > 0) {
		const result = await nativePlateSolve(stars, indexes, { ...options, timeout: remaining() }, signal)
		return { result, warnings }
	}

	if (request.indexDirectory && !missing) warnings.push('The index folder holds no index file that serves this field and scale.')
	return { warnings }
}

// Runs the solve of a request and posts its outcome.
async function handle(request: Extract<NativeWorkerRequest, { type: 'solve' }>): Promise<void> {
	const { jobId } = request
	const controller = new AbortController()
	running.set(jobId, controller)
	let response: NativeWorkerResponse

	try {
		const { result, warnings } = await solve(request, controller.signal)
		response = result ? { jobId, status: 'solved', header: result.header, warnings } : { jobId, status: 'noSolution', warnings }
	} catch (error) {
		if (controller.signal.aborted || (error instanceof PlateSolveError && error.code === 'aborted')) response = { jobId, status: 'failed', code: 'cancelled', error: 'The plate solve was cancelled' }
		else if (error instanceof SolveFailure) response = { jobId, status: 'failed', code: error.code, error: error.message }
		else if (error instanceof PlateSolveError && error.code === 'timeout') response = { jobId, status: 'failed', code: 'timeout', error: `The plate solve did not finish within ${request.timeout / 1000} s` }
		else response = { jobId, status: 'failed', code: 'failed', error: Error.isError(error) ? error.message : String(error) }
	} finally {
		running.delete(jobId)
	}

	self.postMessage(response, [])
}

self.addEventListener('message', ({ data }: MessageEvent<NativeWorkerRequest>) => {
	if (data.type === 'cancel') running.get(data.jobId)?.abort()
	else void handle(data)
})
