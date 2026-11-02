import type { AstronomicalSample, AstroWeatherForecast, AstroWeatherNight, MeteorologySample } from 'api'
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from 'react'
import { moveIndex } from '../../ui/navigation'
import { formatClock, OUTLOOK_LABELS, type SkyBand, skyBands } from './astroweather'
import type { NightEvaluation, ObservingWindow, Outlook, OutlookSegment } from './observing'

// Timeline of a night: one time axis shared by rows of the outlook, cloud, seeing, transparency, precipitation, gusts, and the
// Moon, over bands of how dark the sky is. Every row has its own scale and none shares an axis with another. Hourly values are
// bars for the hour they describe, and the 7Timer! classes are tiles centered on their own timestamps and as wide as their
// 3 hour step, so a sample is never drawn as an hourly reading or a continuous line. A value the forecast lacks draws nothing.
// The hour clicked or chosen with the arrow keys is the one the readout below describes; hovering chooses nothing.

// Height of a row, in CSS pixels.
const ROW_HEIGHT = 30

// Height of the time axis, in CSS pixels.
const AXIS_HEIGHT = 22

// Width of the row names, in CSS pixels.
const LABEL_WIDTH = 92

// Margin at the right of the plot, in CSS pixels.
const RIGHT_MARGIN = 8

// Gap between the marks of a row, in CSS pixels.
const MARK_GAP = 2

// Space kept between row content and the lines around it, in CSS pixels.
const ROW_PADDING = 3

// Half the width of the tile of a 7Timer! sample, in milliseconds (half of its 3 hour step).
const SAMPLE_HALF_WIDTH_MS = 90 * 60_000

// Gust that fills its row, in km/h; stronger ones are drawn full.
const GUST_SCALE = 60

// Narrowest slot, in CSS pixels, that shows the symbol of an hour.
const SYMBOL_MINIMUM_WIDTH = 12

// Widest gap, in CSS pixels, between labels of the time axis.
const TICK_SPACING = 56

// Fill of each kind of sky.
const SKY_FILLS: Readonly<Record<SkyBand, string>> = { day: 'var(--color-base-300)', twilight: 'var(--color-base-200)', dark: 'var(--color-base-000)' }

// Name of each kind of sky.
const SKY_LABELS: Readonly<Record<SkyBand, string>> = { day: 'Sun up', twilight: 'Twilight', dark: 'Astronomical darkness' }

// Fill of each reading; unknown has none, so absence stays absence.
const OUTLOOK_FILLS: Readonly<Record<Exclude<Outlook, 'unavailable'>, string>> = { favorable: 'var(--color-success)', variable: 'var(--color-warning)', unfavorable: 'var(--color-danger)' }

// Symbol of each reading, so it never depends on color alone.
const OUTLOOK_SYMBOLS: Readonly<Record<Outlook, string>> = { favorable: '+', variable: '~', unfavorable: '×', unavailable: '?' }

// Rows of the timeline, in order.
const ROWS = ['Outlook', 'Clouds', 'Seeing', 'Transparency', 'Rain chance', 'Gusts', 'Moon up'] as const

// Name of a row.
type Row = (typeof ROWS)[number]

// Geometry of the chart.
interface Scale {
	// Horizontal position of an instant.
	readonly x: (time: number) => number
	// Top of a row.
	readonly y: (row: Row) => number
}

export interface ForecastTimelineProps {
	// Forecast shown.
	readonly forecast: AstroWeatherForecast
	// Night shown.
	readonly night: AstroWeatherNight
	// Reading of the night.
	readonly evaluation: NightEvaluation
	// IANA time zone of the times.
	readonly timeZone: string
	// Index of the hour under the cursor.
	readonly cursor: number
	// Receives the index of an hour chosen.
	readonly onCursor: (index: number) => void
	// Current time, Unix milliseconds.
	readonly now: number
}

