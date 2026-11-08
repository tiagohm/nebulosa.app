import { open } from 'fs/promises'
import { analyzeFlat } from 'nebulosa/src/imaging/analysis/flat/flat'
import type { FlatPlane } from 'nebulosa/src/imaging/analysis/flat/types'
import { readImageFromFits } from 'nebulosa/src/imaging/model/image'
import type { DigitalImage } from 'nebulosa/src/imaging/model/types'
import { fileHandleSource } from 'nebulosa/src/io/file'
import { type FitsHeader, readFits } from 'nebulosa/src/io/formats/fits/fits'
import { textKeyword, uncompressedBitpixKeyword, uncompressedHeightKeyword, uncompressedWidthKeyword } from 'nebulosa/src/io/formats/fits/util'
import { medianOf } from 'nebulosa/src/math/numerical/statistics'
import { imageAcquisition, precisionOf } from './images'

// Measurement and assessment of Dark Library Wizard frames. The acquired FITS file is read in the digital numbers of its
// source on a worker of its own (`darklibrarywizard.worker.ts`), never through the normalized documents of the viewer;
// only compact statistics per plane and the keywords of its header cross back. assessDarkFrame then decides a frame from
// them: failures that can be proven reject it, and spatial or temporal evidence only raises a suspicion of external
// light, because amp glow, hot pixels, dark current gradients, and the pedestal are the signal a dark exists to record.
// No rule uses an absolute brightness or the gradient of a single frame, and nothing here can prove the absence of
// light: without a baseline, the first frames of a plan are only checked for saturation. Levels are DN, exposures
// seconds, temperatures degrees Celsius. No device is held and no file is modified.

// Fraction of a plane at the upper clipping limit that suggests light rather than hot pixels, which stay far below 1%.
const SUSPICIOUS_CLIPPED_FRACTION = 0.01

// Robust sigmas a level or a spatial spread may exceed its baseline by, well above the dispersion of a stack of darks.
const BASELINE_SIGMAS = 8

// Share of the dispersion of the reference frames taken as the least sigma of a baseline, in DN per DN of MAD. Medians of
// a stack can agree exactly, and a 0.5 °C drift inside the tolerance moves them by a few percent of the dark signal. The
// frame judged never sets its own limit, since light that raises its level also raises its dispersion.
const BASELINE_DISPERSION_FLOOR = 0.25

// Smallest sigma of a baseline, in DN: medians of integer samples move in steps.
const BASELINE_MINIMUM_SIGMA = 1

// Factor a spatial spread may exceed the one of its baseline by before it counts as a change of structure.
const STRUCTURE_FACTOR = 2

// Accepted frames of a group that make a baseline.
const BASELINE_MINIMUM_FRAMES = 3

// Output pixels a driver may trim from a requested dimension, since many round widths to a multiple of 8.
const GEOMETRY_TOLERANCE = 16

// Largest difference between a requested integer setting and the one the header reports, in driver units.
const SETTING_TOLERANCE = 0.5

// Relative and absolute difference (seconds) allowed between the requested and the reported exposure.
const EXPOSURE_RELATIVE_TOLERANCE = 0.01
const EXPOSURE_ABSOLUTE_TOLERANCE = 0.001

// Share of an exposure the sensor may spend out of tolerance before its frame is rejected: a warm excursion longer than
// this changes the dark current of the frame by more than the tolerance itself allows for.
const MAXIMUM_OUT_OF_TOLERANCE_SHARE = 0.1

// Time a measurement may run, in milliseconds, before its worker is terminated.
export const MEASUREMENT_TIMEOUT = 120000

// Keywords of a frame header the assessment relies on; each is absent when the driver did not write it.
export interface DarkFrameHeader {
	// Frame type as written (IMAGETYP, then FRAME).
	readonly frameType?: string
	// Exposure, in seconds.
	readonly exposure?: number
	// Gain, in driver units.
	readonly gain?: number
	// Offset, in driver units.
	readonly offset?: number
	// Sensor temperature, in degrees Celsius.
	readonly temperature?: number
	// Binning factors.
	readonly binning?: { readonly x: number; readonly y: number }
	// Image width, in output pixels.
	readonly width: number
	// Image height, in output pixels.
	readonly height: number
}

