import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { sphericalDestination, sphericalSeparation } from 'nebulosa/src/math/numerical/geometry'
import type { SkySelection } from '../sky/sky'
import type { Point, Size } from '../viewer/transform'
import { pointAt, type SkyOffset, skyAt, skyOffset } from './wcs'

// Astrometric measurements and markers drawn over a solved image, kept as points in viewer coordinates (image pixels,
// origin at the top-left corner of the first pixel), never as sky positions: their sky values are computed again from
// whichever solution is selected, so changing it keeps what was pointed at and never shows a stale value. A point the
// selected solution cannot unproject makes the values unavailable, never 0. Each kind has an explicit geometric meaning:
// a distance is the great circle between two points; a rectangle is axis-aligned in image pixels (not in right
// ascension and declination), measured along its sides, centre lines, and diagonals; a circle has a constant angular
// radius on the sky around its centre, so its outline is projected through the WCS and may look elliptical. A target's
// offset is measured from the solved centre of the image along the great circle towards it. This module
// holds the pure parts: the values, the outlines, the hit tests in screen-constant radii, and the reducer of the
// drawing and editing gestures, which the image viewer routes to it while a mode or the Plate Solver tool owns them.

// Kind of measurement: an angular distance, a rectangle of the image, or a circle on the sky.
export type MeasurementKind = 'distance' | 'rectangle' | 'circle'

// Measurement of an image, defined by two points in viewer coordinates: the ends of a distance, opposite corners of a
// rectangle, or the centre (a) and a point of the rim (b) of a circle.
export interface Measurement {
	// Stable identity.
	readonly id: string
	// Kind of measurement.
	readonly kind: MeasurementKind
	// First point, in viewer coordinates.
	readonly a: Point
	// Second point, in viewer coordinates.
	readonly b: Point
	// Name given by the operator; absent for the default one.
	readonly label?: string
	// Whether it is drawn.
	readonly visible: boolean
}

// Fixed point of an image.
export interface AstrometricMarker {
	// Stable identity.
	readonly id: string
	// Point, in viewer coordinates.
	readonly point: Point
	// Name given by the operator; absent for the default one.
	readonly label?: string
	// Whether it is drawn.
	readonly visible: boolean
}

// Target whose offset from the solved centre of an image is shown: a marker of the image (located with the selected
// solution), a position typed in the frame of the solution, or a catalog object selected in Sky (its J2000 catalog
// position, at epoch J2000.0, without proper motion). Moving bodies are not targets: their position depends on the
// time and place of the observation.
export type AstrometryTarget = { readonly source: 'marker'; readonly markerId: string } | { readonly source: 'manual'; readonly rightAscension: number; readonly declination: number } | { readonly source: 'sky'; readonly name: string; readonly rightAscension: number; readonly declination: number }

// Returns the target of the Sky selection, or why it cannot be one: only a catalog object has a fixed J2000 position.
export function catalogTarget(selection: Pick<SkySelection, 'ref' | 'name' | 'catalog'> | undefined): AstrometryTarget | string {
	if (!selection) return 'Select a star or a deep-sky object in Sky first.'
	if (selection.ref.kind !== 'catalog') return 'Only stars and deep-sky objects of the catalog have a fixed J2000 position; solar-system bodies, minor bodies, constellations, and the mount cannot be targets.'
	if (!selection.catalog) return 'The catalog position of the selection is loading.'
	return { source: 'sky', name: selection.name, rightAscension: selection.catalog.rightAscension, declination: selection.catalog.declination }
}

// Offset of a target from the solved centre of an image.
export interface TargetOffsetValues {
	// Sky position of the centre of the image, [right ascension, declination] in radians.
	readonly center: readonly [number, number]
	// Offset from the centre to the target: separation, position angle, and east and north standard coordinates.
	readonly offset: SkyOffset
	// Position of the target in viewer coordinates; absent when it is outside the image or cannot be projected.
	readonly pixel?: Point
	// Unit direction in viewer coordinates from the centre towards a target outside the image, the projection of the
	// start of the great circle towards it; absent when the target is inside the image or the direction is undefined.
	readonly direction?: Point
}

