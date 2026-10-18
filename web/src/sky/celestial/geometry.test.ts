import { describe, expect, test } from 'bun:test'
import { projectViewVector, unprojectViewVector } from './geometry'
import type { ProjectionType } from './types'

const PROJECTIONS: readonly ProjectionType[] = ['azimuthalEquidistant', 'azimuthalEqualArea', 'orthographic', 'stereographic', 'gnomonic']

describe('projection', () => {
	test.each(PROJECTIONS)('%s round-trips a visible view vector', (type) => {
		const vector = [0.3, -0.2, Math.sqrt(1 - 0.13)]
		const plane = new Float64Array(2)
		const back = new Float64Array(3)

		expect(projectViewVector(type, vector[0], vector[1], vector[2], plane)).toBeTrue()
		expect(unprojectViewVector(type, plane[0], plane[1], back)).toBeTrue()
		expect(back[0]).toBeCloseTo(vector[0], 9)
		expect(back[1]).toBeCloseTo(vector[1], 9)
		expect(back[2]).toBeCloseTo(vector[2], 9)
	})

	test('finite disk projections reach radius 1 at 90° from the center', () => {
		const plane = new Float64Array(2)

		for (const type of PROJECTIONS) {
			if (type === 'gnomonic') continue
			expect(projectViewVector(type, 1, 0, 0, plane)).toBeTrue()
			expect(plane[0]).toBeCloseTo(1, 9)
		}
	})

	test('rejects vectors behind the view', () => {
		const plane = new Float64Array(2)

		for (const type of PROJECTIONS) {
			expect(projectViewVector(type, 0, 0.6, -0.8, plane)).toBeFalse()
		}
	})
})
