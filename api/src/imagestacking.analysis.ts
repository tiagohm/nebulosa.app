import { open, stat } from 'fs/promises'
import { extname } from 'path'
import { readImageFromFits, readImageFromXisf } from 'nebulosa/src/imaging/model/image'
import type { DigitalImage, Image } from 'nebulosa/src/imaging/model/types'
import { calibrate, calibrationMasterImage } from 'nebulosa/src/imaging/processing/calibration'
import { registerStars, summarizeTransform } from 'nebulosa/src/imaging/processing/registration'
import { referenceQualityScore } from 'nebulosa/src/imaging/processing/stacker'
import { measureSubframeQuality } from 'nebulosa/src/imaging/processing/subframe.selector'
import { type DetectedStar, detectStars } from 'nebulosa/src/imaging/stars/detector'
import { fileHandleSource } from 'nebulosa/src/io/file'
import { readFits } from 'nebulosa/src/io/formats/fits/fits'
import { uncompressedWidthKeyword } from 'nebulosa/src/io/formats/fits/util'
import { readXisf } from 'nebulosa/src/io/formats/xisf/xisf'
import { fileDigest } from './calibrationlibrary.analysis'
import { digitalFullScale } from './calibrationlibrary.sources'
import type { StackingFrameAnalysis, StackingProjectAnalysis, StackingRegistration, StackingStar } from './imagestacking.store'

// Analysis of the light frames of a stacking project. Measuring runs on a worker of its own (`imagestacking.worker.ts`):
// one frame at a time it hashes the file, reads it in digital numbers, calibrates it with the pinned masters of its
// cohort, detects its stars, and measures its quality, so memory stays one frame and one set of masters whatever the
// number of frames. Registration needs only the stars, so it runs on the server once every frame is measured: each
// filter group registers onto its reference frame, and each group reference onto the project reference, so every frame
// can later be resampled once onto one grid. Files are only read.

// Version of the measurement, part of the fingerprint of an analysis; a change measures every frame again.
export const ANALYSIS_VERSION = 1

// Stars kept per frame for registration, the brightest first.
export const ANALYSIS_STARS = 100

// Stars detected per frame before keeping the brightest.
const DETECTED_STARS = 500

// Smallest signal-to-noise ratio of a detected star; below it a peak of sky noise passes for a faint star and skews
// the quality and the choice of reference. The default of star profiles.
const DETECTION_MIN_SNR = 5

// Stars a reference needs at least to be preferred by its quality.
export const REFERENCE_MIN_STARS = 10

// Smallest number of matched stars of an accepted registration.
const REGISTRATION_MIN_INLIERS = 6

// Largest inlier residual of an accepted registration, in pixels.
const REGISTRATION_MAX_RMS = 2.5

// Time a job may go without reporting progress, in milliseconds, before its worker is terminated. Every frame reports.
export const ANALYSIS_STALL_TIMEOUT = 120000

// A master a cohort is calibrated with: the path of its FITS file and the digital full scale that converts it to the
// normalized scale of its lights (1 for a dimensionless flat).
export interface AnalysisMaster {
	readonly path: string
	readonly fullScale: number
}

// Masters of one cohort. A dark already includes its bias, so a bias is only applied without a dark.
export interface AnalysisCalibration {
	readonly dark?: AnalysisMaster
	readonly flat?: AnalysisMaster
	readonly bias?: AnalysisMaster
}

// A frame to measure.
export interface AnalysisFrame {
	// Id of the frame in its project.
	readonly sourceId: string
	// Absolute path; it is only read.
	readonly path: string
	// Size, in bytes, and modification time, Unix milliseconds, the project knows; another file is not measured.
	readonly bytes: number
	readonly mtimeMillis: number
	// Cohort whose masters calibrate it.
	readonly cohortId: string
}

// Request to the analysis worker.
export interface AnalysisWorkerRequest {
	// Id of the job, echoed by every response.
	readonly jobId: string
	// Frames, grouped by cohort so each set of masters is read once.
	readonly frames: readonly AnalysisFrame[]
	// Masters of each cohort, by cohort id; a cohort absent here is not calibrated.
	readonly calibrations: Readonly<Record<string, AnalysisCalibration>>
}