// Levels of one physical plane of a frame, without debayering.
export interface DarkPlaneMeasurement {
	// Physical plane.
	readonly plane: FlatPlane
	// Robust median, in DN; absent when the plane had no finite sample.
	readonly median?: number
	// Median absolute deviation, in DN.
	readonly mad?: number
	// Number of non-finite samples.
	readonly nonFinite: number
	// Fraction of the samples at the upper clipping limit, in [0, 1]; absent when no limit is known.
	readonly clipped?: number
	// Difference between the 95th and 5th percentile tile medians, in DN; absent without enough tiles.
	readonly tileSpread?: number
}

// Result of measuring one frame.
export interface DarkFrameMeasurement {
	// Header keywords.
	readonly header: DarkFrameHeader
	// Levels of every plane.
	readonly planes: readonly DarkPlaneMeasurement[]
}

// Settings a frame was requested with.
export interface DarkFrameExpectation {
	// Exposure, in seconds.
	readonly exposure: number
	// Gain, in driver units.
	readonly gain: number
	// Offset, in driver units.
	readonly offset: number
	// Binning factors.
	readonly binX: number
	readonly binY: number
	// Image size, in output pixels; absent when the sensor size is unknown.
	readonly width?: number
	readonly height?: number
}

// Levels of the accepted frames of a group, and of the shorter exposures of the plan that share its operating point.
export interface DarkFrameBaseline {
	// Planes of each accepted frame of the group, oldest first.
	readonly frames: readonly (readonly DarkPlaneMeasurement[])[]
	// Size of the first accepted frame of the group, which every other must share.
	readonly size?: { readonly width: number; readonly height: number }
	// Median level per plane of a shorter exposure of the plan at the same temperature.
	readonly shorter?: { readonly exposure: number; readonly levels: Readonly<Partial<Record<FlatPlane, number>>> }
}

// Sensor temperature observed during an exposure.
export interface DarkTemperatureTrace {
	// Reading when the exposure started, in degrees Celsius.
	readonly start: number
	// Latest reading, in degrees Celsius.
	readonly end: number
	// Lowest and highest readings, in degrees Celsius.
	readonly minimum: number
	readonly maximum: number
	// Seconds the readings stayed out of tolerance; 0 without a target.
	readonly outOfTolerance: number
	// Monotonic instant of the latest reading, in milliseconds.
	readonly at: number
	// Seconds since the driver last changed the reading, at the latest reading; absent while unknown. A driver reports
	// only changes, so a long silence is ordinary and proves nothing either way.
	readonly age?: number
}

// Failure that keeps a frame from counting.
export type DarkRejectionCode = 'unreadable' | 'frameTypeMismatch' | 'geometryMismatch' | 'exposureMismatch' | 'binningMismatch' | 'gainMismatch' | 'offsetMismatch' | 'nonFiniteSamples' | 'temperatureExcursion'

// Evidence of external light. None of them proves it, and their absence does not prove darkness.
// - saturation: a share of samples at the clipping limit that hot pixels do not reach.
// - levelExcursion: a level above the baseline of the group.
// - structureChange: a spatial spread above the baseline of the group.
// - exposureBound: a level above what a shorter exposure of the plan allows, since the pedestal is not negative.
export type DarkLightSuspicion = 'saturation' | 'levelExcursion' | 'structureChange' | 'exposureBound'

// What could not be verified, or passed without affecting the verdict:
// - <field>Unverified: the header does not report the field.
// - temperatureTransient: the sensor left the tolerance for a short part of the exposure.
export type DarkFrameNote = 'frameTypeUnverified' | 'exposureUnverified' | 'gainUnverified' | 'offsetUnverified' | 'binningUnverified' | 'temperatureUnverified' | 'temperatureTransient'

// Assessment of one frame.
export interface DarkFrameAssessment {
	// Proven failures; any of them rejects the frame.
	readonly rejections: readonly DarkRejectionCode[]
	// Evidence of external light.
	readonly suspicions: readonly DarkLightSuspicion[]
	// What could not be verified.
	readonly notes: readonly DarkFrameNote[]
}

// Request to the Dark Library Wizard worker.
export interface DarkWorkerRequest {
	// Id of the job, echoed by the response.
	readonly jobId: string
	// Absolute path of the FITS file to read; it is only read.
	readonly path: string
}

// Response of the Dark Library Wizard worker.
export type DarkWorkerResponse = { readonly jobId: string; readonly status: 'measured'; readonly result: DarkFrameMeasurement } | { readonly jobId: string; readonly status: 'failed'; readonly error: string }

