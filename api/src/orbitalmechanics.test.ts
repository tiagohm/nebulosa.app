import { expect, test } from 'bun:test'
import { AU_KM } from 'nebulosa/src/core/constants'
import { createOrbitalMechanicsRoutes, type OrbitalMechanicsReference, OrbitalMechanicsService, type OrbitCenterPayload, type OrbitDefinitionPayload, type OrbitSolveResponse, type OrbitTrajectoryResponse } from './orbitalmechanics'

const routes = createOrbitalMechanicsRoutes(new OrbitalMechanicsService())

const reference = async () => (await routes['/api/orbital-mechanics/reference'].GET().json()) as OrbitalMechanicsReference

const post = (path: '/api/orbital-mechanics/solve' | '/api/orbital-mechanics/trajectory', body: unknown) => routes[path].POST(new Request(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body) }))

const EARTH: OrbitCenterPayload = { code: 399, name: 'Earth', mu: (398600.435507 * (86400 * 86400)) / AU_KM ** 3, radius: 6378.14 / AU_KM, system: false }

// Every number in an answer must be finite: JSON writes NaN and Infinity as null.
async function finiteJson(response: Response) {
	const text = await response.text()
	expect(text).not.toContain('null')
	return JSON.parse(text) as unknown
}

test('the reference lists the DE440 centers, the presets, and the supported ranges', async () => {
	const { centers, presets, limits } = await reference()

	expect(centers.map((e) => e.code)).toEqual([10, 199, 299, 399, 301, 4, 5, 6, 7, 8, 9])
	expect(centers.find((e) => e.code === 5)!.system).toBeTrue()
	expect(presets.length).toBeGreaterThanOrEqual(9)
	expect(presets.filter((e) => e.source.kind === 'sourced').length).toBeGreaterThanOrEqual(2)
	expect(limits).toEqual({ epochMin: 2451545 - 3_652_500, epochMax: 2451545 + 3_652_500, maxSamples: 2048, maxOrbits: 8 })
})

test('every preset solves to finite values and samples a finite trajectory', async () => {
	const { centers, presets } = await reference()

	for (const preset of presets) {
		const center = centers.find((e) => e.code === preset.center)!
		const solved = await post('/api/orbital-mechanics/solve', { definition: preset.definition, center })
		expect(solved.status).toBe(200)
		const solution = (await finiteJson(solved)) as OrbitSolveResponse
		const start = solution.arc?.start ?? solution.anchor
		const end = solution.arc?.end ?? solution.anchor + solution.elements.equator.period!

		const trajectory = await post('/api/orbital-mechanics/trajectory', { definition: preset.definition, start, end, plane: 'equator' })
		expect(trajectory.status).toBe(200)
		const { curve, samples } = (await finiteJson(trajectory)) as OrbitTrajectoryResponse
		expect(curve.closed).toBe(solution.arc === undefined)
		expect(samples.times[0]).toBeCloseTo(start, 8)
		expect(samples.times.at(-1)!).toBeCloseTo(end, 8)
		expect(samples.positions).toHaveLength(samples.times.length)
	}
})

test('an elliptic definition solves at its epoch and at another instant', async () => {
	const definition: OrbitDefinitionPayload = { kind: 'elliptic', mu: EARTH.mu, plane: 'equator', semiMajorAxis: 26600 / AU_KM, eccentricity: 0.74, inclination: 1.1, node: 1.4, argumentOfPeriapsis: 4.7, meanAnomaly: 0, epoch: 2451545 }
	const atEpoch = (await (await post('/api/orbital-mechanics/solve', { definition, center: EARTH })).json()) as OrbitSolveResponse

	expect(atEpoch.anchor).toBe(2451545)
	expect(atEpoch.time).toBe(2451545)
	expect(atEpoch.utc).toBe(Date.UTC(2000, 0, 1, 11, 58, 55, 816))
	expect(Math.hypot(...atEpoch.position) * AU_KM).toBeCloseTo(26600 * 0.26, 3)
	expect(atEpoch.elements.equator.periapsisTime!).toBeCloseTo(2451545, 9)
	expect(atEpoch.elements.equator.period! * 24).toBeCloseTo(11.98, 1)
	expect(atEpoch.arc).toBeUndefined()
	expect(atEpoch.fingerprint).toMatch(/^[0-9a-f]+$/)

	const later = (await (await post('/api/orbital-mechanics/solve', { definition, center: EARTH, at: 2451545.25 })).json()) as OrbitSolveResponse
	expect(later.time).toBe(2451545.25)
	expect(later.fingerprint).toBe(atEpoch.fingerprint)
	expect(later.elements.equator.meanAnomaly!).toBeCloseTo((2 * Math.PI * 6) / later.elements.equator.period! / 24, 6)
	expect(later.diagnostics.specificEnergy).toBeCloseTo(atEpoch.diagnostics.specificEnergy, 14)
})

