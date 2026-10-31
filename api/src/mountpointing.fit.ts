import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import type { PierSide } from 'nebulosa/src/devices/indi/device'
import { percentileOf } from 'nebulosa/src/math/numerical/statistics'
import type { Angle } from 'nebulosa/src/math/units/angle'
import { computePointingError, type FittedPointingModel, fitPointingModel, type PointingFitOptions, type PointingModelStrategy, type PointingSample, predictPointingModelError, selectPointingStrategy } from 'nebulosa/src/observation/mount/pointing'
import { earthOrientationInstalled } from './astronomicaltime.eop'
import { type EquatorialPosition, POINTING_MODEL_FRAME, type PointingSite } from './mountpointing.frames'

// Fitting of the mount pointing models: what the fit worker (`mountpointing.worker.ts`) computes, and the queue that
// drives it. Fitting refits once per sample for the leave-one-out metrics and once more per strategy for Auto, which
// takes seconds at the sample counts of a run, so it never runs on the server event loop. The toolkit owns the regression;
// this module only chooses its options, keeps withheld samples out of it, and measures the result. A sample crosses to
// the worker as plain numbers, since a toolkit Time holds functions that cannot be cloned.

// Strategy a fit asks for: one of the toolkit's, or Auto, which lets its cross-validation choose.
export type PointingFitStrategy = PointingModelStrategy | 'auto'

// Outcome of the offline quality gate of a revision:
// - unusable: the toolkit could not determine the model.
// - failed: it was determined, but the withheld samples do not show that it predicts the sky.
// - passed: it may go on to verification.
export type PointingGate = 'unusable' | 'failed' | 'passed'

// Fewest withheld samples the gate accepts: below this their RMS says little.
const GATE_MINIMUM_HELD_OUT = 6

// Largest withheld RMS the gate accepts, as a fraction of the withheld error before correction. Provisional: it stands
// until simulator and real-mount runs justify a value.
const GATE_MAXIMUM_RESIDUAL_RATIO = 0.8

// Time a fit may run, in milliseconds, before its worker is terminated.
const FIT_TIMEOUT = 120000

// One sample as a fit takes it.
export interface PointingFitSample {
	// Id of the sample.
	readonly id: string
	// Middle of the exposure, in Unix milliseconds.
	readonly time: number
	// Exact command the driver received, opaque coordinates of the driver, in radians.
	readonly command: EquatorialPosition
	// Apparent position reached, in radians.
	readonly solved: EquatorialPosition
	// Pier side the mount reported.
	readonly pierSide: PierSide
}

// What a fit computes.
export interface PointingFitRequest {
	// Strategy asked for.
	readonly strategy: PointingFitStrategy
	// Site of the samples.
	readonly site: PointingSite
	// Samples the model is fitted to.
	readonly training: readonly PointingFitSample[]
	// Samples withheld from the fit, which only measure it.
	readonly heldOut: readonly PointingFitSample[]
	// Options on top of the defaults of a run.
	readonly options?: PointingFitOptions
	// Lowest altitude of the samples accepted, in radians; the altitude limit of their plan.
	readonly minimumAltitude?: Angle
}

// Error of one sample, in radians on the sky: east and north, positive when the mount landed east or north of the command.
export interface PointingSampleResidual {
	// Id of the sample.
	readonly id: string
	// Whether the sample was withheld from the fit.
	readonly heldOut: boolean
	// East error before correction.
	readonly rawDx: Angle
	// North error before correction.
	readonly rawDy: Angle
	// East error the model leaves.
	readonly dx: Angle
	// North error the model leaves.
	readonly dy: Angle
}

// Offline measures of a fit, in radians. A measure a fit cannot give is absent, never zero.
export interface PointingOfflineMetrics {
	// RMS error of the training samples before correction.
	readonly rawRms?: Angle
	// RMS the fit leaves on the samples it was fitted to; says little about the rest of the sky.
	readonly trainingRms?: Angle
	// Leave-one-out RMS of the training samples.
	readonly looRms?: Angle
	// RMS error of the withheld samples before correction.
	readonly heldOutRawRms?: Angle
	// RMS the model leaves on the withheld samples.
	readonly heldOutRms?: Angle
	// 95th percentile of what the model leaves on the withheld samples.
	readonly heldOutP95?: Angle
	// Withheld samples measured.
	readonly heldOutCount: number
	// Training samples per pier side.
	readonly perSide: Readonly<Record<PierSide, number>>
}