// What the worker measured of one frame.
export type AnalysisMeasurement = Pick<StackingFrameAnalysis, 'digest' | 'quality' | 'stars' | 'error'>

// Response of the analysis worker.
export type AnalysisWorkerResponse = { readonly jobId: string; readonly status: 'measured'; readonly sourceId: string; readonly measurement: AnalysisMeasurement } | { readonly jobId: string; readonly status: 'finished' } | { readonly jobId: string; readonly status: 'failed'; readonly error: string }

// Worker thread of an analysis. `unref` is a Bun extension that the DOM Worker type lacks.
type AnalysisWorker = Worker & Pick<Bun.Worker, 'unref'>

// Starts an analysis worker; injectable so tests can observe its lifecycle.
export type AnalysisWorkerFactory = () => AnalysisWorker

// Measures frames, reporting each one as it ends; tests replace the worker with an in-thread analyzer.
export interface FrameAnalyzer {
	readonly analyze: (request: AnalysisWorkerRequest, onMeasured: (sourceId: string, measurement: AnalysisMeasurement) => void, signal: AbortSignal) => Promise<void>
}

// Masters of a cohort read in the normalized scale of its lights.
export interface CohortMasters {
	readonly dark?: Image
	readonly flat?: Image
	readonly bias?: Image
}

// Reads the first image of a FITS or XISF file in digital numbers, in single precision.
export async function readDigital(path: string): Promise<DigitalImage> {
	await using source = fileHandleSource(await open(path, 'r'))

	if (extname(path).toLowerCase() === '.xisf') {
		const xisf = await readXisf(source)
		const image = xisf?.images.length ? await readImageFromXisf(xisf, source, { sampleScale: 'digital', raw: 32 }) : undefined
		if (image) return image
	} else {
		const fits = await readFits(source)
		const hdu = fits?.hdus.find((candidate) => uncompressedWidthKeyword(candidate.header, 0) > 0)
		const image = hdu ? await readImageFromFits(hdu, source, { sampleScale: 'digital', raw: 32 }) : undefined
		if (image) return image
	}

	throw new Error('The file holds no readable image')
}

// Reads a master in the normalized scale of its lights.
async function readMaster(master: AnalysisMaster) {
	return calibrationMasterImage(await readDigital(master.path), master.fullScale)
}

// Reads the masters of a cohort; none without a calibration. Throws when a file cannot be read.
export async function readCohortMasters(calibration: AnalysisCalibration | undefined): Promise<CohortMasters> {
	if (!calibration) return {}
	return { dark: calibration.dark && (await readMaster(calibration.dark)), flat: calibration.flat && (await readMaster(calibration.flat)), bias: calibration.bias && (await readMaster(calibration.bias)) }
}

// Keeps the brightest stars, rounded to what registration can use.
function keptStars(stars: readonly DetectedStar[]): StackingStar[] {
	const kept: StackingStar[] = []
	for (const { x, y, flux, hfd, snr } of stars.toSorted((a, b) => b.flux - a.flux).slice(0, ANALYSIS_STARS)) kept.push({ x, y, flux, hfd, snr })
	return kept
}

// Calibrates a light read in digital numbers with the masters of its cohort, which must share its geometry. A pixel
// whose flat is not usable is left uncorrected, for the caller to mask.
export function calibrateLight(light: DigitalImage, masters: CohortMasters) {
	const image = calibrationMasterImage(light, digitalFullScale(light.metadata.bitpix))
	if (!masters.dark && !masters.flat && !masters.bias) return image
	return calibrate(image, { dark: masters.dark, flat: masters.flat, bias: masters.dark ? undefined : masters.bias, darkScaling: 'none', flatRepresentation: 'calibratedNormalized', invalidFlat: 'passthrough' })
}

