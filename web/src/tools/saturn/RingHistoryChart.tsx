import type { SaturnRingEvent, SaturnRingTimeline } from 'api'
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from 'react'
import { formatDate, formatDegrees } from '../../format'
import { moveIndex } from '../../ui/navigation'
import { RING_EVENT_LABELS } from './saturn'

// Chart of Saturn's ring openings over a span of years: the signed Earth opening B and the signed solar opening B′
// against time, with the ring plane at zero, a marker at each ring-plane event the server found by search, and the
// clock's cursor. The crossings are the marks that matter, drawn as diamonds in their curve's colour; the extrema, a
// pair a year as the Earth goes round, are small muted circles, and a near approach to the plane a ring in the Earth's
// colour. The curves are the server's samples; a crossing is only ever marked at its searched instant, never read off
// the curves. The time axis is labeled on calendar boundaries (UTC months or years, as many as fit), and the drawing is
// in CSS pixels at the measured width, so it never scrolls sideways. Choosing a marker, clicking, or the arrow keys move
// the tool's clock only.

// Height of the chart, in CSS pixels: two fifths of its width, kept between these bounds.
const MIN_HEIGHT = 200
const MAX_HEIGHT = 280

// Width assumed before the frame is measured, in CSS pixels.
const INITIAL_WIDTH = 520

// Margins of the plot, in CSS pixels.
const MARGIN = { top: 12, right: 12, bottom: 24, left: 44 } as const

// Size of the chart's text, in CSS pixels.
const TEXT_PX = 11

// Width of a character of the chart's text, in CSS pixels: JetBrains Mono's advance of 0.6 em at TEXT_PX.
const CHARACTER_PX = 6.6

// Smallest horizontal room between two time labels, in CSS pixels.
const LABEL_ROOM_PX = 14

// Largest opening drawn, in degrees: Saturn's obliquity bounds both openings near ±29°.
const EXTENT = 30

// Openings of the grid lines, in degrees.
const GRID = [-30, -15, 0, 15, 30] as const

// Degrees per radian.
const DEGREES = 180 / Math.PI

// Months between two time labels, the first that leaves room for them.
const MONTH_STEPS = [1, 2, 3, 6, 12, 24, 60, 120] as const

// Average length of a month, milliseconds (a Julian year over twelve).
const MONTH_MS = (365.25 * 86_400_000) / 12

// Colour of the Earth opening: Starlight Cream, the chart's main curve.
const EARTH_COLOR = 'var(--color-ink-100)'

// Colour of the solar opening: the muted Sun gold of web/src/index.css.
const SUN_COLOR = 'var(--color-saturn-sun)'

// A label of the time axis: its instant and text.
export interface CalendarTick {
	readonly time: number
	readonly label: string
}

// Labels of the time axis between start and end (Unix milliseconds) on calendar boundaries in UTC: the first month step
// whose labels, `pixelsPerMonth` apart per month, leave room for their text, then every month start on a whole multiple
// of it, named YYYY-MM below a year and YYYY from a year.
export function calendarTicks(start: number, end: number, pixelsPerMonth: number): CalendarTick[] {
	const room = (months: number) => (months < 12 ? 7 : 4) * CHARACTER_PX + LABEL_ROOM_PX
	const step = MONTH_STEPS.find((months) => months * pixelsPerMonth >= room(months)) ?? MONTH_STEPS.at(-1)!
	const first = new Date(start)
	const out: CalendarTick[] = []

	for (let index = first.getUTCFullYear() * 12 + first.getUTCMonth(); ; index++) {
		const year = Math.floor(index / 12)
		const month = index % 12
		const time = Date.UTC(year, month, 1)
		if (time > end) break
		if (time < start || index % step !== 0) continue
		out.push({ time, label: step < 12 ? `${year}-${String(month + 1).padStart(2, '0')}` : `${year}` })
	}

	return out
}

export interface RingHistoryChartProps {
	readonly timeline: SaturnRingTimeline
	// Instant of the clock.
	readonly time?: number
	// IANA zone the dates of the markers are named in.
	readonly timeZone: string
	// Receives an instant chosen on the chart.
	readonly onTime: (time: number) => void
}

// Path of a series of openings (radians) against the samples.
function seriesPath(times: readonly number[], values: readonly number[], x: (time: number) => number, y: (degrees: number) => number) {
	let d = ''
	for (let i = 0; i < times.length; i++) d += `${i === 0 ? 'M' : 'L'}${x(times[i]).toFixed(1)},${y(values[i] * DEGREES).toFixed(1)}`
	return d
}

// Marker of an event: a diamond for a crossing, a ring for a near approach, a small muted circle for an extremum.
function eventMark(event: SaturnRingEvent, x: number, y: number) {
	if (event.kind === 'earthPlaneCrossing' || event.kind === 'solarPlaneCrossing') {
		const color = event.kind === 'solarPlaneCrossing' ? SUN_COLOR : EARTH_COLOR
		return <path d={`M${x},${y - 6}L${x + 6},${y}L${x},${y + 6}L${x - 6},${y}Z`} fill={color} stroke="var(--color-base-000)" strokeWidth={1.5} />
	}

	if (event.kind === 'nearPlaneApproach') return <circle cx={x} cy={y} r={4} fill="none" stroke={EARTH_COLOR} strokeWidth={1.5} />
	return <circle cx={x} cy={y} r={2} fill="var(--color-ink-300)" opacity={0.7} />
}

