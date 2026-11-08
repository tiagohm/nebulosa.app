import { describe, expect, test } from 'bun:test'
import type { OrbitalMechanicsReference, OrbitCenterPayload, OrbitDefinitionPayload, OrbitSolveResponse, OrbitTrajectoryResponse } from 'api'
import { AU_KM, DEG2RAD } from 'nebulosa/src/core/constants'
import { proxy } from 'valtio'
// oxfmt-ignore
import { advanceClock, convertDraft, draftDefinition, draftOf, editDraft, exportScenario, formatTdb, importScenario, initialOrbitalMechanicsState, interpolatedPosition, nearestRate, type OrbitalMechanicsIo, type OrbitalMechanicsState, openOrbitalMechanics, parseTdb, rateOptions, setPlaying, setTime, trackCsv } from './orbitalmechanics'

const LIMITS = { epochMin: 2451545 - 3_652_500, epochMax: 2451545 + 3_652_500, maxSamples: 2048, maxOrbits: 8 }
const MU_EARTH = (398600.435507 * (86400 * 86400)) / AU_KM ** 3
const EARTH: OrbitCenterPayload = { code: 399, name: 'Earth', mu: MU_EARTH, radius: 6378.14 / AU_KM, system: false }
const MOLNIYA: OrbitDefinitionPayload = { kind: 'elliptic', mu: MU_EARTH, plane: 'equator', semiMajorAxis: 26600 / AU_KM, eccentricity: 0.74, inclination: 63.4 * DEG2RAD, node: 80 * DEG2RAD, argumentOfPeriapsis: 270 * DEG2RAD, meanAnomaly: 0, epoch: 2451545 }
const REFERENCE: OrbitalMechanicsReference = {
	centers: [EARTH, { code: 10, name: 'Sun', mu: 2.959122082855911e-4, radius: 0.00465, system: false }],
	presets: [{ id: 'molniya', name: 'Molniya-type orbit', description: '', source: { kind: 'illustrative' }, center: 399, definition: MOLNIYA }],
	limits: LIMITS,
}

// A solution of a circular orbit of period 1 day at its anchor.
function solution(time: number, overrides: Partial<OrbitSolveResponse> = {}): OrbitSolveResponse {
	const elements = {
		plane: 'equator',
		conic: 'elliptic',
		eccentricity: 0.74,
		semiLatusRectum: 1e-4,
		periapsisDistance: 4.6e-5,
		semiMajorAxis: 1.778e-4,
		period: 0.5,
		meanMotion: 12.56,
		inclination: 1.1,
		node: { defined: true, value: 1.4 },
		argumentOfPeriapsis: { defined: true, value: 4.7 },
		longitudeOfPeriapsis: { defined: true, value: 6.1 },
		trueAnomaly: { defined: true, value: 0 },
		argumentOfLatitude: { defined: true, value: 4.7 },
		trueLongitude: 6.1,
		eccentricAnomaly: 0,
		meanAnomaly: 0,
		periapsisTime: 2451545,
	} as const
	return {
		fingerprint: 'f',
		anchor: 2451545,
		time,
		utc: 946727935816,
		position: [1e-5, 2e-5, 3e-5],
		velocity: [1e-3, 0, 0],
		elements: { equator: elements, ecliptic: { ...elements, plane: 'ecliptic' } },
		diagnostics: { radius: 1, speed: 1, radialSpeed: 0, transverseSpeed: 1, escapeSpeed: 1, specificEnergy: -1, angularMomentum: [0, 0, 1], angularMomentumMagnitude: 1, eccentricityVector: [0.74, 0, 0], normal: [0, 0, 1] },
		warnings: [],
		...overrides,
	}
}

// Samples of uniform circular motion of radius 1 and angular rate 1 rad/day from t = 0 to 2π.
function circle(count: number): OrbitTrajectoryResponse {
	const times = Array.from({ length: count + 1 }, (_, i) => (2 * Math.PI * i) / count)
	return {
		fingerprint: 'c',
		curve: { closed: true, points: [], markers: [], truncated: false },
		samples: { times, positions: times.map((t) => [Math.cos(t), Math.sin(t), 0] as const), velocities: times.map((t) => [-Math.sin(t), Math.cos(t), 0] as const), truncated: false },
	}
}

