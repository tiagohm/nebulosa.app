import type { GuidingCalibrationCandidate, GuidingCalibrationEvidence, GuidingCalibrationSummary, GuidingSessionCalibration } from 'api'
import { useEffect, useState } from 'react'
import { formatDegrees, formatUtcDateTime } from '../format'
import { DataList, DataRow } from '../ui/DataRow'
import { Modal } from '../ui/Modal'
import { Notice } from '../ui/Notice'
import { loadSavedCalibration, loadSessionCalibration } from './guiding'
import { GuidingCalibrationPlot } from './GuidingCalibrationPlot'

// Review Calibration: the measured steps of a guiding calibration (GuidingCalibrationPlot), the solution as it was measured
// (rates, angles, steps, travel, scatter, how far from perpendicular, the DEC backlash) with the mount context it was
// measured in, the calibration in use when a session derived it for another declination or side of the pier, the
// equipment it was measured with when it was saved, and what lowered its grade. The calibration in use and the one
// measured are never mixed in one table. Everything is read from the server when the dialog opens: the calibration a
// session uses, or a saved one; nothing is computed here but units.

// Calibration a review shows: the one a session uses, or a saved one.
export type GuidingCalibrationReviewSource = { readonly kind: 'session'; readonly sessionId: string } | { readonly kind: 'saved'; readonly calibrationId: string }

// What a review read from the server.
interface ReviewData {
	readonly record: GuidingSessionCalibration['record']
	// Calibration in use, for the calibration of a session.
	readonly summary?: GuidingCalibrationSummary
	// Equipment and geometry, for a saved calibration.
	readonly evidence?: GuidingCalibrationEvidence
	readonly assessment: GuidingCalibrationSummary['assessment']
}

// Labels of the findings of a grade.
export const CALIBRATION_FINDING_LABELS: Readonly<Record<GuidingCalibrationSummary['assessment']['findings'][number]['code'], string>> = {
	fewSteps: 'Few steps',
	shortTravel: 'Short travel',
	highResidual: 'Scattered steps',
	reverseSteps: 'Steps going backward',
	orthogonalityError: 'Axes far from perpendicular',
	largeBacklash: 'Large DEC backlash',
	decReturnShort: 'DEC return fell short',
}

// Labels of the grades.
export const CALIBRATION_QUALITY_LABELS: Readonly<Record<GuidingCalibrationSummary['assessment']['quality'], string>> = { good: 'Good', warning: 'Usable with warnings', poor: 'Poor' }

// Labels of how a saved calibration fits a session.
export const CALIBRATION_CANDIDATE_LABELS: Readonly<Record<GuidingCalibrationCandidate['status'], string>> = {
	direct: 'Fits as it is',
	transformed: 'Fits, adapted to the mount',
	incompatible: 'Other equipment',
	insufficientEvidence: 'Mount context unknown',
	requiresRecalibration: 'Needs a new calibration',
	disabled: 'Disabled',
	invalid: 'Unreadable',
}

// Labels of why a saved calibration does not fit a session.
export const CALIBRATION_REJECTION_LABELS: Readonly<Record<GuidingCalibrationCandidate['reasons'][number], string>> = {
	camera: 'guide camera',
	guideOutput: 'guide output',
	mount: 'mount',
	binning: 'binning',
	frameSize: 'frame size',
	pixelScale: 'pixel scale',
	guideRate: 'guide rate',
	disabled: 'disabled',
	invalid: 'unreadable',
	pierSideUnknown: 'side of the pier unknown',
	declinationUnknown: 'declination unknown',
	sourceNearPole: 'measured too close to the pole',
	declinationNearPole: 'pointing too close to the pole',
	rateTooSmall: 'RA rate too small there',
}

export interface GuidingCalibrationReviewProps {
	// Calibration to show; absent closes the dialog.
	readonly source?: GuidingCalibrationReviewSource
	// Arcseconds per guide pixel, for the rates on the sky; absent shows pixels only.
	readonly pixelScale?: number
	readonly onClose: () => void
}

