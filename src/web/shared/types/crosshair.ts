import { clamp, finiteNumber, isRecord } from '@shared/util'
import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { PIOVERTWO } from 'nebulosa/src/core/constants'
import type { Point } from 'nebulosa/src/math/numerical/geometry'
import { arcmin, arcsec, deg, normalizeAngle, toArcmin, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { CROSSHAIR_PRESETS, type CrosshairPreset } from 'src/shared/types'

export { CROSSHAIR_PRESETS }
export type { CrosshairPreset }

export const CROSSHAIR_SPACING_UNITS = ['pixel', 'normalized', 'angular'] as const
export const CROSSHAIR_CENTER_SPACES = ['image', 'sky'] as const
export const CROSSHAIR_ANGULAR_DISPLAY_UNITS = ['arcsecond', 'arcminute', 'degree'] as const

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

const HEX_COLOR = /^#[\da-f]{6}$/i

function isPreset(value: unknown): value is CrosshairPreset {
	return typeof value === 'string' && CROSSHAIR_PRESETS.includes(value as CrosshairPreset)
}

function isSpacingUnit(value: unknown): value is CrosshairSpacingUnit {
	return typeof value === 'string' && CROSSHAIR_SPACING_UNITS.includes(value as CrosshairSpacingUnit)
}

function isAngularDisplayUnit(value: unknown): value is CrosshairAngularDisplayUnit {
	return typeof value === 'string' && CROSSHAIR_ANGULAR_DISPLAY_UNITS.includes(value as CrosshairAngularDisplayUnit)
}

function safeDimension(value: number) {
	return Math.max(0, finiteNumber(value, 0))
}

export function imageMinimumDimension(width: number, height: number) {
	width = safeDimension(width)
	height = safeDimension(height)
	return width > 0 && height > 0 ? Math.min(width, height) : 0
}

export function normalizeCrosshairPoint(value: unknown): CrosshairPoint {
	const point = isRecord(value) ? value : { x: 0.5, y: 0.5 }
	return {
		x: clamp(finiteNumber(point.x, 0.5), 0, 1),
		y: clamp(finiteNumber(point.y, 0.5), 0, 1),
	}
}

export function normalizeCrosshairCoordinate(value: unknown): EquatorialCoordinate {
	const coordinate = isRecord(value) ? value : undefined
	return {
		rightAscension: normalizeAngle(finiteNumber(coordinate?.rightAscension, 0)),
		declination: clamp(finiteNumber(coordinate?.declination, 0), -PIOVERTWO, PIOVERTWO),
	}
}

export function normalizeCrosshairCenter(value: unknown): CrosshairCenter {
	if (isRecord(value) && value.space === 'sky') return { space: 'sky', coordinate: normalizeCrosshairCoordinate(value.coordinate) }
	if (isRecord(value) && value.space === 'image') return { space: 'image', point: normalizeCrosshairPoint(value.point) }
	return { space: 'image', point: normalizeCrosshairPoint(value) }
}

export function normalizeCrosshairConfig(value: unknown, minDimension = 0): CrosshairConfig {
	const config = isRecord(value) ? value : DEFAULT_CROSSHAIR_CONFIG
	const spacing: Record<string, unknown> = isRecord(config.spacing) ? config.spacing : DEFAULT_CROSSHAIR_CONFIG.spacing
	const unit = isSpacingUnit(spacing.unit) ? spacing.unit : DEFAULT_CROSSHAIR_CONFIG.spacing.unit
	const pixelMaximum = Math.max(1, safeDimension(minDimension) || 100000)
	const pixelMinimum = Math.min(8, pixelMaximum)
	const normalizedSpacing: CrosshairSpacing =
		unit === 'pixel'
			? { unit, value: clamp(finiteNumber(spacing.value, 8), pixelMinimum, pixelMaximum) }
			: unit === 'normalized'
				? { unit, value: clamp(finiteNumber(spacing.value, DEFAULT_CROSSHAIR_CONFIG.spacing.value), 0.005, 0.25) }
				: {
						unit,
						automatic: typeof spacing.automatic === 'boolean' ? spacing.automatic : DEFAULT_CROSSHAIR_ANGULAR_SPACING.automatic,
						value: clamp(finiteNumber(spacing.value, DEFAULT_CROSSHAIR_ANGULAR_SPACING.value), arcsec(0.1), deg(90)),
						displayUnit: isAngularDisplayUnit(spacing.displayUnit) ? spacing.displayUnit : DEFAULT_CROSSHAIR_ANGULAR_SPACING.displayUnit,
					}
	const color = typeof config.color === 'string' && HEX_COLOR.test(config.color) ? config.color.toLowerCase() : DEFAULT_CROSSHAIR_CONFIG.color

	return {
		preset: isPreset(config.preset) ? config.preset : DEFAULT_CROSSHAIR_CONFIG.preset,
		center: normalizeCrosshairCenter(config.center),
		spacing: normalizedSpacing,
		color,
		opacity: clamp(finiteNumber(config.opacity, DEFAULT_CROSSHAIR_CONFIG.opacity), 0.1, 1),
		lineWidth: clamp(finiteNumber(config.lineWidth, DEFAULT_CROSSHAIR_CONFIG.lineWidth), 0.5, 4),
		dashed: typeof config.dashed === 'boolean' ? config.dashed : DEFAULT_CROSSHAIR_CONFIG.dashed,
		halo: typeof config.halo === 'boolean' ? config.halo : DEFAULT_CROSSHAIR_CONFIG.halo,
	}
}

export function crosshairPointInPixels(point: CrosshairPoint, width: number, height: number): CrosshairPoint {
	return {
		x: normalizeCrosshairPoint(point).x * safeDimension(width),
		y: normalizeCrosshairPoint(point).y * safeDimension(height),
	}
}

export function crosshairPointFromPixels(point: CrosshairPoint, width: number, height: number): CrosshairPoint {
	width = safeDimension(width)
	height = safeDimension(height)

	return normalizeCrosshairPoint({
		x: width > 0 ? point.x / width : 0.5,
		y: height > 0 ? point.y / height : 0.5,
	})
}

export function crosshairSpacingInPixels(spacing: CrosshairSpacing, width: number, height: number) {
	return spacing.unit === 'normalized' ? spacing.value * imageMinimumDimension(width, height) : spacing.unit === 'pixel' ? spacing.value : 0
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

export function viewportPixelsInImage(cssPixels: number, scale: number) {
	const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
	return cssPixels / safeScale
}

export function screenDeltaInImage(screenX: number, screenY: number, scale: number, angle: number): CrosshairPoint {
	const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
	const radians = -finiteNumber(angle, 0) * (Math.PI / 180)
	const x = finiteNumber(screenX, 0) / safeScale
	const y = finiteNumber(screenY, 0) / safeScale
	const cos = Math.cos(radians)
	const sin = Math.sin(radians)

	return {
		x: x * cos - y * sin,
		y: x * sin + y * cos,
	}
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

	return result.filter((value): value is CrosshairSegment => value !== undefined)
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
	width = safeDimension(width)
	height = safeDimension(height)
	const centerInPixels = crosshairPointInPixels(center, width, height)
	const spacing = crosshairSpacingInPixels(config.spacing, width, height)
	const radii = crosshairRadii(spacing)
	const hasRings = config.preset === 'bullseye'

	return {
		center: centerInPixels,
		dotRadius: viewportPixelsInImage(2, scale),
		handleRadius: viewportPixelsInImage(10, scale),
		spacing,
		radii: hasRings ? radii : [],
		axes: axes(centerInPixels, width, height, hasRings ? radii[2] : undefined),
		ticks: hasRings ? ticks(centerInPixels, radii[2], viewportPixelsInImage(6, scale)) : [],
	}
}

export function crosshairSegmentsPath(segments: readonly CrosshairSegment[]) {
	return segments.map(({ x1, y1, x2, y2 }) => `M${x1} ${y1}L${x2} ${y2}`).join('')
}
