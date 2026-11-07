import type { ObservingPlanDocument, ObservingPlanPreview } from 'api'
import { type KeyboardEvent, type PointerEvent, useState } from 'react'
import { formatClockTime } from '../../format'
import { type SkyBand, skyBands } from '../astroweather/astroweather'
import { CONFLICT_LABELS } from './observingplanner'

// Timeline of a night plan: one lane per item over the displayed night, with the item's windows and its scheduled block.
// A block is moved by dragging it, written once released, or with the arrow keys while focused (5 minutes, or 1 with
// Shift); both give the same canonical start, rounded to the minute, as the numeric start of the item. Blocks with a
// problem are drawn apart, with a symbol. Nothing moves a block on its own.

// Width of the drawing, in viewBox units.
const WIDTH = 760

// Width of the label column, in viewBox units.
const LABEL_WIDTH = 150

// Height of a lane and of the axis, in viewBox units.
const LANE_HEIGHT = 28
const AXIS_HEIGHT = 22

// Fill of each band of the sky.
const SKY_FILLS: Readonly<Record<SkyBand, string>> = { day: 'var(--color-base-300)', twilight: 'var(--color-base-200)', dark: 'var(--color-base-000)' }

// Milliseconds per minute and per hour.
const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

export interface PlanTimelineProps {
	// Plan drawn.
	readonly plan: ObservingPlanDocument
	// Its preview.
	readonly preview: ObservingPlanPreview
	// IANA zone the times are labeled in.
	readonly timeZone: string
	// Receives the new start of an item, Unix milliseconds rounded to the minute.
	readonly onMove: (itemId: string, start: number) => void
}

// Block being dragged: its item, where the pointer started, and how far it moved, in milliseconds.
interface Drag {
	readonly itemId: string
	readonly origin: number
	readonly offset: number
}

// Rounds an instant to the minute.
function roundToMinute(time: number) {
	return Math.round(time / MINUTE_MS) * MINUTE_MS
}

// Timeline of a night plan.
export function PlanTimeline({ plan, preview, timeZone, onMove }: PlanTimelineProps) {
	const [drag, setDrag] = useState<Drag>()
	const { start, end } = preview.night.display
	const span = Math.max(1, end - start)
	const plotWidth = WIDTH - LABEL_WIDTH - 8
	const height = AXIS_HEIGHT + plan.items.length * LANE_HEIGHT + 4
	const x = (time: number) => LABEL_WIDTH + ((Math.min(end, Math.max(start, time)) - start) / span) * plotWidth
	const msPerUnit = span / plotWidth
	const labels: number[] = []
	for (let time = Math.ceil(start / HOUR_MS) * HOUR_MS; time < end; time += 2 * HOUR_MS) labels.push(time)

	// Converts a pointer position to viewBox units of the drawing.
	function unitsOf(event: PointerEvent<SVGRectElement>) {
		const svg = event.currentTarget.ownerSVGElement!.getBoundingClientRect()
		return ((event.clientX - svg.left) / svg.width) * WIDTH
	}

	// Moves a focused block with the keyboard.
	function onKeyDown(event: KeyboardEvent<SVGRectElement>, itemId: string, scheduledStartAt: number) {
		const step = (event.shiftKey ? 1 : 5) * MINUTE_MS
		const delta = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
		if (!delta) return
		event.preventDefault()
		onMove(itemId, roundToMinute(scheduledStartAt + delta))
	}

	return (
		<div className="overflow-x-auto">
			<svg viewBox={`0 0 ${WIDTH} ${height}`} className="block h-auto w-full min-w-[560px] text-[10px]">
				<title>Lanes of the plan's items over the night: windows hatched, scheduled blocks filled.</title>
				<defs>
					<pattern id="plan-window" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
						<line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-success)" strokeWidth="2" />
					</pattern>
				</defs>
				{skyBands(preview.night).map((band) => (
					<rect key={band.start} x={x(band.start)} y={AXIS_HEIGHT} width={Math.max(0, x(band.end) - x(band.start))} height={height - AXIS_HEIGHT} fill={SKY_FILLS[band.band]} />
				))}
				{labels.map((time) => (
					<g key={time}>
						<line x1={x(time)} x2={x(time)} y1={AXIS_HEIGHT - 4} y2={height} stroke="var(--color-line-100)" />
						<text x={x(time)} y={AXIS_HEIGHT - 8} textAnchor="middle" fill="var(--color-ink-300)">
							{formatClockTime(time, timeZone)}
						</text>
					</g>
				))}
				{plan.items.map((item, index) => {
					const top = AXIS_HEIGHT + index * LANE_HEIGHT
					const itemPreview = preview.items.find((e) => e.itemId === item.id)
					const conflicts = itemPreview?.conflicts ?? []
					const offset = drag?.itemId === item.id ? drag.offset : 0
					const scheduled = item.scheduledStartAt === undefined ? undefined : item.scheduledStartAt + offset

					return (
						<g key={item.id}>
							<line x1={0} x2={WIDTH} y1={top + LANE_HEIGHT} y2={top + LANE_HEIGHT} stroke="var(--color-line-100)" />
							<text x={4} y={top + LANE_HEIGHT / 2} dy="0.35em" fill="var(--color-ink-200)">
								{item.targetName.length > 24 ? `${item.targetName.slice(0, 23)}…` : item.targetName}
							</text>
							{itemPreview?.analysis.windows.map((window) => (
								<rect key={window.start} x={x(window.start)} y={top + 4} width={Math.max(1, x(window.end) - x(window.start))} height={LANE_HEIGHT - 8} fill="url(#plan-window)" opacity={0.35} />
							))}
							{scheduled !== undefined && (
								<rect
									x={x(scheduled)}
									y={top + 7}
									width={Math.max(2, x(scheduled + item.requestedDurationMs) - x(scheduled))}
									height={LANE_HEIGHT - 14}
									rx={3}
									tabIndex={0}
									fill={conflicts.length > 0 ? 'var(--color-danger)' : 'var(--color-accent)'}
									className="cursor-grab outline-none focus-visible:stroke-ink-100 focus-visible:stroke-2"
									onPointerDown={(event) => {
										event.currentTarget.setPointerCapture(event.pointerId)
										setDrag({ itemId: item.id, origin: unitsOf(event), offset: 0 })
									}}
									onPointerMove={(event) => drag?.itemId === item.id && setDrag({ ...drag, offset: (unitsOf(event) - drag.origin) * msPerUnit })}
									onPointerUp={() => {
										if (drag?.itemId === item.id && item.scheduledStartAt !== undefined && drag.offset !== 0) onMove(item.id, roundToMinute(item.scheduledStartAt + drag.offset))
										setDrag(undefined)
									}}
									onPointerCancel={() => setDrag(undefined)}
									onKeyDown={(event) => item.scheduledStartAt !== undefined && onKeyDown(event, item.id, item.scheduledStartAt)}
								>
									<title>{`${item.targetName}: ${formatClockTime(scheduled, timeZone)}–${formatClockTime(scheduled + item.requestedDurationMs, timeZone)}${conflicts.map((e) => `\n${CONFLICT_LABELS[e.code]}`).join('')}`}</title>
								</rect>
							)}
							{scheduled !== undefined && conflicts.length > 0 && (
								<text x={x(scheduled + item.requestedDurationMs) + 4} y={top + LANE_HEIGHT / 2} dy="0.35em" fill="var(--color-danger)">
									!
								</text>
							)}
						</g>
					)
				})}
			</svg>
		</div>
	)
}
