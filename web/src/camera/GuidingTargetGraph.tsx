import type { GuidingSessionSummary, GuidingTelemetrySample } from 'api'
import { useState } from 'react'
import { Button } from '../ui/Button'

// Target graph of a guiding session, drawn under the viewer beside the history: the RA and DEC errors of the latest guide
// steps around the lock at the center, RA to the right and DEC up, in arcseconds when the pixel scale is known and in
// guide pixels otherwise, both axes to one scale stated by its rings. Only the steps converted with the calibration in
// use are drawn, since an error converted with another calibration means another thing; lost frames have no error. The
// RMS counts the guiding steps only, never those settling or moving to a dithered lock, which are drawn hollow. Clear
// Display forgets the steps drawn so far on this tab, never the telemetry of the server.

// Radius of the outer ring, in drawing units.
const RADIUS = 100

// Margin around the outer ring, for the labels of the axes, in drawing units.
const MARGIN = 18

// Rings of the target.
const RINGS = 4

// Sizes of one ring, in arcseconds or pixels, the smallest that holds the steps drawn.
const RING_STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100] as const

// RMS of guide errors, in the unit of the values it was computed from.
export interface GuidingTargetRms {
	readonly ra: number
	readonly dec: number
	// sqrt(ra² + dec²).
	readonly total: number
	// Guiding steps counted.
	readonly count: number
}

// Returns the latest measured samples after the cursor after (exclusive), at most points of them, all converted with the
// calibration generation of the newest one, oldest first.
export function guidingTargetSamples(telemetry: readonly GuidingTelemetrySample[], after: number, points: number): GuidingTelemetrySample[] {
	const measured = telemetry.filter((sample) => sample.cursor > after && !sample.lost)
	const generation = measured.at(-1)?.calibrationGeneration
	return measured.filter((sample) => sample.calibrationGeneration === generation).slice(-points)
}

// Returns the RMS of the RA and DEC errors of the guiding samples, times scale, or undefined without one.
export function guidingTargetRms(samples: readonly GuidingTelemetrySample[], scale: number): GuidingTargetRms | undefined {
	let ra = 0
	let dec = 0
	let count = 0

	for (const sample of samples) {
		if (sample.phase !== 'guiding') continue
		ra += (sample.raDistance * scale) ** 2
		dec += (sample.decDistance * scale) ** 2
		count++
	}

	if (count === 0) return undefined
	ra = Math.sqrt(ra / count)
	dec = Math.sqrt(dec / count)
	return { ra, dec, total: Math.hypot(ra, dec), count }
}

// Returns the size of one ring that holds a distance in RINGS rings: the smallest of RING_STEPS that does, or the largest.
export function guidingTargetRing(distance: number) {
	return RING_STEPS.find((step) => step * RINGS >= distance) ?? RING_STEPS.at(-1)!
}

export interface GuidingTargetGraphProps {
	// Summary of the session, for its pixel scale.
	readonly session: GuidingSessionSummary
	// Telemetry samples of the session known, in cursor order.
	readonly telemetry?: readonly GuidingTelemetrySample[]
	// Latest guide steps drawn.
	readonly points: number
}

// Target graph of a session, square, as wide as its container allows up to its height.
export function GuidingTargetGraph({ session, telemetry, points }: GuidingTargetGraphProps) {
	// Cursor of the latest sample when the display was cleared; the samples after it are drawn.
	const [after, setAfter] = useState(0)
	const scale = session.pixelScale ?? 1
	const unit = session.pixelScale === undefined ? ' px' : '″'
	const samples = guidingTargetSamples(telemetry ?? [], after, points)
	const rms = guidingTargetRms(samples, scale)
	const values = samples.map((sample) => ({ cursor: sample.cursor, ra: sample.raDistance * scale, dec: sample.decDistance * scale, guiding: sample.phase === 'guiding' }))
	const ring = guidingTargetRing(Math.max(...values.map(({ ra, dec }) => Math.hypot(ra, dec)), rms?.total ?? 0, 0))
	const factor = RADIUS / (ring * RINGS)
	const format = (value: number) => `${value.toFixed(2)}${unit}`

	return (
		<figure className="m-0 flex items-center gap-4 max-sm:flex-col">
			<svg viewBox={`${-RADIUS - MARGIN} ${-RADIUS - MARGIN} ${2 * (RADIUS + MARGIN)} ${2 * (RADIUS + MARGIN)}`} className="h-44 max-w-full flex-none">
				<g fill="none" stroke="var(--color-line-100)">
					{Array.from({ length: RINGS }, (_, index) => (
						<circle key={index} r={((index + 1) * RADIUS) / RINGS} vectorEffect="non-scaling-stroke" />
					))}
					<path d={`M${-RADIUS} 0H${RADIUS}M0 ${-RADIUS}V${RADIUS}`} vectorEffect="non-scaling-stroke" />
				</g>
				{rms && <circle r={rms.total * factor} fill="none" stroke="var(--color-accent)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
				<g fill="var(--color-ink-300)" fontSize={11} textAnchor="middle" dominantBaseline="central">
					<text x={RADIUS + 9}>RA</text>
					<text y={-RADIUS - 9}>DEC</text>
				</g>
				{values.map(({ cursor, ra, dec, guiding }, index) => {
					const last = index === values.length - 1
					const x = Math.max(-RADIUS, Math.min(RADIUS, ra * factor))
					const y = Math.max(-RADIUS, Math.min(RADIUS, -dec * factor))
					return (
						<circle key={cursor} cx={x} cy={y} r={last ? 4 : 2.2} fill={last ? 'var(--color-accent)' : guiding ? 'var(--color-success)' : 'none'} stroke={guiding || last ? 'none' : 'var(--color-ink-300)'} fillOpacity={last ? 1 : 0.7} vectorEffect="non-scaling-stroke">
							<title>{`RA ${format(ra)}, DEC ${format(dec)}${guiding ? '' : ', settling'}`}</title>
						</circle>
					)
				})}
			</svg>
			<div className="flex flex-col gap-2 text-xs text-ink-300 tabular-nums">
				<span>{`Ring ${ring}${unit} · ${values.length} steps`}</span>
				{rms ? (
					<>
						<span>{`RMS RA ${format(rms.ra)}`}</span>
						<span>{`RMS DEC ${format(rms.dec)}`}</span>
						<span>{`RMS total ${format(rms.total)} (${rms.count}), dashed`}</span>
					</>
				) : (
					<span>No guiding step yet</span>
				)}
				<Button variant="secondary" className="self-start" disabled={values.length === 0} onClick={() => setAfter(telemetry?.at(-1)?.cursor ?? 0)}>
					Clear Display
				</Button>
			</div>
		</figure>
	)
}
