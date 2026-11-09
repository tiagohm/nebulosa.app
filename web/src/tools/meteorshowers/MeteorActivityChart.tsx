import type { MeteorActivityCurve } from 'api'
import { useState } from 'react'
import { formatDate } from '../../format'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { formatPeak, formatSolarLongitude } from './meteorshowers.format'

// Activity curve of a shower: the ZHR of its published activity profile against the date or the solar longitude, with
// the profile's maximum, the published visual maximum (IMO) and its typical ZHR as a separate mark, and now. Without a
// profile no curve is drawn: only the visual maximum is marked, since a curve cannot be inferred from a single peak. The
// two sources are never merged; their maxima and peak ZHRs may differ, and both are labelled.

// Size of the drawing, in viewBox units.
const WIDTH = 720
const HEIGHT = 200

// Margins of the plot, in viewBox units.
const MARGIN = { top: 12, right: 12, bottom: 28, left: 40 } as const

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
	const profile = curve.profile
	const visual = curve.visual

	if (!profile) {
		return (
			<p className="m-0 text-xs text-ink-300">
				{visual
					? `No published activity profile is curated for this shower, so no curve is drawn: only the published maximum, ${formatPeak(visual.peak, visual.peakSolarLongitudeDecimals, timeZone)}${visual.typicalZhr === undefined ? '' : ` with a typical ZHR of ${visual.typicalZhr}`}, is known.`
					: 'No activity profile or visual maximum is known for this shower.'}
			</p>
		)
	}

	const samples = profile.samples
	// Unwrapped solar longitudes in degrees, continuous across 0°.
	const degrees = samples.map((sample) => (((sample.solarLongitude - samples[0].solarLongitude + 4 * Math.PI) % (2 * Math.PI)) * 180) / Math.PI + (samples[0].solarLongitude * 180) / Math.PI)
	const xs = axis === 'date' ? samples.map((sample) => sample.time) : degrees
	const minX = xs[0]
	const maxX = xs.at(-1)!
	const maxZhr = Math.max(profile.zhr, visual?.typicalZhr ?? 0) * 1.1
	const plotWidth = WIDTH - MARGIN.left - MARGIN.right
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
	const xTicks = axis === 'date' ? ticks(minX / 86400000, maxX / 86400000, 6).map((day) => day * 86400000) : ticks(minX, maxX, 6)
	const visualX = visual && visual.peak >= samples[0].time && visual.peak <= samples.at(-1)!.time ? atTime(visual.peak) : undefined
	const nowX = now >= samples[0].time && now <= samples.at(-1)!.time ? atTime(now) : undefined

	return (
		<div className="flex flex-col gap-2">
			<SegmentedControl className="self-start" options={['date', 'solarLongitude'] as const} value={axis} format={(value) => (value === 'date' ? 'Date' : 'Solar longitude')} onChange={setAxis} />
			<div className="overflow-x-auto">
				<svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full min-w-[480px] text-[10px]">
					<title>ZHR of the published activity profile over its support; the IMO maximum is marked apart.</title>
					{ticks(0, maxZhr, 4).map((zhr) => (
						<g key={zhr}>
							<line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(zhr)} y2={y(zhr)} stroke="var(--color-line-100)" />
							<text x={MARGIN.left - 4} y={y(zhr)} dy="0.35em" textAnchor="end" fill="var(--color-ink-300)">
								{zhr}
							</text>
						</g>
					))}
					{xTicks.map((value) => (
						<text key={value} x={x(value)} y={HEIGHT - 10} textAnchor="middle" fill="var(--color-ink-300)">
							{axis === 'date' ? formatDate(value, timeZone).slice(5) : `${(value % 360).toFixed(value % 1 === 0 ? 0 : 1)}°`}
						</text>
					))}
					<path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
					<circle cx={x(atTime(profile.peakTime))} cy={y(profile.zhr)} r={3.5} fill="var(--color-accent)" />
					{visualX !== undefined && visual?.typicalZhr !== undefined && (
						<g>
							<line x1={x(visualX)} x2={x(visualX)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke="var(--color-warning)" strokeDasharray="4 3" />
							<circle cx={x(visualX)} cy={y(visual.typicalZhr)} r={3.5} fill="none" stroke="var(--color-warning)" strokeWidth={1.5} />
						</g>
					)}
					{nowX !== undefined && <line x1={x(nowX)} x2={x(nowX)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke="var(--color-ink-100)" strokeDasharray="1 3" />}
				</svg>
			</div>
			<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-300">
				<span>
					<span className="text-accent">━</span> profile ZHR (published model)
				</span>
				<span>● model maximum {formatSolarLongitude(profile.peakSolarLongitude, 2)}</span>
				{visual && <span className="text-warning">╌ ○ IMO maximum and typical ZHR</span>}
				{nowX !== undefined && <span>┆ now</span>}
			</div>
		</div>
	)
}
