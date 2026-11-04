import { expect, test } from 'bun:test'
import type { SatelliteGroundTrack } from 'api'
import { groundTrackAt, groundTrackRuns, observerInFootprint } from './groundtrack'

const RAD = Math.PI / 180

// Four samples along the equator a minute apart, across the antimeridian, entering the Earth's shadow at the third.
const TRACK: SatelliteGroundTrack = {
	start: 0,
	end: 180_000,
	step: 60_000,
	periodMinutes: 90,
	times: [0, 60_000, 120_000, 180_000],
	latitude: [0, 0, 0, 0],
	longitude: [170 * RAD, 178 * RAD, -174 * RAD, -166 * RAD],
	heightKm: [400, 410, 420, 430],
	footprint: [20 * RAD, 20 * RAD, 20 * RAD, 20 * RAD],
	shadow: ['sunlit', 'sunlit', 'umbra', 'umbra'],
	sunLatitude: [10 * RAD, 10 * RAD, 10 * RAD, 10 * RAD],
	sunLongitude: [179 * RAD, 179.5 * RAD, -180 * RAD, -179.5 * RAD],
	truncated: false,
}

test('a point between samples follows the great circle across the antimeridian', () => {
	const point = groundTrackAt(TRACK, 90_000)!
	expect(point.subpoint.longitude).toBeCloseTo(-178, 9)
	expect(point.subpoint.latitude).toBeCloseTo(0, 9)
	expect(point.heightKm).toBeCloseTo(415, 9)
	expect(point.footprint).toBeCloseTo(20, 9)
	expect(point.shadow).toBe('umbra')
	expect(point.subsolar.longitude).toBeCloseTo(179.75, 1)
	expect(groundTrackAt(TRACK, 0)!.subpoint.longitude).toBeCloseTo(170, 9)
	expect(groundTrackAt(TRACK, -1)).toBeUndefined()
	expect(groundTrackAt(TRACK, 180_001)).toBeUndefined()
})

test('runs split at the instant, at the shadow, and at the antimeridian', () => {
	const runs = groundTrackRuns(TRACK, 90_000)
	expect(runs.map((run) => [run.past, run.shadow])).toEqual([
		[true, 'sunlit'],
		[false, 'sunlit'],
		[false, 'umbra'],
	])
	// Before the instant: 170° to 178°, across ±180°, to the point of the instant at −178°.
	expect(runs[0].pieces).toHaveLength(2)
	expect(runs[0].pieces[0].map((point) => point.longitude)).toEqual([170, 178, 180])
	expect(runs[0].pieces[1][0].longitude).toBe(-180)
	expect(runs[0].pieces[1][1].longitude).toBeCloseTo(-178, 9)
	expect(runs[1].pieces[0][0].longitude).toBeCloseTo(-178, 9)
	expect(runs[1].pieces[0][1].longitude).toBeCloseTo(-174, 9)
	expect(runs[2].pieces[0].map((point) => Math.round(point.longitude))).toEqual([-174, -166])

	// Without an instant, every run is after it; at a sample, the runs meet there.
	expect(groundTrackRuns(TRACK).every((run) => !run.past)).toBeTrue()
	expect(groundTrackRuns(TRACK, 60_000).map((run) => [run.past, run.shadow])).toEqual([
		[true, 'sunlit'],
		[false, 'sunlit'],
		[false, 'umbra'],
	])
})

test('an observer is in the footprint within its radius of the subpoint', () => {
	const point = groundTrackAt(TRACK, 0)!
	expect(observerInFootprint({ latitude: 19.9, longitude: 170 }, point)).toBeTrue()
	expect(observerInFootprint({ latitude: 20.1, longitude: 170 }, point)).toBeFalse()
	expect(observerInFootprint({ latitude: 0, longitude: -170.1 }, point)).toBeTrue()
	expect(observerInFootprint({ latitude: 0, longitude: -169.9 }, point)).toBeFalse()
})
