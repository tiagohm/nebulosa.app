import { mkdir, open, rm } from 'fs/promises'
import { join } from 'path'
import { writeImageToFormat } from 'nebulosa/src/imaging/model/image'
import type { Image } from 'nebulosa/src/imaging/model/types'
// oxfmt-ignore
import { blendLuminanceRows, type ChannelMix, collectLuminanceSamples, type CompositionPlane, createCompositionCounters, createLuminanceSamples, type LuminanceMatch, mixChannelRows, solveLuminanceMatch } from 'nebulosa/src/imaging/processing/channel.composition'
import { stf } from 'nebulosa/src/imaging/processing/stf'
import { autoStf } from 'nebulosa/src/imaging/processing/stf.presets'
import { fileHandleSink, fileHandleSource } from 'nebulosa/src/io/file'
import { type FitsHeader, FitsImageReader, FitsImageRowWriter, readFits } from 'nebulosa/src/io/formats/fits/fits'
import { uncompressedHeightKeyword, uncompressedNumberOfChannelsKeyword, uncompressedWidthKeyword } from 'nebulosa/src/io/formats/fits/util'
import { fileDigest } from './calibrationlibrary.analysis'
import { COMPOSITE_FILE, type StackingCompositeDiagnostics, type StackingCompositionLuminance } from './imagestacking.store'

// Color composition of the linear masters of a project, on the worker of Image Stacking (`imagestacking.worker.ts`), and
// the client of that worker. Masters share the project grid, so they are read as strips of the same rows and never
// resampled; no light frame is read. The toolkit mixes the planes into RGB (`mixChannelRows`) and blends an optional
// luminance master into the luminance of the mix (`blendLuminanceRows`). A composite takes two passes over the rows: the
// first finds the box of the pixels every mixed master covers and samples the luminance match, the second writes the
// cropped channels to staging, which are then joined into one Float32 FITS. Everything stays linear; only a preview, a
// decimated copy of the same math, is stretched, for display.

// Version of the composition, part of the fingerprint of a composite; a change composes every composite again.
export const COMPOSITION_VERSION = 1

// Memory of one composition, in bytes.
export const COMPOSITION_MEMORY_BUDGET = 512 * 1024 ** 2

// Time a composition may go without reporting progress, in milliseconds, before its worker is terminated.
export const COMPOSITION_STALL_TIMEOUT = 120000

// Longest side of a preview, in pixels.
export const PREVIEW_SIZE = 768

// Quality of a preview JPEG, in [1, 100].
const PREVIEW_QUALITY = 85

// Failure of a composition whose message is safe to show: it never holds a path.
export class CompositionError extends Error {}

// A plane of a master the worker reads, with its correction.
export interface CompositionPlaneFile {
	// Absolute path of the master; it is only read.
	readonly path: string
	// Channel of the master, from 0.
	readonly plane: number
	// Multiplier and offset applied before mixing.
	readonly gain: number
	readonly offset: number
}

// What a composition and a preview read and mix.
export interface CompositionInput {
	// Id of the job, echoed by every response.
	readonly jobId: string
	// Project grid every master is on, in pixels.
	readonly width: number
	readonly height: number
	readonly planes: readonly CompositionPlaneFile[]
	readonly mix: ChannelMix
	readonly luminance?: StackingCompositionLuminance
}

// Request to compose a composite.
export interface CompositionWorkerRequest extends CompositionInput {
	// Descriptive header of the composite, without structural keywords.
	readonly header: FitsHeader
	// Directory of the work; the composite goes to its product subdirectory.
	readonly staging: string
	// Memory of the composition, in bytes.
	readonly memoryBudget: number
}

// Request to preview a composition.
export interface PreviewWorkerRequest extends CompositionInput {
	// Longest side of the preview, in pixels.
	readonly size: number
}

// Progress of a composition, in rows of the two passes.
export interface CompositionProgress {
	readonly rows: number
	readonly rowsTotal: number
}

