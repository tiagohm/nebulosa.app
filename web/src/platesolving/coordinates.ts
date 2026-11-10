import { formatDEC, formatRA, normalizeAngle, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { formatFixed, MISSING } from '../format'
import type { Point } from '../viewer/transform'
import type { CoordinateFormat } from './preferences'
import type { WcsFrame } from './wcs'

// Text of the astrometric values of a solved image, for display and for the clipboard: sky positions in the format and
// decimals of the profile (sexagesimal through the toolkit's formatRA and formatDEC, which carry a rounded 60 into the
// next field, or decimal degrees), position angles, pixel scales, and zero-based pixels. Angular sizes and offsets are
// written by `formatAngularSize` and `formatSignedAngle` of `format.ts`. The decimals are a presentation choice, never a
// claim of accuracy. A missing or non-finite value is written MISSING, never 0 or NaN; a right ascension or position
// angle that rounds up to a full turn reads 0, and a declination keeps its sign even when it rounds to zero, as in
// sexagesimal, so a position just south of the equator still reads south.

// How sky coordinates are written.
export interface CoordinateStyle {
	// Sexagesimal or decimal degrees.
	readonly format: CoordinateFormat
	// Decimals of the seconds in sexagesimal (0 to 3); decimal degrees get four more.
	readonly precision: number
}

// Returns an angle in radians as degrees in [0, 360) with `digits` decimals, wrapped after rounding: "0.00°", never
// "360.00°".
function fullTurnDegrees(angle: number, digits: number) {
	const text = formatFixed(toDeg(normalizeAngle(angle)), digits)
	if (text === MISSING) return MISSING
	return `${Number(text) >= 360 ? formatFixed(0, digits) : text}°`
}

// Returns a right ascension in radians as hours, minutes, and seconds ("10 44 04.2"), or decimal degrees in [0, 360)
// ("161.01758°").
export function formatRightAscensionAs(rightAscension: number, style: CoordinateStyle): string {
	if (!Number.isFinite(rightAscension)) return MISSING
	if (style.format === 'decimal') return fullTurnDegrees(rightAscension, style.precision + 4)
	return formatRA(normalizeAngle(rightAscension), style.precision === 0 ? false : style.precision)
}

// Returns a declination in radians as signed degrees, minutes, and seconds ("-59 36 07.1"), or signed decimal degrees
// ("-59.60197°").
export function formatDeclinationAs(declination: number, style: CoordinateStyle): string {
	if (!Number.isFinite(declination)) return MISSING
	if (style.format === 'decimal') return `${declination < 0 ? '-' : '+'}${Math.abs(toDeg(declination)).toFixed(style.precision + 4)}°`
	return formatDEC(declination, style.precision === 0 ? false : style.precision)
}

// Returns a sky position in radians and its frame as one line for the clipboard: "10 44 04.2 -59 36 07.1 (ICRS)", or
// MISSING when either coordinate is.
export function formatSkyPosition([rightAscension, declination]: readonly [number, number], frame: WcsFrame, style: CoordinateStyle): string {
	if (!Number.isFinite(rightAscension) || !Number.isFinite(declination)) return MISSING
	return `${formatRightAscensionAs(rightAscension, style)} ${formatDeclinationAs(declination, style)} (${frame})`
}

// Returns a zero-based pixel as "x, y".
export function formatPixel(pixel: Point): string {
	return `${pixel.x}, ${pixel.y}`
}

// Returns a position angle in radians as degrees from north through east in [0, 360) with `digits` decimals (2 by
// default): "123.45°", or MISSING when undefined.
export function formatPositionAngle(angle: number | undefined, digits: number = 2): string {
	return angle === undefined ? MISSING : fullTurnDegrees(angle, digits)
}

// Returns a pixel scale in radians per pixel as arcseconds per pixel ("2.736″/px").
export function formatPixelScale(scale: number): string {
	const text = formatFixed(toArcsec(scale), 3)
	return text === MISSING ? MISSING : `${text}″/px`
}
