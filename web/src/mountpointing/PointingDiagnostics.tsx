import type { PointingModelDetail, PointingRevision, PointingSampleRecord } from 'api'
import { cn } from 'cn'
import type { ReactNode } from 'react'
import { formatArcsec, formatPercent, formatPixelLength, formatZonedDateTime, MISSING } from '../format'
import { useActiveTimeZone } from '../location/useLocation'
import { formatPixelScale, formatPositionAngle } from '../platesolving/coordinates'
import { formatDeclination, formatRightAscension } from '../sky/format'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { SectionHeading } from '../ui/SectionHeading'
import { errorDistribution, errorInPixels, rejectionReasons } from './skymap'

// Figures of a run, shared by Images and Tools: the verdict of a revision in one line (its offline gate, the error before
// and on unseen sky, in arcseconds and in pixels of the frame, and its test on the sky), the measures grouped by what they
// measure (the samples fitted, the sky the fit never saw, the coverage), the rejections and the warnings of the fit, and
// the samples one by one. The measures are the server's, and a measure that does not exist is a dash, never a zero, since
// a zero would read as a perfect mount.

// Word and tone of each outcome of the offline gate.
const GATE_WORDS: Readonly<Record<PointingRevision['gate'], { readonly word: string; readonly tone: string }>> = {
	passed: { word: 'Passed', tone: 'text-success' },
	failed: { word: 'Failed', tone: 'text-danger' },
	unusable: { word: 'Unusable', tone: 'text-danger' },
}

// Word of each pier side a mount reports.
export const PIER_SIDE_WORDS: Readonly<Record<PointingSampleRecord['pierSide'], string>> = { EAST: 'East', WEST: 'West', NEITHER: 'Unknown' }

// Label and value of a measure.
function Measure({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="min-w-0">
			<dt className="truncate text-xs text-ink-300">{label}</dt>
			<dd className="m-0 truncate text-sm text-ink-100 tabular-nums">{children}</dd>
		</div>
	)
}

// A heading and the measures under it.
function MeasureGroup({ title, children }: { readonly title: string; readonly children: ReactNode }) {
	return (
		<section className="flex flex-col gap-1">
			<SectionHeading>{title}</SectionHeading>
			<dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-x-3 gap-y-1">{children}</dl>
		</section>
	)
}

// Returns a count of samples with its unit, or a dash when it is unknown.
function formatSamples(count: number | undefined) {
	return count === undefined ? MISSING : `${count} ${count === 1 ? 'sample' : 'samples'}`
}

// The verdict of a revision: what its offline gate says, the error before correction against the one it leaves on sky it
// never saw (or on the samples it was fitted to, when nothing was withheld), in arcseconds and in pixels of the frame at
// the image scale of the model, and the latest test of the revision on the sky.
export function PointingVerdict({ model, revision }: { readonly model: Pick<PointingModelDetail, 'optics'>; readonly revision?: PointingRevision }) {
	if (!revision) return <p className="m-0 text-sm text-ink-300">Not fitted yet.</p>

	const { word, tone } = GATE_WORDS[revision.gate]
	const { rawRms, heldOutRms, trainingRms } = revision.offline
	const unseen = heldOutRms !== undefined
	const left = unseen ? heldOutRms : trainingRms
	const verification = revision.verifications.at(-1)
	const pixels = errorInPixels(left, model.optics.scale)

	return (
		<div className="flex flex-col gap-0.5 text-sm text-ink-100 tabular-nums">
			<p className="m-0">
				<span className={cn('font-medium', tone)}>{word}</span>
				{` · Raw RMS ${formatArcsec(rawRms)} → ${unseen ? 'Withheld RMS' : 'Fit Residual'} ${formatArcsec(left)}${pixels === undefined ? '' : ` (${formatPixelLength(pixels)})`}`}
			</p>
			<p className="m-0 text-ink-200">
				{verification ? (
					<>
						{'On Sky '}
						<span className={cn('font-medium', verification.passed ? 'text-success' : 'text-danger')}>{verification.passed ? 'Passed' : 'Failed'}</span>
						{` · ${verification.count} ${verification.count === 1 ? 'target' : 'targets'}, ${formatArcsec(verification.uncorrectedRms)} uncorrected → ${formatArcsec(verification.correctedRms)} corrected`}
					</>
				) : (
					'On Sky · Not verified'
				)}
			</p>
		</div>
	)
}

