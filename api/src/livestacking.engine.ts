import { mkdir } from 'fs/promises'
import { join } from 'path'
import type { DigitalImage, Image } from 'nebulosa/src/imaging/model/types'
import { invalidFlatMask } from 'nebulosa/src/imaging/processing/calibration'
import { blendLuminanceRows, type ChannelMix, collectLuminanceSamples, type CompositionPlane, createCompositionCounters, createLuminanceSamples, type LuminanceMatchMode, mixChannelRows, solveLuminanceMatch, validateChannelMix } from 'nebulosa/src/imaging/processing/channel.composition'
import { debayer } from 'nebulosa/src/imaging/processing/debayer'
import { registerStars } from 'nebulosa/src/imaging/processing/registration'
import { type FrameAcceptanceResult, type FrameRejectionReason, LiveStacker, type LiveStackingField, liveStackerMemoryBytes, type StackingInterpolationMode, type StackingOptions, type StackingWeightingMode } from 'nebulosa/src/imaging/processing/stacker'
import { measureSubframeQuality } from 'nebulosa/src/imaging/processing/subframe.selector'
import { type DetectedStar, detectStars } from 'nebulosa/src/imaging/stars/detector'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { bufferSource } from 'nebulosa/src/io/io'
import { stableId } from './calibrationlibrary.compatibility'
import { type AnalysisCalibration, calibrateLight, type CohortMasters, readCohortMasters, readDigital, readDigitalFrom } from './imagestacking.analysis'
import { writePlanes } from './imagestacking.integration'

// Live Stacking engine: the scientific state of one session, owned by its worker (`livestacking.worker.ts`), and
// usable in the calling thread by tests. One frame at a time it reads the light in digital numbers (from the bytes of a
// preview-only frame or the file of a saved one), calibrates it with the masters the server resolved for it, detects
// its stars and measures its quality, and then routes it:
// - A field is one stable pixel grid of one pointing: its reference is the first good frame of its geometry, and every
//   stack of the field is resampled onto it, so stacks of different filters can be composed into color.
// - A cohort is the stack of one segment (filter, acquisition settings, calibration) on one field, a toolkit LiveStacker
//   on that field, whose photometric reference is its own first frame, so a filter is never normalized to another.
// A frame is added to the stack of its segment on the field it registers onto, the most recently used field first; a
// frame that registers onto no field is held as a candidate of a new field, which is confirmed only once
// FIELD_CONFIRMATION_FRAMES candidates register onto one another, so one cloudy frame never starts a field; a candidate
// that a later frame disproves is rejected. A rejected frame never changes a stack. The engine never retains more than
// the budget the server gives with each frame: a new field, cohort, or candidate beyond it is refused. Masters are read
// once per calibration and kept until another one is needed. Snapshots and exports copy the accumulators, so the stacks
// go on; exported files are linear Float32 FITS with NaN where no frame covered a pixel.

// Candidates of a new field that must register onto one another before it is confirmed.
export const FIELD_CONFIRMATION_FRAMES = 3

// Stars detected per frame before keeping the brightest, as Image Stacking does.
const DETECTED_STARS = 500

// Smallest signal-to-noise ratio of a detected star, as Image Stacking uses.
const DETECTION_MIN_SNR = 5

// Stars kept per frame for registration, the brightest first, as Image Stacking keeps.
const REGISTRATION_STARS = 100

// Smallest number of matched stars of an accepted registration.
const REGISTRATION_MIN_INLIERS = 6

// Largest inlier residual of an accepted registration, in pixels.
const REGISTRATION_MAX_RMS = 2.5

// Integration settings of a session, locked into each cohort when it is created.
export interface LiveStackingRecipe {
	// Online combination: the mean, or the mean weighted by frame quality.
	readonly method: 'average' | 'weighted-average'
	// Weight of a frame for weighted-average (see frameWeight of the toolkit); ignored by average.
	readonly weighting: Exclude<StackingWeightingMode, 'none'>
	// Normalization of each frame to the first frame of its cohort.
	readonly normalization: 'none' | 'scale' | 'background-scale'
	// Kernel a frame is resampled onto its field with.
	readonly interpolation: StackingInterpolationMode
	// Fewest detected stars of a usable frame, and of the reference of a field; at least 3.
	readonly minStars: number
	// Smallest fraction, in [0, 1], of the field a frame must cover.
	readonly minOverlap: number
	// Largest median half-flux diameter of an accepted frame, in pixels; absent accepts any.
	readonly maxHfd?: number
	// Smallest median star signal-to-noise ratio of an accepted frame; absent accepts any.
	readonly minSnr?: number
}

// Permissive defaults: quality only gates a frame through its stars and registration, so a dim narrowband frame is kept.
export const DEFAULT_LIVE_STACKING_RECIPE: LiveStackingRecipe = { method: 'average', weighting: 'quality', normalization: 'background-scale', interpolation: 'bilinear', minStars: 6, minOverlap: 0.25 }

// Where the pixels of a frame are: the bytes of a FITS or XISF file in memory, owned by the engine, or a saved file,
// which is only read.
export type LiveFrameSource = { readonly kind: 'bytes'; readonly bytes: Uint8Array<ArrayBuffer> } | { readonly kind: 'file'; readonly path: string }

