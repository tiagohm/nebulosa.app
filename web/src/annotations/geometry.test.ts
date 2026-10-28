import { describe, expect, test } from 'bun:test'
import type { AnnotationObject, AnnotationResult } from 'api'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { deg } from 'nebulosa/src/math/units/angle'
import { pointAt, skyDirections } from '../platesolving/wcs'
import type { OverlayView } from '../viewer/transform'
import { greatCircle, type LabelCandidate, layoutLabels, mergeProjections, offsetPosition, pickAnnotation, projectAnnotations, skyEllipse, skyPolyline } from './geometry'

// A TAN solution of a 200×100 image centred at its CRPIX, s degrees per pixel, rotated by angle (degrees) and mirrored
// when flipped, as in platesolving/wcs.test.ts.
function solution(ra: number, dec: number, { angle = 0, flipped = false, s = 0.001 } = {}): FitsHeader {
	const c = Math.cos(deg(angle))
	const n = Math.sin(deg(angle))
	const p = flipped ? 1 : -1
	return { CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN', CRPIX1: 100.5, CRPIX2: 50.5, CRVAL1: ra, CRVAL2: dec, CD1_1: p * s * c, CD1_2: -s * n, CD2_1: p * s * n, CD2_2: s * c, NAXIS1: 200, NAXIS2: 100 }
}

// Center of the solutions, radians.
const RA = deg(150)
const DEC = deg(20)

function object(patch: Partial<AnnotationObject> = {}): AnnotationObject {
	return { id: 'catalog:1', ref: { kind: 'catalog', id: 1 }, layer: 'deepSky', name: 'M 1', designations: [], typeName: 'Galaxy', rightAscension: RA, declination: DEC, ...patch }
}

function result(header: FitsHeader, objects: readonly AnnotationObject[], lines: AnnotationResult['constellations']['lines'] = []) {
	return { solution: header as AnnotationResult['solution'], width: 200, height: 100, objects, constellations: { lines, labels: [{ name: 'Leo', code: 'LEO', rightAscension: RA, declination: DEC }] }, field: { rightAscension: RA, declination: DEC, radius: deg(0.12), scale: deg(0.001) } }
}

// Returns the first two vertices of SVG path data.
function vertices(path: string) {
	return [...path.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
}

describe('sky offsets', () => {
	test('towards north and east', () => {
		const [ra, dec] = offsetPosition(0, 0, 0.01, 0)
		expect(ra).toBeCloseTo(0, 12)
		expect(dec).toBeCloseTo(0.01, 12)
		expect(offsetPosition(0, 0, 0.01, Math.PI / 2)[0]).toBeCloseTo(0.01, 12)
	})

	test('an ellipse points its major axis to the position angle', () => {
		const points = skyEllipse(0, 0, 0.02, 0.01, 0, 4)
		expect(points[0][1]).toBeCloseTo(0.02, 9)
		expect(points[1][0]).toBeCloseTo(0.01, 9)
		const rotated = skyEllipse(0, 0, 0.02, 0.01, Math.PI / 2, 4)
		expect(rotated[0][0]).toBeCloseTo(0.02, 9)
		expect(rotated[0][1]).toBeCloseTo(0, 9)
	})

	test('great circles are sampled at most half a degree apart', () => {
		const points = greatCircle([0, 0], [deg(2), 0])
		expect(points).toHaveLength(5)
		expect(points[2][0]).toBeCloseTo(deg(1), 12)
		expect(greatCircle([1, 0.5], [1, 0.5])).toHaveLength(2)
	})
})

describe('projection', () => {
	test.each([
		{ angle: 0, flipped: false },
		{ angle: 37, flipped: false },
		{ angle: -120, flipped: true },
	])('an outline points north on the image at angle $angle, flipped $flipped', (orientation) => {
		const header = solution(150, 20, orientation)
		const projection = projectAnnotations(result(header, [object({ majorAxis: deg(0.04), minorAxis: deg(0.02), orientation: 0 })]))
		const [projected] = projection.objects
		const north = skyDirections(header, projected.anchor).north!
		const [first] = vertices(projected.outline!)

		expect(projected.anchor.x).toBeCloseTo(100, 6)
		expect(projected.anchor.y).toBeCloseTo(50, 6)
		expect(projected.approximate).toBeFalse()
		expect(projected.extent).toBeCloseTo(40, 6)
		expect((first.x - projected.anchor.x) / 20).toBeCloseTo(north.x, 2)
		expect((first.y - projected.anchor.y) / 20).toBeCloseTo(north.y, 2)
	})

	test('an outline without an orientation is an approximate circle, and an object without a size has none', () => {
		const projection = projectAnnotations(result(solution(150, 20), [object({ majorAxis: deg(0.04) }), object({ id: 'catalog:2' })]))
		expect(projection.objects[0].approximate).toBeTrue()
		for (const point of vertices(projection.objects[0].outline!)) expect(Math.hypot(point.x - 100, point.y - 50)).toBeCloseTo(20, 1)
		expect(projection.objects[1].outline).toBeUndefined()
		expect(projection.objects[1].extent).toBe(0)
	})

	test('the motion of a body during the exposure', () => {
		const header = solution(150, 20)
		const [projected] = projectAnnotations(result(header, [object({ layer: 'solarSystem', motion: { start: [RA, DEC], end: [RA, DEC + deg(0.01)] } })])).objects
		expect(projected.motion![0]).toEqual(pointAt(header, RA, DEC)!)
		expect(projected.motion![1]).toEqual(pointAt(header, RA, DEC + deg(0.01))!)
	})

	test('constellation figures and labels', () => {
		const projection = projectAnnotations(
			result(
				solution(150, 20),
				[],
				[
					[
						[RA - deg(1), DEC],
						[RA + deg(1), DEC],
					],
				],
			),
		)
		expect(projection.constellations).toHaveLength(1)
		expect(projection.constellations[0].startsWith('M')).toBeTrue()
		expect(projection.labels).toEqual([{ name: 'Leo', point: pointAt(solution(150, 20), RA, DEC)! }])
	})

	test('a polyline breaks where it leaves the tangent plane', () => {
		const path = skyPolyline(
			solution(150, 20),
			[
				[RA, DEC],
				[RA + Math.PI, -DEC],
				[RA, DEC + deg(0.01)],
			],
			200,
			100,
		)
		expect(path.match(/M/g)).toHaveLength(2)
		expect(path).not.toContain('L')
	})
})

describe('labels', () => {
	const view: OverlayView = { scale: 1, visible: { x: 0, y: 0, width: 400, height: 400 } }

	function candidate(key: string, x: number, y: number, priority: number = 0): LabelCandidate {
		return { key, anchor: { x, y }, text: 'NGC 1234', priority, clearance: 5 }
	}

	test('labels of nearby markers do not overlap and are placed by priority within the budget', () => {
		const labels = layoutLabels([candidate('b', 100, 100, 2), candidate('a', 100, 104, 1), candidate('c', 300, 300, 3)], view, 11, 2)
		expect(labels.map((e) => e.key)).toEqual(['a', 'b'])
		expect(labels[0]).toMatchObject({ textAnchor: 'start', baseline: 'central' })
		expect(labels[1].textAnchor).not.toBe('start')
		expect(layoutLabels([candidate('b', 100, 100, 2), candidate('a', 100, 104, 1)], view, 11, 2)).toEqual(labels)
	})

	test('the pinned label goes first and no label covers a marker', () => {
		const labels = layoutLabels([candidate('a', 100, 100, 1), candidate('b', 120, 100, 2)], view, 11, 1, 'b')
		expect(labels.map((e) => e.key)).toEqual(['b'])
		// The right of a would cover the marker of b, 20 px away.
		const [a] = layoutLabels([candidate('a', 100, 100, 1), candidate('b', 120, 100, 2)], view, 11, 1)
		expect(a.textAnchor).not.toBe('start')
	})

	test('only the markers in view are labeled, in viewer coordinates', () => {
		const zoomed: OverlayView = { scale: 2, visible: { x: 50, y: 50, width: 100, height: 100 } }
		const [label] = layoutLabels([candidate('a', 100, 100), candidate('b', 10, 10)], zoomed, 11, 10)
		expect(label.key).toBe('a')
		expect(label.x).toBeCloseTo(100 + 8 / 2, 9)
		expect(label.y).toBe(100)
	})
})

describe('picking', () => {
	const projection = projectAnnotations(result(solution(150, 20), [object({ majorAxis: deg(0.06) }), object({ id: 'catalog:2', rightAscension: RA + deg(0.02) })]))

	test('the closest marker within the radius, then the extent holding the point', () => {
		const second = projection.objects[1].anchor
		expect(pickAnnotation(projection.objects, { x: second.x + 1, y: second.y }, 8)).toBe('catalog:2')
		expect(pickAnnotation(projection.objects, { x: 100, y: 50 + 20 }, 8)).toBe('catalog:1')
		expect(pickAnnotation(projection.objects, { x: 100, y: 50 + 40 }, 8)).toBeUndefined()
	})
})

describe('merging', () => {
	test('the objects of every result and the constellations of the local one', () => {
		const header = solution(150, 20)
		const local = projectAnnotations(
			result(
				header,
				[object()],
				[
					[
						[RA - deg(1), DEC],
						[RA + deg(1), DEC],
					],
				],
			),
		)
		const minor = projectAnnotations({ ...result(header, [object({ id: 'skybot:1', layer: 'minorBody', positionError: deg(0.002) })]), constellations: { lines: [], labels: [] } })
		const merged = mergeProjections(minor, local)!

		expect(merged.objects.map((e) => e.object.id)).toEqual(['skybot:1', 'catalog:1'])
		expect(merged.constellations).toBe(local.constellations)
		expect(merged.objects[0].uncertainty).toBeCloseTo(2, 9)
		expect(mergeProjections(undefined, local)).toBe(local)
		expect(mergeProjections()).toBeUndefined()
	})
})