interface Call {
	readonly url: string
	readonly body: Record<string, unknown>
}

// Fake API: answers the reference, a solve at the instant asked for, and a trajectory; records every call.
function fakeIo(delay?: (call: Call) => Promise<void>) {
	const calls: Call[] = []
	const timers: (() => void)[] = []
	const io: OrbitalMechanicsIo = {
		fetch: async (input, init) => {
			const call = { url: input, body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {} }
			calls.push(call)
			await delay?.(call)
			if (input.endsWith('/reference')) return Response.json(REFERENCE)
			if (input.endsWith('/solve')) return Response.json(solution((call.body.at as number | undefined) ?? 2451545, { fingerprint: JSON.stringify(call.body.definition) }))
			return Response.json(circle(16))
		},
		schedule: (callback) => {
			timers.push(callback)
			return () => timers.splice(timers.indexOf(callback), 1)
		},
	}
	const flush = async () => {
		for (let i = 0; i < 20; i++) await Promise.resolve()
		await Bun.sleep(0)
	}
	return { io, calls, timers, flush }
}

describe('drafts', () => {
	test('an elliptic draft in km becomes a definition in AU and radians, and back', () => {
		const draft = draftOf(MOLNIYA, 'km')
		expect(draft.semiMajorAxis).toBeCloseTo(26600, 9)
		expect(draft.inclination).toBeCloseTo(63.4, 12)

		const definition = draftDefinition(draft, EARTH, 'km', LIMITS)
		if (typeof definition === 'string') throw new Error(definition)
		expect(definition.kind).toBe('elliptic')
		if (definition.kind !== 'elliptic') return
		expect(definition.semiMajorAxis).toBeCloseTo(MOLNIYA.kind === 'elliptic' ? MOLNIYA.semiMajorAxis : 0, 15)
		expect(definition.argumentOfPeriapsis).toBeCloseTo(270 * DEG2RAD, 12)
		expect(definition.mu).toBe(MU_EARTH)
	})

	test('a draft outside the model says why', () => {
		const draft = draftOf(MOLNIYA, 'km')
		expect(draftDefinition({ ...draft, eccentricity: 1 }, EARTH, 'km', LIMITS)).toContain('eccentricity')
		expect(draftDefinition({ ...draft, inclination: 190 }, EARTH, 'km', LIMITS)).toContain('inclination')
		expect(draftDefinition({ ...draft, semiMajorAxis: -1 }, EARTH, 'km', LIMITS)).toContain('semi-major axis')
		expect(draftDefinition({ ...draft, epoch: 9e6 }, EARTH, 'km', LIMITS)).toContain('epoch')
		expect(draftDefinition({ ...draft, kind: 'hyperbolic', hyperbolicEccentricity: 1 }, EARTH, 'km', LIMITS)).toContain('above 1')
		expect(draftDefinition({ ...draft, kind: 'cartesian', position: [7000, 0, 0], velocity: [3, 0, 0] }, EARTH, 'km', LIMITS)).toContain('parallel')
		expect(draftDefinition({ ...draft, kind: 'cartesian', position: [0, 0, 0], velocity: [3, 0, 0] }, EARTH, 'km', LIMITS)).toContain('center')
		expect(draftDefinition(draft, { ...EARTH, mu: 0 }, 'km', LIMITS)).toContain('gravitational parameter')
	})

	test('a Cartesian draft in km and km/s is sent in AU and AU/day without rotation', () => {
		const draft = { ...draftOf(MOLNIYA, 'km'), kind: 'cartesian' as const, position: [7000, 0, 0] as [number, number, number], velocity: [0, 7.5, 1] as [number, number, number] }
		const definition = draftDefinition(draft, EARTH, 'km', LIMITS)
		if (typeof definition === 'string' || definition.kind !== 'cartesian') throw new Error(JSON.stringify(definition))
		expect(definition.position[0]).toBeCloseTo(7000 / AU_KM, 15)
		expect(definition.velocity[1]).toBeCloseTo((7.5 * 86400) / AU_KM, 12)
	})

	test('switching the kind carries the solved geometry over', () => {
		const draft = draftOf(MOLNIYA, 'km')
		const solved = solution(2451545)
		const cartesian = convertDraft(draft, 'cartesian', solved, 'km')
		expect(cartesian.position[0]).toBeCloseTo(1e-5 * AU_KM, 6)
		expect(cartesian.epoch).toBe(2451545)

		const hyperbola = convertDraft(draft, 'hyperbolic', solved, 'km')
		expect(hyperbola.periapsisDistance).toBeCloseTo(4.6e-5 * AU_KM, 6)
		expect(hyperbola.hyperbolicEccentricity).toBe(1.5)
		expect(hyperbola.periapsisTime).toBe(2451545)
	})
})

