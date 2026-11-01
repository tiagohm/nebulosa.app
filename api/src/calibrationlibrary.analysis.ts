import { mkdir, open, rm, stat } from 'fs/promises'
import { extname, join } from 'path'
import { readImageFromFits, readImageFromXisf } from 'nebulosa/src/imaging/model/image'
import type { ImageRawType } from 'nebulosa/src/imaging/model/types'
import { CalibrationPlaneLevels, calibrationPlane, calibrationPlaneCount, type CalibrationPlaneLevel, createCalibrationIntegrationDiagnostics, divideCalibrationPlanes, effectiveCalibrationCombination, integrateCalibrationRows, subtractCalibrationRows } from 'nebulosa/src/imaging/processing/calibration.integration'
import { fileHandleSink, fileHandleSource } from 'nebulosa/src/io/file'
import { type FitsHdu, type FitsHeader, FitsImageReader, FitsImageRowWriter, readFits } from 'nebulosa/src/io/formats/fits/fits'
import { type FitsProvenanceFields, writeFitsProvenance } from 'nebulosa/src/io/formats/fits/provenance'
import { cfaPatternKeyword, uncompressedBitpixKeyword, uncompressedHeightKeyword, uncompressedNumberOfChannelsKeyword, uncompressedWidthKeyword } from 'nebulosa/src/io/formats/fits/util'
import { readXisf } from 'nebulosa/src/io/formats/xisf/xisf'
import { type CalibrationKind, type CalibrationMetadata, type CalibrationRecipe, RECOMMENDED_FRAMES } from './calibrationlibrary.compatibility'
import { digitalFullScale } from './calibrationlibrary.sources'
import { type CalibrationMasterDiagnostics, MASTER_FILE, type MasterPlaneDiagnostics } from './calibrationlibrary.store'
import { precisionOf } from './images'

// Integration of a master from files, on a worker of its own (`calibrationlibrary.worker.ts`), and the client of that
// worker. Frames are read in digital numbers, rows at a time, so a stack costs one strip per frame and never a full image
// per frame; a file with no addressable rows is decoded once into a raw spill file in the staging directory, which costs
// disk instead. A dark, bias, or dark-flat is combined and written as it is, in DN. A flat is first corrected and measured
// frame by frame, then each frame is normalized plane by plane and combined, and finally normalized to unity per plane.
// Numerics belong to the toolkit; this module only moves rows. Files are only read, and everything written stays in the
// staging directory of the job: an interrupted worker leaves no product behind.

// Default memory for the row buffers of one job, in bytes.
export const DEFAULT_MEMORY_BUDGET = 256 * 1024 * 1024

// Time a job may go without reporting progress, in milliseconds, before its worker is terminated. Every frame and strip
// reports, so only a stalled disk or a dead worker takes this long.
export const INTEGRATION_STALL_TIMEOUT = 120000

// Fraction of full scale a flat plane may reach before the frame is saturated enough to be nonlinear.
const SATURATED_FLAT_LEVEL = 0.95

// Smallest corrected level of a flat plane, in DN: below it the division is mostly noise.
const MINIMUM_FLAT_LEVEL = 32

// Smallest response of a normalized flat with meaning; a deep dust shadow stays well above it, and a dead pixel does not.
const MINIMUM_FLAT_RESPONSE = 0.01

// Largest share of invalid response pixels of a usable flat.
const MAXIMUM_INVALID_RESPONSE_FRACTION = 0.001

// Robust standard deviations above a plane that make a hot pixel.
const HOT_PIXEL_SIGMAS = 5

// Stable code of a failed integration.
export type IntegrationErrorCode = 'sourceMissing' | 'sourceChanged' | 'unsupportedFormat' | 'incompatibleFrames' | 'insufficientFrames' | 'invalidFlatSignal' | 'processingFailed'

// A failure of an integration with its stable code.
export class IntegrationError extends Error {
	constructor(
		readonly code: IntegrationErrorCode,
		message: string,
	) {
		super(message)
	}
}

