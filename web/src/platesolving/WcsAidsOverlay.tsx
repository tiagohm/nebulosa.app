import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { useMemo } from 'react'
import type { ViewerCursor } from '../viewer/ImageViewer'
import type { OverlayView, Point, Size } from '../viewer/transform'
import { cornerAnchor, scaleBar, visibleImage } from './aids'
import { formatAngularSize } from './coordinates'
import { skyDirections } from './wcs'

// Passive astrometric aids of the solution of the image shown, over the shared image viewer: a crosshair through the
// pointer, the compact north and east arrows in the top-right corner of the visible image, from the WCS at that point
// (an arrow that cannot be projected there is left out), and the angular scale bar near the bottom-left corner,
// measured through the WCS where it is drawn (aids.ts). Everything keeps its size on screen and takes no pointer events.

// Distance of the compact arrows from the top-right corner of the visible image, in screen pixels.
const CORNER_INSET = 44

// Length of the compact arrows, in screen pixels.
const CORNER_ARROW = 28

// Font size of the letters and the scale bar label, in screen pixels.
const LABEL_SIZE = 11

// Height of the end ticks of the scale bar, in screen pixels.
const BAR_TICK = 6

export interface WcsAidsOverlayProps {
	// Solution of the image shown.
	readonly solution: PlateSolution
	// Size of the image shown, in pixels.
	readonly image: Size
	// Zoom and visible region of the viewer.
	readonly view: OverlayView
	// Pointer over the viewer, for the crosshair.
	readonly cursor?: ViewerCursor
	// Whether the crosshair is drawn.
	readonly crosshair: boolean
	// Whether the compact arrows are drawn in the corner.
	readonly corner: boolean
	// Whether the scale bar is drawn.
	readonly scaleBar: boolean
}

// Crosshair, compact orientation, and scale bar of a solution.
export function WcsAidsOverlay({ solution, image, view, cursor, crosshair, corner, scaleBar: bar }: WcsAidsOverlayProps) {
	const { x, y, width, height } = view.visible
	// Recomputed only when the view changes, never on a pointer move, which renders the overlays again.
	const aids = useMemo(() => {
		const shown = { scale: view.scale, visible: { x, y, width, height } }
		const size = { width: image.width, height: image.height }
		const anchor = corner ? cornerAnchor(size, shown, CORNER_INSET) : undefined
		return { anchor, directions: anchor && skyDirections(solution, anchor), bar: bar ? scaleBar(solution, size, shown) : undefined }
	}, [solution, image.width, image.height, view.scale, x, y, width, height, corner, bar])
	const unit = 1 / view.scale
	const visible = visibleImage(image, view)
	const pointer = crosshair && cursor?.pixel && visible ? cursor.image : undefined

	return (
		<g fill="none">
			{pointer && visible && (
				<g stroke="var(--color-ink-100)" strokeOpacity={0.6} strokeWidth={1} strokeDasharray="4 4">
					<line x1={visible.x} y1={pointer.y} x2={visible.x + visible.width} y2={pointer.y} vectorEffect="non-scaling-stroke" />
					<line x1={pointer.x} y1={visible.y} x2={pointer.x} y2={visible.y + visible.height} vectorEffect="non-scaling-stroke" />
				</g>
			)}
			{aids.anchor && aids.directions && (
				<g>
					<circle cx={aids.anchor.x} cy={aids.anchor.y} r={2 * unit} fill="var(--color-ink-100)" />
					{aids.directions.north && <CornerArrow from={aids.anchor} direction={aids.directions.north} unit={unit} label="N" color="var(--color-accent)" />}
					{aids.directions.east && <CornerArrow from={aids.anchor} direction={aids.directions.east} unit={unit} label="E" color="var(--color-ink-100)" />}
				</g>
			)}
			{aids.bar && (
				<g stroke="var(--color-ink-100)" strokeWidth={1.5}>
					<path d={`M${aids.bar.from.x} ${aids.bar.from.y - BAR_TICK * unit}V${aids.bar.from.y}H${aids.bar.to.x}V${aids.bar.to.y - BAR_TICK * unit}`} vectorEffect="non-scaling-stroke" />
					<text x={(aids.bar.from.x + aids.bar.to.x) / 2} y={aids.bar.from.y - 4 * unit} textAnchor="middle" fill="var(--color-ink-100)" stroke="var(--color-base-000)" strokeOpacity={0.85} strokeWidth={3 * unit} paintOrder="stroke" fontSize={LABEL_SIZE * unit} className="font-mono tabular-nums">
						{formatAngularSize(aids.bar.angle).replace(/\.00(?=[″′°])/, '')}
					</text>
				</g>
			)}
		</g>
	)
}

interface CornerArrowProps {
	// Start of the arrow, in image pixels.
	readonly from: Point
	// Unit direction, in image pixels.
	readonly direction: Point
	// Image pixels per screen pixel.
	readonly unit: number
	// Letter drawn past the tip.
	readonly label: string
	// Stroke and text color.
	readonly color: string
}

// Short arrow of a sky direction with its letter, constant in size on screen.
function CornerArrow({ from, direction, unit, label, color }: CornerArrowProps) {
	const length = CORNER_ARROW * unit
	const tip = { x: from.x + direction.x * length, y: from.y + direction.y * length }
	const head = 5 * unit
	// The two barbs of the head, 25° off the shaft.
	const barb = (angle: number) => `${tip.x - head * (direction.x * Math.cos(angle) - direction.y * Math.sin(angle))} ${tip.y - head * (direction.x * Math.sin(angle) + direction.y * Math.cos(angle))}`
	const text = { x: from.x + direction.x * (length + LABEL_SIZE * unit), y: from.y + direction.y * (length + LABEL_SIZE * unit) }

	return (
		<g stroke={color}>
			<path d={`M${from.x} ${from.y}L${tip.x} ${tip.y}M${barb(0.44)}L${tip.x} ${tip.y}L${barb(-0.44)}`} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
			<text x={text.x} y={text.y} fill={color} stroke="var(--color-base-000)" strokeOpacity={0.85} strokeWidth={3 * unit} paintOrder="stroke" fontSize={LABEL_SIZE * unit} textAnchor="middle" dominantBaseline="central">
				{label}
			</text>
		</g>
	)
}
