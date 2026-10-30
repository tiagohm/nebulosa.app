import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { useMemo } from 'react'
import type { OverlayView, Point, Size } from '../viewer/transform'
import { cachedGrid, type GridLabel, gridEdges } from './grid'
import { type AstrometryGridSettings, GRID_COLOR_VALUES } from './preferences'

// Right ascension and declination grid of the solution of the image shown, over the shared image viewer: whole lines
// or ticks at the boundary of the visible image, major and minor, with labels of the major lines along that boundary.
// The geometry (grid.ts) follows the visible region and the zoom and is reused while the view stays near it, so the
// grid stays correct whatever panel is open and whichever solution is selected; labels keep their size on screen and
// stay horizontal whatever the rotation or parity of the image.

// Font size of the labels, in screen pixels.
const LABEL_SIZE = 11

// Length of an edge tick, in screen pixels.
const TICK_LENGTH = 8

// Most labels drawn.
const LABEL_BUDGET = 48

// Gap between a label and the boundary it labels, in screen pixels.
const LABEL_GAP = 4

// Width of the major lines and ticks, in screen pixels; minor ones are three quarters of it.
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
	const paths = useMemo(
		() => geometry && { major: geometry.lines.filter((line) => line.major).flatMap((line) => line.paths.map((path) => ({ key: line.key, d: pathData(path) }))), minor: geometry.lines.filter((line) => !line.major).flatMap((line) => line.paths.map((path) => ({ key: line.key, d: pathData(path) }))) },
		[geometry],
	)
	// Recomputed only when the view changes, never on a pointer move, which renders the overlays again.
	const edges = useMemo(() => geometry && gridEdges(geometry, { width: image.width, height: image.height }, { scale: view.scale, visible: { x, y, width, height } }, LABEL_SIZE, TICK_LENGTH, LABEL_BUDGET), [geometry, image.width, image.height, view.scale, x, y, width, height])
	if (!geometry || !paths || !edges) return null

	const color = GRID_COLOR_VALUES[settings.color]
	const unit = 1 / view.scale

	return (
		<g fill="none" stroke={color}>
			{settings.mode === 'lines' ? (
				<>
					{settings.minor && (
						<g strokeOpacity={settings.opacity / 2} strokeWidth={0.75 * STROKE}>
							{paths.minor.map(({ key, d }, i) => (
								<path key={`${key}:${i}`} d={d} vectorEffect="non-scaling-stroke" />
							))}
						</g>
					)}
					<g strokeOpacity={settings.opacity} strokeWidth={STROKE}>
						{paths.major.map(({ key, d }, i) => (
							<path key={`${key}:${i}`} d={d} vectorEffect="non-scaling-stroke" />
						))}
					</g>
				</>
			) : (
				<g strokeOpacity={Math.min(1, settings.opacity * 1.5)}>
					{edges.ticks
						.filter((tick) => tick.major || settings.minor)
						.map((tick) => (
							<path key={tick.key} d={pathData(tick.points)} strokeWidth={(tick.major ? 1.5 : 0.75) * STROKE} vectorEffect="non-scaling-stroke" />
						))}
				</g>
			)}
			{settings.labels && (
				<g fill={color} stroke="var(--color-base-000)" strokeOpacity={0.85} strokeWidth={3 * unit} paintOrder="stroke" fontSize={LABEL_SIZE * unit} className="font-mono tabular-nums">
					{edges.labels.map((label) => (
						<Label key={label.key} label={label} unit={unit} />
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
}

// Label of a line, inside the visible image next to where the line crosses its boundary.
function Label({ label, unit }: LabelProps) {
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
		<text x={position.x} y={position.y} textAnchor={position.anchor} dominantBaseline={position.baseline}>
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
