import { expect, test } from 'bun:test'
import type { SpiceKernelSummary } from 'api'
import { ephemerisCoverage } from './ephemeris'

const PLANETS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 199, 299, 301, 399]

function kernel(id: string, targets: readonly number[], start: number, end: number, readiness: SpiceKernelSummary['readiness'] = 'ready'): SpiceKernelSummary {
	return { id, sha256: id, name: id, sourceKind: 'naif', bytes: 0, createdAt: 0, enabled: readiness !== 'disabled', priority: 0, state: 'ready', readiness, targets, segmentCount: targets.length, unsupportedSegments: 0, start, end }
}

test('the major bodies are covered until the earliest of their latest ends', () => {
	const coverage = ephemerisCoverage([kernel('de', PLANETS, -100, 1000), kernel('long', [10, 399, 301, 3], -100, 5000)], 0)
	expect(coverage.majorBodiesUntil).toBe(1000)
})

test('a major body missing at the instant leaves them not covered', () => {
	expect(ephemerisCoverage([kernel('de', PLANETS, 10, 1000)], 0).majorBodiesUntil).toBeUndefined()
	expect(ephemerisCoverage([kernel('inner', [10, 301, 399, 1, 2, 3, 4], -100, 1000)], 0).majorBodiesUntil).toBeUndefined()
	expect(ephemerisCoverage([], 0).majorBodiesUntil).toBeUndefined()
})

test('moons and small bodies are counted once, from ready kernels covering the instant', () => {
	const coverage = ephemerisCoverage([kernel('jup', [501, 502, 599, 5], -100, 100), kernel('sat', [601, 699, 6, 501], -100, 100), kernel('old', [503], -300, -200), kernel('eros', [2000433, 10], -100, 100), kernel('bad', [1000012], -100, 100, 'missingDependency')], 0)
	expect(coverage.moons).toBe(3)
	expect(coverage.smallBodies).toBe(1)
})

test('enabled kernels that are not ready are listed in the order of the library', () => {
	const coverage = ephemerisCoverage([kernel('a', [10], 0, 1, 'invalid'), kernel('b', [10], 0, 1, 'disabled'), kernel('c', [10], 0, 1), kernel('d', [10], 0, 1, 'missing')], 0)
	expect(coverage.enabled).toBe(3)
	expect(coverage.notReady.map((e) => e.id)).toEqual(['a', 'd'])
})