// One frame of an integration.
export interface IntegrationFrame {
	// Id of the frame in the library.
	readonly sourceId: string
	// Absolute path; it is only read.
	readonly path: string
	// Size and modification time the request saw, compared before the first read.
	readonly bytes: number
	readonly mtimeMillis: number
}

// Request to the integration worker.
export interface MasterWorkerRequest {
	// Id of the job, echoed by every response.
	readonly jobId: string
	// Role of the master.
	readonly kind: CalibrationKind
	// Frames, in integration order.
	readonly frames: readonly IntegrationFrame[]
	// How samples are combined.
	readonly recipe: CalibrationRecipe
	// Master subtracted from every flat, in DN.
	readonly correction?: string
	// Directory of the staged work; the product goes to its product subdirectory.
	readonly staging: string
	// Header of the master, without structural keywords.
	readonly header: FitsHeader
	// Memory for the row buffers, in bytes.
	readonly memoryBudget: number
}

// Progress of an integration. Counts only grow.
export interface IntegrationProgress {
	// Frames whose identity and geometry were verified.
	readonly framesValidated: number
	// Rows combined, and the total.
	readonly rowsCombined: number
	readonly rowsTotal: number
	// Bytes of master written.
	readonly bytesWritten: number
}

// What an integration leaves in the staging directory.
export interface IntegrationResult {
	// SHA-256 of each frame, in request order.
	readonly digests: readonly string[]
	// SHA-256 and size of the master.
	readonly contentDigest: string
	readonly bytes: number
	// Digital full scale of the frames.
	readonly fullScale: number
	// Evidence of the integration.
	readonly diagnostics: CalibrationMasterDiagnostics
}

// Response of the integration worker.
export type MasterWorkerResponse =
	| { readonly jobId: string; readonly status: 'progress'; readonly progress: IntegrationProgress }
	| { readonly jobId: string; readonly status: 'finished'; readonly result: IntegrationResult }
	| { readonly jobId: string; readonly status: 'failed'; readonly code: IntegrationErrorCode; readonly error: string }

// Worker thread of an integration. `unref` is a Bun extension that the DOM Worker type lacks.
type IntegrationWorker = Worker & Pick<Bun.Worker, 'unref'>

// Starts an integration worker; injectable so tests can observe its lifecycle.
export type IntegrationWorkerFactory = () => IntegrationWorker

// Sample format of a raw spill file.
interface FrameLayout {
	// Image size, in pixels, and channels per pixel.
	readonly width: number
	readonly height: number
	readonly channels: number
	// BITPIX of the file.
	readonly bitpix: number
	// CFA pattern; absent otherwise.
	readonly cfa?: string
}

// Reads rows of one channel of a frame in digital numbers.
interface RowReader {
	// Fills the start of `output` with width * rows samples. Throws when the file ends early.
	readonly read: (output: ImageRawType, startRow: number, rows: number, channel: number) => Promise<void>
}

// Returns the layout of a parsed header.
function layoutOf(hdu: FitsHdu): FrameLayout {
	const { header } = hdu
	return { width: uncompressedWidthKeyword(header, 0), height: uncompressedHeightKeyword(header, 0), channels: uncompressedNumberOfChannelsKeyword(header, 1), bitpix: uncompressedBitpixKeyword(header, 0), cfa: cfaPatternKeyword(header) || undefined }
}

// Returns the first image HDU of a parsed file.
async function firstImage(path: string) {
	await using source = fileHandleSource(await open(path, 'r'))
	const fits = await readFits(source)
	const hdu = fits?.hdus.find((candidate) => uncompressedWidthKeyword(candidate.header, 0) > 0)
	if (!hdu) throw new IntegrationError('unsupportedFormat', 'A file holds no FITS image')
	return hdu
}

// Opens rows of an uncompressed FITS image, which stay on disk until read. The file is opened per read, so a stack of
// thousands of frames holds no file open between strips.
function fitsRows(path: string, hdu: FitsHdu): RowReader {
	const reader = new FitsImageReader(hdu)

	return {
		async read(output, startRow, rows, channel) {
			await using source = fileHandleSource(await open(path, 'r'))
			if (!(await reader.readRows(source, output, startRow, rows, channel, 'digital'))) throw new IntegrationError('sourceChanged', 'A file ended before its last row')
		},
	}
}

