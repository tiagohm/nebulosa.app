import { clamp } from 'nebulosa/src/math/numerical/math'
import type { ViewTransform } from './types'

// Pure pan, pinch, and wheel-zoom math of the star map. A gesture is anchored when its pointer set changes;
// each move then derives the transform that keeps the sky point under the anchor centroid under the current
// centroid, scaled by the change of the two-pointer spread. Positions are map-local pixels.

// Pointer position in map-local pixels.
export interface GesturePointer {
	// Horizontal position in pixels.
	x: number
	// Vertical position in pixels.
	y: number
}

// State of a gesture when its pointer set last changed.
export interface GestureAnchor {
	// Horizontal centroid of the pointers in pixels.
	readonly x: number
	// Vertical centroid of the pointers in pixels.
	readonly y: number
	// Distance between the first two pointers in pixels, or 0 for a one-pointer pan.
	readonly distance: number
	// View transform at that moment.
	readonly transform: Readonly<ViewTransform>
}

// Centroid and spread of the first two pointers of a gesture.
interface GestureSpan {
	// Horizontal centroid in pixels.
	readonly x: number
	// Vertical centroid in pixels.
	readonly y: number
	// Distance between the first two pointers in pixels, or 0 with one pointer.
	readonly distance: number
}

// Returns the centroid and spread of the first two pointers, or undefined when there is none; further
// pointers are ignored.
function gestureSpan(pointers: Iterable<GesturePointer>): GestureSpan | undefined {
	let first: GesturePointer | undefined

	for (const pointer of pointers) {
		if (!first) {
			first = pointer
			continue
		}

		return { x: (first.x + pointer.x) / 2, y: (first.y + pointer.y) / 2, distance: Math.hypot(pointer.x - first.x, pointer.y - first.y) }
	}

	return first && { x: first.x, y: first.y, distance: 0 }
}

// Anchors a gesture on the current pointers and transform; returns undefined when no pointer is down.
export function beginGesture(pointers: Iterable<GesturePointer>, transform: Readonly<ViewTransform>): GestureAnchor | undefined {
	const span = gestureSpan(pointers)
	return span && { ...span, transform: { ...transform } }
}

// Returns the transform for the current pointers of an anchored gesture on a canvas of the given pixel size:
// the anchor centroid follows the current centroid and, with two pointers, the zoom scales by the spread
// ratio, clamped to [minZoom, maxZoom].
export function gestureTransform(anchor: GestureAnchor, pointers: Iterable<GesturePointer>, width: number, height: number, minZoom: number, maxZoom: number): ViewTransform {
	const span = gestureSpan(pointers)

	if (!span) return { ...anchor.transform }

	const k = anchor.distance > 0 && span.distance > 0 ? clamp((anchor.transform.k * span.distance) / anchor.distance, minZoom, maxZoom) : anchor.transform.k
	return anchoredTransform(anchor.transform, anchor.x, anchor.y, span.x, span.y, k, width, height)
}

// Returns the transform at zoom `k` that moves the sky point shown at (anchorX, anchorY) under `transform`
// to (x, y), on a canvas of the given pixel size; with the anchor equal to (x, y) it zooms around that point.
export function anchoredTransform(transform: Readonly<ViewTransform>, anchorX: number, anchorY: number, x: number, y: number, k: number, width: number, height: number): ViewTransform {
	const cx = width / 2
	const cy = height / 2
	const baseX = (anchorX - cx - transform.x) / transform.k
	const baseY = (anchorY - cy - transform.y) / transform.k
	return { x: x - cx - baseX * k, y: y - cy - baseY * k, k }
}
