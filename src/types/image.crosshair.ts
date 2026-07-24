import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import type { Point } from 'nebulosa/src/math/numerical/geometry'
import { arcmin, arcsec, deg, toArcmin, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import type { Angle } from 'nebulosa/src/math/units/angle'

export const CROSSHAIR_PRESETS = ['crosshair', 'bullseye'] as const
export const CROSSHAIR_SPACING_UNITS = ['pixel', 'normalized', 'angular'] as const
export const CROSSHAIR_CENTER_SPACES = ['image', 'sky'] as const
export const CROSSHAIR_ANGULAR_DISPLAY_UNITS = ['arcsecond', 'arcminute', 'degree'] as const

export type CrosshairPreset = (typeof CROSSHAIR_PRESETS)[number]

export type CrosshairProjectionAnchor = { readonly space: 'image'; readonly point: Point } | { readonly space: 'sky'; readonly coordinate: EquatorialCoordinate }

export type CrosshairSpacingUnit = (typeof CROSSHAIR_SPACING_UNITS)[number]

export type CrosshairCenterSpace = (typeof CROSSHAIR_CENTER_SPACES)[number]

export type CrosshairAngularDisplayUnit = (typeof CROSSHAIR_ANGULAR_DISPLAY_UNITS)[number]

export type CrosshairPoint = Point

export type CrosshairCenter = { readonly space: 'image'; readonly point: CrosshairPoint } | { readonly space: 'sky'; readonly coordinate: EquatorialCoordinate }

export type CrosshairSpacing =
	| { readonly unit: 'pixel' | 'normalized'; readonly value: number }
	| {
			readonly unit: 'angular'
			readonly automatic: boolean
			readonly value: number
			readonly displayUnit: CrosshairAngularDisplayUnit
	  }

export type CrosshairPolyline = readonly Point[]

export type CrosshairProjection =
	| { readonly status: 'unprojectable' }
	| {
			readonly status: 'ready'
			readonly width: number
			readonly height: number
			readonly center: Point & EquatorialCoordinate & { readonly inside: boolean }
			readonly spacing?: Angle
			readonly directions: {
				readonly north: Point
				readonly east: Point
			}
			readonly axes: readonly CrosshairPolyline[]
			readonly rings: readonly CrosshairPolyline[]
			readonly ringIntersections: readonly (Point & { readonly radius: Angle })[]
			readonly cardinals: readonly Point[]
	  }

export interface ProjectCrosshair {
	readonly solution: PlateSolution
	readonly anchor: CrosshairProjectionAnchor
	readonly preset: CrosshairPreset
	readonly angularSpacing?: {
		readonly automatic: boolean
		readonly value: Angle
	}
}

export interface CrosshairConfig {
	readonly preset: CrosshairPreset
	readonly center: CrosshairCenter
	readonly spacing: CrosshairSpacing
	readonly color: string
	readonly opacity: number
	readonly lineWidth: number
	readonly dashed: boolean
	readonly halo: boolean
}

export interface CrosshairSegment {
	readonly x1: number
	readonly y1: number
	readonly x2: number
	readonly y2: number
}

export interface CrosshairGeometry {
	readonly center: CrosshairPoint
	readonly dotRadius: number
	readonly handleRadius: number
	readonly spacing: number
	readonly radii: readonly number[]
	readonly axes: readonly CrosshairSegment[]
	readonly ticks: readonly CrosshairSegment[]
}

export const DEFAULT_CROSSHAIR_CONFIG: Readonly<CrosshairConfig> = {
	preset: 'bullseye',
	center: { space: 'image', point: { x: 0.5, y: 0.5 } },
	spacing: { unit: 'normalized', value: 0.05 },
	color: '#ef4444',
	opacity: 0.75,
	lineWidth: 1,
	dashed: false,
	halo: true,
}

export const DEFAULT_CROSSHAIR_ANGULAR_SPACING: Readonly<Extract<CrosshairSpacing, { unit: 'angular' }>> = {
	unit: 'angular',
	automatic: true,
	value: arcmin(5),
	displayUnit: 'arcminute',
}

export function isCrosshairPreset(value: unknown): value is CrosshairPreset {
	return typeof value === 'string' && CROSSHAIR_PRESETS.includes(value as never)
}

export function isCrosshairSpacingUnit(value: unknown): value is CrosshairSpacingUnit {
	return typeof value === 'string' && CROSSHAIR_SPACING_UNITS.includes(value as never)
}

export function isCrosshairAngularDisplayUnit(value: unknown): value is CrosshairAngularDisplayUnit {
	return typeof value === 'string' && CROSSHAIR_ANGULAR_DISPLAY_UNITS.includes(value as never)
}

export function crosshairPointInPixels(point: CrosshairPoint, width: number, height: number): CrosshairPoint {
	return { x: point.x * width, y: point.y * height }
}

export function crosshairPointFromPixels(point: CrosshairPoint, width: number, height: number): CrosshairPoint {
	return { x: width > 0 ? point.x / width : 0.5, y: height > 0 ? point.y / height : 0.5 }
}

export function crosshairSpacingInPixels(spacing: CrosshairSpacing, width: number, height: number) {
	return spacing.unit === 'normalized' ? spacing.value * Math.min(width, height) : spacing.unit === 'pixel' ? spacing.value : 0
}

export function crosshairAngleFromDisplayValue(value: number, unit: CrosshairAngularDisplayUnit) {
	return unit === 'arcsecond' ? arcsec(value) : unit === 'arcminute' ? arcmin(value) : deg(value)
}

export function crosshairAngleToDisplayValue(value: number, unit: CrosshairAngularDisplayUnit) {
	return unit === 'arcsecond' ? toArcsec(value) : unit === 'arcminute' ? toArcmin(value) : toDeg(value)
}

export function crosshairAngleDisplayUnit(value: number): CrosshairAngularDisplayUnit {
	return value < arcmin(1) ? 'arcsecond' : value < deg(1) ? 'arcminute' : 'degree'
}

export function crosshairRadii(spacing: number) {
	return [spacing, spacing * 2, spacing * 4] as const
}

function segment(x1: number, y1: number, x2: number, y2: number): CrosshairSegment | undefined {
	return x1 <= x2 && y1 <= y2 ? { x1, y1, x2, y2 } : undefined
}

function axes(center: CrosshairPoint, width: number, height: number, reach?: number) {
	const left = reach === undefined ? 0 : Math.max(0, center.x - reach)
	const right = reach === undefined ? width : Math.min(width, center.x + reach)
	const top = reach === undefined ? 0 : Math.max(0, center.y - reach)
	const bottom = reach === undefined ? height : Math.min(height, center.y + reach)
	const result = [segment(left, center.y, Math.max(left, center.x), center.y), segment(Math.min(right, center.x), center.y, right, center.y), segment(center.x, top, center.x, Math.max(top, center.y)), segment(center.x, Math.min(bottom, center.y), center.x, bottom)]
	return result.filter((value) => value !== undefined)
}

function ticks(center: CrosshairPoint, radius: number, length: number) {
	const half = length / 2
	return [
		{ x1: center.x - half, y1: center.y - radius, x2: center.x + half, y2: center.y - radius },
		{ x1: center.x - half, y1: center.y + radius, x2: center.x + half, y2: center.y + radius },
		{ x1: center.x - radius, y1: center.y - half, x2: center.x - radius, y2: center.y + half },
		{ x1: center.x + radius, y1: center.y - half, x2: center.x + radius, y2: center.y + half },
	]
}

export function crosshairGeometry(config: CrosshairConfig, width: number, height: number, scale: number, center: CrosshairPoint): CrosshairGeometry {
	const centerInPixels = crosshairPointInPixels(center, width, height)
	const spacing = crosshairSpacingInPixels(config.spacing, width, height)
	const radii = crosshairRadii(spacing)
	const hasRings = config.preset === 'bullseye'

	return {
		center: centerInPixels,
		dotRadius: 2 / scale,
		handleRadius: 10 / scale,
		spacing,
		radii: hasRings ? radii : [],
		axes: axes(centerInPixels, width, height, hasRings ? radii[2] : undefined),
		ticks: hasRings ? ticks(centerInPixels, radii[2], 6 / scale) : [],
	}
}

export function crosshairSegmentsPath(segments: readonly CrosshairSegment[]) {
	return segments.map(({ x1, y1, x2, y2 }) => `M${x1} ${y1}L${x2} ${y2}`).join('')
}
