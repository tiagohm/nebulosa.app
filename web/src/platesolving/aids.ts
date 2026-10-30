import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { sphericalSeparation } from 'nebulosa/src/math/numerical/geometry'
import type { OverlayView, Point, Rect, Size } from '../viewer/transform'
import { skyAt } from './wcs'

// Geometry of the passive astrometric aids drawn over a solved image, in viewer coordinates (image pixels): the
// angular scale bar, measured through the WCS where it is drawn, and the anchor of the compact north and east arrows
// in a corner of the visible image. Sizes given in screen pixels are converted with the zoom of the view, so the aids
// keep their size on screen.

// Lengths a scale bar may stand for, radians: 1″ to 5°.
const SCALE_BAR_ANGLES = [1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 7200, 18000].map((arcsec) => (arcsec * Math.PI) / 648000)

// Range of the length of the scale bar on screen, in screen pixels.
const SCALE_BAR_LENGTH = [60, 180] as const

// Distance of the scale bar from the bottom-left corner of the visible image, in screen pixels.
const SCALE_BAR_INSET = 24

// Largest relative difference between the scales along the two image axes for a single bar to stand for both.
const MAX_ANISOTROPY = 0.1

// Bisection steps of the end of the scale bar.
const BISECTION_STEPS = 32

// Scale bar: a horizontal segment on screen whose ends are separated by an angle on the sky.
export interface ScaleBar {
	// Left end, in viewer coordinates.
	readonly from: Point
	// Right end, in viewer coordinates.
	readonly to: Point
	// Separation of the ends on the sky, radians.
	readonly angle: number
}

// Returns the scale bar of a solution near the bottom-left corner of the visible part of an image: the longest round
// angle (1″ to 5°) whose length on screen falls within SCALE_BAR_LENGTH, its right end found by bisection on the
// separation through the WCS, so it is exact where it is drawn whatever the distortion elsewhere. Undefined when no part
// of the image is visible, the WCS cannot unproject there, the scales along the two image axes differ by more than
// MAX_ANISOTROPY (a single bar would mislead), or the bar does not fit the visible image.
export function scaleBar(solution: FitsHeader, image: Size, view: OverlayView): ScaleBar | undefined {
	const visible = visibleImage(image, view)
	if (!visible) return undefined

	const inset = SCALE_BAR_INSET / view.scale
	const from = { x: visible.x + inset, y: visible.y + visible.height - inset }
	const room = visible.x + visible.width - inset - from.x
	if (room <= 0 || from.y <= visible.y) return undefined

	const origin = skyAt(solution, from)
	const right = skyAt(solution, { x: from.x + 1, y: from.y })
	const below = skyAt(solution, { x: from.x, y: from.y + 1 })
	if (!origin || !right || !below) return undefined

	const scaleX = sphericalSeparation(origin[0], origin[1], right[0], right[1])
	const scaleY = sphericalSeparation(origin[0], origin[1], below[0], below[1])
	if (!(scaleX > 0) || Math.abs(scaleX - scaleY) > MAX_ANISOTROPY * ((scaleX + scaleY) / 2)) return undefined

	// Length on screen of an angle at the local scale, screen pixels.
	const length = (angle: number) => (angle / scaleX) * view.scale
	const angle = SCALE_BAR_ANGLES.findLast((candidate) => length(candidate) >= SCALE_BAR_LENGTH[0] && length(candidate) <= SCALE_BAR_LENGTH[1])
	if (angle === undefined) return undefined

	// Separation from the left end of the point t image pixels to its right, radians; undefined when not unprojected.
	const separation = (t: number) => {
		const sky = skyAt(solution, { x: from.x + t, y: from.y })
		return sky && sphericalSeparation(origin[0], origin[1], sky[0], sky[1])
	}

	let low = 0
	let high = (2 * angle) / scaleX

	for (let i = 0; i < BISECTION_STEPS; i++) {
		const middle = (low + high) / 2
		const value = separation(middle)
		if (value === undefined) return undefined
		if (value < angle) low = middle
		else high = middle
	}

	const t = (low + high) / 2
	return t <= room ? { from, to: { x: from.x + t, y: from.y }, angle } : undefined
}

// Returns the anchor of the compact north and east arrows: inset screen pixels inside the top-right corner of the
// visible part of an image, or undefined when it is too small on screen to hold them.
export function cornerAnchor(image: Size, view: OverlayView, inset: number): Point | undefined {
	const visible = visibleImage(image, view)
	if (!visible || visible.width * view.scale < 2 * inset || visible.height * view.scale < 2 * inset) return undefined
	return { x: visible.x + visible.width - inset / view.scale, y: visible.y + inset / view.scale }
}

// Returns the part of an image inside the visible region of a view, or undefined when none is.
export function visibleImage(image: Size, view: OverlayView): Rect | undefined {
	const x = Math.max(0, view.visible.x)
	const y = Math.max(0, view.visible.y)
	const right = Math.min(image.width, view.visible.x + view.visible.width)
	const bottom = Math.min(image.height, view.visible.y + view.visible.height)
	return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined
}