// A composite staged by the worker, for the server to publish.
export interface ComposedImage {
	// Directory holding composite.fit.
	readonly directory: string
	// SHA-256 and size, in bytes, of composite.fit.
	readonly contentDigest: string
	readonly bytes: number
	// Size of the crop, in pixels, and its origin on the project grid.
	readonly width: number
	readonly height: number
	readonly left: number
	readonly top: number
	readonly diagnostics: StackingCompositeDiagnostics
}

// Response of the worker to a composition or a preview.
export type CompositionWorkerResponse =
	| { readonly jobId: string; readonly status: 'progress'; readonly progress: CompositionProgress }
	| { readonly jobId: string; readonly status: 'composed'; readonly image: ComposedImage }
	| { readonly jobId: string; readonly status: 'previewed'; readonly jpeg: Uint8Array<ArrayBuffer> }
	| { readonly jobId: string; readonly status: 'failed'; readonly error: string }

// Composes and previews; tests replace the worker with an in-thread compositor.
export interface FrameCompositor {
	readonly compose: (request: CompositionWorkerRequest, onProgress: (progress: CompositionProgress) => void, signal: AbortSignal) => Promise<ComposedImage>
	readonly preview: (request: PreviewWorkerRequest, signal: AbortSignal) => Promise<Uint8Array<ArrayBuffer>>
}

// Reads rows of one plane of a master in its stored units.
interface PlaneReader {
	// Fills the start of `output` with width × rows samples of rows from `startRow`.
	readonly read: (output: Float32Array, startRow: number, rows: number) => Promise<void>
}

// Opens the planes of a request; every master must be the grid of the request and hold the plane named. The file is
// opened per read, so a composition of many masters holds no file open between strips.
async function openPlanes({ width, height, planes }: CompositionInput) {
	const readers: PlaneReader[] = []

	for (const { path, plane } of planes) {
		const hdu = await (async () => {
			await using source = fileHandleSource(await open(path, 'r'))
			return (await readFits(source))?.hdus.find((candidate) => uncompressedWidthKeyword(candidate.header, 0) > 0)
		})().catch(() => undefined)

		if (!hdu) throw new CompositionError('A master could not be read')
		if (uncompressedWidthKeyword(hdu.header, 0) !== width || uncompressedHeightKeyword(hdu.header, 0) !== height) throw new CompositionError('A master is not on the project grid')
		if (plane >= uncompressedNumberOfChannelsKeyword(hdu.header, 1)) throw new CompositionError('A master has no such channel')
		const reader = new FitsImageReader(hdu)

		readers.push({
			async read(output, startRow, rows) {
				await using source = fileHandleSource(await open(path, 'r'))
				if (!(await reader.readRows(source, output, startRow, rows, plane, 'digital'))) throw new CompositionError('A master ended before its last row')
			},
		})
	}

	return readers
}

// Returns the planes that a composition reads: those with a positive weight, and the luminance when it is blended.
function usedPlanes({ mix, luminance }: Pick<CompositionInput, 'mix' | 'luminance'>) {
	const used = new Set<number>()
	for (const channel of ['red', 'green', 'blue'] as const) for (const { plane, weight } of mix[channel]) if (weight > 0) used.add(plane)
	if (luminance && luminance.alpha > 0) used.add(luminance.source)
	return used
}

// Workspace of strips of every plane, the mixed color, and its validity.
function stripBuffers(input: CompositionInput, pixels: number) {
	const planes: (CompositionPlane & { readonly raw: Float32Array; readonly valid: Uint8Array })[] = input.planes.map(({ gain, offset }) => ({ raw: new Float32Array(pixels), valid: new Uint8Array(pixels), gain, offset }))
	return { planes, rgb: new Float32Array(pixels * 3), rgbValid: new Uint8Array(pixels) }
}