// Returns the J2000 position of a target in radians, in the frame of the solution: a marker located with the solution,
// or the position it holds; undefined without a target, or when its marker is gone or cannot be located.
export function targetPosition(target: AstrometryTarget | undefined, markers: readonly AstrometricMarker[], solution: FitsHeader | undefined): readonly [number, number] | undefined {
	if (!target) return undefined
	if (target.source !== 'marker') return [target.rightAscension, target.declination]
	const marker = markers.find((m) => m.id === target.markerId)
	return marker && solution ? skyAt(solution, marker.point) : undefined
}

// Separation of the point projected to find the direction of a target outside the image, radians (about 20″).
const DIRECTION_STEP = 1e-4

// Returns the offset of a target (radians) from the centre of an image of a size through a solution; undefined when the
// solution cannot unproject the centre. The target is placed on the image only when it projects inside it; otherwise
// only the direction towards it is given, never a position off the image.
export function targetOffset(solution: FitsHeader, image: Size, target: readonly [number, number]): TargetOffsetValues | undefined {
	const middle = { x: image.width / 2, y: image.height / 2 }
	const center = skyAt(solution, middle)
	if (!center) return undefined

	const offset = skyOffset(center, target)
	const projected = offset.east !== undefined ? pointAt(solution, target[0], target[1]) : undefined
	if (projected && projected.x >= 0 && projected.x <= image.width && projected.y >= 0 && projected.y <= image.height) return { center, offset, pixel: projected }
	if (offset.positionAngle === undefined) return { center, offset }

	const [ra, dec] = sphericalDestination(center[0], center[1], offset.positionAngle, Math.min(DIRECTION_STEP, offset.separation / 2))
	const toward = pointAt(solution, ra, dec)
	const length = toward && Math.hypot(toward.x - middle.x, toward.y - middle.y)
	return { center, offset, ...(toward && length && { direction: { x: (toward.x - middle.x) / length, y: (toward.y - middle.y) / length } }) }
}

// What a gesture creates while it owns the pointer: nothing (the viewer pans), a measurement of a kind, or a marker.
export type AstrometryMode = 'pan' | MeasurementKind | 'marker'

// Modes, in display order.
export const ASTROMETRY_MODES: readonly AstrometryMode[] = ['pan', 'distance', 'rectangle', 'circle', 'marker']

// Item of the astrometry of an image that can be selected.
export interface AstrometrySelection {
	// Kind of item.
	readonly kind: 'measurement' | 'marker'
	// Its id.
	readonly id: string
}

// Handle of an item that can be dragged: the points of a distance or circle, the corners and edges of a rectangle, or
// the point of a marker.
export type HandleName = 'a' | 'b' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'point'

// Handle under the pointer.
export interface HandleHit extends AstrometrySelection {
	// Which handle.
	readonly handle: HandleName
}

// Gesture in progress of the astrometric tool of an image.
export type Draft =
	// A measurement being drawn from an anchor to the pointer: by a drag (pressed) or by a second click (not pressed).
	| { readonly type: 'create'; readonly imageId: string; readonly kind: MeasurementKind; readonly anchor: Point; readonly current: Point; readonly pressed: boolean }
	// A marker being placed where the press is released.
	| { readonly type: 'marker'; readonly imageId: string; readonly point: Point }
	// A handle of a measurement being dragged: original is the measurement before the gesture, measurement its copy.
	| { readonly type: 'edit'; readonly imageId: string; readonly handle: HandleName; readonly original: Measurement; readonly measurement: Measurement }
	// A marker being dragged.
	| { readonly type: 'move'; readonly imageId: string; readonly marker: AstrometricMarker }