// Result of a fit. The condition numbers of fitted are not finite for a singular model, and a JSON copy holds them as
// null; prediction never reads them, so gate on usable.
export interface PointingFitResult {
	// Model of the toolkit.
	readonly fitted: FittedPointingModel
	// Errors of every sample of the request.
	readonly residuals: readonly PointingSampleResidual[]
	// Measures of the fit.
	readonly offline: PointingOfflineMetrics
	// Outcome of the offline quality gate.
	readonly gate: PointingGate
}

// Request to the fit worker.
export interface PointingFitWorkerRequest {
	// Id of the job.
	readonly jobId: string
	// What to compute.
	readonly request: PointingFitRequest
	// Whether the server thread reads Earth orientation tables, so the worker must read them too.
	readonly earthOrientation: boolean
}

// Response of the fit worker.
export type PointingFitWorkerResponse = { readonly jobId: string; readonly status: 'fitted'; readonly result: PointingFitResult } | { readonly jobId: string; readonly status: 'failed'; readonly error: string }

// Worker thread of a fit. `unref` is a Bun extension that the DOM Worker type lacks.
type PointingFitWorker = Worker & Pick<Bun.Worker, 'unref'>

// Returns the toolkit's sample of a fit sample.
function toolkitSample({ time, command, solved, pierSide }: PointingFitSample, { latitude, longitude }: PointingSite): PointingSample {
	return {
		targetRightAscension: command.rightAscension,
		targetDeclination: command.declination,
		solvedRightAscension: solved.rightAscension,
		solvedDeclination: solved.declination,
		time: timeUnix(time / 1000, true),
		latitude,
		longitude,
		pierSide,
		frame: POINTING_MODEL_FRAME,
	}
}

// Returns the options of a fit. Cross terms are off, since at one site sinAlt is an exact combination of sinDec and
// cosHA·cosDec, which leaves the default features singular from about 65 samples on. Pier terms need both sides, since on
// one they repeat the bias and the hour angle terms. Options of the request take precedence over these.
export function pointingFitOptions({ training, options, minimumAltitude }: Pick<PointingFitRequest, 'training' | 'options' | 'minimumAltitude'>): PointingFitOptions {
	const bothSides = training.some((sample) => sample.pierSide === 'EAST') && training.some((sample) => sample.pierSide === 'WEST')

	return {
		...options,
		frame: POINTING_MODEL_FRAME,
		featureConfiguration: { includeCrossTerms: false, includePierSideTerms: bothSides, ...options?.featureConfiguration },
		validation: { ...(minimumAltitude !== undefined && { minimumAltitude }), ...options?.validation },
	}
}

// Returns the root mean square of the errors, or undefined without any.
function rootMeanSquare(errors: readonly Angle[]) {
	if (errors.length === 0) return undefined
	return Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length)
}

// Returns the error before and after the model of one sample.
function residualOf(sample: PointingFitSample, heldOut: boolean, fitted: FittedPointingModel, site: PointingSite): PointingSampleResidual {
	const { command, solved } = sample
	const raw = computePointingError(command.rightAscension, command.declination, solved.rightAscension, solved.declination)
	const { time, latitude, longitude, pierSide } = toolkitSample(sample, site)
	const predicted = predictPointingModelError(fitted, { ...command, time, latitude, longitude, pierSide, frame: POINTING_MODEL_FRAME })
	return { id: sample.id, heldOut, rawDx: raw.dx, rawDy: raw.dy, dx: raw.dx - predicted.dx, dy: raw.dy - predicted.dy }
}

// Measures a fit from its residuals.
function offlineMetrics(fitted: FittedPointingModel, residuals: readonly PointingSampleResidual[], training: readonly PointingFitSample[]): PointingOfflineMetrics {
	const raws = (heldOut: boolean) => residuals.filter((residual) => residual.heldOut === heldOut).map((residual) => Math.hypot(residual.rawDx, residual.rawDy))
	const withheld = residuals.filter((residual) => residual.heldOut).map((residual) => Math.hypot(residual.dx, residual.dy))
	const perSide: Record<PierSide, number> = { EAST: 0, WEST: 0, NEITHER: 0 }

	for (const { pierSide } of training) perSide[pierSide]++

	const rawRms = rootMeanSquare(raws(false))
	const heldOutRawRms = rootMeanSquare(raws(true))
	const heldOutRms = rootMeanSquare(withheld)
	const { angularRms, looRms } = fitted.diagnostics

	return {
		...(rawRms !== undefined && { rawRms }),
		...(fitted.usable && Number.isFinite(angularRms) && { trainingRms: angularRms }),
		...(fitted.usable && looRms !== undefined && Number.isFinite(looRms) && { looRms }),
		...(heldOutRawRms !== undefined && { heldOutRawRms }),
		...(heldOutRms !== undefined && {
			heldOutRms,
			heldOutP95: percentileOf(
				withheld.toSorted((a, b) => a - b),
				0.95,
			),
		}),
		heldOutCount: withheld.length,
		perSide,
	}
}

