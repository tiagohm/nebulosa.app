import { expect, test } from 'bun:test'
import { localSiderealTime, geodeticLocation } from 'nebulosa/src/astronomy/observer/location'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import type { PierSide } from 'nebulosa/src/devices/indi/device'
import { arcsec, deg, normalizeAngle, toArcsec } from 'nebulosa/src/math/units/angle'
import { correctPointingCoordinate, predictPointingModelError } from 'nebulosa/src/observation/mount/pointing'
import { planPointingWaypoints } from 'nebulosa/src/observation/mount/pointing.plan'
import { computePointingFit, type PointingFitRequest, type PointingFitSample, pointingFitOptions, PointingModelFitter } from './mountpointing.fit'
import { POINTING_MODEL_FRAME, type PointingSite } from './mountpointing.frames'

const SITE: PointingSite = { latitude: deg(-23), longitude: deg(-46), elevation: 700 }
const NOW = Date.UTC(2026, 9, 30, 3, 0, 0)

// Samples of a mount with a constant east and north offset and a west pier offset, with the noise of a repeatable sequence.
function samples(count: number, sides: 'both' | PierSide = 'both'): PointingFitSample[] {
	const location = geodeticLocation(SITE.longitude, SITE.latitude, 0)
	const { waypoints } = planPointingWaypoints({ pattern: 'goldenSpiral', count, latitude: SITE.latitude, limits: { declination: [deg(-75), deg(75)] } })

	return waypoints.map((waypoint, index) => {
		const time = NOW + index * 60000
		const lst = localSiderealTime(timeUnix(time / 1000, true), location)
		const pierSide = sides === 'both' ? waypoint.expectedPierSide : sides
		const declination = waypoint.declination
		const rightAscension = normalizeAngle(lst - waypoint.hourAngle)
		const dx = arcsec(120 + 1.5 * Math.sin(index * 7.3)) + (pierSide === 'WEST' ? arcsec(40) : 0)
		const dy = arcsec(90 + 1.5 * Math.cos(index * 5.1))
		return { id: `s${index}`, time, pierSide, command: { rightAscension, declination }, solved: { rightAscension: normalizeAngle(rightAscension + dx / Math.cos(declination)), declination: declination + dy } }
	})
}

// A request with every fifth sample withheld.
function request(all: readonly PointingFitSample[], strategy: PointingFitRequest['strategy'] = 'hybrid'): PointingFitRequest {
	return { strategy, site: SITE, training: all.filter((_, index) => index % 5 !== 0), heldOut: all.filter((_, index) => index % 5 === 0) }
}

test('a model fitted to a constant offset removes it from the sky it has not seen', () => {
	const { fitted, offline, gate, residuals } = computePointingFit(request(samples(50)))

	expect(fitted.usable).toBeTrue()
	expect(gate).toBe('passed')
	expect(offline.heldOutCount).toBe(10)
	expect(toArcsec(offline.heldOutRawRms!)).toBeGreaterThan(140)
	expect(toArcsec(offline.heldOutRms!)).toBeLessThan(6)
	expect(toArcsec(offline.looRms!)).toBeLessThan(6)
	expect(residuals).toHaveLength(50)
})

test('withheld samples stay out of the fit', () => {
	const all = samples(50)
	const base = request(all)
	const poisoned = { ...base, heldOut: base.heldOut.map((sample) => ({ ...sample, solved: { ...sample.solved, declination: sample.solved.declination + arcsec(600) } })) }

	expect(computePointingFit(poisoned).fitted).toEqual(computePointingFit(base).fitted)
	expect(computePointingFit(poisoned).gate).toBe('failed')
})

test('the default features stay determined at the sample counts of a long run', () => {
	expect(computePointingFit(request(samples(80))).fitted.usable).toBeTrue()
})

test('a run on one pier side leaves the pier terms out', () => {
	const one = request(samples(60, 'EAST'))
	expect(pointingFitOptions(one).featureConfiguration?.includePierSideTerms).toBeFalse()
	expect(pointingFitOptions(request(samples(60))).featureConfiguration?.includePierSideTerms).toBeTrue()
	expect(computePointingFit(one).fitted.usable).toBeTrue()
})

test('the options of a request take precedence over the defaults of a run', () => {
	expect(pointingFitOptions({ ...request(samples(30)), options: { featureConfiguration: { includeCrossTerms: true } } }).featureConfiguration?.includeCrossTerms).toBeTrue()
	expect(pointingFitOptions({ ...request(samples(30)), minimumAltitude: deg(30) }).validation?.minimumAltitude).toBe(deg(30))
})

test('a fit without withheld samples never passes, and shows no invented measure', () => {
	const { offline, gate } = computePointingFit({ ...request(samples(40)), heldOut: [] })
	expect(gate).toBe('failed')
	expect(offline.heldOutCount).toBe(0)
	expect(offline.heldOutRms).toBeUndefined()
	expect(offline.heldOutRawRms).toBeUndefined()
})

test('too few samples give an unusable model', () => {
	const { fitted, gate, offline } = computePointingFit({ ...request(samples(40)), training: samples(40).slice(0, 4), strategy: 'semiPhysical' })
	expect(fitted.usable).toBeFalse()
	expect(gate).toBe('unusable')
	expect(offline.trainingRms).toBeUndefined()
	expect(offline.looRms).toBeUndefined()
})

test('a pier side without withheld samples fails the gate', () => {
	const base = request(samples(50))
	expect(computePointingFit({ ...base, heldOut: base.heldOut.filter((sample) => sample.pierSide === 'EAST') }).gate).toBe('failed')
})

test('the worker answers the same model, which survives a JSON copy', async () => {
	const fitter = new PointingModelFitter()
	const input = request(samples(40), 'auto')
	const result = await fitter.fit(input)
	const local = computePointingFit(input)

	expect(result.gate).toBe(local.gate)
	expect(result.fitted.strategy).toBe(local.fitted.strategy)

	const [{ command, time, pierSide }] = input.training
	const context = { ...command, time: timeUnix(time / 1000, true), latitude: SITE.latitude, longitude: SITE.longitude, pierSide, frame: POINTING_MODEL_FRAME } as const
	const copy = JSON.parse(JSON.stringify(result.fitted)) as typeof result.fitted

	expect(predictPointingModelError(copy, context).dx).toBeCloseTo(predictPointingModelError(result.fitted, context).dx, 12)
	expect(correctPointingCoordinate(copy, context).converged).toBeTrue()
})

test('a fit is cancelled by its signal, and the next one still runs', async () => {
	const fitter = new PointingModelFitter()
	const controller = new AbortController()
	const cancelled = fitter.fit(request(samples(40), 'auto'), controller.signal)
	controller.abort(new Error('stopped'))

	expect(cancelled).rejects.toThrow('stopped')
	expect((await fitter.fit(request(samples(30)))).fitted.usable).toBeTrue()
})
