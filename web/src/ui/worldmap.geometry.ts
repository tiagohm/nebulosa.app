import { DEG2RAD, RAD2DEG } from 'nebulosa/src/core/constants'
import type { Point, Size, ViewTransform } from '../viewer/transform'

// Geometry of the world map: the equirectangular projection of web/assets/world.map.svg between geographic
// coordinates and map units, SVG path data of geographic lines and regions (eclipse paths, visibility
// limits, the day and night hemispheres), and the zoom and pan of the map in a viewport. Map units are the
// pixels of the SVG's view box, with the origin at longitude −180°, latitude +90° (the top-left corner), x
// growing east and y south. Geographic coordinates are in degrees, longitude east positive.

// Geographic position, in degrees.
export interface GeoPoint {
	// Longitude, in degrees, east positive; a path may continue past ±180° to cross the antimeridian.
	readonly longitude: number
	// Latitude, in degrees, north positive, in [−90, 90].
	readonly latitude: number
}

// Width of the map, in map units, spanning 360° of longitude.
export const WORLD_MAP_WIDTH = 2520.631

// Height of the map, in map units, spanning 180° of latitude.
export const WORLD_MAP_HEIGHT = 1260.315

// Map units per degree of longitude.
const UNITS_PER_LONGITUDE = WORLD_MAP_WIDTH / 360

// Map units per degree of latitude; equal to that of longitude up to the rounding of the SVG's size.
const UNITS_PER_LATITUDE = WORLD_MAP_HEIGHT / 180

// SVG transform from the degree plane to map units. On the degree plane x = longitude + 180 in [0, 360] and y = 90 −
// latitude in [0, 180], in degrees: the API draws eclipse paths on it, so they need not know the size of the map.
export const DEGREE_PLANE_TRANSFORM = `scale(${UNITS_PER_LONGITUDE} ${UNITS_PER_LATITUDE})`

// Largest zoom, as a multiple of the smallest one, which shows the whole map.
export const MAX_WORLD_MAP_ZOOM = 64

// Zoom and pan of the map as its owner keeps it: the zoom and the map point at the viewport center. Keeping
// the center in map units keeps the same place centered when the viewport is resized.
export interface WorldMapView {
	// Multiple of the smallest scale, in [1, MAX_WORLD_MAP_ZOOM].
	readonly zoom: number
	// Map point at the viewport center, in map units.
	readonly center: Point
}

// View showing the whole map, centered on longitude 0°, latitude 0°.
export const WORLD_MAP_HOME: WorldMapView = { zoom: 1, center: { x: WORLD_MAP_WIDTH / 2, y: WORLD_MAP_HEIGHT / 2 } }

// Returns the map point of a geographic position. Longitudes beyond ±180° are not wrapped, so a path
// crossing the antimeridian stays continuous past the map's edge.
export function project(longitude: number, latitude: number): Point {
	return { x: (longitude + 180) * UNITS_PER_LONGITUDE, y: (90 - latitude) * UNITS_PER_LATITUDE }
}

// Returns the geographic position of a map point, the longitude wrapped into [−180, 180) and the latitude
// clamped to [−90, 90].
export function unproject(point: Point): GeoPoint {
	return { longitude: wrapLongitude(point.x / UNITS_PER_LONGITUDE - 180), latitude: Math.max(-90, Math.min(90, 90 - point.y / UNITS_PER_LATITUDE)) }
}

// Returns a longitude, in degrees, wrapped into [−180, 180).
export function wrapLongitude(longitude: number): number {
	return modulo(longitude + 180, 360) - 180
}

// Returns the non-negative remainder of a by b.
function modulo(a: number, b: number): number {
	return ((a % b) + b) % b
}

// Returns a map coordinate rounded to a thousandth of a map unit, enough at the largest zoom.
function round(value: number): number {
	return Math.round(value * 1000) / 1000
}

// How geoPath treats a step of more than 180° in longitude between consecutive points.
export type AntimeridianMode = 'unwrap' | 'split'

// Options of geoPath.
export interface GeoPathOptions {
	// Whether the path is closed into a region.
	readonly closed?: boolean
	// unwrap (the default) continues the path past ±180° so it crosses the antimeridian as a single line, which a
	// wrapping map draws again on the other side; split starts a new subpath there instead, for a map that
	// does not wrap. A split path is meant for lines: closing it closes each piece.
	readonly antimeridian?: AntimeridianMode
}

