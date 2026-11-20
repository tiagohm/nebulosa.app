import type { SaturnEvent, SaturnMoon, SaturnNight, SaturnTrack } from 'api'
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from 'react'
import { formatClockTime, formatDate } from '../../format'
import { zonedWallTime } from '../../location/zone'
import { moveIndex } from '../../ui/navigation'
import { equatorOffset, midnights, type PlanetOrientation } from '../planetary/planetary'
import { MOON_COLORS, MOON_INITIALS, MOON_LABELS, SATURN_MOONS } from './saturn'

// Chart of Saturn's major moons over the period, the way observers print it: time runs down, and each moon's offset
// along the ring plane's long axis runs across, in arcseconds from the server's samples, east on the side the viewer's
// orientation puts it, so a row of the chart reads like the viewer at that instant. It shows the bands of the disk and
// of the rings (to the outer edge of the A ring), the stretches the site can watch Saturn, the selected phenomenon, a
// line and the date at each local midnight, the clock's cursor, and each curve's initial above its start, spread apart
// where the moons are close, so no curve is told apart by colour alone. The horizontal extent fits the moons drawn, so
// Iapetus is never cut off and the inner moons spread out when it is not drawn. A moon behind the disk leaves a gap, a
// moon in Saturn's umbra is drawn faint; no event is read from these samples. The drawing is in CSS pixels at the
// measured width, so its text keeps one size on a phone and a desktop and it never scrolls sideways; labels that would
// crowd are left out. The cursor moves by a click or with the arrow keys, Home, and End.

// Height of the chart, in CSS pixels: its width, kept between these bounds.
const MIN_HEIGHT = 320
const MAX_HEIGHT = 480

// Width assumed before the frame is measured, in CSS pixels.
const INITIAL_WIDTH = 480

// Margins of the plot, in CSS pixels: the times on the left, the initials above, the offsets below.
const MARGIN = { top: 22, right: 10, bottom: 22, left: 78 } as const

// Size of the chart's text, in CSS pixels.
const TEXT_PX = 11

// Width of a character of the chart's text, in CSS pixels: JetBrains Mono's advance of 0.6 em at TEXT_PX.
const CHARACTER_PX = 6.6

// Smallest horizontal distance between two initials above the curves, in CSS pixels: two characters and a gap.
const INITIAL_GAP_PX = 2 * CHARACTER_PX + 4

// Smallest vertical distance between two time labels, in CSS pixels.
const LABEL_GAP_PX = 30

// Smallest horizontal room for an offset label, in CSS pixels.
const OFFSET_LABEL_PX = 46

// Margin of the extent beyond the largest offset drawn, as a fraction of it.
const EXTENT_MARGIN = 0.08

// Grid lines aimed for on each side of the ring plane.
const GRID_LINES = 4

// Milliseconds per hour.
const HOUR_MS = 3_600_000

// Hours between two time labels, the first that leaves at least LABEL_GAP_PX between them.
const LABEL_STEPS = [1, 2, 3, 6, 12] as const

// Arcseconds per radian.
const ARCSEC = (180 / Math.PI) * 3600

// Extent of the plot, in Saturn radii: the largest offset along the ring plane of the moons drawn, with a margin, and
// at least the rings with a margin.
export function chartExtent(track: Pick<SaturnTrack, 'moons' | 'poleAngle'>, moons: readonly SaturnMoon[], ringRadius: number) {
	let largest = ringRadius

	for (const moon of moons) {
		const { east, north } = track.moons[moon]
		for (let i = 0; i < east.length; i++) largest = Math.max(largest, Math.abs(equatorOffset(east[i], north[i], track.poleAngle)))
	}

	return largest * (1 + EXTENT_MARGIN)
}

// Spacing of the grid lines for an extent: 1, 2, or 5 times a power of ten, about GRID_LINES per side.
export function gridStep(extent: number) {
	const raw = extent / GRID_LINES
	const power = 10 ** Math.floor(Math.log10(raw))
	const unit = raw / power
	return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power
}

