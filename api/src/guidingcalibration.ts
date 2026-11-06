import type { GuidingCalibrationAssessment, GuidingCalibrationQuality } from 'nebulosa/src/observation/guiding/calibration.quality'
import { effectiveGuidingCalibration, type GuidingCalibrationApplicability, type GuidingCalibrationContext, type GuidingCalibrationRecord, type GuidingCalibrationTransformOptions } from 'nebulosa/src/observation/guiding/calibration.transform'

// Which saved guiding calibration a guiding session may restore. A calibration solved once is kept with the evidence of
// the equipment and geometry it was measured with: the physical guide camera, guide output and mount (by their hardware
// keys, stable across restarts of the server and reconnects of the same endpoint; names are for people only), the binning
// and size of the guide frames, the pixel scale of the guide optics and the guide rate of the guide output. A session
// restores one only when every piece of that evidence matches its own, and the toolkit can derive it for the current
// declination and side of the pier (effectiveGuidingCalibration); among those it prefers the best graded, then the
// newest. Every other one is listed with the machine-readable reasons it was set aside, so nothing is restored by a
// guess. Pure: the store keeps the calibrations, the guiding service gathers the evidence.

// Relative tolerance of the pixel scale and of each guide rate between a saved calibration and a session: 1%, far below
// the change of a guide optics, a reducer or a guide-rate setting, above the rounding of the values the drivers report.
export const GUIDING_EVIDENCE_TOLERANCE = 0.01

// Physical device of a calibration, as it identifies itself.
export interface GuidingDeviceIdentity {
	// Resource key of the device (its hardware id, with :guideOutput for the guide port of a non-mount), stable across
	// restarts of the server and reconnects of the same endpoint.
	readonly key: string
	// Name of the device, for people; never compared.
	readonly name: string
	// Executable of its driver, compared when both sides know it.
	readonly driver?: string
}

// Equipment and geometry a calibration was measured with.
export interface GuidingCalibrationEvidence {
	readonly camera: GuidingDeviceIdentity
	readonly guideOutput: GuidingDeviceIdentity
	// Mount the guide output drives; absent when the Equipment Setup has none.
	readonly mount?: GuidingDeviceIdentity
	// Binning of the guide frames.
	readonly binX: number
	readonly binY: number
	// Size of the guide frames, in pixels.
	readonly width: number
	readonly height: number
	// Pixel scale of the guide frames, in arcseconds per pixel; absent while the optics are unknown.
	readonly pixelScale?: number
	// Guide rates of the guide output, as fractions of the sidereal rate; absent when it reports none.
	readonly guideRate?: { readonly rightAscension: number; readonly declination: number }
}

// A saved calibration as the store returns it.
export interface StoredGuidingCalibration {
	readonly status: 'valid'
	readonly calibrationId: string
	// When it completed, Unix milliseconds (UTC).
	readonly createdAt: number
	readonly disabled: boolean
	// When a session last restored it, Unix milliseconds (UTC).
	readonly lastUsedAt?: number
	// Source record, validated when read.
	readonly record: GuidingCalibrationRecord
	readonly evidence: GuidingCalibrationEvidence
	readonly assessment: GuidingCalibrationAssessment
}

// A saved calibration whose payload could not be read back, kept only to be listed with its reason.
export interface InvalidGuidingCalibration {
	readonly status: 'invalid'
	readonly calibrationId: string
	readonly createdAt: number
	readonly disabled: boolean
	// Why the payload was refused.
	readonly reason: string
}

// A row of the store.
export type GuidingCalibrationEntry = StoredGuidingCalibration | InvalidGuidingCalibration

// Why a saved calibration does not fit a session: a device, the binning, the frame size, the pixel scale or the guide
// rate differs, the operator disabled it, its payload is invalid, or the toolkit refused it for the mount context
// (pierSideUnknown, declinationUnknown, sourceNearPole, declinationNearPole, rateTooSmall).
export type GuidingCalibrationRejection = 'camera' | 'guideOutput' | 'mount' | 'binning' | 'frameSize' | 'pixelScale' | 'guideRate' | 'disabled' | 'invalid' | 'pierSideUnknown' | 'declinationUnknown' | 'sourceNearPole' | 'declinationNearPole' | 'rateTooSmall'

// How a saved calibration fits a session.
export interface GuidingCalibrationCandidate {
	readonly calibrationId: string
	readonly createdAt: number
	// Grade of the solution; absent for an invalid payload.
	readonly quality?: GuidingCalibrationQuality
	// Usable as it is or transformed, or why not: different equipment or geometry, a mount context the toolkit cannot
	// trust or needs a new calibration for, disabled, or invalid.
	readonly status: 'direct' | 'transformed' | 'incompatible' | 'insufficientEvidence' | 'requiresRecalibration' | 'disabled' | 'invalid'
	readonly reasons: readonly GuidingCalibrationRejection[]
}

