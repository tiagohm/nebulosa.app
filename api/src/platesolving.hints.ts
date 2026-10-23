import { pixelScale } from 'nebulosa/src/astronomy/formulas'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { declinationKeyword, numericKeyword, rightAscensionKeyword } from 'nebulosa/src/io/formats/fits/util'
import { arcsec, deg, normalizeAngle } from 'nebulosa/src/math/units/angle'
import type { ImageAcquisition } from './images'

// Hints of a plate solve and where each one comes from. An operator's value wins; otherwise the pointing recorded
// in the image header (RA/DEC, OBJCTRA/OBJCTDEC, RA_OBJ/DEC_OBJ, then CRVAL1/CRVAL2, as the toolkit reads them) and
// the image scale of the optics recorded with it (XPIXSZ and FOCALLEN) are used, and nothing is invented when they
// are absent. The current position of a mount is never a hint: an image may have been taken anywhere. A blind solve
// sends no position at all, but keeps a scale hint when one is known, since a scale does not restrict the sky. A
// position without a radius gets DEFAULT_SEARCH_RADIUS. Angles are radians; the scale is radians per pixel.

// Strategy of a plate solve: assisted searches around a known position, blind searches the whole sky.
export type PlateSolveStrategy = 'assisted' | 'blind'

// Hints an operator gives a plate solve; each one absent lets the image decide.
export interface PlateSolveHints {
	// Right ascension of the search center, radians in [0, 2π).
	readonly rightAscension?: number
	// Declination of the search center, radians in [-π/2, π/2].
	readonly declination?: number
	// Search radius around the center, radians, positive.
	readonly radius?: number
	// Image scale, radians per pixel, positive.
	readonly scale?: number
}

// Origin of a hint: the operator, the image header, the optics recorded in the header, or the default radius.
export type PlateSolveHintSource = 'user' | 'header' | 'optics' | 'default'

// A hint as it is sent to the solver.
export interface PlateSolveHint {
	// Value of the hint, in the unit of its field.
	readonly value: number
	// Where it comes from.
	readonly source: PlateSolveHintSource
}

// Hints a plate solve actually uses, with their origins. A position is the pair of right ascension and declination,
// both present or both absent, and the radius is present only with them.
export interface ResolvedPlateSolveHints {
	// Right ascension of the search center, radians in [0, 2π).
	readonly rightAscension?: PlateSolveHint
	// Declination of the search center, radians in [-π/2, π/2].
	readonly declination?: PlateSolveHint
	// Search radius around the center, radians.
	readonly radius?: PlateSolveHint
	// Image scale, radians per pixel.
	readonly scale?: PlateSolveHint
}

// Search radius around a position given without one: 10°, wide enough for a pointing error of a few degrees.
export const DEFAULT_SEARCH_RADIUS = deg(10)

// Header keywords holding the pointing of an image, left out of the copy a blind solve reads, so a solver that
// looks at the header (ASTAP) does not search around them.
export const POINTING_KEYWORDS: readonly string[] = ['RA', 'DEC', 'OBJCTRA', 'OBJCTDEC', 'RA_OBJ', 'DEC_OBJ', 'CRVAL1', 'CRVAL2']

// Returns the hints a plate solve of an image uses: the operator's hints first, then the pointing and the optics
// of the header, for the given strategy (see the module description).
export function resolvePlateSolveHints(strategy: PlateSolveStrategy, header: FitsHeader, acquisition: ImageAcquisition, hints: PlateSolveHints = {}): ResolvedPlateSolveHints {
	const scale = scaleHint(header, acquisition, hints)
	if (strategy === 'blind') return { ...(scale && { scale }) }

	const position = positionHint(header, hints)
	if (!position) return { ...(scale && { scale }) }

	const radius: PlateSolveHint = validAngle(hints.radius) ? { value: hints.radius!, source: 'user' } : { value: DEFAULT_SEARCH_RADIUS, source: 'default' }
	return { ...position, radius, ...(scale && { scale }) }
}

// Returns the operator's position when both coordinates are given, otherwise the pointing of the header.
function positionHint(header: FitsHeader, { rightAscension, declination }: PlateSolveHints): Pick<ResolvedPlateSolveHints, 'rightAscension' | 'declination'> | undefined {
	if (rightAscension !== undefined && declination !== undefined && Number.isFinite(rightAscension) && Math.abs(declination) <= Math.PI / 2) {
		return { rightAscension: { value: normalizeAngle(rightAscension), source: 'user' }, declination: { value: declination, source: 'user' } }
	}

	const ra = rightAscensionKeyword(header, undefined)
	const dec = declinationKeyword(header, undefined)
	if (ra === undefined || dec === undefined || !Number.isFinite(ra) || !(Math.abs(dec) <= Math.PI / 2)) return undefined
	return { rightAscension: { value: normalizeAngle(ra), source: 'header' }, declination: { value: dec, source: 'header' } }
}

// Returns the operator's scale, otherwise the scale of the optics: XPIXSZ (the pixel width in micrometers after
// binning, as INDI and most capture programs write it) over FOCALLEN (millimeters).
function scaleHint(header: FitsHeader, { focalLength }: ImageAcquisition, { scale }: PlateSolveHints): PlateSolveHint | undefined {
	if (validAngle(scale)) return { value: scale!, source: 'user' }

	const pixelSize = numericKeyword(header, 'XPIXSZ', Number.NaN)
	if (!(pixelSize > 0 && Number.isFinite(pixelSize)) || focalLength === undefined || !(focalLength > 0)) return undefined
	return { value: arcsec(pixelScale(pixelSize, focalLength)), source: 'optics' }
}

// Whether an angle is a usable positive finite hint.
function validAngle(value: number | undefined) {
	return value !== undefined && value > 0 && Number.isFinite(value)
}
