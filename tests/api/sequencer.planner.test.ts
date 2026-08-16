import { describe, expect, test } from 'bun:test'
import { deg, toDeg } from 'nebulosa/src/math/units/angle'
import { meter } from 'nebulosa/src/math/units/distance'
import { SequencerPlannerHandler } from 'src/api/sequencer.planner'
import { speedUpTime } from 'src/shared/util'
import type { PlanTargets, TargetPlanCandidate } from '#/sequencer.planner'

speedUpTime()

// Sao Paulo. Reference values below come from Astropy 7 with the same site, refraction parameters, and instants.
const LOCATION = { latitude: deg(-23.5475), longitude: deg(-46.6361), elevation: meter(800) }

// 2025-07-27 21:00 to 2025-07-28 06:00, UTC-3.
const START = 1753660800000
const END = 1753693200000

const OMEGA_CENTAURI: TargetPlanCandidate = { id: 'omegaCen', name: 'Omega Centauri', rightAscension: deg(201.697), declination: deg(-47.4795) }
const M13: TargetPlanCandidate = { id: 'm13', name: 'M13', rightAscension: deg(250.4235), declination: deg(36.4613) }
const POLARIS: TargetPlanCandidate = { id: 'polaris', name: 'Polaris', rightAscension: deg(37.9545), declination: deg(89.2641) }
const M42: TargetPlanCandidate = { id: 'm42', name: 'M42', rightAscension: deg(83.8221), declination: deg(-5.3911) }

// Synthetic point culminating almost exactly overhead 16249.06 s into the window, at 89.87957 degrees, as a
// one-second scan of the same window puts it. The grid samples bracketing that instant reach only 89.7768 and
// 89.0312 degrees, so a limit placed between them is crossed entirely between two samples.
const ZENITH: TargetPlanCandidate = { id: 'zenith', name: 'Zenith', rightAscension: deg(326.8), declination: deg(-23.5475) }
const ZENITH_TRANSIT = START + 16249056

// The same point culminating 190 s earlier, which puts the culmination just before the middle of the window so
// that a ceiling placed under its peak leaves a shorter wing before it and a longer one after it.
const ZENITH_EARLY: TargetPlanCandidate = { id: 'zenithEarly', name: 'Zenith Early', rightAscension: deg(326), declination: deg(-23.5475) }

// The topocentric direction of the Moon 9000 s into the window, so the separation from this point reaches zero
// there and grows at about 0.00018 degrees per second on either side.
// The same point culminating between the two above, where a ceiling leaves two wings that the evaluated points
// alone cannot order: they differ by less than a sampling step until each one is extended to its real edge.
const ZENITH_BALANCED: TargetPlanCandidate = { id: 'zenithBalanced', name: 'Zenith Balanced', rightAscension: deg(326.5), declination: deg(-23.5475) }

const MOON_CROSSING: TargetPlanCandidate = { id: 'moonCrossing', name: 'Moon Crossing', rightAscension: deg(166.099001), declination: deg(6.290545) }

// Synthetic point culminating 51.43 s after the window opens, at 89.97073 degrees, as a ten-second scan of the
// same window puts it. The first evaluated point is the window boundary and every later one is lower, so the
// culmination falls inside the first sampling interval and nothing in the grid brackets it.
const ZENITH_OPENING: TargetPlanCandidate = { id: 'zenithOpening', name: 'Zenith Opening', rightAscension: deg(259.1), declination: deg(-23.5475) }

// The mirror case, culminating 36.96 s before the window closes at 89.87736 degrees.
const ZENITH_CLOSING: TargetPlanCandidate = { id: 'zenithClosing', name: 'Zenith Closing', rightAscension: deg(34.2), declination: deg(-23.5475) }

// Culminating 17.92 s after the window opens, at 89.97039 degrees, which is closer to the boundary than any
// subdivision of the first sampling interval reaches: every interior point of it sits below the boundary itself.
const ZENITH_GRAZING: TargetPlanCandidate = { id: 'zenithGrazing', name: 'Zenith Grazing', rightAscension: deg(258.96), declination: deg(-23.5475) }

// Rises after the window opens and culminates 12.4847 h into it at 89.98739 degrees, so its culmination is
// reached only from the one before the window, a sidereal day earlier.
const LATE_CULMINATION: TargetPlanCandidate = { id: 'lateCulmination', name: 'Late Culmination', rightAscension: deg(86.8), declination: deg(-23.5475) }

