import { expect, test } from 'bun:test'
import type { OrbitalMechanicsReference, OrbitCenterPayload, OrbitCompareResponse, OrbitDefinitionPayload, OrbitResolveResponse } from 'api'
import { AU_KM } from 'nebulosa/src/core/constants'
import { proxy } from 'valtio'
import type { RouteState } from '../../shell/route'
import { initialOrbitalMechanicsState, type OrbitalMechanicsIo, type OrbitalMechanicsState } from './orbitalmechanics'
// oxfmt-ignore
import { comparisonCsv, comparisonRefusal, consumePendingTarget, exploreMinorBody, referencePositionAt, replaceSceneWithPending, resolveMinorBody, resolveSpkState, runComparison } from './orbitalmechanics.sources'

const SUN: OrbitCenterPayload = { code: 10, name: 'Sun', mu: 2.959122082855911e-4, radius: 0.00465, system: false }
const EARTH: OrbitCenterPayload = { code: 399, name: 'Earth', mu: 8.887692445125634e-10, radius: 6378.14 / AU_KM, system: false }
const LIMITS = { epochMin: 2451545 - 3_652_500, epochMax: 2451545 + 3_652_500, maxSamples: 2048, maxOrbits: 8 }
const REFERENCE: OrbitalMechanicsReference = { centers: [SUN, EARTH], presets: [], limits: LIMITS }
const APOPHIS: OrbitDefinitionPayload = { kind: 'elliptic', mu: SUN.mu, plane: 'ecliptic', semiMajorAxis: 0.9224, eccentricity: 0.1911, inclination: 0.058, node: 3.56, argumentOfPeriapsis: 2.21, meanAnomaly: 2.49, epoch: 2461200.5 }
const RESOLVED: OrbitResolveResponse = { kind: 'resolved', name: '99942 Apophis', center: 10, definition: APOPHIS, source: { kind: 'sbdb', spkId: '20099942', designation: '99942', orbitId: '220', epoch: 2461200.5, fetchedAt: 1 } }
const MOON: OrbitDefinitionPayload = { kind: 'cartesian', mu: EARTH.mu, position: [0.0018, 0.001, 0.0005], velocity: [-0.0003, 0.0004, 0.0001], epoch: 2451545 }

const COMPARISON: OrbitCompareResponse = {
	target: 301,
	center: 399,
	name: 'Moon',
	definition: MOON,
	source: { kind: 'spk', target: 301, center: 399, epoch: 2451545, generation: 3, kernels: ['de440s'] },
	nodes: [
		{ time: 2451544, distance: 1e-7, speed: 1e-9, rtnPosition: [1e-8, -1e-7, 0], rtnVelocity: [0, 1e-9, 0] },
		{ time: 2451545, distance: 0, speed: 0, rtnPosition: [0, 0, 0], rtnVelocity: [0, 0, 0] },
		{ time: 2451546, distance: 2e-7, speed: 2e-9 },
	],
	reference: {
		positions: [
			[1, 0, 0],
			[0, 1, 0],
			[-1, 0, 0],
		],
		velocities: [
			[0, 1.5, 0],
			[-1.5, 0, 0],
			[0, -1.5, 0],
		],
	},
	model: { positions: [], velocities: [] },
	summary: { maxDistance: 2e-7, maxDistanceTime: 2451546, maxSpeed: 2e-9 },
}

// Fake API: answers a resolve through `resolve`, a compare with COMPARISON, a solve, and a trajectory; records every call.
function fakeIo(resolve: (body: Record<string, unknown>) => Response) {
	const calls: { url: string; body: Record<string, unknown> }[] = []
	const io: OrbitalMechanicsIo = {
		fetch: (input, init) => {
			const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {}
			calls.push({ url: input, body })
			if (input.endsWith('/resolve')) return Promise.resolve(resolve(body))
			if (input.endsWith('/compare')) return Promise.resolve(Response.json(COMPARISON))
			return Promise.resolve(Response.json({ error: 'not in this test', code: 'solverFailed' }, { status: 422 }))
		},
		schedule: () => () => undefined,
	}
	return { io, calls }
}

// A state of a scene about `center`.
function scene(center: OrbitCenterPayload) {
	const state = proxy<OrbitalMechanicsState>(initialOrbitalMechanicsState())
	state.reference = REFERENCE
	state.center = center
	state.unit = center.code === 10 ? 'au' : 'km'
	return state
}

test('an offline lookup of a body not read recently offers JPL and asks it only when told', async () => {
	const { io, calls } = fakeIo((body) => (body.online ? Response.json(RESOLVED) : Response.json({ error: '20099942 was not looked up recently, so it needs JPL', code: 'notCached' }, { status: 404 })))
	const state = scene(SUN)

	await resolveMinorBody(state, '20099942', false, io)
	expect(state.lookup.offerOnline).toBeTrue()
	expect(state.lookup.error).toContain('needs JPL')
	expect(state.orbits).toHaveLength(0)

	await resolveMinorBody(state, '20099942', true, io)
	expect(calls.filter((e) => e.url.endsWith('/resolve')).map((e) => e.body.online)).toEqual([false, true])
	expect(state.lookup.offerOnline).toBeFalse()
	expect(state.orbits.map((e) => e.name)).toEqual(['99942 Apophis'])
	expect(state.orbits[0].source).toEqual(RESOLVED.source)
	expect(state.orbits[0].definition).toEqual(APOPHIS)
})

