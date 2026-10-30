import { expect, test } from 'bun:test'
import type { PointingSampleRecord } from 'api'
import { arcsec, deg } from 'nebulosa/src/math/units/angle'
import { errorArrowEnd, errorDistribution, errorMagnification, horizontalOfHourAngle, mapPoint, mapRings, mapWaypoints, rejectionReasons, shownRevision } from './skymap'

function sample(waypoint: number, status: PointingSampleRecord['status'], patch: Partial<PointingSampleRecord> = {}): PointingSampleRecord {
	return { id: `${waypoint}:${status}`, waypoint, status, ...patch } as PointingSampleRecord
}

test('the zenith is the center, the horizon the edge, north up and east to the right', () => {
	expect(mapPoint(0, deg(90), 100)).toEqual({ x: 0, y: -0 })

	const north = mapPoint(0, 0, 100)
	expect(north.x).toBeCloseTo(0, 9)
	expect(north.y).toBeCloseTo(-100, 9)

	const east = mapPoint(deg(90), 0, 100)
	expect(east.x).toBeCloseTo(100, 9)
	expect(east.y).toBeCloseTo(0, 9)

	expect(mapPoint(deg(180), deg(45), 100).y).toBeCloseTo(50, 9)
})

test('an hour angle maps to the sky of the site', () => {
	const latitude = deg(-23)
	const [azimuth, altitude] = horizontalOfHourAngle(0, deg(-23), latitude)
	expect(altitude).toBeCloseTo(deg(90), 6)
	expect(azimuth).toBeDefined()

	// East of the meridian the azimuth is east; the south celestial pole stands at the latitude, south.
	expect(Math.sin(horizontalOfHourAngle(deg(-60), 0, latitude)[0])).toBeGreaterThan(0)
	const [poleAzimuth, poleAltitude] = horizontalOfHourAngle(0, deg(-90), latitude)
	expect(poleAltitude).toBeCloseTo(deg(23), 6)
	expect(Math.cos(poleAzimuth)).toBeCloseTo(-1, 6)
})

test('an error arrow points the way the error goes on the sky', () => {
	const latitude = deg(-23)
	const waypoint = { hourAngle: 0, declination: deg(-60) }
	const start = mapPoint(...horizontalOfHourAngle(waypoint.hourAngle, waypoint.declination, latitude), 100)

	// South of the zenith on the meridian: north is towards the top of the map, and east to the right.
	const north = errorArrowEnd(waypoint, 0, arcsec(100), latitude, 500, 100)
	expect(north.y).toBeLessThan(start.y)
	expect(Math.abs(north.x - start.x)).toBeLessThan(0.5)

	const east = errorArrowEnd(waypoint, arcsec(100), 0, latitude, 500, 100)
	expect(east.x).toBeGreaterThan(start.x)
})

test('a waypoint shows its best sample, and the current one stands out', () => {
	const plan = {
		waypoints: [
			{ index: 0, azimuth: 0, altitude: deg(60), hourAngle: 0, declination: 0, expectedPierSide: 'EAST', role: 'training' },
			{ index: 1, azimuth: 1, altitude: deg(50), hourAngle: 0, declination: 0, expectedPierSide: 'EAST', role: 'heldOut' },
			{ index: 2, azimuth: 2, altitude: deg(40), hourAngle: 0, declination: 0, expectedPierSide: 'WEST', role: 'training' },
			{ index: 3, azimuth: 3, altitude: deg(30), hourAngle: 0, declination: 0, expectedPierSide: 'WEST', role: 'training' },
		],
	} as const

	const mapped = mapWaypoints(plan, [sample(0, 'rejected'), sample(0, 'accepted'), sample(1, 'accepted'), sample(1, 'rejected')], 2, 100)
	expect(mapped.map((waypoint) => waypoint.status)).toEqual(['accepted', 'accepted', 'current', 'planned'])
	expect(mapped[1].heldOut).toBeTrue()
	expect(mapped[0].sample?.id).toBe('0:accepted')
})

test('the rings go up from the horizon', () => {
	expect(mapRings()).toEqual([0, deg(30), deg(60)])
})

test('the magnification brings the largest error to a tenth of the radius', () => {
	const magnification = errorMagnification([arcsec(30), arcsec(120)], 100)
	expect(arcsec(120) * magnification * (100 / (Math.PI / 2))).toBeCloseTo(10, 9)
	expect(errorMagnification([], 100)).toBe(1)
	expect(errorMagnification([0], 100)).toBe(1)
})

test('a distribution of no errors holds no measure, never a zero', () => {
	expect(errorDistribution([])).toEqual({ count: 0 })

	const { count, rms, median, p95 } = errorDistribution([3, 1, 2, 4])
	expect(count).toBe(4)
	expect(median).toBe(3)
	expect(p95).toBe(4)
	expect(rms).toBeCloseTo(Math.sqrt(7.5), 12)
})

test('the rejection reasons are counted, most common first', () => {
	const samples = [sample(0, 'rejected', { reason: 'B' }), sample(1, 'rejected', { reason: 'A' }), sample(2, 'rejected', { reason: 'A' }), sample(3, 'accepted', { reason: 'ignored' })]
	expect(rejectionReasons(samples)).toEqual([
		['A', 2],
		['B', 1],
	])
})

test('a view shows the revision asked for, else the latest', () => {
	const revisions = [{ revisionId: 'a' }, { revisionId: 'b' }] as never
	expect(shownRevision({ revisions }, 'a')?.revisionId).toBe('a')
	expect(shownRevision({ revisions }, 'gone')?.revisionId).toBe('b')
	expect(shownRevision({ revisions })?.revisionId).toBe('b')
	expect(shownRevision({ revisions: [] })).toBeUndefined()
})
