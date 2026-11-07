import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spkSeconds } from 'nebulosa/src/astronomy/ephemeris/kernels/spk'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { spkFixture, type SpkFixtureSegment } from '../spicekernels.fixture'
import { type SpiceKernelSnapshot, SpiceKernelRuntime } from '../spicekernels.runtime'
import type { SpiceEphemerisPolicy } from '../spicekernels.store'
import { EphemerisUnavailableError, type HorizonsObserver, SkyEphemeris } from './ephemeris'
import { MinorBodies } from './minorbodies'
import { createSkyRoutes } from './routes'

const directory = mkdtempSync(join(tmpdir(), 'nebulosa-sky-spk-'))
const runtimes: SpiceKernelRuntime[] = []

afterAll(() => {
	for (const runtime of runtimes) runtime[Symbol.dispose]()
	rmSync(directory, { recursive: true, force: true })
})

const observer = { latitude: -23.5, longitude: -46.6, elevation: 760 }

// 2026-10-18T12:00:00Z.
const TIME = Date.UTC(2026, 9, 18, 12)
const SECONDS = spkSeconds(timeUnix(TIME / 1000, true))

// Mars at TIME seen from the observer, from an airless Horizons table (2026-10-18).
const MARS_ROW = ['', '', '', '134.01710', '18.69990', '134.39780', '18.59740', '326.690', '40.847', '0.960', '4.508', '89.80117', '12.79711001', '73.5840', '/L', 'Cnc', '']

const WIDE = { start: -1e9, end: 1e9 }

// Constant geometry: the Sun at the barycenter, the Earth 1 AU away on +X, and a small body 2 AU from the Sun on +Y.
const PLANETARY: SpkFixtureSegment[] = [
	{ center: 0, target: 10, ...WIDE, position: [0, 0, 0] },
	{ center: 0, target: 3, ...WIDE, position: [1.496e8, 0, 0] },
	{ center: 3, target: 399, ...WIDE, position: [0, 0, 0] },
]
const CERES: SpkFixtureSegment[] = [{ center: 10, target: 20000001, ...WIDE, position: [0, 2.992e8, 0] }]

function horizons() {
	const calls: string[] = []
	const observe = ((command: string, _center: string, _coord: unknown, start: number, end: number) => {
		calls.push(command)
		const count = Math.round((end - start) / 600_000) + 1
		return Promise.resolve(Array.from({ length: count }, () => [...MARS_ROW]))
	}) as unknown as HorizonsObserver
	return { observe, calls }
}

let files = 0

// A runtime of kernels made of fixture files, under a policy.
async function runtimeOf(policy: SpiceEphemerisPolicy, ...kernels: (readonly SpkFixtureSegment[] | string)[]) {
	const runtime = new SpiceKernelRuntime()
	runtimes.push(runtime)
	const entries = kernels.map((kernel) => {
		const id = `kernel-${++files}`
		if (typeof kernel === 'string') return { id, path: kernel }
		const path = join(directory, `${id}.bsp`)
		writeFileSync(path, spkFixture(kernel))
		return { id, path }
	})
	const failures = await runtime.rebuild(entries, policy)
	expect(failures.size).toBe(0)
	return { runtime, ids: entries.map((e) => e.id) }
}

async function ephemerisOf(policy: SpiceEphemerisPolicy, ...kernels: (readonly SpkFixtureSegment[] | string)[]) {
	const { runtime, ids } = await runtimeOf(policy, ...kernels)
	const { observe, calls } = horizons()
	return { ephemeris: new SkyEphemeris({ observer: observe, kernels: runtime }), calls, ids, runtime }
}

test('accurate positions covered by the kernels come from them with their provenance', async () => {
	const { ephemeris, calls, ids, runtime } = await ephemerisOf('automatic', PLANETARY, CERES)
	const position = await ephemeris.position({ type: 'minorBody', spkId: '20000001' }, { time: TIME, observer })

	expect(calls).toEqual([])
	expect(position.source).toBe('spk')
	expect(position.fallbackReason).toBeUndefined()
	expect(position.kernels).toEqual({ generation: runtime.current().generation, kernelIds: [ids[0], ids[1]] })
	// Geocentric distance of a body 2 AU from the Sun at right angles to the Earth: √5 AU, within the site offset.
	expect(position.distance).toBeCloseTo(Math.sqrt(5), 3)
	expect(position.magnitude).toBeUndefined()

	// Fast positions stay on the local models.
	expect((await ephemeris.position({ type: 'body', code: '10' }, { time: TIME, observer, mode: 'fast' })).source).toBe('local')
	expect((await ephemeris.position({ type: 'body', code: '10' }, { time: TIME, observer })).source).toBe('spk')
})

test('the automatic policy asks Horizons for what the kernels do not cover', async () => {
	const { ephemeris, calls } = await ephemerisOf('automatic', PLANETARY)
	const position = await ephemeris.position({ type: 'body', code: '499' }, { time: TIME, observer })

	expect(calls).toEqual(['499'])
	expect(position.source).toBe('horizons')
})

test('the offline policy uses the local models and never asks Horizons', async () => {
	const { ephemeris, calls } = await ephemerisOf('offline', PLANETARY)
	const mars = await ephemeris.position({ type: 'body', code: '499' }, { time: TIME, observer })

	expect(mars.source).toBe('local')
	expect(mars.fallbackReason).toBe('offline')
	expect(ephemeris.remoteAllowed).toBeFalse()

	const unknown = ephemeris.position({ type: 'minorBody', spkId: '20000002' }, { time: TIME, observer })
	await expect(unknown).rejects.toBeInstanceOf(EphemerisUnavailableError)
	await expect(unknown).rejects.toMatchObject({ code: 'offline' })
	expect(calls).toEqual([])
})

