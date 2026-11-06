import { describe, expect, test } from 'bun:test'
import type { GuidingTelemetrySample } from 'api'
import { guidingTargetRing, guidingTargetRms, guidingTargetSamples } from './GuidingTargetGraph'

function sample(cursor: number, patch: Partial<GuidingTelemetrySample> = {}): GuidingTelemetrySample {
	const axis = { duration: 0, limited: false }
	return { cursor, frameId: cursor, timestamp: cursor, lost: false, calibrationGeneration: 1, phase: 'guiding', dx: 0, dy: 0, raDistance: 1, decDistance: -1, ra: axis, dec: axis, snr: 10, mass: 100, hfd: 2, ...patch }
}

describe('target graph', () => {
	test('draws the latest measured steps of the newest calibration after the cleared cursor', () => {
		const telemetry = [sample(1, { calibrationGeneration: 0 }), sample(2), sample(3, { lost: true }), sample(4), sample(5), sample(6), sample(7)]
		expect(guidingTargetSamples(telemetry, 0, 10).map(({ cursor }) => cursor)).toEqual([2, 4, 5, 6, 7])
		expect(guidingTargetSamples(telemetry, 0, 3).map(({ cursor }) => cursor)).toEqual([5, 6, 7])
		expect(guidingTargetSamples(telemetry, 5, 10).map(({ cursor }) => cursor)).toEqual([6, 7])
		expect(guidingTargetSamples(telemetry, 7, 10)).toEqual([])
	})

	test('counts only the guiding steps in the RMS, in the unit of the scale', () => {
		const samples = [sample(1, { raDistance: 3, decDistance: 4 }), sample(2, { raDistance: -3, decDistance: 0 }), sample(3, { raDistance: 100, decDistance: 100, phase: 'dithering' }), sample(4, { raDistance: 50, phase: 'settling' })]
		const rms = guidingTargetRms(samples, 2)!
		expect(rms.count).toBe(2)
		expect(rms.ra).toBeCloseTo(6, 12)
		expect(rms.dec).toBeCloseTo(Math.sqrt(32), 12)
		expect(rms.total).toBeCloseTo(Math.hypot(6, Math.sqrt(32)), 12)
		expect(guidingTargetRms([sample(1, { phase: 'settling' })], 1)).toBeUndefined()
	})

	test('rings hold the largest error in four of them', () => {
		expect(guidingTargetRing(0)).toBe(0.05)
		expect(guidingTargetRing(0.9)).toBe(0.25)
		expect(guidingTargetRing(3.5)).toBe(1)
		expect(guidingTargetRing(1000)).toBe(100)
	})
})