// Marks the samples of a strip that hold data.
function markValid(plane: { readonly raw: Float32Array; readonly valid: Uint8Array }, count: number) {
	for (let i = 0; i < count; i++) plane.valid[i] = Number.isFinite(plane.raw[i]) ? 1 : 0
}

// Rows of a strip of a composition of `planes` planes `width` pixels wide within `budget` bytes, at least one.
export function compositionStripRows(width: number, height: number, planes: number, budget: number) {
	return Math.max(1, Math.min(height, Math.floor(budget / (width * (planes * 5 + 13)))))
}

// Composes a request into its staging directory. Reports progress after every strip. Throws CompositionError for what an
// operator can act on.
export async function composeImage(request: CompositionWorkerRequest, report: (progress: CompositionProgress) => void): Promise<ComposedImage> {
	const { width, height, mix, luminance } = request
	const readers = await openPlanes(request)
	const used = usedPlanes(request)
	const strip = compositionStripRows(width, height, used.size, request.memoryBudget)
	const { planes, rgb, rgbValid } = stripBuffers(request, width * strip)
	const blended = luminance && luminance.alpha > 0 ? luminance : undefined
	const samples = blended ? createLuminanceSamples(width * height) : undefined
	const first = createCompositionCounters()
	let left = width
	let top = height
	let right = -1
	let bottom = -1
	let rows = 0

	// Reads and mixes the rows of a strip.
	const mixStrip = async (startRow: number, count: number, counters: ReturnType<typeof createCompositionCounters>) => {
		for (const index of used) {
			await readers[index].read(planes[index].raw, startRow, count / width)
			markValid(planes[index], count)
		}

		mixChannelRows(planes, mix, count, rgb, rgbValid, counters)
	}

	for (let startRow = 0; startRow < height; startRow += strip) {
		const stripRows = Math.min(strip, height - startRow)
		const count = width * stripRows
		await mixStrip(startRow, count, first)
		if (samples && blended) collectLuminanceSamples(samples, rgb, rgbValid, planes[blended.source], count)

		for (let pixel = 0; pixel < count; pixel++) {
			if (rgbValid[pixel] === 0 || (blended && planes[blended.source].valid[pixel] === 0)) continue
			const x = pixel % width
			const y = startRow + Math.trunc(pixel / width)
			if (x < left) left = x
			if (x > right) right = x
			if (y < top) top = y
			if (y > bottom) bottom = y
		}

		rows += stripRows
		report({ rows, rowsTotal: height * 2 })
	}

	if (right < left) throw new CompositionError('No pixel is covered by every master it mixes')
	const match: LuminanceMatch | undefined = samples && blended ? solveLuminanceMatch(samples, blended.match) : undefined
	const cropWidth = right - left + 1
	const cropHeight = bottom - top + 1
	const product = join(request.staging, 'product')
	const channelFiles = [0, 1, 2].map((channel) => join(request.staging, `channel-${channel}.raw`))
	await mkdir(product, { recursive: true })
	const counters = createCompositionCounters()
	const handles = await Promise.all(channelFiles.map((path) => open(path, 'wx')))

	try {
		const row = new Float32Array(cropWidth)

		for (let startRow = top; startRow <= bottom; startRow += strip) {
			const stripRows = Math.min(strip, bottom + 1 - startRow)
			const count = width * stripRows
			await mixStrip(startRow, count, counters)
			if (match && blended) blendLuminanceRows(rgb, rgbValid, planes[blended.source], match, blended.alpha, count, counters)

			for (let channel = 0; channel < 3; channel++) {
				for (let y = 0; y < stripRows; y++) {
					for (let x = 0, i = (y * width + left) * 3 + channel; x < cropWidth; x++, i += 3) row[x] = rgb[i]
					await handles[channel].write(new Uint8Array(row.buffer))
				}
			}

			rows += stripRows
			report({ rows: Math.min(rows, height * 2), rowsTotal: height * 2 })
		}
	} finally {
		await Promise.all(handles.map((handle) => handle.close()))
	}

	const path = join(product, COMPOSITE_FILE)
	const output = await open(path, 'wx')

	try {
		const writer = new FitsImageRowWriter(fileHandleSink(output), { SIMPLE: true, BITPIX: -32, NAXIS: 3, NAXIS1: cropWidth, NAXIS2: cropHeight, NAXIS3: 3, ...request.header })
		await writer.begin()
		const chunk = new Float32Array(cropWidth * strip)

		for (const file of channelFiles) {
			const handle = await open(file, 'r')

			try {
				for (let read = 0; read < cropWidth * cropHeight;) {
					const samples = Math.min(chunk.length, cropWidth * cropHeight - read)
					const { bytesRead } = await handle.read(new Uint8Array(chunk.buffer, 0, samples * 4), 0, samples * 4, read * 4)
					if (bytesRead !== samples * 4) throw new CompositionError('A channel of the composite ended early')
					await writer.write(chunk, samples)
					read += samples
				}
			} finally {
				await handle.close()
			}
		}

		await writer.end()
		await output.sync()
	} finally {
		await output.close()
	}

	await Promise.all(channelFiles.map((file) => rm(file, { force: true })))

	{
		await using source = fileHandleSource(await open(path, 'r'))
		const header = (await readFits(source))?.hdus[0]?.header
		if (!header || uncompressedWidthKeyword(header, 0) !== cropWidth || uncompressedHeightKeyword(header, 0) !== cropHeight || uncompressedNumberOfChannelsKeyword(header, 1) !== 3) throw new CompositionError('The composite could not be read back')
	}

	const { size } = await Bun.file(path).stat()
	return { directory: product, contentDigest: await fileDigest(path), bytes: size, width: cropWidth, height: cropHeight, left, top, diagnostics: { ...counters, ...(match && { luminanceMatch: match }) } }
}