// Opens rows of a raw spill file of native-endian samples of the given precision, planar by channel. Rows arrive in the
// precision of `output`, which a flat widens to compute in signed doubles.
function spillRows(path: string, layout: FrameLayout, precision: 32 | 64): RowReader {
	const bytes = precision / 8

	return {
		async read(output, startRow, rows, channel) {
			const handle = await open(path, 'r')

			try {
				const samples = layout.width * rows
				const scratch = precision === 64 ? new Float64Array(samples) : new Float32Array(samples)
				const { bytesRead } = await handle.read(Buffer.from(scratch.buffer), 0, scratch.byteLength, (channel * layout.height + startRow) * layout.width * bytes)
				if (bytesRead !== scratch.byteLength) throw new IntegrationError('processingFailed', 'A spill file ended early')
				output.set(scratch)
			} finally {
				await handle.close()
			}
		},
	}
}

// Decodes a file with no addressable rows into a spill file, one frame in memory at a time, and returns its layout.
async function spillFrame(path: string, spill: string): Promise<FrameLayout & { readonly precision: 32 | 64 }> {
	await using source = fileHandleSource(await open(path, 'r'))
	const xisf = extname(path).toLowerCase() === '.xisf'
	const parsed = xisf ? await readXisf(source) : undefined
	const fits = xisf ? undefined : await readFits(source)
	if (xisf ? !parsed?.images.length : !fits) throw new IntegrationError('unsupportedFormat', 'A file holds no readable image')

	const header = xisf ? parsed!.images[0].header : fits!.hdus.find((hdu) => uncompressedWidthKeyword(hdu.header, 0) > 0)?.header
	const precision = precisionOf(header ? uncompressedBitpixKeyword(header, 0) : 0)
	const image = xisf ? await readImageFromXisf(parsed!, source, { sampleScale: 'digital', raw: precision }) : await readImageFromFits(fits!, source, { sampleScale: 'digital', raw: precision })
	if (!image) throw new IntegrationError('unsupportedFormat', 'A file holds no readable image')

	const { width, height, channels, bayer, bitpix } = image.metadata
	const samples = width * height
	const planar = precision === 64 ? new Float64Array(samples) : new Float32Array(samples)
	const sink = await open(spill, 'wx')

	try {
		for (let channel = 0; channel < channels; channel++) {
			for (let i = 0, j = channel; i < samples; i++, j += channels) planar[i] = image.raw[j]
			await sink.appendFile(Buffer.from(planar.buffer))
		}
	} finally {
		await sink.close()
	}

	return { width, height, channels, bitpix, cfa: bayer, precision }
}

// Returns the SHA-256 of a file, streamed.
async function fileDigest(path: string) {
	const hasher = new Bun.CryptoHasher('sha256')
	for await (const chunk of Bun.file(path).stream()) hasher.update(chunk)
	return hasher.digest('hex')
}

// Writes a master header with its structure. Nothing of a source header is copied, so no stale scaling or compression
// keyword can reach a floating-point file.
function masterFileHeader(layout: FrameLayout, header: FitsHeader, bitpix: -32 | -64): FitsHeader {
	return { SIMPLE: true, BITPIX: bitpix, NAXIS: layout.channels > 1 ? 3 : 2, NAXIS1: layout.width, NAXIS2: layout.height, ...(layout.channels > 1 && { NAXIS3: layout.channels }), ...header }
}