// A frame to integrate, as the server routed it.
export interface LiveEngineFrame {
	// Identity of the frame (capture session and generation).
	readonly frameId: string
	readonly source: LiveFrameSource
	// Segment key (filter, acquisition cohort, calibration policy; see segmentKeyOf).
	readonly segment: string
	// Geometry key (see geometryKeyOf): only fields of the same geometry can take it.
	readonly geometry: string
	// Masters to calibrate it with, already checked against it; absent leaves it uncalibrated.
	readonly calibration?: AnalysisCalibration
	// Bytes the engine may retain once the frame is integrated, its share of the server budget.
	readonly budget: number
}

// Why a frame was not integrated after it was read.
export type LiveRejectionReason = 'unreadable' | 'masterUnreadable' | 'tooFewStars' | 'poorQuality' | 'fieldMismatch' | 'unconfirmedField' | 'insufficientOverlap' | 'normalizationFailed' | 'incompatibleGrid' | 'capacityExceeded'

// What was measured of a frame, from its calibrated pixels.
export interface LiveFrameMeasurement {
	// Detected stars.
	readonly stars: number
	// Median half-flux diameter and full width at half maximum, in pixels; absent without stars.
	readonly hfd?: number
	readonly fwhm?: number
	// Median star signal-to-noise ratio; absent without stars.
	readonly snr?: number
	// Median eccentricity of the stars, in [0, 1); absent when not measured.
	readonly eccentricity?: number
	// Estimated sky background, in normalized units of full scale.
	readonly background: number
}

// Registration of an accepted frame onto its field: translation in pixels, rotation in radians, inlier residual in pixels.
export interface LiveFrameRegistration {
	readonly dx: number
	readonly dy: number
	readonly rotation: number
	readonly rms: number
	readonly inliers: number
}

// Outcome of one frame. A held frame is a candidate of a new field, whose outcome comes with a later frame.
export type LiveEngineOutcome =
	| {
			readonly frameId: string
			readonly status: 'accepted'
			readonly fieldId: string
			readonly cohortId: string
			// Whether the frame started its field.
			readonly newField: boolean
			readonly measurement: LiveFrameMeasurement
			readonly registration: LiveFrameRegistration
			// Fraction of the field it covers, in [0, 1].
			readonly overlap: number
			// Weight it was integrated with, and the scale and offset of its first channel normalization.
			readonly weight: number
			readonly scale: number
			readonly offset: number
	  }
	| { readonly frameId: string; readonly status: 'rejected'; readonly reason: LiveRejectionReason; readonly detail: string; readonly measurement?: LiveFrameMeasurement }
	| { readonly frameId: string; readonly status: 'held'; readonly measurement: LiveFrameMeasurement }

// Outcomes of a request and the bytes the engine retains afterwards.
export interface LiveEngineResult {
	readonly outcomes: readonly LiveEngineOutcome[]
	readonly retainedBytes: number
}

// A source of a color composition: a mono cohort with the linear correction applied to it first.
export interface LiveCompositionSource {
	readonly cohortId: string
	// Multiplier applied to every sample, finite and positive, and value added after it, in the units of the stack.
	readonly gain: number
	readonly offset: number
}

// How mono stacks of one field are mixed into color, as Image Stacking composes its masters: a mix term names a source
// by its index, and its weight is unitless and non-negative; an optional source is blended into the luminance.
export interface LiveStackingComposition {
	// Name of the preset it came from, such as SHO, or Custom.
	readonly preset: string
	readonly sources: readonly LiveCompositionSource[]
	readonly mix: ChannelMix
	readonly luminance?: { readonly source: number; readonly alpha: number; readonly match: LuminanceMatchMode }
}

// Image of a snapshot and how many accepted frames it integrates in total.
export interface LiveSnapshot {
	readonly image: Image
	readonly frames: number
}

// Files of an export, written into a directory, with their SHA-256 and size in bytes.
export interface LiveExport {
	readonly contentDigest: string
	readonly bytes: number
	readonly coverageDigest?: string
	readonly coverageBytes?: number
	readonly width: number
	readonly height: number
	readonly channels: number
}

// Name of the linear stack of an export.
export const LIVE_PRODUCT_FILE = 'stack.fit'

// Name of the per-pixel count of accepted frames of a mono or color cohort export.
export const LIVE_COVERAGE_FILE = 'coverage.fit'

// Failure of a request about the stacks, such as an unknown cohort or an invalid composition.
export class LiveEngineError extends Error {}

// A frame read, calibrated, and measured.
interface PreparedFrame {
	readonly frameId: string
	readonly segment: string
	readonly geometry: string
	// Calibrated image, debayered when it was a mosaic, in normalized units.
	readonly image: Image
	// Brightest stars, in its pixel centers.
	readonly stars: readonly DetectedStar[]
	readonly measurement: LiveFrameMeasurement
	// Source pixels whose flat was unusable, when there are any.
	readonly mask?: Uint8Array
	readonly maskedPixels: number
}

// A field: one stable grid and its reference stars, with the stack of each segment on it.
interface Field {
	readonly fieldId: string
	readonly geometry: string
	readonly reference: LiveStackingField
	readonly cohorts: Map<string, Cohort>
	// Order of last use; the most recent field is tried first.
	used: number
}

// The stack of one segment on one field.
interface Cohort {
	readonly cohortId: string
	readonly stacker: LiveStacker
	accepted: number
}

// Returns the id of the cohort of a segment on a field.
export function cohortIdOf(fieldId: string, segment: string) {
	return stableId(`${fieldId}|${segment}`)
}