// Returns the SVG path data, in map units, of a line through geographic points, assuming each step between
// consecutive points is the shorter way around the globe. Empty for no points.
export function geoPath(points: readonly GeoPoint[], { closed = false, antimeridian = 'unwrap' }: GeoPathOptions = {}): string {
	let path = ''
	let previous: number | undefined
	let longitude = 0

	for (const point of points) {
		let command = 'L'

		if (previous === undefined) {
			command = 'M'
			longitude = point.longitude
		} else {
			const step = point.longitude - previous

			if (antimeridian === 'unwrap') {
				longitude += wrapLongitude(step)
			} else {
				if (Math.abs(step) > 180) command = closed ? 'ZM' : 'M'
				longitude = point.longitude
			}
		}

		previous = point.longitude
		const { x, y } = project(longitude, point.latitude)
		path += `${command}${round(x)} ${round(y)}`
	}

	return closed && path ? `${path}Z` : path
}

// Side of the horizon of a body.
export type HorizonSide = 'above' | 'below'

// Smallest declination used for the horizon, in degrees: at exactly 0° the boundary is two meridians, which the
// per-longitude curve cannot draw, and 10⁻⁴° moves it by far less than a map unit.
const MIN_HORIZON_DECLINATION = 1e-4

// Returns the latitudes, in degrees, of the boundary between where a body is above and below the horizon (its
// altitude 0°, without refraction), at each longitude from −180° to 180° in steps of step degrees, given the
// geographic position right under it (the subsolar or sublunar point).
export function horizonCurve(subpoint: GeoPoint, step: number = 1): GeoPoint[] {
	const declination = Math.abs(subpoint.latitude) < MIN_HORIZON_DECLINATION ? (subpoint.latitude < 0 ? -1 : 1) * MIN_HORIZON_DECLINATION : subpoint.latitude
	const tangent = Math.tan(declination * DEG2RAD)
	const count = Math.max(1, Math.ceil(360 / step))
	const curve = new Array<GeoPoint>(count + 1)

	for (let i = 0; i <= count; i++) {
		const longitude = -180 + (360 * i) / count
		const latitude = Math.atan(-Math.cos((longitude - subpoint.longitude) * DEG2RAD) / tangent) * RAD2DEG
		curve[i] = { longitude, latitude }
	}

	return curve
}

// Returns the SVG path data, in map units, of the region of the whole map where a body is above or below the
// horizon, given the geographic position right under it: below the horizon of the Sun is the night side, above
// the horizon of the Moon is where a lunar eclipse is visible. step is the longitude step of the boundary, in
// degrees.
export function horizonRegionPath(subpoint: GeoPoint, side: HorizonSide, step: number = 1): string {
	const curve = horizonCurve(subpoint, step)
	// The pole on the body's side of the equator sees it above the horizon.
	const northAbove = subpoint.latitude >= 0
	const pole = (side === 'above') === northAbove ? 90 : -90
	const y = round(project(0, pole).y)
	return `${geoPath(curve)}L${round(WORLD_MAP_WIDTH)} ${y}L0 ${y}Z`
}

// Returns the SVG path data, in map units, of meridians and parallels every spacing degrees, the equator and
// the prime meridian included. spacing is in (0, 90]. The antimeridian is drawn only when the map wraps (wrap), once at
// its western edge, where it is the seam between a copy and the next; otherwise it is the border of the map.
export function graticulePath(spacing: number, wrap: boolean = false): string {
	let path = ''

	for (let longitude = wrap ? -180 : -180 + spacing; longitude < 180; longitude += spacing) {
		const x = round(project(longitude, 0).x)
		path += `M${x} 0V${round(WORLD_MAP_HEIGHT)}`
	}

	for (let latitude = 90 - spacing; latitude > -90; latitude -= spacing) {
		const y = round(project(0, latitude).y)
		path += `M0 ${y}H${round(WORLD_MAP_WIDTH)}`
	}

	return path
}

// Returns the smallest scale of the map in a viewport, in viewport pixels per map unit: the whole width when the
// map wraps, so the copies always cover the viewport, otherwise the whole map. Zero for an empty viewport.
export function minWorldMapScale(viewport: Size, wrap: boolean): number {
	if (viewport.width <= 0 || viewport.height <= 0) return 0
	const width = viewport.width / WORLD_MAP_WIDTH
	return wrap ? width : Math.min(width, viewport.height / WORLD_MAP_HEIGHT)
}