// Timeline, sized to its container's width.
export function ForecastTimeline(props: ForecastTimelineProps) {
	const container = useRef<HTMLDivElement>(null)
	const [width, setWidth] = useState(0)

	useEffect(() => {
		const element = container.current
		if (!element) return
		const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	return (
		<div ref={container} className="w-full" style={{ minHeight: AXIS_HEIGHT + ROWS.length * ROW_HEIGHT }}>
			{width > 0 && <Chart {...props} width={width} />}
		</div>
	)
}

interface BarsProps {
	// Hours of the row.
	readonly hours: readonly OutlookSegment[]
	// Value of an hour in [0, 1] of the row's height, undefined when unknown.
	readonly value: (hour: OutlookSegment) => number | undefined
	// Title of an hour.
	readonly title: (hour: OutlookSegment) => string
	// Row of the bars.
	readonly row: Row
	// Geometry of the chart.
	readonly scale: Scale
}

// One bar per hour with a value, rising from the bottom of its row; a zero keeps a hairline, so it differs from unknown.
function Bars({ hours, value, title, row, scale }: BarsProps) {
	const base = scale.y(row) + ROW_HEIGHT - ROW_PADDING
	const room = ROW_HEIGHT - 2 * ROW_PADDING

	return hours.map((hour) => {
		const fraction = value(hour)
		if (fraction === undefined) return undefined
		const left = scale.x(hour.start)
		const height = Math.max(1, Math.min(1, fraction) * room)
		return (
			<rect key={hour.start} x={left} y={base - height} width={Math.max(1, scale.x(hour.end) - left - MARK_GAP)} height={height} rx={1} fill="var(--color-ink-300)">
				<title>{title(hour)}</title>
			</rect>
		)
	})
}

interface TilesProps {
	// Discrete samples of the forecast.
	readonly samples: readonly AstronomicalSample[]
	// Class of a sample.
	readonly value: (sample: AstronomicalSample) => number | undefined
	// Band a class stands for.
	readonly title: (sample: AstronomicalSample, value: number) => string
	// Row of the tiles.
	readonly row: Row
	// Night shown.
	readonly night: AstroWeatherNight
	// Geometry of the chart.
	readonly scale: Scale
	// Time zone of the times.
	readonly timeZone: string
}

// One tile per sample of the night holding its class, more opaque the better the class. Past the last sample the row says so.
function Tiles({ samples, value, title, row, night, scale, timeZone }: TilesProps) {
	const { display } = night
	const top = scale.y(row) + ROW_PADDING
	const height = ROW_HEIGHT - 2 * ROW_PADDING
	const shown = samples.filter((sample) => sample.time + SAMPLE_HALF_WIDTH_MS > display.start && sample.time - SAMPLE_HALF_WIDTH_MS < display.end)
	const last = shown.at(-1)
	const end = last ? last.time + SAMPLE_HALF_WIDTH_MS : display.start

	return (
		<>
			{shown.map((sample) => {
				const code = value(sample)
				if (code === undefined) return undefined
				const left = scale.x(Math.max(display.start, sample.time - SAMPLE_HALF_WIDTH_MS))
				const right = scale.x(Math.min(display.end, sample.time + SAMPLE_HALF_WIDTH_MS))
				return (
					<g key={sample.time}>
						<title>{`${formatClock(sample.time, timeZone)}: ${title(sample, code)}, nearest 3 hour forecast sample`}</title>
						<rect x={left} y={top} width={Math.max(1, right - left - MARK_GAP)} height={height} rx={2} fill="var(--color-info)" fillOpacity={0.12 + (0.5 * (8 - code)) / 7} />
						{right - left > SYMBOL_MINIMUM_WIDTH && (
							<text x={(left + right - MARK_GAP) / 2} y={top + height / 2} dy="0.35em" textAnchor="middle" fill="var(--color-ink-100)">
								{code}
							</text>
						)}
					</g>
				)
			})}
			{end < display.end && (
				<text x={scale.x(Math.max(end, display.start)) + 4} y={top + height / 2} dy="0.35em" fill="var(--color-ink-300)">
					{shown.length === 0 ? 'No forecast' : 'Forecast ends'}
				</text>
			)}
		</>
	)
}

interface MarkerProps {
	// Best window, drawn over the outlook.
	readonly window: ObservingWindow
	// Geometry of the chart.
	readonly scale: Scale
}

// Outline of the best window around the outlook row.
function BestWindow({ window, scale }: MarkerProps) {
	const left = scale.x(window.start)
	return <rect x={left} y={scale.y('Outlook') + 1} width={Math.max(1, scale.x(window.end) - left - 1)} height={ROW_HEIGHT - 2} rx={3} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
}

// Returns the evenly spaced whole hours the time axis labels, for labels at most TICK_SPACING pixels apart.
function axisTicks(start: number, end: number, width: number) {
	const hours = (end - start) / 3_600_000
	const step = Math.max(1, Math.ceil(hours / Math.max(1, Math.floor(width / TICK_SPACING))))
	const hour = 3_600_000
	const first = Math.ceil(start / hour) * hour
	const ticks: number[] = []
	for (let time = first; time <= end; time += step * hour) ticks.push(time)
	return ticks
}

// Plot of the night.
function Chart({ forecast, night, evaluation, timeZone, cursor, onCursor, now, width }: ForecastTimelineProps & { readonly width: number }) {
	const { display, moon } = night
	const { segments, best } = evaluation
	const plotWidth = Math.max(1, width - LABEL_WIDTH - RIGHT_MARGIN)
	const height = AXIS_HEIGHT + ROWS.length * ROW_HEIGHT
	const scale: Scale = {
		x: (time) => LABEL_WIDTH + ((Math.min(display.end, Math.max(display.start, time)) - display.start) / (display.end - display.start)) * plotWidth,
		y: (row) => AXIS_HEIGHT + ROWS.indexOf(row) * ROW_HEIGHT,
	}
	const byTime = new Map<number, MeteorologySample>(forecast.meteorology.samples.map((sample) => [sample.time, sample]))
	const selected = segments[cursor]
	const hourLabel = (hour: OutlookSegment) => `${formatClock(hour.start, timeZone)}–${formatClock(hour.end, timeZone)}`

	// Chooses the hour clicked.
	function onClick(event: MouseEvent<SVGSVGElement>) {
		const x = event.clientX - event.currentTarget.getBoundingClientRect().left
		if (x < LABEL_WIDTH) return
		const time = display.start + ((x - LABEL_WIDTH) / plotWidth) * (display.end - display.start)
		const index = segments.findIndex((hour) => time >= hour.start && time < hour.end)
		if (index >= 0 && index !== cursor) onCursor(index)
	}

	// Moves the hour with the arrow keys, Home, and End.
	function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
		const index = moveIndex(cursor, segments.length, event.key)
		if (index === undefined) return
		event.preventDefault()
		onCursor(index)
	}

	return (
		<>
			<svg width={width} height={height} tabIndex={0} onClick={onClick} onKeyDown={onKeyDown} className="block cursor-pointer text-xs outline-none focus-visible:outline-2 focus-visible:outline-accent">
				<title>Forecast timeline of the night: use the arrow keys to choose an hour</title>
				{skyBands(night).map((band) => (
					<rect key={band.start} x={scale.x(band.start)} y={AXIS_HEIGHT} width={Math.max(0, scale.x(band.end) - scale.x(band.start))} height={height - AXIS_HEIGHT} fill={SKY_FILLS[band.band]}>
						<title>{`${SKY_LABELS[band.band]}: ${formatClock(band.start, timeZone)}–${formatClock(band.end, timeZone)}`}</title>
					</rect>
				))}
				{ROWS.map((row) => (
					<g key={row}>
						<line x1={0} x2={width - RIGHT_MARGIN} y1={scale.y(row) + ROW_HEIGHT} y2={scale.y(row) + ROW_HEIGHT} stroke="var(--color-line-100)" />
						<text x={0} y={scale.y(row) + ROW_HEIGHT / 2} dy="0.35em" fill="var(--color-ink-200)">
							{row}
						</text>
					</g>
				))}
				{axisTicks(display.start, display.end, plotWidth).map((time) => (
					<g key={time}>
						<line x1={scale.x(time)} x2={scale.x(time)} y1={AXIS_HEIGHT - 4} y2={AXIS_HEIGHT} stroke="var(--color-line-200)" />
						<text x={scale.x(time)} y={AXIS_HEIGHT - 8} textAnchor="middle" fill="var(--color-ink-300)">
							{formatClock(time, timeZone)}
						</text>
					</g>
				))}
				{segments.map((hour) => {
					const left = scale.x(hour.start)
					const slot = Math.max(1, scale.x(hour.end) - left - MARK_GAP)
					const top = scale.y('Outlook') + ROW_PADDING
					const room = ROW_HEIGHT - 2 * ROW_PADDING
					return (
						<g key={hour.start}>
							<title>{`${hourLabel(hour)}: ${OUTLOOK_LABELS[hour.outlook]}`}</title>
							{hour.outlook === 'unavailable' ? (
								<rect x={left + 0.5} y={top + 0.5} width={Math.max(0, slot - 1)} height={room - 1} rx={2} fill="none" stroke="var(--color-line-200)" strokeDasharray="2 2" />
							) : (
								<rect x={left} y={top} width={slot} height={room} rx={2} fill={OUTLOOK_FILLS[hour.outlook]} fillOpacity={0.7} />
							)}
							{slot >= SYMBOL_MINIMUM_WIDTH && (
								<text x={left + slot / 2} y={top + room / 2} dy="0.35em" textAnchor="middle" fill={hour.outlook === 'unavailable' ? 'var(--color-ink-300)' : 'var(--color-on-accent)'}>
									{OUTLOOK_SYMBOLS[hour.outlook]}
								</text>
							)}
						</g>
					)
				})}
				{best && <BestWindow window={best} scale={scale} />}
				<Bars
					hours={segments}
					row="Clouds"
					scale={scale}
					value={(hour) => {
						const value = byTime.get(hour.start)?.cloudCover
						return value === undefined ? undefined : value / 100
					}}
					title={(hour) => `${hourLabel(hour)}: ${byTime.get(hour.start)?.cloudCover} % total cloud`}
				/>
				<Tiles samples={forecast.astronomy.samples} value={(sample) => sample.seeing} title={(_, code) => `seeing class ${code}`} row="Seeing" night={night} scale={scale} timeZone={timeZone} />
				<Tiles samples={forecast.astronomy.samples} value={(sample) => sample.transparency} title={(_, code) => `transparency class ${code}`} row="Transparency" night={night} scale={scale} timeZone={timeZone} />
				<Bars
					hours={segments}
					row="Rain chance"
					scale={scale}
					value={(hour) => {
						const value = byTime.get(hour.end)?.precipitationProbability
						return value === undefined ? undefined : value / 100
					}}
					title={(hour) => `${hourLabel(hour)}: ${byTime.get(hour.end)?.precipitationProbability} % chance of precipitation`}
				/>
				<Bars
					hours={segments}
					row="Gusts"
					scale={scale}
					value={(hour) => {
						const value = byTime.get(hour.end)?.windGust
						return value === undefined ? undefined : value / GUST_SCALE
					}}
					title={(hour) => `${hourLabel(hour)}: gusts of ${byTime.get(hour.end)?.windGust} km/h`}
				/>
				{moon.above.map((span) => (
					<rect key={span.start} x={scale.x(span.start)} y={scale.y('Moon up') + ROW_HEIGHT / 2 - 3} width={Math.max(1, scale.x(span.end) - scale.x(span.start))} height={6} rx={3} fill="var(--color-ink-200)">
						<title>{`Moon above the horizon: ${formatClock(span.start, timeZone)}–${formatClock(span.end, timeZone)}`}</title>
					</rect>
				))}
				{now > display.start && now < display.end && <line x1={scale.x(now)} x2={scale.x(now)} y1={AXIS_HEIGHT} y2={height} stroke="var(--color-ink-100)" strokeDasharray="1 3" />}
				{selected && <rect x={scale.x(selected.start)} y={AXIS_HEIGHT} width={Math.max(1, scale.x(selected.end) - scale.x(selected.start) - MARK_GAP)} height={height - AXIS_HEIGHT} fill="none" stroke="var(--color-ink-100)" strokeOpacity={0.7} pointerEvents="none" />}
			</svg>
			<p className="m-0 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs leading-4 text-ink-300">
				{(['day', 'twilight', 'dark'] as const).map((band) => (
					<span key={band} className="inline-flex items-center gap-1.5">
						<span className="inline-block size-2.5 rounded-xs border border-line-200" style={{ background: SKY_FILLS[band] }} />
						{SKY_LABELS[band]}
					</span>
				))}
				<span>
					{OUTLOOK_SYMBOLS.favorable} {OUTLOOK_LABELS.favorable}
				</span>
				<span>
					{OUTLOOK_SYMBOLS.variable} {OUTLOOK_LABELS.variable}
				</span>
				<span>
					{OUTLOOK_SYMBOLS.unfavorable} {OUTLOOK_LABELS.unfavorable}
				</span>
				<span>
					{OUTLOOK_SYMBOLS.unavailable} {OUTLOOK_LABELS.unavailable}
				</span>
				<span>Seeing and transparency: class 1 best, 8 worst, every 3 hours</span>
			</p>
		</>
	)
}