// Returns whether a stacker rejection is about where the frame lies, so another field may take it.
function geometricRejection(reason: FrameRejectionReason | undefined) {
	return reason === 'match-failed' || reason === 'invalid-transform' || reason === 'transform-error-too-high' || reason === 'transform-out-of-bounds' || reason === 'no-overlap' || reason === 'insufficient-overlap'
}

// Returns whether bytes hold an XISF file, by its signature.
function isXisf(bytes: Uint8Array) {
	return bytes.length >= 8 && String.fromCharCode(...bytes.subarray(0, 8)) === 'XISF0100'
}

// Returns the bytes of the samples of an image, in its precision.
function imageBytes(image: Image) {
	return image.raw.byteLength
}

// Scientific state of one Live Stacking session.
export class LiveStackingEngine {
	readonly #recipe: LiveStackingRecipe
	readonly #fields: Field[] = []
	#candidates: PreparedFrame[] = []
	#newField = false
	#uses = 0
	// Masters of the latest calibration read, by its identity.
	#masters?: { readonly key: string; readonly masters: CohortMasters; readonly mask?: Uint8Array; readonly maskedPixels: number; readonly bytes: number }

	// Creates the engine of a session with its recipe, which never changes.
	constructor(recipe: LiveStackingRecipe) {
		this.#recipe = recipe
	}

