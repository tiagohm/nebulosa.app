import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import type { Point } from '../viewer/transform'
import { type SkyOffset, skyAt, skyOffset } from './wcs'

// Astrometric measurements drawn over a solved image, kept as points in viewer coordinates (image pixels, origin at the
// top-left corner of the first pixel), never as sky positions: their sky values are computed again from whichever
// solution is selected, so changing it keeps what was pointed at and never shows a stale value. A point the selected
// solution cannot unproject makes the values unavailable, never 0. This module holds the pure parts: the values, the
// hit tests of handles and lines in screen-constant radii, and the reducer of the drawing and editing gestures, which
// the image viewer routes to it while a measurement mode or the Plate Solver tool owns them.

// Kind of measurement: an angular distance between two points.
export type MeasurementKind = 'distance'

// Measurement of an image, in viewer coordinates.
export interface DistanceMeasurement {
	// Stable identity.
	readonly id: string
	// Kind of measurement.
	readonly kind: 'distance'
	// Start, in viewer coordinates.
	readonly a: Point
	// End, in viewer coordinates.
	readonly b: Point
	// Name given by the operator; absent for the default one.
	readonly label?: string
	// Whether it is drawn.
	readonly visible: boolean
}

// Measurement of an image.
export type Measurement = DistanceMeasurement

// What a gesture creates while it owns the pointer: nothing (the viewer pans) or a measurement of a kind.
export type AstrometryMode = 'pan' | MeasurementKind

// Modes, in display order.
export const ASTROMETRY_MODES: readonly AstrometryMode[] = ['pan', 'distance']

// Item of the astrometry of an image that can be selected.
export interface AstrometrySelection {
	// Kind of item.
	readonly kind: 'measurement'
	// Its id.
	readonly id: string
}

// Handle of a measurement that can be dragged: an end of a distance.
export type HandleName = 'a' | 'b'

// Handle under the pointer.
export interface HandleHit {
	// Id of the measurement.
	readonly id: string
	// Which handle.
	readonly handle: HandleName
}

// Gesture in progress of the astrometric tool of an image.
export type Draft =
	// A distance being drawn from an anchor to the pointer: by a drag (pressed) or by a second click (not pressed).
	| { readonly type: 'create'; readonly imageId: string; readonly kind: MeasurementKind; readonly anchor: Point; readonly current: Point; readonly pressed: boolean }
	// A handle of a measurement being dragged; measurement is its edited copy.
	| { readonly type: 'edit'; readonly imageId: string; readonly handle: HandleName; readonly measurement: Measurement }

// What the store does when a gesture ends: add a measurement, replace one by its edited copy, or nothing.
export type DraftCommit = { readonly type: 'add'; readonly measurement: Omit<Measurement, 'id'> } | { readonly type: 'update'; readonly measurement: Measurement } | undefined

// Values of a distance from the selected solution.
export interface DistanceValues {
	// Length in image pixels.
	readonly pixels: number
	// Sky offset from the start to the end; absent when an end cannot be unprojected.
	readonly offset?: SkyOffset
}

// Distance below which two ends of a distance are the same point, in image pixels.
const COINCIDENT_PIXELS = 1e-6

// Returns the values of a distance with a solution: its length in pixels and the sky offset of its ends.
export function distanceValues(solution: FitsHeader, measurement: DistanceMeasurement): DistanceValues {
	const pixels = Math.hypot(measurement.b.x - measurement.a.x, measurement.b.y - measurement.a.y)
	const a = skyAt(solution, measurement.a)
	const b = skyAt(solution, measurement.b)
	return { pixels, ...(a && b && { offset: skyOffset(a, b) }) }
}

// Returns the handles of a measurement and their points.
export function handlesOf(measurement: Measurement): readonly (readonly [HandleName, Point])[] {
	return [
		['a', measurement.a],
		['b', measurement.b],
	]
}

// Returns a measurement with a handle moved to a point.
export function moveHandle(measurement: Measurement, handle: HandleName, point: Point): Measurement {
	return { ...measurement, [handle]: { x: point.x, y: point.y } }
}

