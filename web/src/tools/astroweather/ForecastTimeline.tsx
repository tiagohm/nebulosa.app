import type { AstronomicalSample, AstroWeatherForecast, AstroWeatherNight, MeteorologySample } from 'api'
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from 'react'
import { formatClockTime } from '../../format'
import { moveIndex } from '../../ui/navigation'
import { OUTLOOK_LABELS, type SkyBand, skyBands } from './astroweather'
import type { NightEvaluation, ObservingWindow, Outlook, OutlookSegment } from './observing'

// Timeline of a night: one time axis shared by rows of the outlook, then the sky (cloud, seeing, transparency), the weather
// (precipitation, wind, gusts, temperature, dew point, humidity), and the Moon, each group set apart, over bands of how dark
// the sky is. Every row has its own scale, named with its unit, and none shares an axis with another but wind and gusts.
// Hourly values are bars for the hour they describe, except the temperature and the dew point, written as rounded degrees
// because they have no natural zero to rise from, and the 7Timer! classes are tiles centered on their own timestamps and as
// wide as their 3-hour step, so a sample is never drawn as an hourly reading or a continuous line. A value the forecast lacks
// draws nothing. Fills stay dim and warm, for eyes adapted to the dark. The hour clicked or chosen with the arrow keys is the
// one the readout describes, outlined in the accent; hovering chooses nothing. A narrow chart names its rows in short.

// Height of a row, in CSS pixels.
const ROW_HEIGHT = 30

// Height of the time axis, in CSS pixels.
const AXIS_HEIGHT = 22

// Width of the row names, in CSS pixels.
const LABEL_WIDTH = 104

// Width of the short row names of a narrow chart, in CSS pixels.
const NARROW_LABEL_WIDTH = 54

// Width of the chart, in CSS pixels, below which its rows are named in short, leaving the hours room to be tapped.
const NARROW_WIDTH = 480

// Space between groups of rows, in CSS pixels.
const GROUP_GAP = 8

// Margin at the right of the plot, in CSS pixels.
const RIGHT_MARGIN = 8

// Gap between the marks of a row, in CSS pixels.
const MARK_GAP = 2

// Space kept between row content and the lines around it, in CSS pixels.
const ROW_PADDING = 3

// Half the width of the tile of a 7Timer! sample, in milliseconds (half of its 3-hour step).
const SAMPLE_HALF_WIDTH_MS = 90 * 60_000

// Wind or gust that fills its row, in km/h; stronger ones are drawn full. Both rows share it, so their bars compare, and it
// is low enough that common winds of 5 to 15 km/h still draw a readable bar.
const WIND_SCALE = 40

// Narrowest slot, in CSS pixels, that shows the symbol of an hour.
const SYMBOL_MINIMUM_WIDTH = 12

// Room, in CSS pixels, an hour's temperature or dew point needs to be written ("-12°"); narrower hours write every few hours instead.
const VALUE_TEXT_WIDTH = 30

// Share of a whole hour's width, in [0, 1], an hour cut by the edge of the chart needs to have its value written, so a value
// never spills over the row names.
const PARTIAL_HOUR_TEXT = 0.6

// Widest gap, in CSS pixels, between labels of the time axis.
const TICK_SPACING = 56

// Fill of each kind of sky, three clearly separate steps of the warm neutrals around the page's own background.
const SKY_FILLS: Readonly<Record<SkyBand, string>> = { day: 'var(--color-line-100)', twilight: 'var(--color-base-300)', dark: 'var(--color-base-000)' }

// Name of each kind of sky.
const SKY_LABELS: Readonly<Record<SkyBand, string>> = { day: 'Sun up', twilight: 'Twilight', dark: 'Astronomical darkness' }

// Fill of each reading, drawn at OUTLOOK_OPACITY; unknown has none, so absence stays absence.
const OUTLOOK_FILLS: Readonly<Record<Exclude<Outlook, 'unavailable'>, string>> = { favorable: 'var(--color-success)', variable: 'var(--color-warning)', unfavorable: 'var(--color-danger)' }

// Opacity of the fill of a reading in [0, 1]: dim enough to keep dark adaptation and to carry its light symbol.
const OUTLOOK_OPACITY = 0.4