// Spreads labels wanted at positions along one axis (CSS pixels, any order) so no two are closer than `gap`, keeping
// them between `low` and `high` where there is room for all: each moves as little as it can from where it was wanted.
// Returns the positions in the order given.
export function stackLabels(wanted: readonly number[], gap: number, low: number, high: number): number[] {
	const order = wanted.map((position, i) => ({ position, i })).sort((a, b) => a.position - b.position)
	const placed = order.map(({ position }) => Math.max(low, Math.min(high, position)))
	for (let k = 1; k < placed.length; k++) placed[k] = Math.max(placed[k], placed[k - 1] + gap)
	// Pushed past the high end: the stack moves back from there, never past the low end.
	const overflow = placed.length > 0 ? placed.at(-1)! - high : 0
	if (overflow > 0) {
		placed[placed.length - 1] = high
		for (let k = placed.length - 2; k >= 0; k--) placed[k] = Math.max(low, Math.min(placed[k], placed[k + 1] - gap))
	}

	const out = new Array<number>(wanted.length)
	for (const [k, { i }] of order.entries()) out[i] = placed[k]
	return out
}

// Which grid lines carry an offset label: every line when they are `spacing` CSS pixels apart or more, else every few,
// counted from the centre line (index `centre`), so 0″ always keeps its label.
export function labeledGridLines(count: number, centre: number, spacing: number) {
	const every = Math.max(1, Math.ceil(OFFSET_LABEL_PX / spacing))
	return Array.from({ length: count }, (_, i) => (i - centre) % every === 0)
}

export interface MoonChartProps {
	readonly track: SaturnTrack
	// Apparent equatorial angular radius of Saturn (radians), to label the offsets in arcseconds.
	readonly equatorialRadius: number
	// Outer edge of the A ring, in Saturn radii.
	readonly ringRadius: number
	// Orientation of the viewer, which puts east on the left (north up) or on the right.
	readonly orientation: PlanetOrientation
	// Moons drawn.
	readonly moons: readonly SaturnMoon[]
	// Nights of the site with Saturn's watchable windows; empty without a site.
	readonly nights: readonly SaturnNight[]
	// Phenomenon highlighted.
	readonly selected?: SaturnEvent
	// Instant of the clock.
	readonly time?: number
	// IANA zone the times are labeled in.
	readonly timeZone: string
	// Receives an instant chosen on the chart.
	readonly onTime: (time: number) => void
}

// Paths of one moon: the solid stretches and the faint ones inside the umbra, broken where it is behind the disk.
function moonPaths(track: SaturnTrack, moon: SaturnMoon, x: (offset: number) => number, y: (time: number) => number) {
	const { east, north, disk, eclipse } = track.moons[moon]
	let solid = ''
	let faint = ''
	let previous: 'solid' | 'faint' | undefined

	for (let i = 0; i < track.times.length; i++) {
		const kind = disk[i] === 'occulted' ? undefined : eclipse[i] === 'umbra' ? 'faint' : 'solid'
		const point = `${x(equatorOffset(east[i], north[i], track.poleAngle)).toFixed(1)},${y(track.times[i]).toFixed(1)} `
		if (kind === 'solid') solid += `${previous === 'solid' ? 'L' : 'M'}${point}`
		else if (kind === 'faint') faint += `${previous === 'faint' ? 'L' : 'M'}${point}`
		previous = kind
	}

	return { solid, faint }
}