	// Bytes retained: field references, stacks, candidates, and the masters read.
	get retainedBytes() {
		let bytes = this.#masters?.bytes ?? 0
		for (const field of this.#fields) {
			const { width, height, channels } = field.reference.image.metadata
			bytes += imageBytes(field.reference.image)
			bytes += field.cohorts.size * liveStackerMemoryBytes(width, height, channels, 4)
		}
		for (const candidate of this.#candidates) bytes += imageBytes(candidate.image)
		return bytes
	}

	// Makes the next good frame the reference of a new field, whatever the existing fields; held candidates are rejected.
	startNewField(): LiveEngineResult {
		this.#newField = true
		return { outcomes: this.#dropCandidates('unconfirmedField', 'A new field was started'), retainedBytes: this.retainedBytes }
	}

	// Rejects the held candidates, as when the session stops: their field was never confirmed.
	flush(): LiveEngineResult {
		return { outcomes: this.#dropCandidates('unconfirmedField', 'The session ended before the new field was confirmed'), retainedBytes: this.retainedBytes }
	}

	// Forgets every field, stack, and candidate; held candidates are returned rejected.
	reset(): LiveEngineResult {
		const outcomes = this.#dropCandidates('unconfirmedField', 'The live stack was reset')
		this.#fields.length = 0
		this.#newField = false
		this.#masters = undefined
		return { outcomes, retainedBytes: this.retainedBytes }
	}

	// Integrates one frame and returns the outcomes it settled: its own, unless it is held, and those of candidates it
	// confirmed or disproved.
	async integrate(frame: LiveEngineFrame): Promise<LiveEngineResult> {
		let prepared: PreparedFrame

		try {
			prepared = await this.#prepare(frame)
		} catch (error) {
			const reason = error instanceof LiveEngineError ? 'masterUnreadable' : 'unreadable'
			return this.#result([{ frameId: frame.frameId, status: 'rejected', reason, detail: Error.isError(error) ? error.message : String(error) }])
		}

		const { measurement } = prepared
		const reject = (reason: LiveRejectionReason, detail: string): LiveEngineResult => this.#result([{ frameId: prepared.frameId, status: 'rejected', reason, detail, measurement }])

		if (measurement.stars < this.#recipe.minStars) return reject('tooFewStars', `${measurement.stars} stars detected, ${this.#recipe.minStars} needed`)
		if (this.#recipe.maxHfd !== undefined && measurement.hfd !== undefined && measurement.hfd > this.#recipe.maxHfd) return reject('poorQuality', `HFD ${measurement.hfd.toFixed(2)} px above ${this.#recipe.maxHfd}`)
		if (this.#recipe.minSnr !== undefined && (measurement.snr ?? 0) < this.#recipe.minSnr) return reject('poorQuality', `SNR ${(measurement.snr ?? 0).toFixed(1)} below ${this.#recipe.minSnr}`)

		const fields = this.#fields.filter((field) => field.geometry === prepared.geometry).sort((a, b) => b.used - a.used)

		if (this.#newField || fields.length === 0) {
			const outcome = this.#startField(prepared, frame.budget)
			if (outcome.status === 'accepted') this.#newField = false
			return this.#result([outcome])
		}

		for (const field of fields) {
			const outcome = this.#addTo(field, prepared, frame.budget)
			if (outcome) return this.#result([outcome, ...(outcome.status === 'accepted' ? this.#dropCandidates('unconfirmedField', 'A later frame matched an existing field') : [])])
		}

		return this.#result(this.#hold(prepared, frame.budget))
	}

	// Returns a snapshot of a cohort: its current linear mean on its field, with 0 where no frame covered a pixel for
	// display, or NaN for an export. Undefined for an unknown cohort.
	snapshot(cohortId: string, uncovered = 0): LiveSnapshot | undefined {
		const cohort = this.#cohort(cohortId)
		const result = cohort?.stacker.snapshot()
		if (!cohort || !result?.finalImage) return undefined
		const image = result.finalImage
		const mask = result.validityMask

		if (mask && uncovered !== 0) {
			const { channels } = image.metadata
			for (let pixel = 0; pixel < mask.length; pixel++) if (mask[pixel] === 0) for (let channel = 0; channel < channels; channel++) image.raw[pixel * channels + channel] = uncovered
		}

		return { image, frames: result.acceptedFrames }
	}

	// Composes mono cohorts of one field into a linear RGB image, with NaN where a channel has no support, or 0 for
	// display. Throws LiveEngineError for an unknown source, sources of different fields, a color source, or a mix the
	// toolkit refuses.
	compose(composition: LiveStackingComposition, uncovered = 0): LiveSnapshot {
		const fields = new Set<string>()
		const planes: CompositionPlane[] = []
		let frames = 0
		let width = 0
		let height = 0
		let header: FitsHeader = {}

		for (const source of composition.sources) {
			const found = this.#cohortWithField(source.cohortId)
			if (!found) throw new LiveEngineError('A stack of the composition is unknown')
			fields.add(found.field.fieldId)
			const result = found.cohort.stacker.snapshot()
			if (!result?.finalImage || !result.validityMask) throw new LiveEngineError('A stack of the composition has no frame')
			if (result.finalImage.metadata.channels !== 1) throw new LiveEngineError('Only mono stacks can be composed')
			;({ width, height } = result.finalImage.metadata)
			if (planes.length === 0) header = result.finalImage.header
			planes.push({ raw: result.finalImage.raw, valid: result.validityMask, gain: source.gain, offset: source.offset })
			frames += result.acceptedFrames
		}

		if (fields.size !== 1) throw new LiveEngineError('The stacks of a composition must share one field')
		const issues = validateChannelMix(composition.mix, planes)
		if (issues.length > 0) throw new LiveEngineError(`The composition is invalid: ${issues.map((issue) => issue.code).join(', ')}`)

		const pixels = width * height
		const rgb = new Float32Array(pixels * 3)
		const rgbValid = new Uint8Array(pixels)
		const counters = createCompositionCounters()
		mixChannelRows(planes, composition.mix, pixels, rgb, rgbValid, counters)
		const luminance = composition.luminance

		if (luminance && luminance.alpha > 0) {
			const plane = planes[luminance.source]
			if (!plane) throw new LiveEngineError('The luminance of the composition is unknown')
			const samples = createLuminanceSamples(pixels)
			collectLuminanceSamples(samples, rgb, rgbValid, plane, pixels)
			blendLuminanceRows(rgb, rgbValid, plane, solveLuminanceMatch(samples, luminance.match), luminance.alpha, pixels, counters)
		}

		for (let pixel = 0; pixel < pixels; pixel++) {
			if (rgbValid[pixel] !== 0) continue
			rgb[pixel * 3] = uncovered
			rgb[pixel * 3 + 1] = uncovered
			rgb[pixel * 3 + 2] = uncovered
		}

		if (uncovered === 0) for (let i = 0; i < rgb.length; i++) if (!Number.isFinite(rgb[i])) rgb[i] = 0

		const { BAYERPAT: _, XBAYROFF: __, YBAYROFF: ___, FILTER: ____, ...rest } = header
		const image: Image = { header: { ...rest, NAXIS: 3, NAXIS1: width, NAXIS2: height, NAXIS3: 3, BITPIX: -32 }, raw: rgb, metadata: { width, height, channels: 3, stride: width * 3, pixelCount: pixels, strideInBytes: width * 12, pixelSizeInBytes: 4, bitpix: -32, bayer: undefined } }
		return { image, frames }
	}

	// Writes a cohort, or a composition, as a linear Float32 FITS file into directory, with header, and for a cohort the
	// per-pixel count of its accepted frames. The stacks are copied first, so the files are one consistent revision.
	async export(directory: string, target: LiveExportTarget, header: FitsHeader): Promise<LiveExport> {
		const snapshot = 'cohortId' in target ? this.snapshot(target.cohortId, Number.NaN) : this.compose(target.composition, Number.NaN)
		if (!snapshot) throw new LiveEngineError('The stack has no frame')
		const coverage = 'cohortId' in target ? this.#cohort(target.cohortId)?.stacker.snapshot()?.coverageMap : undefined
		const { width, height, channels } = snapshot.image.metadata
		const pixels = width * height
		await mkdir(directory, { recursive: true })

		const master = await writePlanes(join(directory, LIVE_PRODUCT_FILE), width, height, channels, header, async (write) => {
			const plane = new Float32Array(pixels)

			for (let channel = 0; channel < channels; channel++) {
				for (let pixel = 0, i = channel; pixel < pixels; pixel++, i += channels) plane[pixel] = snapshot.image.raw[i]
				await write(plane, pixels)
			}
		})

		if (!coverage) return { contentDigest: master.digest, bytes: master.bytes, width, height, channels }

		const counts = Float32Array.from(coverage)
		const covered = await writePlanes(join(directory, LIVE_COVERAGE_FILE), width, height, 1, { BUNIT: 'frames', HISTORY: 'Number of accepted frames that covered each pixel of the live stack' }, (write) => write(counts, pixels))
		return { contentDigest: master.digest, bytes: master.bytes, coverageDigest: covered.digest, coverageBytes: covered.bytes, width, height, channels }
	}

	// Reads, calibrates, and measures a frame. Throws LiveEngineError when its masters cannot be read, and any other
	// error when the frame cannot.
	async #prepare(frame: LiveEngineFrame): Promise<PreparedFrame> {
		const masters = await this.#readMasters(frame.calibration)
		let light: DigitalImage

		if (frame.source.kind === 'file') {
			light = await readDigital(frame.source.path)
		} else {
			const { bytes } = frame.source
			light = await readDigitalFrom(bufferSource(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)), isXisf(bytes))
		}

		const calibrated = calibrateLight(light, masters.masters)
		const detected = detectStars(calibrated, { maxStars: DETECTED_STARS, minSNR: DETECTION_MIN_SNR })
		const quality = measureSubframeQuality({ image: calibrated, stars: detected })
		const image = calibrated.metadata.bayer ? debayer(calibrated) : calibrated
		if (!image) throw new Error('The color frame could not be debayered')
		const stars = detected.toSorted((a, b) => b.flux - a.flux).slice(0, REGISTRATION_STARS)
		const mask = masters.mask?.length === image.metadata.pixelCount ? masters.mask : undefined

		const measurement: LiveFrameMeasurement = {
			stars: detected.length,
			...(detected.length > 0 && { hfd: quality.medianHFD, snr: quality.medianSNR }),
			...(quality.medianFWHM !== undefined && { fwhm: quality.medianFWHM }),
			...(quality.medianEccentricity !== undefined && { eccentricity: quality.medianEccentricity }),
			background: quality.estimatedBackground,
		}

		return { frameId: frame.frameId, segment: frame.segment, geometry: frame.geometry, image, stars, measurement, ...(mask && { mask }), maskedPixels: mask ? masters.maskedPixels : 0 }
	}

	// Returns the masters of a calibration, read once and kept until another calibration is needed. Throws LiveEngineError
	// when a master cannot be read.
	async #readMasters(calibration: AnalysisCalibration | undefined) {
		const key = JSON.stringify(calibration ?? {})
		if (this.#masters?.key === key) return this.#masters

		let masters: CohortMasters

		try {
			masters = await readCohortMasters(calibration)
		} catch {
			throw new LiveEngineError('A chosen master could not be read')
		}

		const flat = masters.flat && invalidFlatMask(masters.flat)
		const bytes = (masters.dark ? imageBytes(masters.dark) : 0) + (masters.flat ? imageBytes(masters.flat) : 0) + (masters.bias ? imageBytes(masters.bias) : 0) + (flat ? flat.mask.byteLength : 0)
		this.#masters = { key, masters, ...(flat && flat.count > 0 && { mask: flat.mask }), maskedPixels: flat?.count ?? 0, bytes }
		return this.#masters
	}

	// Returns the stacker options of a cohort: the recipe, with a supplied rejection mask when its flat has unusable pixels.
	#options(masked: boolean): StackingOptions {
		const recipe = this.#recipe

		return {
			combinationMethod: recipe.method,
			weightingMode: recipe.method === 'weighted-average' ? recipe.weighting : 'none',
			normalizationMode: recipe.normalization,
			interpolationMode: recipe.interpolation,
			minAcceptedStars: recipe.minStars,
			minAcceptedInliers: REGISTRATION_MIN_INLIERS,
			maxAcceptedTransformError: REGISTRATION_MAX_RMS,
			minOverlapFraction: recipe.minOverlap,
			allowStarlessReference: false,
			keepPerPixelStatistics: true,
			cropMode: 'union',
			samplePrecision: 32,
			// The unusable pixels of the flat are a supplied source-grid mask, so no streak is ever detected.
			...(masked && { streaks: { enabled: true } }),
		}
	}

	// Returns the stacking frame of a prepared frame.
	#stackingFrame(frame: PreparedFrame) {
		const { width, height } = frame.image.metadata
		const streakMask = frame.mask && { width, height, raw: frame.mask, maskedPixels: frame.maskedPixels, maskedFraction: frame.maskedPixels / (width * height) }
		return { image: frame.image, stars: frame.stars, id: frame.frameId, ...(streakMask && { streakMask }) }
	}

	// Starts a field with a frame as its reference and integrates it into the stack of its segment there.
	#startField(frame: PreparedFrame, budget: number): LiveEngineOutcome {
		const { width, height, channels } = frame.image.metadata
		const needed = imageBytes(frame.image) + liveStackerMemoryBytes(width, height, channels, 4)
		if (this.retainedBytes + needed > budget) return { frameId: frame.frameId, status: 'rejected', reason: 'capacityExceeded', detail: 'A new field would exceed the memory of Live Stacking', measurement: frame.measurement }

		const field: Field = { fieldId: crypto.randomUUID(), geometry: frame.geometry, reference: { image: frame.image, stars: frame.stars }, cohorts: new Map(), used: ++this.#uses }
		const cohort: Cohort = { cohortId: cohortIdOf(field.fieldId, frame.segment), stacker: new LiveStacker(this.#options(frame.mask !== undefined), field.reference), accepted: 0 }
		const result = cohort.stacker.add(this.#stackingFrame(frame))
		if (!result.accepted) return this.#rejection(frame, result)

		cohort.accepted++
		field.cohorts.set(frame.segment, cohort)
		this.#fields.push(field)
		return this.#accepted(frame, field, cohort, result, true)
	}

	// Adds a frame to the stack of its segment on a field, creating it when the budget allows. Returns its outcome, or
	// undefined when the frame does not register onto the field, so another field may take it.
	#addTo(field: Field, frame: PreparedFrame, budget: number): LiveEngineOutcome | undefined {
		let cohort = field.cohorts.get(frame.segment)
		const created = !cohort

		if (!cohort) {
			const { width, height, channels } = field.reference.image.metadata
			if (this.retainedBytes + liveStackerMemoryBytes(width, height, channels, 4) > budget) return { frameId: frame.frameId, status: 'rejected', reason: 'capacityExceeded', detail: 'A new stack would exceed the memory of Live Stacking', measurement: frame.measurement }
			cohort = { cohortId: cohortIdOf(field.fieldId, frame.segment), stacker: new LiveStacker(this.#options(frame.mask !== undefined), field.reference), accepted: 0 }
		}

		const result = cohort.stacker.add(this.#stackingFrame(frame))
		if (!result.accepted && geometricRejection(result.reason)) return undefined
		if (!result.accepted) return this.#rejection(frame, result)

		if (created) field.cohorts.set(frame.segment, cohort)
		cohort.accepted++
		field.used = ++this.#uses
		return this.#accepted(frame, field, cohort, result, false)
	}

	// Holds a frame that registered onto no field as a candidate of a new field. It joins the candidates when it registers
	// onto the first of them, which then confirm a new field once there are enough; otherwise the candidates are rejected
	// and it becomes the first of new ones.
	#hold(frame: PreparedFrame, budget: number): LiveEngineOutcome[] {
		const outcomes: LiveEngineOutcome[] = []
		const first = this.#candidates[0]

		if (first && !registerStars(first.stars, frame.stars, { acceptance: { minInliers: REGISTRATION_MIN_INLIERS, maxRmsError: REGISTRATION_MAX_RMS } }).success) {
			outcomes.push(...this.#dropCandidates('fieldMismatch', 'It matched neither the active field nor the frames after it'))
		}

		if (this.retainedBytes + imageBytes(frame.image) > budget) {
			outcomes.push({ frameId: frame.frameId, status: 'rejected', reason: 'capacityExceeded', detail: 'Holding it as a candidate of a new field would exceed the memory of Live Stacking', measurement: frame.measurement })
			return outcomes
		}

		this.#candidates.push(frame)

		if (this.#candidates.length < FIELD_CONFIRMATION_FRAMES) {
			outcomes.push({ frameId: frame.frameId, status: 'held', measurement: frame.measurement })
			return outcomes
		}

		const candidates = this.#candidates
		this.#candidates = []
		const started = this.#startField(candidates[0], budget)
		outcomes.push(started)

		if (started.status !== 'accepted') {
			for (const candidate of candidates.slice(1)) outcomes.push({ frameId: candidate.frameId, status: 'rejected', reason: 'unconfirmedField', detail: 'The new field could not be started', measurement: candidate.measurement })
			return outcomes
		}

		const field = this.#fields.at(-1)!
		for (const candidate of candidates.slice(1)) outcomes.push(this.#addTo(field, candidate, budget) ?? { frameId: candidate.frameId, status: 'rejected', reason: 'fieldMismatch', detail: 'It did not register onto the new field', measurement: candidate.measurement })
		return outcomes
	}

	// Rejects every held candidate.
	#dropCandidates(reason: LiveRejectionReason, detail: string): LiveEngineOutcome[] {
		const outcomes = this.#candidates.map((candidate): LiveEngineOutcome => ({ frameId: candidate.frameId, status: 'rejected', reason, detail, measurement: candidate.measurement }))
		this.#candidates = []
		return outcomes
	}

	// Returns the outcome of a frame the stacker accepted.
	#accepted(frame: PreparedFrame, field: Field, cohort: Cohort, result: FrameAcceptanceResult, newField: boolean): LiveEngineOutcome {
		const transform = result.transform
		const normalization = result.normalization

		return {
			frameId: frame.frameId,
			status: 'accepted',
			fieldId: field.fieldId,
			cohortId: cohort.cohortId,
			newField,
			measurement: frame.measurement,
			registration: { dx: transform?.translationX ?? 0, dy: transform?.translationY ?? 0, rotation: transform?.rotation ?? 0, rms: transform?.rmsError ?? 0, inliers: transform?.inlierCount ?? 0 },
			overlap: result.overlapFraction,
			weight: normalization?.weight ?? 1,
			scale: normalization?.scales[0] ?? 1,
			offset: normalization?.offsets[0] ?? 0,
		}
	}

	// Returns the outcome of a frame the stacker rejected for a reason other than where it lies.
	#rejection(frame: PreparedFrame, result: FrameAcceptanceResult): LiveEngineOutcome {
		const reason: LiveRejectionReason =
			result.reason === 'normalization-failed'
				? 'normalizationFailed'
				: result.reason === 'insufficient-overlap' || result.reason === 'no-overlap'
					? 'insufficientOverlap'
					: result.reason === 'too-few-stars'
						? 'tooFewStars'
						: result.reason === 'channel-mismatch' || result.reason === 'invalid-image-shape'
							? 'incompatibleGrid'
							: 'fieldMismatch'
		return { frameId: frame.frameId, status: 'rejected', reason, detail: result.reason ?? 'rejected', measurement: frame.measurement }
	}

	// Returns a cohort by id.
	#cohort(cohortId: string) {
		return this.#cohortWithField(cohortId)?.cohort
	}

	// Returns a cohort by id with its field.
	#cohortWithField(cohortId: string) {
		for (const field of this.#fields) for (const cohort of field.cohorts.values()) if (cohort.cohortId === cohortId) return { field, cohort }
		return undefined
	}

	// Returns outcomes with the bytes retained.
	#result(outcomes: readonly LiveEngineOutcome[]): LiveEngineResult {
		return { outcomes, retainedBytes: this.retainedBytes }
	}
}

// Time an integration or an export may take on the worker before it is deemed stalled, in milliseconds. On an Intel Core
// i5-6500T (4 cores at 2.5 GHz) the slowest measured request was 10.5 s, a 26 MP mono frame calibrated with a dark and a
// flat (about 12 s extrapolated for a 26 MP mosaic), and an export of a 26 MP mono stack took 5.6 s (about 10 s for a
// color one). A false stall loses every stack of the session, so it leaves ten times that for slower hosts and disks.
export const INTEGRATION_STALL_TIMEOUT = 120000

// What a stack export writes: one cohort, or a composition of cohorts of one field.
export type LiveExportTarget = { readonly cohortId: string } | { readonly composition: LiveStackingComposition }

// Request to the worker of a session; every one carries an id its response echoes. Integrate transfers the bytes of a
// preview-only frame to the worker.
export type LiveWorkerRequest =
	| { readonly id: number; readonly type: 'configure'; readonly recipe: LiveStackingRecipe }
	| { readonly id: number; readonly type: 'integrate'; readonly frame: LiveEngineFrame }
	| { readonly id: number; readonly type: 'newField' | 'flush' | 'reset' }
	| { readonly id: number; readonly type: 'snapshot'; readonly cohortId: string }
	| { readonly id: number; readonly type: 'compose'; readonly composition: LiveStackingComposition }
	| { readonly id: number; readonly type: 'export'; readonly directory: string; readonly target: LiveExportTarget; readonly header: FitsHeader }

// Response of the worker of a session. A snapshot transfers its samples to the server. A failure says whether the
// engine refused the request, or the worker could not answer it.
export type LiveWorkerResponse =
	| { readonly id: number; readonly status: 'result'; readonly result: LiveEngineResult }
	| { readonly id: number; readonly status: 'snapshot'; readonly snapshot?: LiveSnapshot }
	| { readonly id: number; readonly status: 'exported'; readonly files: LiveExport }
	| { readonly id: number; readonly status: 'failed'; readonly error: string; readonly refused: boolean }

// Answers one request with an engine, in the thread that owns it, with the buffers its response transfers.
export async function answerLiveRequest(engine: LiveStackingEngine, request: LiveWorkerRequest): Promise<{ readonly response: LiveWorkerResponse; readonly transfer: Transferable[] }> {
	const { id } = request

	try {
		switch (request.type) {
			case 'configure':
				return { response: { id, status: 'result', result: { outcomes: [], retainedBytes: engine.retainedBytes } }, transfer: [] }
			case 'integrate':
				return { response: { id, status: 'result', result: await engine.integrate(request.frame) }, transfer: [] }
			case 'newField':
				return { response: { id, status: 'result', result: engine.startNewField() }, transfer: [] }
			case 'flush':
				return { response: { id, status: 'result', result: engine.flush() }, transfer: [] }
			case 'reset':
				return { response: { id, status: 'result', result: engine.reset() }, transfer: [] }
			case 'snapshot': {
				const snapshot = engine.snapshot(request.cohortId)
				return { response: { id, status: 'snapshot', ...(snapshot && { snapshot }) }, transfer: snapshot ? [snapshot.image.raw.buffer] : [] }
			}
			case 'compose': {
				const snapshot = engine.compose(request.composition)
				return { response: { id, status: 'snapshot', snapshot }, transfer: [snapshot.image.raw.buffer] }
			}
			case 'export':
				return { response: { id, status: 'exported', files: await engine.export(request.directory, request.target, request.header) }, transfer: [] }
		}
	} catch (error) {
		return { response: { id, status: 'failed', error: Error.isError(error) ? error.message : String(error), refused: error instanceof LiveEngineError }, transfer: [] }
	}
}

// Failure of the worker of a session: it crashed, stalled, or was stopped; its stacks are lost.
export class LiveWorkerFailure extends Error {}

// The engine of a session, behind the thread that owns it. Requests run one at a time, in order. A refusal rejects with
// LiveEngineError; a failure of the thread rejects with LiveWorkerFailure, and so does every later request.
export interface LiveStackingProcessor extends Disposable {
	readonly integrate: (frame: LiveEngineFrame) => Promise<LiveEngineResult>
	readonly startNewField: () => Promise<LiveEngineResult>
	readonly flush: () => Promise<LiveEngineResult>
	readonly reset: () => Promise<LiveEngineResult>
	readonly snapshot: (cohortId: string) => Promise<LiveSnapshot | undefined>
	readonly compose: (composition: LiveStackingComposition) => Promise<LiveSnapshot>
	readonly export: (directory: string, target: LiveExportTarget, header: FitsHeader) => Promise<LiveExport>
}

// Creates the processor of a session with its recipe.
export type LiveProcessorFactory = (recipe: LiveStackingRecipe) => LiveStackingProcessor

// Base of the processors: request ids and the checking of responses.
abstract class RequestProcessor implements LiveStackingProcessor {
	#id = 0

	// Sends a request and resolves with its response; rejects with LiveWorkerFailure when the thread failed.
	protected abstract send(request: LiveWorkerRequest, transfer: Transferable[]): Promise<LiveWorkerResponse>

	abstract [Symbol.dispose](): void

	readonly integrate = async (frame: LiveEngineFrame) => this.#result(await this.send({ id: ++this.#id, type: 'integrate', frame }, frame.source.kind === 'bytes' ? [frame.source.bytes.buffer] : []))

	readonly startNewField = async () => this.#result(await this.send({ id: ++this.#id, type: 'newField' }, []))

	readonly flush = async () => this.#result(await this.send({ id: ++this.#id, type: 'flush' }, []))

	readonly reset = async () => this.#result(await this.send({ id: ++this.#id, type: 'reset' }, []))

	readonly snapshot = async (cohortId: string) => {
		const response = this.#checked(await this.send({ id: ++this.#id, type: 'snapshot', cohortId }, []))
		return response.status === 'snapshot' ? response.snapshot : undefined
	}

	readonly compose = async (composition: LiveStackingComposition) => {
		const response = this.#checked(await this.send({ id: ++this.#id, type: 'compose', composition }, []))
		if (response.status !== 'snapshot' || !response.snapshot) throw new LiveEngineError('The composition could not be made')
		return response.snapshot
	}

	readonly export = async (directory: string, target: LiveExportTarget, header: FitsHeader) => {
		const response = this.#checked(await this.send({ id: ++this.#id, type: 'export', directory, target, header }, []))
		if (response.status !== 'exported') throw new LiveEngineError('The stack could not be exported')
		return response.files
	}

	// Throws the failure of a response.
	#checked(response: LiveWorkerResponse) {
		if (response.status === 'failed') throw response.refused ? new LiveEngineError(response.error) : new LiveWorkerFailure(response.error)
		return response
	}

	// Returns the engine result of a response.
	#result(response: LiveWorkerResponse) {
		const checked = this.#checked(response)
		if (checked.status !== 'result') throw new LiveWorkerFailure('The worker answered another request')
		return checked.result
	}
}

// Processor running the engine in the calling thread, one request at a time; for tests.
export class InThreadProcessor extends RequestProcessor {
	readonly #engine: LiveStackingEngine
	#queue: Promise<unknown> = Promise.resolve()
	#disposed = false