// Lowest opacity of the tile of a 7Timer! class in [0, 1], for class 8, the worst.
const TILE_OPACITY_MIN = 0.06

// Opacity a tile gains from class 8 to class 1, the best, in [0, 1].
const TILE_OPACITY_RANGE = 0.3

// Symbol of each reading, so it never depends on color alone.
const OUTLOOK_SYMBOLS: Readonly<Record<Outlook, string>> = { favorable: '+', variable: '~', unfavorable: '×', unavailable: '?' }

// Groups of rows of the timeline, in order: the outlook, the sky, the weather, and the Moon.
const ROW_GROUPS = [['Outlook'], ['Clouds', 'Seeing', 'Transparency'], ['Rain chance', 'Wind', 'Gusts', 'Temperature', 'Dew point', 'Humidity'], ['Moon up']] as const

// Key of a row.
type Row = (typeof ROW_GROUPS)[number][number]

// Rows of the timeline, in order.
const ROWS: readonly Row[] = ROW_GROUPS.flat()

// Name of each row with its unit, in full and in short for a narrow chart.
const ROW_LABELS: Readonly<Record<Row, { readonly wide: string; readonly narrow: string }>> = {
	Outlook: { wide: 'Outlook', narrow: 'Outlook' },
	Clouds: { wide: 'Clouds %', narrow: 'Cloud' },
	Seeing: { wide: 'Seeing', narrow: 'Seeing' },
	Transparency: { wide: 'Transparency', narrow: 'Transp' },
	'Rain chance': { wide: 'Rain chance %', narrow: 'Rain' },
	Wind: { wide: 'Wind km/h', narrow: 'Wind' },
	Gusts: { wide: 'Gusts km/h', narrow: 'Gusts' },
	Temperature: { wide: 'Temperature °C', narrow: 'Temp °C' },
	'Dew point': { wide: 'Dew point °C', narrow: 'Dew °C' },
	Humidity: { wide: 'Humidity %', narrow: 'Humid' },
	'Moon up': { wide: 'Moon up', narrow: 'Moon' },
}

// Top of each row below the time axis, in CSS pixels, with a gap between groups.
const ROW_TOPS = new Map<Row, number>(ROW_GROUPS.flatMap((group, g) => group.map((row): [Row, number] => [row, AXIS_HEIGHT + ROWS.indexOf(row) * ROW_HEIGHT + g * GROUP_GAP])))

// Height of the chart, in CSS pixels.
const CHART_HEIGHT = AXIS_HEIGHT + ROWS.length * ROW_HEIGHT + (ROW_GROUPS.length - 1) * GROUP_GAP

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
		<div ref={container} className="w-full" style={{ minHeight: CHART_HEIGHT }}>
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

interface ValuesProps {
	// Hours of the row.
	readonly hours: readonly OutlookSegment[]
	// Text of an hour, undefined when unknown.
	readonly value: (hour: OutlookSegment) => string | undefined
	// Title of an hour.
	readonly title: (hour: OutlookSegment) => string
	// Row of the values.
	readonly row: Row
	// Geometry of the chart.
	readonly scale: Scale
}