// Builds the descriptive header of a master from its metadata: only what is known and true, and types a viewer or another
// program can read. The manifest next to it holds everything else. CALSTAT marks what a calibrated flat already had removed.
export function masterHeader(kind: CalibrationKind, metadata: CalibrationMetadata, frames: number, units: 'DN' | 'dimensionless', correction?: 'bias' | 'darkFlat'): FitsHeader {
	const provenance: FitsProvenanceFields = {
		instrument: metadata.cameraName,
		telescope: metadata.telescope.value,
		software: 'Nebulosa',
		filter: metadata.filter.value,
		frameType: kind,
		master: true,
		binning: metadata.binX.value === undefined || metadata.binY.value === undefined ? undefined : [metadata.binX.value, metadata.binY.value],
		sensorTemperature: metadata.sensorTemperature.value,
		setTemperature: metadata.setTemperature.value,
		gain: metadata.gain.value,
		offset: metadata.offset.value,
		readoutMode: metadata.readoutMode.value,
		calibration: correction === undefined ? undefined : [correction === 'bias' ? 'bias' : 'dark'],
	}

	const header: FitsHeader = {}
	writeFitsProvenance(header, provenance)
	header.NCOMBINE = frames
	if (units === 'DN') header.BUNIT = 'DN'
	if (metadata.exposure.value !== undefined && kind !== 'flat') header.EXPTIME = metadata.exposure.value / 1000000
	if (metadata.focalLength.value !== undefined) header.FOCALLEN = metadata.focalLength.value
	if (metadata.cfa !== undefined) header.BAYERPAT = metadata.cfa
	if (metadata.bayerOffsetX !== undefined) header.XBAYROFF = metadata.bayerOffsetX
	if (metadata.bayerOffsetY !== undefined) header.YBAYROFF = metadata.bayerOffsetY
	if (metadata.originX !== undefined) header.XORGSUBF = metadata.originX
	if (metadata.originY !== undefined) header.YORGSUBF = metadata.originY
	header.HISTORY = `Calibration master of ${frames} frames; manifest.json holds its recipe and provenance`

	for (const key of Object.keys(header)) if (header[key] === undefined) delete header[key]
	return header
}

// Strips of rows fitting the memory budget: at least one row, at most the image.
function stripHeight(budget: number, frames: number, width: number, bytes: number, height: number) {
	return Math.max(1, Math.min(height, Math.floor(budget / ((frames + 1) * width * bytes))))
}

// Reports validated frames, and verifies each file before the first pixel is read: the file the request saw, with the
// geometry of the first. Returns a reader of each frame and their digests. Files without addressable rows are spilled.
async function openFrames(request: MasterWorkerRequest, report: (framesValidated: number) => void) {
	const { frames, staging } = request
	const readers: RowReader[] = []
	const digests: string[] = []
	let layout: FrameLayout | undefined

	await mkdir(join(staging, 'spill'), { recursive: true })

	for (let index = 0; index < frames.length; index++) {
		const { path, bytes, mtimeMillis } = frames[index]
		const info = await stat(path).catch(() => undefined)
		if (!info) throw new IntegrationError('sourceMissing', `A frame is missing: ${path}`)
		if (info.size !== bytes || info.mtimeMs !== mtimeMillis) throw new IntegrationError('sourceChanged', `A frame changed: ${path}`)

		let frameLayout: FrameLayout

		if (extname(path).toLowerCase() === '.xisf') {
			const spill = join(staging, 'spill', `${index}.raw`)
			const spilled = await spillFrame(path, spill)
			frameLayout = spilled
			readers.push(spillRows(spill, spilled, spilled.precision))
		} else {
			const hdu = await firstImage(path)
			frameLayout = layoutOf(hdu)

			if (new FitsImageReader(hdu).rowAddressable) {
				readers.push(fitsRows(path, hdu))
			} else {
				const spill = join(staging, 'spill', `${index}.raw`)
				const spilled = await spillFrame(path, spill)
				readers.push(spillRows(spill, spilled, spilled.precision))
			}
		}

		layout ??= frameLayout
		if (frameLayout.width !== layout.width || frameLayout.height !== layout.height || frameLayout.channels !== layout.channels || frameLayout.bitpix !== layout.bitpix || frameLayout.cfa !== layout.cfa) throw new IntegrationError('incompatibleFrames', `A frame has other samples than the first: ${path}`)

		digests.push(await fileDigest(path))
		report(index + 1)
	}

	if (!layout) throw new IntegrationError('insufficientFrames', 'A master needs at least one frame')
	return { readers, digests, layout }
}

// Combined rows go here as they are computed.
type RowWriter = (samples: ImageRawType, count: number) => Promise<void>

