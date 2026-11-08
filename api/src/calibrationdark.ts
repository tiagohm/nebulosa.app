import type { CalibrationMasterSummary } from './calibrationlibrary'
import { type CalibrationMetadata, type Evidenced, TEMPERATURE_SPREAD_LIMIT } from './calibrationlibrary.compatibility'

// Application of a master dark of the Calibration Library to one frame a service solves or measures. The library only
// lists masters whose known metadata agree with a target, and lets an unknown value pass; subtracting a master needs a
// stricter answer, given here for the actual metadata of the frame (its header), never for the settings asked for:
// exactly the same exposure, the same pixel grid (size, channels, CFA and its offsets, subframe origin), the same
// sample depth, and no known difference of binning, gain, offset, readout mode, temperature (beyond the library's
// spread limit), or camera name. What stays unknown is reported as unverified, never assumed equal: the library has no
// identity of a physical camera, so the camera is always unverified, and an uncooled camera that states no temperature
// leaves the temperature unverified. The subtraction itself runs on a worker of its own (calibrationdark.worker.ts):
// light minus dark in digital numbers on the raw mosaic, with no scaling, written back as FITS in the frame's own
// integer scale. Exposures are integer microseconds and temperatures degrees Celsius.

// What could not be checked between a frame and an eligible master; none of these refuses it.
export type DarkEvidence = 'camera' | 'temperature' | 'gain' | 'offset' | 'binning' | 'readoutMode' | 'origin'

// Why a master cannot be subtracted from a frame:
// - notDark: the master is not a dark.
// - exposureUnknown, exposureMismatch: an exposure is not stated, or they differ (no dark is ever scaled).
// - geometryMismatch: the size, channels, CFA, CFA offsets, or subframe origin differ, or a known nonzero origin faces
//   an unknown one.
// - binningMismatch, gainMismatch, offsetMismatch, readoutMismatch, bitDepthMismatch: known and different.
// - temperatureMismatch: both temperatures are known and more than TEMPERATURE_SPREAD_LIMIT apart.
// - differentCamera: both camera names are known and different.
export type DarkRejection = 'notDark' | 'exposureUnknown' | 'exposureMismatch' | 'geometryMismatch' | 'binningMismatch' | 'gainMismatch' | 'offsetMismatch' | 'readoutMismatch' | 'bitDepthMismatch' | 'temperatureMismatch' | 'differentCamera'

// Whether a master can be subtracted from a frame.
export type DarkAssessment =
	// It can, with what could not be checked.
	| { readonly eligible: true; readonly unverified: readonly DarkEvidence[] }
	// It cannot, and why, for people.
	| { readonly eligible: false; readonly code: DarkRejection; readonly reason: string }

// Judges whether the master dark can be subtracted from a frame, from the frame's actual metadata (inspectHeader of its
// header) and the master's. Pure.
export function assessDarkForFrame(frame: CalibrationMetadata, master: Pick<CalibrationMasterSummary, 'kind' | 'metadata'>): DarkAssessment {
	const dark = master.metadata
	const unverified: DarkEvidence[] = ['camera']

	if (master.kind !== 'dark') return refused('notDark', 'The master is not a dark')

	const exposure = frame.exposure.value
	const darkExposure = dark.exposure.value
	if (exposure === undefined || darkExposure === undefined) return refused('exposureUnknown', exposure === undefined ? 'The frame does not state its exposure' : 'The dark does not state its exposure')
	if (exposure !== darkExposure) return refused('exposureMismatch', `The frame was exposed ${exposure / 1000} ms, the dark ${darkExposure / 1000} ms`)

	if (frame.width !== dark.width || frame.height !== dark.height || frame.channels !== dark.channels) return refused('geometryMismatch', `The frame is ${frame.width}×${frame.height}×${frame.channels}, the dark ${dark.width}×${dark.height}×${dark.channels}`)
	if (frame.cfa !== dark.cfa) return refused('geometryMismatch', `The frame has ${frame.cfa ? `the CFA ${frame.cfa}` : 'no CFA'}, the dark ${dark.cfa ? `the CFA ${dark.cfa}` : 'none'}`)
	if (differ(frame.bayerOffsetX, dark.bayerOffsetX) || differ(frame.bayerOffsetY, dark.bayerOffsetY)) return refused('geometryMismatch', 'The CFA offsets of the frame and of the dark differ')

	const origin = originAgreement(frame, dark)
	if (origin === 'different') return refused('geometryMismatch', 'The subframe origins of the frame and of the dark differ')
	if (origin === 'unknown') unverified.push('origin')

	if (frame.bitpix !== dark.bitpix) return refused('bitDepthMismatch', `The frame has BITPIX ${frame.bitpix}, the frames of the dark ${dark.bitpix}`)

	const binning = known(frame.binX, dark.binX) && known(frame.binY, dark.binY)
	if (binning && (frame.binX.value !== dark.binX.value || frame.binY.value !== dark.binY.value)) return refused('binningMismatch', `The frame is binned ${frame.binX.value}×${frame.binY.value}, the dark ${dark.binX.value}×${dark.binY.value}`)
	if (!binning) unverified.push('binning')

	const gain = check(frame.gain, dark.gain)
	if (gain === 'different') return refused('gainMismatch', `The frame has gain ${frame.gain.value}, the dark ${dark.gain.value}`)
	if (gain === 'unknown') unverified.push('gain')

	const offset = check(frame.offset, dark.offset)
	if (offset === 'different') return refused('offsetMismatch', `The frame has offset ${frame.offset.value}, the dark ${dark.offset.value}`)
	if (offset === 'unknown') unverified.push('offset')

	const readout = check(frame.readoutMode, dark.readoutMode)
	if (readout === 'different') return refused('readoutMismatch', `The frame was read in mode ${frame.readoutMode.value}, the dark in ${dark.readoutMode.value}`)
	if (readout === 'unknown') unverified.push('readoutMode')

	// The frame's measured temperature first; the master's set point first, as the library matches it.
	const temperature = frame.sensorTemperature.value ?? frame.setTemperature.value
	const darkTemperature = dark.setTemperature.value ?? dark.sensorTemperature.value
	if (temperature === undefined || darkTemperature === undefined) unverified.push('temperature')
	else if (!(Math.abs(temperature - darkTemperature) <= TEMPERATURE_SPREAD_LIMIT)) return refused('temperatureMismatch', `The frame is at ${temperature} °C, the dark at ${darkTemperature} °C`)

	if (frame.cameraName && dark.cameraName && frame.cameraName !== dark.cameraName) return refused('differentCamera', `The frame comes from ${frame.cameraName}, the dark from ${dark.cameraName}`)

	return { eligible: true, unverified }
}

