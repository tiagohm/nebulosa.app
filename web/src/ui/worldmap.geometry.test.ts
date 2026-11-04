import { describe, expect, test } from 'bun:test'
import {
	constrainWorldMapView,
	DEGREE_PLANE_TRANSFORM,
	formatGeoPoint,
	geoPath,
	graticulePath,
	horizonCurve,
	horizonRegionPath,
	interpolateWorldMapView,
	MAX_WORLD_MAP_ZOOM,
	minWorldMapScale,
	panWorldMap,
	project,
	smallCirclePoints,
	smallCircleRegionPath,
	splitAtAntimeridian,
	unproject,
	WORLD_MAP_HEIGHT,
	WORLD_MAP_HOME,
	WORLD_MAP_WIDTH,
	worldMapTransform,
	wrapLongitude,
	zoomWorldMapAt,
} from './worldmap.geometry'

const VIEWPORT = { width: 1000, height: 800 }

describe('projection', () => {
	test('maps the corners and the center', () => {
		expect(project(-180, 90)).toEqual({ x: 0, y: 0 })
		expect(project(180, -90).x).toBeCloseTo(WORLD_MAP_WIDTH, 9)
		expect(project(180, -90).y).toBeCloseTo(WORLD_MAP_HEIGHT, 9)
		expect(project(0, 0).x).toBeCloseTo(WORLD_MAP_WIDTH / 2, 9)
		expect(project(0, 0).y).toBeCloseTo(WORLD_MAP_HEIGHT / 2, 9)
	})

	test('round trips and wraps the longitude', () => {
		const point = unproject(project(-46.6333, -23.5505))
		expect(point.longitude).toBeCloseTo(-46.6333, 9)
		expect(point.latitude).toBeCloseTo(-23.5505, 9)
		expect(unproject(project(190, 0)).longitude).toBeCloseTo(-170, 9)
		expect(unproject({ x: 0, y: -10 }).latitude).toBe(90)
	})

	test('wraps longitudes into [-180, 180)', () => {
		expect(wrapLongitude(180)).toBe(-180)
		expect(wrapLongitude(-190)).toBe(170)
		expect(wrapLongitude(370)).toBe(10)
	})
})

describe('geoPath', () => {
	test('is empty without points', () => {
		expect(geoPath([])).toBe('')
	})

	test('unwraps across the antimeridian by default', () => {
		const path = geoPath([
			{ longitude: 170, latitude: 0 },
			{ longitude: -170, latitude: 0 },
		])
		expect(path).toBe(`M${Math.round(project(170, 0).x * 1000) / 1000} 630.158L${Math.round(project(190, 0).x * 1000) / 1000} 630.158`)
	})

	test('splits across the antimeridian and closes', () => {
		const points = [
			{ longitude: 170, latitude: 10 },
			{ longitude: -170, latitude: 10 },
			{ longitude: -160, latitude: 0 },
		]
		expect(geoPath(points, { antimeridian: 'split' }).match(/M/g)).toHaveLength(2)
		expect(geoPath(points, { closed: true, antimeridian: 'split' })).toEndWith('Z')
		expect(geoPath(points, { closed: true, antimeridian: 'split' }).match(/ZM/g)).toHaveLength(1)
	})
})

describe('horizon', () => {
	test('the terminator of a solstice Sun', () => {
		const curve = horizonCurve({ longitude: 0, latitude: 23.44 }, 90)
		expect(curve.map((p) => p.longitude)).toEqual([-180, -90, 0, 90, 180])
		expect(curve[2].latitude).toBeCloseTo(-66.56, 9)
		expect(curve[3].latitude).toBeCloseTo(0, 9)
		expect(curve[0].latitude).toBeCloseTo(66.56, 9)
	})

	test('an equinox Sun gives the meridians 90° away', () => {
		const curve = horizonCurve({ longitude: 0, latitude: 0 }, 1)
		expect(curve[0].latitude).toBeCloseTo(90, 1)
		expect(curve[180].latitude).toBeCloseTo(-90, 1)
	})

	test('closes the night side over the pole without the Sun', () => {
		const night = horizonRegionPath({ longitude: 0, latitude: 23.44 }, 'below')
		expect(night).toEndWith(`L${WORLD_MAP_WIDTH} ${WORLD_MAP_HEIGHT}L0 ${WORLD_MAP_HEIGHT}Z`)
		const day = horizonRegionPath({ longitude: 0, latitude: 23.44 }, 'above')
		expect(day).toEndWith(`L${WORLD_MAP_WIDTH} 0L0 0Z`)
		const southern = horizonRegionPath({ longitude: 0, latitude: -10 }, 'below')
		expect(southern).toEndWith(`L${WORLD_MAP_WIDTH} 0L0 0Z`)
	})
})

