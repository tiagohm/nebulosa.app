import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import type { PierSide } from 'nebulosa/src/devices/indi/device'
import { correctPointingCoordinate, type FittedPointingModel, predictPointingModelError } from 'nebulosa/src/observation/mount/pointing'
import { type EquatorialPosition, POINTING_MODEL_FRAME, type PointingSite } from './mountpointing.frames'

// Correction of a GoTo by a pointing model: the command that lands the mount on a target, or why there is none. It is
// synchronous, because a GoTo of Mount Remote Control is admitted or refused at once, so a model is held in memory and
// never fetched from a disk or a worker here. Nothing is trusted from the toolkit's result alone: an unusable model
// predicts zero with converged true, so the model, the support of the target, the pier side, and the inverse are all
// checked. Angles are radians, instants Unix milliseconds.

// Why a target cannot be corrected:
// - unusable: the toolkit could not determine the model.
// - extrapolating: the target is too far from any sample.
// - pierSide: the model has no sample on the pier side the mount would take.
// - clamped: the correction is larger than the toolkit allows, or the inverse left its domain.
// - notConverged: the inverse did not converge.
// - notFinite: the inverse gave no coordinate.
export type CorrectionRefusal = 'unusable' | 'extrapolating' | 'pierSide' | 'clamped' | 'notConverged' | 'notFinite'

// Message of each refusal, meant for people.
export const CORRECTION_REFUSALS: Readonly<Record<CorrectionRefusal, string>> = {
	unusable: 'The pointing model is not usable',
	extrapolating: 'The target is too far from the samples of the pointing model',
	pierSide: 'The pointing model has no samples on the pier side of the target',
	clamped: 'The correction of the pointing model is out of its limits',
	notConverged: 'The correction of the pointing model did not converge',
	notFinite: 'The correction of the pointing model gave no coordinate',
}

// Where a target is corrected for.
export interface CorrectionContext {
	// Instant of the command, in Unix milliseconds.
	readonly time: number
	// Site of the model.
	readonly site: PointingSite
	// Pier side the mount is expected to take.
	readonly pierSide: PierSide
}

// Outcome of a correction.
export type CorrectedCommand = { readonly ok: true; readonly command: EquatorialPosition } | { readonly ok: false; readonly reason: CorrectionRefusal }

// Returns the command, opaque coordinates of the driver, that lands a mount on an apparent target by a model.
export function correctedCommand(fitted: FittedPointingModel, target: EquatorialPosition, { time, site: { latitude, longitude }, pierSide }: CorrectionContext): CorrectedCommand {
	if (!fitted.usable) return { ok: false, reason: 'unusable' }

	const input = { ...target, time: timeUnix(time / 1000, true), latitude, longitude, pierSide, frame: POINTING_MODEL_FRAME } as const
	const { quality } = predictPointingModelError(fitted, input)
	if (quality.extrapolating) return { ok: false, reason: 'extrapolating' }
	if (!quality.pierSideCovered) return { ok: false, reason: 'pierSide' }

	const { rightAscension, declination, clamped, converged } = correctPointingCoordinate(fitted, input)
	if (clamped) return { ok: false, reason: 'clamped' }
	if (!converged) return { ok: false, reason: 'notConverged' }
	if (!Number.isFinite(rightAscension) || !Number.isFinite(declination)) return { ok: false, reason: 'notFinite' }
	return { ok: true, command: { rightAscension, declination } }
}
