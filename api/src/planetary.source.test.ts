import { describe, expect, test } from 'bun:test'
import type { SpkKernelSet } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import { SatelliteEphemerisMiss } from 'nebulosa/src/astronomy/ephemeris/satellites'
import type { Time } from 'nebulosa/src/astronomy/time/time'
import { kernelReadiness, type PlanetaryFallbackReason, type PlanetaryKernels, type PlanetarySourceMiss, PlanetarySourceUnavailableError, type SatelliteSourceConfig, toolkitTime, withSatelliteSource } from './planetary.source'
import { intersect, overlapsOf, rank, subtract } from './planetary.visibility'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'
import type { SpiceEphemerisPolicy } from './spicekernels.store'

type Body = 'sun' | 'moon'

interface FakeEphemeris {
	readonly source: string
	readonly position: (body: Body, time: Time) => number
}

class FakeMiss extends SatelliteEphemerisMiss<Body> {}

class FakeUnavailable extends PlanetarySourceUnavailableError<Body> {
	constructor(reason: PlanetaryFallbackReason | 'generationChanged', miss?: PlanetarySourceMiss<Body>) {
		super(`unavailable ${reason}`, reason, miss)
	}
}

const NAIF = { sun: 10, moon: 301 } as const

// A system whose kernel ephemeris misses the moon after `moonUntil` (Unix milliseconds).
function config(moonUntil = Infinity): SatelliteSourceConfig<Body, FakeEphemeris, { readonly kind: 'analytical'; readonly theory: 'fake' }> {
	return {
		naif: NAIF,
		analytical: { source: 'analytical', position: () => 0 },
		analyticalSource: { kind: 'analytical', theory: 'fake' },
		spk: () => ({
			source: 'spk',
			kernelsByBody: new Map([['sun', new Set(['a'])]]),
			position: (body, time) => {
				if (body === 'moon' && toUnix(time) > moonUntil) throw new FakeMiss('moon', 301, 'coverage', time)
				return 1
			},
		}),
		miss: FakeMiss,
		unavailable: (reason, miss) => new FakeUnavailable(reason, miss),
	}
}

function toUnix(time: Time) {
	return (time.day - 2440587.5 + time.fraction) * 86_400_000
}

// A snapshot whose set has segments for `bodies`; evaluation is up to the fake ephemeris.
function snapshot(policy: SpiceEphemerisPolicy, bodies: readonly number[], generation = 1): SpiceKernelSnapshot {
	const set = { kernels: ['a'], bodies: new Set(bodies), stateAt: () => ({ ok: false, reason: 'missing', body: 0 }) } as unknown as SpkKernelSet
	return { generation, policy, loading: false, set, readiness: new Map() }
}

function kernels(...snapshots: SpiceKernelSnapshot[]): PlanetaryKernels {
	let i = 0
	return { current: () => snapshots[Math.min(i++, snapshots.length - 1)] }
}

