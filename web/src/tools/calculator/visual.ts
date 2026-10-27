import { dawesLimit, effectiveApertureWithObstruction, exitPupilFromApertureAndMagnification, eyepieceTrueFovViaFieldStop, eyepieceView, lightGraspRatio, limitingMagnitude, magnification, obstructionRatio, rayleighLimit } from 'nebulosa/src/astronomy/formulas'
import type { OpticalConfiguration } from '../../sky/framing'
import { between, newCheck, optional, type Outcome, outcome, POSITIVE, positiveText, ready, required } from './values'

// Visual Observation calculators. Eyepiece & Telescope gives the magnification, exit pupil, and true field of an
// eyepiece, with the resolving and limiting magnitude estimates of the aperture. Aperture Comparison compares the light
// grasp of two apertures, clear and with their central obstructions. Lengths are millimeters, fields degrees,
// resolving limits arcseconds.

// Fields of Eyepiece & Telescope, as typed.
export interface EyepieceDraft {
	// Effective focal length of the telescope in millimeters, with any Barlow or reducer.
	readonly focalLength: string
	// Aperture in millimeters.
	readonly aperture: string
	// Focal length of the eyepiece in millimeters.
	readonly eyepiece: string
	// Apparent field of the eyepiece in degrees; optional, for the true field.
	readonly apparentField: string
	// Field stop diameter of the eyepiece in millimeters; optional, for the true field it gives.
	readonly fieldStop: string
}

// Results of Eyepiece & Telescope.
export interface EyepieceResult {
	// Magnification.
	readonly magnification: number
	// Exit pupil in millimeters.
	readonly exitPupil: number
	// True field in degrees from the apparent field; absent without it.
	readonly trueField: number | undefined
	// True field in degrees from the field stop; absent without it.
	readonly fieldStopTrueField: number | undefined
	// Dawes limit in arcseconds.
	readonly dawes: number
	// Rayleigh limit in arcseconds.
	readonly rayleigh: number
	// Limiting stellar magnitude.
	readonly limitingMagnitude: number
}

// Name of a side of Aperture Comparison.
export type ApertureSide = 'A' | 'B'

// Fields of Aperture Comparison, as typed.
export interface ApertureComparisonDraft {
	// Aperture A in millimeters.
	readonly apertureA: string
	// Central obstruction diameter of A in millimeters; optional.
	readonly obstructionA: string
	// Aperture B in millimeters.
	readonly apertureB: string
	// Central obstruction diameter of B in millimeters; optional.
	readonly obstructionB: string
}

// One side of Aperture Comparison.
export interface ApertureSideResult {
	// Obstruction in percent of the aperture diameter; absent without an obstruction.
	readonly obstruction: number | undefined
	// Diameter of a clear aperture with the same collecting area in millimeters.
	readonly effectiveAperture: number
}

// Light grasp ratio of two apertures, from the larger to the smaller.
export interface LightGrasp {
	// Ratio of collecting areas, at least 1.
	readonly ratio: number
	// Side with the larger area; absent when both are equal.
	readonly larger: ApertureSide | undefined
}

// Results of Aperture Comparison.
export interface ApertureComparisonResult {
	// Light grasp of the clear apertures.
	readonly clear: LightGrasp
	// Light grasp of the collecting areas left by the obstructions; absent without any obstruction.
	readonly collecting: LightGrasp | undefined
	// Each side.
	readonly sides: Readonly<Record<ApertureSide, ApertureSideResult>>
}

// Returns the Eyepiece & Telescope fields an optical configuration fills: its effective focal length and aperture.
export function eyepieceFromOptics(optics: Readonly<OpticalConfiguration>): Pick<EyepieceDraft, 'focalLength' | 'aperture'> {
	return { focalLength: positiveText(Number((optics.focalLength * optics.focalMultiplier).toFixed(1))), aperture: positiveText(optics.aperture) }
}

// Example of Eyepiece & Telescope: a 200 mm f/5 telescope with a 25 mm eyepiece of 68°.
export const EYEPIECE_EXAMPLE: EyepieceDraft = { focalLength: '1000', aperture: '200', eyepiece: '25', apparentField: '68', fieldStop: '' }

// Computes Eyepiece & Telescope.
export function eyepiece(draft: EyepieceDraft): Outcome<EyepieceResult> {
	const check = newCheck()
	const focalLength = required(check, 'Focal length', draft.focalLength, POSITIVE)
	const aperture = required(check, 'Aperture', draft.aperture, POSITIVE)
	const eyepieceFocalLength = required(check, 'Eyepiece focal length', draft.eyepiece, POSITIVE)
	const apparentField = optional(check, 'Apparent field', draft.apparentField, between(0, 180, true, true))
	const fieldStop = optional(check, 'Field stop', draft.fieldStop, POSITIVE)

	return outcome(check, () => {
		const power = magnification(focalLength, eyepieceFocalLength)

		return ready({
			magnification: power,
			exitPupil: exitPupilFromApertureAndMagnification(aperture, power),
			trueField: apparentField === undefined ? undefined : eyepieceView(focalLength, aperture, eyepieceFocalLength, apparentField).trueFieldOfViewDegrees,
			fieldStopTrueField: fieldStop === undefined ? undefined : eyepieceTrueFovViaFieldStop(fieldStop, focalLength),
			dawes: dawesLimit(aperture),
			rayleigh: rayleighLimit(aperture),
			limitingMagnitude: limitingMagnitude(aperture),
		})
	})
}

// Example of Aperture Comparison: a 200 mm reflector with a 70 mm secondary against a 100 mm refractor.
export const APERTURE_COMPARISON_EXAMPLE: ApertureComparisonDraft = { apertureA: '200', obstructionA: '70', apertureB: '100', obstructionB: '' }

// Returns the light grasp ratio of two diameters, from the larger to the smaller.
function compare(a: number, b: number): LightGrasp {
	return { ratio: lightGraspRatio(Math.max(a, b), Math.min(a, b)), larger: a === b ? undefined : a > b ? 'A' : 'B' }
}

// Computes Aperture Comparison. An obstruction must be smaller than its aperture.
export function apertureComparison(draft: ApertureComparisonDraft): Outcome<ApertureComparisonResult> {
	const check = newCheck()
	const apertureA = required(check, 'Aperture A', draft.apertureA, POSITIVE)
	const obstructionA = optional(check, 'Obstruction A', draft.obstructionA, POSITIVE)
	const apertureB = required(check, 'Aperture B', draft.apertureB, POSITIVE)
	const obstructionB = optional(check, 'Obstruction B', draft.obstructionB, POSITIVE)
	if (obstructionA !== undefined && obstructionA >= apertureA) check.invalid.push('Obstruction A must be smaller than aperture A.')
	if (obstructionB !== undefined && obstructionB >= apertureB) check.invalid.push('Obstruction B must be smaller than aperture B.')

	return outcome(check, () => {
		// Returns one side: a clear aperture keeps its diameter.
		const side = (aperture: number, obstruction: number | undefined): ApertureSideResult => (obstruction === undefined ? { obstruction: undefined, effectiveAperture: aperture } : { obstruction: obstructionRatio(aperture, obstruction), effectiveAperture: effectiveApertureWithObstruction(aperture, obstruction) })
		const sides = { A: side(apertureA, obstructionA), B: side(apertureB, obstructionB) }
		const obstructed = obstructionA !== undefined || obstructionB !== undefined

		return ready({ clear: compare(apertureA, apertureB), collecting: obstructed ? compare(sides.A.effectiveAperture, sides.B.effectiveAperture) : undefined, sides })
	})
}