// The text of every hour with a value, centered on its hour. When hours are narrower than VALUE_TEXT_WIDTH, only every few hours
// is written, so texts never overlap, and an hour cut short by the edge of the chart is not written; every hour with a value
// keeps its title.
function Values({ hours, value, title, row, scale }: ValuesProps) {
	const top = scale.y(row) + ROW_PADDING
	const room = ROW_HEIGHT - 2 * ROW_PADDING
	const first = hours.at(0)
	const last = hours.at(-1)
	const slot = first && last ? (scale.x(last.end) - scale.x(first.start)) / hours.length : 0
	const step = Math.max(1, Math.ceil(VALUE_TEXT_WIDTH / Math.max(1, slot)))

	return hours.map((hour, index) => {
		const text = value(hour)
		if (text === undefined) return undefined
		const left = scale.x(hour.start)
		const width = Math.max(1, scale.x(hour.end) - left - MARK_GAP)
		return (
			<g key={hour.start}>
				<title>{title(hour)}</title>
				<rect x={left} y={top} width={width} height={room} fill="transparent" />
				{index % step === 0 && width >= slot * PARTIAL_HOUR_TEXT && (
					<text x={left + width / 2} y={top + room / 2} dy="0.35em" textAnchor="middle" fill="var(--color-ink-100)">
						{text}
					</text>
				)}
			</g>
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
						<title>{`${formatClockTime(sample.time, timeZone)}: ${title(sample, code)}, nearest 3-hour forecast sample`}</title>
						<rect x={left} y={top} width={Math.max(1, right - left - MARK_GAP)} height={height} rx={2} fill="var(--color-ink-200)" fillOpacity={TILE_OPACITY_MIN + (TILE_OPACITY_RANGE * (8 - code)) / 7} />
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

// Outline of the best window around the outlook row, in cream: a recommendation, not a choice, so never the accent.
function BestWindow({ window, scale }: MarkerProps) {
	const left = scale.x(window.start)
	return <rect x={left} y={scale.y('Outlook') + 1} width={Math.max(1, scale.x(window.end) - left - 1)} height={ROW_HEIGHT - 2} rx={3} fill="none" stroke="var(--color-ink-100)" strokeWidth={1.5} />
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
	const narrow = width < NARROW_WIDTH
	const labelWidth = narrow ? NARROW_LABEL_WIDTH : LABEL_WIDTH
	const plotWidth = Math.max(1, width - labelWidth - RIGHT_MARGIN)
	const height = CHART_HEIGHT
	const scale: Scale = {
		x: (time) => labelWidth + ((Math.min(display.end, Math.max(display.start, time)) - display.start) / (display.end - display.start)) * plotWidth,
		y: (row) => ROW_TOPS.get(row) ?? AXIS_HEIGHT,
	}
	const byTime = new Map<number, MeteorologySample>(forecast.meteorology.samples.map((sample) => [sample.time, sample]))
	const selected = segments[cursor]
	const hourLabel = (hour: OutlookSegment) => `${formatClockTime(hour.start, timeZone)}–${formatClockTime(hour.end, timeZone)}`

	// Chooses the hour clicked.
	function onClick(event: MouseEvent<SVGSVGElement>) {
		const x = event.clientX - event.currentTarget.getBoundingClientRect().left
		if (x < labelWidth) return
		const time = display.start + ((x - labelWidth) / plotWidth) * (display.end - display.start)
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
			<svg width={width} height={height} tabIndex={0} onClick={onClick} onKeyDown={onKeyDown} className="block cursor-pointer text-xs outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent">
				<title>Forecast timeline of the night: use the arrow keys to choose an hour</title>
				{skyBands(night).map((band) => (
					<rect key={band.start} x={scale.x(band.start)} y={AXIS_HEIGHT} width={Math.max(0, scale.x(band.end) - scale.x(band.start))} height={height - AXIS_HEIGHT} fill={SKY_FILLS[band.band]}>
						<title>{`${SKY_LABELS[band.band]}: ${formatClockTime(band.start, timeZone)}–${formatClockTime(band.end, timeZone)}`}</title>
					</rect>
				))}
				{ROWS.map((row) => (
					<g key={row}>
						<line x1={0} x2={width - RIGHT_MARGIN} y1={scale.y(row) + ROW_HEIGHT} y2={scale.y(row) + ROW_HEIGHT} stroke="var(--color-line-100)" />
						<text x={0} y={scale.y(row) + ROW_HEIGHT / 2} dy="0.35em" fill="var(--color-ink-200)">
							{narrow ? ROW_LABELS[row].narrow : ROW_LABELS[row].wide}
						</text>
					</g>
				))}
				{axisTicks(display.start, display.end, plotWidth).map((time) => (
					<g key={time}>
						<line x1={scale.x(time)} x2={scale.x(time)} y1={AXIS_HEIGHT - 4} y2={AXIS_HEIGHT} stroke="var(--color-line-200)" />
						<text x={scale.x(time)} y={AXIS_HEIGHT - 8} textAnchor="middle" fill="var(--color-ink-300)">
							{formatClockTime(time, timeZone)}
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
								<rect x={left} y={top} width={slot} height={room} rx={2} fill={OUTLOOK_FILLS[hour.outlook]} fillOpacity={OUTLOOK_OPACITY} />
							)}
							{slot >= SYMBOL_MINIMUM_WIDTH && (
								<text x={left + slot / 2} y={top + room / 2} dy="0.35em" textAnchor="middle" fill={hour.outlook === 'unavailable' ? 'var(--color-ink-300)' : 'var(--color-ink-100)'}>
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
					title={(hour) => `${hourLabel(hour)}: ${byTime.get(hour.start)?.cloudCover}% total cloud`}
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
					title={(hour) => `${hourLabel(hour)}: ${byTime.get(hour.end)?.precipitationProbability}% chance of precipitation`}
				/>
				<Bars
					hours={segments}
					row="Wind"
					scale={scale}
					value={(hour) => {
						const value = byTime.get(hour.start)?.windSpeed
						return value === undefined ? undefined : value / WIND_SCALE
					}}
					title={(hour) => `${hourLabel(hour)}: sustained wind of ${byTime.get(hour.start)?.windSpeed} km/h`}
				/>
				<Bars
					hours={segments}
					row="Gusts"
					scale={scale}
					value={(hour) => {
						const value = byTime.get(hour.end)?.windGust
						return value === undefined ? undefined : value / WIND_SCALE
					}}
					title={(hour) => `${hourLabel(hour)}: gusts of ${byTime.get(hour.end)?.windGust} km/h`}
				/>
				<Values
					hours={segments}
					row="Temperature"
					scale={scale}
					value={(hour) => {
						const value = byTime.get(hour.start)?.temperature
						return value === undefined ? undefined : `${Math.round(value)}°`
					}}
					title={(hour) => `${hourLabel(hour)}: air temperature of ${byTime.get(hour.start)?.temperature} °C`}
				/>
				<Values
					hours={segments}
					row="Dew point"
					scale={scale}
					value={(hour) => {
						const value = byTime.get(hour.start)?.dewPoint
						return value === undefined ? undefined : `${Math.round(value)}°`
					}}
					title={(hour) => `${hourLabel(hour)}: dew point of ${byTime.get(hour.start)?.dewPoint} °C`}
				/>
				<Bars
					hours={segments}
					row="Humidity"
					scale={scale}
					value={(hour) => {
						const value = byTime.get(hour.start)?.relativeHumidity
						return value === undefined ? undefined : value / 100
					}}
					title={(hour) => `${hourLabel(hour)}: ${byTime.get(hour.start)?.relativeHumidity}% relative humidity`}
				/>
				{moon.above.map((span) => (
					<rect key={span.start} x={scale.x(span.start)} y={scale.y('Moon up') + ROW_HEIGHT / 2 - 3} width={Math.max(1, scale.x(span.end) - scale.x(span.start))} height={6} rx={3} fill="var(--color-ink-200)">
						<title>{`Moon above the horizon: ${formatClockTime(span.start, timeZone)}–${formatClockTime(span.end, timeZone)}`}</title>
					</rect>
				))}
				{now > display.start && now < display.end && <line x1={scale.x(now)} x2={scale.x(now)} y1={AXIS_HEIGHT} y2={height} stroke="var(--color-ink-100)" strokeDasharray="1 3" />}
				{selected && <rect x={scale.x(selected.start)} y={AXIS_HEIGHT} width={Math.max(1, scale.x(selected.end) - scale.x(selected.start) - MARK_GAP)} height={height - AXIS_HEIGHT} rx={2} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} pointerEvents="none" />}
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
				<span className="inline-flex items-center gap-1.5">
					<span className="inline-block h-2.5 w-4 rounded-xs border-[1.5px] border-ink-100" />
					Best window
				</span>
				<span className="inline-flex items-center gap-1.5">
					<span className="inline-block h-2.5 w-4 rounded-xs border-[1.5px] border-accent" />
					Hour chosen
				</span>
				<span>Seeing and transparency: class 1 best, 8 worst, every 3 hours</span>
			</p>
		</>
	)
}
