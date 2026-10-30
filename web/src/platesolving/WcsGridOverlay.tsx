import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { useMemo } from 'react'
import type { OverlayView, Point, Size } from '../viewer/transform'
import { cachedGrid, type GridLabel, gridLabels } from './grid'
import { type AstrometryGridSettings, GRID_COLOR_VALUES } from './preferences'

// Right ascension and declination grid of the solution of the image shown, over the shared image viewer: major and
// minor lines, with labels of the major lines along the boundary of the visible image, meridians and parallels each in
// the color of their axis. The geometry (grid.ts) follows the visible region and the zoom and is reused while the view
// stays near it, so the grid stays correct whatever panel is open and whichever solution is selected; labels keep their
// size on screen and stay horizontal whatever the rotation or parity of the image.

// Font size of the labels, in screen pixels.
const LABEL_SIZE = 11

// Most labels drawn.
const LABEL_BUDGET = 48

// Gap between a label and the boundary it labels, in screen pixels.
const LABEL_GAP = 4

// Width of the major lines, in screen pixels; minor ones are three quarters of it.
const STROKE = 1

export interface WcsGridOverlayProps {
	// Solution of the image shown.
	readonly solution: PlateSolution
	// Size of the image shown, in pixels.
	readonly image: Size
	// Zoom and visible region of the viewer.
	readonly view: OverlayView
	// Appearance of the grid.
	readonly settings: AstrometryGridSettings
}

// Grid of a solution.
export function WcsGridOverlay({ solution, image, view, settings }: WcsGridOverlayProps) {
	const geometry = cachedGrid(solution, image, view)
	const { x, y, width, height } = view.visible
	const paths = useMemo(() => geometry?.lines.flatMap((line) => line.paths.map((path, i) => ({ key: `${line.key}:${i}`, axis: line.axis, major: line.major, d: pathData(path) }))), [geometry])
	// Recomputed only when the view changes, never on a pointer move, which renders the overlays again.
	const labels = useMemo(() => geometry && gridLabels(geometry, { width: image.width, height: image.height }, { scale: view.scale, visible: { x, y, width, height } }, LABEL_SIZE, LABEL_BUDGET), [geometry, image.width, image.height, view.scale, x, y, width, height])
	if (!geometry || !paths || !labels) return null

	const colors = GRID_COLOR_VALUES[settings.color]
	const unit = 1 / view.scale

	return (
		<g fill="none">
			{settings.minor && (
				<g strokeOpacity={settings.opacity / 2} strokeWidth={0.75 * STROKE}>
					{paths
						.filter((path) => !path.major)
						.map(({ key, axis, d }) => (
							<path key={key} d={d} stroke={colors[axis]} vectorEffect="non-scaling-stroke" />
						))}
				</g>
			)}
			<g strokeOpacity={settings.opacity} strokeWidth={STROKE}>
				{paths
					.filter((path) => path.major)
					.map(({ key, axis, d }) => (
						<path key={key} d={d} stroke={colors[axis]} vectorEffect="non-scaling-stroke" />
					))}
			</g>
			{settings.labels && (
				<g stroke="var(--color-base-000)" strokeOpacity={0.85} strokeWidth={3 * unit} paintOrder="stroke" fontSize={LABEL_SIZE * unit} className="font-mono tabular-nums">
					{labels.map((label) => (
						<Label key={label.key} label={label} unit={unit} color={colors[label.axis]} />
					))}
				</g>
			)}
		</g>
	)
}

interface LabelProps {
	// Label and where it crosses the boundary.
	readonly label: GridLabel
	// Image pixels per screen pixel.
	readonly unit: number
	// CSS color of the text.
	readonly color: string
}

// Label of a line, inside the visible image next to where the line crosses its boundary.
function Label({ label, unit, color }: LabelProps) {
	const { point, edge, text } = label
	const gap = LABEL_GAP * unit
	const position =
		edge === 'left'
			? ({ x: point.x + gap, y: point.y, anchor: 'start', baseline: 'central' } as const)
			: edge === 'right'
				? ({ x: point.x - gap, y: point.y, anchor: 'end', baseline: 'central' } as const)
				: edge === 'top'
					? ({ x: point.x, y: point.y + gap, anchor: 'middle', baseline: 'hanging' } as const)
					: ({ x: point.x, y: point.y - gap, anchor: 'middle', baseline: 'auto' } as const)

	return (
		<text x={position.x} y={position.y} fill={color} textAnchor={position.anchor} dominantBaseline={position.baseline}>
			{text}
		</text>
	)
}

// Returns a polyline as SVG path data, coordinates rounded to 0.01 px.
function pathData(points: readonly Point[]): string {
	let d = ''
	for (const { x, y } of points) d += `${d ? 'L' : 'M'}${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`
	return d
}
