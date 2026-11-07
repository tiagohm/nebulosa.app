import type { JupiterEvent, JupiterNight, JupiterTrack } from 'api'
import type { KeyboardEvent, MouseEvent } from 'react'
import { formatClockTime, formatDate } from '../../format'
import { moveIndex } from '../../ui/navigation'
import { equatorOffset } from '../planetary/planetary'
import { type GalileanMoon, GALILEAN_MOONS, MOON_COLORS, MOON_LABELS } from './jupiter'

// Chart of the Galilean moons over the period: each moon's offset along Jupiter's equator against time, east up, with
// the band of the planet's disk, the stretches the site can watch Jupiter, the selected event, and the clock's cursor.
// A moon behind the disk leaves a gap and a moon in Jupiter's umbra is drawn faint, from the states the server sampled;
// the contacts are never read from these samples. The cursor moves by a click or with the arrow keys, Home, and End.

// Size of the drawing, in viewBox units.
const WIDTH = 760
const HEIGHT = 300

// Margins of the plot, in viewBox units.
const MARGIN = { top: 12, right: 12, bottom: 28, left: 40 } as const

// Largest offset drawn, in Jupiter radii: Callisto's greatest elongation.
const EXTENT = 28

// Offsets of the grid lines, in Jupiter radii.
const GRID = [-20, -10, 0, 10, 20] as const

// Milliseconds per hour.
const HOUR_MS = 3_600_000

export interface MoonChartProps {
	readonly track: JupiterTrack
	// Position angle of Jupiter's projected pole, which sets the equator's direction on the sky.
	readonly poleAngle: number
	// Moons drawn.
	readonly moons: readonly GalileanMoon[]
	// Nights of the site with Jupiter's watchable windows; empty without a site.
	readonly nights: readonly JupiterNight[]
	// Event highlighted.
	readonly selected?: JupiterEvent
	// Instant of the clock.
	readonly time?: number
	// IANA zone the times are labeled in.
	readonly timeZone: string
	// Receives an instant chosen on the chart.
	readonly onTime: (time: number) => void
}

// Hours between two labels of the time axis for a span, so about six labels fit.
function labelHours(spanMs: number) {
	const hours = spanMs / HOUR_MS
	return hours <= 30 ? 3 : hours <= 80 ? 12 : hours <= 180 ? 24 : 48
}

// Paths of one moon: the solid stretches and the faint ones inside the umbra, broken where it is behind the disk.
function moonPaths(track: JupiterTrack, moon: GalileanMoon, poleAngle: number, x: (time: number) => number, y: (offset: number) => number) {
	const { east, north, disk, eclipse } = track.moons[moon]
	let solid = ''
	let faint = ''
	let previous: 'solid' | 'faint' | undefined

	for (let i = 0; i < track.times.length; i++) {
		const kind = disk[i] === 'occulted' ? undefined : eclipse[i] === 'umbra' ? 'faint' : 'solid'
		const point = `${x(track.times[i]).toFixed(1)},${y(equatorOffset(east[i], north[i], poleAngle)).toFixed(1)} `

		if (kind === 'solid') solid += `${previous === 'solid' ? 'L' : 'M'}${point}`
		else if (kind === 'faint') faint += `${previous === 'faint' ? 'L' : 'M'}${point}`
		previous = kind
	}

	return { solid, faint }
}