// Reports rows combined.
type RowReporter = (rows: number) => void

// Combines strips of every frame, in file order, into `write`. `prepare` turns the rows of one frame into what is
// combined. Returns the diagnostics of the toolkit.
async function combineFrames(
	readers: readonly RowReader[],
	layout: FrameLayout,
	recipe: CalibrationRecipe,
	scaleFloor: number,
	strip: number,
	precision: 32 | 64,
	write: RowWriter,
	report: RowReporter,
	prepare?: (frame: number, samples: ImageRawType, startRow: number, rows: number, channel: number) => void | Promise<void>,
) {
	const { width, height, channels } = layout
	const stripSamples = width * strip
	const buffers = readers.map(() => (precision === 64 ? new Float64Array(stripSamples) : new Float32Array(stripSamples)))
	const output = precision === 64 ? new Float64Array(stripSamples) : new Float32Array(stripSamples)
	const diagnostics = createCalibrationIntegrationDiagnostics(readers.length)
	const minimumSamples = Math.max(1, Math.ceil(readers.length / 2))

	for (let channel = 0; channel < channels; channel++) {
		for (let startRow = 0; startRow < height; startRow += strip) {
			const rows = Math.min(strip, height - startRow)
			const count = width * rows

			for (let frame = 0; frame < readers.length; frame++) {
				await readers[frame].read(buffers[frame], startRow, rows, channel)
				await prepare?.(frame, buffers[frame], startRow, rows, channel)
			}

			integrateCalibrationRows(buffers, count, output, { method: recipe.method, sigmaLow: recipe.sigmaLow, sigmaHigh: recipe.sigmaHigh, maxIterations: recipe.maxIterations, scaleFloor, minimumSamples }, diagnostics)
			await write(output, count)
			report(rows)
		}
	}

	if (diagnostics.undersampled > 0) throw new IntegrationError('insufficientFrames', `${diagnostics.undersampled} samples kept too few finite values`)
	return diagnostics
}

// Summarizes the toolkit's diagnostics for a manifest.
function integrationDiagnostics(request: MasterWorkerRequest, frames: number, diagnostics: ReturnType<typeof createCalibrationIntegrationDiagnostics>, planes: readonly MasterPlaneDiagnostics[], extra: Partial<CalibrationMasterDiagnostics>): CalibrationMasterDiagnostics {
	return {
		requestedFrames: request.frames.length,
		integratedFrames: frames,
		method: effectiveCalibrationCombination(request.recipe.method, frames),
		lowSampleCount: frames < RECOMMENDED_FRAMES,
		rejectedLow: diagnostics.rejectedLow,
		rejectedHigh: diagnostics.rejectedHigh,
		nonFinite: diagnostics.nonFinite,
		clipLimited: diagnostics.clipLimited,
		rejectedPerFrame: Array.from(diagnostics.rejectedPerFrame, (count) => (diagnostics.samples > 0 ? count / diagnostics.samples : 0)),
		planes,
		...extra,
	}
}

// Numbers each plane level.
function planeDiagnostics(levels: readonly CalibrationPlaneLevel[]): MasterPlaneDiagnostics[] {
	return levels.map(({ median, sigma }, plane) => ({ plane, median, sigma }))
}

// Reads back a written master: it must be the declared image, and its samples finite where they should be. Counts its
// hot pixels above each plane, and hashes the file. A truncated write cannot get past this point.
async function verifyMaster(path: string, layout: FrameLayout, levels: readonly CalibrationPlaneLevel[], mosaic: boolean, strip: number) {
	const hdu = await firstImage(path)
	const reader = fitsRows(path, hdu)
	const samples = new Float64Array(layout.width * strip)
	let hotPixels = 0

	for (let channel = 0; channel < layout.channels; channel++) {
		for (let startRow = 0; startRow < layout.height; startRow += strip) {
			const rows = Math.min(strip, layout.height - startRow)
			await reader.read(samples, startRow, rows, channel)

			for (let row = 0, i = 0; row < rows; row++) {
				const y = startRow + row

				for (let x = 0; x < layout.width; x++, i++) {
					const { median, sigma } = levels[calibrationPlane(x, y, mosaic, channel)]
					if (samples[i] > median + HOT_PIXEL_SIGMAS * sigma) hotPixels++
				}
			}
		}
	}

	return { hotPixels, contentDigest: await fileDigest(path), bytes: (await stat(path)).size }
}

