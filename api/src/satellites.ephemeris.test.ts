import { expect, test } from 'bun:test'
import { satelliteWindowPasses } from 'nebulosa/src/astronomy/events/satellite'
import { geodeticLocation } from 'nebulosa/src/astronomy/observer/location'
import { greenwichApparentSiderealTime, timeToUnixMillis, timeUnix } from 'nebulosa/src/astronomy/time/time'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import { meter } from 'nebulosa/src/math/units/distance'
import type { EarthOrientationCoverage } from './astronomicaltime.eop'
import { normalizeImport } from './satellites.elements'
import { ELEMENT_AGE_LIMITS, GROUND_TRACK_MAX_MS, SATELLITE_LIMITS, SatelliteEphemeris } from './satellites.ephemeris'
import type { SatelliteElementSet } from './satellites.store'

const DAY = 86_400_000
const SITE = { latitude: -23.5475, longitude: -46.6361, elevation: 760 }

function elementsOf(text: string): SatelliteElementSet {
	const [record] = normalizeImport(text)!.records
	return { noradId: record.noradId, kind: 'manual', sourceKey: 'manual', epoch: record.epoch, omm: record.omm, digest: record.digest, fetchedAt: record.epoch }
}

function tle(line1: string, line2: string) {
	const checksum = (line: string) => {
		let sum = 0
		for (const c of line.slice(0, 68)) sum += c === '-' ? 1 : /\d/.test(c) ? +c : 0
		return line.slice(0, 68) + (sum % 10)
	}
	return `${checksum(line1)}\n${checksum(line2)}`
}

const ISS = elementsOf(tle('1 25544U 98067A   23231.51768399  .00014050  00000+0  25837-3 0  9996', '2 25544  51.6415  14.7889 0003559 325.3396 149.4637 15.49477580411611'))
// Synthetic near-circular, near-equatorial orbit of one revolution per sidereal day.
const GEO = elementsOf(tle('1 41866U 16071A   23231.50000000 -.00000245  00000-0  00000-0 0  9990', '2 41866   0.0430 263.6000 0001000 180.0000 180.0000  1.00271000 14600'))

const covered = (): EarthOrientationCoverage => ({ status: 'covered' })

function separation(ra1: number, dec1: number, ra2: number, dec2: number) {
	return Math.acos(Math.min(1, Math.sin(dec1) * Math.sin(dec2) + Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2)))
}

test('topocentric RA/Dec of date agree with the look angles through the apparent sidereal time', () => {
	const ephemeris = new SatelliteEphemeris(covered)

	for (const minutes of [0, 30, 55, 300]) {
		const time = ISS.epoch + minutes * 60_000
		const position = ephemeris.position(ISS, time, SITE)
		const latitude = SITE.latitude * DEG2RAD
		const { azimuth, altitude } = position as Required<typeof position>
		// Horizontal to equatorial of date with the geodetic latitude, and RA = LAST − hour angle.
		const declination = Math.asin(Math.sin(latitude) * Math.sin(altitude) + Math.cos(latitude) * Math.cos(altitude) * Math.cos(azimuth))
		const hourAngle = Math.atan2(-Math.sin(azimuth) * Math.cos(altitude), Math.cos(latitude) * Math.sin(altitude) - Math.sin(latitude) * Math.cos(altitude) * Math.cos(azimuth))
		const rightAscension = greenwichApparentSiderealTime(timeUnix(time / 1000)) + SITE.longitude * DEG2RAD - hourAngle
		expect(separation(position.rightAscension, position.declination, rightAscension, declination) / DEG2RAD).toBeLessThan(5 / 3600)

		// J2000 and of date differ by the precession and nutation since 2000: up to a third of a degree in 2023, less near
		// the ecliptic poles.
		const offset = separation(position.rightAscension, position.declination, position.rightAscensionJ2000, position.declinationJ2000) / DEG2RAD
		expect(offset).toBeGreaterThan(0.03)
		expect(offset).toBeLessThan(0.5)
		expect(position.center).toBe('topocentric')
		expect(position.rightAscension).toBeGreaterThanOrEqual(0)
		expect(position.rightAscension).toBeLessThan(2 * Math.PI)
		for (const value of Object.values(position)) if (typeof value === 'number') expect(Number.isFinite(value)).toBeTrue()
	}
})