// Chart of the moons over the period.
export function MoonChart({ track, poleAngle, moons, nights, selected, time, timeZone, onTime }: MoonChartProps) {
	const start = track.times[0]
	const end = track.times.at(-1)!
	const span = Math.max(1, end - start)
	const plotWidth = WIDTH - MARGIN.left - MARGIN.right
	const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
	const x = (t: number) => MARGIN.left + ((t - start) / span) * plotWidth
	const y = (offset: number) => MARGIN.top + ((EXTENT - Math.max(-EXTENT, Math.min(EXTENT, offset))) / (2 * EXTENT)) * plotHeight
	const every = labelHours(span) * HOUR_MS
	const labels: number[] = []
	for (let t = Math.ceil(start / every) * every; t <= end; t += every) labels.push(t)
	const cursorIndex = time === undefined ? 0 : Math.max(0, Math.min(track.times.length - 1, Math.round((time - start) / track.step)))
	const windows = nights.flatMap((night) => night.windows)

	// Moves the clock to the instant clicked.
	function onClick(event: MouseEvent<SVGSVGElement>) {
		const box = event.currentTarget.getBoundingClientRect()
		const t = start + (((event.clientX - box.left) / box.width) * WIDTH - MARGIN.left) * (span / plotWidth)
		onTime(Math.max(start, Math.min(end, t)))
	}

	// Moves the clock one sample with the keyboard.
	function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
		const index = moveIndex(cursorIndex, track.times.length, event.key)
		if (index === undefined) return
		event.preventDefault()
		onTime(track.times[index])
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="overflow-x-auto">
				<svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} tabIndex={0} onClick={onClick} onKeyDown={onKeyDown} className="block h-auto w-full min-w-[520px] cursor-pointer text-[10px] outline-none focus-visible:outline-2 focus-visible:outline-accent">
					<title>Offsets of the Galilean moons along Jupiter's equator over the period, east up; gaps are the moons behind the planet and faint stretches the moons in its shadow.</title>
					{windows.map((window) => (
						<rect key={window.start} x={x(Math.max(start, window.start))} y={MARGIN.top} width={Math.max(0, x(Math.min(end, window.end)) - x(Math.max(start, window.start)))} height={plotHeight} fill="var(--color-success)" opacity={0.08}>
							<title>{`Jupiter watchable ${formatClockTime(window.start, timeZone)}–${formatClockTime(window.end, timeZone)}`}</title>
						</rect>
					))}
					{selected && <rect x={x(Math.max(start, selected.start))} y={MARGIN.top} width={Math.max(1, x(Math.min(end, selected.end)) - x(Math.max(start, selected.start)))} height={plotHeight} fill="var(--color-accent)" opacity={0.15} />}
					<rect x={MARGIN.left} y={y(1)} width={plotWidth} height={y(-1) - y(1)} fill="#d8c3a0" opacity={0.45}>
						<title>Jupiter's disk</title>
					</rect>
					{GRID.map((offset) => (
						<g key={offset}>
							<line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(offset)} y2={y(offset)} stroke="var(--color-line-100)" />
							<text x={MARGIN.left - 4} y={y(offset)} dy="0.35em" textAnchor="end" fill="var(--color-ink-300)">
								{offset === 0 ? '0' : `${Math.abs(offset)} ${offset > 0 ? 'E' : 'W'}`}
							</text>
						</g>
					))}
					{labels.map((t) => (
						<text key={t} x={x(t)} y={HEIGHT - 10} textAnchor="middle" fill="var(--color-ink-300)">
							{every >= 24 * HOUR_MS ? formatDate(t, timeZone) : formatClockTime(t, timeZone)}
						</text>
					))}
					{GALILEAN_MOONS.filter((moon) => moons.includes(moon)).map((moon) => {
						const { solid, faint } = moonPaths(track, moon, poleAngle, x, y)
						return (
							<g key={moon}>
								<path d={faint} fill="none" stroke={MOON_COLORS[moon]} strokeWidth={1.5} strokeDasharray="2 3" opacity={0.6} />
								<path d={solid} fill="none" stroke={MOON_COLORS[moon]} strokeWidth={1.75} />
							</g>
						)
					})}
					{time !== undefined && time >= start && time <= end && <line x1={x(time)} x2={x(time)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke="var(--color-ink-100)" strokeDasharray="2 3" />}
				</svg>
			</div>
			<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-300">
				{GALILEAN_MOONS.filter((moon) => moons.includes(moon)).map((moon) => (
					<span key={moon}>
						<span style={{ color: MOON_COLORS[moon] }}>━</span> {MOON_LABELS[moon]}
					</span>
				))}
				<span>gap: behind Jupiter</span>
				<span>┄ in Jupiter's shadow</span>
				{windows.length > 0 && <span className="text-success">▮ Jupiter watchable from the site</span>}
			</div>
		</div>
	)
}
