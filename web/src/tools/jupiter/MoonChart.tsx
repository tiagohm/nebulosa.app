import type { JupiterEvent, JupiterNight, JupiterTrack } from 'api'
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from 'react'
import { formatClockTime, formatDate } from '../../format'
import { zonedWallTime } from '../../location/zone'
import { moveIndex } from '../../ui/navigation'
import { equatorOffset, type PlanetOrientation } from '../planetary/planetary'
import { type GalileanMoon, GALILEAN_MOONS, MOON_COLORS, MOON_INITIALS, MOON_LABELS } from './jupiter'

// Chart of the Galilean moons over the period, the way observers print it: time runs down, and each moon's offset along
// Jupiter's equator runs across, east on the side the viewer's orientation puts it, so a row of the chart reads like
// the viewer at that instant. It shows the band of the planet's disk, the stretches the site can watch Jupiter, the
// selected event, the clock's cursor, a line and the date at each local midnight, and each curve labelled with its
// moon's initial at the top and at every midnight, so no curve is told apart by colour alone. A moon behind the disk
// leaves a gap and a moon in Jupiter's umbra is drawn faint, from the states the server sampled; the contacts are never
// read from these samples. The drawing is in CSS pixels at the measured width, so its text keeps one size on a phone and
// a desktop and it never scrolls sideways. The cursor moves by a click or with the arrow keys, Home, and End.

// Height of the chart, in CSS pixels: its width, kept between these bounds.
const MIN_HEIGHT = 320
const MAX_HEIGHT = 480

// Width assumed before the frame is measured, in CSS pixels.
const INITIAL_WIDTH = 480

// Margins of the plot, in CSS pixels: the times on the left, the initials above, the offsets below.
const MARGIN = { top: 22, right: 10, bottom: 22, left: 78 } as const

// Size of the chart's text, in CSS pixels.
const TEXT_PX = 11

// Largest offset drawn, in Jupiter radii: Callisto's greatest elongation.
const EXTENT = 28

// Offsets of the grid lines, in Jupiter radii.
const GRID = [-20, -10, 0, 10, 20] as const

// Milliseconds per hour.
const HOUR_MS = 3_600_000

// Hours between two time labels, the first that leaves at least LABEL_GAP_PX between them.
const LABEL_STEPS = [1, 2, 3, 6, 12] as const

// Smallest vertical distance between two time labels, in CSS pixels.
const LABEL_GAP_PX = 30

