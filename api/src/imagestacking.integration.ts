import { mkdir, open, rm, stat } from 'fs/promises'
import { join } from 'path'
import type { AffineTransform, SimilarityTransform } from 'nebulosa/src/astrometry/matching/star.matching'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { invalidFlatMask } from 'nebulosa/src/imaging/processing/calibration'
import { debayer } from 'nebulosa/src/imaging/processing/debayer'
import { applyGlobalNormalizationInPlace, broadcastNormalizationPlanes, solveGlobalNormalizationPlanes } from 'nebulosa/src/imaging/processing/normalization'
import { warpImage } from 'nebulosa/src/imaging/processing/registration'
import type { StackingCombinationMethod } from 'nebulosa/src/imaging/processing/stacker'
// oxfmt-ignore
import { accumulateSamples, type CombinationStripFrame, combineStrip, coverageThreshold, createCombinationScratch, finalizeOnlineSamples, isOnlineCombinationMethod, resolveCombinationParameters } from 'nebulosa/src/imaging/processing/stacking.combination'
import { fileHandleSink, fileHandleSource } from 'nebulosa/src/io/file'
import { type FitsHeader, FitsImageRowWriter, readFits } from 'nebulosa/src/io/formats/fits/fits'
import { type FitsProvenanceFields, writeFitsProvenance } from 'nebulosa/src/io/formats/fits/provenance'
import { uncompressedHeightKeyword, uncompressedNumberOfChannelsKeyword, uncompressedWidthKeyword } from 'nebulosa/src/io/formats/fits/util'
import { fileDigest } from './calibrationlibrary.analysis'
import type { CalibrationMetadata } from './calibrationlibrary.compatibility'
import { type AnalysisCalibration, calibrateLight, type CohortMasters, readCohortMasters, readDigital } from './imagestacking.analysis'
import { PRODUCT_COVERAGE_FILE, PRODUCT_MASTER_FILE, type StackingFrameNormalization, type StackingProductDiagnostics, type StackingRecipe } from './imagestacking.store'

// Integration of the light frames of filter groups into linear masters, on the worker of Image Stacking
// (`imagestacking.worker.ts`), and the client of that worker. Each frame is read in digital numbers, calibrated with the
// pinned masters of its cohort, debayered when it is a color mosaic, and resampled once onto the project grid through the
// transform the server composed from its registration; pixels whose flat is not usable are masked instead of passing
// uncorrected. Each frame is matched to the reference of its group, which comes first, on a nearest-neighbour resampling
// that keeps its noise as it is, and combined with its weight:
// online methods accumulate in memory, and rejection methods spill every frame to the staging directory and combine it
// in strips of rows that fit the memory budget. A master is never cropped: pixels covered by too few frames are NaN, and
// every master of a project shares its grid. Files are only read, and everything written stays in the staging directory
// of the run until the server publishes it.

// Version of the integration, part of the fingerprint of a product; a change integrates every group again.
export const INTEGRATION_VERSION = 2

// Default memory of one integration, in bytes.
export const DEFAULT_STACK_MEMORY_BUDGET = 2 * 1024 ** 3

// Time a run may go without reporting progress, in milliseconds, before its worker is terminated. Every frame and strip
// reports, so only a stalled disk or a dead worker takes this long.
export const INTEGRATION_STALL_TIMEOUT = 120000

// Bytes one frame holds per sample of the grid while it is integrated: the calibrated source and its masters, the
// debayered copy, the warped samples, and the reference of its group, in single precision. A planning estimate.
const FRAME_BYTES_PER_SAMPLE = 26

// Bytes a spilled frame keeps per sample of a strip: a Float32 sample and its validity byte.
const SPILLED_BYTES_PER_SAMPLE = 5

// Failure of one group, whose message is safe to show: it never holds a path.
export class IntegrationGroupError extends Error {}