test('the spkOnly policy has no other source', async () => {
	const { ephemeris, calls } = await ephemerisOf('spkOnly', CERES)

	await expect(ephemeris.position({ type: 'body', code: '499' }, { time: TIME, observer })).rejects.toMatchObject({ code: 'coverageUnavailable' })
	await expect(ephemeris.position({ type: 'minorBody', spkId: '20000001' }, { time: TIME, observer })).rejects.toMatchObject({ code: 'missingDependency' })
	expect(ephemeris.events({ type: 'body', code: '499' }, TIME, observer, 'mars')).toBeUndefined()
	expect(calls).toEqual([])
})

test('a light-time epoch outside the coverage abandons the whole kernel calculation', async () => {
	// The segment covers the reception instant but starts 10 s before it, after the emission about 1000 s earlier.
	const edge: SpkFixtureSegment[] = [{ center: 10, target: 20000001, start: SECONDS - 10, end: SECONDS + 1e6, position: [0, 2.992e8, 0] }]
	const automatic = await ephemerisOf('automatic', PLANETARY, edge)
	const position = await automatic.ephemeris.position({ type: 'minorBody', spkId: '20000001' }, { time: TIME, observer })

	expect(position.source).toBe('horizons')
	expect(automatic.calls).toEqual(['DES=20000001;'])

	const strict = await ephemerisOf('spkOnly', PLANETARY, edge)
	await expect(strict.ephemeris.position({ type: 'minorBody', spkId: '20000001' }, { time: TIME, observer })).rejects.toMatchObject({ code: 'coverageUnavailable' })
})

test('events come from the kernels covering the whole window and follow a new generation', async () => {
	const { runtime } = await runtimeOf('automatic', PLANETARY, CERES)
	const ephemeris = new SkyEphemeris({ observer: horizons().observe, kernels: runtime })
	const target = { type: 'minorBody', spkId: '20000001' } as const

	const covered = ephemeris.events(target, TIME, observer, 'ceres')
	expect(covered).toBeDefined()

	// Without the kernels and without elements there is no local model: the cached events of the old generation are not reused.
	await runtime.rebuild([], 'automatic')
	expect(ephemeris.events(target, TIME, observer, 'ceres')).toBeUndefined()
})

test('a snapshot swap never mixes generations within a position', async () => {
	const { runtime, ids } = await runtimeOf('automatic', PLANETARY, CERES)
	const ephemeris = new SkyEphemeris({ observer: horizons().observe, kernels: runtime })
	const pending = ephemeris.position({ type: 'minorBody', spkId: '20000001' }, { time: TIME, observer })
	const swap = runtime.rebuild([], 'automatic')

	expect((await pending).kernels?.kernelIds).toEqual([ids[0], ids[1]])
	await swap
	expect(runtime.current().set).toBeUndefined()
})

test('under the offline policy a minor body is resolved without SBDB', async () => {
	let sbdb = 0
	const snapshot: SpiceKernelSnapshot = { generation: 1, policy: 'offline', loading: false, readiness: new Map() }
	const { observe, calls } = horizons()
	const routes = createSkyRoutes({
		catalog: (await import('./fixture')).fixtureCatalog(),
		constellations: { lines: [], boundaries: [], labels: [] },
		ephemeris: new SkyEphemeris({ observer: observe, kernels: { current: () => snapshot } }),
		minorBodies: new MinorBodies({
			fetch: () => {
				sbdb++
				return Promise.reject(new TypeError('offline'))
			},
		}),
	})

	const body = { target: { kind: 'minorBody', spkId: '20000001', designation: '1' }, time: TIME, observer }
	const response = await routes['/api/sky/position'].POST(new Request('http://localhost/api/sky/position', { method: 'POST', body: JSON.stringify(body) }) as never)

	expect(response.status).toBe(503)
	expect(((await response.json()) as { code: string }).code).toBe('offline')
	expect(sbdb).toBe(0)
	expect(calls).toEqual([])
})

// DE440s of the toolkit fixtures, when downloaded: the kernel Sun and Moon against the local models (VSOP87E, ELPMPP02),
// accurate to about an arcsecond and a few arcseconds near 2026, as a consistency check of the reductions.
const DE440S = join(import.meta.dir, '../../../core/data/de440s.bsp')

test.skipIf(!existsSync(DE440S))('the DE440s Sun and Moon agree with the local models', async () => {
	const { ephemeris } = await ephemerisOf('automatic', DE440S)
	const arcsec = Math.PI / 648000

	for (const code of ['10', '301'] as const) {
		const spk = await ephemeris.position({ type: 'body', code }, { time: TIME, observer })
		const local = await ephemeris.position({ type: 'body', code }, { time: TIME, observer, mode: 'fast' })
		const separation = Math.acos(Math.min(1, Math.sin(spk.declination) * Math.sin(local.declination) + Math.cos(spk.declination) * Math.cos(local.declination) * Math.cos(spk.rightAscension - local.rightAscension)))

		expect(spk.source).toBe('spk')
		expect(separation).toBeLessThan((code === '10' ? 2 : 10) * arcsec)
		expect(spk.distance! / local.distance!).toBeCloseTo(1, 6)
	}

	// DE440s has no planet centers beyond Venus: the planet Jupiter is never its system barycenter.
	expect((await ephemeris.position({ type: 'body', code: '599' }, { time: TIME, observer })).source).toBe('horizons')
})