// Judges a fit: the toolkit must have determined it, and enough withheld samples must show it removes most of the error
// on sky it has not seen, on every pier side it was trained on.
function gateOf(fitted: FittedPointingModel, offline: PointingOfflineMetrics, heldOut: readonly PointingFitSample[]): PointingGate {
	if (!fitted.usable) return 'unusable'
	if (offline.heldOutCount < GATE_MINIMUM_HELD_OUT) return 'failed'
	if (offline.heldOutRms === undefined || offline.heldOutRawRms === undefined) return 'failed'
	if (!(offline.heldOutRms < offline.heldOutRawRms * GATE_MAXIMUM_RESIDUAL_RATIO)) return 'failed'

	for (const side of ['EAST', 'WEST'] as const) {
		if (offline.perSide[side] > 0 && !heldOut.some((sample) => sample.pierSide === side)) return 'failed'
	}

	return 'passed'
}

// Fits a model and measures it. Pure and CPU bound: it runs on the worker, or in tests.
export function computePointingFit(request: PointingFitRequest): PointingFitResult {
	const { strategy, site, training, heldOut } = request
	const samples = training.map((sample) => toolkitSample(sample, site))
	const options = pointingFitOptions(request)
	const fitted = strategy === 'auto' ? selectPointingStrategy(samples, options) : fitPointingModel(samples, { ...options, strategy })
	const residuals = [...training.map((sample) => residualOf(sample, false, fitted, site)), ...heldOut.map((sample) => residualOf(sample, true, fitted, site))]
	const offline = offlineMetrics(fitted, residuals, training)
	return { fitted, residuals, offline, gate: gateOf(fitted, offline, heldOut) }
}

// Runs fits on a worker of their own, one at a time, in arrival order.
export class PointingModelFitter {
	// Worker kept between fits.
	#idle?: PointingFitWorker
	// Settles when the previous fit ended.
	#queue: Promise<unknown> = Promise.resolve()

	// Fits a request. Rejects when the worker failed or timed out, or signal aborted it.
	fit(request: PointingFitRequest, signal?: AbortSignal): Promise<PointingFitResult> {
		const run = this.#queue.then(() => this.#fit(request, signal))
		this.#queue = run.catch(() => undefined)
		return run
	}

	// Runs one fit on the worker.
	async #fit(request: PointingFitRequest, signal?: AbortSignal): Promise<PointingFitResult> {
		signal?.throwIfAborted()

		const worker = this.#idle ?? this.#startWorker()
		this.#idle = undefined
		const { promise, resolve, reject } = Promise.withResolvers<PointingFitResult>()
		const jobId = crypto.randomUUID()
		let reusable = false

		const onMessage = (event: MessageEvent<PointingFitWorkerResponse>) => {
			const response = event.data
			if (response.jobId !== jobId) return
			// A fit that threw leaves the worker usable; only a crash, a timeout, or a cancel does not.
			reusable = true
			if (response.status === 'fitted') resolve(response.result)
			else reject(new Error(`The fit failed: ${response.error}`))
		}

		const onError = (event: ErrorEvent) => reject(new Error(`The fit worker died: ${event.message}`))
		const onAbort = () => reject(signal?.reason)
		const timer = setTimeout(() => reject(new Error(`The fit did not finish within ${FIT_TIMEOUT / 1000} s`)), FIT_TIMEOUT)

		worker.addEventListener('message', onMessage)
		worker.addEventListener('error', onError)
		signal?.addEventListener('abort', onAbort, { once: true })

		try {
			worker.postMessage({ jobId, request, earthOrientation: earthOrientationInstalled() } satisfies PointingFitWorkerRequest, [])
			return await promise
		} finally {
			clearTimeout(timer)
			worker.removeEventListener('message', onMessage)
			worker.removeEventListener('error', onError)
			signal?.removeEventListener('abort', onAbort)
			// A fit cannot be interrupted, so a worker still running one is terminated.
			if (reusable) this.#idle = worker
			else worker.terminate()
		}
	}

	// Starts a fit worker.
	#startWorker(): PointingFitWorker {
		// The compiled executable defines the embedded path of the worker (see app/build.ts); elsewhere it is
		// resolved next to this module.
		const worker = new Worker(process.env.NEBULOSA_MOUNTPOINTING_WORKER ?? new URL('./mountpointing.worker.ts', import.meta.url)) as PointingFitWorker
		// An idle worker must not keep the process alive on its own.
		worker.unref()
		return worker
	}
}