export interface MoonChartProps {
	readonly track: JupiterTrack
	// Position angle of Jupiter's projected pole, which sets the equator's direction on the sky.
	readonly poleAngle: number
	// Orientation of the viewer, which puts east on the left (north up) or on the right.
	readonly orientation: PlanetOrientation
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

// Instants of the local midnights between start and end in a zone, found hour by hour, so a daylight-saving change
// cannot skip one.
function midnights(start: number, end: number, timeZone: string) {
	const out: number[] = []
	for (let t = Math.ceil(start / HOUR_MS) * HOUR_MS; t <= end; t += HOUR_MS) {
		const { hour, minute } = zonedWallTime(t, timeZone)
		if (hour === 0 && minute === 0) out.push(t)
	}
	return out
}

// Paths of one moon: the solid stretches and the faint ones inside the umbra, broken where it is behind the disk.
function moonPaths(track: JupiterTrack, moon: GalileanMoon, poleAngle: number, x: (offset: number) => number, y: (time: number) => number) {
	const { east, north, disk, eclipse } = track.moons[moon]
	let solid = ''
	let faint = ''
	let previous: 'solid' | 'faint' | undefined

	for (let i = 0; i < track.times.length; i++) {
		const kind = disk[i] === 'occulted' ? undefined : eclipse[i] === 'umbra' ? 'faint' : 'solid'
		const point = `${x(equatorOffset(east[i], north[i], poleAngle)).toFixed(1)},${y(track.times[i]).toFixed(1)} `

		if (kind === 'solid') solid += `${previous === 'solid' ? 'L' : 'M'}${point}`
		else if (kind === 'faint') faint += `${previous === 'faint' ? 'L' : 'M'}${point}`
		previous = kind
	}

	return { solid, faint }
}

// Offset along the equator of a moon at the sample nearest an instant, in Jupiter radii.
function offsetAt(track: JupiterTrack, moon: GalileanMoon, poleAngle: number, time: number) {
	const i = Math.max(0, Math.min(track.times.length - 1, Math.round((time - track.times[0]) / track.step)))
	return equatorOffset(track.moons[moon].east[i], track.moons[moon].north[i], poleAngle)
}

// Chart of the moons over the period.
export function MoonChart({ track, poleAngle, orientation, moons, nights, selected, time, timeZone, onTime }: MoonChartProps) {
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
	const height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, width)))
	const start = track.times[0]
	const end = track.times.at(-1)!
	const span = Math.max(1, end - start)
	const plotWidth = width - MARGIN.left - MARGIN.right
	const plotHeight = height - MARGIN.top - MARGIN.bottom
	// East is on the left with north up, as the naked eye sees it, and on the right in the other orientations.
	const east = orientation === 'north' ? -1 : 1
	const x = (offset: number) => MARGIN.left + ((EXTENT + east * Math.max(-EXTENT, Math.min(EXTENT, offset))) / (2 * EXTENT)) * plotWidth
	const y = (t: number) => MARGIN.top + ((t - start) / span) * plotHeight
	const pixelsPerHour = (plotHeight * HOUR_MS) / span
	const step = LABEL_STEPS.find((hours) => hours * pixelsPerHour >= LABEL_GAP_PX)
	const days = midnights(start, end, timeZone)
	const labels: number[] = []
	// The hours on a whole step of the display zone, leaving out those too close to a date to read apart from it.
	if (step) for (let t = Math.ceil(start / HOUR_MS) * HOUR_MS; t <= end; t += HOUR_MS) if (zonedWallTime(t, timeZone).hour % step === 0 && !days.some((day) => Math.abs(y(day) - y(t)) < LABEL_GAP_PX)) labels.push(t)
	const cursorIndex = time === undefined ? 0 : Math.max(0, Math.min(track.times.length - 1, Math.round((time - start) / track.step)))
	const windows = nights.flatMap((night) => night.windows)
	const drawn = GALILEAN_MOONS.filter((moon) => moons.includes(moon))

	// Moves the clock to the instant clicked.
	function onClick(event: MouseEvent<SVGSVGElement>) {
		const box = event.currentTarget.getBoundingClientRect()
		const t = start + ((event.clientY - box.top - MARGIN.top) / plotHeight) * span
		onTime(Math.max(start, Math.min(end, t)))
	}

	// Moves the clock one sample with the keyboard.
	function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
		const index = moveIndex(cursorIndex, track.times.length, event.key)
		if (index === undefined) return
		event.preventDefault()
		onTime(track.times[index])
	}

	// Initial of a moon at its curve at an instant, outlined in the background so it reads over the grid and the bands.
	const initial = (moon: GalileanMoon, t: number, dy: number) => (
		<text key={`${moon}-${t}`} x={x(offsetAt(track, moon, poleAngle, t))} y={y(t) + dy} textAnchor="middle" fill={MOON_COLORS[moon]} stroke="var(--color-base-000)" strokeWidth={3} paintOrder="stroke" fontWeight={600}>
			{MOON_INITIALS[moon]}
		</text>
	)

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
					className="block max-w-full cursor-pointer rounded border border-line-100 bg-base-000 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
				>
					<title>{`Offsets of the Galilean moons along Jupiter's equator over the period, time running down and east on the ${east < 0 ? 'left' : 'right'}; gaps are the moons behind the planet and faint stretches the moons in its shadow. Click or use the arrow keys to move the clock.`}</title>
					{windows.map((window) => (
						<rect key={window.start} x={MARGIN.left} y={y(Math.max(start, window.start))} width={plotWidth} height={Math.max(0, y(Math.min(end, window.end)) - y(Math.max(start, window.start)))} fill="var(--color-success)" opacity={0.08}>
							<title>{`Jupiter watchable ${formatClockTime(window.start, timeZone)}–${formatClockTime(window.end, timeZone)}`}</title>
						</rect>
					))}
					{selected && <rect x={MARGIN.left} y={y(Math.max(start, selected.start))} width={plotWidth} height={Math.max(2, y(Math.min(end, selected.end)) - y(Math.max(start, selected.start)))} fill="var(--color-accent)" opacity={0.18} />}
					<rect x={Math.min(x(1), x(-1))} y={MARGIN.top} width={Math.abs(x(1) - x(-1))} height={plotHeight} fill="var(--color-jupiter-disk)" opacity={0.2}>
						<title>Jupiter's disk</title>
					</rect>
					{GRID.map((offset) => (
						<g key={offset}>
							<line x1={x(offset)} x2={x(offset)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke="var(--color-line-100)" />
							<text x={x(offset)} y={height - 7} textAnchor="middle" fill="var(--color-ink-300)">
								{offset === 0 ? '0' : `${Math.abs(offset)} ${offset > 0 ? 'E' : 'W'}`}
							</text>
						</g>
					))}
					{labels.map((t) => (
						<text key={t} x={MARGIN.left - 6} y={y(t)} dy="0.35em" textAnchor="end" fill="var(--color-ink-300)">
							{formatClockTime(t, timeZone)}
						</text>
					))}
					{days.map((day) => (
						<g key={day}>
							<line x1={MARGIN.left - 4} x2={width - MARGIN.right} y1={y(day)} y2={y(day)} stroke="var(--color-line-200)" />
							<text x={MARGIN.left - 6} y={y(day)} dy="0.35em" textAnchor="end" fill="var(--color-ink-200)">
								{formatDate(day, timeZone)}
							</text>
						</g>
					))}
					{drawn.map((moon) => {
						const { solid, faint } = moonPaths(track, moon, poleAngle, x, y)
						return (
							<g key={moon}>
								<path d={faint} fill="none" stroke={MOON_COLORS[moon]} strokeWidth={1.5} strokeDasharray="2 3" opacity={0.7} />
								<path d={solid} fill="none" stroke={MOON_COLORS[moon]} strokeWidth={1.75} />
							</g>
						)
					})}
					{drawn.map((moon) => initial(moon, start, -8))}
					{days.flatMap((day) => drawn.map((moon) => initial(moon, day, -4)))}
					{time !== undefined && time >= start && time <= end && <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(time)} y2={y(time)} stroke="var(--color-ink-100)" strokeDasharray="3 3" />}
				</svg>
			</div>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-300">
				{drawn.map((moon) => (
					<span key={moon} className="inline-flex items-center gap-1.5">
						<span className="inline-block h-0.5 w-3.5 rounded-full" style={{ backgroundColor: MOON_COLORS[moon] }} />
						{MOON_INITIALS[moon]} {MOON_LABELS[moon]}
					</span>
				))}
				<span>gap: behind Jupiter</span>
				<span className="inline-flex items-center gap-1.5">
					<span className="inline-block w-3.5 border-t border-dashed border-ink-300" />
					in Jupiter's shadow
				</span>
				{windows.length > 0 && (
					<span className="inline-flex items-center gap-1.5">
						<span className="inline-block size-2.5 rounded-xs bg-success/30" />
						Jupiter watchable from the site
					</span>
				)}
			</div>
		</div>
	)
}