test('a geostationary satellite stands at the zenith of its subpoint, and the geocenter sees its distance', () => {
	const ephemeris = new SatelliteEphemeris(covered)
	const geocentric = ephemeris.position(GEO, GEO.epoch)
	expect(geocentric.center).toBe('geocentric')
	expect(geocentric.azimuth).toBeUndefined()
	expect(geocentric.distanceKm).toBeCloseTo(geocentric.geocentricDistanceKm, 6)
	expect(geocentric.geocentricDistanceKm).toBeGreaterThan(42_000)

	const below = { latitude: geocentric.subpointLatitude / DEG2RAD, longitude: geocentric.subpointLongitude / DEG2RAD, elevation: 0 }
	const position = ephemeris.position(GEO, GEO.epoch, below)
	expect(position.altitude! / DEG2RAD).toBeGreaterThan(89.9)
	expect(position.distanceKm).toBeCloseTo(position.heightKm, -1)
	expect(position.apparentAltitude).toBeCloseTo(position.altitude!, 6)

	const orbit = ephemeris.orbit(GEO)
	expect(orbit.model).toBe('deepSpace')
	expect(orbit.periodMinutes).toBeCloseTo(1436.1, 0)
	expect(ephemeris.orbit(ISS)).toMatchObject({ model: 'nearEarth', meanMotion: 15.4947758 })
	expect(ephemeris.orbit(ISS).periodMinutes).toBeCloseTo(92.94, 1)
})

test('a pass across a day boundary of the search is one pass, as in a single search', async () => {
	const ephemeris = new SatelliteEphemeris(covered)
	const site = geodeticLocation(SITE.longitude * DEG2RAD, SITE.latitude * DEG2RAD, meter(SITE.elevation))
	const day = satelliteWindowPasses(ephemeris.record(ISS), site, timeUnix(ISS.epoch / 1000), timeUnix((ISS.epoch + DAY) / 1000), { step: 10 / 86_400 })
	const culmination = timeToUnixMillis(day[2].culmination.time)

	// The window starts a day before a culmination, so the day boundary of the search cuts that pass in two.
	const { passes, truncated } = await ephemeris.passes(ISS, SITE, culmination - DAY, culmination + 3_600_000, { minAltitude: 0, maxSunAltitude: -6 * DEG2RAD })
	expect(truncated).toBeFalse()
	const whole = satelliteWindowPasses(ephemeris.record(ISS), site, timeUnix((culmination - DAY) / 1000), timeUnix((culmination + 3_600_000) / 1000), { step: 10 / 86_400 })
	expect(passes).toHaveLength(whole.length)
	const last = passes.at(-1)!
	expect(last.startsBeforeWindow || last.endsAfterWindow).toBeFalse()
	expect(Math.abs(last.culmination.time - culmination)).toBeLessThan(1000)
	expect(Math.abs(last.start.time - timeToUnixMillis(day[2].start.time))).toBeLessThan(1000)
	expect(last.culminationShadow).toMatch(/sunlit|penumbra|umbra/)
	for (const part of last.visible) {
		expect(part.start).toBeGreaterThanOrEqual(last.start.time)
		expect(part.end).toBeLessThanOrEqual(last.end.time)
	}
})

test('a geostationary satellite is one pass over the whole window', async () => {
	const ephemeris = new SatelliteEphemeris(covered)
	const geocentric = ephemeris.position(GEO, GEO.epoch)
	const near = { latitude: -10, longitude: geocentric.subpointLongitude / DEG2RAD + 20, elevation: 0 }
	const { passes } = await ephemeris.passes(GEO, near, GEO.epoch, GEO.epoch + 3 * DAY, { minAltitude: 0, maxSunAltitude: -6 * DEG2RAD })
	expect(passes).toHaveLength(1)
	expect(passes[0]).toMatchObject({ startsBeforeWindow: true, endsAfterWindow: true, start: { time: GEO.epoch }, end: { time: GEO.epoch + 3 * DAY } })
})