// Integrates a master with no normalization: the pedestal, the glow, and the hot pixels of a dark are the product.
async function integrateRaw(request: MasterWorkerRequest, readers: readonly RowReader[], layout: FrameLayout, progress: (patch: Partial<IntegrationProgress>) => void): Promise<Pick<IntegrationResult, 'contentDigest' | 'bytes' | 'diagnostics'>> {
	const { width, height, channels } = layout
	const precision = precisionOf(layout.bitpix)
	const strip = stripHeight(request.memoryBudget, readers.length, width, precision / 8, height)
	const output = join(request.staging, 'product', MASTER_FILE)
	const mosaic = layout.cfa !== undefined
	const levels = new CalibrationPlaneLevels(calibrationPlaneCount(mosaic, channels), width * height, mosaic)
	await mkdir(join(request.staging, 'product'), { recursive: true })

	let rowsCombined = 0
	let bytesWritten = 0
	const handle = await open(output, 'wx')
	let diagnostics

	try {
		const writer = new FitsImageRowWriter(fileHandleSink(handle), masterFileHeader(layout, request.header, precision === 64 ? -64 : -32))
		await writer.begin()
		let row = 0
		let channel = 0

		diagnostics = await combineFrames(
			readers,
			layout,
			request.recipe,
			1,
			strip,
			precision,
			async (samples, count) => {
				levels.push(samples, width, count / width, row, channel)
				await writer.write(samples, count)
				bytesWritten += (count * precision) / 8
				row += count / width

				if (row >= height) {
					row = 0
					channel++
				}
			},
			(rows) => {
				rowsCombined += rows
				progress({ rowsCombined, bytesWritten })
			},
		)

		await writer.end()
		await handle.sync()
	} finally {
		await handle.close()
	}

	const planes = levels.levels()
	const { hotPixels, contentDigest, bytes } = await verifyMaster(output, layout, planes, mosaic, strip)
	return { contentDigest, bytes, diagnostics: integrationDiagnostics(request, readers.length, diagnostics, planeDiagnostics(planes), { hotPixels }) }
}

// Measures every corrected flat, and leaves out what cannot be normalized: a plane so bright it is nonlinear, or so dim
// its division is noise. Returns the levels of the frames kept, in the order of `readers`.
async function measureFlats(request: MasterWorkerRequest, readers: readonly RowReader[], layout: FrameLayout, correction: RowReader, fullScale: number, strip: number) {
	const { width, height, channels } = layout
	const mosaic = layout.cfa !== undefined
	const planes = calibrationPlaneCount(mosaic, channels)
	const samples = new Float64Array(width * strip)
	const dark = new Float64Array(width * strip)
	const kept: { readonly frame: number; readonly levels: readonly number[] }[] = []
	const excluded: { readonly sourceId: string; readonly reason: string }[] = []

	for (let frame = 0; frame < readers.length; frame++) {
		const levels = new CalibrationPlaneLevels(planes, width * height, mosaic)

		for (let channel = 0; channel < channels; channel++) {
			for (let startRow = 0; startRow < height; startRow += strip) {
				const rows = Math.min(strip, height - startRow)
				await readers[frame].read(samples, startRow, rows, channel)
				await correction.read(dark, startRow, rows, channel)
				subtractCalibrationRows(samples, dark, width * rows)
				levels.push(samples, width, rows, startRow, channel)
			}
		}

		const medians = levels.levels().map(({ median }) => median)

		if (medians.some((median) => !(median < SATURATED_FLAT_LEVEL * fullScale))) excluded.push({ sourceId: request.frames[frame].sourceId, reason: 'A plane is close to saturation' })
		else if (medians.some((median) => !(median > MINIMUM_FLAT_LEVEL))) excluded.push({ sourceId: request.frames[frame].sourceId, reason: 'A plane has too little signal after the correction' })
		else kept.push({ frame, levels: medians })
	}

	return { kept, excluded }
}