test('an orbit about another center waits, and replaces the scene only when asked', async () => {
	const { io } = fakeIo(() => Response.json(RESOLVED))
	const state = scene(EARTH)

	await resolveMinorBody(state, 'apophis', true, io)
	expect(state.orbits).toHaveLength(0)
	expect(state.lookup.pending?.name).toBe('99942 Apophis')

	replaceSceneWithPending(state, io)
	expect(state.center?.code).toBe(10)
	expect(state.unit).toBe('au')
	expect(state.plane).toBe('ecliptic')
	expect(state.time).toBe(2461200.5)
	expect(state.orbits.map((e) => e.name)).toEqual(['99942 Apophis'])
	expect(state.lookup.pending).toBeUndefined()
})

test('an ambiguous name lists its candidates, and an SPK failure points to the kernel library', async () => {
	const { io } = fakeIo((body) => (body.kind === 'spk' ? Response.json({ error: 'NAIF 301 is not covered at JD 2300000.00000 TDB', code: 'kernelCoverageUnavailable', body: 301, epoch: 2300000 }, { status: 422 }) : Response.json({ kind: 'ambiguous', matches: [{ designation: '1P', name: '1P/Halley' }] })))
	const state = scene(EARTH)

	await resolveMinorBody(state, 'halley', true, io)
	expect(state.lookup.matches).toEqual([{ designation: '1P', name: '1P/Halley' }])

	await resolveSpkState(state, 301, 399, 2300000, io)
	expect(state.lookup.kernelProblem).toBeTrue()
	expect(state.lookup.error).toContain('not covered')
	expect(state.lookup.matches).toBeUndefined()
})

test('a handoff carries the identity only and shows the orbit once the explorer opens, offline', async () => {
	const { io, calls } = fakeIo(() => Response.json(RESOLVED))
	const state = scene(EARTH)
	const route: RouteState = { route: { workspace: 'sky' } }
	const pushed: string[] = []

	exploreMinorBody({ spkId: '20099942', name: '99942 Apophis' }, { state, route, history: { pushState: (_, __, url) => pushed.push(String(url)) } })
	expect(route.route).toEqual({ workspace: 'tools', tool: 'orbital-mechanics-explorer' })
	expect(pushed).toEqual(['/tools/orbital-mechanics-explorer'])
	expect(state.pendingTarget).toEqual({ spkId: '20099942', name: '99942 Apophis' })

	await consumePendingTarget(state, io, proxy<Record<string, boolean>>({}))
	expect(state.pendingTarget).toBeUndefined()
	expect(calls[0].body).toEqual({ kind: 'minorBody', query: '20099942', online: false })
	// The scene was about the Earth; the orbit asked for replaces it, about the Sun.
	expect(state.center?.code).toBe(10)
	expect(state.orbits.map((e) => e.name)).toEqual(['99942 Apophis'])
})

test('a handoff of a body not read recently opens the lookups instead of asking JPL', async () => {
	const { io, calls } = fakeIo(() => Response.json({ error: 'needs JPL', code: 'notCached' }, { status: 404 }))
	const state = scene(EARTH)
	const sections = proxy<Record<string, boolean>>({})
	state.pendingTarget = { spkId: '20099942', name: '99942 Apophis' }

	await consumePendingTarget(state, io, sections)
	expect(calls).toHaveLength(1)
	expect(state.lookup.offerOnline).toBeTrue()
	expect(state.lookup.query).toBe('20099942')
	expect(sections['orbitalmechanics.sources']).toBeTrue()
})

test('a comparison about the scene center adds its osculating orbit once', async () => {
	const { io } = fakeIo(() => Response.json(RESOLVED))
	const state = scene(EARTH)
	const request = { target: 301, center: 399, anchor: 2451545, start: 2451544, end: 2451546, count: 3 }

	await runComparison(state, request, io)
	expect(state.comparison?.response.name).toBe('Moon')
	expect(state.orbits.map((e) => e.name)).toEqual(['Moon (osculating)'])

	await runComparison(state, request, io)
	expect(state.orbits).toHaveLength(1)
})

test('a comparison is checked before it is asked, and its CSV names units, frame, and provenance', () => {
	expect(comparisonRefusal({ target: 399, center: 399, start: 0, end: 1, count: 10 }, LIMITS)).toContain('own center')
	expect(comparisonRefusal({ target: 301, center: 399, start: 2451545, end: 2451545, count: 10 }, LIMITS)).toContain('span')
	expect(comparisonRefusal({ target: 301, center: 399, start: 2451545, end: 2451546, count: 5000 }, LIMITS)).toContain('2048')
	expect(comparisonRefusal({ target: 301, center: 399, start: 2451545, end: 2451546, count: 100 }, LIMITS)).toBeUndefined()

	const lines = comparisonCsv({ request: { target: 301, center: 399, anchor: 2451545, start: 2451544, end: 2451546, count: 3 }, response: COMPARISON })
		.trimEnd()
		.split('\r\n')
	expect(lines[0]).toBe('jd_tdb,time_tdb,dr_km,dv_m_per_s,dr_radial_km,dr_along_track_km,dr_normal_km,dv_radial_m_per_s,dv_along_track_m_per_s,dv_normal_m_per_s,target_naif,center_naif,anchor_jd_tdb,library_generation,kernels,difference')
	expect(lines).toHaveLength(4)
	expect(lines[1]).toContain(',301,399,2451545,3,"de440s",two-body Kepler minus SPK')
	// An undefined RTN frame leaves its columns empty, never zero.
	expect(lines[3]).toContain(',,,,,,,301')
})

test('the drawn SPK reference is interpolated within its span only', () => {
	const middle = referencePositionAt(COMPARISON, 2451545.5)!
	expect(Math.hypot(...middle)).toBeGreaterThan(0.9)
	expect(referencePositionAt(COMPARISON, 2451545)).toEqual([0, 1, 0])
	expect(referencePositionAt(COMPARISON, 2451547)).toBeUndefined()
})
