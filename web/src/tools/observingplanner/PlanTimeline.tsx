import type { ObservingPlanDocument, ObservingPlanPreview } from 'api'
import { cn } from 'cn'
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react'
import { formatClockTime, formatSpan } from '../../format'
import { Icon } from '../../ui/Icon'
import { moveIndex } from '../../ui/navigation'
import { type SkyBand, skyBands } from '../astroweather/astroweather'
import { CONFLICT_LABELS } from './observingplanner'

// Timeline of a night plan, the main surface of the Night Plan: one lane per item over the displayed night, in plan order,
// over the bands of the sky, with the item's windows hatched, its scheduled block filled, and a line at the current time
// while the night is shown. A lane is selected by a click or, with the timeline focused, by the up and down arrows, Home,
// and End; the selected block moves with the left and right arrows (5 minutes, or 1 with Shift), Enter schedules an
// unscheduled item, and a block is dragged by mouse, pen, or touch. Every move gives the same canonical start, rounded to
// the minute. Drawn in HTML over percentages of the night, so its text keeps its size at any width. Nothing moves a block
// on its own.

// Fill of each band of the sky.
const SKY_FILLS: Readonly<Record<SkyBand, string>> = { day: 'bg-base-300', twilight: 'bg-base-200', dark: 'bg-base-000' }

// Hatch of an observing window, in the success tone.
const WINDOW_HATCH = 'bg-[repeating-linear-gradient(45deg,var(--color-success)_0_1.5px,transparent_1.5px_6px)] opacity-40'

// Height of a lane and of its label: 36 px, 44 px on phones so a lane is a comfortable touch target.
const LANE_HEIGHT = 'h-9 max-sm:h-11'

// Milliseconds per minute and per hour.
const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

// Hours between two labels of the time axis.
const LABEL_HOURS = 2

// Closest an hour label may stand to the current time, in milliseconds, before the "Now" label replaces it.
const NOW_CLEARANCE_MS = 45 * MINUTE_MS

export interface PlanTimelineProps {
	// Plan drawn.
	readonly plan: ObservingPlanDocument
	// Its preview.
	readonly preview: ObservingPlanPreview
	// IANA zone the times are labeled in.
	readonly timeZone: string
	// Current time, Unix milliseconds.
	readonly now: number
	// Id of the item selected.
	readonly selected?: string
	// Selects an item.
	readonly onSelect: (itemId: string) => void
	// Receives the new start of an item, Unix milliseconds rounded to the minute.
	readonly onMove: (itemId: string, start: number) => void
	// Schedules an unscheduled item at its first window.
	readonly onSchedule: (itemId: string) => void
}

// Block being dragged: its item, the pointer's starting x in CSS pixels, and how far it moved, in milliseconds.
interface Drag {
	readonly itemId: string
	readonly originX: number
	readonly offset: number
}

// Rounds an instant to the minute.
function roundToMinute(time: number) {
	return Math.round(time / MINUTE_MS) * MINUTE_MS
}