// Integrates a calibrated normalized flat. Each frame is corrected in signed values and divided by its own plane levels,
// which removes the drift of the light source and keeps vignetting and dust; the combination then runs over dimensionless
// values, with a rejection floor of one DN of the dimmest frame. The result is measured, then divided by its own plane
// medians on the way to the file, so each plane of the master has a median of 1.
async function integrateFlat(request: MasterWorkerRequest, readers: readonly RowReader[], layout: FrameLayout, fullScale: number, progress: (patch: Partial<IntegrationProgress>) => void): Promise<Pick<IntegrationResult, 'contentDigest' | 'bytes' | 'diagnostics'>> {
	if (!request.correction) throw new IntegrationError('invalidFlatSignal', 'A flat needs a correction master')

	const { width, height, channels } = layout
	const mosaic = layout.cfa !== undefined
	const planes = calibrationPlaneCount(mosaic, channels)
	const strip = stripHeight(request.memoryBudget, readers.length + 1, width, 8, height)
	const correctionHdu = await firstImage(request.correction)
	const correction = fitsRows(request.correction, correctionHdu)
	const { kept, excluded } = await measureFlats(request, readers, layout, correction, fullScale, strip)
	if (kept.length === 0) throw new IntegrationError('invalidFlatSignal', 'No flat has a usable signal after the correction')

	await mkdir(join(request.staging, 'product'), { recursive: true })
	const combined = join(request.staging, 'spill', 'combined.raw')
	const dark = new Float64Array(width * strip)
	const dimmest = Math.min(...kept.flatMap(({ levels }) => levels))
	const levels = new CalibrationPlaneLevels(planes, width * height, mosaic)
	let rowsCombined = 0
	let row = 0
	let channelWritten = 0
	let diagnostics
	const spill = await open(combined, 'wx')

	try {
		diagnostics = await combineFrames(
			kept.map(({ frame }) => readers[frame]),
			layout,
			request.recipe,
			1 / dimmest,
			strip,
			64,
			async (samples, count) => {
				levels.push(samples, width, count / width, row, channelWritten)
				await spill.appendFile(Buffer.from(samples.buffer, samples.byteOffset, count * 8))
				row += count / width

				if (row >= height) {
					row = 0
					channelWritten++
				}
			},
			(rows) => {
				rowsCombined += rows
				progress({ rowsCombined })
			},
			async (frame, samples, startRow, rows, channel) => {
				await correction.read(dark, startRow, rows, channel)
				subtractCalibrationRows(samples, dark, width * rows)
				divideCalibrationPlanes(samples, width, rows, startRow, kept[frame].levels, mosaic, channel)
			},
		)
	} finally {
		await spill.close()
	}

	const measured = levels.levels()
	const unity = measured.map(({ median }) => median)
	const reader = spillRows(combined, layout, 64)
	const output = join(request.staging, 'product', MASTER_FILE)
	const samples = new Float64Array(width * strip)
	const handle = await open(output, 'wx')
	let invalidResponsePixels = 0

	try {
		const writer = new FitsImageRowWriter(fileHandleSink(handle), masterFileHeader(layout, request.header, -32))
		await writer.begin()

		for (let channel = 0; channel < channels; channel++) {
			for (let startRow = 0; startRow < height; startRow += strip) {
				const rows = Math.min(strip, height - startRow)
				const count = width * rows
				await reader.read(samples, startRow, rows, channel)
				divideCalibrationPlanes(samples, width, rows, startRow, unity, mosaic, channel)
				for (let i = 0; i < count; i++) if (!(samples[i] > MINIMUM_FLAT_RESPONSE) || !Number.isFinite(samples[i])) invalidResponsePixels++
				await writer.write(samples, count)
			}
		}

		await writer.end()
		await handle.sync()
	} finally {
		await handle.close()
	}

	if (invalidResponsePixels > MAXIMUM_INVALID_RESPONSE_FRACTION * width * height * channels) throw new IntegrationError('invalidFlatSignal', `${invalidResponsePixels} pixels have no valid response`)

	const { contentDigest, bytes } = await verifyMaster(
		output,
		layout,
		measured.map(({ sigma }) => ({ median: 1, sigma: Number.POSITIVE_INFINITY })),
		mosaic,
		strip,
	)
	return { contentDigest, bytes, diagnostics: integrationDiagnostics(request, kept.length, diagnostics, planeDiagnostics(measured), { invalidResponsePixels, excludedFrames: excluded }) }
}