// Review Calibration dialog.
export function GuidingCalibrationReview({ source, pixelScale, onClose }: GuidingCalibrationReviewProps) {
	const [data, setData] = useState<ReviewData>()
	const [error, setError] = useState<string>()

	useEffect(() => {
		setData(undefined)
		setError(undefined)
		if (!source) return
		let current = true

		const loading =
			source.kind === 'session'
				? loadSessionCalibration(source.sessionId).then(({ record, summary }): ReviewData => ({ record, summary, assessment: summary.assessment }))
				: loadSavedCalibration(source.calibrationId).then((entry): ReviewData => {
						if (entry.status === 'invalid') throw new Error(`The saved calibration cannot be read: ${entry.reason}`)
						const { record, evidence, assessment } = entry
						return { record, evidence, assessment }
					})

		loading.then(
			(loaded) => current && setData(loaded),
			(reason: unknown) => current && setError(reason instanceof Error ? reason.message : String(reason)),
		)

		return () => {
			current = false
		}
	}, [source])

	const scale = data?.evidence?.pixelScale ?? pixelScale

	return (
		<Modal open={source !== undefined} onClose={onClose} title="Review Calibration" className="max-w-4xl">
			{error && <Notice error>{error}</Notice>}
			{!data && !error && <p className="m-0 text-sm text-ink-300">Loading…</p>}
			{data && (
				<div className="grid grid-cols-[minmax(0,20rem)_minmax(0,1fr)] gap-6 max-md:grid-cols-1">
					<GuidingCalibrationPlot calibration={data.record.calibration} />
					<div className="flex min-w-0 flex-col gap-4">
						<MeasuredSection record={data.record} pixelScale={scale} />
						{data.summary && <InUseSection summary={data.summary} pixelScale={scale} />}
						{data.evidence && <EquipmentSection evidence={data.evidence} />}
						<QualitySection assessment={data.assessment} />
					</div>
				</div>
			)}
		</Modal>
	)
}

// The solution as it was measured, with its context.
function MeasuredSection({ record, pixelScale }: { readonly record: ReviewData['record']; readonly pixelScale?: number }) {
	const { calibration, context, acquiredAt } = record
	const { review } = calibration

	return (
		<section className="flex flex-col gap-1">
			<h3 className="m-0 font-mono text-xs tracking-wide text-ink-300 uppercase">Measured</h3>
			<DataList>
				<DataRow label="When">{formatUtcDateTime(acquiredAt)}</DataRow>
				<DataRow label="Where">{formatContext(context.declination, context.pierSide)}</DataRow>
				<DataRow label="RA">{formatAxis(calibration.ra.ratePxPerMs, calibration.ra.angle, review.raSamples.length, calibration.ra.totalTravelPx, calibration.ra.rmsOrthogonalResidualPx, pixelScale)}</DataRow>
				<DataRow label="DEC">{formatAxis(review.measuredDec.ratePxPerMs, review.measuredDec.angle, review.decSamples.length, review.measuredDec.totalTravelPx, review.measuredDec.rmsOrthogonalResidualPx, pixelScale)}</DataRow>
				{calibration.orthogonalAssumed && <DataRow label="DEC Assumed">{`${formatRate(calibration.dec.ratePxPerMs, pixelScale)} at ${formatDegrees(calibration.dec.angle, 1)}, perpendicular to RA`}</DataRow>}
				<DataRow label="Off Perpendicular">{formatDegrees(review.orthogonalityError, 1)}</DataRow>
				<DataRow label="DEC Backlash">{`${Math.round(calibration.backlash)} ms`}</DataRow>
				<DataRow label="Returns">{`${calibration.clearingSteps} RA, ${calibration.decReturnSteps} DEC steps`}</DataRow>
				{review.excludedSamples.length > 0 && <DataRow label="Left Out">{`${review.excludedSamples.length} steps`}</DataRow>}
			</DataList>
		</section>
	)
}

// The calibration a session derived for where the mount points.
function InUseSection({ summary, pixelScale }: { readonly summary: GuidingCalibrationSummary; readonly pixelScale?: number }) {
	const adapted = summary.transformations.map((transformation) => (transformation === 'pierFlip' ? 'flipped for the pier side' : `RA ×${summary.declinationScale.toFixed(3)}`)).join(', ')

	return (
		<section className="flex flex-col gap-1">
			<h3 className="m-0 font-mono text-xs tracking-wide text-ink-300 uppercase">In use</h3>
			<DataList>
				<DataRow label="Origin">{`${summary.origin === 'restored' ? 'Restored' : 'Solved in this session'}${summary.saved ? ', saved' : ', not saved'}`}</DataRow>
				<DataRow label="For">{formatContext(summary.current.declination, summary.current.pierSide)}</DataRow>
				<DataRow label="Adapted">{adapted || 'As measured'}</DataRow>
				<DataRow label="RA">{`${formatRate(summary.raRate, pixelScale)} at ${formatDegrees(summary.raAngle, 1)}`}</DataRow>
				<DataRow label="DEC">{`${formatRate(summary.decRate, pixelScale)} at ${formatDegrees(summary.decAngle, 1)}`}</DataRow>
			</DataList>
		</section>
	)
}

