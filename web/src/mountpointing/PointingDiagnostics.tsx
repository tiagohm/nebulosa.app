import type { PointingModelDetail, PointingRevision, PointingSampleRecord } from 'api'
import { toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import type { ReactNode } from 'react'
import { formatDeclination, formatRightAscension } from '../sky/format'
import { errorDistribution, rejectionReasons } from './skymap'

// Figures of a run, shared by Images and Tools: the measures of a revision with the ones on unseen sky told apart, the
// spread of what the model leaves, the coverage, the rejections, and the samples one by one. The measures are the server's,
// and a measure that does not exist is a dash, never a zero, since a zero would read as a perfect mount.

// Text shown for a measure that does not exist.
const MISSING = '—'

// Formats an angle in radians as arcseconds, or a dash.
export function formatArcsec(angle: number | undefined | null) {
	return angle === undefined || angle === null ? MISSING : `${toArcsec(angle).toFixed(1)}″`
}

// Label and value of a measure.
function Measure({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="min-w-0">
			<dt className="truncate text-[11px] text-ink-300">{label}</dt>
			<dd className="m-0 truncate text-ink-100 tabular-nums">{children}</dd>
		</div>
	)
}

// The measures of a revision at a glance.
export function PointingMeasures({ model, revision }: { readonly model: Pick<PointingModelDetail, 'plan' | 'samples'>; readonly revision?: PointingRevision }) {
	const accepted = model.samples.reduce((count, sample) => count + (sample.status === 'accepted' ? 1 : 0), 0)
	const offline = revision?.offline

	return (
		<dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-x-3 gap-y-1">
			<Measure label="Accepted">{`${accepted} / ${model.plan.waypoints.length}`}</Measure>
			<Measure label="Raw RMS">{formatArcsec(offline?.rawRms)}</Measure>
			<Measure label="Fit Residual">{formatArcsec(offline?.trainingRms)}</Measure>
			<Measure label="Leave-One-Out">{formatArcsec(offline?.looRms)}</Measure>
			<Measure label="Withheld RMS">{formatArcsec(offline?.heldOutRms)}</Measure>
			<Measure label="Withheld P95">{formatArcsec(offline?.heldOutP95)}</Measure>
		</dl>
	)
}

// Details behind the measures: the spread, the coverage, the sides, the rejections, and the warnings of the fit.
export function PointingDiagnostics({ model, revision }: { readonly model: Pick<PointingModelDetail, 'samples'>; readonly revision?: PointingRevision }) {
	const reasons = rejectionReasons(model.samples)
	const residuals = revision?.residuals ?? []
	const fitted = errorDistribution(residuals.filter((residual) => !residual.heldOut).map((residual) => Math.hypot(residual.dx, residual.dy)))
	const withheld = errorDistribution(residuals.filter((residual) => residual.heldOut).map((residual) => Math.hypot(residual.dx, residual.dy)))
	const { diagnostics } = revision?.fitted ?? {}
	const perSide = revision?.offline.perSide

	return (
		<div className="flex flex-col gap-2 text-xs">
			<dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-x-3 gap-y-1">
				<Measure label="Fit Median">{formatArcsec(fitted.median)}</Measure>
				<Measure label="Fit P95">{formatArcsec(fitted.p95)}</Measure>
				<Measure label="Withheld Median">{formatArcsec(withheld.median)}</Measure>
				<Measure label="East Side">{perSide?.EAST ?? MISSING}</Measure>
				<Measure label="West Side">{perSide?.WEST ?? MISSING}</Measure>
				<Measure label="Sky Coverage">{diagnostics ? `${(diagnostics.skyCoverage.skyCoverageRatio * 100).toFixed(0)}%` : MISSING}</Measure>
			</dl>
			{reasons.length > 0 && (
				<ul className="m-0 list-none p-0 text-ink-300">
					{reasons.map(([reason, count]) => (
						<li key={reason}>{`${count} × ${reason}`}</li>
					))}
				</ul>
			)}
			{diagnostics?.warnings.map((warning) => (
				<p key={warning} className="m-0 text-ink-300">
					{warning}
				</p>
			))}
		</div>
	)
}

// Everything measured of one sample.
export function PointingSampleInspector({ sample, revision }: { readonly sample: PointingSampleRecord; readonly revision?: PointingRevision }) {
	const residual = revision?.residuals.find((each) => each.id === sample.id)

	return (
		<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
			<dt className="text-ink-300">Point</dt>
			<dd className="m-0 text-right tabular-nums">{`${sample.waypoint + 1}, attempt ${sample.attempt}${sample.role === 'heldOut' ? ', withheld' : ''}`}</dd>
			<dt className="text-ink-300">Taken</dt>
			<dd className="m-0 text-right tabular-nums">{new Date(sample.time).toISOString().slice(0, 19).replace('T', ' ')}</dd>
			<dt className="text-ink-300">Command</dt>
			<dd className="m-0 text-right tabular-nums">{`${formatRightAscension(sample.command.rightAscension)} ${formatDeclination(sample.command.declination)}`}</dd>
			<dt className="text-ink-300">Solved</dt>
			<dd className="m-0 text-right tabular-nums">{sample.solved ? `${formatRightAscension(sample.solved.rightAscension)} ${formatDeclination(sample.solved.declination)}` : MISSING}</dd>
			<dt className="text-ink-300">Pier Side</dt>
			<dd className="m-0 text-right">{sample.pierSide}</dd>
			<dt className="text-ink-300">Scale</dt>
			<dd className="m-0 text-right tabular-nums">{sample.scale === undefined ? MISSING : `${toArcsec(sample.scale).toFixed(3)} ″/px`}</dd>
			<dt className="text-ink-300">Rotation</dt>
			<dd className="m-0 text-right tabular-nums">{sample.orientation === undefined ? MISSING : `${toDeg(sample.orientation).toFixed(2)}°`}</dd>
			<dt className="text-ink-300">Error</dt>
			<dd className="m-0 text-right tabular-nums">{residual ? `${formatArcsec(residual.rawDx)} E, ${formatArcsec(residual.rawDy)} N` : MISSING}</dd>
			<dt className="text-ink-300">Left by Model</dt>
			<dd className="m-0 text-right tabular-nums">{residual ? `${formatArcsec(residual.dx)} E, ${formatArcsec(residual.dy)} N` : MISSING}</dd>
			{sample.reason && (
				<>
					<dt className="text-ink-300">Rejected</dt>
					<dd className="m-0 text-right text-danger">{sample.reason}</dd>
				</>
			)}
		</dl>
	)
}
