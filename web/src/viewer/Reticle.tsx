import type { Size } from './transform'

// Central reticle overlay of the image viewer: crosshair lines through the image center and two rings,
// drawn in image pixel coordinates so it follows zoom and pan, with strokes of constant screen width.

// Radii of the rings as fractions of the image's smaller dimension.
const RING_FRACTIONS = [0.05, 0.2] as const

// Central reticle over an image of the given size, in image pixels.
export function Reticle({ width, height }: Size) {
	const cx = width / 2
	const cy = height / 2
	const side = Math.min(width, height)

	return (
		<g stroke="var(--color-accent)" strokeOpacity={0.8} strokeWidth={1} fill="none" vectorEffect="non-scaling-stroke">
			<line x1={0} y1={cy} x2={width} y2={cy} vectorEffect="non-scaling-stroke" />
			<line x1={cx} y1={0} x2={cx} y2={height} vectorEffect="non-scaling-stroke" />
			{RING_FRACTIONS.map((fraction) => (
				<circle key={fraction} cx={cx} cy={cy} r={side * fraction} vectorEffect="non-scaling-stroke" />
			))}
		</g>
	)
}