// A frame to integrate.
export interface IntegrationFrame {
	// Id of the frame in its project.
	readonly sourceId: string
	// Absolute path; it is only read.
	readonly path: string
	// Size, in bytes, and modification time, Unix milliseconds, the analysis measured; another file is refused.
	readonly bytes: number
	readonly mtimeMillis: number
	// Cohort whose masters calibrate it.
	readonly cohortId: string
	// Transform from the project grid to the pixels of the frame, both zero-based with x right and y down.
	readonly inverse: SimilarityTransform | AffineTransform
	// Positive combination weight.
	readonly weight: number
}

// A filter group to integrate.
export interface IntegrationGroup {
	// Key of the group.
	readonly key: string
	// Frames, the reference of the group first: it is the photometric reference of the others.
	readonly frames: readonly IntegrationFrame[]
	// Descriptive header of the master, without structural keywords.
	readonly header: FitsHeader
	// Directory of the work of the group; the product goes to its product subdirectory.
	readonly staging: string
}

// Request to integrate filter groups.
export interface IntegrationWorkerRequest {
	// Id of the run, echoed by every response.
	readonly jobId: string
	// Project grid, in pixels.
	readonly width: number
	readonly height: number
	readonly groups: readonly IntegrationGroup[]
	// Masters of each cohort, by cohort id; a cohort absent here is not calibrated.
	readonly calibrations: Readonly<Record<string, AnalysisCalibration>>
	readonly recipe: StackingRecipe
	// Memory of the integration, in bytes.
	readonly memoryBudget: number
}

// Progress of the group being integrated. Counts only grow within a group.
export interface IntegrationProgress {
	// Key of the group.
	readonly group: string
	// Frames read, and rows combined of the total.
	readonly frames: number
	readonly rowsCombined: number
	readonly rowsTotal: number
}

// A master staged by the worker, for the server to publish.
export interface StagedProduct {
	// Key of the group.
	readonly group: string
	// Directory holding master.fit and coverage.fit.
	readonly directory: string
	// SHA-256 and size, in bytes, of both files.
	readonly contentDigest: string
	readonly bytes: number
	readonly coverageDigest: string
	readonly coverageBytes: number
	// Channels per pixel of the master.
	readonly channels: number
	readonly diagnostics: StackingProductDiagnostics
}

// Response of the worker to an integration.
export type IntegrationWorkerResponse =
	| { readonly jobId: string; readonly status: 'progress'; readonly progress: IntegrationProgress }
	| { readonly jobId: string; readonly status: 'staged'; readonly product: StagedProduct }
	| { readonly jobId: string; readonly status: 'groupFailed'; readonly group: string; readonly error: string }
	| { readonly jobId: string; readonly status: 'finished' }
	| { readonly jobId: string; readonly status: 'failed'; readonly error: string }

// What the client reports while integrating.
export interface IntegrationHandlers {
	readonly onProgress: (progress: IntegrationProgress) => void
	readonly onStaged: (product: StagedProduct) => void
	readonly onGroupFailed: (group: string, error: string) => void
}

// Integrates groups, reporting each one as it is staged; tests replace the worker with an in-thread integrator.
export interface FrameIntegrator {
	readonly integrate: (request: IntegrationWorkerRequest, handlers: IntegrationHandlers, signal: AbortSignal) => Promise<void>
}

// How a group is integrated within a memory budget.
export interface IntegrationPlan {
	// Kept in memory, or spilled to disk and combined in strips.
	readonly mode: 'online' | 'spill'
	// Rows of a strip when spilled; 0 when not even one row fits the budget.
	readonly stripRows: number
	// Memory it is estimated to need and disk it writes to staging, in bytes.
	readonly memoryBytes: number
	readonly diskBytes: number
	// Whether it fits the budget.
	readonly fits: boolean
}

