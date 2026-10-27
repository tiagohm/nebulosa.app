import { maxExposureBeforeTrail, requiredSubframeCount, stackingMagnitudeGain, stackingSnrGain, starTrailLength, totalIntegrationTime } from 'nebulosa/src/astronomy/formulas'
import { deg } from 'nebulosa/src/math/units/angle'
import { isFraming, type OpticalConfiguration, resolveFraming } from '../../sky/framing'
import { between, newCheck, NON_NEGATIVE, optional, type Outcome, outcome, POSITIVE, POSITIVE_INTEGER, positiveText, ready, required } from './values'

// Exposure & Integration calculators. Exposure Planner relates the subexposure, the number of frames, and the total
// integration, in one explicit direction, with the idealized gain of stacking. Star Trailing gives the sidereal drift
// of an untracked star in pixels during an exposure, and the longest exposure within a trail budget. Times are seconds
// (the target integration hours), declinations degrees in the fields and radians for the formulas.

// Direction of the Exposure Planner calculation: from a frame count, or from a target integration time.
export type PlanMode = 'count' | 'time'

// Fields of Exposure Planner, as typed.
export interface ExposurePlanDraft {
	// Direction of the calculation.
	readonly mode: PlanMode
	// Exposure of one subframe in seconds.
	readonly subExposure: string
	// Number of subframes; read from a frame count.
	readonly frameCount: string
	// Target integration in hours; read from a target time.
	readonly targetHours: string
}

// Results of Exposure Planner.
export interface ExposurePlanResult {
	// Whole subframes, entered or needed to reach the target.
	readonly frames: number
	// Total integration of those subframes in seconds.
	readonly total: number
	// Signal-to-noise gain of stacking them over one subframe, √N.
	readonly snrGain: number
	// Limiting magnitude gain of stacking them, in magnitudes.
	readonly magnitudeGain: number
}

// Fields of Star Trailing, as typed.
export interface StarTrailDraft {
	// Declination of the star in degrees, [-90, 90].
	readonly declination: string
	// Image scale in arcseconds per pixel.
	readonly scale: string
	// Exposure in seconds; optional, for the trail.
	readonly exposure: string
	// Largest acceptable trail in pixels; optional, for the longest exposure.
	readonly trailLimit: string
}

// Results of Star Trailing.
export interface StarTrailResult {
	// Trail of the exposure in pixels; absent without an exposure.
	readonly trail: number | undefined
	// Longest exposure in seconds within the trail budget; absent without a budget.
	readonly maxExposure: Outcome<number> | undefined
}

// Example of Exposure Planner: 120 subframes of 300 s.
export const EXPOSURE_PLAN_EXAMPLE: ExposurePlanDraft = { mode: 'count', subExposure: '300', frameCount: '120', targetHours: '10' }

// Computes Exposure Planner in its mode; a target time is covered by whole subframes, rounding up.
export function exposurePlan(draft: ExposurePlanDraft): Outcome<ExposurePlanResult> {
	const check = newCheck()
	const subExposure = required(check, 'Subexposure', draft.subExposure, POSITIVE)
	const count = draft.mode === 'count' ? required(check, 'Frames', draft.frameCount, POSITIVE_INTEGER) : Number.NaN
	const targetHours = draft.mode === 'time' ? required(check, 'Target integration', draft.targetHours, POSITIVE) : Number.NaN

	return outcome(check, () => {
		// The target is rounded to the millisecond, so a decimal number of hours such as 1.1 h is not inflated by binary
		// rounding into one more subframe.
		const frames = draft.mode === 'count' ? count : requiredSubframeCount(Math.round(targetHours * 3_600_000) / 1000, subExposure)
		return ready({ frames, total: totalIntegrationTime(frames, subExposure), snrGain: stackingSnrGain(frames), magnitudeGain: stackingMagnitudeGain(frames) })
	})
}

// Returns the Star Trailing field an optical configuration fills: its image scale.
export function starTrailFromOptics(optics: Readonly<OpticalConfiguration>): Pick<StarTrailDraft, 'scale'> {
	const framing = resolveFraming(optics)
	return { scale: isFraming(framing) && framing.scale !== undefined ? positiveText(Number(framing.scale.toFixed(3))) : '' }
}

// Example of Star Trailing: 30 s at declination +30° on 1.29″/px, with a 1 px budget.
export const STAR_TRAIL_EXAMPLE: StarTrailDraft = { declination: '30', scale: '1.29', exposure: '30', trailLimit: '1' }

// Computes Star Trailing. At least the exposure or the trail budget is needed. At a celestial pole the model has no
// drift, so it sets no exposure limit.
export function starTrail(draft: StarTrailDraft): Outcome<StarTrailResult> {
	const check = newCheck()
	const declination = required(check, 'Declination', draft.declination, between(-90, 90))
	const scale = required(check, 'Image scale', draft.scale, POSITIVE)
	const exposure = optional(check, 'Exposure', draft.exposure, NON_NEGATIVE)
	const trailLimit = optional(check, 'Trail budget', draft.trailLimit, NON_NEGATIVE)
	if (draft.exposure.trim() === '' && draft.trailLimit.trim() === '') check.missing.push('Exposure or Trail budget')

	return outcome(check, () => {
		const dec = deg(declination)
		return ready({ trail: exposure === undefined ? undefined : starTrailLength(dec, exposure, scale), maxExposure: trailLimit === undefined ? undefined : exposureWithinTrail(trailLimit, scale, dec) })
	})
}

// Longest exposure within a trail budget, or why the model sets none at a celestial pole.
function exposureWithinTrail(trailLimit: number, scale: number, declination: number): Outcome<number> {
	try {
		return ready(maxExposureBeforeTrail(trailLimit, scale, declination))
	} catch (e) {
		if (e instanceof RangeError) return { status: 'unbounded', explanation: 'At a celestial pole the sidereal drift vanishes in this model, so it sets no exposure limit.' }
		throw e
	}
}
