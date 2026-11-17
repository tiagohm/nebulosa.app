import type { MeteorActivityCurve } from 'api'
import { useEffect, useRef, useState } from 'react'
import { formatDate } from '../../format'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { formatPeak, formatSolarLongitude } from './meteorshowers.format'

// Activity curve of a shower: the ZHR of its published activity profile against the date or the solar longitude, with
// the profile's maximum, the published visual maximum (IMO) and its typical ZHR as a separate mark, the year-specific
// events as marks along the top, and now. Without a profile no curve is drawn: only the visual maximum is named, since a
// curve cannot be inferred from a single peak. The two sources are never merged; their maxima and peak ZHRs may differ,
// and both are labelled. It is drawn at the width of its frame, one SVG unit to a CSS pixel, so its labels keep the
// caption size at every width.

// Narrowest width the chart is drawn at, CSS pixels.
const MIN_WIDTH = 280

// Height of the chart, CSS pixels.
const HEIGHT = 180

// Margins of the plot, CSS pixels.
const MARGIN = { top: 18, right: 10, bottom: 24, left: 38 } as const

// Size of the labels, CSS pixels: the caption size.
const FONT_SIZE = 10.5

// Colour of the profile: the meteor radiant hue of the Sky.
const PROFILE = 'var(--color-map-radiant)'

// Axis of the curve.
type ActivityAxis = 'date' | 'solarLongitude'

// Ticks of an axis between two values: about `count` round steps.
function ticks(min: number, max: number, count: number) {
	const span = max - min
	if (!(span > 0)) return [min]
	const raw = span / count
	const magnitude = 10 ** Math.floor(Math.log10(raw))
	const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ?? raw
	const values: number[] = []
	for (let value = Math.ceil(min / step) * step; value <= max; value += step) values.push(value)
	return values
}

// Mark of a year-specific event: a small downward triangle in Starlight Cream, centred on x with its tip at y.
function eventMark(x: number, y: number) {
	return `M${x - 4},${y - 6} L${x + 4},${y - 6} L${x},${y} Z`
}

export interface MeteorActivityChartProps {
	// Curve drawn.
	readonly curve: MeteorActivityCurve
	// IANA zone the dates are labelled in.
	readonly timeZone: string
	// Instant marked as now, Unix milliseconds.
	readonly now: number
}

