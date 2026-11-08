import type { ViewerInteraction } from './interaction'
import { type OverlayView, type Point, pixelAt, type Size } from './transform'

// Rectangle selection of whole image pixels with the viewer's pointer: a press inside the image starts it, a drag
// previews it, and the release commits the canonical half-open integer rectangle of the pixels the box covers, kept
// inside the image. A press released within the click tolerance selects nothing, and a cancel (Escape, a pinch, a lost
// pointer) drops the rectangle in progress, or asks to leave the selection when none is. Points are in viewer
// coordinates, whose origin is the top-left corner of the first pixel. Nothing here knows what the rectangle is for.

// Distance a press may move and still be a click, in screen pixels: as the viewer's own click tolerance.
const CLICK_TOLERANCE = 4

// Rectangle of whole image pixels: left/top 0-based from the upper-left pixel, width and height positive.
export interface PixelRect {
	// Column of the first pixel.
	readonly left: number
	// Row of the first pixel.
	readonly top: number
	// Width, in pixels.
	readonly width: number
	// Height, in pixels.
	readonly height: number
}

// What a rectangle selection reports to its owner.
export interface RectangleSelectionOptions {
	// Size of the image shown, in pixels; absent takes no press.
	readonly image: () => Size | undefined
	// Called when a press inside the image starts a rectangle.
	readonly onStart: () => void
	// Called with the rectangle in progress, or undefined when there is none.
	readonly onDraft: (rect: PixelRect | undefined) => void
	// Called with the committed rectangle when a drag is released.
	readonly onCommit: (rect: PixelRect) => void
	// Called on a cancel with no rectangle in progress: the owner leaves the selection.
	readonly onLeave: () => void
}

// Returns the rectangle of the whole pixels covered by the box between two image points, clamped to the image, or
// undefined when it covers none.
export function pixelRectBetween(a: Point, b: Point, image: Size): PixelRect | undefined {
	const left = Math.max(0, Math.floor(Math.min(a.x, b.x)))
	const top = Math.max(0, Math.floor(Math.min(a.y, b.y)))
	const right = Math.min(image.width, Math.ceil(Math.max(a.x, b.x)))
	const bottom = Math.min(image.height, Math.ceil(Math.max(a.y, b.y)))
	return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : undefined
}

// Returns the viewer interaction of a rectangle selection. The interaction keeps the press in progress itself; the
// owner keeps the draft and the committed rectangle.
export function rectangleSelection(options: RectangleSelectionOptions): ViewerInteraction {
	let start: Point | undefined

	// Rectangle from the press to a point, when the image is shown.
	const rectTo = (point: Point) => {
		const image = options.image()
		return start && image ? pixelRectBetween(start, point, image) : undefined
	}

	return {
		onPointerDown(point: Point) {
			const image = options.image()
			if (!image || !pixelAt(image, point)) return false
			start = point
			options.onStart()
			options.onDraft(undefined)
			return true
		},
		onPointerMove(point: Point) {
			if (start) options.onDraft(rectTo(point))
		},
		onPointerUp(point: Point, view: OverlayView) {
			if (!start) return
			const moved = Math.hypot(point.x - start.x, point.y - start.y) * view.scale >= CLICK_TOLERANCE
			const rect = moved ? rectTo(point) : undefined
			start = undefined
			options.onDraft(undefined)
			if (rect) options.onCommit(rect)
		},
		onCancel() {
			if (start) {
				start = undefined
				options.onDraft(undefined)
			} else {
				options.onLeave()
			}
		},
	}
}