// Chart of the moons over the period.
export function MoonChart({ track, equatorialRadius, ringRadius, orientation, moons, nights, selected, time, timeZone, onTime }: MoonChartProps) {
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
	const drawn = SATURN_MOONS.filter((moon) => moons.includes(moon))
	const extent = chartExtent(track, drawn, ringRadius)
	const start = track.times[0]
	const end = track.times.at(-1)!
	const span = Math.max(1, end - start)
	const plotWidth = width - MARGIN.left - MARGIN.right
	const plotHeight = height - MARGIN.top - MARGIN.bottom
	// East is on the left with north up, as the naked eye sees it, and on the right in the other orientations.
	const east = orientation === 'north' ? -1 : 1
	const x = (offset: number) => MARGIN.left + ((extent + east * Math.max(-extent, Math.min(extent, offset))) / (2 * extent)) * plotWidth
	const y = (t: number) => MARGIN.top + ((t - start) / span) * plotHeight
	const pixelsPerHour = (plotHeight * HOUR_MS) / span
	const step = LABEL_STEPS.find((hours) => hours * pixelsPerHour >= LABEL_GAP_PX)
	const days = midnights(start, end, timeZone)
	const labels: number[] = []
	// The hours on a whole step of the display zone, leaving out those too close to a date to read apart from it.
	if (step) for (let t = Math.ceil(start / HOUR_MS) * HOUR_MS; t <= end; t += HOUR_MS) if (zonedWallTime(t, timeZone).hour % step === 0 && !days.some((day) => Math.abs(y(day) - y(t)) < LABEL_GAP_PX)) labels.push(t)
	const cursorIndex = time === undefined ? 0 : Math.max(0, Math.min(track.times.length - 1, Math.round((time - start) / track.step)))
	// Grid lines in Saturn radii, labeled in arcseconds, every few lines when they would crowd.
	const gridSpacing = gridStep(extent)
	const lines = Math.floor(extent / gridSpacing)
	const grid: number[] = []
	for (let k = -lines; k <= lines; k++) grid.push(k * gridSpacing)
	const labeled = labeledGridLines(grid.length, lines, (gridSpacing / (2 * extent)) * plotWidth)
	const windows = nights.flatMap((night) => night.windows).filter((window) => window.end > start && window.start < end)
	// Initials above the start of each curve, spread apart where the moons are close.
	const initials = stackLabels(
		drawn.map((moon) => x(equatorOffset(track.moons[moon].east[0], track.moons[moon].north[0], track.poleAngle))),
		INITIAL_GAP_PX,
		MARGIN.left + CHARACTER_PX,
		MARGIN.left + plotWidth - CHARACTER_PX,
	)

	// Moves the clock to the instant clicked.
	function onClick(event: MouseEvent<SVGSVGElement>) {
		const box = event.currentTarget.getBoundingClientRect()
		const t = start + (((event.clientY - box.top) * (height / box.height) - MARGIN.top) / plotHeight) * span
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
					<title>{`Offsets of Saturn's moons along the ring plane over the period, in arcseconds, time running down and east on the ${east < 0 ? 'left' : 'right'}; gaps are the moons behind the planet and faint stretches the moons in its shadow. Click or use the arrow keys to move the clock.`}</title>
					{windows.map((window) => (
						<rect key={window.start} x={MARGIN.left} y={y(Math.max(start, window.start))} width={plotWidth} height={Math.max(0, y(Math.min(end, window.end)) - y(Math.max(start, window.start)))} fill="var(--color-success)" opacity={0.08}>
							<title>{`Saturn watchable ${formatClockTime(window.start, timeZone)}–${formatClockTime(window.end, timeZone)}`}</title>
						</rect>
					))}
					{selected && <rect x={MARGIN.left} y={y(Math.max(start, selected.start))} width={plotWidth} height={Math.max(2, y(Math.min(end, selected.end)) - y(Math.max(start, selected.start)))} fill="var(--color-accent)" opacity={0.18} />}
					<rect x={Math.min(x(ringRadius), x(-ringRadius))} y={MARGIN.top} width={Math.abs(x(ringRadius) - x(-ringRadius))} height={plotHeight} fill="var(--color-saturn-ring)" opacity={0.12}>
						<title>Saturn's rings, to the outer edge of the A ring</title>
					</rect>
					<rect x={Math.min(x(1), x(-1))} y={MARGIN.top} width={Math.abs(x(1) - x(-1))} height={plotHeight} fill="var(--color-saturn-disk)" opacity={0.22}>
						<title>Saturn's disk</title>
					</rect>
					{grid.map((offset, i) => (
						<g key={offset}>
							<line x1={x(offset)} x2={x(offset)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke="var(--color-line-100)" />
							{labeled[i] && (
								<text x={x(offset)} y={height - 7} textAnchor="middle" fill="var(--color-ink-300)">
									{offset === 0 ? '0″' : `${Math.round(Math.abs(offset) * equatorialRadius * ARCSEC)}″ ${offset > 0 ? 'E' : 'W'}`}
								</text>
							)}
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
						const { solid, faint } = moonPaths(track, moon, x, y)
						return (
							<g key={moon}>
								<path d={faint} fill="none" stroke={MOON_COLORS[moon]} strokeWidth={1.5} strokeDasharray="2 3" opacity={0.7} />
								<path d={solid} fill="none" stroke={MOON_COLORS[moon]} strokeWidth={1.75} />
							</g>
						)
					})}
					{drawn.map((moon, i) => (
						<text key={moon} x={initials[i]} y={MARGIN.top - 7} textAnchor="middle" fill={MOON_COLORS[moon]} fontWeight={600}>
							{MOON_INITIALS[moon]}
						</text>
					))}
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
				{drawn.length > 0 && <span>gap: behind Saturn</span>}
				{drawn.length > 0 && (
					<span className="inline-flex items-center gap-1.5">
						<span className="inline-block w-3.5 border-t border-dashed border-ink-300" />
						in Saturn's shadow
					</span>
				)}
				{windows.length > 0 && (
					<span className="inline-flex items-center gap-1.5">
						<span className="inline-block size-2.5 rounded-xs bg-success/30" />
						Saturn watchable from the site
					</span>
				)}
			</div>
		</div>
	)
}
