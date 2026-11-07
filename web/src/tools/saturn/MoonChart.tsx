import type { SaturnMoon, SaturnTrack } from 'api'
import type { KeyboardEvent, MouseEvent } from 'react'
import { formatClockTime, formatDate } from '../../format'
import { moveIndex } from '../../ui/navigation'
import { equatorOffset, type PlanetScale } from '../planetary/planetary'
import { MOON_COLORS, MOON_LABELS, SATURN_MOONS } from './saturn'

// Chart of Saturn's major moons over the period: each moon's offset along the ring plane's long axis against time, east up,
// in arcseconds from the server's samples, with the bands of the disk and of the rings (to the outer edge of the A ring)
// and the clock's cursor. The disk scale reaches Titan and the system scale Iapetus, which otherwise leaves the plot for
// long stretches. A moon behind the disk leaves a gap, a moon in Saturn's umbra is drawn faint; no event is read from
// these samples. The cursor moves by a click or with the arrow keys, Home, and End.

// Size of the drawing, in viewBox units.
const WIDTH = 760
const HEIGHT = 300

// Margins of the plot, in viewBox units.
const MARGIN = { top: 12, right: 12, bottom: 28, left: 48 } as const

// Largest offset drawn at each scale, in Saturn radii: beyond Titan (~20) for the disk scale, beyond Iapetus (~59) for
// the system scale.
const EXTENT: Readonly<Record<PlanetScale, number>> = { disk: 22, system: 62 }

// Milliseconds per hour.
const HOUR_MS = 3_600_000

// Arcseconds per radian.
const ARCSEC = (180 / Math.PI) * 3600

export interface MoonChartProps {
	readonly track: SaturnTrack
	// Apparent equatorial angular radius of Saturn (radians), to label the offsets in arcseconds.
	readonly equatorialRadius: number
	// Outer edge of the A ring, in Saturn radii.
	readonly ringRadius: number
	// Moons drawn.
	readonly moons: readonly SaturnMoon[]
	readonly scale: PlanetScale
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
function moonPaths(track: SaturnTrack, moon: SaturnMoon, x: (time: number) => number, y: (offset: number) => number) {
	const { east, north, disk, eclipse } = track.moons[moon]
	let solid = ''
	let faint = ''
	let previous: 'solid' | 'faint' | undefined

	for (let i = 0; i < track.times.length; i++) {
		const kind = disk[i] === 'occulted' ? undefined : eclipse[i] === 'umbra' ? 'faint' : 'solid'
		const point = `${x(track.times[i]).toFixed(1)},${y(equatorOffset(east[i], north[i], track.poleAngle)).toFixed(1)} `
		if (kind === 'solid') solid += `${previous === 'solid' ? 'L' : 'M'}${point}`
		else if (kind === 'faint') faint += `${previous === 'faint' ? 'L' : 'M'}${point}`
		previous = kind
	}

	return { solid, faint }
}

// Chart of the moons over the period.
export function MoonChart({ track, equatorialRadius, ringRadius, moons, scale, time, timeZone, onTime }: MoonChartProps) {
	const extent = EXTENT[scale]
	const start = track.times[0]
	const end = track.times.at(-1)!
	const span = Math.max(1, end - start)
	const plotWidth = WIDTH - MARGIN.left - MARGIN.right
	const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
	const x = (t: number) => MARGIN.left + ((t - start) / span) * plotWidth
	const y = (offset: number) => MARGIN.top + ((extent - Math.max(-extent, Math.min(extent, offset))) / (2 * extent)) * plotHeight
	const every = labelHours(span) * HOUR_MS
	const labels: number[] = []
	for (let t = Math.ceil(start / every) * every; t <= end; t += every) labels.push(t)
	const cursorIndex = time === undefined ? 0 : Math.max(0, Math.min(track.times.length - 1, Math.round((time - start) / track.step)))
	// Grid every 5 or 20 radii, labeled in arcseconds.
	const gridStep = scale === 'disk' ? 5 : 20
	const grid: number[] = []
	for (let offset = -Math.floor(extent / gridStep) * gridStep; offset <= extent; offset += gridStep) grid.push(offset)
	const drawn = SATURN_MOONS.filter((moon) => moons.includes(moon))

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
					<title>Offsets of Saturn's moons along the ring plane over the period, east up, in arcseconds; gaps are the moons behind the planet and faint stretches the moons in its shadow.</title>
					<rect x={MARGIN.left} y={y(ringRadius)} width={plotWidth} height={y(-ringRadius) - y(ringRadius)} fill="#d9c79f" opacity={0.18}>
						<title>Saturn's rings, to the outer edge of the A ring</title>
					</rect>
					<rect x={MARGIN.left} y={y(1)} width={plotWidth} height={y(-1) - y(1)} fill="#dcc89a" opacity={0.45}>
						<title>Saturn's disk</title>
					</rect>
					{grid.map((offset) => (
						<g key={offset}>
							<line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(offset)} y2={y(offset)} stroke="var(--color-line-100)" />
							<text x={MARGIN.left - 4} y={y(offset)} dy="0.35em" textAnchor="end" fill="var(--color-ink-300)">
								{offset === 0 ? '0″' : `${Math.round(Math.abs(offset) * equatorialRadius * ARCSEC)}″ ${offset > 0 ? 'E' : 'W'}`}
							</text>
						</g>
					))}
					{labels.map((t) => (
						<text key={t} x={x(t)} y={HEIGHT - 10} textAnchor="middle" fill="var(--color-ink-300)">
							{every >= 24 * HOUR_MS ? formatDate(t, timeZone) : formatClockTime(t, timeZone)}
						</text>
					))}
					{drawn.map((moon) => {
						const { solid, faint } = moonPaths(track, moon, x, y)
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
				{drawn.map((moon) => (
					<span key={moon}>
						<span style={{ color: MOON_COLORS[moon] }}>━</span> {MOON_LABELS[moon]}
					</span>
				))}
				<span>gap: behind Saturn</span>
				<span>┄ in Saturn's shadow</span>
				{scale === 'disk' && <span>Iapetus may lie beyond the plot: switch to System.</span>}
			</div>
		</div>
	)
}
