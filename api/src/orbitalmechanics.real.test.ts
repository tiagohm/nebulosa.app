import { afterAll, expect, test } from 'bun:test'
import fs from 'fs/promises'
import type { SmallBodySearch, SmallBodySearchFound } from 'nebulosa/src/adapters/orbits/sbd'
import { readDaf } from 'nebulosa/src/astronomy/ephemeris/kernels/daf'
import { inspectSpk } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.inspect'
import { prepareSpkKernelSet, type SpkKernelSet } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import { orbitCenter } from 'nebulosa/src/astronomy/orbits/mechanics'
import { AU_KM, DEG2RAD } from 'nebulosa/src/core/constants'
import { fileHandleSource } from 'nebulosa/src/io/file'
import { createOrbitalMechanicsRoutes, minorBodyDefinition, type OrbitCompareResponse, OrbitalMechanicsService, type OrbitResolveResponse } from './orbitalmechanics'
import { MinorBodies } from './sky/minorbodies'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'
import { SsdThrottledError } from './ssd'

let de440sFileHandle: fs.FileHandle | undefined
let de440s: SpkKernelSet | undefined

const DE440S_PATH = `${import.meta.dir}/../../core/data/de440s.bsp`
const SKIP = !(await fs.exists(DE440S_PATH))

async function load() {
	if (de440s || SKIP) return de440s
	// The DE440 short kernel of the toolkit's fixtures, 1849 to 2150.
	const handle = await fs.open(DE440S_PATH)
	const daf = await readDaf(fileHandleSource(handle))
	const inspection = inspectSpk(daf, (await handle.stat()).size)
	if (!inspection.ok) throw new Error(inspection.error)
	de440s = await prepareSpkKernelSet([{ id: 'de440s', daf, segments: inspection.segments }])
	return de440s
}

afterAll(async () => {
	await de440sFileHandle?.close()
	de440s = undefined
	de440sFileHandle = undefined
})

// Snapshot of a library holding `set`, or none.
function kernels(set?: SpkKernelSet, generation = 7) {
	return { current: (): SpiceKernelSnapshot => ({ generation, policy: 'automatic', loading: false, set, readiness: new Map() }) }
}

// Minimal SBDB answer for Apophis.
const APOPHIS = {
	object: { spkid: '20099942', des: '99942', fullname: '99942 Apophis (2004 MN4)', kind: 'an', neo: true, pha: true, orbit_class: { name: 'Aten', code: 'ATE' } },
	orbit: {
		orbit_id: '220',
		epoch: '2461200.5',
		equinox: 'J2000',
		soln_date: '2025-06-01 05:04:56',
		elements: [
			{ name: 'e', title: 'eccentricity', value: '0.1911', units: null },
			{ name: 'a', title: 'semi-major axis', value: '0.9224', units: 'au' },
			{ name: 'i', title: 'inclination', value: '3.34', units: 'deg' },
			{ name: 'om', title: 'longitude of the ascending node', value: '203.9', units: 'deg' },
			{ name: 'w', title: 'argument of perihelion', value: '126.6', units: 'deg' },
			{ name: 'ma', title: 'mean anomaly', value: '142.8', units: 'deg' },
		],
	},
	phys_par: [],
} as unknown as SmallBodySearchFound

// Service over a fake SBDB answering `answers` by query text, recording the queries, and a library holding `set`, or
// none when it is false.
async function serve(answers: Record<string, SmallBodySearch | Error>, set: boolean = true) {
	const queries: string[] = []
	const minorBodies = new MinorBodies({
		fetch: (text) => {
			queries.push(text)
			const answer = answers[text]
			return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer ?? { message: 'not found' })
		},
	})
	const routes = createOrbitalMechanicsRoutes(new OrbitalMechanicsService({ minorBodies, kernels: kernels(set === false ? undefined : await load()) }))
	const post = (path: '/api/orbital-mechanics/resolve' | '/api/orbital-mechanics/compare', body: unknown) => routes[path].POST(new Request(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body) }))
	return { queries, post }
}

