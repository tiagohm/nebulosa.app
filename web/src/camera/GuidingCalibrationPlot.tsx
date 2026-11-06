import type { GuidingSessionCalibration } from 'api'

// Measured steps of a guiding calibration on the guide image, as the camera sees them: X to the right and Y down, in guide
// pixels from where the star was when the calibration started, both axes to one scale. The RA steps out, the RA steps
// back, the DEC steps out and the DEC steps back each have their mark, and the steps measured but left out of the fits
// (no motion, DEC backlash) are drawn hollow. The measured travel of each axis is a line from where its leg started, and
// a DEC axis assumed perpendicular to RA a dashed one. Every mark names its step on hover. Nothing is recomputed but the
// scale: the steps are those the toolkit recorded.

// Half side of the plot area, in drawing units.
const HALF = 100

// Margin around the plot area, for the labels, in drawing units.
const MARGIN = 14

// Smallest half side of the plot, in guide pixels, so a short calibration is not magnified beyond reason.
const MINIMUM_EXTENT = 5

// Source record of a calibration, with the review of its measured steps.
type GuidingCalibrationRecord = GuidingSessionCalibration['record']

// Calibration sample as the review holds it.
type CalibrationSample = GuidingCalibrationRecord['calibration']['review']['raSamples'][number]

// Leg of a calibration sample.
type CalibrationLeg = CalibrationSample['leg']

// Color and label of each leg.
export const CALIBRATION_LEGS: Readonly<Record<CalibrationLeg, { readonly color: string; readonly label: string }>> = {
	raForward: { color: 'var(--color-accent)', label: 'RA out' },
	raClearing: { color: 'var(--color-warning)', label: 'RA back' },
	decForward: { color: 'var(--color-success)', label: 'DEC out' },
	decReturn: { color: 'var(--color-info)', label: 'DEC back' },
}

// Why a step was left out of its fit, for people.
const EXCLUSION_LABELS: Readonly<Record<NonNullable<CalibrationSample['excluded']>, string>> = { noMotion: 'no motion', backlash: 'DEC backlash' }

// Returns the hover text of a step: its leg and number, its pulse, its frame, where the star was in guide pixels, and why
// it was left out of its fit.
export function calibrationSampleLabel(sample: CalibrationSample) {
	const frame = sample.frameId === undefined ? '' : `, frame ${sample.frameId}`
	const excluded = sample.excluded ? `, left out: ${EXCLUSION_LABELS[sample.excluded]}` : ''
	return `${CALIBRATION_LEGS[sample.leg].label} step ${sample.step}: ${sample.pulseDirection.toLowerCase()} ${Math.round(sample.pulse)} ms${frame}, x ${sample.x.toFixed(1)} px, y ${sample.y.toFixed(1)} px${excluded}`
}

// Returns the half side of the plot holding every step and the calibration origins, in guide pixels.
export function calibrationPlotExtent(calibration: GuidingCalibrationRecord['calibration']) {
	const { review, startX, startY, decStartX, decStartY } = calibration
	let extent = Math.max(MINIMUM_EXTENT, Math.abs(decStartX - startX), Math.abs(decStartY - startY))

	for (const samples of [review.raSamples, review.clearingSamples, review.decSamples, review.decReturnSamples, review.excludedSamples]) {
		for (const { x, y } of samples) extent = Math.max(extent, Math.abs(x - startX), Math.abs(y - startY))
	}

	return extent * 1.1
}

export interface GuidingCalibrationPlotProps {
	// Source calibration, with its review.
	readonly calibration: GuidingCalibrationRecord['calibration']
}

// Measured steps of a calibration, square, with its legend.
export function GuidingCalibrationPlot({ calibration }: GuidingCalibrationPlotProps) {
	const { review, startX, startY, decStartX, decStartY } = calibration
	const extent = calibrationPlotExtent(calibration)
	const factor = HALF / extent
	const at = (x: number, y: number) => [(x - startX) * factor, (y - startY) * factor] as const
	const legs = [review.raSamples, review.clearingSamples, review.decSamples, review.decReturnSamples]
	const raEnd = review.raSamples.at(-1)
	const decEnd = review.decSamples.at(-1)
	const [decX, decY] = at(decStartX, decStartY)
	const assumedLength = (review.decSamples.reduce((sum, sample) => sum + sample.deltaX * calibration.dec.unitX + sample.deltaY * calibration.dec.unitY, 0) || calibration.dec.totalTravelPx) * factor

	return (
		<figure className="m-0 flex flex-col items-center gap-2">
			<svg viewBox={`${-HALF - MARGIN} ${-HALF - MARGIN} ${2 * (HALF + MARGIN)} ${2 * (HALF + MARGIN)}`} className="aspect-square w-full max-w-80">
				<rect x={-HALF} y={-HALF} width={2 * HALF} height={2 * HALF} fill="none" stroke="var(--color-line-100)" vectorEffect="non-scaling-stroke" />
				<path d={`M${-HALF} 0H${HALF}M0 ${-HALF}V${HALF}`} fill="none" stroke="var(--color-line-100)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
				{raEnd && <line x1={0} y1={0} x2={at(raEnd.x, raEnd.y)[0]} y2={at(raEnd.x, raEnd.y)[1]} stroke={CALIBRATION_LEGS.raForward.color} strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />}
				{decEnd && <line x1={decX} y1={decY} x2={at(decEnd.x, decEnd.y)[0]} y2={at(decEnd.x, decEnd.y)[1]} stroke={CALIBRATION_LEGS.decForward.color} strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />}
				{calibration.orthogonalAssumed && <line x1={decX} y1={decY} x2={decX + calibration.dec.unitX * assumedLength} y2={decY + calibration.dec.unitY * assumedLength} stroke={CALIBRATION_LEGS.decForward.color} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />}
				{legs.map((samples) =>
					samples.map((sample) => {
						const [x, y] = at(sample.x, sample.y)
						return (
							<circle key={`${sample.leg}:${sample.step}`} cx={x} cy={y} r={2.8} fill={CALIBRATION_LEGS[sample.leg].color} vectorEffect="non-scaling-stroke">
								<title>{calibrationSampleLabel(sample)}</title>
							</circle>
						)
					}),
				)}
				{review.excludedSamples.map((sample) => {
					const [x, y] = at(sample.x, sample.y)
					return (
						<circle key={`excluded:${sample.leg}:${sample.step}`} cx={x} cy={y} r={2.8} fill="none" stroke={CALIBRATION_LEGS[sample.leg].color} vectorEffect="non-scaling-stroke">
							<title>{calibrationSampleLabel(sample)}</title>
						</circle>
					)
				})}
				<circle r={3.5} fill="none" stroke="var(--color-ink-100)" vectorEffect="non-scaling-stroke">
					<title>Start</title>
				</circle>
				<g fill="var(--color-ink-300)" fontSize={10} dominantBaseline="central">
					<text x={HALF + 3} y={0}>
						X
					</text>
					<text x={3} y={HALF + 8}>
						Y
					</text>
				</g>
			</svg>
			<figcaption className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-ink-300 tabular-nums">
				{Object.entries(CALIBRATION_LEGS).map(([leg, { color, label }]) => (
					<span key={leg} className="flex items-center gap-1">
						<svg viewBox="-4 -4 8 8" className="size-2.5">
							<circle r={3} fill={color} />
						</svg>
						{label}
					</span>
				))}
				<span>{`hollow: left out · half side ${extent.toFixed(1)} px${calibration.orthogonalAssumed ? ' · dashed: DEC assumed' : ''}`}</span>
			</figcaption>
		</figure>
	)
}