	// Creates the processor and its engine with the recipe of a session.
	constructor(recipe: LiveStackingRecipe) {
		super()
		this.#engine = new LiveStackingEngine(recipe)
	}

	protected send(request: LiveWorkerRequest): Promise<LiveWorkerResponse> {
		if (this.#disposed) return Promise.reject(new LiveWorkerFailure('The live stacking engine was stopped'))
		const next = this.#queue.then(async () => (await answerLiveRequest(this.#engine, request)).response)
		this.#queue = next.catch(() => undefined)
		return next
	}

	// Stops answering requests.
	[Symbol.dispose]() {
		this.#disposed = true
	}
}

// Worker thread of a session. `unref` is a Bun extension that the DOM Worker type lacks.
type LiveWorker = Worker & Pick<Bun.Worker, 'unref'>

// Pending request of a worker processor.
interface PendingRequest {
	readonly resolve: (response: LiveWorkerResponse) => void
	readonly reject: (error: Error) => void
	// Stall timer of an integration or an export.
	readonly timer?: Timer
}

// Processor running the engine on a worker thread of its own, started with it and terminated when it is disposed, when it
// crashes, or when an integration or an export stalls past stallTimeout (milliseconds); the worker answers its requests
// in order. Inside the executable the embedded path of the worker comes from NEBULOSA_LIVESTACKING_WORKER.
export class WorkerProcessor extends RequestProcessor {
	#worker?: LiveWorker
	#failure?: LiveWorkerFailure
	readonly #pending = new Map<number, PendingRequest>()