// Plans the integration of `frames` frames of `channels` channels on a grid of width × height pixels with a method within
// `budget` bytes. Every size is a safe integer for any grid and frame count a disk can hold.
export function integrationPlan(width: number, height: number, channels: number, frames: number, method: StackingCombinationMethod, budget: number): IntegrationPlan {
	const pixels = width * height
	const frameBytes = pixels * channels * FRAME_BYTES_PER_SAMPLE

	if (isOnlineCombinationMethod(method)) {
		const memoryBytes = frameBytes + pixels * (channels * 8 + 12)
		return { mode: 'online', stripRows: height, memoryBytes, diskBytes: 0, fits: memoryBytes <= budget }
	}

	const coverageBytes = pixels * 4
	const rowBytes = width * (frames * SPILLED_BYTES_PER_SAMPLE + 4)
	const stripRows = Math.max(0, Math.min(height, Math.floor((budget - coverageBytes) / rowBytes)))
	const memoryBytes = coverageBytes + Math.max(frameBytes, Math.max(stripRows, 1) * rowBytes)
	const diskBytes = frames * pixels * (channels * 4 + 1)
	return { mode: 'spill', stripRows, memoryBytes, diskBytes, fits: stripRows >= 1 && memoryBytes <= budget }
}

// Builds the descriptive header of a master from the metadata of its first frame: only what is known and true. Its
// product in the project holds everything else. Exposure is written only when every frame had the same one.
export function productHeader(metadata: CalibrationMetadata, name: string, frames: number, exposure: { readonly each?: number; readonly total: number }, object?: string): FitsHeader {
	const provenance: FitsProvenanceFields = {
		instrument: metadata.cameraName,
		telescope: metadata.telescope.value,
		software: 'Nebulosa',
		filter: name,
		object,
		frameType: 'light',
		master: true,
		binning: metadata.binX.value === undefined || metadata.binY.value === undefined ? undefined : [metadata.binX.value, metadata.binY.value],
		gain: metadata.gain.value,
		offset: metadata.offset.value,
		readoutMode: metadata.readoutMode.value,
	}

	const header: FitsHeader = {}
	writeFitsProvenance(header, provenance)
	header.NCOMBINE = frames
	if (exposure.each !== undefined) header.EXPTIME = exposure.each
	header.TOTALEXP = exposure.total
	if (metadata.focalLength.value !== undefined) header.FOCALLEN = metadata.focalLength.value
	header.HISTORY = `Linear master of ${frames} light frames on the project grid; NaN marks pixels too few frames covered`

	for (const key of Object.keys(header)) if (header[key] === undefined) delete header[key]
	return header
}

// Returns an empty image of the project grid, which a warp only reads the geometry of.
function gridImage(width: number, height: number, channels: number): Image {
	return { header: {}, metadata: { width, height, channels, stride: width * channels, pixelCount: width * height, strideInBytes: width * channels * 4, pixelSizeInBytes: 4, bitpix: -32, bayer: undefined }, raw: new Float32Array(0) }
}

// Writes a Float32 image of planes, one whole channel after another, and returns its SHA-256 and size.
async function writePlanes(path: string, width: number, height: number, channels: number, header: FitsHeader, planes: (write: (samples: Float32Array, count: number) => Promise<void>) => Promise<void>) {
	const handle = await open(path, 'wx')

	try {
		const writer = new FitsImageRowWriter(fileHandleSink(handle), { SIMPLE: true, BITPIX: -32, NAXIS: channels > 1 ? 3 : 2, NAXIS1: width, NAXIS2: height, ...(channels > 1 && { NAXIS3: channels }), ...header })
		await writer.begin()
		await planes((samples, count) => writer.write(samples, count))
		await writer.end()
		await handle.sync()
	} finally {
		await handle.close()
	}

	return verifyImage(path, width, height, channels)
}

// Reads back the header of a written image: it must declare the grid it was written for. Returns its SHA-256 and size.
async function verifyImage(path: string, width: number, height: number, channels: number) {
	{
		await using source = fileHandleSource(await open(path, 'r'))
		const header = (await readFits(source))?.hdus[0]?.header
		if (!header || uncompressedWidthKeyword(header, 0) !== width || uncompressedHeightKeyword(header, 0) !== height || uncompressedNumberOfChannelsKeyword(header, 1) !== channels) throw new IntegrationGroupError('A master could not be read back')
	}

	return { digest: await fileDigest(path), bytes: (await stat(path)).size }
}

