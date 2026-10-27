import type { StreakDetectionResult } from 'api'
import type { OverlayView } from '../viewer/transform'
import { streakSegments } from './streaks'

// Streak lines of a detection result over the shared image viewer: a segment between the endpoints of each streak, with
// short ticks across its ends and, when labeled, its number, plus a highlighted selected streak. No arrow is drawn: a
// streak of a single frame has no known direction of motion. It is a pure function of the result and draws in image
// pixel coordinates, so the viewer's zoom and pan move it while strokes, ticks, and labels keep their size on screen;
// the caller shows it only over the image the result measured. Only the streaks inside the view are drawn.

// Half length of the ticks across the endpoints, in screen pixels.
const TICK = 4

// Size of the labels, in screen pixels.
const LABEL_SIZE = 11

// Distance of a label from the first endpoint, in screen pixels.
const LABEL_OFFSET = 8

export interface StreakOverlayProps {
	// Result whose streaks are drawn.
	readonly result: Pick<StreakDetectionResult, 'streaks'>
	// Zoom and visible region of the viewer.
	readonly view: OverlayView
	// Whether each line is labeled with its number (its index plus one).
	readonly labels: boolean
	// Index of the selected streak in the result, if any.
	readonly selected?: number
}

// Streak lines of a result.
export function StreakOverlay({ result, view, labels, selected }: StreakOverlayProps) {
	const unit = 1 / view.scale
	const segments = streakSegments(result, view.visible, (LABEL_OFFSET + LABEL_SIZE) * unit)

	return (
		<g fill="none" strokeLinecap="round">
			{segments.map(({ index, start, end }) => {
				const isSelected = index === selected
				const color = isSelected ? 'var(--color-success)' : 'var(--color-accent)'
				const length = Math.hypot(end.x - start.x, end.y - start.y) || 1
				// Unit normal of the segment, for the ticks across its ends.
				const nx = (-(end.y - start.y) / length) * TICK * unit
				const ny = ((end.x - start.x) / length) * TICK * unit

				return (
					<g key={index} stroke={color} strokeOpacity={isSelected ? 1 : 0.85}>
						<line x1={start.x} y1={start.y} x2={end.x} y2={end.y} strokeWidth={isSelected ? 2.5 : 1.5} vectorEffect="non-scaling-stroke" />
						<path d={`M${start.x - nx} ${start.y - ny}L${start.x + nx} ${start.y + ny}M${end.x - nx} ${end.y - ny}L${end.x + nx} ${end.y + ny}`} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
						{labels && (
							<text x={start.x + nx * (LABEL_OFFSET / TICK)} y={start.y + ny * (LABEL_OFFSET / TICK)} fill={color} stroke="none" fontSize={LABEL_SIZE * unit} textAnchor="middle" dominantBaseline="central">
								{index + 1}
							</text>
						)}
					</g>
				)
			})}
		</g>
	)
}