// A refusal.
function refused(code: DarkRejection, reason: string): DarkAssessment {
	return { eligible: false, code, reason }
}

// Whether two optional numbers are both known and different.
function differ(a: number | undefined, b: number | undefined) {
	return a !== undefined && b !== undefined && a !== b
}

// Whether both evidenced values are known.
function known<T>(a: Evidenced<T>, b: Evidenced<T>) {
	return a.value !== undefined && b.value !== undefined
}

// Whether two evidenced values are equal, different, or not both known.
function check<T>(a: Evidenced<T>, b: Evidenced<T>): 'equal' | 'different' | 'unknown' {
	return known(a, b) ? (a.value === b.value ? 'equal' : 'different') : 'unknown'
}

// Agreement of the subframe origins: equal when both are known and equal, different when known and different or when a
// known nonzero origin faces an unknown one, and unknown otherwise (an unknown origin may well be the full frame).
function originAgreement(frame: Pick<CalibrationMetadata, 'originX' | 'originY'>, dark: Pick<CalibrationMetadata, 'originX' | 'originY'>): 'equal' | 'different' | 'unknown' {
	const a = frame.originX !== undefined && frame.originY !== undefined ? [frame.originX, frame.originY] : undefined
	const b = dark.originX !== undefined && dark.originY !== undefined ? [dark.originX, dark.originY] : undefined
	if (a && b) return a[0] === b[0] && a[1] === b[1] ? 'equal' : 'different'
	const nonzero = (origin: number[] | undefined) => origin !== undefined && (origin[0] !== 0 || origin[1] !== 0)
	if (nonzero(a) || nonzero(b)) return 'different'
	return 'unknown'
}

// Job of the dark worker: a frame file, the master to subtract from it, and the header keywords to leave out of the
// calibrated FITS (the pointing keywords of a blind plate solve).
export interface DarkWorkerRequest {
	readonly jobId: number
	// Path of the frame's FITS file.
	readonly framePath: string
	// Path of the master's FITS file, read while the caller holds a lease of it.
	readonly darkPath: string
	// Full scale of the master's digital numbers (its fullScaleDn), dividing it into the normalized scale of calibrate.
	readonly fullScale: number
	// Identity of the master, `<masterId>:<digest>`: the worker reads a master again when it changes.
	readonly masterKey: string
	// Header keywords left out of the calibrated FITS.
	readonly omit: readonly string[]
}

// Answer of the dark worker: the calibrated FITS, transferred, or why there is none.
export type DarkWorkerResponse = { readonly jobId: number; readonly bytes: Uint8Array<ArrayBuffer> } | { readonly jobId: number; readonly failed: string }

// Outcome of one subtraction.
export type DarkCalibration = { readonly bytes: Uint8Array<ArrayBuffer> } | { readonly failed: string }

// Dark worker of one session, started on its first job and terminated with the session. A crash fails the jobs in
// progress and the next job starts a new worker.
export class DarkCalibrator implements Disposable {
	#worker?: Worker
	#jobs = 0
	readonly #pending = new Map<number, PromiseWithResolvers<DarkCalibration>>()

	// Subtracts a master from a frame file on the worker. Resolves the calibrated FITS or why there is none; never rejects.
	calibrate(request: Omit<DarkWorkerRequest, 'jobId'>): Promise<DarkCalibration> {
		const jobId = ++this.#jobs
		const pending = Promise.withResolvers<DarkCalibration>()
		this.#pending.set(jobId, pending)
		this.#ensure().postMessage({ ...request, jobId } satisfies DarkWorkerRequest, [])
		return pending.promise
	}

	// Terminates the worker; the jobs in progress resolve as failed.
	[Symbol.dispose]() {
		const worker = this.#worker
		this.#worker = undefined
		worker?.terminate()
		this.#fail('The dark worker was stopped')
	}

	#ensure() {
		if (this.#worker) return this.#worker

		const worker = new Worker(process.env.NEBULOSA_CALIBRATIONDARK_WORKER ?? new URL('./calibrationdark.worker.ts', import.meta.url))
		worker.addEventListener('message', (event: MessageEvent<DarkWorkerResponse>) => {
			const pending = this.#pending.get(event.data.jobId)
			this.#pending.delete(event.data.jobId)
			pending?.resolve('bytes' in event.data ? { bytes: event.data.bytes } : { failed: event.data.failed })
		})
		worker.addEventListener('error', (event) => {
			if (this.#worker === worker) this.#worker = undefined
			worker.terminate()
			this.#fail(`The dark worker crashed: ${event.message}`)
		})
		this.#worker = worker
		return worker
	}

	#fail(reason: string) {
		for (const pending of this.#pending.values()) pending.resolve({ failed: reason })
		this.#pending.clear()
	}
}