// What the store does when a gesture ends: add or replace a measurement or a marker, or nothing.
export type DraftCommit =
	| { readonly type: 'addMeasurement'; readonly measurement: Omit<Measurement, 'id'> }
	| { readonly type: 'updateMeasurement'; readonly measurement: Measurement }
	| { readonly type: 'addMarker'; readonly marker: Omit<AstrometricMarker, 'id'> }
	| { readonly type: 'updateMarker'; readonly marker: AstrometricMarker }
	| undefined

// Values of a distance from the selected solution.
export interface DistanceValues {
	// Length in image pixels.
	readonly pixels: number
	// Sky offset from the start to the end; absent when an end cannot be unprojected.
	readonly offset?: SkyOffset
}

// Values of a rectangle from the selected solution, every angle in radians; the angles are absent when a corner or an
// edge midpoint cannot be unprojected.
export interface RectangleValues {
	// Width and height in image pixels.
	readonly pixels: { readonly width: number; readonly height: number }
	// Angles along the sides, top, bottom, left, and right, between their corners.
	readonly sides?: { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number }
	// Angles between the midpoints of opposite sides: across (left to right) and down (top to bottom).
	readonly centerLines?: { readonly width: number; readonly height: number }
	// Angles of the diagonals, top-left to bottom-right and top-right to bottom-left.
	readonly diagonals?: readonly [number, number]
}

// Values of a circle from the selected solution, angles in radians; the sky values are absent when its centre or rim
// cannot be unprojected.
export interface CircleValues {
	// Distance from the centre to the rim point, in image pixels.
	readonly pixels: number
	// Sky position of the centre, [right ascension, declination].
	readonly center?: readonly [number, number]
	// Angular radius on the sky.
	readonly radius?: number
}

// Distance below which two points of a measurement are the same, in image pixels.
const COINCIDENT_PIXELS = 1e-6

// Fewest and most vertices of the outline of a circle.
const CIRCLE_VERTICES = [48, 360] as const

// Length of an edge of the outline of a circle on screen, about, in screen pixels.
const CIRCLE_EDGE = 6

// Returns the values of a distance with a solution: its length in pixels and the sky offset of its ends.
export function distanceValues(solution: FitsHeader, measurement: Measurement): DistanceValues {
	const pixels = Math.hypot(measurement.b.x - measurement.a.x, measurement.b.y - measurement.a.y)
	const a = skyAt(solution, measurement.a)
	const b = skyAt(solution, measurement.b)
	return { pixels, ...(a && b && { offset: skyOffset(a, b) }) }
}

// Returns the values of a rectangle with a solution: its size in pixels and the great-circle angles along its sides,
// centre lines, and diagonals, which differ from each other wherever the projection or distortion does.
export function rectangleValues(solution: FitsHeader, measurement: Measurement): RectangleValues {
	const { left, top, right, bottom } = bounds(measurement)
	const pixels = { width: right - left, height: bottom - top }
	const middleX = (left + right) / 2
	const middleY = (top + bottom) / 2
	const points = [
		{ x: left, y: top },
		{ x: right, y: top },
		{ x: left, y: bottom },
		{ x: right, y: bottom },
		{ x: left, y: middleY },
		{ x: right, y: middleY },
		{ x: middleX, y: top },
		{ x: middleX, y: bottom },
	].map((point) => skyAt(solution, point))
	if (points.some((point) => point === undefined)) return { pixels }

	const [nw, ne, sw, se, w, e, n, s] = points as (readonly [number, number])[]
	const angle = (p: readonly [number, number], q: readonly [number, number]) => sphericalSeparation(p[0], p[1], q[0], q[1])
	return { pixels, sides: { top: angle(nw, ne), bottom: angle(sw, se), left: angle(nw, sw), right: angle(ne, se) }, centerLines: { width: angle(w, e), height: angle(n, s) }, diagonals: [angle(nw, se), angle(ne, sw)] }
}

