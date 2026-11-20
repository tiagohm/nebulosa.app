import type { ReactNode } from 'react'
import { PanZoomSurface, usePanZoom } from '../planetary/PanZoom'

// Surface of the Local View of the eclipse maps: the toolkit's diagram (in pixels, origin at its top-left corner, y
// down) with a margin around it, panned and zoomed like the Jupiter and Saturn planners' viewers (a drag pans, Ctrl or
// ⌘ with the wheel or a pinch zooms, and buttons zoom in and out, show the main disk close up, and show the whole
// diagram). The view is kept while the component stays mounted, so stepping through contacts or places keeps the zoom.

// Margin around the diagram, in its pixels, so disks near its edges stay inside.
const MARGIN = 32

// Half-width of the close-up, in radii of the main disk: the disk and the edge of the one over it at a contact.
const CLOSE_UP_RADII = 2.5

// Half-height of the close-up at least, in radii of the main disk, so a wide diagram's close-up still shows the whole
// disk with some room above and below it.
const CLOSE_UP_HALF_HEIGHT_RADII = 1.4

// Smallest half-width, in radii of the main disk: a part of its limb.
const CLOSEST_RADII = 0.5

// Radius of the main disk, in pixels of the diagram, when the diagram has none: the toolkit's default solar radius.
const DEFAULT_DISK_RADIUS = 34

// A disk of the diagram, in its pixels.
export interface LocalViewDisk {
	// Centre, in pixels from the left edge.
	readonly cx: number
	// Centre, in pixels from the top edge.
	readonly cy: number
	// Radius, in pixels.
	readonly r: number
}

export interface EclipseLocalViewSurfaceProps {
	// Width of the diagram, in its pixels.
	readonly width: number
	// Height of the diagram, in its pixels.
	readonly height: number
	// Main disk, which the close-up centres on: the Sun, or the Moon at the contact drawn; the diagram's centre at
	// the default radius when absent.
	readonly disk?: LocalViewDisk
	// Name of the main disk, for the close-up button, such as "Sun".
	readonly body: string
	// Shapes of the diagram, in its pixels.
	readonly children: ReactNode
}

// Local View surface of an eclipse map.
export function EclipseLocalViewSurface({ width, height, disk, body, children }: EclipseLocalViewSurfaceProps) {
	const fullWidth = width + 2 * MARGIN
	const fullHeight = height + 2 * MARGIN
	const radius = disk?.r && disk.r > 0 ? disk.r : DEFAULT_DISK_RADIUS
	const aspect = fullWidth / fullHeight
	const zoom = usePanZoom({ maxHalfWidth: fullWidth / 2, minHalfWidth: radius * CLOSEST_RADII, initialHalfWidth: fullWidth / 2, aspect })
	const { box } = zoom
	// The view is in pixels of the diagram from its centre, where the whole view is centred.
	const focus = disk && { x: disk.cx - width / 2, y: disk.cy - height / 2 }

	return (
		<PanZoomSurface zoom={zoom} planetHalfWidth={radius * Math.max(CLOSE_UP_RADII, CLOSE_UP_HALF_HEIGHT_RADII * aspect)} planet={body} focus={focus} wholeLabel="Whole diagram">
			<svg viewBox={`${width / 2 + box.x} ${height / 2 + box.y} ${box.width} ${box.height}`} style={{ aspectRatio: `${fullWidth} / ${fullHeight}` }} className="block w-full overflow-hidden rounded-sm border border-line-100 bg-base-200">
				{children}
			</svg>
		</PanZoomSurface>
	)
}