describe('clock', () => {
	test('a periodic timeline wraps by whole periods and an open one stops at its ends', () => {
		const periodic = { start: 10, end: 20, periodic: true }
		expect(advanceClock(19, 4, 1, periodic)).toEqual({ time: 13, stop: false })
		expect(advanceClock(11, -4, 1, periodic)).toEqual({ time: 17, stop: false })

		const open = { start: 10, end: 20, periodic: false }
		expect(advanceClock(19, 4, 1, open)).toEqual({ time: 20, stop: true })
		expect(advanceClock(11, -4, 1, open)).toEqual({ time: 10, stop: true })
		expect(advanceClock(15, 2, 0.5, open)).toEqual({ time: 16, stop: false })
	})

	test('rates relative to the period are offered for a bound orbit only', () => {
		expect(rateOptions(undefined).some((e) => e.label.includes('orbit'))).toBeFalse()
		expect(rateOptions(120)[0]).toEqual({ label: '1 orbit/min', rate: 2 })
		expect(nearestRate(rateOptions(undefined), 1.3).label).toBe('1 day/s')
	})

	test('interpolation follows the exact motion between samples and loops a periodic track', () => {
		const trajectory = circle(32)
		const periodic = { start: 0, end: 2 * Math.PI, periodic: true, trajectory }

		for (const t of [0.1, 1.234, 3, 6.2]) {
			const p = interpolatedPosition(periodic, t)!
			expect(Math.hypot(p[0] - Math.cos(t), p[1] - Math.sin(t))).toBeLessThan(1e-4)
		}

		const later = interpolatedPosition(periodic, 1.234 + 4 * Math.PI)!
		expect(later[0]).toBeCloseTo(Math.cos(1.234), 4)
		expect(interpolatedPosition({ ...periodic, periodic: false }, 7)).toBeUndefined()
	})
})

describe('requests', () => {
	test('the first opening reads the reference, loads the default preset, and inspects it', async () => {
		const { io, calls, flush } = fakeIo()
		const state = proxy<OrbitalMechanicsState>(initialOrbitalMechanicsState())
		await openOrbitalMechanics(state, io)
		await flush()

		expect(calls.map((e) => e.url)).toEqual(['/api/orbital-mechanics/reference', '/api/orbital-mechanics/solve', '/api/orbital-mechanics/trajectory', '/api/orbital-mechanics/solve'])
		expect(state.center?.code).toBe(399)
		expect(state.unit).toBe('km')
		expect(state.orbits).toHaveLength(1)
		expect(state.orbits[0].track?.periodic).toBeTrue()
		expect(calls[2].body).toMatchObject({ start: 2451545, end: 2451545.5, plane: 'equator' })
		expect(calls[3].body.at).toBe(2451545)
		expect(state.inspection?.solution.time).toBe(2451545)
	})

	test('an edit is solved once it rests, and a late answer of an older definition is discarded', async () => {
		const gates: { resolve: () => void; call: Call }[] = []
		const { io, calls, timers, flush } = fakeIo((call) => {
			if (!call.url.endsWith('/solve') || call.body.at !== undefined || calls.length < 3) return Promise.resolve()
			const gate = Promise.withResolvers<void>()
			gates.push({ resolve: gate.resolve, call })
			return gate.promise
		})
		const state = proxy<OrbitalMechanicsState>(initialOrbitalMechanicsState())
		await openOrbitalMechanics(state, io)
		await flush()
		const id = state.orbits[0].id

		editDraft(state, id, (d) => (d.eccentricity = 0.5), io)
		editDraft(state, id, (d) => (d.eccentricity = 0.6), io)
		expect(timers).toHaveLength(1)
		timers.shift()!()
		editDraft(state, id, (d) => (d.eccentricity = 0.7), io)
		timers.shift()!()
		await flush()

		expect(gates).toHaveLength(2)
		gates[1].resolve()
		await flush()
		gates[0].resolve()
		await flush()

		const definition = state.orbits[0].definition
		expect(definition?.kind === 'elliptic' && definition.eccentricity).toBe(0.7)
		expect(state.orbits[0].solution?.fingerprint).toBe(JSON.stringify(definition))
		expect(state.orbits[0].source).toEqual({ kind: 'manual' })
	})

	test('a stopped clock inspects its instant, a running one does not', async () => {
		const { io, calls, flush } = fakeIo()
		const state = proxy<OrbitalMechanicsState>(initialOrbitalMechanicsState())
		await openOrbitalMechanics(state, io)
		await flush()
		const before = calls.length

		setPlaying(state, true, io)
		state.time = 2451545.2
		await flush()
		expect(calls.length).toBe(before)

		setPlaying(state, false, io)
		await flush()
		expect(calls.at(-1)?.body.at).toBe(2451545.2)

		setTime(state, 2451545.3, io)
		await flush()
		expect(state.inspection?.solution.time).toBe(2451545.3)
	})
})

