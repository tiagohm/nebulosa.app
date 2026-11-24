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

// Advance of a character of the monospace label font, as a fraction of its size, to keep a label inside the image.
const CHARACTER_ADVANCE = 0.6

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
	// Part of the image on screen, where the labels are kept whole.
	const bounds = { x: Math.max(0, x), y: Math.max(0, y), width: Math.min(image.width, x + width) - Math.max(0, x), height: Math.min(image.height, y + height) - Math.max(0, y) }

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
						<Label key={label.key} label={label} unit={unit} color={colors[label.axis]} bounds={bounds} />
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
	// Part of the image on screen, in image pixels, inside which the label is kept whole.
	readonly bounds: OverlayView['visible']
}

// Label of a line, inside the visible image next to where the line crosses its boundary; a label near a corner slides
// along its edge so the next edge never cuts it.
function Label({ label, unit, color, bounds }: LabelProps) {
	const { point, edge, text } = label
	const gap = LABEL_GAP * unit
	const halfWidth = (text.length * CHARACTER_ADVANCE * LABEL_SIZE * unit) / 2
	const halfHeight = (LABEL_SIZE * unit) / 2
	const x = clamp(point.x, bounds.x + gap + halfWidth, bounds.x + bounds.width - gap - halfWidth)
	const y = clamp(point.y, bounds.y + gap + halfHeight, bounds.y + bounds.height - gap - halfHeight)
	const position =
		edge === 'left'
			? ({ x: point.x + gap, y, anchor: 'start', baseline: 'central' } as const)
			: edge === 'right'
				? ({ x: point.x - gap, y, anchor: 'end', baseline: 'central' } as const)
				: edge === 'top'
					? ({ x, y: point.y + gap, anchor: 'middle', baseline: 'hanging' } as const)
					: ({ x, y: point.y - gap, anchor: 'middle', baseline: 'auto' } as const)

	return (
		<text x={position.x} y={position.y} fill={color} textAnchor={position.anchor} dominantBaseline={position.baseline}>
			{text}
		</text>
	)
}

// Returns value within [min, max], or the middle of the range when it is empty, as for a label wider than the part of
// the image on screen.
function clamp(value: number, min: number, max: number): number {
	return min > max ? (min + max) / 2 : Math.min(max, Math.max(min, value))
}

// Returns a polyline as SVG path data, coordinates rounded to 0.01 px.
function pathData(points: readonly Point[]): string {
	let d = ''
	for (const { x, y } of points) d += `${d ? 'L' : 'M'}${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`
	return d
}