const handler = new SequencerPlannerHandler()

function request(targets: readonly TargetPlanCandidate[], overrides?: Partial<PlanTargets>): PlanTargets {
	return { location: LOCATION, start: START, end: END, targets, ...overrides }
}

describe('visibility', () => {
	test('plans a setting target and reports the window that produced it', () => {
		const plan = handler.planTargets(request([OMEGA_CENTAURI], { constraints: { minimumAltitude: deg(30) } }))

		expect(plan.anchor).toBe(START)
		expect(plan.end).toBe(END)
		expect(plan.step).toBe(300)
		expect(plan.discarded).toBeEmpty()
		expect(plan.targets).toHaveLength(1)

		const [target] = plan.targets

		expect(target.id).toBe('omegaCen')
		expect(target.order).toBe(0)
		// The target is already above 30 degrees when the window opens, so the run is cut by the window, not by the constraint.
		expect(target.visibilityStart).toBe(START)
		// Astropy puts the 30 degree crossing at 1753664025472; the refined edge stays on the visible side of it.
		expect(target.visibilityEnd).toBeGreaterThan(1753664025472 - 1200)
		expect(target.visibilityEnd).toBeLessThanOrEqual(1753664025472)
		expect(target.transit).toBe(START)
		expect(toDeg(target.maximumAltitude)).toBeCloseTo(39.0589, 2)
		// Topocentric, as the planner computes it; Astropy gives 63.4780 for the same site and instant.
		expect(toDeg(target.moonDistance)).toBeCloseTo(63.478, 2)
	})

	test('plans a rising target and refines the edge where it crosses the limit', () => {
		const plan = handler.planTargets(request([M42], { constraints: { minimumAltitude: deg(30) } }))

		expect(plan.targets).toHaveLength(1)

		const [target] = plan.targets

		// Astropy puts the 30 degree crossing at 1753690784486.
		expect(target.visibilityStart).toBeGreaterThanOrEqual(1753690784486)
		expect(target.visibilityStart).toBeLessThan(1753690784486 + 1200)
		expect(target.visibilityEnd).toBe(END)
		expect(target.transit).toBe(END)
		expect(toDeg(target.maximumAltitude)).toBeCloseTo(39.0953, 2)
	})

	test('discards a target that peaks just below the minimum altitude', () => {
		// M13 reaches 29.5153 degrees from this site in this window.
		const plan = handler.planTargets(request([M13], { constraints: { minimumAltitude: deg(30) } }))

		expect(plan.targets).toBeEmpty()
		expect(plan.discarded).toEqual([{ id: 'm13', name: 'M13', reason: 'belowMinimumAltitude' }])
	})

	test('discards a target that never rises', () => {
		const plan = handler.planTargets(request([POLARIS], { constraints: { minimumAltitude: deg(30) } }))

		expect(plan.discarded).toEqual([{ id: 'polaris', name: 'Polaris', reason: 'belowMinimumAltitude' }])
	})

	test('discards a target below the airmass limit while it is under the horizon', () => {
		const plan = handler.planTargets(request([POLARIS], { constraints: { maximumAirmass: 2 } }))

		expect(plan.discarded).toEqual([{ id: 'polaris', name: 'Polaris', reason: 'airmassTooHigh' }])
	})

	test('finds a visibility band that opens and closes between two samples', () => {
		// Every grid sample stays under 89.8 degrees; only the culmination itself clears it.
		const plan = handler.planTargets(request([ZENITH], { constraints: { minimumAltitude: deg(89.8) } }))

		expect(plan.discarded).toBeEmpty()
		expect(plan.targets).toHaveLength(1)

		const [target] = plan.targets

		expect(target.visibilityStart).toBeGreaterThan(START + 16200000)
		expect(target.visibilityStart).toBeLessThanOrEqual(ZENITH_TRANSIT)
		expect(target.visibilityEnd).toBeGreaterThanOrEqual(ZENITH_TRANSIT)
		expect(target.visibilityEnd).toBeLessThan(START + 16500000)
	})

	test('refines the culmination instead of publishing the parabola that located it', () => {
		// Nothing constrains the target, so the peak is an interior culmination and both the reported instant and
		// altitude come from evaluated points. The best of them is the vertex of a parabola through grid samples,
		// which lands 19 s and 0.0203 degrees short of the real maximum at the default step.
		const plan = handler.planTargets(request([ZENITH]))

		const [target] = plan.targets

		expect(target.transit).toBeGreaterThan(ZENITH_TRANSIT - 100)
		expect(target.transit).toBeLessThan(ZENITH_TRANSIT + 100)
		expect(toDeg(target.maximumAltitude)).toBeCloseTo(89.87957, 4)
	})

	test('searches the first sampling interval for a culmination the grid cannot bracket', () => {
		// The window opens 51.4 s before the culmination, so the highest evaluated point is the boundary itself and
		// the altitude only falls from there. A ten-second scan puts the maximum at 89.97073 degrees, against the
		// 89.80091 degrees of the boundary.
		const plan = handler.planTargets(request([ZENITH_OPENING]))

		const [target] = plan.targets

		expect(target.transit).toBeGreaterThan(START + 51000)
		expect(target.transit).toBeLessThan(START + 52000)
		expect(toDeg(target.maximumAltitude)).toBeCloseTo(89.97073, 4)
	})

	test('searches the last sampling interval for a culmination the grid cannot bracket', () => {
		// The mirror case: the window closes 36.9 s after the culmination, which a ten-second scan puts at
		// 89.87736 degrees.
		const plan = handler.planTargets(request([ZENITH_CLOSING]))

		const [target] = plan.targets

		expect(target.transit).toBeGreaterThan(END - 37500)
		expect(target.transit).toBeLessThan(END - 36000)
		expect(toDeg(target.maximumAltitude)).toBeCloseTo(89.87736, 4)
	})

	test('places the culmination at the same instant whatever the sampling step', () => {
		// The culmination is 17.9 s past the window boundary, too close to it for any bracket built from evaluated
		// points: the boundary is the highest point the grid can offer at every step, and reporting it costs
		// 0.045 degrees. The instant comes from the hour angle instead, so the step no longer decides it.
		const coarse = handler.planTargets(request([ZENITH_GRAZING], { step: 3600 }))
		const fine = handler.planTargets(request([ZENITH_GRAZING], { step: 10 }))

		expect(coarse.targets[0].transit).toBe(fine.targets[0].transit)
		expect(coarse.targets[0].transit - START).toBeCloseTo(17916, -2)
		expect(toDeg(coarse.targets[0].maximumAltitude)).toBeCloseTo(89.97039, 4)
	}, 10000)

	test('takes the culmination that falls inside a window longer than half a sidereal day', () => {
		// The culmination nearest the first sample is the one before the window opens; the one the window contains
		// comes a sidereal day later. Testing only the nearest left the peak on the window end at 15.2809 degrees,
		// almost 75 degrees below the real one.
		const plan = handler.planTargets(request([LATE_CULMINATION], { end: START + 64800000 }))

		const [target] = plan.targets

		expect(target.transit - START).toBeGreaterThan(44944000)
		expect(target.transit - START).toBeLessThan(44946000)
		expect(toDeg(target.maximumAltitude)).toBeCloseTo(89.98739, 4)
	})

	test('splits a run at an excursion inside the first sampling interval', () => {
		// The culmination is 17.9 s past the window boundary, so it lives in the interval no three-point bracket
		// covers: the ceiling was reported as respected across the whole night and the published peak, 89.97039
		// degrees, stood above it. The turn is computed from the culmination now, so the interval it belongs to no
		// longer matters.
		const plan = handler.planTargets(request([ZENITH_GRAZING], { constraints: { maximumAltitude: deg(89.95) } }))

		expect(plan.targets).toHaveLength(1)

		const [target] = plan.targets

		expect(target.visibilityStart).toBeGreaterThan(START + 28000)
		expect(target.visibilityStart).toBeLessThan(START + 29500)
		expect(target.visibilityEnd).toBe(END)
		expect(toDeg(target.maximumAltitude)).toBeLessThanOrEqual(89.95)
	})

	test('splits a run at an excursion that happens between two samples', () => {
		// The culmination breaks the 89.8 degree ceiling while both neighbouring samples respect it, so the window
		// must end before it instead of being reported as continuously feasible across the whole night.
		const plan = handler.planTargets(request([ZENITH], { constraints: { maximumAltitude: deg(89.8) } }))

		expect(plan.targets).toHaveLength(1)

		const [target] = plan.targets

		expect(target.visibilityStart).toBe(START)
		expect(target.visibilityEnd).toBeGreaterThan(START + 16200000)
		expect(target.visibilityEnd).toBeLessThan(ZENITH_TRANSIT)
	})

	test('reports the peak at the refined boundary when a constraint ends the run', () => {
		// The target is still climbing when the 89.8 degree ceiling closes the window, so the highest altitude of
		// the interval is at its refined end and not at the last evaluated point, which only reaches 89.7768.
		const plan = handler.planTargets(request([ZENITH], { constraints: { maximumAltitude: deg(89.8) } }))

		const [target] = plan.targets

		expect(target.transit).toBe(target.visibilityEnd)
		expect(toDeg(target.maximumAltitude)).toBeCloseTo(89.7997, 3)
	})

	test('refines the lunar closest approach instead of trusting the parabola vertex', () => {
		// On a two-hour grid the vertex of the parabola through the samples around the approach lands 562 s away
		// from it, where the separation is still 0.103 degrees. Evaluating only that instant clears a 0.1 degree
		// limit and hides the crossing entirely; a one-minute scan puts the interval start at 9541.6 s.
		const plan = handler.planTargets(request([MOON_CROSSING], { step: 7200, constraints: { minimumMoonDistance: deg(0.1) } }))

		expect(plan.targets).toHaveLength(1)

		const [target] = plan.targets

		expect(target.visibilityStart).toBeGreaterThan(START + 9500000)
		expect(target.visibilityStart).toBeLessThan(START + 9600000)
		expect(target.visibilityEnd).toBe(END)
	})

	test('refines the lunar closest approach until the bracket is narrower than a second', () => {
		// A tighter limit on the same two-hour grid needs the approach itself and not a neighbourhood of it: a fixed
		// count of parabolic steps stopped short of it and the separation evaluated there cleared 0.01 degrees, so
		// the whole window read as continuously visible. The refinement runs to a bracket under a second now, and
		// the crossing lands within the sampling resolution of the 9054.4 s a one-minute scan reports.
		const plan = handler.planTargets(request([MOON_CROSSING], { step: 7200, constraints: { minimumMoonDistance: deg(0.01) } }))

		expect(plan.targets).toHaveLength(1)

		const [target] = plan.targets

		expect(target.visibilityStart).toBeGreaterThan(START + 9050000)
		expect(target.visibilityStart).toBeLessThan(START + 9070000)
		expect(target.visibilityEnd).toBe(END)
	})

	test('finds a lunar approach that falls between the window start and the first sample', () => {
		// The window opens 8700 s later, which puts the crossing inside the first two-hour sampling interval. A turn
		// read from the samples on both sides of it cannot be found there, so the whole window read as visible; a
		// ten-second scan starts it 408.6 s in.
		const plan = handler.planTargets(request([MOON_CROSSING], { start: START + 8700000, step: 7200, constraints: { minimumMoonDistance: deg(0.02) } }))

		expect(plan.targets).toHaveLength(1)

		const [target] = plan.targets

		expect(target.visibilityStart).toBeGreaterThan(START + 9108000)
		expect(target.visibilityStart).toBeLessThan(START + 9110000)
		expect(target.visibilityEnd).toBe(END)
	})

	test('finds a lunar approach inside the narrowest cell of the boundary ladder', () => {
		// The window opens 8950 s in, which puts the crossing 77 s past the boundary, inside the last cell the ladder
		// leaves undivided. No sample of that cell can be the lowest of three, so the approach was invisible however
		// narrow the cell is and the whole window read as visible; a one-second scan starts it 77.173 s in.
		const plan = handler.planTargets(request([MOON_CROSSING], { start: START + 8950000, step: 7200, constraints: { minimumMoonDistance: deg(0.005) } }))

		expect(plan.targets).toHaveLength(1)

		const [target] = plan.targets

		expect(target.visibilityStart - START - 8950000).toBeGreaterThan(77000)
		expect(target.visibilityStart - START - 8950000).toBeLessThan(78000)
		expect(target.visibilityEnd).toBe(END)
	})

	test('finds a lunar approach inside the narrowest cell at the closing boundary', () => {
		// The mirror case: the window closes 100 s after the crossing, which lands inside the last cell of the
		// trailing ladder. A one-second scan ends the run 7122.816 s in, 77.2 s before the window closes.
		const end = START + 9050000
		const plan = handler.planTargets(request([MOON_CROSSING], { start: end - 7200000, end, step: 7200, constraints: { minimumMoonDistance: deg(0.005) } }))

		expect(plan.targets).toHaveLength(1)

		const [target] = plan.targets

		expect(target.visibilityStart).toBe(end - 7200000)
		expect(target.visibilityEnd - (end - 7200000)).toBeGreaterThan(7122000)
		expect(target.visibilityEnd - (end - 7200000)).toBeLessThan(7123000)
	})

	test('subdivides a sampling step that spans more than one solar cycle', () => {
		// A seven-day window sampled once a day leaves whole daylight periods between two samples, so the turn read
		// from three of them stands for many and the darkness constraint was bridged: the scan reported one dark
		// interval of 131.203 h. A five-minute scan of the same window finds the longest one lasting 11.271 h and
		// starting 21.581 h in, which the subdivided grid reaches within its own resolution.
		const plan = handler.planTargets(request([M42], { end: START + 604800000, step: 86400, constraints: { maximumSunAltitude: deg(-12) } }))

		expect(plan.step).toBe(10800)
		expect(plan.targets).toHaveLength(1)

		const [target] = plan.targets

		expect((target.visibilityEnd - target.visibilityStart) / 3600000).toBeCloseTo(11.262, 2)
		expect((target.visibilityStart - START) / 3600000).toBeCloseTo(21.586, 2)
	})

	test('splits a run at the maximum of the lunar illumination', () => {
		// A 10.5 h window on 2025-08-09 whose sampling interval of 3.5 h steps over the full Moon: the illuminated
		// fraction peaks at 0.9994380 around 08:26 UTC and stays over 0.99942 for about 1.7 h, but every grid sample
		// sits under the limit, so the whole window read as visible. A five-minute scan puts the start of the longest
		// run at 20496.1 s, which the coarse grid reaches within its own edge resolution of 49 s.
		const start = Date.UTC(2025, 7, 9, 3, 40)
		const plan = handler.planTargets(request([M42], { start, end: start + 37800000, step: 12600, constraints: { maximumMoonIllumination: 0.99942 } }))

		expect(plan.targets).toHaveLength(1)

		const [target] = plan.targets

		expect(target.visibilityStart - start).toBeGreaterThan(20470000)
		expect(target.visibilityStart - start).toBeLessThan(20560000)
		expect(target.visibilityEnd - start).toBe(37800000)
	})

	test('keeps the run that lasts longest, not the one holding the most evaluated points', () => {
		// The ceiling splits the night into a wing of 16015.7 s before the culmination and one of 16300.0 s after it.
		// The shorter wing carries an extra evaluated point at a turning instant, so counting flags returns it.
		const plan = handler.planTargets(request([ZENITH_EARLY], { constraints: { maximumAltitude: deg(89.8) } }))

		expect(plan.targets).toHaveLength(1)

		const [target] = plan.targets

		expect(target.visibilityStart).toBeGreaterThan(START + 16015700)
		expect(target.visibilityStart).toBeLessThan(START + 16150000)
		expect(target.visibilityEnd).toBe(END)
	})

	test('splits a run at a lunar closest approach that happens between two samples', () => {
		// MOON_CROSSING sits exactly where the Moon passes 9000 s into the window. On an hourly grid the samples
		// bracketing that instant are still 0.3267 and 0.3353 degrees away from it, so a 0.2 degree limit is
		// violated only between them, over the 2180 s the separation stays under it.
		const plan = handler.planTargets(request([MOON_CROSSING], { step: 3600, constraints: { minimumMoonDistance: deg(0.2) } }))

		expect(plan.targets).toHaveLength(1)

		const [target] = plan.targets

		expect(target.visibilityStart).toBeGreaterThan(START + 10000000)
		expect(target.visibilityStart).toBeLessThan(START + 10200000)
		expect(target.visibilityEnd).toBe(END)
	})

	test('measures each run to its refined boundaries before choosing between them', () => {
		// Both wings reach past the evaluated points that produced them, and by different amounts: the wing before
		// the culmination lasts 16135.5 s and the one after it 16180.9 s, which 30 s and 10 s scans agree on, while
		// their innermost evaluated points put the first one ahead.
		const plan = handler.planTargets(request([ZENITH_BALANCED], { constraints: { maximumAltitude: deg(89.8) } }))

		expect(plan.targets).toHaveLength(1)

		const [target] = plan.targets

		expect(target.visibilityStart).toBeGreaterThan(START + 16200000)
		expect(target.visibilityEnd).toBe(END)
		expect(target.visibilityEnd - target.visibilityStart).toBeGreaterThan(16150000)
	})

	test('keeps the longest continuous run when a constraint splits the window', () => {
		// A maximum altitude below the target's peak carves the visible run into the two wings around transit.
		const plan = handler.planTargets(request([M42], { constraints: { minimumAltitude: deg(10), maximumAltitude: deg(20) } }))

		expect(plan.targets).toHaveLength(1)
		expect(toDeg(plan.targets[0].maximumAltitude)).toBeLessThanOrEqual(20)
		expect(toDeg(plan.targets[0].maximumAltitude)).toBeGreaterThan(10)
	})
})