// Worker thread of the measurement. `unref` is a Bun extension that the DOM Worker type lacks.
type DarkWorker = Worker & Pick<Bun.Worker, 'unref'>

// Starts a measurement worker; injectable so tests can observe the worker lifecycle.
export type DarkWorkerFactory = () => DarkWorker

// Returns the header keywords the assessment relies on.
export function darkFrameHeader(header: FitsHeader): DarkFrameHeader {
	const { exposure, gain, offset, temperature, binning } = imageAcquisition(header)
	const frameType = textKeyword(header, 'IMAGETYP').trim() || textKeyword(header, 'FRAME').trim() || undefined
	return { frameType, exposure, gain, offset, temperature, binning, width: uncompressedWidthKeyword(header, 0), height: uncompressedHeightKeyword(header, 0) }
}

// Returns the value at quantile q in [0, 1] of values sorted in increasing order.
function quantile(values: readonly number[], q: number) {
	return values[Math.min(values.length - 1, Math.round(q * (values.length - 1)))]
}

// Measures a frame in DN with the toolkit's flat statistics, which assign no cause to what they measure: no target is
// set and the verdict of the analysis is ignored, only its statistics per plane and tile are kept.
export function measureDarkImage(image: DigitalImage): DarkFrameMeasurement {
	const analysis = analyzeFlat({ frame: { image } }, { maps: 'none' })

	const planes = analysis.planes.map(({ plane, observed, clipping, spatial }): DarkPlaneMeasurement => {
		const medians = spatial.tiles.flatMap((tile) => tile.observed.median ?? []).toSorted((a, b) => a - b)
		return { plane, median: observed.median, mad: observed.mad, nonFinite: observed.nonFinite, clipped: clipping.upper?.fraction, tileSpread: medians.length >= 2 ? quantile(medians, 0.95) - quantile(medians, 0.05) : undefined }
	})

	return { header: darkFrameHeader(image.header), planes }
}

// Reads a FITS file in digital numbers, with the precision its BITPIX needs, and measures it. Throws when the file
// cannot be opened or holds no readable FITS image.
export async function measureDarkFile(path: string): Promise<DarkFrameMeasurement> {
	await using source = fileHandleSource(await open(path, 'r'))
	const fits = await readFits(source)
	if (!fits) throw new Error('The frame is not a FITS file')
	const precision = fits.hdus.some((hdu) => precisionOf(uncompressedBitpixKeyword(hdu.header, 0)) === 64) ? 64 : 32
	const image = await readImageFromFits(fits, source, { sampleScale: 'digital', raw: precision })
	if (!image) throw new Error('The FITS file holds no readable image')
	return measureDarkImage(image)
}

// Returns the failures a frame proves against the settings it was requested with, and what its header cannot verify.
// Only what the header reports is compared, so a driver that omits a keyword is never accused of a mismatch.
function auditHeader(header: DarkFrameHeader, expected: DarkFrameExpectation, baseline: DarkFrameBaseline, rejections: DarkRejectionCode[], notes: DarkFrameNote[]) {
	if (header.frameType === undefined) notes.push('frameTypeUnverified')
	else if (!header.frameType.toLowerCase().includes('dark')) rejections.push('frameTypeMismatch')

	if (header.exposure === undefined) notes.push('exposureUnverified')
	else if (Math.abs(header.exposure - expected.exposure) > Math.max(EXPOSURE_ABSOLUTE_TOLERANCE, expected.exposure * EXPOSURE_RELATIVE_TOLERANCE)) rejections.push('exposureMismatch')

	if (header.gain === undefined) notes.push('gainUnverified')
	else if (Math.abs(header.gain - expected.gain) > SETTING_TOLERANCE) rejections.push('gainMismatch')

	if (header.offset === undefined) notes.push('offsetUnverified')
	else if (Math.abs(header.offset - expected.offset) > SETTING_TOLERANCE) rejections.push('offsetMismatch')

	if (header.binning === undefined) notes.push('binningUnverified')
	else if (header.binning.x !== expected.binX || header.binning.y !== expected.binY) rejections.push('binningMismatch')

	const { size } = baseline
	const outOfRequest = (actual: number, requested: number | undefined) => requested !== undefined && Math.abs(actual - requested) > GEOMETRY_TOLERANCE
	if (header.width <= 0 || header.height <= 0 || outOfRequest(header.width, expected.width) || outOfRequest(header.height, expected.height) || (size && (size.width !== header.width || size.height !== header.height))) rejections.push('geometryMismatch')
}