// Outcome of a selection: the calibration to restore, if any, with the calibration derived for the context, and every
// candidate by decreasing preference, the usable ones first.
export interface GuidingCalibrationSelection {
	readonly selected?: { readonly entry: StoredGuidingCalibration; readonly applicability: Extract<GuidingCalibrationApplicability, { readonly status: 'direct' | 'transformed' }> }
	readonly candidates: readonly GuidingCalibrationCandidate[]
}

// Preference of a grade, the best first.
const QUALITY_RANK: Readonly<Record<GuidingCalibrationQuality, number>> = { good: 0, warning: 1, poor: 2 }

// Returns the key of the equipment of the evidence: the keys of the guide camera, the guide output and the mount joined,
// which the saved calibrations of the same equipment share.
export function equipmentKeyOf({ camera, guideOutput, mount }: Pick<GuidingCalibrationEvidence, 'camera' | 'guideOutput' | 'mount'>) {
	return `${camera.key}|${guideOutput.key}|${mount?.key ?? ''}`
}

// Returns why the evidence of a saved calibration does not match the evidence of a session, empty when it does.
export function evidenceRejections(saved: GuidingCalibrationEvidence, current: GuidingCalibrationEvidence): GuidingCalibrationRejection[] {
	const reasons: GuidingCalibrationRejection[] = []
	if (!sameDevice(saved.camera, current.camera)) reasons.push('camera')
	if (!sameDevice(saved.guideOutput, current.guideOutput)) reasons.push('guideOutput')
	if (!(saved.mount === undefined ? current.mount === undefined : current.mount !== undefined && sameDevice(saved.mount, current.mount))) reasons.push('mount')
	if (saved.binX !== current.binX || saved.binY !== current.binY) reasons.push('binning')
	if (saved.width !== current.width || saved.height !== current.height) reasons.push('frameSize')
	if (!sameMeasure(saved.pixelScale, current.pixelScale)) reasons.push('pixelScale')
	if (!(saved.guideRate === undefined ? current.guideRate === undefined : current.guideRate !== undefined && sameMeasure(saved.guideRate.rightAscension, current.guideRate.rightAscension) && sameMeasure(saved.guideRate.declination, current.guideRate.declination))) reasons.push('guideRate')
	return reasons
}

// Selects the saved calibration a session may restore among entries, for its evidence and mount context: every entry is
// assessed, the usable ones are ranked by grade then newest first, and the first of them is selected.
export function selectGuidingCalibration(entries: readonly GuidingCalibrationEntry[], evidence: GuidingCalibrationEvidence, context: GuidingCalibrationContext, options: GuidingCalibrationTransformOptions): GuidingCalibrationSelection {
	const usable: { entry: StoredGuidingCalibration; applicability: NonNullable<GuidingCalibrationSelection['selected']>['applicability']; candidate: GuidingCalibrationCandidate }[] = []
	const rejected: GuidingCalibrationCandidate[] = []

	for (const entry of entries) {
		const { calibrationId, createdAt } = entry

		if (entry.status === 'invalid') {
			rejected.push({ calibrationId, createdAt, status: 'invalid', reasons: ['invalid'] })
			continue
		}

		const quality = entry.assessment.quality

		if (entry.disabled) {
			rejected.push({ calibrationId, createdAt, quality, status: 'disabled', reasons: ['disabled'] })
			continue
		}

		const mismatches = evidenceRejections(entry.evidence, evidence)

		if (mismatches.length > 0) {
			rejected.push({ calibrationId, createdAt, quality, status: 'incompatible', reasons: mismatches })
			continue
		}

		const applicability = effectiveGuidingCalibration(entry.record, context, options)

		if ('calibration' in applicability) {
			usable.push({ entry, applicability, candidate: { calibrationId, createdAt, quality, status: applicability.status, reasons: [] } })
		} else {
			rejected.push({ calibrationId, createdAt, quality, status: applicability.status, reasons: applicability.reasons })
		}
	}

	usable.sort((a, b) => QUALITY_RANK[a.entry.assessment.quality] - QUALITY_RANK[b.entry.assessment.quality] || b.entry.createdAt - a.entry.createdAt)
	rejected.sort((a, b) => b.createdAt - a.createdAt)
	const best = usable[0]

	return { ...(best && { selected: { entry: best.entry, applicability: best.applicability } }), candidates: [...usable.map((item) => item.candidate), ...rejected] }
}

// Whether two identities are the same physical device: the same key, and the same driver when both know it.
function sameDevice(a: GuidingDeviceIdentity, b: GuidingDeviceIdentity) {
	return a.key === b.key && (a.driver === undefined || b.driver === undefined || a.driver === b.driver)
}

// Whether two optional measures agree within GUIDING_EVIDENCE_TOLERANCE, both absent included.
function sameMeasure(a: number | undefined, b: number | undefined) {
	if (a === undefined || b === undefined) return a === b
	return Math.abs(a - b) <= GUIDING_EVIDENCE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b))
}
