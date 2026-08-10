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
	}, 7000)

	test('produces the same plan twice for the same request', () => {
		const req = request([M42, OMEGA_CENTAURI, M13, POLARIS], { constraints: { minimumAltitude: deg(25) } })

		expect(handler.planTargets(req)).toEqual(handler.planTargets(req))
	})
})