// The equipment and geometry a saved calibration was measured with.
function EquipmentSection({ evidence }: { readonly evidence: GuidingCalibrationEvidence }) {
	return (
		<section className="flex flex-col gap-1">
			<h3 className="m-0 font-mono text-xs tracking-wide text-ink-300 uppercase">Equipment</h3>
			<DataList>
				<DataRow label="Guide Camera">{evidence.camera.name}</DataRow>
				<DataRow label="Guide Output">{evidence.guideOutput.name}</DataRow>
				{evidence.mount && <DataRow label="Mount">{evidence.mount.name}</DataRow>}
				<DataRow label="Frames">{`${evidence.width} × ${evidence.height} px, bin ${evidence.binX}×${evidence.binY}`}</DataRow>
				{evidence.pixelScale !== undefined && <DataRow label="Pixel Scale">{`${evidence.pixelScale.toFixed(2)}″/px`}</DataRow>}
				{evidence.guideRate && <DataRow label="Guide Rate">{`RA ${evidence.guideRate.rightAscension.toFixed(2)}×, DEC ${evidence.guideRate.declination.toFixed(2)}× sidereal`}</DataRow>}
			</DataList>
		</section>
	)
}

// The grade and what lowered it.
function QualitySection({ assessment }: { readonly assessment: ReviewData['assessment'] }) {
	return (
		<section className="flex flex-col gap-1">
			<h3 className="m-0 font-mono text-xs tracking-wide text-ink-300 uppercase">Quality</h3>
			<DataList>
				<DataRow label="Grade" tone={assessment.quality === 'poor' ? 'danger' : assessment.quality === 'good' ? 'success' : 'default'}>
					{CALIBRATION_QUALITY_LABELS[assessment.quality]}
				</DataRow>
				{assessment.findings.map((finding) => (
					<DataRow key={`${finding.code}:${finding.axis ?? ''}`} label={`${CALIBRATION_FINDING_LABELS[finding.code]}${finding.axis ? ` (${finding.axis.toUpperCase()})` : ''}`} tone={finding.severity === 'critical' ? 'danger' : 'default'}>
						{formatFinding(finding)}
					</DataRow>
				))}
			</DataList>
		</section>
	)
}

// Formats a mount context: the declination in degrees and the side of the pier, each when known.
function formatContext(declination: number | undefined, pierSide: string | undefined) {
	return `${declination === undefined ? 'DEC unknown' : `DEC ${formatDegrees(declination, 1)}`}, ${pierSide && pierSide !== 'NEITHER' ? `pier ${pierSide.toLowerCase()}` : 'pier side unknown'}`
}

// Formats a rate given in pixels per millisecond, as pixels per second and, with a pixel scale, arcseconds per second.
function formatRate(rate: number, pixelScale: number | undefined) {
	const perSecond = rate * 1000
	return pixelScale === undefined ? `${perSecond.toFixed(2)} px/s` : `${perSecond.toFixed(2)} px/s (${(perSecond * pixelScale).toFixed(1)}″/s)`
}

// Formats a measured axis: its rate, angle, fitted steps, travel and scatter across it.
function formatAxis(rate: number, angle: number, steps: number, travel: number, residual: number, pixelScale: number | undefined) {
	return `${formatRate(rate, pixelScale)} at ${formatDegrees(angle, 1)}; ${steps} steps over ${travel.toFixed(1)} px, scatter ${residual.toFixed(2)} px`
}

// Formats the value of a finding against its limit, in its unit.
function formatFinding({ code, value, limit }: ReviewData['assessment']['findings'][number]) {
	if (value === undefined || limit === undefined) return 'Yes'

	switch (code) {
		case 'shortTravel':
			return `${value.toFixed(1)} px, under ${limit} px`
		case 'highResidual':
			return `${(value * 100).toFixed(0)}% of a step, over ${(limit * 100).toFixed(0)}%`
		case 'orthogonalityError':
			return `${formatDegrees(value, 1)}, over ${formatDegrees(limit, 0)}`
		case 'largeBacklash':
			return `${Math.round(value)} ms, over ${limit} ms`
		default:
			return `${value}, limit ${limit}`
	}
}
