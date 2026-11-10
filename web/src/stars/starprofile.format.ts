import type { SampleConversion } from 'api'
import type { StarProfileFlag } from 'nebulosa/src/imaging/stars/profile'
import { MISSING } from '../format'

// Texts of a star's profile, shared by the Star Profile of the Guiding panel and the Star Profile Inspector. Intensities
// arrive as normalized samples and are written in the scale of the image's source: ADU, or that of the source when it has
// no ADU to speak of.

// Labels of the flags of a degraded or invalid measurement.
export const FLAG_LABELS: Readonly<Record<StarProfileFlag, string>> = {
	nonFinite: 'Non-finite samples',
	nearBorder: 'Near the border',
	clipped: 'Clipped aperture',
	saturated: 'Saturated',
	lowSignal: 'Low signal',
	invalidBackground: 'Invalid background',
	invalidCentroid: 'Invalid centroid',
	degenerateShape: 'Degenerate shape',
	blended: 'Blended',
	poorFit: 'Poor fit',
}

// Formats a value already in the scale of the source: whole ADU, or four significant digits of a unit it does not name.
function formatConverted(value: number, unit: SampleConversion['unit'], suffix = '') {
	return unit === 'adu' ? `${Math.round(value)} ADU${suffix}` : `${value.toPrecision(4)}${suffix}`
}

// Formats an optional level given in normalized samples, such as a sky background, or a dash when it is absent.
export function formatLevel(value: number | undefined, { unit, scale, offset }: SampleConversion) {
	return value === undefined ? MISSING : formatConverted(value * scale + offset, unit)
}

// Formats an optional signal given as a difference of normalized samples, such as a peak above the sky or a noise, or a
// dash when it is absent.
export function formatSignal(value: number | undefined, { unit, scale }: SampleConversion) {
	return value === undefined ? MISSING : formatConverted(value * scale, unit)
}

// Formats an optional flux, the sum of the signal of the pixels of an aperture given in normalized samples, or a dash when
// it is absent.
export function formatFlux(value: number | undefined, { unit, scale }: SampleConversion) {
	return value === undefined ? MISSING : formatConverted(value * scale, unit, '·px')
}