// Returns the values of a circle with a solution: its pixel radius, and the sky position of its centre and its angular
// radius, the separation of its rim point from its centre.
export function circleValues(solution: FitsHeader, measurement: Measurement): CircleValues {
	const pixels = Math.hypot(measurement.b.x - measurement.a.x, measurement.b.y - measurement.a.y)
	const center = skyAt(solution, measurement.a)
	const rim = skyAt(solution, measurement.b)
	return { pixels, ...(center && rim && { center, radius: sphericalSeparation(center[0], center[1], rim[0], rim[1]) }) }
}

// Returns the outline of a circle of constant angular radius through a solution, as polylines in viewer coordinates:
// points at that separation from its centre, at every position angle, projected through the WCS and broken where they
// cannot be; about one vertex every CIRCLE_EDGE screen pixels at a zoom (viewport pixels per image pixel), within
// CIRCLE_VERTICES. Undefined when its centre or rim cannot be unprojected or its radius is 0.
export function circleOutline(solution: FitsHeader, measurement: Measurement, scale: number): Point[][] | undefined {
	const { center, radius, pixels } = circleValues(solution, measurement)
	if (!center || !radius) return undefined

	const vertices = Math.round(Math.min(CIRCLE_VERTICES[1], Math.max(CIRCLE_VERTICES[0], (2 * Math.PI * pixels * scale) / CIRCLE_EDGE)))
	const paths: Point[][] = []
	let path: Point[] = []

	for (let i = 0; i <= vertices; i++) {
		const [ra, dec] = sphericalDestination(center[0], center[1], (2 * Math.PI * i) / vertices, radius)
		const point = pointAt(solution, ra, dec)

		if (point) {
			path.push(point)
		} else if (path.length > 0) {
			if (path.length > 1) paths.push(path)
			path = []
		}
	}

	if (path.length > 1) paths.push(path)
	return paths
}

// Returns the left, top, right, and bottom of a rectangle, in viewer coordinates.
export function bounds(measurement: Measurement): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } {
	const { a, b } = measurement
	return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) }
}

// Returns the handles of a measurement and their points: the two points of a distance or circle, the corners and
// edge midpoints of a rectangle.
export function handlesOf(measurement: Measurement): readonly (readonly [HandleName, Point])[] {
	if (measurement.kind !== 'rectangle') {
		return [
			['a', measurement.a],
			['b', measurement.b],
		]
	}

	const { left, top, right, bottom } = bounds(measurement)
	const x = (left + right) / 2
	const y = (top + bottom) / 2
	return [
		['nw', { x: left, y: top }],
		['ne', { x: right, y: top }],
		['sw', { x: left, y: bottom }],
		['se', { x: right, y: bottom }],
		['n', { x, y: top }],
		['s', { x, y: bottom }],
		['w', { x: left, y }],
		['e', { x: right, y }],
	]
}

// Returns a measurement with a handle moved to a point. A rectangle keeps the sides the handle does not move, and is
// stored with a at its top-left and b at its bottom-right corner, whichever way it was dragged.
export function moveHandle(measurement: Measurement, handle: HandleName, point: Point): Measurement {
	if (handle === 'a' || handle === 'b') return { ...measurement, [handle]: { x: point.x, y: point.y } }

	let { left, top, right, bottom } = bounds(measurement)
	if (handle.includes('w')) left = point.x
	if (handle.includes('e')) right = point.x
	if (handle.includes('n')) top = point.y
	if (handle.includes('s')) bottom = point.y
	return { ...measurement, a: { x: Math.min(left, right), y: Math.min(top, bottom) }, b: { x: Math.max(left, right), y: Math.max(top, bottom) } }
}