// Reads ranges of a spill file, each at its offset into its output, through one handle. The file is opened per strip, so
// a stack of thousands of frames holds no file open between strips.
async function readSpill(path: string, ranges: readonly (readonly [output: Uint8Array, offset: number])[]) {
	const handle = await open(path, 'r')

	try {
		for (const [output, offset] of ranges) {
			const { bytesRead } = await handle.read(output, 0, output.byteLength, offset)
			if (bytesRead !== output.byteLength) throw new IntegrationGroupError('A spill file ended early')
		}
	} finally {
		await handle.close()
	}
}

// Integrates one group into its staging directory and removes its spill files. Reports progress after every frame and
// strip. Throws IntegrationGroupError for what the operator can act on.
export async function integrateGroup(request: IntegrationWorkerRequest, group: IntegrationGroup, report: (progress: IntegrationProgress) => void): Promise<StagedProduct> {
	const { width, height, recipe } = request
	const pixels = width * height
	const product = join(group.staging, 'product')
	const spill = join(group.staging, 'spill')
	const online = isOnlineCombinationMethod(recipe.method)
	const normalization: StackingFrameNormalization[] = []
	const coverage = new Uint32Array(pixels)
	await mkdir(product, { recursive: true })
	if (!online) await mkdir(spill, { recursive: true })

	let channels = 0
	let warped = new Float32Array(0)
	let reference = new Float32Array(0)
	let sum = new Float64Array(0)
	let weightSum = new Float64Array(0)
	const valid = new Uint8Array(pixels)
	let grid: Image | undefined
	let cohort: string | undefined
	let masters: CohortMasters = {}
	let flatMask: Uint8Array | undefined
	let rowsTotal = 0

	for (const [index, frame] of group.frames.entries()) {
		const info = await stat(frame.path).catch(() => undefined)
		if (!info) throw new IntegrationGroupError('A frame is missing; check the files of the project')
		if (info.size !== frame.bytes || info.mtimeMs !== frame.mtimeMillis) throw new IntegrationGroupError('A frame changed since it was analyzed; analyze the project again')

		if (frame.cohortId !== cohort) {
			cohort = frame.cohortId
			masters = await readCohortMasters(request.calibrations[cohort]).catch(() => {
				throw new IntegrationGroupError('A pinned master could not be read')
			})
			flatMask = masters.flat && invalidFlatMask(masters.flat).mask
		}

		const light = calibrateLight(await readDigital(frame.path), masters)
		const image = light.metadata.bayer ? debayer(light) : light
		if (!image) throw new IntegrationGroupError('A color frame could not be debayered')

		if (!grid) {
			channels = image.metadata.channels
			grid = gridImage(width, height, channels)
			warped = new Float32Array(pixels * channels)
			rowsTotal = height * channels
			if (online) {
				sum = new Float64Array(pixels * channels)
				weightSum = new Float64Array(pixels)
			}
		} else if (image.metadata.channels !== channels) {
			throw new IntegrationGroupError('A frame has other channels than the reference of its group')
		}

		const rejectionMask = flatMask?.length === image.metadata.pixelCount ? flatMask : undefined
		const identity: StackingFrameNormalization = { sourceId: frame.sourceId, scales: new Array<number>(channels).fill(1), offsets: new Array<number>(channels).fill(0) }
		const normalized = recipe.normalization !== 'none'
		let matched = identity

		// The match to the reference is measured on a nearest-neighbour resampling, which keeps the samples of the frame as
		// they are: the interpolation of the recipe smooths their noise by an amount that depends on the subpixel phase of
		// each frame, which the dispersion of a frame dominated by the sky would read as a gain of up to half again.
		if (normalized) warpImage(image, grid, frame.inverse, { interpolationMode: 'nearest', outputRaw: warped, validityMask: valid, rejectionMask })

		if (index === 0 && normalized) {
			reference = Float32Array.from(warped)

			for (let pixel = 0; pixel < pixels; pixel++) {
				if (valid[pixel] !== 0) continue
				for (let channel = 0; channel < channels; channel++) reference[pixel * channels + channel] = Number.NaN
			}
		} else if (normalized) {
			matched = { sourceId: frame.sourceId, ...broadcastNormalizationPlanes(solveGlobalNormalizationPlanes(warped, valid, reference, channels, width, height, recipe.normalization, 'per-channel'), channels) }
		}

		if (!normalized || recipe.interpolation !== 'nearest') warpImage(image, grid, frame.inverse, { interpolationMode: recipe.interpolation, outputRaw: warped, validityMask: valid, rejectionMask })
		if (matched !== identity) applyGlobalNormalizationInPlace(warped, valid, channels, matched.scales, matched.offsets)
		normalization.push(matched)

		if (online) {
			accumulateSamples(channels, warped, valid, sum, weightSum, coverage, recipe.method, frame.weight)
		} else {
			for (let pixel = 0; pixel < pixels; pixel++) if (valid[pixel] !== 0) coverage[pixel]++
			const handle = await open(join(spill, `${index}.raw`), 'wx')

			try {
				const plane = new Float32Array(pixels)

				for (let channel = 0; channel < channels; channel++) {
					for (let pixel = 0, i = channel; pixel < pixels; pixel++, i += channels) plane[pixel] = warped[i]
					await handle.write(new Uint8Array(plane.buffer))
				}

				await handle.write(valid)
			} finally {
				await handle.close()
			}
		}

		report({ group: group.key, frames: index + 1, rowsCombined: 0, rowsTotal })
	}

	const frames = group.frames.length
	const threshold = coverageThreshold(frames, 'union', recipe.minimumCoverage)
	let coveredPixels = 0
	for (let pixel = 0; pixel < pixels; pixel++) if (coverage[pixel] >= threshold) coveredPixels++
	if (coveredPixels === 0) throw new IntegrationGroupError('No pixel is covered by enough frames; lower the minimum coverage')

	const plan = integrationPlan(width, height, channels, frames, recipe.method, request.memoryBudget)
	let rowsCombined = 0

	const master = await writePlanes(join(product, PRODUCT_MASTER_FILE), width, height, channels, group.header, async (write) => {
		if (online) {
			const out = new Float32Array(pixels * channels).fill(Number.NaN)
			finalizeOnlineSamples(sum, weightSum, coverage, channels, threshold, recipe.method, out)
			const plane = new Float32Array(pixels)

			for (let channel = 0; channel < channels; channel++) {
				for (let pixel = 0, i = channel; pixel < pixels; pixel++, i += channels) plane[pixel] = out[i]
				await write(plane, pixels)
				rowsCombined += height
				report({ group: group.key, frames, rowsCombined, rowsTotal })
			}

			return
		}

		const strip = Math.max(1, plan.stripRows)
		const parameters = resolveCombinationParameters({ sigmaClip: { sigmaLower: recipe.sigmaLower, sigmaUpper: recipe.sigmaUpper } })
		const scratch = createCombinationScratch(frames)
		const samples = Array.from({ length: frames }, () => new Float32Array(width * strip))
		const validity = Array.from({ length: frames }, () => new Uint8Array(width * strip))
		const out = new Float32Array(width * strip)

		for (let channel = 0; channel < channels; channel++) {
			for (let startRow = 0; startRow < height; startRow += strip) {
				const rows = Math.min(strip, height - startRow)
				const count = width * rows
				const start = startRow * width
				const stripFrames: CombinationStripFrame[] = []

				for (let index = 0; index < frames; index++) {
					const path = join(spill, `${index}.raw`)
					await readSpill(path, [
						[new Uint8Array(samples[index].buffer, 0, count * 4), (channel * pixels + start) * 4],
						[validity[index].subarray(0, count), channels * pixels * 4 + start],
					])
					stripFrames.push({ raw: samples[index], valid: validity[index], weight: group.frames[index].weight })
				}

				out.fill(Number.NaN, 0, count)
				combineStrip(stripFrames, count, 1, coverage.subarray(start, start + count), threshold, recipe.method, parameters, out, scratch)
				await write(out, count)
				rowsCombined += rows
				report({ group: group.key, frames, rowsCombined, rowsTotal })
			}
		}
	})

	const counts = new Float32Array(pixels)
	for (let pixel = 0; pixel < pixels; pixel++) counts[pixel] = coverage[pixel]
	const covered = await writePlanes(join(product, PRODUCT_COVERAGE_FILE), width, height, 1, { BUNIT: 'frames', HISTORY: 'Number of frames that covered each pixel of the master' }, (write) => write(counts, pixels))
	await rm(spill, { recursive: true, force: true })

	const diagnostics: StackingProductDiagnostics = { mode: plan.mode, coverageThreshold: threshold, coveredPixels, ...(plan.mode === 'spill' && { stripRows: Math.max(1, plan.stripRows) }), normalization }
	return { group: group.key, directory: product, contentDigest: master.digest, bytes: master.bytes, coverageDigest: covered.digest, coverageBytes: covered.bytes, channels, diagnostics }
}