describe('antimeridian', () => {
	test('a line that never crosses it stays one piece', () => {
		const points = [
			{ longitude: -10, latitude: 0 },
			{ longitude: 10, latitude: 20 },
		]
		expect(splitAtAntimeridian(points)).toEqual([points])
		expect(splitAtAntimeridian([])).toEqual([])
	})

	test('both pieces of a crossing meet at ±180°', () => {
		const pieces = splitAtAntimeridian([
			{ longitude: 170, latitude: 0 },
			{ longitude: -170, latitude: 20 },
			{ longitude: -160, latitude: 30 },
			{ longitude: 175, latitude: 40 },
		])
		expect(pieces).toHaveLength(3)
		expect(pieces[0]).toEqual([
			{ longitude: 170, latitude: 0 },
			{ longitude: 180, latitude: 10 },
		])
		expect(pieces[1][0]).toEqual({ longitude: -180, latitude: 10 })
		expect(pieces[1].at(-1)!.longitude).toBe(-180)
		expect(pieces[1].at(-1)!.latitude).toBeCloseTo(30 + (20 / 25) * 10, 9)
		expect(pieces[2][0].longitude).toBe(180)
		expect(pieces[2][1]).toEqual({ longitude: 175, latitude: 40 })
	})
})

describe('small circle', () => {
	test('a cap on the equator is closed and symmetric', () => {
		const points = smallCirclePoints({ longitude: 0, latitude: 0 }, 20, 90)
		expect(points).toHaveLength(5)
		expect(points[0].latitude).toBeCloseTo(20, 9)
		expect(points[0].longitude).toBeCloseTo(0, 9)
		expect(points[1].longitude).toBeCloseTo(20, 9)
		expect(points[2].latitude).toBeCloseTo(-20, 9)
		expect(points[3].longitude).toBeCloseTo(-20, 9)
		expect(points[4]).toEqual(points[0])
		const region = smallCircleRegionPath({ longitude: 0, latitude: 0 }, 20)
		expect(region).toStartWith('M')
		expect(region).toEndWith('Z')
		expect(region.match(/M/g)).toHaveLength(1)
	})

	test('a cap across the antimeridian is unwrapped', () => {
		const region = smallCircleRegionPath({ longitude: 175, latitude: 0 }, 20, 90)
		expect(region).toContain(`${Math.round(project(195, 0).x * 1000) / 1000} `)
	})

	test('a radius of 90° is the horizon of the center', () => {
		const center = { longitude: 30, latitude: 23.44 }
		for (const point of smallCirclePoints(center, 90, 7)) {
			const expected = Math.atan(-Math.cos((point.longitude - center.longitude) * (Math.PI / 180)) / Math.tan(center.latitude * (Math.PI / 180))) * (180 / Math.PI)
			expect(point.latitude).toBeCloseTo(expected, 6)
		}
	})

	test('a cap holding a pole is closed along that edge of the map', () => {
		// The boundary runs once around the globe, then along the pole's edge back to its start.
		const closing = (path: string) => [...path.matchAll(/L([\d.-]+) ([\d.-]+)/g)].slice(-2).map((match) => ({ x: +match[1], y: +match[2] }))
		const north = closing(smallCircleRegionPath({ longitude: 10, latitude: 80 }, 20))
		expect(north.map((point) => point.y)).toEqual([0, 0])
		expect(Math.abs(north[0].x - north[1].x)).toBeCloseTo(WORLD_MAP_WIDTH, 2)
		const south = closing(smallCircleRegionPath({ longitude: 10, latitude: -80 }, 20))
		expect(south.map((point) => point.y)).toEqual([WORLD_MAP_HEIGHT, WORLD_MAP_HEIGHT].map((y) => Math.round(y * 1000) / 1000))
		expect(Math.abs(south[0].x - south[1].x)).toBeCloseTo(WORLD_MAP_WIDTH, 2)
		// The lowest latitude of the northern cap is 60°, at the center's meridian.
		const points = smallCirclePoints({ longitude: 10, latitude: 80 }, 20, 1)
		expect(Math.min(...points.map((point) => point.latitude))).toBeCloseTo(60, 9)
	})
})

test('graticule lines', () => {
	const path = graticulePath(30)
	expect(path.match(/V/g)).toHaveLength(11)
	expect(path.match(/H/g)).toHaveLength(5)
	const wrapped = graticulePath(30, true)
	expect(wrapped.match(/V/g)).toHaveLength(12)
	expect(wrapped.startsWith('M0 0V')).toBeTrue()
})