test('a cancelled pass search stops', async () => {
	const ephemeris = new SatelliteEphemeris(covered)
	const controller = new AbortController()
	const search = ephemeris.passes(ISS, SITE, ISS.epoch, ISS.epoch + 7 * DAY, { minAltitude: 0, maxSunAltitude: 0 }, controller.signal)
	controller.abort(new Error('superseded'))
	await expect(search).rejects.toThrow('superseded')
	await expect(ephemeris.ephemeris(ISS, ISS.epoch, ISS.epoch + DAY, 10_000, SITE, controller.signal)).rejects.toThrow('superseded')
})

test('ephemeris rows and tracks are bounded and match the positions', async () => {
	const ephemeris = new SatelliteEphemeris(covered)
	const table = await ephemeris.ephemeris(ISS, ISS.epoch, ISS.epoch + 600_000, 60_000, SITE)
	expect(table.truncated).toBeFalse()
	expect(table.rows.map((row) => row.time)).toEqual(Array.from({ length: 11 }, (_, i) => ISS.epoch + i * 60_000))
	expect(table.rows[3]).toEqual(ephemeris.position(ISS, ISS.epoch + 180_000, SITE))
	expect((await ephemeris.ephemeris(ISS, ISS.epoch, ISS.epoch + DAY, 1000)).truncated).toBeTrue()

	const track = ephemeris.track(ISS, ISS.epoch, ISS.epoch + 600_000, 10_000, 1000, SITE)
	expect(track.times).toHaveLength(61)
	expect(track.altitude).toHaveLength(61)
	const position = ephemeris.position(ISS, track.times[30], SITE)
	expect(separation(track.rightAscension[30], track.declination[30], position.rightAscension, position.declination) / DEG2RAD).toBeLessThan(1 / 3600)
	expect(track.altitude![30]).toBeCloseTo(position.altitude!, 6)
	expect(track.sunlit[30]).toBe(position.shadow !== 'umbra')
	expect(ephemeris.track(ISS, ISS.epoch, ISS.epoch + DAY, 1000, 100).times).toHaveLength(100)
	expect(ephemeris.track(ISS, ISS.epoch, ISS.epoch + 60_000, 10_000, 100).altitude).toBeUndefined()
	expect(SATELLITE_LIMITS.seriesObjects).toBe(50)
})

test('a ground track spans an orbit before the instant and the orbits after it, with the footprint and the Sun', async () => {
	const ephemeris = new SatelliteEphemeris(covered)
	const time = ISS.epoch
	const track = await ephemeris.groundTrack(ISS, time, 2)
	const period = track.periodMinutes * 60_000
	expect(track.periodMinutes).toBeCloseTo(92.9, 0)
	expect(track.step).toBe(31_000)
	expect(track.start).toBe(Math.round(time - period))
	expect(track.end).toBe(Math.round(time + 2 * period))
	expect(track.truncated).toBeFalse()
	expect(track.times).toHaveLength(Math.floor((track.end - track.start) / track.step) + 1)
	for (const values of [track.latitude, track.longitude, track.heightKm, track.footprint, track.shadow, track.sunLatitude, track.sunLongitude]) expect(values).toHaveLength(track.times.length)

	// The subpoint stays within the inclination and agrees with the position, longitudes in (−π, π].
	expect(Math.max(...track.latitude.map(Math.abs)) / DEG2RAD).toBeLessThan(51.8)
	expect(Math.max(...track.latitude.map(Math.abs)) / DEG2RAD).toBeGreaterThan(51)
	expect(track.longitude.every((longitude) => longitude > -Math.PI && longitude <= Math.PI)).toBeTrue()
	const position = ephemeris.position(ISS, track.times[100])
	expect(track.latitude[100]).toBeCloseTo(position.subpointLatitude, 9)
	expect(track.longitude[100]).toBeCloseTo(position.subpointLongitude, 9)
	expect(track.heightKm[100]).toBeCloseTo(position.heightKm, 6)
	expect(track.shadow[100]).toBe(position.shadow)

	// About 420 km high, the ISS is seen up to about 20° from its subpoint, and it crosses the Earth's shadow every orbit.
	expect(track.heightKm[0]).toBeGreaterThan(400)
	expect(track.heightKm[0]).toBeLessThan(440)
	expect(track.footprint[0] / DEG2RAD).toBeGreaterThan(19.5)
	expect(track.footprint[0] / DEG2RAD).toBeLessThan(21)
	expect(track.shadow).toContain('sunlit')
	expect(track.shadow).toContain('umbra')

	// The Sun stands over the solar declination of 19 August (about +12.6°), and over the meridian of the apparent solar
	// noon: 15° west per hour after the apparent noon at Greenwich, 12:03.6 UTC (equation of time −3.6 min).
	const hours = (track.times[0] % 86_400_000) / 3_600_000
	expect(track.sunLatitude[0] / DEG2RAD).toBeCloseTo(12.6, 0)
	expect(track.sunLongitude[0] / DEG2RAD).toBeCloseTo(-15 * (hours - 12) + 0.9, 0)
})