// Returns the evidence of external light in the planes of a frame against the accepted frames of its group and a shorter
// exposure of the plan. Only excesses count: light adds signal, and a level that falls is no leak.
function lightSuspicions(planes: readonly DarkPlaneMeasurement[], expected: DarkFrameExpectation, { frames, shorter }: DarkFrameBaseline): DarkLightSuspicion[] {
	const suspicions = new Set<DarkLightSuspicion>()

	for (const { plane, median, mad, clipped, tileSpread } of planes) {
		if (clipped !== undefined && clipped >= SUSPICIOUS_CLIPPED_FRACTION) suspicions.add('saturation')
		if (median === undefined) continue

		const reference = shorter?.levels[plane]
		const margin = BASELINE_SIGMAS * Math.max(BASELINE_MINIMUM_SIGMA, (mad ?? 0) * BASELINE_DISPERSION_FLOOR)
		if (shorter && reference !== undefined && expected.exposure >= shorter.exposure && median > (reference * expected.exposure) / shorter.exposure + margin) suspicions.add('exposureBound')
		if (frames.length < BASELINE_MINIMUM_FRAMES) continue

		const peers = frames.flatMap((frame) => frame.find((entry) => entry.plane === plane) ?? [])
		const dispersions = Float64Array.from(peers.flatMap((peer) => peer.mad ?? [])).sort()
		const floor = Math.max(BASELINE_MINIMUM_SIGMA, dispersions.length > 0 ? medianOf(dispersions) * BASELINE_DISPERSION_FLOOR : 0)
		const levels = Float64Array.from(peers.flatMap((peer) => peer.median ?? [])).sort()

		if (levels.length >= BASELINE_MINIMUM_FRAMES) {
			const center = medianOf(levels)
			const deviations = levels.map((level) => Math.abs(level - center)).sort()
			const sigma = Math.max(floor, 1.4826 * medianOf(deviations))
			if (median - center > BASELINE_SIGMAS * sigma) suspicions.add('levelExcursion')
		}

		const spreads = Float64Array.from(peers.flatMap((peer) => peer.tileSpread ?? [])).sort()
		if (tileSpread !== undefined && spreads.length >= BASELINE_MINIMUM_FRAMES && tileSpread > STRUCTURE_FACTOR * medianOf(spreads) + BASELINE_SIGMAS * floor) suspicions.add('structureChange')
	}

	return Array.from(suspicions)
}

// Decides a measured frame. A frame with rejections never counts; suspicions never reject it, since only the operator
// can say whether the protection failed. trace is the temperature observed during the exposure, absent when the camera
// reports none; target is the temperature the frame was requested at, absent when uncontrolled.
export function assessDarkFrame({ header, planes }: DarkFrameMeasurement, expected: DarkFrameExpectation, baseline: DarkFrameBaseline, trace?: DarkTemperatureTrace, target?: number): DarkFrameAssessment {
	const rejections: DarkRejectionCode[] = []
	const notes: DarkFrameNote[] = []

	auditHeader(header, expected, baseline, rejections, notes)
	if (planes.length === 0 || planes.some((plane) => plane.nonFinite > 0 || plane.median === undefined)) rejections.push('nonFiniteSamples')

	if (trace === undefined) notes.push('temperatureUnverified')
	else if (target !== undefined && trace.outOfTolerance > 0) {
		if (trace.outOfTolerance > expected.exposure * MAXIMUM_OUT_OF_TOLERANCE_SHARE) rejections.push('temperatureExcursion')
		else notes.push('temperatureTransient')
	}

	return { rejections, suspicions: lightSuspicions(planes, expected, baseline), notes }
}

// Starts the trace of an exposure from its first reading, at a monotonic instant in milliseconds.
export function startTemperatureTrace(temperature: number, at: number, age: number | undefined): DarkTemperatureTrace {
	return { start: temperature, end: temperature, minimum: temperature, maximum: temperature, outOfTolerance: 0, at, age }
}