describe('sky constraints', () => {
	test('discards every target while the Sun is up', () => {
		// 2025-07-27 09:00 to 15:00, UTC-3, which is the middle of the day at this site.
		const plan = handler.planTargets(request([OMEGA_CENTAURI, M42], { start: 1753617600000, end: 1753639200000, constraints: { maximumSunAltitude: deg(-12) } }))

		expect(plan.targets).toBeEmpty()
		expect(plan.discarded).toEqual([
			{ id: 'omegaCen', name: 'Omega Centauri', reason: 'sunTooHigh' },
			{ id: 'm42', name: 'M42', reason: 'sunTooHigh' },
		])
	})

	test('reports the lunar illumination the plan was computed under', () => {
		const plan = handler.planTargets(request([OMEGA_CENTAURI]))

		expect(plan.moonIllumination).toBeCloseTo(0.113792, 3)
	})

	test('discards every target when the Moon is brighter than the limit', () => {
		const plan = handler.planTargets(request([OMEGA_CENTAURI], { constraints: { maximumMoonIllumination: 0.05 } }))

		expect(plan.discarded).toEqual([{ id: 'omegaCen', name: 'Omega Centauri', reason: 'moonTooBright' }])
	})

	test('discards only the target too close to the Moon', () => {
		// Topocentric separations at the window start are 63.5 degrees for Omega Centauri and 81.7 for M42.
		const plan = handler.planTargets(request([OMEGA_CENTAURI, M42], { constraints: { minimumAltitude: deg(30), minimumMoonDistance: deg(70) } }))

		expect(plan.discarded).toEqual([{ id: 'omegaCen', name: 'Omega Centauri', reason: 'moonTooClose' }])
		expect(plan.targets).toHaveLength(1)
		expect(plan.targets[0].id).toBe('m42')
	})

	test('applies candidate constraints over the request-level ones', () => {
		const plan = handler.planTargets(request([{ ...OMEGA_CENTAURI, constraints: { minimumAltitude: deg(45) } }, M42], { constraints: { minimumAltitude: deg(30) } }))

		expect(plan.discarded).toEqual([{ id: 'omegaCen', name: 'Omega Centauri', reason: 'belowMinimumAltitude' }])
		expect(plan.targets[0].constraints).toEqual({ minimumAltitude: deg(30) })
	})
})

