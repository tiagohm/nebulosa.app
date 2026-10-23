import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { useMemo } from 'react'
import type { OverlayView, Point, Size } from '../viewer/transform'
import { wcsGeometry } from './wcs'

// Astrometric overlay of a plate solution over the shared image viewer, used by the Images workspace and Camera
// Capture alike: a marker at the solved centre of the image, arrows towards north and east from the WCS (so they follow
// its rotation and parity), and an optional right ascension and declination grid. The geometry is computed once per
// solution (wcs.ts); zoom and pan only change sizes kept constant on screen. It draws in image pixel coordinates and
// is a pure function of the solution and the image shown, which the caller guarantees is the image it solved.

// Length of the direction arrows, in screen pixels.
const ARROW_LENGTH = 56

// Size of the centre marker, in screen pixels.
const MARKER_SIZE = 10

// Font size of the arrow labels, in screen pixels.
const LABEL_SIZE = 12

// Longest arrow as a fraction of the image's smaller dimension. When zoomed out past it, the arrows, marker, and labels
// shrink with the image instead of staying constant on screen; their strokes keep their width.
const MAX_ARROW_FRACTION = 0.25

// Width of the grid lines, in screen pixels.
const GRID_STROKE = 1

// Width of the marker and arrow strokes, in screen pixels.
const SYMBOL_STROKE = 1.5

export interface WcsOverlayProps {
	// Solution drawn, of the image shown.
	readonly solution: PlateSolution
	// Size of the image shown, in pixels.
	readonly image: Size
	// Zoom and visible region of the viewer.
	readonly view: OverlayView
	// Whether the grid is drawn.
	readonly grid: boolean
}

// Overlay of a plate solution.
export function WcsOverlay({ solution, image, view, grid }: WcsOverlayProps) {
	const geometry = useMemo(() => wcsGeometry(solution, image.width, image.height), [solution, image.width, image.height])
	const { center, north, east } = geometry
	// Image pixels per screen pixel, capped so the arrows fit the image.
	const unit = Math.min(1 / view.scale, (MAX_ARROW_FRACTION * Math.min(image.width, image.height)) / ARROW_LENGTH)

	return (
		<g fill="none">
			{grid && (
				<g stroke="var(--color-ink-200)" strokeOpacity={0.45} strokeWidth={GRID_STROKE}>
					{[...geometry.parallels, ...geometry.meridians].map((path) => (
						<path key={path} d={path} vectorEffect="non-scaling-stroke" />
					))}
				</g>
			)}
			<g stroke="var(--color-success)" strokeWidth={SYMBOL_STROKE}>
				<line x1={center.x - MARKER_SIZE * unit} y1={center.y} x2={center.x + MARKER_SIZE * unit} y2={center.y} vectorEffect="non-scaling-stroke" />
				<line x1={center.x} y1={center.y - MARKER_SIZE * unit} x2={center.x} y2={center.y + MARKER_SIZE * unit} vectorEffect="non-scaling-stroke" />
			</g>
			{north && <Arrow from={center} direction={north} unit={unit} label="N" color="var(--color-accent)" />}
			{east && <Arrow from={center} direction={east} unit={unit} label="E" color="var(--color-ink-100)" />}
		</g>
	)
}

interface ArrowProps {
	// Start of the arrow, in image pixels.
	readonly from: Point
	// Unit direction, in image pixels.
	readonly direction: Point
	// Image pixels per screen pixel of the symbol, at most the viewer's.
	readonly unit: number
	// Letter drawn past the tip.
	readonly label: string
	// Stroke and text color.
	readonly color: string
}

// Arrow of a sky direction, constant in length on screen unless capped by the image, with its letter.
function Arrow({ from, direction, unit, label, color }: ArrowProps) {
	const length = ARROW_LENGTH * unit
	const tip = { x: from.x + direction.x * length, y: from.y + direction.y * length }
	const head = 7 * unit
	// The two barbs of the head, 25° off the shaft.
	const barb = (angle: number) => {
		const cos = Math.cos(angle)
		const sin = Math.sin(angle)
		return `${tip.x - head * (direction.x * cos - direction.y * sin)} ${tip.y - head * (direction.x * sin + direction.y * cos)}`
	}
	const text = { x: from.x + direction.x * (length + LABEL_SIZE * unit), y: from.y + direction.y * (length + LABEL_SIZE * unit) }

	return (
		<g stroke={color}>
			<path d={`M${from.x} ${from.y}L${tip.x} ${tip.y}M${barb(0.44)}L${tip.x} ${tip.y}L${barb(-0.44)}`} strokeWidth={SYMBOL_STROKE} vectorEffect="non-scaling-stroke" />
			<text x={text.x} y={text.y} fill={color} stroke="none" fontSize={LABEL_SIZE * unit} textAnchor="middle" dominantBaseline="central">
				{label}
			</text>
		</g>
	)
}
