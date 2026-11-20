import { describe, expect, test } from 'bun:test'
import {
	constrainWorldMapView,
	DEGREE_PLANE_TRANSFORM,
	fitWorldMapView,
	geoBounds,
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
	smallCircleRegion,
	splitAtAntimeridian,
	unproject,
	WORLD_MAP_HEIGHT,
	WORLD_MAP_HOME,
	WORLD_MAP_WIDTH,
	worldMapShows,
	worldMapTransform,
	wrapLongitude,
	zoomWorldMapAt,
} from './worldmap.geometry'

const VIEWPORT = { width: 1000, height: 800 }

const round = (value: number) => Math.round(value * 1000) / 1000

const xs = (path: string) => [...path.matchAll(/[ML]([\d.-]+) /g)].map((match) => +match[1])

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
		const region = smallCircleRegion({ longitude: 0, latitude: 0 }, 20)
		expect(region.fill).toStartWith('M')
		expect(region.fill).toEndWith('Z')
		expect(region.fill.match(/M/g)).toHaveLength(1)
		expect(region.outline).toBe(region.fill)
	})

	test('a cap across the antimeridian is cut into a region at each edge of the map', () => {
		const region = smallCircleRegion({ longitude: 175, latitude: 0 }, 20)
		expect(region.fill.match(/M/g)).toHaveLength(2)
		expect(region.fill.match(/Z/g)).toHaveLength(2)
		expect(region.outline.match(/M/g)).toHaveLength(2)
		expect(region.outline).not.toContain('Z')
		expect(xs(region.fill)).toContain(0)
		expect(xs(region.fill)).toContain(round(WORLD_MAP_WIDTH))
	})

	test('a radius of 90° is the horizon of the center', () => {
		const center = { longitude: 30, latitude: 23.44 }
		for (const point of smallCirclePoints(center, 90, 7)) {
			const expected = Math.atan(-Math.cos((point.longitude - center.longitude) * (Math.PI / 180)) / Math.tan(center.latitude * (Math.PI / 180))) * (180 / Math.PI)
			expect(point.latitude).toBeCloseTo(expected, 6)
		}
	})

	test('a cap holding a pole is closed along that edge of the map', () => {
		// The boundary runs from one edge of the map to the other, then along the pole's edge back to its start.
		const closing = (path: string) => [...path.matchAll(/L([\d.-]+) ([\d.-]+)/g)].slice(-2).map((match) => ({ x: +match[1], y: +match[2] }))
		const north = smallCircleRegion({ longitude: 10, latitude: 80 }, 20)
		expect(closing(north.fill)).toEqual([
			{ x: 0, y: 0 },
			{ x: round(WORLD_MAP_WIDTH), y: 0 },
		])
		expect(north.outline).not.toContain('Z')
		const south = closing(smallCircleRegion({ longitude: 10, latitude: -80 }, 20).fill)
		expect(south.map((point) => point.y)).toEqual([round(WORLD_MAP_HEIGHT), round(WORLD_MAP_HEIGHT)])
		expect(Math.abs(south[0].x - south[1].x)).toBeCloseTo(WORLD_MAP_WIDTH, 2)
		// The lowest latitude of the northern cap is 60°, at the center's meridian.
		const points = smallCirclePoints({ longitude: 10, latitude: 80 }, 20, 1)
		expect(Math.min(...points.map((point) => point.latitude))).toBeCloseTo(60, 9)
	})

	test('a cap is drawn within the map, so no neighboring copy of a wrapping map covers part of it', () => {
		for (const [latitude, radius] of [
			[75, 30],
			[-75, 30],
			[50, 41],
			[0, 20],
			[60, 10],
		]) {
			for (let longitude = -180; longitude <= 180; longitude += 15) {
				const region = smallCircleRegion({ longitude, latitude }, radius)
				for (const path of [region.fill, region.outline]) {
					expect(Math.min(...xs(path))).toBeGreaterThanOrEqual(0)
					expect(Math.max(...xs(path))).toBeLessThanOrEqual(round(WORLD_MAP_WIDTH))
				}
			}
		}
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

describe('fit', () => {
	const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 }

	test('bounds take longitudes the shorter way around', () => {
		expect(geoBounds([])).toBeUndefined()
		expect(
			geoBounds([
				{ longitude: -40, latitude: -10 },
				{ longitude: 20, latitude: 30 },
				{ longitude: 0, latitude: 5 },
			]),
		).toEqual({ west: -40, east: 20, south: -10, north: 30 })
		const pacific = geoBounds([
			{ longitude: 170, latitude: 0 },
			{ longitude: -170, latitude: 10 },
			{ longitude: 175, latitude: -5 },
		])!
		expect(pacific.west).toBe(170)
		expect(pacific.east).toBe(190)
		expect(geoBounds([{ longitude: 190, latitude: 0 }])).toEqual({ west: -170, east: -170, south: 0, north: 0 })
	})

	test('frames a box whole and centered in the padded viewport', () => {
		const bounds = { west: -60, east: 0, south: -40, north: 0 }
		const padding = { top: 10, right: 60, bottom: 30, left: 20 }
		const view = fitWorldMapView(bounds, VIEWPORT, true, padding)
		const { scale, x, y } = worldMapTransform(view, VIEWPORT, true)
		const a = project(bounds.west, bounds.north)
		const b = project(bounds.east, bounds.south)
		const left = x + a.x * scale
		const right = x + b.x * scale
		const top = y + a.y * scale
		const bottom = y + b.y * scale
		expect(left).toBeGreaterThanOrEqual(padding.left - 1e-6)
		expect(right).toBeLessThanOrEqual(VIEWPORT.width - padding.right + 1e-6)
		expect(top).toBeGreaterThanOrEqual(padding.top - 1e-6)
		expect(bottom).toBeLessThanOrEqual(VIEWPORT.height - padding.bottom + 1e-6)
		// The tighter axis fills the padded area.
		expect(Math.max(right - left - (VIEWPORT.width - padding.left - padding.right), bottom - top - (VIEWPORT.height - padding.top - padding.bottom))).toBeCloseTo(0, 6)
		expect((left + right) / 2).toBeCloseTo((padding.left + VIEWPORT.width - padding.right) / 2, 6)
	})

	test('caps the zoom and never zooms out past the whole map', () => {
		expect(fitWorldMapView({ west: 10, east: 10.001, south: 0, north: 0.001 }, VIEWPORT, true, NO_PADDING, 8).zoom).toBe(8)
		expect(fitWorldMapView({ west: -180, east: 180, south: -90, north: 90 }, VIEWPORT, true, NO_PADDING).zoom).toBe(1)
	})

	test('tells whether a position is in view on any copy of a wrapping map', () => {
		const view = { zoom: 4, center: project(180, 0) }
		expect(worldMapShows(view, VIEWPORT, true, { longitude: -175, latitude: 0 })).toBeTrue()
		expect(worldMapShows(view, VIEWPORT, false, { longitude: -175, latitude: 0 })).toBeFalse()
		expect(worldMapShows(view, VIEWPORT, true, { longitude: 0, latitude: 0 })).toBeFalse()
		expect(worldMapShows(view, VIEWPORT, true, { longitude: 180, latitude: 60 })).toBeFalse()
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
