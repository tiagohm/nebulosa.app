import { clamp, finiteNumber, isRecord } from '@shared/util'
import type { Point } from 'nebulosa/src/math/numerical/geometry'

export const CROSSHAIR_PRESETS = ['crosshair', 'bullseye', 'fine-grid', 'coarse-grid'] as const
export const CROSSHAIR_SPACING_UNITS = ['pixel', 'normalized'] as const

export type CrosshairPreset = (typeof CROSSHAIR_PRESETS)[number]
export type CrosshairSpacingUnit = (typeof CROSSHAIR_SPACING_UNITS)[number]
export type CrosshairPoint = Point

export interface CrosshairSpacing {
	readonly unit: CrosshairSpacingUnit
	readonly value: number
}

export interface CrosshairConfig {
	readonly preset: CrosshairPreset
	readonly center: CrosshairPoint
	readonly spacing: CrosshairSpacing
	readonly aperture: number
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
	readonly apertureRadius: number
	readonly dotRadius: number
	readonly handleRadius: number
	readonly spacing: number
	readonly gridStep: number
	readonly radii: readonly number[]
	readonly axes: readonly CrosshairSegment[]
	readonly grid: readonly CrosshairSegment[]
	readonly ticks: readonly CrosshairSegment[]
}

export const DEFAULT_CROSSHAIR_CONFIG: Readonly<CrosshairConfig> = {
	preset: 'bullseye',
	center: { x: 0.5, y: 0.5 },
	spacing: { unit: 'normalized', value: 0.05 },
	aperture: 16,
	color: '#ef4444',
	opacity: 0.75,
	lineWidth: 1,
	dashed: false,
	halo: true,
}

const HEX_COLOR = /^#[\da-f]{6}$/i

function isPreset(value: unknown): value is CrosshairPreset {
	return typeof value === 'string' && CROSSHAIR_PRESETS.includes(value as CrosshairPreset)
}

function isSpacingUnit(value: unknown): value is CrosshairSpacingUnit {
	return typeof value === 'string' && CROSSHAIR_SPACING_UNITS.includes(value as CrosshairSpacingUnit)
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
	const point = isRecord(value) ? value : DEFAULT_CROSSHAIR_CONFIG.center
	return {
		x: clamp(finiteNumber(point.x, DEFAULT_CROSSHAIR_CONFIG.center.x), 0, 1),
		y: clamp(finiteNumber(point.y, DEFAULT_CROSSHAIR_CONFIG.center.y), 0, 1),
	}
}

export function normalizeCrosshairConfig(value: unknown, minDimension = 0): CrosshairConfig {
	const config = isRecord(value) ? value : DEFAULT_CROSSHAIR_CONFIG
	const spacing = isRecord(config.spacing) ? config.spacing : DEFAULT_CROSSHAIR_CONFIG.spacing
	const unit = isSpacingUnit(spacing.unit) ? spacing.unit : DEFAULT_CROSSHAIR_CONFIG.spacing.unit
	const pixelMaximum = Math.max(1, safeDimension(minDimension) || 100000)
	const pixelMinimum = Math.min(8, pixelMaximum)
	const spacingValue = unit === 'pixel' ? clamp(finiteNumber(spacing.value, 8), pixelMinimum, pixelMaximum) : clamp(finiteNumber(spacing.value, DEFAULT_CROSSHAIR_CONFIG.spacing.value), 0.005, 0.25)
	const color = typeof config.color === 'string' && HEX_COLOR.test(config.color) ? config.color.toLowerCase() : DEFAULT_CROSSHAIR_CONFIG.color

	return {
		preset: isPreset(config.preset) ? config.preset : DEFAULT_CROSSHAIR_CONFIG.preset,
		center: normalizeCrosshairPoint(config.center),
		spacing: { unit, value: spacingValue },
		aperture: clamp(finiteNumber(config.aperture, DEFAULT_CROSSHAIR_CONFIG.aperture), 0, 64),
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
		x: width > 0 ? point.x / width : DEFAULT_CROSSHAIR_CONFIG.center.x,
		y: height > 0 ? point.y / height : DEFAULT_CROSSHAIR_CONFIG.center.y,
	})
}

export function crosshairSpacingInPixels(spacing: CrosshairSpacing, width: number, height: number) {
	return spacing.unit === 'normalized' ? spacing.value * imageMinimumDimension(width, height) : spacing.value
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

function axes(center: CrosshairPoint, width: number, height: number, gap: number, reach?: number) {
	const left = reach === undefined ? 0 : Math.max(0, center.x - reach)
	const right = reach === undefined ? width : Math.min(width, center.x + reach)
	const top = reach === undefined ? 0 : Math.max(0, center.y - reach)
	const bottom = reach === undefined ? height : Math.min(height, center.y + reach)
	const result = [segment(left, center.y, Math.max(left, center.x - gap), center.y), segment(Math.min(right, center.x + gap), center.y, right, center.y), segment(center.x, top, center.x, Math.max(top, center.y - gap)), segment(center.x, Math.min(bottom, center.y + gap), center.x, bottom)]

	return result.filter((value): value is CrosshairSegment => value !== undefined)
}

function grid(center: CrosshairPoint, width: number, height: number, step: number) {
	const result: CrosshairSegment[] = []

	if (!Number.isFinite(step) || step <= 0) return result

	for (let x = center.x - step; x >= 0; x -= step) result.push({ x1: x, y1: 0, x2: x, y2: height })
	for (let x = center.x + step; x <= width; x += step) result.push({ x1: x, y1: 0, x2: x, y2: height })
	for (let y = center.y - step; y >= 0; y -= step) result.push({ x1: 0, y1: y, x2: width, y2: y })
	for (let y = center.y + step; y <= height; y += step) result.push({ x1: 0, y1: y, x2: width, y2: y })

	return result
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

export function crosshairGeometry(config: CrosshairConfig, width: number, height: number, scale: number, center = config.center): CrosshairGeometry {
	width = safeDimension(width)
	height = safeDimension(height)
	const centerInPixels = crosshairPointInPixels(center, width, height)
	const spacing = crosshairSpacingInPixels(config.spacing, width, height)
	const radii = crosshairRadii(spacing)
	const apertureRadius = viewportPixelsInImage(config.aperture / 2, scale)
	const gridStep = config.preset === 'coarse-grid' ? spacing * 2 : spacing
	const hasGrid = config.preset === 'fine-grid' || config.preset === 'coarse-grid'
	const hasRings = config.preset === 'bullseye'

	return {
		center: centerInPixels,
		apertureRadius,
		dotRadius: viewportPixelsInImage(2, scale),
		handleRadius: viewportPixelsInImage(10, scale),
		spacing,
		gridStep,
		radii: hasRings ? radii : [],
		axes: axes(centerInPixels, width, height, apertureRadius, hasRings ? radii[2] : undefined),
		grid: hasGrid ? grid(centerInPixels, width, height, gridStep) : [],
		ticks: hasRings ? ticks(centerInPixels, radii[2], viewportPixelsInImage(6, scale)) : [],
	}
}

export function crosshairSegmentsPath(segments: readonly CrosshairSegment[]) {
	return segments.map(({ x1, y1, x2, y2 }) => `M${x1} ${y1}L${x2} ${y2}`).join('')
}