test.skipIf(SKIP)('an offline lookup never asks SBDB, and an online one resolves the published solution', async () => {
	const { queries, post } = await serve({ '20099942': APOPHIS, apophis: APOPHIS })

	const offline = await post('/api/orbital-mechanics/resolve', { kind: 'minorBody', query: '20099942', online: false })
	expect(offline.status).toBe(404)
	expect(await offline.json()).toMatchObject({ code: 'notCached' })
	expect(queries).toEqual([])

	const online = (await (await post('/api/orbital-mechanics/resolve', { kind: 'minorBody', query: 'apophis', online: true })).json()) as OrbitResolveResponse
	expect(queries).toEqual(['apophis'])
	if (online.kind !== 'resolved') throw new Error(online.kind)
	expect(online.center).toBe(10)
	expect(online.source).toMatchObject({ kind: 'sbdb', spkId: '20099942', designation: '99942', orbitId: '220', solutionDate: '2025-06-01 05:04:56', epoch: 2461200.5 })
	expect(online.definition).toMatchObject({ kind: 'elliptic', plane: 'ecliptic', semiMajorAxis: 0.9224, eccentricity: 0.1911, epoch: 2461200.5, mu: orbitCenter(10)!.mu })

	// Once resolved, the same body is available offline by its SPK-ID.
	const again = (await (await post('/api/orbital-mechanics/resolve', { kind: 'minorBody', query: '20099942', online: false })).json()) as OrbitResolveResponse
	expect(again.kind).toBe('resolved')
	expect(queries).toEqual(['apophis'])
})

test.skipIf(SKIP)('ambiguous, unknown, B1950, and throttled lookups answer their codes', async () => {
	const b1950 = { ...APOPHIS, object: { ...APOPHIS.object, spkid: '20000002' }, orbit: { ...APOPHIS.orbit, equinox: 'B1950' } } as unknown as SmallBodySearchFound
	const { post } = await serve({
		halley: {
			list: [
				{ pdes: '1P', name: '1P/Halley' },
				{ pdes: '2688', name: '2688 Halley' },
			],
		},
		old: b1950,
		busy: new SsdThrottledError(4000),
	})

	expect(await (await post('/api/orbital-mechanics/resolve', { kind: 'minorBody', query: 'halley', online: true })).json()).toEqual({
		kind: 'ambiguous',
		matches: [
			{ designation: '1P', name: '1P/Halley' },
			{ designation: '2688', name: '2688 Halley' },
		],
	})

	const unknown = await post('/api/orbital-mechanics/resolve', { kind: 'minorBody', query: 'xyzzy', online: true })
	expect(unknown.status).toBe(404)
	expect(await unknown.json()).toMatchObject({ code: 'objectNotFound' })

	const old = await post('/api/orbital-mechanics/resolve', { kind: 'minorBody', query: 'old', online: true })
	expect(old.status).toBe(422)
	expect(await old.json()).toMatchObject({ code: 'unsupportedFrame' })

	const busy = await post('/api/orbital-mechanics/resolve', { kind: 'minorBody', query: 'busy', online: true })
	expect(busy.status).toBe(503)
	expect(await busy.json()).toMatchObject({ code: 'rateLimited', retryAfter: 4000 })
})

test.skipIf(SKIP)('an SPK state is the target minus the center from one snapshot, with its provenance', async () => {
	const { post } = await serve({})
	const resolved = (await (await post('/api/orbital-mechanics/resolve', { kind: 'spk', target: 399, center: 10, epoch: 2451545 })).json()) as OrbitResolveResponse
	if (resolved.kind !== 'resolved') throw new Error(resolved.kind)
	expect(resolved.name).toBe('Earth')
	expect(resolved.source).toEqual({ kind: 'spk', target: 399, center: 10, epoch: 2451545, generation: 7, kernels: ['de440s'] })
	if (resolved.definition.kind !== 'cartesian') throw new Error(resolved.definition.kind)
	// The Earth is about 0.983 AU from the Sun at J2000 and moves about 30.3 km/s.
	expect(Math.hypot(...resolved.definition.position)).toBeCloseTo(0.9833, 3)
	expect((Math.hypot(...resolved.definition.velocity) * AU_KM) / 86400).toBeCloseTo(30.29, 1)

	const unknownCenter = await post('/api/orbital-mechanics/resolve', { kind: 'spk', target: 399, center: 3, epoch: 2451545 })
	expect(await unknownCenter.json()).toMatchObject({ code: 'centerUnavailable' })
	const missing = await post('/api/orbital-mechanics/resolve', { kind: 'spk', target: 2000433, center: 10, epoch: 2451545 })
	expect(await missing.json()).toMatchObject({ code: 'kernelMissing', body: 2000433 })
	const uncovered = await post('/api/orbital-mechanics/resolve', { kind: 'spk', target: 399, center: 10, epoch: 2300000 })
	expect(await uncovered.json()).toMatchObject({ code: 'kernelCoverageUnavailable', body: 399, epoch: 2300000 })

	const empty = await serve({}, false)
	expect(await (await empty.post('/api/orbital-mechanics/resolve', { kind: 'spk', target: 399, center: 10, epoch: 2451545 })).json()).toMatchObject({ code: 'kernelMissing' })
})