// Returns the handle of the visible measurements nearest a point within radius (image pixels), the selected
// measurement first, later measurements before earlier ones; undefined when none is that close.
export function hitHandle(measurements: readonly Measurement[], point: Point, radius: number, selected?: string): HandleHit | undefined {
	const ordered = measurements.filter((measurement) => measurement.visible).toSorted((a, b) => +(b.id === selected) - +(a.id === selected))
	let best: HandleHit | undefined
	let bestDistance = radius

	for (const measurement of ordered.toReversed()) {
		for (const [handle, at] of handlesOf(measurement)) {
			const distance = Math.hypot(point.x - at.x, point.y - at.y)

			if (distance <= bestDistance) {
				best = { id: measurement.id, handle }
				bestDistance = distance
			}
		}
	}

	return best
}

// Returns the id of the visible measurement whose line passes within radius (image pixels) of a point, the nearest one;
// undefined when none does.
export function hitMeasurement(measurements: readonly Measurement[], point: Point, radius: number): string | undefined {
	let best: string | undefined
	let bestDistance = radius

	for (const measurement of measurements) {
		if (!measurement.visible) continue
		const distance = segmentDistance(point, measurement.a, measurement.b)

		if (distance <= bestDistance) {
			best = measurement.id
			bestDistance = distance
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
	// Selected measurement of the document.
	readonly selected?: string
	// Radius of the handles, in image pixels.
	readonly radius: number
}

// Returns the draft after a press at a point and whether the tool takes the press: a handle under it is dragged in any
// mode, a press in a measurement mode starts a measurement (or ends one drawn by clicks), and otherwise the viewer pans.
export function pressDraft(draft: Draft | undefined, point: Point, context: DraftContext): { readonly draft?: Draft; readonly take: boolean } {
	const current = draft?.imageId === context.imageId ? draft : undefined

	if (current?.type === 'create') return { draft: { ...current, current: point, pressed: true }, take: true }

	const hit = hitHandle(context.measurements, point, context.radius, context.selected)
	const measurement = hit && context.measurements.find((m) => m.id === hit.id)
	if (hit && measurement) return { draft: { type: 'edit', imageId: context.imageId, handle: hit.handle, measurement }, take: true }

	if (context.mode === 'pan') return { draft: undefined, take: false }
	return { draft: { type: 'create', imageId: context.imageId, kind: context.mode, anchor: point, current: point, pressed: true }, take: true }
}

// Returns the draft after the pointer moves to a point, pressed or hovering.
export function moveDraft(draft: Draft | undefined, point: Point): Draft | undefined {
	if (!draft) return undefined
	if (draft.type === 'create') return { ...draft, current: point }
	return { ...draft, measurement: moveHandle(draft.measurement, draft.handle, point) }
}

// Returns the draft after the press is released at a point and what the store does: a drag that moved draws the
// measurement, a click without moving waits for a second click, a second click ends it, and a dragged handle is kept.
// radius (image pixels) tells a click from a drag.
export function releaseDraft(draft: Draft | undefined, point: Point, radius: number): { readonly draft?: Draft; readonly commit: DraftCommit } {
	if (!draft) return { draft: undefined, commit: undefined }
	if (draft.type === 'edit') return { draft: undefined, commit: { type: 'update', measurement: moveHandle(draft.measurement, draft.handle, point) } }

	if (Math.hypot(point.x - draft.anchor.x, point.y - draft.anchor.y) <= Math.max(radius, COINCIDENT_PIXELS)) return { draft: { ...draft, current: point, pressed: false }, commit: undefined }
	return { draft: undefined, commit: { type: 'add', measurement: { kind: draft.kind, a: draft.anchor, b: { x: point.x, y: point.y }, visible: true } } }
}

// Returns the draft of a distance from an anchor to the pointer, waiting for the click at its end (Measure From Here).
export function draftFrom(imageId: string, anchor: Point): Draft {
	return { type: 'create', imageId, kind: 'distance', anchor, current: anchor, pressed: false }
}

// Returns the measurement a draft shows while it is in progress: the distance being drawn, or the edited copy.
export function draftMeasurement(draft: Draft): Measurement {
	if (draft.type === 'edit') return draft.measurement
	return { id: '', kind: draft.kind, a: draft.anchor, b: draft.current, visible: true }
}

// Returns the distance from a point to a segment, in their units.
function segmentDistance(point: Point, a: Point, b: Point): number {
	const dx = b.x - a.x
	const dy = b.y - a.y
	const length = dx * dx + dy * dy
	const t = length > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0
	return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}