describe('withSatelliteSource', () => {
	test('uses the kernels when they have every required body', async () => {
		const result = await withSatelliteSource(kernels(snapshot('automatic', [10, 301])), config(), ['sun', 'moon'], 3, (e) => e.source)
		expect(result.results).toEqual(['spk', 'spk', 'spk'])
		expect(result.source).toEqual({ kind: 'spk', kernels: { sun: ['a'] } })
	})

	test('needs only the bodies of the computation', async () => {
		const result = await withSatelliteSource(kernels(snapshot('spkOnly', [10])), config(), ['sun'], 1, (e) => e.source)
		expect(result.source.kind).toBe('spk')
		await expect(withSatelliteSource(kernels(snapshot('spkOnly', [10])), config(), ['sun', 'moon'], 1, (e) => e.source)).rejects.toMatchObject({ reason: 'targetMissing', miss: { target: 'moon', body: 301 } })
	})

	test('reruns every chunk from the theories after a miss, or refuses under spkOnly', async () => {
		const at = Date.UTC(2026, 0, 1)
		const chunk = (e: FakeEphemeris, i: number) => {
			e.position('moon', toolkitTime(at + i * 86_400_000))
			return e.source
		}
		const result = await withSatelliteSource(kernels(snapshot('automatic', [10, 301])), config(at + 1000), ['sun', 'moon'], 3, chunk)
		expect(result.results).toEqual(['analytical', 'analytical', 'analytical'])
		expect(result.source).toMatchObject({ kind: 'analytical', theory: 'fake', fallbackReason: 'outOfCoverage', miss: { target: 'moon', body: 301 } })

		const refused = withSatelliteSource(kernels(snapshot('spkOnly', [10, 301])), config(at + 1000), ['sun', 'moon'], 3, chunk)
		await expect(refused).rejects.toBeInstanceOf(FakeUnavailable)
		await expect(refused).rejects.toMatchObject({ reason: 'outOfCoverage' })
	})

	test('restarts on a generation change and gives up after two restarts', async () => {
		const restarted = await withSatelliteSource(kernels(snapshot('automatic', [10], 1), snapshot('automatic', [10], 2)), config(), ['sun'], 2, (e) => e.source)
		expect(restarted.snapshot.generation).toBe(2)

		let generation = 0
		const changing: PlanetaryKernels = { current: () => snapshot('automatic', [10], generation++) }
		await expect(withSatelliteSource(changing, config(), ['sun'], 2, (e) => e.source)).rejects.toMatchObject({ reason: 'generationChanged' })
	})

	test('stops between chunks when aborted', async () => {
		const controller = new AbortController()
		const run = withSatelliteSource(
			kernels(snapshot('automatic', [10])),
			config(),
			['sun'],
			3,
			(e, i) => {
				if (i === 0) controller.abort()
				return e.source
			},
			undefined,
			controller.signal,
		)
		await expect(run).rejects.toThrow()
	})
})

describe('kernelReadiness', () => {
	test('bounds the probes of a long range', () => {
		const start = Date.UTC(2000, 0, 1)
		const report = kernelReadiness(config(), ['sun'], snapshot('automatic', [10]), start, Date.UTC(2050, 0, 1))
		expect(report.readiness).toBe('ready')
		expect(report.probes).toBeLessThanOrEqual(2000)
		expect(kernelReadiness(config(), ['sun'], snapshot('automatic', [10]), start, start + 86_400_000).probes).toBe(5)
	})

	test('reports partial coverage with the failing state', () => {
		const start = Date.UTC(2026, 0, 1)
		const report = kernelReadiness(config(start + 3_600_000), ['sun', 'moon'], snapshot('offline', [10, 301]), start, start + 86_400_000)
		expect(report).toMatchObject({ readiness: 'partialCoverage', source: 'analytical', reason: 'outOfCoverage', probes: 2, miss: { target: 'moon', body: 301, time: start + 6 * 3_600_000 } })
	})
})

describe('visibility spans', () => {
	test('intersect and subtract sorted spans', () => {
		expect(
			intersect(
				[{ start: 0, end: 10 }],
				[
					{ start: 5, end: 7 },
					{ start: 8, end: 20 },
				],
			),
		).toEqual([
			{ start: 5, end: 7 },
			{ start: 8, end: 10 },
		])
		expect(
			subtract(
				[{ start: 0, end: 10 }],
				[
					{ start: 2, end: 3 },
					{ start: 9, end: 12 },
				],
			),
		).toEqual([
			{ start: 0, end: 2 },
			{ start: 3, end: 9 },
		])
	})

	test('links overlapping events and ranks the watchable ones', () => {
		const events: { id: string; start: number; maximum: number; end: number; visibility: { longestMs: number; peakAltitude?: number; rank?: number } }[] = [
			{ id: 'a', start: 0, maximum: 5, end: 10, visibility: { longestMs: 4, peakAltitude: 1 } },
			{ id: 'b', start: 8, maximum: 9, end: 12, visibility: { longestMs: 4, peakAltitude: 2 } },
			{ id: 'c', start: 20, maximum: 20, end: 20, visibility: { longestMs: 0 } },
		]
		expect(overlapsOf(events)).toEqual([['b'], ['a'], []])
		rank(events)
		expect(events.map((e) => e.visibility.rank)).toEqual([2, 1, undefined])
	})
})
