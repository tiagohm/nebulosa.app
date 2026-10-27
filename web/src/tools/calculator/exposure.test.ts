import { describe, expect, test } from 'bun:test'
import { stackingMagnitudeGain, starTrailLength } from 'nebulosa/src/astronomy/formulas'
import { deg } from 'nebulosa/src/math/units/angle'
import { EXPOSURE_PLAN_EXAMPLE, exposurePlan, STAR_TRAIL_EXAMPLE, starTrail } from './exposure'

describe('exposure planner', () => {
	test('from a frame count', () => {
		expect(exposurePlan(EXPOSURE_PLAN_EXAMPLE)).toEqual({ status: 'ready', value: { frames: 120, total: 36000, snrGain: Math.sqrt(120), magnitudeGain: stackingMagnitudeGain(120) } })
	})

	test('a frame count must be a whole number greater than zero', () => {
		for (const frameCount of ['2.5', '-3', '0']) expect(exposurePlan({ ...EXPOSURE_PLAN_EXAMPLE, frameCount }).status).toBe('invalid')
	})

	test('a target time is covered by whole subframes', () => {
		const result = exposurePlan({ ...EXPOSURE_PLAN_EXAMPLE, mode: 'time', subExposure: '180', targetHours: '1.1', frameCount: '' })
		expect(result.status === 'ready' && result.value).toMatchObject({ frames: 22, total: 3960 })
	})
})

describe('star trailing', () => {
	test('gives the trail and the longest exposure within the budget', () => {
		const result = starTrail(STAR_TRAIL_EXAMPLE)
		expect(result.status).toBe('ready')
		if (result.status !== 'ready') return
		expect(result.value.trail).toBeCloseTo(starTrailLength(deg(30), 30, 1.29), 12)
		expect(result.value.maxExposure?.status).toBe('ready')
		expect(result.value.maxExposure?.status === 'ready' && result.value.maxExposure.value).toBeCloseTo((1 * 1.29) / (15.041 * Math.cos(deg(30))), 2)
	})

	test('a budget of zero allows no exposure', () => {
		const result = starTrail({ ...STAR_TRAIL_EXAMPLE, trailLimit: '0' })
		expect(result.status === 'ready' && result.value.maxExposure).toEqual({ status: 'ready', value: 0 })
	})

	test('at a celestial pole no exposure limit is given', () => {
		const result = starTrail({ ...STAR_TRAIL_EXAMPLE, declination: '-90' })
		expect(result.status === 'ready' && result.value.maxExposure?.status).toBe('unbounded')
	})

	test('needs the exposure or the budget, and a declination within ±90°', () => {
		expect(starTrail({ ...STAR_TRAIL_EXAMPLE, exposure: '', trailLimit: '' })).toEqual({ status: 'incomplete', missing: ['Exposure or Trail budget'] })
		expect(starTrail({ ...STAR_TRAIL_EXAMPLE, declination: '91' })).toEqual({ status: 'invalid', reason: 'Declination must be at least -90 and at most 90.' })
		const trailOnly = starTrail({ ...STAR_TRAIL_EXAMPLE, trailLimit: '' })
		expect(trailOnly.status === 'ready' && trailOnly.value.maxExposure).toBeUndefined()
	})
})