describe('ordering', () => {
	test('observes the target that sets first', () => {
		const plan = handler.planTargets(request([M42, OMEGA_CENTAURI], { constraints: { minimumAltitude: deg(30) } }))

		expect(plan.targets.map((target) => target.id)).toEqual(['omegaCen', 'm42'])
		expect(plan.targets.map((target) => target.order)).toEqual([0, 1])
	})

	test('allocates a slot inside the window of each target and never overlaps them', () => {
		const plan = handler.planTargets(
			request(
				[
					{ ...M42, duration: 1200 },
					{ ...OMEGA_CENTAURI, duration: 1800 },
				],
				{ constraints: { minimumAltitude: deg(30) } },
			),
		)

		expect(plan.targets).toHaveLength(2)

		for (const target of plan.targets) {
			expect(target.slotStart).toBeGreaterThanOrEqual(target.visibilityStart)
			expect(target.slotEnd).toBeLessThanOrEqual(target.visibilityEnd)
		}

		expect(plan.targets[1].slotStart).toBeGreaterThanOrEqual(plan.targets[0].slotEnd)
	})

	test('discards the target left without room in its own window', () => {
		// Two copies of the same object share one window of about 3225 s, so the second 2000 s slot does not fit.
		const first: TargetPlanCandidate = { ...OMEGA_CENTAURI, id: 'first', duration: 2000 }
		const second: TargetPlanCandidate = { ...OMEGA_CENTAURI, id: 'second', duration: 2000 }
		const plan = handler.planTargets(request([first, second], { constraints: { minimumAltitude: deg(30) } }))

		expect(plan.targets).toHaveLength(1)
		expect(plan.targets[0].id).toBe('first')
		expect(plan.targets[0].slotStart).toBe(START)
		expect(plan.targets[0].slotEnd).toBe(START + 2000000)
		expect(plan.discarded).toEqual([{ id: 'second', name: 'Omega Centauri', reason: 'noRemainingTime' }])
	})

	test('waits for a tighter window instead of losing it to a longer target', () => {
		// The altitude band opens 379.7 s into the window and closes 1091.0 s into it, so a 3600 s slot started
		// at the anchor would leave the band with no room, while observing the band first still fits both.
		const band: TargetPlanCandidate = { ...OMEGA_CENTAURI, duration: 600, constraints: { minimumAltitude: deg(36), maximumAltitude: deg(38) } }
		const plan = handler.planTargets(request([{ ...M42, duration: 3600 }, band]))

		expect(plan.discarded).toBeEmpty()
		expect(plan.targets.map((target) => target.id)).toEqual(['omegaCen', 'm42'])
		expect(plan.targets[0].slotStart).toBe(plan.targets[0].visibilityStart)
		expect(plan.targets[1].slotStart).toBeGreaterThanOrEqual(plan.targets[0].slotEnd)
	})

	test('places a zero-duration target at the very end of a fully occupied window', () => {
		// The first target consumes the whole window, leaving the cursor exactly at the end of the second one's.
		const filler: TargetPlanCandidate = { ...OMEGA_CENTAURI, id: 'filler', duration: (END - START) / 1000 }
		const plan = handler.planTargets(request([filler, { ...M42, id: 'ordering' }]))

		expect(plan.discarded).toBeEmpty()
		expect(plan.targets.map((target) => target.id)).toEqual(['filler', 'ordering'])
		expect(plan.targets[1].slotStart).toBe(END)
		expect(plan.targets[1].slotEnd).toBe(END)
	})

	test('waits for the next target to rise instead of idling', () => {
		const plan = handler.planTargets(request([{ ...M42, duration: 1200 }], { constraints: { minimumAltitude: deg(30) } }))

		const [target] = plan.targets

		expect(target.slotStart).toBe(target.visibilityStart)
		expect(target.slotEnd).toBe(target.visibilityStart + 1200000)
	})

	test('discards a target whose window is shorter than its own duration', () => {
		const plan = handler.planTargets(request([{ ...OMEGA_CENTAURI, duration: 7200 }], { constraints: { minimumAltitude: deg(30) } }))

		expect(plan.targets).toBeEmpty()
		expect(plan.discarded).toEqual([{ id: 'omegaCen', name: 'Omega Centauri', reason: 'visibilityTooShort' }])
	})

	test('discards a target whose window is shorter than the requested minimum', () => {
		const plan = handler.planTargets(request([OMEGA_CENTAURI], { constraints: { minimumAltitude: deg(30) }, minimumDuration: 7200 }))

		expect(plan.discarded).toEqual([{ id: 'omegaCen', name: 'Omega Centauri', reason: 'visibilityTooShort' }])
	})
})

describe('window', () => {
	test('discards everything when the window does not move forward', () => {
		const plan = handler.planTargets(request([OMEGA_CENTAURI], { end: START }))

		expect(plan.step).toBe(0)
		expect(plan.targets).toBeEmpty()
		expect(plan.discarded).toEqual([{ id: 'omegaCen', name: 'Omega Centauri', reason: 'visibilityTooShort' }])
		expect(plan.moonIllumination).toBeCloseTo(0.113792, 3)
	})

	test('raises the step until the sample count fits the budget', () => {
		const plan = handler.planTargets(request([OMEGA_CENTAURI], { step: 1, constraints: { minimumAltitude: deg(30) } }))

		// 32400 s at 1 s would need 32401 samples, far past the 4096 the planner is willing to compute.
		expect(plan.step).toBeCloseTo(32400 / 4095, 6)
		expect(plan.targets).toHaveLength(1)
	}, 30000)

	test('produces the same plan twice for the same request', () => {
		const req = request([M42, OMEGA_CENTAURI, M13, POLARIS], { constraints: { minimumAltitude: deg(25) } })

		expect(handler.planTargets(req)).toEqual(handler.planTargets(req))
	})
})