// Measures every frame of a request, one at a time, and reports each. A frame that cannot be measured reports why and
// the others go on; masters that cannot be read fail every frame of their cohort. Stops between frames when aborted.
export async function measureFrames(request: AnalysisWorkerRequest, report: (sourceId: string, measurement: AnalysisMeasurement) => void, signal?: AbortSignal) {
	let cohort: string | undefined
	let masters: CohortMasters & { readonly error?: string } = {}

	for (const frame of request.frames) {
		signal?.throwIfAborted()

		if (frame.cohortId !== cohort) {
			cohort = frame.cohortId

			try {
				masters = await readCohortMasters(request.calibrations[cohort])
			} catch {
				masters = { error: 'A pinned master could not be read' }
			}
		}

		if (masters.error !== undefined) {
			report(frame.sourceId, { error: masters.error })
			continue
		}

		const info = await stat(frame.path).catch(() => undefined)

		if (!info) {
			report(frame.sourceId, { error: 'The file is missing' })
			continue
		}

		if (info.size !== frame.bytes || info.mtimeMs !== frame.mtimeMillis) {
			report(frame.sourceId, { error: 'The file changed since it was checked' })
			continue
		}

		try {
			const digest = await fileDigest(frame.path)
			const image = calibrateLight(await readDigital(frame.path), masters)
			const detected = detectStars(image, { maxStars: DETECTED_STARS, minSNR: DETECTION_MIN_SNR })
			report(frame.sourceId, { digest, quality: measureSubframeQuality({ image, stars: detected }), stars: keptStars(detected) })
		} catch (error) {
			report(frame.sourceId, { error: Error.isError(error) && !error.message.includes(frame.path) ? error.message : 'The frame could not be measured' })
		}
	}
}

// A measured frame of a filter group, for registration.
export interface RegistrationFrame {
	readonly sourceId: string
	readonly analysis: StackingFrameAnalysis
}

// A filter group to register: its frames, and the reference an operator pinned, if any.
export interface RegistrationGroup {
	readonly key: string
	readonly frames: readonly RegistrationFrame[]
	readonly reference?: string
}

// Registration of a project: what each frame registered onto, and the project outcome.
export interface ProjectRegistration {
	// Transform of each frame onto the reference of its group, by source id.
	readonly frames: ReadonlyMap<string, StackingRegistration>
	readonly project: StackingProjectAnalysis
}

// Returns the stars of a measured frame as registration expects them.
function detected(analysis: StackingFrameAnalysis): DetectedStar[] {
	const stars: DetectedStar[] = []
	for (const star of analysis.stars ?? []) stars.push(star)
	return stars
}

// Registers stars of a target onto a reference with the acceptance of a stack.
function register(reference: StackingFrameAnalysis, target: StackingFrameAnalysis): StackingRegistration {
	const result = registerStars(detected(reference), detected(target), { acceptance: { minInliers: REGISTRATION_MIN_INLIERS, maxRmsError: REGISTRATION_MAX_RMS } })
	return result.success ? { success: true, transform: result.transform } : { success: false, reason: result.reason }
}

// Transform of a reference onto itself.
function identity(analysis: StackingFrameAnalysis): StackingRegistration {
	const transform = { a: 1, b: 0, tx: 0, ty: 0, mirrored: false }
	return { success: true, transform: { transform, inverseTransform: transform, summary: summarizeTransform(transform, analysis.stars?.length ?? 0, 0) } }
}

// Chooses the reference of a group: the pinned frame when it was measured, or the frame of best quality.
function groupReference(group: RegistrationGroup) {
	const measured = group.frames.filter(({ analysis }) => analysis.quality && analysis.stars?.length)
	const pinned = measured.find(({ sourceId }) => sourceId === group.reference)
	if (pinned) return pinned
	let best: RegistrationFrame | undefined
	let bestScore = -Infinity

	for (const frame of measured) {
		const score = referenceQualityScore(frame.analysis.quality!, REFERENCE_MIN_STARS)

		if (score > bestScore) {
			bestScore = score
			best = frame
		}
	}

	return best
}