// Activity chart of a shower.
export function MeteorActivityChart({ curve, timeZone, now }: MeteorActivityChartProps) {
	const [axis, setAxis] = useState<ActivityAxis>('date')
	const frame = useRef<HTMLDivElement>(null)
	const [measured, setMeasured] = useState(0)
	const width = Math.max(MIN_WIDTH, measured)
	const profile = curve.profile
	const visual = curve.visual

	// Follows the width of the frame.
	useEffect(() => {
		const element = frame.current
		if (!element) return
		const observer = new ResizeObserver(([entry]) => setMeasured(entry.contentRect.width))
		observer.observe(element)
		return () => observer.disconnect()
	}, [profile])

	if (!profile) {
		return (
			<Notice>
				{visual
					? `No published activity profile is curated for this shower, so no curve is drawn: only the published maximum, ${formatPeak(visual.peak, visual.peakSolarLongitudeDecimals, timeZone)}${visual.typicalZhr === undefined ? '' : ` with a typical ZHR of ${visual.typicalZhr}`}, is known.`
					: 'No activity profile or visual maximum is known for this shower.'}
			</Notice>
		)
	}

	const samples = profile.samples
	// Unwrapped solar longitudes in degrees, continuous across 0°.
	const degrees = samples.map((sample) => (((sample.solarLongitude - samples[0].solarLongitude + 4 * Math.PI) % (2 * Math.PI)) * 180) / Math.PI + (samples[0].solarLongitude * 180) / Math.PI)
	const xs = axis === 'date' ? samples.map((sample) => sample.time) : degrees
	const minX = xs[0]
	const maxX = xs.at(-1)!
	const maxZhr = Math.max(profile.zhr, visual?.typicalZhr ?? 0) * 1.1
	const plotWidth = width - MARGIN.left - MARGIN.right
	const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
	const x = (value: number) => MARGIN.left + ((value - minX) / Math.max(1e-9, maxX - minX)) * plotWidth
	const y = (zhr: number) => MARGIN.top + (1 - zhr / maxZhr) * plotHeight
	// A time on the chosen axis: itself on dates, else the solar longitude of the nearest sample.
	const atTime = (time: number) => {
		if (axis === 'date') return time
		let nearest = 0
		for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i].time - time) < Math.abs(samples[nearest].time - time)) nearest = i
		return degrees[nearest]
	}
	const path = samples.map((sample, i) => `${i === 0 ? 'M' : 'L'}${x(xs[i]).toFixed(1)},${y(sample.zhr).toFixed(1)}`).join(' ')
	const tickCount = width < 480 ? 3 : 6
	const xTicks = axis === 'date' ? ticks(minX / 86400000, maxX / 86400000, tickCount).map((day) => day * 86400000) : ticks(minX, maxX, tickCount)
	const visualX = visual && visual.peak >= samples[0].time && visual.peak <= samples.at(-1)!.time ? atTime(visual.peak) : undefined
	const nowX = now >= samples[0].time && now <= samples.at(-1)!.time ? atTime(now) : undefined
	const events = curve.annualEvents.filter((event) => event.time >= samples[0].time && event.time <= samples.at(-1)!.time)

	return (
		<figure className="m-0 flex flex-col gap-2">
			<SegmentedControl className="self-start" options={['date', 'solarLongitude'] as const} value={axis} format={(value) => (value === 'date' ? 'Date' : 'Solar longitude')} onChange={setAxis} />
			<div ref={frame} className="w-full">
				<svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} className="block max-w-full">
					<title>ZHR of the published activity profile over its support; the IMO maximum is marked apart.</title>
					<text x={MARGIN.left - 4} y={10} textAnchor="end" fontSize={FONT_SIZE} fill="var(--color-ink-300)">
						ZHR
					</text>
					{ticks(0, maxZhr, 4).map((zhr) => (
						<g key={zhr}>
							<line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(zhr)} y2={y(zhr)} stroke="var(--color-line-100)" />
							<text x={MARGIN.left - 4} y={y(zhr)} dy="0.35em" textAnchor="end" fontSize={FONT_SIZE} fill="var(--color-ink-300)">
								{zhr}
							</text>
						</g>
					))}
					{xTicks.map((value) => (
						<text key={value} x={x(value)} y={HEIGHT - 7} textAnchor="middle" fontSize={FONT_SIZE} fill="var(--color-ink-300)">
							{axis === 'date' ? formatDate(value, timeZone).slice(5) : `${(value % 360).toFixed(value % 1 === 0 ? 0 : 1)}°`}
						</text>
					))}
					<path d={path} fill="none" stroke={PROFILE} strokeWidth={2} />
					<circle cx={x(atTime(profile.peakTime))} cy={y(profile.zhr)} r={3.5} fill={PROFILE} />
					{visualX !== undefined && visual?.typicalZhr !== undefined && (
						<g>
							<line x1={x(visualX)} x2={x(visualX)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke="var(--color-ink-200)" strokeDasharray="4 3" />
							<circle cx={x(visualX)} cy={y(visual.typicalZhr)} r={3.5} fill="var(--color-base-100)" stroke="var(--color-ink-100)" strokeWidth={1.5} />
						</g>
					)}
					{events.map((event) => (
						<path key={event.id} d={eventMark(x(atTime(event.time)), MARGIN.top - 2)} fill="var(--color-ink-100)">
							<title>{`${event.attribution} (${event.confidence})`}</title>
						</path>
					))}
					{nowX !== undefined && <line x1={x(nowX)} x2={x(nowX)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke="var(--color-ink-100)" strokeDasharray="1 3" />}
				</svg>
			</div>
			<figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-300">
				<span className="flex items-center gap-1.5">
					<svg width={16} height={8} className="flex-none">
						<line x1={0} x2={16} y1={4} y2={4} stroke={PROFILE} strokeWidth={2} />
					</svg>
					Profile ZHR (published model), its maximum {formatSolarLongitude(profile.peakSolarLongitude, 2)}
				</span>
				{visualX !== undefined && (
					<span className="flex items-center gap-1.5">
						<svg width={16} height={10} className="flex-none">
							<line x1={8} x2={8} y1={0} y2={10} stroke="var(--color-ink-200)" strokeDasharray="3 2" />
							<circle cx={8} cy={5} r={3} fill="var(--color-base-100)" stroke="var(--color-ink-100)" strokeWidth={1.5} />
						</svg>
						IMO maximum and typical ZHR
					</span>
				)}
				{events.length > 0 && (
					<span className="flex items-center gap-1.5">
						<svg width={10} height={8} className="flex-none">
							<path d={eventMark(5, 7)} fill="var(--color-ink-100)" />
						</svg>
						Year-specific event, never drawn into the curve
					</span>
				)}
				{nowX !== undefined && (
					<span className="flex items-center gap-1.5">
						<svg width={8} height={10} className="flex-none">
							<line x1={4} x2={4} y1={0} y2={10} stroke="var(--color-ink-100)" strokeDasharray="1 3" />
						</svg>
						Now
					</span>
				)}
			</figcaption>
		</figure>
	)
}
