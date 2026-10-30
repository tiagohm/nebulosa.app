import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { useMemo } from 'react'
import { formatAngularSize } from '../platesolving/coordinates'
import { type AstrometricMarker, type AstrometryTarget, targetOffset, targetPosition } from '../platesolving/measurement'
import type { OverlayView, Size } from '../viewer/transform'

// Target of Target Offset over the shared image viewer: inside the image, a ring at the target and a dashed line from
// the solved centre; outside it, an arrow at the border of the image along the direction from the centre towards the
// target, labelled with its separation, never a position off the image. Sizes are constant on screen.

// Radius of the ring of a target inside the image, in screen pixels.
const RING = 10

// Length of the arrow towards a target outside the image, in screen pixels.
const ARROW = 36

// Distance of the arrow from the border of the image, in screen pixels.
const INSET = 12

// Font size of the label, in screen pixels.
const LABEL_SIZE = 11

// Color of the target.
const COLOR = 'var(--color-accent)'

export interface TargetOffsetOverlayProps {
	// Selected solution of the image shown.
	readonly solution: PlateSolution
	// Size of the image shown, in pixels.
	readonly image: Size
	// Zoom and visible region of the viewer.
	readonly view: OverlayView
	// Target of the document.
	readonly target: AstrometryTarget
	// Markers of the document, for a marker target.
	readonly markers: readonly AstrometricMarker[]
}

// Target and its offset from the solved centre.
export function TargetOffsetOverlay({ solution, image, view, target, markers }: TargetOffsetOverlayProps) {
	const values = useMemo(() => {
		const position = targetPosition(target, markers, solution)
		return position && targetOffset(solution, { width: image.width, height: image.height }, position)
	}, [solution, target, markers, image.width, image.height])
	if (!values) return null

	const unit = 1 / view.scale
	const center = { x: image.width / 2, y: image.height / 2 }
	const label = formatAngularSize(values.offset.separation)
	const text = { fill: COLOR, stroke: 'var(--color-base-000)', strokeOpacity: 0.85, strokeWidth: 3 * unit, paintOrder: 'stroke' as const, fontSize: LABEL_SIZE * unit, className: 'font-mono tabular-nums' }

	if (values.pixel) {
		const { x, y } = values.pixel

		return (
			<g fill="none" stroke={COLOR}>
				<path d={`M${center.x} ${center.y}L${x} ${y}`} strokeWidth={1} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
				<circle cx={x} cy={y} r={RING * unit} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
				<text x={x + (RING + 4) * unit} y={y} dominantBaseline="central" {...text}>
					Target {label}
				</text>
			</g>
		)
	}

	if (!values.direction) return null

	// The arrow ends inset from the border, where the ray from the centre along the direction leaves the image.
	const { x: dx, y: dy } = values.direction
	const inset = INSET * unit
	const reach = Math.min(dx > 0 ? (image.width - inset - center.x) / dx : dx < 0 ? (inset - center.x) / dx : Infinity, dy > 0 ? (image.height - inset - center.y) / dy : dy < 0 ? (inset - center.y) / dy : Infinity)
	if (!(reach > 0) || !Number.isFinite(reach)) return null
	const tip = { x: center.x + dx * reach, y: center.y + dy * reach }
	const length = Math.min(ARROW * unit, reach)
	const tail = { x: tip.x - dx * length, y: tip.y - dy * length }
	const head = 7 * unit
	// The two barbs of the head, 25° off the shaft.
	const barb = (angle: number) => `${tip.x - head * (dx * Math.cos(angle) - dy * Math.sin(angle))} ${tip.y - head * (dx * Math.sin(angle) + dy * Math.cos(angle))}`
	const anchor = dx > 0.3 ? 'end' : dx < -0.3 ? 'start' : 'middle'

	return (
		<g fill="none" stroke={COLOR}>
			<path d={`M${tail.x} ${tail.y}L${tip.x} ${tip.y}M${barb(0.44)}L${tip.x} ${tip.y}L${barb(-0.44)}`} strokeWidth={2} vectorEffect="non-scaling-stroke" />
			<text x={tail.x - dx * 6 * unit} y={tail.y - dy * 6 * unit} textAnchor={anchor} dominantBaseline="central" {...text}>
				Target outside the image · {label}
			</text>
		</g>
	)
}