// Integrates a master into the product subdirectory of the staging directory and removes the spill files. Reports progress
// after every frame and strip. Throws IntegrationError. Sources are only read.
export async function integrateMaster(request: MasterWorkerRequest, report: (progress: IntegrationProgress) => void): Promise<IntegrationResult> {
	let current: IntegrationProgress = { framesValidated: 0, rowsCombined: 0, rowsTotal: 0, bytesWritten: 0 }

	function progress(patch: Partial<IntegrationProgress>) {
		current = { ...current, ...patch }
		report(current)
	}

	const { readers, digests, layout } = await openFrames(request, (framesValidated) => progress({ framesValidated }))
	const fullScale = digitalFullScale(layout.bitpix)
	progress({ rowsTotal: layout.height * layout.channels })

	const product = request.kind === 'flat' ? await integrateFlat(request, readers, layout, fullScale, progress) : await integrateRaw(request, readers, layout, progress)
	await rm(join(request.staging, 'spill'), { recursive: true, force: true })
	return { digests, fullScale, ...product }
}

// Starts an integration worker. Inside the executable the embedded path comes from NEBULOSA_CALIBRATION_WORKER.
function startIntegrationWorker() {
	const worker = new Worker(process.env.NEBULOSA_CALIBRATION_WORKER ?? new URL('./calibrationlibrary.worker.ts', import.meta.url)) as IntegrationWorker
	worker.unref()
	return worker
}

// Client of the integration worker. Each job has a worker of its own, so nothing a job allocated outlives it. There is no
// timeout on a job, which can last hours on a large stack; a worker that stops reporting is terminated instead.
export class MasterIntegrator {
	// Creates the client; tests inject a worker factory or a shorter stall timeout.
	constructor(
		readonly startWorker: IntegrationWorkerFactory = startIntegrationWorker,
		readonly stallTimeout: number = INTEGRATION_STALL_TIMEOUT,
	) {}

	// Runs an integration on a worker until it ends. Aborting the signal terminates the worker at once. Rejects with
	// IntegrationError, or with the reason of the signal.
	async integrate(request: MasterWorkerRequest, onProgress: (progress: IntegrationProgress) => void, signal: AbortSignal): Promise<IntegrationResult> {
		signal.throwIfAborted()
		const worker = this.startWorker()
		const { promise, resolve, reject } = Promise.withResolvers<IntegrationResult>()
		let timer: Timer | undefined

		const watch = () => {
			clearTimeout(timer)
			timer = setTimeout(() => reject(new IntegrationError('processingFailed', 'The integration stopped reporting progress')), this.stallTimeout)
			timer.unref()
		}

		const onMessage = ({ data }: MessageEvent<MasterWorkerResponse>) => {
			if (data.jobId !== request.jobId) return

			if (data.status === 'progress') {
				watch()
				onProgress(data.progress)
			} else if (data.status === 'finished') {
				resolve(data.result)
			} else {
				reject(new IntegrationError(data.code, data.error))
			}
		}

		const onError = (event: ErrorEvent) => reject(new IntegrationError('processingFailed', event.message || 'The integration worker failed'))
		const onAbort = () => reject(signal.reason)

		worker.addEventListener('message', onMessage)
		worker.addEventListener('error', onError)
		signal.addEventListener('abort', onAbort, { once: true })
		watch()

		try {
			worker.postMessage(request, [])
			return await promise
		} finally {
			clearTimeout(timer)
			signal.removeEventListener('abort', onAbort)
			worker.removeEventListener('message', onMessage)
			worker.removeEventListener('error', onError)
			worker.terminate()
		}
	}
}