// Integrates every group of a request in order. A group that fails reports why and the next one goes on; its staging
// directory is removed.
export async function integrateGroups(request: IntegrationWorkerRequest, handlers: IntegrationHandlers) {
	for (const group of request.groups) {
		try {
			handlers.onStaged(await integrateGroup(request, group, handlers.onProgress))
		} catch (error) {
			await rm(group.staging, { recursive: true, force: true }).catch(() => undefined)
			handlers.onGroupFailed(group.key, error instanceof IntegrationGroupError ? error.message : 'The frames could not be integrated')
		}
	}
}

// Worker thread of an integration. `unref` is a Bun extension that the DOM Worker type lacks.
type IntegrationWorker = Worker & Pick<Bun.Worker, 'unref'>

// Starts an integration worker; injectable so tests can observe its lifecycle.
export type IntegrationWorkerFactory = () => IntegrationWorker

// Starts the worker of Image Stacking. Inside the executable the embedded path comes from NEBULOSA_IMAGESTACKING_WORKER.
function startIntegrationWorker() {
	const worker = new Worker(process.env.NEBULOSA_IMAGESTACKING_WORKER ?? new URL('./imagestacking.worker.ts', import.meta.url)) as IntegrationWorker
	worker.unref()
	return worker
}

// Client of the integration worker. Each run has a worker of its own, so nothing a run allocated outlives it. There is no
// limit on a run, which can last hours; a worker that stops reporting is terminated instead.
export class StackingIntegrator implements FrameIntegrator {
	// Creates the client; tests inject a worker factory or a shorter stall timeout.
	constructor(
		readonly startWorker: IntegrationWorkerFactory = startIntegrationWorker,
		readonly stallTimeout: number = INTEGRATION_STALL_TIMEOUT,
	) {}