// Timeline of a night plan.
export function PlanTimeline({ plan, preview, timeZone, now, selected, onSelect, onMove, onSchedule }: PlanTimelineProps) {
	const [drag, setDrag] = useState<Drag>()
	const plot = useRef<HTMLDivElement>(null)
	const { start, end } = preview.night.display
	const span = Math.max(1, end - start)
	// Position of an instant on the night, as a CSS percentage clamped to the drawing.
	const at = (time: number) => `${(Math.min(1, Math.max(0, (time - start) / span)) * 100).toFixed(3)}%`
	const width = (from: number, to: number) => `${(Math.max(0, (Math.min(end, to) - Math.max(start, from)) / span) * 100).toFixed(3)}%`
	const nowShown = now >= start && now <= end
	const labels: number[] = []
	for (let time = Math.ceil(start / (LABEL_HOURS * HOUR_MS)) * LABEL_HOURS * HOUR_MS; time < end; time += LABEL_HOURS * HOUR_MS) if (!nowShown || Math.abs(time - now) > NOW_CLEARANCE_MS) labels.push(time)
	const index = plan.items.findIndex((item) => item.id === selected)

	// Selects a lane with the vertical keys, moves the selected block with the horizontal ones, and schedules it with Enter.
	function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		const item = plan.items[index]

		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			if (item?.scheduledStartAt === undefined) return
			event.preventDefault()
			const step = (event.shiftKey ? 1 : 5) * MINUTE_MS
			onMove(item.id, roundToMinute(item.scheduledStartAt + (event.key === 'ArrowRight' ? step : -step)))
		} else if (event.key === 'Enter') {
			if (!item || item.scheduledStartAt !== undefined) return
			event.preventDefault()
			onSchedule(item.id)
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Home' || event.key === 'End') {
			const next = moveIndex(index, plan.items.length, event.key)
			if (next === undefined) return
			event.preventDefault()
			onSelect(plan.items[next].id)
		}
	}

	// Starts dragging a block and selects its item.
	function onPointerDown(event: PointerEvent<HTMLDivElement>, itemId: string) {
		event.stopPropagation()
		event.currentTarget.setPointerCapture(event.pointerId)
		setDrag({ itemId, originX: event.clientX, offset: 0 })
		onSelect(itemId)
	}

	// Follows the pointer of the block being dragged.
	function onPointerMove(event: PointerEvent<HTMLDivElement>, itemId: string) {
		const pixels = plot.current?.getBoundingClientRect().width
		if (drag?.itemId !== itemId || !pixels) return
		setDrag({ ...drag, offset: ((event.clientX - drag.originX) / pixels) * span })
	}

	// Writes the start of a block where it was released.
	function onPointerUp(itemId: string, scheduledStartAt: number) {
		if (drag?.itemId === itemId && drag.offset !== 0) onMove(itemId, roundToMinute(scheduledStartAt + drag.offset))
		setDrag(undefined)
	}

	return (
		<div tabIndex={0} onKeyDown={onKeyDown} className="overflow-hidden rounded-md border border-line-100 bg-base-100 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
			<div className="grid grid-cols-[7rem_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)]">
				<div className="border-r border-b border-line-100" />
				<div className="relative h-7 border-b border-line-100 text-xs tabular-nums">
					{labels.map((time) => (
						<span key={time} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-ink-300 max-sm:[&:nth-child(even)]:hidden" style={{ left: at(time) }}>
							{formatClockTime(time, timeZone)}
						</span>
					))}
					{nowShown && (
						<span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 font-medium text-ink-100" style={{ left: at(now) }} title={`Now, ${formatClockTime(now, timeZone)}`}>
							Now
						</span>
					)}
				</div>
				<div className="flex flex-col border-r border-line-100">
					{plan.items.map((item) => {
						const conflicts = preview.items.find((e) => e.itemId === item.id)?.conflicts ?? []
						return (
							<div
								key={item.id}
								title={[item.targetName, ...conflicts.map((e) => CONFLICT_LABELS[e.code])].join('\n')}
								onClick={() => onSelect(item.id)}
								className={cn('flex min-w-0 cursor-pointer items-center gap-1.5 border-b border-line-100 px-2 text-xs last:border-b-0', LANE_HEIGHT, item.id === selected ? 'bg-accent-subtle text-accent' : 'text-ink-200 hover:bg-base-300')}
							>
								{conflicts.length > 0 && (
									<>
										<Icon name="warning" className="size-3.5 flex-none text-danger" />
										<span className="sr-only">Problem:</span>
									</>
								)}
								<span className="truncate">{item.targetName}</span>
							</div>
						)
					})}
				</div>
				<div ref={plot} className="relative">
					{skyBands(preview.night).map((band) => (
						<div key={band.start} className={cn('absolute inset-y-0', SKY_FILLS[band.band])} style={{ left: at(band.start), width: width(band.start, band.end) }} />
					))}
					{labels.map((time) => (
						<div key={time} className="absolute inset-y-0 w-px bg-line-100" style={{ left: at(time) }} />
					))}
					{plan.items.map((item) => {
						const itemPreview = preview.items.find((e) => e.itemId === item.id)
						const conflicts = itemPreview?.conflicts ?? []
						const scheduled = item.scheduledStartAt === undefined ? undefined : item.scheduledStartAt + (drag?.itemId === item.id ? drag.offset : 0)
						const chosen = item.id === selected

						return (
							<div key={item.id} onPointerDown={() => onSelect(item.id)} className={cn('relative border-b border-line-100 last:border-b-0', LANE_HEIGHT, chosen && 'bg-ink-100/5')}>
								{itemPreview?.analysis.windows.map((window) => (
									<div key={window.start} className={cn('absolute inset-y-1', WINDOW_HATCH)} style={{ left: at(window.start), width: width(window.start, window.end) }} title={`Window ${formatSpan(window.start, window.end, timeZone)}`} />
								))}
								{scheduled === undefined ? (
									<span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-ink-300">Not scheduled</span>
								) : (
									<div
										title={`${item.targetName}: ${formatSpan(scheduled, scheduled + item.requestedDurationMs, timeZone)}${conflicts.map((e) => `\n${CONFLICT_LABELS[e.code]}`).join('')}`}
										onPointerDown={(event) => onPointerDown(event, item.id)}
										onPointerMove={(event) => onPointerMove(event, item.id)}
										onPointerUp={() => item.scheduledStartAt !== undefined && onPointerUp(item.id, item.scheduledStartAt)}
										onPointerCancel={() => setDrag(undefined)}
										onLostPointerCapture={() => setDrag(undefined)}
										className={cn('absolute inset-y-2 min-w-0.5 cursor-grab touch-none rounded-sm max-sm:inset-y-2.5', conflicts.length > 0 ? 'bg-danger' : 'bg-accent', chosen && 'ring-1 ring-ink-100', drag?.itemId === item.id && 'cursor-grabbing')}
										style={{ left: at(scheduled), width: width(scheduled, scheduled + item.requestedDurationMs) }}
									/>
								)}
							</div>
						)
					})}
					{nowShown && <div className="pointer-events-none absolute inset-y-0 w-px bg-ink-100" style={{ left: at(now) }} />}
				</div>
			</div>
		</div>
	)
}
