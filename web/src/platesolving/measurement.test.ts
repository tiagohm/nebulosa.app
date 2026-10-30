import { describe, expect, test } from 'bun:test'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { sphericalSeparation } from 'nebulosa/src/math/numerical/geometry'
import { deg } from 'nebulosa/src/math/units/angle'
import { type DistanceMeasurement, type DraftContext, distanceValues, draftFrom, hitHandle, hitMeasurement, moveDraft, pressDraft, releaseDraft } from './measurement'
import { skyAt } from './wcs'

// A TAN-SIP solution of a 2000×1000 image whose right side is stretched.
const SIP: FitsHeader = { CTYPE1: 'RA---TAN-SIP', CTYPE2: 'DEC--TAN-SIP', CRPIX1: 1000.5, CRPIX2: 500.5, CRVAL1: 42, CRVAL2: -17, CD1_1: -0.0005, CD1_2: 0, CD2_1: 0, CD2_2: 0.0005, NAXIS1: 2000, NAXIS2: 1000, A_ORDER: 2, B_ORDER: 2, A_2_0: 2e-5, A_1_1: 0, A_0_2: 0, B_2_0: 0, B_1_1: 0, B_0_2: 0 }

const distance = (id: string, a: { x: number; y: number }, b: { x: number; y: number }, visible = true): DistanceMeasurement => ({ id, kind: 'distance', a, b, visible })

const context = (overrides: Partial<DraftContext> = {}): DraftContext => ({ imageId: 'image', mode: 'distance', measurements: [], radius: 3, ...overrides })

describe('values', () => {
	test('are the separation of the unprojected ends, which follows the distortion', () => {
		const left = distanceValues(SIP, distance('a', { x: 100, y: 500 }, { x: 200, y: 500 }))
		const right = distanceValues(SIP, distance('b', { x: 1800, y: 500 }, { x: 1900, y: 500 }))
		const a = skyAt(SIP, { x: 1800, y: 500 })!
		const b = skyAt(SIP, { x: 1900, y: 500 })!

		expect(left.pixels).toBe(100)
		expect(right.offset!.separation).toBeCloseTo(sphericalSeparation(a[0], a[1], b[0], b[1]), 14)
		expect(right.offset!.separation).toBeGreaterThan(left.offset!.separation * 1.05)
	})

	test('have no sky offset where the solution cannot unproject', () => {
		expect(distanceValues({ ...SIP, CTYPE1: 'GLON-CAR' }, distance('a', { x: 0, y: 0 }, { x: 10, y: 0 })).offset).toBeUndefined()
	})

	test('measure a north-up offset at position angle 0', () => {
		const north = { ...SIP, CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN' }
		const { offset } = distanceValues(north, distance('a', { x: 1000, y: 500 }, { x: 1000, y: 600 }))

		expect(offset!.positionAngle!).toBeCloseTo(0, 9)
		expect(offset!.separation).toBeCloseTo(deg(0.05), 9)
	})
})

describe('hit tests', () => {
	const measurements = [distance('a', { x: 0, y: 0 }, { x: 100, y: 0 }), distance('b', { x: 100, y: 1 }, { x: 100, y: 100 }), distance('c', { x: 50, y: 50 }, { x: 60, y: 50 }, false)]

	test('pick the nearest handle within the radius, the selected measurement first', () => {
		expect(hitHandle(measurements, { x: 99, y: 0 }, 5)).toEqual({ id: 'a', handle: 'b' })
		expect(hitHandle(measurements, { x: 100, y: 0.6 }, 5, 'b')).toEqual({ id: 'b', handle: 'a' })
		expect(hitHandle(measurements, { x: 50, y: 50 }, 5)).toBeUndefined()
	})

	test('scale with the zoom through the radius in image pixels', () => {
		expect(hitHandle(measurements, { x: 0.3, y: 0 }, 12 / 32)).toEqual({ id: 'a', handle: 'a' })
		expect(hitHandle(measurements, { x: 0.5, y: 0 }, 12 / 32)).toBeUndefined()
	})

	test('pick a visible line', () => {
		expect(hitMeasurement(measurements, { x: 50, y: 2 }, 3)).toBe('a')
		expect(hitMeasurement(measurements, { x: 55, y: 50 }, 3)).toBeUndefined()
	})
})

describe('drafts', () => {
	test('a drag draws a distance', () => {
		const { draft, take } = pressDraft(undefined, { x: 10, y: 10 }, context())
		const moved = moveDraft(draft, { x: 50, y: 10 })
		const { draft: after, commit } = releaseDraft(moved, { x: 50, y: 10 }, 3)

		expect(take).toBeTrue()
		expect(after).toBeUndefined()
		expect(commit).toEqual({ type: 'add', measurement: { kind: 'distance', a: { x: 10, y: 10 }, b: { x: 50, y: 10 }, visible: true } })
	})

	test('two clicks draw a distance', () => {
		const first = releaseDraft(pressDraft(undefined, { x: 10, y: 10 }, context()).draft, { x: 11, y: 10 }, 3)
		expect(first.commit).toBeUndefined()
		expect(first.draft).toMatchObject({ type: 'create', pressed: false })

		const hovered = moveDraft(first.draft, { x: 40, y: 40 })
		const second = releaseDraft(pressDraft(hovered, { x: 70, y: 10 }, context()).draft, { x: 70, y: 10 }, 3)
		expect(second.commit).toEqual({ type: 'add', measurement: { kind: 'distance', a: { x: 10, y: 10 }, b: { x: 70, y: 10 }, visible: true } })
	})

	test('a handle is dragged in any mode and the rest pans outside a mode', () => {
		const measurements = [distance('a', { x: 0, y: 0 }, { x: 100, y: 0 })]
		const edit = pressDraft(undefined, { x: 101, y: 1 }, context({ mode: 'pan', measurements }))
		const released = releaseDraft(moveDraft(edit.draft, { x: 120, y: 30 }), { x: 120, y: 30 }, 3)

		expect(edit.take).toBeTrue()
		expect(released.commit).toEqual({ type: 'update', measurement: distance('a', { x: 0, y: 0 }, { x: 120, y: 30 }) })
		expect(pressDraft(undefined, { x: 50, y: 50 }, context({ mode: 'pan', measurements }))).toEqual({ draft: undefined, take: false })
	})

	test('a draft of another image is abandoned', () => {
		const waiting = draftFrom('other', { x: 5, y: 5 })
		const { draft } = pressDraft(waiting, { x: 50, y: 50 }, context())

		expect(draft).toMatchObject({ imageId: 'image', anchor: { x: 50, y: 50 } })
	})

	test('measure from here waits for the end', () => {
		const { commit } = releaseDraft(pressDraft(draftFrom('image', { x: 5, y: 5 }), { x: 80, y: 5 }, context()).draft, { x: 80, y: 5 }, 3)

		expect(commit).toEqual({ type: 'add', measurement: { kind: 'distance', a: { x: 5, y: 5 }, b: { x: 80, y: 5 }, visible: true } })
	})
})
