import { describe, expect, test } from 'bun:test'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { sphericalSeparation } from 'nebulosa/src/math/numerical/geometry'
import { deg } from 'nebulosa/src/math/units/angle'
import { type AstrometricMarker, circleOutline, circleValues, clampToImage, type DraftContext, distanceValues, draftFrom, hitHandle, hitItem, type Measurement, type MeasurementKind, moveDraft, moveHandle, pressDraft, rectangleValues, releaseDraft } from './measurement'
import { skyAt } from './wcs'

// A TAN-SIP solution of a 2000×1000 image whose right side is stretched.
const SIP: FitsHeader = { CTYPE1: 'RA---TAN-SIP', CTYPE2: 'DEC--TAN-SIP', CRPIX1: 1000.5, CRPIX2: 500.5, CRVAL1: 42, CRVAL2: -17, CD1_1: -0.0005, CD1_2: 0, CD2_1: 0, CD2_2: 0.0005, NAXIS1: 2000, NAXIS2: 1000, A_ORDER: 2, B_ORDER: 2, A_2_0: 2e-5, A_1_1: 0, A_0_2: 0, B_2_0: 0, B_1_1: 0, B_0_2: 0 }

// The same solution without distortion.
const TAN: FitsHeader = { ...SIP, CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN' }

const item = (id: string, kind: MeasurementKind, a: { x: number; y: number }, b: { x: number; y: number }, visible = true): Measurement => ({ id, kind, a, b, visible })

const marker = (id: string, x: number, y: number, visible = true): AstrometricMarker => ({ id, point: { x, y }, visible })

const context = (overrides: Partial<DraftContext> = {}): DraftContext => ({ imageId: 'image', mode: 'distance', measurements: [], markers: [], radius: 3, ...overrides })

// Returns the separation of the sky positions of two viewer points.
function separation(solution: FitsHeader, p: { x: number; y: number }, q: { x: number; y: number }) {
	const a = skyAt(solution, p)!
	const b = skyAt(solution, q)!
	return sphericalSeparation(a[0], a[1], b[0], b[1])
}

describe('distance', () => {
	test('is the separation of the unprojected ends, which follows the distortion', () => {
		const left = distanceValues(SIP, item('a', 'distance', { x: 100, y: 500 }, { x: 200, y: 500 }))
		const right = distanceValues(SIP, item('b', 'distance', { x: 1800, y: 500 }, { x: 1900, y: 500 }))

		expect(left.pixels).toBe(100)
		expect(right.offset!.separation).toBeCloseTo(separation(SIP, { x: 1800, y: 500 }, { x: 1900, y: 500 }), 14)
		expect(right.offset!.separation).toBeGreaterThan(left.offset!.separation * 1.05)
	})

	test('has no sky offset where the solution cannot unproject', () => {
		expect(distanceValues({ ...SIP, CTYPE1: 'GLON-CAR' }, item('a', 'distance', { x: 0, y: 0 }, { x: 10, y: 0 })).offset).toBeUndefined()
	})

	test('measures a north-up offset at position angle 0', () => {
		const { offset } = distanceValues(TAN, item('a', 'distance', { x: 1000, y: 500 }, { x: 1000, y: 600 }))

		expect(offset!.positionAngle!).toBeCloseTo(0, 9)
		expect(offset!.separation).toBeCloseTo(deg(0.05), 9)
	})
})

describe('rectangle', () => {
	test('measures its sides, centre lines, and diagonals as independent great circles', () => {
		const rectangle = item('r', 'rectangle', { x: 1200, y: 100 }, { x: 1900, y: 800 })
		const values = rectangleValues(SIP, rectangle)

		expect(values.pixels).toEqual({ width: 700, height: 700 })
		expect(values.sides!.top).toBeCloseTo(separation(SIP, { x: 1200, y: 100 }, { x: 1900, y: 100 }), 14)
		expect(values.sides!.right).toBeCloseTo(separation(SIP, { x: 1900, y: 100 }, { x: 1900, y: 800 }), 14)
		expect(values.centerLines!.width).toBeCloseTo(separation(SIP, { x: 1200, y: 450 }, { x: 1900, y: 450 }), 14)
		expect(values.diagonals![1]).toBeCloseTo(separation(SIP, { x: 1900, y: 100 }, { x: 1200, y: 800 }), 14)
		// The distortion stretches X away from the reference pixel, so the same rectangle centred on it is narrower on the sky.
		expect(values.sides!.top).toBeGreaterThan(rectangleValues(SIP, item('l', 'rectangle', { x: 650, y: 100 }, { x: 1350, y: 800 })).sides!.top * 1.01)
	})

	test('keeps its other sides when an edge or corner is dragged, even across', () => {
		const rectangle = item('r', 'rectangle', { x: 10, y: 10 }, { x: 50, y: 40 })

		expect(moveHandle(rectangle, 'e', { x: 80, y: 99 })).toMatchObject({ a: { x: 10, y: 10 }, b: { x: 80, y: 40 } })
		expect(moveHandle(rectangle, 'nw', { x: 60, y: 45 })).toMatchObject({ a: { x: 50, y: 40 }, b: { x: 60, y: 45 } })
	})
})

describe('circle', () => {
	test('has a constant angular radius around its centre, whatever the distortion', () => {
		const circle = item('c', 'circle', { x: 1700, y: 500 }, { x: 1900, y: 500 })
		const { center, radius } = circleValues(SIP, circle)
		const outline = circleOutline(SIP, circle, 1)!

		expect(radius).toBeCloseTo(separation(SIP, { x: 1700, y: 500 }, { x: 1900, y: 500 }), 14)
		for (const point of outline.flat()) {
			const sky = skyAt(SIP, point)!
			expect(sphericalSeparation(center![0], center![1], sky[0], sky[1])).toBeCloseTo(radius!, 9)
		}
		// Not a circle of pixels: the distortion makes it narrower towards the stretched side.
		const xs = outline.flat().map((p) => p.x)
		expect(Math.max(...xs) - 1700).not.toBeCloseTo(1700 - Math.min(...xs), 0)
	})

	test('has more vertices when zoomed in, within bounds', () => {
		const circle = item('c', 'circle', { x: 1000, y: 500 }, { x: 1100, y: 500 })

		expect(circleOutline(TAN, circle, 0.01)!.flat().length).toBe(49)
		expect(circleOutline(TAN, circle, 32)!.flat().length).toBe(361)
	})

	test('has no outline when degenerate', () => {
		expect(circleOutline(TAN, item('c', 'circle', { x: 5, y: 5 }, { x: 5, y: 5 }), 1)).toBeUndefined()
	})
})

describe('hit tests', () => {
	const measurements = [item('a', 'distance', { x: 0, y: 0 }, { x: 100, y: 0 }), item('b', 'distance', { x: 100, y: 1 }, { x: 100, y: 100 }), item('c', 'distance', { x: 50, y: 50 }, { x: 60, y: 50 }, false)]
	const markers = [marker('m', 300, 300), marker('h', 50, 50, false)]

	test('pick the nearest handle within the radius, the selected item first', () => {
		expect(hitHandle(measurements, markers, { x: 99, y: 0 }, 5)).toEqual({ kind: 'measurement', id: 'a', handle: 'b' })
		expect(hitHandle(measurements, markers, { x: 100, y: 0.4 }, 5, { kind: 'measurement', id: 'b' })).toEqual({ kind: 'measurement', id: 'b', handle: 'a' })
		expect(hitHandle(measurements, markers, { x: 302, y: 301 }, 5)).toEqual({ kind: 'marker', id: 'm', handle: 'point' })
		expect(hitHandle(measurements, markers, { x: 50, y: 50 }, 5)).toBeUndefined()
	})

	test('scale with the zoom through the radius in image pixels', () => {
		expect(hitHandle(measurements, markers, { x: 0.3, y: 0 }, 12 / 32)).toEqual({ kind: 'measurement', id: 'a', handle: 'a' })
		expect(hitHandle(measurements, markers, { x: 0.5, y: 0 }, 12 / 32)).toBeUndefined()
	})

	test('pick the outline of a visible item', () => {
		const shapes = [item('r', 'rectangle', { x: 400, y: 400 }, { x: 500, y: 450 }), item('c', 'circle', { x: 1000, y: 500 }, { x: 1100, y: 500 })]

		expect(hitItem(TAN, measurements, markers, { x: 50, y: 2 }, 3, 1)).toEqual({ kind: 'measurement', id: 'a' })
		expect(hitItem(TAN, shapes, [], { x: 450, y: 451 }, 3, 1)).toEqual({ kind: 'measurement', id: 'r' })
		expect(hitItem(TAN, shapes, [], { x: 450, y: 425 }, 3, 1)).toBeUndefined()
		expect(hitItem(TAN, shapes, [], { x: 1000, y: 401 }, 3, 1)).toEqual({ kind: 'measurement', id: 'c' })
		expect(hitItem(TAN, measurements, markers, { x: 301, y: 299 }, 3, 1)).toEqual({ kind: 'marker', id: 'm' })
	})
})

describe('drafts', () => {
	test('a drag draws a distance', () => {
		const { draft, take } = pressDraft(undefined, { x: 10, y: 10 }, context())
		const { draft: after, commit } = releaseDraft(moveDraft(draft, { x: 50, y: 10 }), { x: 50, y: 10 }, 3)

		expect(take).toBeTrue()
		expect(after).toBeUndefined()
		expect(commit).toEqual({ type: 'addMeasurement', measurement: { kind: 'distance', a: { x: 10, y: 10 }, b: { x: 50, y: 10 }, visible: true } })
	})

	test('two clicks draw a distance', () => {
		const first = releaseDraft(pressDraft(undefined, { x: 10, y: 10 }, context()).draft, { x: 11, y: 10 }, 3)
		expect(first.commit).toBeUndefined()
		expect(first.draft).toMatchObject({ type: 'create', pressed: false })

		const second = releaseDraft(pressDraft(moveDraft(first.draft, { x: 40, y: 40 }), { x: 70, y: 10 }, context()).draft, { x: 70, y: 10 }, 3)
		expect(second.commit).toEqual({ type: 'addMeasurement', measurement: { kind: 'distance', a: { x: 10, y: 10 }, b: { x: 70, y: 10 }, visible: true } })
	})

	test('a rectangle drawn towards the top-left is stored from its top-left corner', () => {
		const { draft } = pressDraft(undefined, { x: 80, y: 90 }, context({ mode: 'rectangle' }))

		expect(releaseDraft(draft, { x: 20, y: 30 }, 3).commit).toEqual({ type: 'addMeasurement', measurement: { kind: 'rectangle', a: { x: 20, y: 30 }, b: { x: 80, y: 90 }, visible: true } })
	})

	test('a click places a marker where it is released', () => {
		const { draft, take } = pressDraft(undefined, { x: 5, y: 6 }, context({ mode: 'marker' }))

		expect(take).toBeTrue()
		expect(releaseDraft(draft, { x: 5, y: 7 }, 3).commit).toEqual({ type: 'addMarker', marker: { point: { x: 5, y: 7 }, visible: true } })
	})

	test('a handle or marker is dragged in any mode and the rest pans outside a mode', () => {
		const measurements = [item('a', 'distance', { x: 0, y: 0 }, { x: 100, y: 0 })]
		const markers = [marker('m', 300, 300)]
		const edit = pressDraft(undefined, { x: 101, y: 1 }, context({ mode: 'pan', measurements, markers }))
		const move = pressDraft(undefined, { x: 300, y: 301 }, context({ mode: 'rectangle', measurements, markers }))

		expect(edit.take).toBeTrue()
		expect(releaseDraft(moveDraft(edit.draft, { x: 120, y: 30 }), { x: 120, y: 30 }, 3).commit).toEqual({ type: 'updateMeasurement', measurement: item('a', 'distance', { x: 0, y: 0 }, { x: 120, y: 30 }) })
		expect(releaseDraft(move.draft, { x: 310, y: 320 }, 3).commit).toEqual({ type: 'updateMarker', marker: marker('m', 310, 320) })
		expect(pressDraft(undefined, { x: 50, y: 50 }, context({ mode: 'pan', measurements, markers }))).toEqual({ draft: undefined, take: false })
	})

	test('a draft of another image is abandoned', () => {
		const { draft } = pressDraft(draftFrom('other', { x: 5, y: 5 }), { x: 50, y: 50 }, context())

		expect(draft).toMatchObject({ imageId: 'image', anchor: { x: 50, y: 50 } })
	})

	test('measure from here waits for the end', () => {
		const { commit } = releaseDraft(pressDraft(draftFrom('image', { x: 5, y: 5 }), { x: 80, y: 5 }, context()).draft, { x: 80, y: 5 }, 3)

		expect(commit).toEqual({ type: 'addMeasurement', measurement: { kind: 'distance', a: { x: 5, y: 5 }, b: { x: 80, y: 5 }, visible: true } })
	})
})

test('points are kept inside the image', () => {
	expect(clampToImage({ x: -3, y: 1200 }, { width: 2000, height: 1000 })).toEqual({ x: 0, y: 1000 })
})
