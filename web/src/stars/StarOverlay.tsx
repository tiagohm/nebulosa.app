import type { StarDetectionResult } from 'api'
import type { OverlayView } from '../viewer/transform'
import { markerRadius, starPaths } from './stars'

// Star markers of a detection result over the shared image viewer, used by the Images workspace and Camera
// Capture alike: a circle per star, as large as its HFD and never smaller than a few screen pixels, Moonlight for
// accepted stars and dashed Graticule for rejected ones, and the selected star ringed in Ember Clay, the one marker
// that glows (DESIGN.md, the One Ember Rule), with a heavier stroke so it stands out without its hue. It is
// a pure function of the result and draws in image pixel coordinates, so the viewer's zoom and pan move it;
// the caller shows it only over the image the result measured. Only the markers inside the view are drawn.

// Smallest marker radius, in screen pixels.
const MIN_SCREEN_RADIUS = 5

// Extra radius of the highlight of the selected star, in screen pixels.
const SELECTED_RING = 4

export interface StarOverlayProps {
	// Result whose stars are drawn.
	readonly result: Pick<StarDetectionResult, 'stars' | 'accepted'>
	// Zoom and visible region of the viewer.
	readonly view: OverlayView
	// Whether rejected stars are hidden.
	readonly acceptedOnly: boolean
	// Index of the selected star in the result, if any.
	readonly selected?: number
}

// Star markers of a result.
export function StarOverlay({ result, view, acceptedOnly, selected }: StarOverlayProps) {
	const minRadius = MIN_SCREEN_RADIUS / view.scale
	const paths = starPaths(result, acceptedOnly, view.visible, minRadius)
	const star = selected === undefined ? undefined : result.stars[selected]

	return (
		<g fill="none" strokeWidth={1} vectorEffect="non-scaling-stroke">
			{paths.rejected && <path d={paths.rejected} stroke="var(--color-line-200)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
			{paths.accepted && <path d={paths.accepted} stroke="var(--color-ink-200)" vectorEffect="non-scaling-stroke" />}
			{star && <circle cx={star.x + 0.5} cy={star.y + 0.5} r={markerRadius(star.hfd, minRadius) + SELECTED_RING / view.scale} stroke="var(--color-accent)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />}
		</g>
	)
}