test.skipIf(SKIP)('Kepler versus SPICE starts at zero at the anchor and grows away from it', async () => {
	const { post } = await serve({})
	// The Moon about the Earth: strongly perturbed by the Sun, so the osculating ellipse departs within days.
	const response = await post('/api/orbital-mechanics/compare', { target: 301, center: 399, anchor: 2451545, start: 2451545 - 10, end: 2451545 + 10, count: 21 })
	expect(response.status).toBe(200)
	const comparison = (await response.json()) as OrbitCompareResponse

	expect(comparison.nodes).toHaveLength(21)
	expect(comparison.source).toEqual({ kind: 'spk', target: 301, center: 399, epoch: 2451545, generation: 7, kernels: ['de440s'] })
	const anchor = comparison.nodes.find((e) => e.time === 2451545)!
	expect(anchor.distance * AU_KM).toBeLessThan(1e-6)
	const last = comparison.nodes.at(-1)!
	expect(last.distance * AU_KM).toBeGreaterThan(100)
	expect(Math.hypot(...last.rtnPosition!)).toBeCloseTo(last.distance, 15)
	expect(comparison.summary.maxDistance).toBeGreaterThanOrEqual(last.distance)
	expect(comparison.reference.positions).toHaveLength(21)
	// At the anchor both models give the same state.
	for (let i = 0; i < 3; i++) expect(comparison.model.positions[10][i]).toBeCloseTo(comparison.reference.positions[10][i], 14)

	// A window leaving the kernel's coverage fails as a whole, naming the instant.
	const outside = await post('/api/orbital-mechanics/compare', { target: 301, center: 399, anchor: 2451545, start: 2451545, end: 2451545 + 200 * 365.25, count: 5 })
	expect(outside.status).toBe(422)
	expect(await outside.json()).toMatchObject({ code: 'kernelCoverageUnavailable' })
})

test.skipIf(SKIP)('SBDB elements become the definition their shape publishes', () => {
	const mu = orbitCenter(10)!.mu
	const base = { epoch: 2461000.5, ec: 0.5, om: DEG2RAD, w: 2 * DEG2RAD, i: 3 * DEG2RAD }
	expect(minorBodyDefinition({ ...base, tpqr: { qr: 1, tp: 2461000.5 } }, mu)).toMatchObject({ kind: 'elliptic', semiMajorAxis: 2, meanAnomaly: 0, epoch: 2461000.5 })
	expect(minorBodyDefinition({ ...base, ec: 1.2, tpqr: { qr: 1, tp: 2461010 } }, mu)).toMatchObject({ kind: 'hyperbolic', periapsisDistance: 1, eccentricity: 1.2, periapsisTime: 2461010 })
	expect(minorBodyDefinition({ ...base, ec: 1, tpqr: { qr: 1, tp: 2461010 } }, mu)).toMatchObject({ kind: 'parabolic', periapsisDistance: 1 })
	const byMotion = minorBodyDefinition({ ...base, tpqr: { ma: 0.5, n: Math.sqrt(mu / 8) } }, mu)
	expect(byMotion.kind === 'elliptic' && byMotion.semiMajorAxis).toBeCloseTo(2, 12)
})
