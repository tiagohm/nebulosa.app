import type { StarProfileFlag } from 'nebulosa/src/imaging/stars/profile'

// Texts of a star's profile, shared by the Star Profile of the Guiding panel and the Star Profile Inspector.

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

// Formats an optional number with digits decimals, or a dash when it is absent.
export function formatNumber(value: number | undefined, digits: number) {
	return value === undefined ? '—' : value.toFixed(digits)
}

// Formats an optional width given in pixels, with its value in arcseconds when the pixel scale (arcsec/px) is known.
export function formatWidth(pixels: number | undefined, pixelScale?: number) {
	if (pixels === undefined) return '—'
	return pixelScale === undefined ? `${pixels.toFixed(2)} px` : `${pixels.toFixed(2)} px (${(pixels * pixelScale).toFixed(2)}")`
}