	// Integrates the groups of a request on a worker until it ends. Aborting the signal terminates the worker at once.
	// Rejects with an Error, or with the reason of the signal.
	async integrate(request: IntegrationWorkerRequest, handlers: IntegrationHandlers, signal: AbortSignal) {
		signal.throwIfAborted()
		const worker = this.startWorker()
		const { promise, resolve, reject } = Promise.withResolvers<void>()
		let timer: Timer | undefined

		const watch = () => {
			clearTimeout(timer)
			timer = setTimeout(() => reject(new Error('The integration stopped reporting progress')), this.stallTimeout)
			timer.unref()
		}

		const onMessage = ({ data }: MessageEvent<IntegrationWorkerResponse>) => {
			if (data.jobId !== request.jobId) return
			watch()

			if (data.status === 'progress') handlers.onProgress(data.progress)
			else if (data.status === 'staged') handlers.onStaged(data.product)
			else if (data.status === 'groupFailed') handlers.onGroupFailed(data.group, data.error)
			else if (data.status === 'finished') resolve()
			else reject(new Error(data.error))
		}

		const onError = (event: ErrorEvent) => reject(new Error(event.message || 'The integration worker failed'))
		const onAbort = () => reject(signal.reason)

		worker.addEventListener('message', onMessage)
		worker.addEventListener('error', onError)
		signal.addEventListener('abort', onAbort, { once: true })
		watch()

		try {
			worker.postMessage({ ...request, mode: 'integrate' }, [])
			await promise
		} finally {
			clearTimeout(timer)
			signal.removeEventListener('abort', onAbort)
			worker.removeEventListener('message', onMessage)
			worker.removeEventListener('error', onError)
			worker.terminate()
		}
	}
}
