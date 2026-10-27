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
