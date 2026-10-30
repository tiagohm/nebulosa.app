import { describe, expect, test } from 'bun:test'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { deg, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import type { OverlayView } from '../viewer/transform'
import { cachedGrid, clipPolyline, formatGridValue, gridEdges, gridGeometry } from './grid'

// A TAN solution of a 2000×1000 image centred at its CRPIX, s degrees per pixel, rotated by angle degrees.
function solution(ra: number, dec: number, { angle = 0, s = 0.001 } = {}): FitsHeader {
	const c = Math.cos(deg(angle))
	const n = Math.sin(deg(angle))
	return { CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN', CRPIX1: 1000.5, CRPIX2: 500.5, CRVAL1: ra, CRVAL2: dec, CD1_1: -s * c, CD1_2: -s * n, CD2_1: -s * n, CD2_2: s * c, NAXIS1: 2000, NAXIS2: 1000 }
}

const IMAGE = { width: 2000, height: 1000 }

// View of a 1000×500 viewport centred on the image at a scale.
function view(scale: number): OverlayView {
	const width = 1000 / scale
	const height = 500 / scale
	return { scale, visible: { x: 1000 - width / 2, y: 500 - height / 2, width, height } }
}

// Returns every vertex of the lines of a grid.
function vertices(geometry: NonNullable<ReturnType<typeof gridGeometry>>) {
	return geometry.lines.flatMap((line) => line.paths.flat())
}

describe('spacing', () => {
	test('follows the zoom down to arcseconds', () => {
		const header = solution(42, 17)
		const whole = gridGeometry(header, IMAGE, view(0.5))!
		const close = gridGeometry(header, IMAGE, view(32))!

		expect(toDeg(whole.declinationStep)).toBeGreaterThanOrEqual(0.25)
		expect(toArcsec(close.declinationStep)).toBeLessThanOrEqual(30)
		expect(close.rightAscensionStep).toBeLessThan(whole.rightAscensionStep)
	})

	test('keeps a readable step on a small zoom change', () => {
		const header = solution(42, 17)
		const first = gridGeometry(header, IMAGE, view(1))!
		const next = gridGeometry(header, IMAGE, view(1.15), first)!

		expect(next.declinationStep).toBe(first.declinationStep)
		expect(next.rightAscensionStep).toBe(first.rightAscensionStep)
	})

	test('does not depend on the rotation of the image', () => {
		const a = gridGeometry(solution(42, 17), IMAGE, view(1))!
		const b = gridGeometry(solution(42, 17, { angle: 73 }), IMAGE, view(1))!

		expect(b.declinationStep).toBe(a.declinationStep)
	})

	test('widens the meridians near a pole and bounds the lines', () => {
		const geometry = gridGeometry(solution(0, 89.9, { s: 0.002 }), IMAGE, view(0.5))!
		const meridians = geometry.lines.filter((line) => line.axis === 'rightAscension' && line.major)

		expect(meridians.length).toBeGreaterThanOrEqual(4)
		expect(meridians.length).toBeLessThanOrEqual(24)
		for (const point of vertices(geometry)) expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBeTrue()
	})
})

describe('lines', () => {
	test('stay inside their region', () => {
		const geometry = gridGeometry(solution(42, 17, { angle: 31, s: 0.01 }), IMAGE, view(2))!
		const { region } = geometry

		for (const point of vertices(geometry)) {
			expect(point.x).toBeGreaterThanOrEqual(region.x - 1e-9)
			expect(point.x).toBeLessThanOrEqual(region.x + region.width + 1e-9)
			expect(point.y).toBeGreaterThanOrEqual(region.y - 1e-9)
			expect(point.y).toBeLessThanOrEqual(region.y + region.height + 1e-9)
		}
	})

	test('are continuous across 0h, with right ascensions in [0, 2π)', () => {
		const geometry = gridGeometry(solution(0.05, 10, { s: 0.002 }), IMAGE, view(0.5))!
		const zero = geometry.lines.find((line) => line.axis === 'rightAscension' && line.value === 0)

		expect(zero?.paths.length).toBe(1)
		for (const line of geometry.lines) if (line.axis === 'rightAscension') expect(line.value >= 0 && line.value < 2 * Math.PI).toBeTrue()
	})

	test('have stable keys', () => {
		const a = gridGeometry(solution(42, 17), IMAGE, view(1))!
		const b = gridGeometry(solution(42, 17), IMAGE, { ...view(1), visible: { ...view(1).visible, x: view(1).visible.x + 50 } }, a)!
		const keys = new Set(a.lines.map((line) => line.key))

		expect(b.lines.some((line) => keys.has(line.key))).toBeTrue()
	})

	test('are nothing when the image is off screen', () => {
		expect(gridGeometry(solution(42, 17), IMAGE, { scale: 1, visible: { x: 5000, y: 0, width: 100, height: 100 } })).toBeUndefined()
	})

	test('are reused while the view stays inside the region', () => {
		const header = solution(42, 17)
		const first = cachedGrid(header, IMAGE, view(2))
		const panned = cachedGrid(header, IMAGE, { scale: 2, visible: { ...view(2).visible, x: view(2).visible.x + 20 } })
		const zoomed = cachedGrid(header, IMAGE, view(8))

		expect(panned).toBe(first)
		expect(zoomed).not.toBe(first!)
	})
})

describe('edges', () => {
	test('label the major lines inside the visible part of the image', () => {
		const shown = view(2)
		const geometry = gridGeometry(solution(42, 17, { angle: 20 }), IMAGE, shown)!
		const { labels, ticks } = gridEdges(geometry, IMAGE, shown, 11, 8, 48)
		const { visible } = shown

		expect(labels.length).toBeGreaterThan(0)
		expect(ticks.length).toBeGreaterThanOrEqual(labels.length)
		for (const label of labels) {
			expect(label.point.x).toBeGreaterThanOrEqual(visible.x - 1e-6)
			expect(label.point.x).toBeLessThanOrEqual(visible.x + visible.width + 1e-6)
			expect(label.point.y).toBeGreaterThanOrEqual(visible.y - 1e-6)
			expect(label.point.y).toBeLessThanOrEqual(visible.y + visible.height + 1e-6)
		}
		expect(new Set(labels.map((label) => label.key)).size).toBe(labels.length)
	})

	test('respect the label budget', () => {
		const shown = view(0.5)
		const geometry = gridGeometry(solution(42, 17), IMAGE, shown)!

		expect(gridEdges(geometry, IMAGE, shown, 11, 8, 2).labels.length).toBeLessThanOrEqual(2)
	})
})

describe('format', () => {
	test.each([
		['rightAscension', 0, 3600, '00h'],
		['rightAscension', deg(15 * 23.5), 1800, '23h 30m'],
		['rightAscension', deg(360 - 15 / 3600), 1, '23h 59m 59s'],
		['rightAscension', -deg(15 / 3600), 1, '23h 59m 59s'],
		['declination', deg(45.5), 60, '+45° 30′'],
		['declination', -deg(1 / 3600), 1, '−0° 00′ 01″'],
		['declination', deg(-30), 3600, '−30°'],
	] as const)('of %s %p with a step of %p units', (axis, value, units, text) => {
		const step = axis === 'rightAscension' ? (units * Math.PI) / 43200 : (units * Math.PI) / 648000
		expect(formatGridValue(axis, value, step)).toBe(text)
	})
})

describe('clipping', () => {
	test('splits a polyline where it leaves a rectangle', () => {
		const rect = { x: 0, y: 0, width: 10, height: 10 }
		const pieces = clipPolyline(
			[
				{ x: -5, y: 5 },
				{ x: 5, y: 5 },
				{ x: 15, y: 5 },
				{ x: 15, y: 8 },
				{ x: 5, y: 8 },
			],
			rect,
		)

		expect(pieces).toEqual([
			[
				{ x: 0, y: 5 },
				{ x: 5, y: 5 },
				{ x: 10, y: 5 },
			],
			[
				{ x: 10, y: 8 },
				{ x: 5, y: 8 },
			],
		])
	})
})