describe('exchange', () => {
	test('a scenario exports and imports back, and a foreign file is refused', async () => {
		const { io, flush } = fakeIo()
		const state = proxy<OrbitalMechanicsState>(initialOrbitalMechanicsState())
		await openOrbitalMechanics(state, io)
		await flush()
		state.overlays.labels = false
		const scenario = exportScenario(state)!
		expect(scenario).toMatchObject({ kind: 'nebulosa-orbital-mechanics-scenario', version: 1, center: EARTH, plane: 'equator' })
		expect(scenario.orbits[0].definition).toEqual(MOLNIYA)

		const other = proxy<OrbitalMechanicsState>(initialOrbitalMechanicsState())
		other.reference = REFERENCE
		importScenario(other, JSON.stringify(scenario), io)
		await flush()
		expect(other.importError).toBeUndefined()
		expect(other.orbits[0].definition).toEqual(MOLNIYA)
		expect(other.overlays.labels).toBeFalse()
		expect(other.unit).toBe('km')

		importScenario(other, JSON.stringify({ ...scenario, version: 2 }), io)
		expect(other.importError).toContain('version 2')
		importScenario(other, JSON.stringify({ ...scenario, orbits: [{ ...scenario.orbits[0], definition: { ...MOLNIYA, eccentricity: 1.5 } }] }), io)
		expect(other.importError).toContain('eccentricity')
		importScenario(other, JSON.stringify({ ...scenario, orbits: [{ ...scenario.orbits[0], definition: { ...MOLNIYA, mu: 1 } }] }), io)
		expect(other.importError).toContain('center')
		expect(other.orbits[0].definition).toEqual(MOLNIYA)
	})

	test('the state table names its units, frame, origin, and model', () => {
		const csv = trackCsv({ name: 'Molniya', source: { kind: 'preset', id: 'molniya', name: 'Molniya', sourced: false } }, { trajectory: circle(4) }, EARTH)
		const lines = csv.trimEnd().split('\r\n')
		expect(lines[0]).toBe('jd_tdb,time_tdb,x_au,y_au,z_au,vx_au_per_day,vy_au_per_day,vz_au_per_day,frame,origin,origin_naif,gm_au3_per_day2,model,orbit,source')
		expect(lines).toHaveLength(6)
		expect(lines[1]).toContain('"J2000 equatorial (ICRF-aligned), geometric",Earth,399')
		expect(lines[1]).toContain('two-body Kepler (analytic)')
	})

	test('a Julian date TDB reads as a TDB calendar date and back', () => {
		expect(formatTdb(2451545)).toBe('2000-01-01 12:00:00 TDB')
		expect(parseTdb('2000-01-01T12:00:00')).toBe(2451545)
		expect(parseTdb('not a date')).toBeUndefined()
	})
})
