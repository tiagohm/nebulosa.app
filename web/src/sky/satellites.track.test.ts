import { expect, test } from 'bun:test'
import type { SatelliteTrack } from 'api'
import { interpolateTrack, TRACK_MAX_SPAN_MS, TRACK_MIN_SPAN_MS, TRACK_SAMPLES, trackWindow, windowServes } from './satellites.track'

const DEG = Math.PI / 180

function separation(ra1: number, dec1: number, ra2: number, dec2: number) {
	return Math.acos(Math.min(1, Math.sin(dec1) * Math.sin(dec2) + Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2)))
}

// A great circle inclined 51.6° to the equator, swept at the angular rate of a low orbit seen from the Earth's center
// (one turn in 92.9 minutes), sampled every `step` milliseconds from t = 0.
function orbit(step: number, count: number, from = 0): SatelliteTrack {
	const inclination = 51.6 * DEG
	const times: number[] = []
	const rightAscension: number[] = []
	const declination: number[] = []
	for (let i = 0; i < count; i++) {
		const time = from + i * step
		const u = (2 * Math.PI * time) / (92.9 * 60_000)
		const x = Math.cos(u)
		const y = Math.sin(u) * Math.cos(inclination)
		const z = Math.sin(u) * Math.sin(inclination)
		times.push(time)
		rightAscension.push((Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI))
		declination.push(Math.asin(z))
	}
	return { times, rightAscension, declination, altitude: times.map((time) => time / 1e6), sunlit: times.map((_, i) => i % 2 === 0) }
}

test('windows last ten real minutes at the clock rate, within their bounds, and repeat for nearby instants', () => {
	const now = Date.UTC(2026, 10, 4, 12, 0, 3)
	const realTime = trackWindow(now, 1)
	expect(realTime.step).toBe(10_000)
	expect(realTime.end - realTime.start).toBe(TRACK_SAMPLES * 10_000)
	expect(realTime.start).toBeLessThanOrEqual(now - 60_000)
	expect(trackWindow(now + 2000, 1)).toEqual(realTime)
	expect(trackWindow(now, 0).end - trackWindow(now, 0).start).toBeGreaterThanOrEqual(TRACK_MIN_SPAN_MS)
	const fast = trackWindow(now, 10_000)
	expect(fast.end - fast.start).toBeLessThanOrEqual(TRACK_MAX_SPAN_MS)
	expect(fast.step).toBe(TRACK_MAX_SPAN_MS / TRACK_SAMPLES)

	expect(windowServes(realTime, now, 1)).toBeTrue()
	expect(windowServes(realTime, realTime.end - realTime.step + 1, 1)).toBeFalse()
	expect(windowServes(realTime, realTime.start + 1, -1)).toBeFalse()
	expect(windowServes(undefined, now, 1)).toBeFalse()
})

test('interpolation between 10 s samples of a low orbit stays within an arcsecond of the circle', () => {
	const coarse = orbit(10_000, 61)
	const dense = orbit(1000, 601)
	let worst = 0

	for (let i = 0; i < dense.times.length; i++) {
		const point = interpolateTrack(coarse, dense.times[i])!
		worst = Math.max(worst, separation(point.rightAscension, point.declination, dense.rightAscension[i], dense.declination[i]))
	}

	expect(worst / DEG).toBeLessThan(1 / 3600)
})

test('interpolation crosses the RA wrap and the pole, and stays inside the samples', () => {
	const track: SatelliteTrack = { times: [0, 1000], rightAscension: [359 * DEG, 1 * DEG], declination: [0, 0], sunlit: [true, false] }
	const middle = interpolateTrack(track, 500)!
	expect(Math.min(middle.rightAscension, 2 * Math.PI - middle.rightAscension) / DEG).toBeCloseTo(0, 9)
	expect(middle.declination).toBeCloseTo(0, 12)
	expect(middle.altitude).toBeUndefined()

	// Across the north pole along the 0h–12h meridian.
	const polar: SatelliteTrack = { times: [0, 1000], rightAscension: [0, Math.PI], declination: [88 * DEG, 88 * DEG], sunlit: [true, true] }
	expect(interpolateTrack(polar, 500)!.declination / DEG).toBeCloseTo(90, 6)

	const track2 = orbit(10_000, 3)
	expect(interpolateTrack(track2, -1)).toBeUndefined()
	expect(interpolateTrack(track2, 20_001)).toBeUndefined()
	expect(interpolateTrack(track2, 20_000)?.rightAscension).toBeCloseTo(track2.rightAscension[2], 12)
	expect(interpolateTrack(track2, 5000)?.altitude).toBeCloseTo(0.005, 12)
	expect(interpolateTrack(track2, 4000)?.sunlit).toBeTrue()
	expect(interpolateTrack(track2, 6000)?.sunlit).toBeFalse()
	expect(interpolateTrack({ times: [], rightAscension: [], declination: [], sunlit: [] }, 0)).toBeUndefined()
})