// Adds a reading to a trace, counting the time since the previous reading as out of tolerance when that reading was:
// a value stands until the driver changes it.
export function advanceTemperatureTrace(trace: DarkTemperatureTrace, temperature: number, at: number, age: number | undefined, target?: number, tolerance = 0): DarkTemperatureTrace {
	const outside = target !== undefined && Math.abs(trace.end - target) > tolerance
	return { ...trace, end: temperature, minimum: Math.min(trace.minimum, temperature), maximum: Math.max(trace.maximum, temperature), outOfTolerance: trace.outOfTolerance + (outside ? (at - trace.at) / 1000 : 0), at, age }
}

// Advances the wait for a stable temperature: returns the monotonic instant in milliseconds the reading entered the
// tolerance, kept while it stays inside, or undefined once it leaves. The reading stays valid between updates, because
// a driver reports only changes: a sensor that holds its target publishes nothing.
export function advanceThermalHold(since: number | undefined, temperature: number, target: number, tolerance: number, now: number): number | undefined {
	return Math.abs(temperature - target) <= tolerance ? (since ?? now) : undefined
}

// Measures acquired dark frames in digital numbers, one at a time and in arrival order; a cancelled or timed out one
// terminates its worker.
export class DarkLibraryWizardAnalyzer {
	// Worker kept between measurements.
	#idle?: DarkWorker
	// Settles when the previous measurement ended.
	#queue: Promise<unknown> = Promise.resolve()

	// Creates the analyzer; timeout bounds every measurement in milliseconds and startWorker creates workers.
	constructor(
		readonly timeout: number = MEASUREMENT_TIMEOUT,
		readonly startWorker: DarkWorkerFactory = startDarkWorker,
	) {}

	// Measures the FITS file at path. Resolves the measurement; rejects when the file is not a readable FITS image, the
	// worker failed or timed out, or signal aborted it.
	measure(path: string, signal: AbortSignal): Promise<DarkFrameMeasurement> {
		const run = this.#queue.then(() => this.#measure({ jobId: Bun.randomUUIDv7(), path }, signal))
		this.#queue = run.catch(() => undefined)
		return run
	}

	// Terminates the idle worker. Measurements still queued start a new one.
	dispose() {
		this.#idle?.terminate()
		this.#idle = undefined
	}

	// Same as dispose, so the analyzer can be scoped with `using`.
	[Symbol.dispose]() {
		this.dispose()
	}

	// Runs one measurement on the worker.
	async #measure(request: DarkWorkerRequest, signal: AbortSignal): Promise<DarkFrameMeasurement> {
		signal.throwIfAborted()

		const worker = this.#idle ?? this.startWorker()
		this.#idle = undefined
		const { promise, resolve, reject } = Promise.withResolvers<DarkFrameMeasurement>()
		let reusable = false

		const onMessage = (event: MessageEvent<DarkWorkerResponse>) => {
			const response = event.data
			if (response.jobId !== request.jobId) return
			// A measurement that threw leaves the worker usable; only a crash, a timeout, or a cancel does not.
			reusable = true
			if (response.status === 'measured') resolve(response.result)
			else reject(new Error(`The dark measurement failed: ${response.error}`))
		}

		const onError = (event: ErrorEvent) => reject(new Error(`The dark measurement worker died: ${event.message}`))
		const onAbort = () => reject(signal.reason)
		const timer = setTimeout(() => reject(new Error(`The dark measurement did not finish within ${this.timeout / 1000} s`)), this.timeout)

		worker.addEventListener('message', onMessage)
		worker.addEventListener('error', onError)
		signal.addEventListener('abort', onAbort, { once: true })

		try {
			worker.postMessage(request, [])
			return await promise
		} finally {
			clearTimeout(timer)
			worker.removeEventListener('message', onMessage)
			worker.removeEventListener('error', onError)
			signal.removeEventListener('abort', onAbort)
			// The measurement cannot be interrupted, so a worker still running one is terminated.
			if (reusable) this.#idle = worker
			else worker.terminate()
		}
	}
}

// Starts a measurement worker. The compiled executable defines the embedded path of the worker (see app/build.ts);
// elsewhere it is resolved next to this module.
function startDarkWorker(): DarkWorker {
	const worker = new Worker(process.env.NEBULOSA_DARKLIBRARY_WORKER ?? new URL('./darklibrarywizard.worker.ts', import.meta.url)) as DarkWorker
	// An idle worker must not keep the process alive on its own.
	worker.unref()
	return worker
}