test('a ground track is bounded by its orbits and its span, and stops when cancelled', async () => {
	const ephemeris = new SatelliteEphemeris(covered)
	const iss = await ephemeris.groundTrack(ISS, ISS.epoch, 50)
	expect(iss.end - ISS.epoch).toBe(Math.round(5 * iss.periodMinutes * 60_000))

	// A geostationary satellite: an orbit before and two days after, every 5 minutes, over a fixed point of the equator.
	const geo = await ephemeris.groundTrack(GEO, GEO.epoch, 3)
	expect(geo.end - geo.start).toBe(GROUND_TRACK_MAX_MS)
	expect(geo.step).toBe(300_000)
	expect(geo.times.length).toBeLessThanOrEqual(SATELLITE_LIMITS.groundTrackSamples)
	expect(Math.max(...geo.latitude.map(Math.abs)) / DEG2RAD).toBeLessThan(0.1)
	expect((Math.max(...geo.longitude) - Math.min(...geo.longitude)) / DEG2RAD).toBeLessThan(0.5)
	expect(geo.footprint[0] / DEG2RAD).toBeCloseTo(81.3, 0)

	const controller = new AbortController()
	controller.abort(new Error('superseded'))
	await expect(ephemeris.groundTrack(ISS, ISS.epoch, 5, controller.signal)).rejects.toThrow('superseded')
})

test('quality follows the age of the elements, the decay, propagation, and the Earth orientation', () => {
	const ephemeris = new SatelliteEphemeris(covered)
	expect(ephemeris.quality(ISS, [ISS.epoch + DAY])).toEqual({ suitability: 'usable', reasons: [], elementAgeDays: 1, eop: 'covered' })
	expect(ephemeris.quality(ISS, [ISS.epoch + (ELEMENT_AGE_LIMITS.low.caution + 1) * DAY]).reasons).toEqual(['elementsAging'])
	expect(ephemeris.quality(ISS, [ISS.epoch - (ELEMENT_AGE_LIMITS.low.unavailable + 1) * DAY])).toMatchObject({ suitability: 'unavailable', reasons: ['elementsOld'], elementAgeDays: -(ELEMENT_AGE_LIMITS.low.unavailable + 1) })
	// A geostationary object ages more slowly.
	expect(ephemeris.quality(GEO, [GEO.epoch + 10 * DAY]).suitability).toBe('usable')
	expect(ephemeris.quality(ISS, [ISS.epoch, ISS.epoch + DAY], '2023-08-20')).toMatchObject({ suitability: 'unavailable', reasons: ['decayed'] })
	expect(ephemeris.quality(ISS, [ISS.epoch], undefined, true).reasons).toEqual(['propagationError'])

	const uncovered = new SatelliteEphemeris(() => ({ status: 'notLoaded' }))
	expect(uncovered.quality(ISS, [ISS.epoch])).toEqual({ suitability: 'caution', reasons: ['eopApproximate'], elementAgeDays: 0, eop: 'notLoaded' })
})

test('every computation propagates its own copy of the prepared record', () => {
	const ephemeris = new SatelliteEphemeris(covered)
	const first = ephemeris.record(GEO)
	const second = ephemeris.record(GEO)
	expect(first).not.toBe(second)
	expect(first).toEqual(second)
	// Propagating far ahead with one copy leaves the integrator state of the other untouched.
	ephemeris.position(GEO, GEO.epoch + 30 * DAY)
	expect(ephemeris.position(GEO, GEO.epoch)).toEqual(new SatelliteEphemeris(covered).position(GEO, GEO.epoch))
})