	// Starts the worker of a session and configures it with its recipe.
	constructor(
		recipe: LiveStackingRecipe,
		readonly stallTimeout: number = INTEGRATION_STALL_TIMEOUT,
	) {
		super()
		const worker = new Worker(process.env.NEBULOSA_LIVESTACKING_WORKER ?? new URL('./livestacking.worker.ts', import.meta.url)) as LiveWorker
		worker.unref()

		worker.addEventListener('message', (event: MessageEvent<LiveWorkerResponse>) => {
			const pending = this.#pending.get(event.data.id)
			if (!pending) return
			this.#pending.delete(event.data.id)
			clearTimeout(pending.timer)
			pending.resolve(event.data)
		})

		worker.addEventListener('error', (event) => this.#fail(`The live stacking worker crashed: ${event.message}`))
		this.#worker = worker
		worker.postMessage({ id: 0, type: 'configure', recipe } satisfies LiveWorkerRequest, [])
	}

	protected send(request: LiveWorkerRequest, transfer: Transferable[]): Promise<LiveWorkerResponse> {
		const worker = this.#worker
		if (!worker) return Promise.reject(this.#failure ?? new LiveWorkerFailure('The live stacking worker was stopped'))

		return new Promise((resolve, reject) => {
			const timer = request.type === 'integrate' || request.type === 'export' ? setTimeout(() => this.#fail('The live stacking worker stalled'), this.stallTimeout) : undefined
			this.#pending.set(request.id, { resolve, reject, timer })
			worker.postMessage(request, transfer)
		})
	}

	// Terminates the worker and rejects what it was doing.
	#fail(message: string) {
		this.#failure ??= new LiveWorkerFailure(message)
		this.#worker?.terminate()
		this.#worker = undefined

		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer)
			pending.reject(this.#failure)
		}

		this.#pending.clear()
	}

	// Terminates the worker.
	[Symbol.dispose]() {
		this.#fail('The live stacking worker was stopped')
	}
}