// Previews a composition: every k-th row and column of the masters, mixed and blended as a composite is, then stretched
// with one linked automatic curve and encoded as JPEG. Pixels without data are black.
export async function previewImage(request: PreviewWorkerRequest): Promise<Uint8Array<ArrayBuffer>> {
	const { width, height, mix, luminance } = request
	const readers = await openPlanes(request)
	const used = usedPlanes(request)
	const step = Math.max(1, Math.ceil(Math.max(width, height) / request.size))
	const previewWidth = Math.ceil(width / step)
	const previewHeight = Math.ceil(height / step)
	const pixels = previewWidth * previewHeight
	const { planes, rgb, rgbValid } = stripBuffers(request, pixels)
	const row = new Float32Array(width)

	for (const index of used) {
		for (let y = 0; y < previewHeight; y++) {
			await readers[index].read(row, y * step, 1)
			for (let x = 0, i = y * previewWidth; x < previewWidth; x++, i++) planes[index].raw[i] = row[x * step]
		}

		markValid(planes[index], pixels)
	}

	const counters = createCompositionCounters()
	mixChannelRows(planes, mix, pixels, rgb, rgbValid, counters)

	if (luminance && luminance.alpha > 0) {
		const samples = createLuminanceSamples(pixels)
		collectLuminanceSamples(samples, rgb, rgbValid, planes[luminance.source], pixels)
		blendLuminanceRows(rgb, rgbValid, planes[luminance.source], solveLuminanceMatch(samples, luminance.match), luminance.alpha, pixels, counters)
	}

	for (let i = 0; i < rgb.length; i++) rgb[i] = Number.isFinite(rgb[i]) ? Math.min(1, Math.max(0, rgb[i])) : 0
	const image: Image = { header: {}, metadata: { width: previewWidth, height: previewHeight, channels: 3, stride: previewWidth * 3, pixelCount: pixels, strideInBytes: previewWidth * 12, pixelSizeInBytes: 4, bitpix: -32, bayer: undefined }, raw: rgb }
	const [midtone, shadow, highlight] = autoStf(image, 'medium')
	const jpeg = writeImageToFormat(stf(image, midtone, shadow, highlight), 'jpeg', { jpeg: { quality: PREVIEW_QUALITY } })
	if (!jpeg) throw new CompositionError('The preview could not be encoded')
	return new Uint8Array(jpeg)
}