test('an open definition answers the arc it plays and has no period', async () => {
	const definition: OrbitDefinitionPayload = { kind: 'hyperbolic', mu: 2.959122082855911e-4, plane: 'ecliptic', periapsisDistance: 0.5, eccentricity: 1.5, inclination: 0.3, node: 1, argumentOfPeriapsis: 2, periapsisTime: 2451575 }
	const solution = (await finiteJson(await post('/api/orbital-mechanics/solve', { definition, center: { name: 'Sun', mu: definition.mu, radius: 0.00465, system: false } }))) as OrbitSolveResponse

	expect(solution.anchor).toBe(2451575)
	expect(solution.elements.ecliptic.period).toBeUndefined()
	expect(solution.elements.ecliptic.semiMajorAxis!).toBeCloseTo(-1, 12)
	expect(solution.arc!.start).toBeLessThan(2451575)
	expect(solution.arc!.end - 2451575).toBeCloseTo(2451575 - solution.arc!.start, 6)

	const at = (await (await post('/api/orbital-mechanics/solve', { definition, center: { name: 'Sun', mu: definition.mu, radius: 0.00465, system: false }, at: solution.arc!.end })).json()) as OrbitSolveResponse
	expect(at.diagnostics.radius).toBeCloseTo(20 * 0.5, 6)
})

test('a periapsis inside the center is warned and a rectilinear state is refused', async () => {
	const grazing: OrbitDefinitionPayload = { kind: 'elliptic', mu: EARTH.mu, plane: 'equator', semiMajorAxis: 8000 / AU_KM, eccentricity: 0.3, inclination: 0.5, node: 0, argumentOfPeriapsis: 0, meanAnomaly: Math.PI, epoch: 2451545 }
	const solution = (await (await post('/api/orbital-mechanics/solve', { definition: grazing, center: EARTH })).json()) as OrbitSolveResponse
	expect(solution.warnings).toEqual(['periapsisInsideCenter'])

	const radial = await post('/api/orbital-mechanics/solve', { definition: { kind: 'cartesian', mu: EARTH.mu, position: [1e-4, 0, 0], velocity: [1e-3, 0, 0], epoch: 2451545 }, center: EARTH })
	expect(radial.status).toBe(422)
	expect(await radial.json()).toEqual({ error: 'The position and velocity are parallel, so the motion is not a conic', code: 'degenerateOrbit' })
})

test('a trajectory crowds its states around periapsis and marks the apsides and nodes', async () => {
	const definition: OrbitDefinitionPayload = { kind: 'elliptic', mu: 2.959122082855911e-4, plane: 'ecliptic', semiMajorAxis: 10, eccentricity: 0.95, inclination: 0.5, node: 1, argumentOfPeriapsis: 2, meanAnomaly: 0, epoch: 2451545 }
	const period = 2 * Math.PI * Math.sqrt(1000 / definition.mu)
	const { curve, samples } = (await (await post('/api/orbital-mechanics/trajectory', { definition, start: 2451545 - period / 2, end: 2451545 + period / 2, plane: 'ecliptic' })).json()) as OrbitTrajectoryResponse

	expect(curve.markers.map((e) => e.kind)).toEqual(['periapsis', 'apoapsis', 'ascendingNode', 'descendingNode'])
	expect(curve.points.at(-1)).toEqual(curve.points[0])
	expect(samples.truncated).toBeFalse()
	const near = samples.times.filter((e) => Math.abs(e - 2451545) < period / 20).length
	const far = samples.times.filter((e) => Math.abs(e - 2451545) > (period * 9) / 20).length
	expect(near).toBeGreaterThan(far)
})