// Registers every measured frame onto the reference of its group, and every group reference onto the project
// reference: the reference of the pinned group, or the group reference with the most stars. A group whose reference
// does not register onto the project reference fails alone; the transform of a frame onto the project grid is later the
// composition of both. `now` is the time of the outcome, Unix milliseconds.
export function registerProject(groups: readonly RegistrationGroup[], referenceGroup: string | undefined, now: number): ProjectRegistration {
	const frames = new Map<string, StackingRegistration>()
	const references = new Map<string, RegistrationFrame | undefined>()

	for (const group of groups) {
		const reference = groupReference(group)
		references.set(group.key, reference)

		for (const frame of group.frames) {
			if (!frame.analysis.quality) continue
			if (!reference) frames.set(frame.sourceId, { success: false, reason: 'no-reference' })
			else if (frame.sourceId === reference.sourceId) frames.set(frame.sourceId, identity(reference.analysis))
			else frames.set(frame.sourceId, register(reference.analysis, frame.analysis))
		}
	}

	let projectGroup = referenceGroup !== undefined && references.get(referenceGroup) ? referenceGroup : undefined

	if (projectGroup === undefined) {
		let stars = 0

		for (const [key, reference] of references) {
			const count = reference?.analysis.stars?.length ?? 0

			if (count > stars) {
				stars = count
				projectGroup = key
			}
		}
	}

	const projectReference = projectGroup === undefined ? undefined : references.get(projectGroup)
	const outcome: Record<string, StackingProjectAnalysis['groups'][string]> = {}

	for (const group of groups) {
		const reference = references.get(group.key)

		if (!reference) {
			outcome[group.key] = { toProject: { success: false, reason: 'no-reference' } }
			continue
		}

		const toProject: StackingRegistration = !projectReference ? { success: false, reason: 'no-reference' } : projectReference === reference ? identity(reference.analysis) : register(projectReference.analysis, reference.analysis)
		outcome[group.key] = { referenceSourceId: reference.sourceId, toProject }
	}

	return { frames, project: { analyzedAt: now, referenceGroup: projectGroup, referenceSourceId: projectReference?.sourceId, groups: outcome } }
}

// Starts an analysis worker. Inside the executable the embedded path comes from NEBULOSA_IMAGESTACKING_WORKER.
function startAnalysisWorker() {
	const worker = new Worker(process.env.NEBULOSA_IMAGESTACKING_WORKER ?? new URL('./imagestacking.worker.ts', import.meta.url)) as AnalysisWorker
	worker.unref()
	return worker
}

// Client of the analysis worker. Each job has a worker of its own, so nothing a job allocated outlives it. A worker that
// stops reporting is terminated.
export class StackingAnalyzer implements FrameAnalyzer {
	// Creates the client; tests inject a worker factory or a shorter stall timeout.
	constructor(
		readonly startWorker: AnalysisWorkerFactory = startAnalysisWorker,
		readonly stallTimeout: number = ANALYSIS_STALL_TIMEOUT,
	) {}

	// Measures the frames of a request on a worker until it ends. Aborting the signal terminates the worker at once.
	// Rejects with an Error, or with the reason of the signal.
	async analyze(request: AnalysisWorkerRequest, onMeasured: (sourceId: string, measurement: AnalysisMeasurement) => void, signal: AbortSignal) {
		signal.throwIfAborted()
		const worker = this.startWorker()
		const { promise, resolve, reject } = Promise.withResolvers<void>()
		let timer: Timer | undefined

		const watch = () => {
			clearTimeout(timer)
			timer = setTimeout(() => reject(new Error('The analysis stopped reporting progress')), this.stallTimeout)
			timer.unref()
		}

		const onMessage = ({ data }: MessageEvent<AnalysisWorkerResponse>) => {
			if (data.jobId !== request.jobId) return

			if (data.status === 'measured') {
				watch()
				onMeasured(data.sourceId, data.measurement)
			} else if (data.status === 'finished') {
				resolve()
			} else {
				reject(new Error(data.error))
			}
		}

		const onError = (event: ErrorEvent) => reject(new Error(event.message || 'The analysis worker failed'))
		const onAbort = () => reject(signal.reason)

		worker.addEventListener('message', onMessage)
		worker.addEventListener('error', onError)
		signal.addEventListener('abort', onAbort, { once: true })
		watch()

		try {
			worker.postMessage({ ...request, mode: 'analyze' }, [])
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