// Worker thread of a composition. `unref` is a Bun extension that the DOM Worker type lacks.
type CompositionWorker = Worker & Pick<Bun.Worker, 'unref'>

// Starts a composition worker; injectable so tests can observe its lifecycle.
export type CompositionWorkerFactory = () => CompositionWorker

// Starts the worker of Image Stacking. Inside the executable the embedded path comes from NEBULOSA_IMAGESTACKING_WORKER.
function startCompositionWorker() {
	const worker = new Worker(process.env.NEBULOSA_IMAGESTACKING_WORKER ?? new URL('./imagestacking.worker.ts', import.meta.url)) as CompositionWorker
	worker.unref()
	return worker
}

// Client of the composition worker. Each composition and preview has a worker of its own, terminated when it ends or is
// aborted; a composition that stops reporting is terminated too.
export class StackingCompositor implements FrameCompositor {
	// Creates the client; tests inject a worker factory or a shorter stall timeout.
	constructor(
		readonly startWorker: CompositionWorkerFactory = startCompositionWorker,
		readonly stallTimeout: number = COMPOSITION_STALL_TIMEOUT,
	) {}

	// Runs a request of a mode on a worker until it answers. Rejects with an Error, or with the reason of the signal.
	async #run<T>(message: { readonly jobId: string; readonly mode: 'compose' | 'preview' }, signal: AbortSignal, onProgress: (progress: CompositionProgress) => void, answer: (response: CompositionWorkerResponse) => T | undefined): Promise<T> {
		signal.throwIfAborted()
		const worker = this.startWorker()
		const { promise, resolve, reject } = Promise.withResolvers<T>()
		let timer: Timer | undefined

		const watch = () => {
			clearTimeout(timer)
			timer = setTimeout(() => reject(new Error('The composition stopped reporting progress')), this.stallTimeout)
			timer.unref()
		}

		const onMessage = ({ data }: MessageEvent<CompositionWorkerResponse>) => {
			if (data.jobId !== message.jobId) return
			watch()

			if (data.status === 'progress') onProgress(data.progress)
			else if (data.status === 'failed') reject(new Error(data.error))
			else {
				const value = answer(data)
				if (value !== undefined) resolve(value)
			}
		}

		const onError = (event: ErrorEvent) => reject(new Error(event.message || 'The composition worker failed'))
		const onAbort = () => reject(signal.reason)

		worker.addEventListener('message', onMessage)
		worker.addEventListener('error', onError)
		signal.addEventListener('abort', onAbort, { once: true })
		watch()

		try {
			worker.postMessage(message, [])
			return await promise
		} finally {
			clearTimeout(timer)
			signal.removeEventListener('abort', onAbort)
			worker.removeEventListener('message', onMessage)
			worker.removeEventListener('error', onError)
			worker.terminate()
		}
	}

	// Composes a composite on a worker.
	compose(request: CompositionWorkerRequest, onProgress: (progress: CompositionProgress) => void, signal: AbortSignal) {
		return this.#run({ ...request, mode: 'compose' }, signal, onProgress, (response) => (response.status === 'composed' ? response.image : undefined))
	}

	// Previews a composition on a worker.
	preview(request: PreviewWorkerRequest, signal: AbortSignal) {
		return this.#run(
			{ ...request, mode: 'preview' },
			signal,
			() => undefined,
			(response) => (response.status === 'previewed' ? response.jpeg : undefined),
		)
	}
}
