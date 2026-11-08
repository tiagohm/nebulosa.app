import { expect, test } from 'bun:test'
import { initialOrbitalMechanicsState, type OrbitTrack, type OrbitView } from './orbitalmechanics'
import { buildSceneModel, cameraOf, clipSegment, fitDistance, gridRings, pickOrbit, presetAngles, project, toDisplay } from './scene'

const VIEW: OrbitView = { yaw: 0, pitch: 0, distance: 10, target: [0, 0, 0], projection: 'perspective' }

test('the camera looks at its target, right-handed with +Z up', () => {
	// The eye is on +X looking at the origin, so +Y is to the right and +Z up on screen.
	const camera = cameraOf(VIEW, 800, 600)
	const center = project(camera, [0, 0, 0])!
	const y = project(camera, [0, 1, 0])!
	const z = project(camera, [0, 0, 1])!

	expect(center.x).toBeCloseTo(400, 9)
	expect(center.y).toBeCloseTo(300, 9)
	expect(center.depth).toBeCloseTo(10, 12)
	expect(y.x).toBeGreaterThan(400)
	expect(y.y).toBeCloseTo(300, 9)
	expect(z.y).toBeLessThan(300)
	expect(project(camera, [20, 0, 0])).toBeUndefined()
})

test('the top view puts +X right and +Y up, and orthographic keeps the target size', () => {
	const camera = cameraOf({ ...VIEW, ...presetAngles('top') }, 800, 600)
	const x = project(camera, [1, 0, 0])!
	const y = project(camera, [0, 1, 0])!
	expect(x.x).toBeGreaterThan(400)
	expect(y.y).toBeLessThan(300)

	const perspective = project(cameraOf(VIEW, 800, 600), [0, 1, 0])!
	const orthographic = project(cameraOf({ ...VIEW, projection: 'orthographic' }, 800, 600), [0, 1, 0])!
	expect(orthographic.x).toBeCloseTo(perspective.x, 9)
})

test('a face-on view looks along the plane normal', () => {
	const angles = presetAngles('normal', [0, -Math.SQRT1_2, Math.SQRT1_2])
	expect(angles.yaw).toBeCloseTo(-Math.PI / 2, 12)
	expect(angles.pitch).toBeCloseTo(Math.PI / 4, 12)
})

test('a segment crossing the near plane is cut there', () => {
	const camera = cameraOf(VIEW, 800, 600)
	const cut = clipSegment(camera, [0, 0, 0], [20, 0, 0])!
	expect(cut[1].depth).toBeGreaterThan(camera.near)
	expect(clipSegment(camera, [15, 0, 0], [20, 0, 0])).toBeUndefined()
})

test('the grid steps by 1, 2, or 5 times a power of ten', () => {
	expect(gridRings(10)).toEqual([2, 4, 6, 8, 10])
	expect(gridRings(0.0003)).toEqual([0.00005, 0.0001, 0.00015000000000000001, 0.0002, 0.00025, 0.00030000000000000003])
	expect(gridRings(0)).toEqual([])
	expect(fitDistance(1)).toBeGreaterThan(1)
})

test('the ecliptic display puts the ecliptic pole up', () => {
	// The ecliptic pole in J2000 equatorial axes: (0, −sin ε, cos ε).
	const obliquity = (23.4392911 * Math.PI) / 180
	const pole = toDisplay([0, -Math.sin(obliquity), Math.cos(obliquity)], 'ecliptic')
	expect(pole[2]).toBeCloseTo(1, 8)
	expect(toDisplay([1, 2, 3], 'equator')).toEqual([1, 2, 3])
})

test('the scene draws visible orbits with their body, and a click picks the nearest body', () => {
	const trajectory = {
		fingerprint: 'a',
		curve: { closed: true, points: [[1, 0, 0] as const, [0, 1, 0] as const, [-1, 0, 0] as const, [1, 0, 0] as const], markers: [], truncated: false },
		samples: { times: [0, 1], positions: [[1, 0, 0] as const, [0, 1, 0] as const], velocities: [[0, 1.5, 0] as const, [-1.5, 0, 0] as const], truncated: false },
	}
	const track: OrbitTrack = { key: 'a', start: 0, end: 1, periodic: false, trajectory }
	const state = { ...initialOrbitalMechanicsState(), time: 0, selected: 'a' }
	const draft = {
		kind: 'elliptic' as const,
		plane: 'equator' as const,
		semiMajorAxis: 1,
		eccentricity: 0,
		periapsisDistance: 1,
		hyperbolicEccentricity: 1.5,
		inclination: 0,
		node: 0,
		argumentOfPeriapsis: 0,
		meanAnomaly: 0,
		epoch: 0,
		periapsisTime: 0,
		position: [0, 0, 0] as [number, number, number],
		velocity: [0, 0, 0] as [number, number, number],
	}
	state.orbits = [
		{ id: 'a', name: 'A', color: 0, visible: true, draft, source: { kind: 'manual' }, track, loading: false },
		{ id: 'b', name: 'B', color: 1, visible: false, draft, source: { kind: 'manual' }, track, loading: false },
	]
	const model = buildSceneModel(state)

	expect(model.orbits.map((e) => e.id)).toEqual(['a'])
	expect(model.orbits[0].body).toEqual([1, 0, 0])
	expect(model.orbits[0].velocity![1]).toBeGreaterThan(0)
	expect(model.extent).toBe(1)

	const camera = cameraOf({ ...VIEW, ...presetAngles('top') }, 800, 600)
	const body = project(camera, [1, 0, 0])!
	expect(pickOrbit(camera, model, body.x + 3, body.y - 2)).toBe('a')
	expect(pickOrbit(camera, model, body.x + 40, body.y)).toBeUndefined()
})