// The measures of a revision, grouped: the samples it was fitted to, the sky it never saw, and the coverage of the run.
export function PointingMeasures({ model, revision }: { readonly model: Pick<PointingModelDetail, 'plan' | 'samples'>; readonly revision?: PointingRevision }) {
	const accepted = model.samples.reduce((count, sample) => count + (sample.status === 'accepted' ? 1 : 0), 0)
	const offline = revision?.offline
	const residuals = revision?.residuals ?? []
	const fitted = errorDistribution(residuals.filter((residual) => !residual.heldOut).map((residual) => Math.hypot(residual.dx, residual.dy)))
	const withheld = errorDistribution(residuals.filter((residual) => residual.heldOut).map((residual) => Math.hypot(residual.dx, residual.dy)))
	const coverage = revision?.fitted.diagnostics?.skyCoverage.skyCoverageRatio

	return (
		<div className="flex flex-col gap-3">
			<MeasureGroup title="Fit">
				<Measure label="Residual">{formatArcsec(offline?.trainingRms)}</Measure>
				<Measure label="Median">{formatArcsec(fitted.median)}</Measure>
				<Measure label="P95">{formatArcsec(fitted.p95)}</Measure>
			</MeasureGroup>
			<MeasureGroup title="Unseen Sky">
				<Measure label="Leave-One-Out">{formatArcsec(offline?.looRms)}</Measure>
				<Measure label="Withheld RMS">{formatArcsec(offline?.heldOutRms)}</Measure>
				<Measure label="Withheld Median">{formatArcsec(withheld.median)}</Measure>
				<Measure label="Withheld P95">{formatArcsec(offline?.heldOutP95)}</Measure>
			</MeasureGroup>
			<MeasureGroup title="Coverage">
				<Measure label="Accepted">{`${accepted} of ${model.plan.waypoints.length}`}</Measure>
				<Measure label="East Side">{formatSamples(offline?.perSide.EAST)}</Measure>
				<Measure label="West Side">{formatSamples(offline?.perSide.WEST)}</Measure>
				<Measure label="Sky Coverage">{coverage === undefined ? MISSING : formatPercent(coverage)}</Measure>
			</MeasureGroup>
		</div>
	)
}

// What the measures leave unsaid: the warnings of the fit, each led by its word, and how many attempts each reason rejected.
export function PointingDiagnostics({ model, revision }: { readonly model: Pick<PointingModelDetail, 'samples'>; readonly revision?: PointingRevision }) {
	const reasons = rejectionReasons(model.samples)
	const warnings = revision?.fitted.diagnostics?.warnings ?? []
	if (reasons.length === 0 && warnings.length === 0) return null

	return (
		<div className="flex flex-col gap-1 text-sm text-ink-200">
			{warnings.map((warning) => (
				<p key={warning} className="m-0 text-pretty">
					<span className="font-medium text-warning">Warning</span>
					{` · ${warning.charAt(0).toUpperCase()}${warning.slice(1)}`}
				</p>
			))}
			{reasons.map(([reason, count]) => (
				<p key={reason} className="m-0 text-pretty">
					<span className="font-medium text-danger">Rejected</span>
					{` · ${count} × ${reason}`}
				</p>
			))}
		</div>
	)
}

export interface PointingSampleInspectorProps {
	// Sample shown.
	readonly sample: PointingSampleRecord
	// Revision whose errors are shown.
	readonly revision?: PointingRevision
	// Whether the sample is left out of the next fit.
	readonly excluded?: boolean
	// Leaves an accepted sample out of the next fit, or puts it back; without it the inspector only reads.
	readonly onExclude?: (excluded: boolean) => void
}

// Everything measured of one sample, and, where a fit can be asked for, whether it goes into the next one.
export function PointingSampleInspector({ sample, revision, excluded = false, onExclude }: PointingSampleInspectorProps) {
	const timeZone = useActiveTimeZone()
	const residual = revision?.residuals.find((each) => each.id === sample.id)

	return (
		<div className="flex flex-col gap-2">
			<DataList>
				<DataRow label="Point">{`${sample.waypoint + 1}, attempt ${sample.attempt}${sample.role === 'heldOut' ? ', withheld' : ''}`}</DataRow>
				<DataRow label="Taken">{formatZonedDateTime(sample.time, timeZone)}</DataRow>
				<DataRow label="Command">{`${formatRightAscension(sample.command.rightAscension)} ${formatDeclination(sample.command.declination)}`}</DataRow>
				<DataRow label="Solved">{sample.solved ? `${formatRightAscension(sample.solved.rightAscension)} ${formatDeclination(sample.solved.declination)}` : MISSING}</DataRow>
				<DataRow label="Pier Side">{PIER_SIDE_WORDS[sample.pierSide]}</DataRow>
				<DataRow label="Scale">{sample.scale === undefined ? MISSING : formatPixelScale(sample.scale)}</DataRow>
				<DataRow label="Rotation">{formatPositionAngle(sample.orientation)}</DataRow>
				<DataRow label="Error">{residual ? `${formatArcsec(residual.rawDx)} E, ${formatArcsec(residual.rawDy)} N` : MISSING}</DataRow>
				<DataRow label="Left by Model">{residual ? `${formatArcsec(residual.dx)} E, ${formatArcsec(residual.dy)} N` : MISSING}</DataRow>
				{sample.reason && (
					<DataRow label="Rejected" tone="danger">
						{sample.reason}
					</DataRow>
				)}
			</DataList>
			{onExclude && sample.status === 'accepted' && <Checkbox label="Leave out of the next fit" checked={excluded} onChange={onExclude} />}
		</div>
	)
}
