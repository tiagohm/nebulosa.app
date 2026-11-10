import type { SaturnRingEvent, SaturnRingTimeline } from 'api'
import type { KeyboardEvent, MouseEvent } from 'react'
import { formatDate, formatDegrees } from '../../format'
import { moveIndex } from '../../ui/navigation'
import { RING_EVENT_LABELS } from './saturn'

// Chart of Saturn's ring openings over a span of years: the signed Earth opening B and the signed solar opening B′
// against time, with the ring plane at zero, a marker at each ring-plane event the server found by search, and the
// clock's cursor. The curves are the server's samples; a crossing is only ever marked at its searched instant, never read
// off the curves. Choosing a marker, clicking, or the arrow keys move the tool's clock only.

// Size of the drawing, in viewBox units.
const WIDTH = 760
const HEIGHT = 240

// Margins of the plot, in viewBox units.
const MARGIN = { top: 12, right: 12, bottom: 28, left: 40 } as const

// Largest opening drawn, in degrees: Saturn's obliquity bounds both openings near ±29°.
const EXTENT = 30

// Openings of the grid lines, in degrees.
const GRID = [-30, -15, 0, 15, 30] as const

// Degrees per radian.
const DEGREES = 180 / Math.PI

// Milliseconds per Julian year.
const YEAR_MS = 365.25 * 86_400_000

// Colours of the Earth and solar openings.
const EARTH_COLOR = '#4aa3df'
const SUN_COLOR = '#e0a030'

export interface RingHistoryChartProps {
	readonly timeline: SaturnRingTimeline
	// Instant of the clock.
	readonly time?: number
	// IANA zone the dates are labeled in.
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

// Marker of an event: a diamond for a crossing, a small circle for an extremum or an approach.
function eventMark(event: SaturnRingEvent, x: number, y: number) {
	const crossing = event.kind === 'earthPlaneCrossing' || event.kind === 'solarPlaneCrossing'
	const color = event.kind === 'solarPlaneCrossing' ? SUN_COLOR : EARTH_COLOR
	return crossing ? <path d={`M${x},${y - 5}L${x + 5},${y}L${x},${y + 5}L${x - 5},${y}Z`} fill={color} stroke="var(--color-base-000)" /> : <circle cx={x} cy={y} r={3} fill="none" stroke={color} strokeWidth={1.5} />
}

// Chart of the ring openings over the history span.
export function RingHistoryChart({ timeline, time, timeZone, onTime }: RingHistoryChartProps) {
	const { times } = timeline
	const start = timeline.start
	const end = timeline.end
	const span = Math.max(1, end - start)
	const plotWidth = WIDTH - MARGIN.left - MARGIN.right
	const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
	const x = (t: number) => MARGIN.left + ((t - start) / span) * plotWidth
	const y = (degrees: number) => MARGIN.top + ((EXTENT - Math.max(-EXTENT, Math.min(EXTENT, degrees))) / (2 * EXTENT)) * plotHeight
	const every = span <= 2 * YEAR_MS ? YEAR_MS / 6 : span <= 12 * YEAR_MS ? YEAR_MS : 5 * YEAR_MS
	const labels: number[] = []
	for (let t = Math.ceil(start / every) * every; t <= end; t += every) labels.push(t)
	const cursorIndex = time === undefined ? 0 : Math.max(0, Math.min(times.length - 1, Math.round((time - start) / timeline.step)))

	// Moves the clock to the instant clicked.
	function onClick(event: MouseEvent<SVGSVGElement>) {
		const box = event.currentTarget.getBoundingClientRect()
		const t = start + (((event.clientX - box.left) / box.width) * WIDTH - MARGIN.left) * (span / plotWidth)
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
			<div className="overflow-x-auto">
				<svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} tabIndex={0} onClick={onClick} onKeyDown={onKeyDown} className="block h-auto w-full min-w-[520px] cursor-pointer text-[10px] outline-none focus-visible:outline-2 focus-visible:outline-accent">
					<title>Signed ring openings toward the Earth (B) and the Sun (B′) over the span; markers are the crossings and extrema found by search.</title>
					{GRID.map((degrees) => (
						<g key={degrees}>
							<line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(degrees)} y2={y(degrees)} stroke={degrees === 0 ? 'var(--color-line-200)' : 'var(--color-line-100)'} />
							<text x={MARGIN.left - 4} y={y(degrees)} dy="0.35em" textAnchor="end" fill="var(--color-ink-300)">
								{degrees === 0 ? '0°' : `${degrees > 0 ? '+' : '−'}${Math.abs(degrees)}°`}
							</text>
						</g>
					))}
					{labels.map((t) => (
						<text key={t} x={x(t)} y={HEIGHT - 10} textAnchor="middle" fill="var(--color-ink-300)">
							{formatDate(t, timeZone)}
						</text>
					))}
					<path d={seriesPath(times, timeline.solarOpening, x, y)} fill="none" stroke={SUN_COLOR} strokeWidth={1.5} strokeDasharray="4 3" />
					<path d={seriesPath(times, timeline.earthOpening, x, y)} fill="none" stroke={EARTH_COLOR} strokeWidth={1.75} />
					{timeline.events.map((event) => (
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
					{time !== undefined && time >= start && time <= end && <line x1={x(time)} x2={x(time)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke="var(--color-ink-100)" strokeDasharray="2 3" />}
				</svg>
			</div>
			<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-300">
				<span>
					<span style={{ color: EARTH_COLOR }}>━</span> Earth opening B (+ north face)
				</span>
				<span>
					<span style={{ color: SUN_COLOR }}>┅</span> Solar opening B′
				</span>
				<span>◆ plane crossing · ○ extremum or near approach</span>
			</div>
		</div>
	)
}
