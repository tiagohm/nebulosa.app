import { formatDEC, formatRA, normalizeAngle, toArcmin, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import type { Point } from '../viewer/transform'
import type { CoordinateFormat } from './preferences'
import type { WcsFrame } from './wcs'

// Text of the astrometric values of a solved image, for display and for the clipboard: sky positions in the format and
// decimals of the profile (sexagesimal through the toolkit's formatRA and formatDEC, or decimal degrees), angular
// sizes in the unit that suits them, position angles, and zero-based pixels. The decimals are a presentation choice,
// never a claim of accuracy. A missing value is written "—", never 0.

// Text of a value that is not available.
export const MISSING = '—'

// How sky coordinates are written.
export interface CoordinateStyle {
	// Sexagesimal or decimal degrees.
	readonly format: CoordinateFormat
	// Decimals of the seconds in sexagesimal (0 to 3); decimal degrees get four more.
	readonly precision: number
}

// Returns a right ascension in radians as hours, minutes, and seconds ("10 44 04.2"), or decimal degrees in [0, 360)
// ("161.01758°").
export function formatRightAscensionAs(rightAscension: number, style: CoordinateStyle): string {
	if (style.format === 'decimal') return `${toDeg(normalizeAngle(rightAscension)).toFixed(style.precision + 4)}°`
	return formatRA(normalizeAngle(rightAscension), style.precision === 0 ? false : style.precision)
}

// Returns a declination in radians as signed degrees, minutes, and seconds ("-59 36 07.1"), or signed decimal degrees
// ("-59.60197°").
export function formatDeclinationAs(declination: number, style: CoordinateStyle): string {
	if (style.format === 'decimal') return `${declination < 0 ? '-' : '+'}${Math.abs(toDeg(declination)).toFixed(style.precision + 4)}°`
	return formatDEC(declination, style.precision === 0 ? false : style.precision)
}

// Returns a sky position in radians and its frame as one line for the clipboard: "10 44 04.2 -59 36 07.1 (ICRS)".
export function formatSkyPosition([rightAscension, declination]: readonly [number, number], frame: WcsFrame, style: CoordinateStyle): string {
	return `${formatRightAscensionAs(rightAscension, style)} ${formatDeclinationAs(declination, style)} (${frame})`
}

// Returns a zero-based pixel as "x, y".
export function formatPixel(pixel: Point): string {
	return `${pixel.x}, ${pixel.y}`
}

// Returns an angle in radians in the unit that suits it: arcseconds below 1′ ("12.34″"), arcminutes below 1°
// ("12.34′"), degrees otherwise ("1.234°").
export function formatAngularSize(angle: number): string {
	if (angle < Math.PI / 10800) return `${toArcsec(angle).toFixed(2)}″`
	if (angle < Math.PI / 180) return `${toArcmin(angle).toFixed(2)}′`
	return `${toDeg(angle).toFixed(3)}°`
}

// Returns a signed angle in radians in the unit that suits its size, with its sign: "+12.34″", "−1.234°".
export function formatSignedAngle(angle: number): string {
	return `${angle < 0 ? '−' : '+'}${formatAngularSize(Math.abs(angle))}`
}

// Returns a position angle in radians as degrees from north through east ("123.45°"), or MISSING when undefined.
export function formatPositionAngle(angle: number | undefined): string {
	return angle === undefined ? MISSING : `${toDeg(angle).toFixed(2)}°`
}

// Returns a pixel scale in radians per pixel as arcseconds per pixel ("2.736″/px").
export function formatPixelScale(scale: number): string {
	return `${toArcsec(scale).toFixed(3)}″/px`
}