// Returns a center coordinate kept inside the map along one axis: centered when the map is shorter than the
// viewport along it, otherwise clamped so the map covers the viewport. half is half the viewport, in map units.
function clampCenter(center: number, half: number, length: number): number {
	return length <= 2 * half ? length / 2 : Math.max(half, Math.min(length - half, center))
}

// Returns a view restricted to a viewport: the zoom within [1, MAX_WORLD_MAP_ZOOM], and the center clamped so
// no area outside the map is shown, except to center a map smaller than the viewport. A wrapping map's center
// longitude is wrapped instead of clamped.
export function constrainWorldMapView(view: WorldMapView, viewport: Size, wrap: boolean): WorldMapView {
	const zoom = Math.max(1, Math.min(MAX_WORLD_MAP_ZOOM, view.zoom))
	const scale = minWorldMapScale(viewport, wrap) * zoom
	if (scale <= 0) return { zoom, center: view.center }
	const x = wrap ? modulo(view.center.x, WORLD_MAP_WIDTH) : clampCenter(view.center.x, viewport.width / 2 / scale, WORLD_MAP_WIDTH)
	const y = clampCenter(view.center.y, viewport.height / 2 / scale, WORLD_MAP_HEIGHT)
	return { zoom, center: { x, y } }
}

// Returns the transform from map units to viewport pixels of a view.
export function worldMapTransform(view: WorldMapView, viewport: Size, wrap: boolean): ViewTransform {
	const scale = minWorldMapScale(viewport, wrap) * view.zoom
	return { scale, x: viewport.width / 2 - view.center.x * scale, y: viewport.height / 2 - view.center.y * scale }
}

// Returns the view zoomed by factor around a viewport point, which keeps showing the same map point, constrained.
export function zoomWorldMapAt(view: WorldMapView, factor: number, at: Point, viewport: Size, wrap: boolean): WorldMapView {
	const before = worldMapTransform(view, viewport, wrap)
	if (before.scale <= 0) return view
	const zoom = Math.max(1, Math.min(MAX_WORLD_MAP_ZOOM, view.zoom * factor))
	const scale = minWorldMapScale(viewport, wrap) * zoom
	const mapX = (at.x - before.x) / before.scale
	const mapY = (at.y - before.y) / before.scale
	const center = { x: mapX - (at.x - viewport.width / 2) / scale, y: mapY - (at.y - viewport.height / 2) / scale }
	return constrainWorldMapView({ zoom, center }, viewport, wrap)
}

// Returns the view moved by a distance in viewport pixels, the map following the pointer, constrained.
export function panWorldMap(view: WorldMapView, dx: number, dy: number, viewport: Size, wrap: boolean): WorldMapView {
	const scale = minWorldMapScale(viewport, wrap) * view.zoom
	if (scale <= 0) return view
	return constrainWorldMapView({ zoom: view.zoom, center: { x: view.center.x - dx / scale, y: view.center.y - dy / scale } }, viewport, wrap)
}

// Returns the view at fraction t in [0, 1] of the way from one view to another: the zoom interpolated
// geometrically, so it changes at a steady rate, and the center linearly, the shorter way around a wrapping map.
export function interpolateWorldMapView(from: WorldMapView, to: WorldMapView, t: number, wrap: boolean): WorldMapView {
	let dx = to.center.x - from.center.x
	if (wrap) dx = modulo(dx + WORLD_MAP_WIDTH / 2, WORLD_MAP_WIDTH) - WORLD_MAP_WIDTH / 2
	const zoom = from.zoom * (to.zoom / from.zoom) ** t
	return { zoom, center: { x: from.center.x + dx * t, y: from.center.y + (to.center.y - from.center.y) * t } }
}

// Returns a latitude and longitude, in degrees, as text with two decimals and the hemispheres, such as
// 23.5567° S 46.6321° W.
export function formatGeoPoint({ longitude, latitude }: GeoPoint): string {
	return `${Math.abs(latitude).toFixed(4)}° ${latitude < 0 ? 'S' : 'N'}  ${Math.abs(longitude).toFixed(4)}° ${longitude < 0 ? 'W' : 'E'}`
}