// Returns the handle of the visible items nearest a point within radius (image pixels): the selected item first, then
// later items before earlier ones, markers before measurements; undefined when none is that close.
export function hitHandle(measurements: readonly Measurement[], markers: readonly AstrometricMarker[], point: Point, radius: number, selected?: AstrometrySelection): HandleHit | undefined {
	const candidates: (readonly [AstrometrySelection, HandleName, Point])[] = []
	for (const measurement of measurements) if (measurement.visible) for (const [handle, at] of handlesOf(measurement)) candidates.push([{ kind: 'measurement', id: measurement.id }, handle, at])
	for (const marker of markers) if (marker.visible) candidates.push([{ kind: 'marker', id: marker.id }, 'point', marker.point])

	const isSelected = (item: AstrometrySelection) => item.kind === selected?.kind && item.id === selected.id
	let best: HandleHit | undefined
	let bestScore = Infinity

	for (const [index, [item, handle, at]] of candidates.entries()) {
		const distance = Math.hypot(point.x - at.x, point.y - at.y)
		if (distance > radius) continue
		// Selected first, then the nearest, then the latest.
		const score = (isSelected(item) ? 0 : 2 * radius) + distance - index * 1e-9

		if (score < bestScore) {
			best = { ...item, handle }
			bestScore = score
		}
	}

	return best
}

// Returns the visible item under a click within radius (image pixels) of its outline: a marker, the line of a distance,
// the sides of a rectangle, or the outline of a circle through a solution at a zoom; the nearest one, undefined when
// none is that close.
export function hitItem(solution: FitsHeader, measurements: readonly Measurement[], markers: readonly AstrometricMarker[], point: Point, radius: number, scale: number): AstrometrySelection | undefined {
	let best: AstrometrySelection | undefined
	let bestDistance = radius

	const consider = (item: AstrometrySelection, distance: number) => {
		if (distance <= bestDistance) {
			best = item
			bestDistance = distance
		}
	}

	for (const marker of markers) if (marker.visible) consider({ kind: 'marker', id: marker.id }, Math.hypot(point.x - marker.point.x, point.y - marker.point.y))

	for (const measurement of measurements) {
		if (!measurement.visible) continue
		const item = { kind: 'measurement', id: measurement.id } as const

		if (measurement.kind === 'distance') {
			consider(item, segmentDistance(point, measurement.a, measurement.b))
		} else if (measurement.kind === 'rectangle') {
			const { left, top, right, bottom } = bounds(measurement)
			const corners = [
				{ x: left, y: top },
				{ x: right, y: top },
				{ x: right, y: bottom },
				{ x: left, y: bottom },
			]
			consider(item, Math.min(...corners.map((corner, i) => segmentDistance(point, corner, corners[(i + 1) % 4]))))
		} else {
			const outline = circleOutline(solution, measurement, scale)
			const distances = (outline ?? []).flatMap((path) => path.slice(1).map((vertex, i) => segmentDistance(point, path[i], vertex)))
			if (distances.length > 0) consider(item, Math.min(...distances))
		}
	}

	return best
}

// Inputs of the draft reducer at a pointer event.
export interface DraftContext {
	// Id of the image shown; a draft of another image is abandoned.
	readonly imageId: string
	// Mode of the document.
	readonly mode: AstrometryMode
	// Measurements of the document.
	readonly measurements: readonly Measurement[]
	// Markers of the document.
	readonly markers: readonly AstrometricMarker[]
	// Selected item of the document.
	readonly selected?: AstrometrySelection
	// Radius of the handles, in image pixels.
	readonly radius: number
}