// Chart of the ring openings over the history span.
export function RingHistoryChart({ timeline, time, timeZone, onTime }: RingHistoryChartProps) {
	const frame = useRef<HTMLDivElement>(null)
	const [measured, setMeasured] = useState(0)

	// Follows the width of the frame.
	useEffect(() => {
		const element = frame.current
		if (!element) return undefined
		const observer = new ResizeObserver(([entry]) => setMeasured(entry.contentRect.width))
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	const width = measured > 0 ? measured : INITIAL_WIDTH
	const height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, width * 0.4)))
	const { times } = timeline
	const start = timeline.start
	const end = timeline.end
	const span = Math.max(1, end - start)
	const plotWidth = width - MARGIN.left - MARGIN.right
	const plotHeight = height - MARGIN.top - MARGIN.bottom
	const x = (t: number) => MARGIN.left + ((t - start) / span) * plotWidth
	const y = (degrees: number) => MARGIN.top + ((EXTENT - Math.max(-EXTENT, Math.min(EXTENT, degrees))) / (2 * EXTENT)) * plotHeight
	const ticks = calendarTicks(start, end, (plotWidth * MONTH_MS) / span).filter((tick) => {
		const half = (tick.label.length * CHARACTER_PX) / 2
		return x(tick.time) - half >= 0 && x(tick.time) + half <= width
	})
	const cursorIndex = time === undefined ? 0 : Math.max(0, Math.min(times.length - 1, Math.round((time - start) / timeline.step)))
	// Extrema first, so the crossings are drawn over them.
	const events = [...timeline.events].sort((a, b) => Number(a.kind === 'earthPlaneCrossing' || a.kind === 'solarPlaneCrossing') - Number(b.kind === 'earthPlaneCrossing' || b.kind === 'solarPlaneCrossing'))
	const crossings = timeline.events.some((event) => event.kind === 'earthPlaneCrossing' || event.kind === 'solarPlaneCrossing')

	// Moves the clock to the instant clicked.
	function onClick(event: MouseEvent<SVGSVGElement>) {
		const box = event.currentTarget.getBoundingClientRect()
		const t = start + (((event.clientX - box.left) * (width / box.width) - MARGIN.left) / plotWidth) * span
		onTime(Math.max(start, Math.min(end, t)))
	}

	// Moves the clock one sample with the keyboard.
	function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
		const index = moveIndex(cursorIndex, times.length, event.key)
		if (index === undefined) return
		event.preventDefault()
		onTime(times[index])
	}

	return (
		<div className="flex flex-col gap-2">
			<div ref={frame} className="min-w-0">
				<svg
					viewBox={`0 0 ${width} ${height}`}
					width={width}
					height={height}
					tabIndex={0}
					onClick={onClick}
					onKeyDown={onKeyDown}
					fontSize={TEXT_PX}
					className="block max-w-full cursor-pointer rounded border border-line-100 bg-base-000 outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-accent"
				>
					<title>Signed ring openings toward the Earth (B) and the Sun (B′) over the span; diamonds are the crossings of the ring plane found by search. Click or use the arrow keys to move the clock.</title>
					{GRID.map((degrees) => (
						<g key={degrees}>
							<line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(degrees)} y2={y(degrees)} stroke={degrees === 0 ? 'var(--color-line-200)' : 'var(--color-line-100)'} />
							<text x={MARGIN.left - 6} y={y(degrees)} dy="0.35em" textAnchor="end" fill="var(--color-ink-300)">
								{degrees === 0 ? '0°' : `${degrees > 0 ? '+' : '−'}${Math.abs(degrees)}°`}
							</text>
						</g>
					))}
					{ticks.map((tick) => (
						<g key={tick.time}>
							<line x1={x(tick.time)} x2={x(tick.time)} y1={MARGIN.top + plotHeight} y2={MARGIN.top + plotHeight + 4} stroke="var(--color-line-200)" />
							<text x={x(tick.time)} y={height - 7} textAnchor="middle" fill="var(--color-ink-300)">
								{tick.label}
							</text>
						</g>
					))}
					<path d={seriesPath(times, timeline.solarOpening, x, y)} fill="none" stroke={SUN_COLOR} strokeWidth={1.5} strokeDasharray="5 3" />
					<path d={seriesPath(times, timeline.earthOpening, x, y)} fill="none" stroke={EARTH_COLOR} strokeWidth={1.75} />
					{events.map((event) => (
						<g
							key={`${event.kind}|${event.time}`}
							onClick={(e) => {
								e.stopPropagation()
								onTime(event.time)
							}}
						>
							{eventMark(event, x(event.time), y((event.kind === 'solarPlaneCrossing' ? event.solarOpening : event.earthOpening) * DEGREES))}
							<title>{`${RING_EVENT_LABELS[event.kind]} · ${formatDate(event.time, timeZone)} · B ${formatDegrees(event.earthOpening, 2)} · B′ ${formatDegrees(event.solarOpening, 2)}`}</title>
						</g>
					))}
					{time !== undefined && time >= start && time <= end && <line x1={x(time)} x2={x(time)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke="var(--color-ink-200)" strokeDasharray="3 3" />}
				</svg>
			</div>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-300">
				<span className="inline-flex items-center gap-1.5">
					<span className="inline-block h-0.5 w-3.5 rounded-full bg-ink-100" />
					Earth opening B (+ north face)
				</span>
				<span className="inline-flex items-center gap-1.5">
					<span className="inline-block w-3.5 border-t-2 border-dashed border-saturn-sun" />
					Solar opening B′ (+ north face lit)
				</span>
				{crossings && (
					<span className="inline-flex items-center gap-1.5">
						<span className="inline-block size-2 rotate-45 bg-ink-200" />
						Ring-plane crossing
					</span>
				)}
				<span className="inline-flex items-center gap-1.5">
					<span className="inline-block size-1 rounded-full bg-ink-300" />
					Widest or narrowest opening
				</span>
			</div>
		</div>
	)
}
