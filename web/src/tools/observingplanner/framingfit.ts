import type { Framing } from '../../framing/geometry'
import type { StatusTone } from '../../ui/StatusBadge'

// How a target fits the field of view the profile plans with (the Equipment Setup's, or the active Sky Framing preset):
// a heuristic kept apart from the observing score, which it never changes. It compares the target's apparent axes with
// the sides of the field (the major axis with the long side, the minor with the short one, as with the camera turned to
// suit it) and, when the image scale is known, counts the pixels the major axis spans. It only orders and labels the
// best targets; it never makes a target eligible or not. Angles are radians.

// Arcseconds per radian.
const ARCSEC_PER_RADIAN = (180 / Math.PI) * 3600

// Share of the field, along its fuller axis, below which a target is small in the frame: 20 %.
export const SMALL_FILL = 0.2

// Share of the field above which a target fills it with little margin left for the framing: 80 %.
export const TIGHT_FILL = 0.8

// Pixels the major axis must span for the target to show structure rather than a few pixels: 30 px.
export const MINIMUM_PIXELS = 30

// Fit of a target in the field: small (a small share of it, or too few pixels), good, tight (fits with little margin), or
// mosaic (larger than the field).
export type FramingFit = 'small' | 'good' | 'tight' | 'mosaic'

// How a target fits the field.
export interface FramingAssessment {
	// Fit.
	readonly fit: FramingFit
	// Share of the field the target spans along its fuller axis; above 1 it is larger than the field.
	readonly fill: number
	// Factor on 0..1 ordering the fits: 1 for a good fit, lower the smaller or the larger the target is.
	readonly factor: number
	// Pixels the major axis spans; absent when the image scale is unknown.
	readonly pixels?: number
	// Panels of a mosaic covering the target without overlap; present for a mosaic only.
	readonly panels?: number
}

// Words and tone of each fit.
export const FRAMING_LABELS: Readonly<Record<FramingFit, { readonly label: string; readonly tone: StatusTone }>> = {
	good: { label: 'Fits well', tone: 'success' },
	tight: { label: 'Fills the field', tone: 'neutral' },
	small: { label: 'Small', tone: 'muted' },
	mosaic: { label: 'Mosaic', tone: 'warning' },
}

// Assesses how a target of apparent major and minor axes (radians; the minor axis defaults to the major one) fits a field
// of view (its angular width and height in radians, and its image scale in arcseconds per pixel when known). Undefined
// without a known major axis, which leaves the target unjudged rather than penalized.
export function assessFraming(majorAxis: number | undefined, minorAxis: number | undefined, frame: Pick<Framing, 'width' | 'height' | 'scale'>): FramingAssessment | undefined {
	if (majorAxis === undefined || !(majorAxis > 0)) return undefined
	const minor = minorAxis !== undefined && minorAxis > 0 ? Math.min(minorAxis, majorAxis) : majorAxis
	const long = Math.max(frame.width, frame.height)
	const short = Math.min(frame.width, frame.height)
	const fill = Math.max(majorAxis / long, minor / short)
	const pixels = frame.scale !== undefined && frame.scale > 0 ? (majorAxis * ARCSEC_PER_RADIAN) / frame.scale : undefined

	if (fill > 1) return { fit: 'mosaic', fill, factor: TIGHT_FILL / fill, pixels, panels: Math.ceil(majorAxis / long) * Math.ceil(minor / short) }
	if (fill > TIGHT_FILL) return { fit: 'tight', fill, factor: TIGHT_FILL / fill, pixels }
	const fewPixels = pixels !== undefined && pixels < MINIMUM_PIXELS
	if (fill < SMALL_FILL || fewPixels) return { fit: 'small', fill, factor: Math.min(1, fill / SMALL_FILL, pixels === undefined ? 1 : pixels / MINIMUM_PIXELS), pixels }
	return { fit: 'good', fill, factor: 1, pixels }
}

// Returns the detail of an assessment in words, for its tooltip: the share of the field, the pixels spanned, and the
// panels of a mosaic.
export function framingDetail({ fill, pixels, panels }: FramingAssessment) {
	const parts = [`${Math.round(fill * 100)} % of the field`]
	if (pixels !== undefined) parts.push(`${Math.round(pixels)} px across`)
	if (panels !== undefined) parts.push(`about ${panels} panels`)
	return parts.join(' · ')
}