// Returns the draft after a press at a point and whether the tool takes the press: a handle under it is dragged in any
// mode, a press in a measurement mode starts a measurement (or ends one drawn by clicks), a press in the marker mode
// places a marker, and otherwise the viewer pans.
export function pressDraft(draft: Draft | undefined, point: Point, context: DraftContext): { readonly draft?: Draft; readonly take: boolean } {
	const { imageId, mode } = context
	const current = draft?.imageId === imageId ? draft : undefined

	if (current?.type === 'create') return { draft: { ...current, current: point, pressed: true }, take: true }

	const hit = hitHandle(context.measurements, context.markers, point, context.radius, context.selected)

	if (hit?.kind === 'measurement') {
		const measurement = context.measurements.find((m) => m.id === hit.id)
		if (measurement) return { draft: { type: 'edit', imageId, handle: hit.handle, original: measurement, measurement }, take: true }
	} else if (hit?.kind === 'marker') {
		const marker = context.markers.find((m) => m.id === hit.id)
		if (marker) return { draft: { type: 'move', imageId, marker }, take: true }
	}

	if (mode === 'pan') return { draft: undefined, take: false }
	if (mode === 'marker') return { draft: { type: 'marker', imageId, point }, take: true }
	return { draft: { type: 'create', imageId, kind: mode, anchor: point, current: point, pressed: true }, take: true }
}

// Returns the draft after the pointer moves to a point, pressed or hovering.
export function moveDraft(draft: Draft | undefined, point: Point): Draft | undefined {
	if (!draft) return undefined
	if (draft.type === 'create') return { ...draft, current: point }
	if (draft.type === 'marker') return { ...draft, point }
	if (draft.type === 'move') return { ...draft, marker: { ...draft.marker, point: { x: point.x, y: point.y } } }
	return { ...draft, measurement: moveHandle(draft.original, draft.handle, point) }
}

// Returns the draft after the press is released at a point and what the store does: a drag that moved draws the
// measurement, a click without moving waits for a second click, a second click ends it, a marker is placed, and a
// dragged handle or marker is kept. radius (image pixels) tells a click from a drag.
export function releaseDraft(draft: Draft | undefined, point: Point, radius: number): { readonly draft?: Draft; readonly commit: DraftCommit } {
	if (!draft) return { draft: undefined, commit: undefined }
	const at = { x: point.x, y: point.y }
	if (draft.type === 'edit') return { draft: undefined, commit: { type: 'updateMeasurement', measurement: moveHandle(draft.original, draft.handle, at) } }
	if (draft.type === 'move') return { draft: undefined, commit: { type: 'updateMarker', marker: { ...draft.marker, point: at } } }
	if (draft.type === 'marker') return { draft: undefined, commit: { type: 'addMarker', marker: { point: at, visible: true } } }

	if (Math.hypot(point.x - draft.anchor.x, point.y - draft.anchor.y) <= Math.max(radius, COINCIDENT_PIXELS)) return { draft: { ...draft, current: at, pressed: false }, commit: undefined }
	const created = { kind: draft.kind, a: draft.anchor, b: at, visible: true }
	if (draft.kind !== 'rectangle') return { draft: undefined, commit: { type: 'addMeasurement', measurement: created } }
	const { left, top, right, bottom } = bounds({ ...created, id: '' })
	return { draft: undefined, commit: { type: 'addMeasurement', measurement: { ...created, a: { x: left, y: top }, b: { x: right, y: bottom } } } }
}

// Returns the draft of a distance from an anchor to the pointer, waiting for the click at its end (Measure From Here).
export function draftFrom(imageId: string, anchor: Point): Draft {
	return { type: 'create', imageId, kind: 'distance', anchor, current: anchor, pressed: false }
}

// Returns the measurement a draft shows while it is in progress, or undefined for a marker draft.
export function draftMeasurement(draft: Draft): Measurement | undefined {
	if (draft.type === 'edit') return draft.measurement
	if (draft.type === 'create') return { id: '', kind: draft.kind, a: draft.anchor, b: draft.current, visible: true }
	return undefined
}

// Returns a point inside an image of a size, in viewer coordinates.
export function clampToImage(point: Point, image: Size): Point {
	return { x: Math.min(image.width, Math.max(0, point.x)), y: Math.min(image.height, Math.max(0, point.y)) }
}

// Returns the distance from a point to a segment, in their units.
function segmentDistance(point: Point, a: Point, b: Point): number {
	const dx = b.x - a.x
	const dy = b.y - a.y
	const length = dx * dx + dy * dy
	const t = length > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0
	return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}