test('formats a position', () => {
	expect(formatGeoPoint({ longitude: -46.6333, latitude: -23.5505 })).toBe('23.5505° S  46.6333° W')
	expect(formatGeoPoint({ longitude: 2.35, latitude: 48.86 })).toBe('48.8600° N  2.3500° E')
})

describe('view', () => {
	test('smallest scale fits the width when wrapping and the whole map otherwise', () => {
		expect(minWorldMapScale(VIEWPORT, true)).toBeCloseTo(1000 / WORLD_MAP_WIDTH, 12)
		expect(minWorldMapScale({ width: 3000, height: 800 }, false)).toBeCloseTo(800 / WORLD_MAP_HEIGHT, 12)
		expect(minWorldMapScale({ width: 0, height: 800 }, true)).toBe(0)
	})

	test('centers a map smaller than the viewport and clamps the zoom', () => {
		const view = constrainWorldMapView({ zoom: 0.5, center: { x: 10, y: 10 } }, VIEWPORT, false)
		expect(view.zoom).toBe(1)
		expect(view.center).toEqual({ x: WORLD_MAP_WIDTH / 2, y: WORLD_MAP_HEIGHT / 2 })
		expect(constrainWorldMapView({ zoom: 1000, center: view.center }, VIEWPORT, false).zoom).toBe(MAX_WORLD_MAP_ZOOM)
	})

	test('wraps the center of a wrapping map and clamps it otherwise', () => {
		const center = { x: -100, y: 0 }
		expect(constrainWorldMapView({ zoom: 8, center }, VIEWPORT, true).center.x).toBeCloseTo(WORLD_MAP_WIDTH - 100, 9)
		const clamped = constrainWorldMapView({ zoom: 8, center }, VIEWPORT, false)
		const scale = minWorldMapScale(VIEWPORT, false) * 8
		expect(clamped.center.x).toBeCloseTo(VIEWPORT.width / 2 / scale, 9)
		expect(clamped.center.y).toBeCloseTo(VIEWPORT.height / 2 / scale, 9)
	})

	test('zooming keeps the point under the cursor', () => {
		const view = { zoom: 4, center: project(-46, -23) }
		const at = { x: 300, y: 200 }
		const before = worldMapTransform(view, VIEWPORT, true)
		const after = worldMapTransform(zoomWorldMapAt(view, 2, at, VIEWPORT, true), VIEWPORT, true)
		expect((at.x - after.x) / after.scale).toBeCloseTo((at.x - before.x) / before.scale, 9)
		expect((at.y - after.y) / after.scale).toBeCloseTo((at.y - before.y) / before.scale, 9)
	})

	test('panning moves the map with the pointer', () => {
		const view = { zoom: 4, center: project(0, 0) }
		const moved = panWorldMap(view, 100, 50, VIEWPORT, true)
		const scale = minWorldMapScale(VIEWPORT, true) * 4
		expect(moved.center.x).toBeCloseTo(view.center.x - 100 / scale, 9)
		expect(moved.center.y).toBeCloseTo(view.center.y - 50 / scale, 9)
	})

	test('interpolates the shorter way around and the zoom geometrically', () => {
		const from = { zoom: 1, center: { x: 100, y: 600 } }
		const to = { zoom: 4, center: { x: WORLD_MAP_WIDTH - 100, y: 600 } }
		const half = interpolateWorldMapView(from, to, 0.5, true)
		expect(half.zoom).toBeCloseTo(2, 12)
		expect(half.center.x).toBeCloseTo(0, 9)
		expect(interpolateWorldMapView(from, to, 0.5, false).center.x).toBeCloseTo(WORLD_MAP_WIDTH / 2, 9)
		expect(interpolateWorldMapView(WORLD_MAP_HOME, to, 1, true).center).toEqual(to.center)
	})
})

describe('degree plane', () => {
	test('maps the degree plane of the API onto the map units of project', () => {
		const [sx, sy] = DEGREE_PLANE_TRANSFORM.match(/scale\((\S+) (\S+)\)/)!
			.slice(1)
			.map(Number)

		for (const [longitude, latitude] of [
			[-180, 90],
			[0, 0],
			[180, -90],
			[-46.6, -23.5],
		]) {
			const point = project(longitude, latitude)
			expect((longitude + 180) * sx).toBeCloseTo(point.x, 9)
			expect((90 - latitude) * sy).toBeCloseTo(point.y, 9)
		}
	})
})
