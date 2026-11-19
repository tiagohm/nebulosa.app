import { expect, test } from 'bun:test'
import type { SpkKernelSet } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import { computeEphemeris, computeEphemerisSync, EphemerisKernelMiss, type EphemerisKernels, type EphemerisMode, type EphemerisSources, EphemerisUnavailableError, HorizonsCircuitBreaker } from './ephemeris.chain'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'

// A snapshot whose set has segments for bodies, online unless offline.
function snapshot(bodies: readonly number[] | undefined, offline = false, generation = 1): SpiceKernelSnapshot {
	const set = bodies && ({ kernels: ['k'], bodies: new Set(bodies) } as unknown as SpkKernelSet)
	return { generation, offline, loading: false, ...(set && { set }), readiness: new Map() }
}

function kernels(value: SpiceKernelSnapshot): EphemerisKernels {
	return { current: () => value }
}

// Sources that answer their own name; the theories and Horizons can be replaced or left out.
function sources(options: { horizons?: () => Promise<string>; analytical?: boolean } = {}): EphemerisSources<string> {
	return {
		bodies: [{ name: 'mars', naif: 499 }],
		spk: () => 'spk',
		...(options.analytical !== false && { analytical: () => 'analytical' }),
		horizons: options.horizons ?? (() => Promise.resolve('horizons')),
	}
}

async function sourceOf(mode: EphemerisMode, value: SpiceKernelSnapshot, offered = sources(), missAt?: number) {
	const { results, provenance } = await computeEphemeris({
		kernels: kernels(value),
		mode,
		sources: offered,
		chunks: 2,
		compute: (ephemeris, index) => {
			if (ephemeris === 'spk' && index === missAt) throw new EphemerisKernelMiss(499, 499, 'coverage')
			return ephemeris
		},
	})

	return { results, provenance }
}

test('fast asks the theories before Horizons, accurate Horizons before the theories, both after the kernels', async () => {
	expect((await sourceOf('fast', snapshot([499]))).provenance).toEqual({ source: 'spk', mode: 'fast', attempts: [], kernels: { generation: 1, kernelIds: [] } })
	expect((await sourceOf('fast', snapshot(undefined))).provenance).toEqual({ source: 'analytical', mode: 'fast', attempts: [{ source: 'spk', reason: 'noKernel' }] })
	expect((await sourceOf('accurate', snapshot([10]))).provenance).toEqual({ source: 'horizons', mode: 'accurate', attempts: [{ source: 'spk', reason: 'targetMissing', target: 'mars', body: 499 }] })
	expect((await sourceOf('fast', snapshot(undefined), sources({ analytical: false }))).provenance.source).toBe('horizons')
})

test('a kernel miss in any chunk reruns every chunk on the next source', async () => {
	const { results, provenance } = await sourceOf('accurate', snapshot([499]), sources(), 1)
	expect(results).toEqual(['horizons', 'horizons'])
	expect(provenance.attempts).toEqual([{ source: 'spk', reason: 'outOfCoverage', body: 499 }])
})

test('offline never asks Horizons, and fails what only Horizons could give', async () => {
	let asked = 0
	const horizons = () => {
		asked++
		return Promise.resolve('horizons')
	}

	expect((await sourceOf('accurate', snapshot(undefined, true), sources({ horizons }))).provenance).toMatchObject({ source: 'analytical', attempts: [{ reason: 'noKernel' }, { source: 'horizons', reason: 'offline' }] })
	const failed = sourceOf('fast', snapshot(undefined, true), sources({ horizons, analytical: false }))
	await expect(failed).rejects.toBeInstanceOf(EphemerisUnavailableError)
	await expect(failed).rejects.toMatchObject({ code: 'offline' })
	expect(asked).toBe(0)
})

test('transient Horizons failures go on to the theories and open the breaker; semantic ones are rethrown', async () => {
	const breaker = new HorizonsCircuitBreaker(() => 0, 2, 1000)
	const network = () => Promise.reject(new TypeError('fetch failed'))
	const run = (horizons: () => Promise<string>) => computeEphemeris({ kernels: kernels(snapshot(undefined)), mode: 'accurate', sources: sources({ horizons }), breaker, compute: (e) => e })

	for (let i = 0; i < 2; i++) expect((await run(network)).provenance.attempts.at(-1)).toEqual({ source: 'horizons', reason: 'network' })
	expect((await run(network)).provenance.attempts.at(-1)).toEqual({ source: 'horizons', reason: 'breakerOpen' })

	breaker.recordSuccess()
	await expect(run(() => Promise.reject(new Error('unknown target')))).rejects.toThrow('unknown target')
})

test('the synchronous chain gives the same source without Horizons, and the codes of the kernels when nothing else is offered', () => {
	const { result, provenance } = computeEphemerisSync({ kernels: kernels(snapshot(undefined)), mode: 'accurate', sources: { analytical: () => 'analytical' }, compute: (e) => e })
	expect(result).toBe('analytical')
	expect(provenance.attempts).toEqual([])

	const unavailable = () => computeEphemerisSync({ kernels: kernels(snapshot([10])), mode: 'fast', sources: { bodies: [{ name: 'mars', naif: 499 }], spk: () => 'spk' }, compute: (e) => e })
	expect(unavailable).toThrow(EphemerisUnavailableError)
	try {
		unavailable()
	} catch (error) {
		expect(error).toMatchObject({ code: 'coverageUnavailable', attempts: [{ source: 'spk', reason: 'targetMissing', target: 'mars', body: 499 }] })
	}
})
