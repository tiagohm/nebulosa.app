import type { StackingCalibration, StackingCohort, StackingFilterGroup, StackingFrameSummary, StackingJobSummary, StackingProjectDetail, StackingSettings, StackingValidation } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { Notice } from '../../equipment-control/parts'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { NumberInput } from '../../ui/NumberInput'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
// oxfmt-ignore
import { blocksAnalysis, cohortText, LIGHT_MASTER_KINDS, LIGHT_MASTER_LABELS, type LightMaster, masterText, metricText, registrationText, REJECTION_LABELS, selectionFields, selectionOf, SEVERITY_LABELS, SEVERITY_TONES, THRESHOLDS } from './format'
import { MISSING } from '../../format'
import { cancelStackingAnalysis, imageStackingRuntime, jobEnded, startStackingAnalysis, updateStackingCohort, updateStackingSettings } from './projects'
import { Cell, Row, Table } from './Table'

// Calibration and quality of an Image Stacking project. Calibration lists its cohorts, the lights of one filter that share
// their acquisition settings, where an operator chooses each master among those of the Calibration Library that match
// them; a cohort with none chosen is not calibrated. Quality starts the analysis that measures and registers every
// frame, edits the reference pins and thresholds, and shows what the server found; only the blockers of its validation
// that keep an analysis from starting are shown and disable Analyze, since what blocks a stack comes from Integration.

// Cohorts of a project and their calibration.
export function CalibrationView({ projectId }: { readonly projectId: string }) {
	const { cohorts } = useSnapshot(imageStackingRuntime)
	const items = (cohorts ?? []) as readonly StackingCohort[]

	if (items.length === 0) return <EmptyState title="No cohorts" description="Included lights of a filter group with an available file appear here, by acquisition settings." />

	return (
		<>
			<p className="m-0 text-xs text-ink-300">Each list holds the masters of the Calibration Library that match the settings of these frames, newest first. A dark already holds the bias, so a bias is chosen only without one.</p>
			{items.map((cohort) => (
				<CohortCard key={cohort.cohortId} projectId={projectId} cohort={cohort} />
			))}
		</>
	)
}

// Masters of one cohort, each chosen from those that match it; a choice is saved as soon as it changes.
function CohortCard({ projectId, cohort }: { readonly projectId: string; readonly cohort: StackingCohort }) {
	const { pending, errors } = useSnapshot(imageStackingRuntime)
	const key = `cohort:${cohort.cohortId}`
	const busy = pending[key] === true
	const { target } = cohort
	const calibration: StackingCalibration = cohort.calibration ?? {}

	// Saves the choice with the master of a kind replaced, or removed for an empty option.
	function choose(kind: LightMaster, option: string) {
		const candidate = cohort.candidates.find((item) => item.kind === kind && String(item.masterId) === option)
		const next: StackingCalibration = { ...calibration, [kind]: candidate && { masterId: candidate.masterId, digest: candidate.digest } }
		void updateStackingCohort(imageStackingRuntime, projectId, cohort.cohortId, { calibration: next })
	}

	// A flat divides what is left once the pedestal is removed, so a flat alone cannot be stacked.
	const flatWithoutPedestal = calibration.flat !== undefined && !calibration.dark && !calibration.bias
	const calibrated =
		(calibration.dark || calibration.bias) && calibration.flat
			? { tone: 'success' as const, label: 'Calibrated' }
			: flatWithoutPedestal
				? { tone: 'danger' as const, label: 'Needs a Dark or Bias' }
				: calibration.dark || calibration.bias
					? { tone: 'warning' as const, label: 'Partially Calibrated' }
					: { tone: 'muted' as const, label: 'Not Calibrated' }
	const settings = [
		`${target.width}×${target.height}×${target.channels}`,
		target.cfa,
		target.binX === undefined ? undefined : `bin ${target.binX}`,
		target.gain === undefined ? undefined : `gain ${target.gain}`,
		target.offset === undefined ? undefined : `offset ${target.offset}`,
		target.temperature === undefined ? undefined : `${target.temperature} °C`,
		target.filter,
	]

	return (
		<div className="flex flex-col gap-2 rounded-md border border-line-100 p-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-sm text-ink-100">{cohortText(cohort)}</span>
				<StatusBadge tone={calibrated.tone} label={calibrated.label} />
			</div>
			<p className="m-0 text-xs text-ink-300 tabular-nums">{[cohort.cameraName ?? 'Unknown camera', ...settings.filter((item) => item !== undefined)].join(' · ')}</p>
			<div className="flex flex-wrap items-end gap-3">
				{LIGHT_MASTER_KINDS.map((kind) => {
					const candidates = cohort.candidates.filter((item) => item.kind === kind)
					const chosen = calibration[kind]
					const disabled = busy || (kind === 'bias' && calibration.dark !== undefined)

					return (
						<Select
							key={kind}
							label={LIGHT_MASTER_LABELS[kind]}
							className="w-72"
							options={['', ...candidates.map(({ masterId }) => String(masterId))]}
							value={chosen ? String(chosen.masterId) : ''}
							disabled={disabled}
							format={(option) => {
								const candidate = candidates.find(({ masterId }) => String(masterId) === option)
								return candidate ? masterText(candidate) : candidates.length === 0 ? 'None matches' : 'None'
							}}
							onChange={(option) => choose(kind, option)}
						/>
					)
				})}
			</div>
			{flatWithoutPedestal && <Notice error>A flat needs a dark or a bias: divided by the flat, the pedestal of the lights would imprint its dust and vignetting inverted.</Notice>}
			{errors[key] && <Notice error>{errors[key]}</Notice>}
		</div>
	)
}

// What the server found about the project that matters to its analysis: the blockers that keep an analysis from starting,
// and the reviews and notes about its frames. Blockers of a stack alone, such as a stale analysis, belong to Integration.
function ValidationList({ validation }: { readonly validation: StackingValidation }) {
	const findings = validation.findings.filter((finding) => finding.severity !== 'blocker' || blocksAnalysis(finding))
	if (findings.length === 0) return null

	return (
		<div className="flex flex-col gap-1.5">
			{findings.map((finding) => (
				<div key={`${finding.code}:${finding.groupKey ?? ''}:${finding.cohortId ?? ''}:${finding.message}`} className="flex items-start gap-2 text-xs text-ink-200">
					<StatusBadge tone={SEVERITY_TONES[finding.severity]} label={SEVERITY_LABELS[finding.severity]} />
					<span className="pt-1">{finding.message}</span>
				</div>
			))}
		</div>
	)
}

// Returns the latest analysis of a project this tab has seen.
function latestAnalysis(jobs: Readonly<Record<string, StackingJobSummary>>, projectId: string) {
	let latest: StackingJobSummary | undefined
	for (const job of Object.values(jobs)) if (job.type === 'analysis' && job.projectId === projectId && (!latest || job.createdAt > latest.createdAt)) latest = job
	return latest
}

// Analysis, settings, and measured frames of one filter group of the project.
export function QualityView({ projectId, group, onGroup, selected, onSelect }: { readonly projectId: string; readonly group?: string; readonly onGroup: (key: string) => void; readonly selected?: string; readonly onSelect: (sourceId: string) => void }) {
	const { project, validation, groups, jobs, pending, errors } = useSnapshot(imageStackingRuntime)
	const job = latestAnalysis(jobs, projectId)
	const running = job !== undefined && !jobEnded(job)
	const filters = (groups ?? []) as readonly StackingFilterGroup[]

	return (
		<>
			{validation && <ValidationList validation={validation} />}
			<div className="flex flex-wrap items-center gap-3">
				{running ? (
					<>
						<Notice>{job.registrationTotal !== undefined ? `Registering frames · ${job.registered ?? 0} of ${job.registrationTotal}` : `Measuring frames · ${job.measured ?? 0} of ${job.found} · ${job.failures ?? 0} not measured`}</Notice>
						<Button variant="secondary" disabled={pending[`analysis:${job.jobId}`] === true} onClick={() => void cancelStackingAnalysis(imageStackingRuntime, job.jobId)}>
							Cancel
						</Button>
					</>
				) : (
					<Button disabled={validation?.findings.some(blocksAnalysis) || pending.analysis === true} onClick={() => void startStackingAnalysis(imageStackingRuntime, projectId)}>
						Analyze
					</Button>
				)}
			</div>
			{errors.analysis && <Notice error>{errors.analysis}</Notice>}
			{job?.state === 'failed' && job.error && <Notice error>{job.error}</Notice>}
			{job?.state === 'cancelled' && <Notice>The analysis was cancelled; what it measured is kept.</Notice>}
			{project && <SettingsForm key={JSON.stringify(project.settings)} project={project} groups={filters} />}
			{filters.length > 0 && group !== undefined && (
				<>
					<Select label="Filter" className="w-44" options={filters.map((item) => item.key)} value={group} onChange={onGroup} />
					<QualityTable projectId={projectId} group={group} selected={selected} onSelect={onSelect} />
				</>
			)}
		</>
	)
}

// Project reference group and quality thresholds, saved together.
function SettingsForm({ project, groups }: { readonly project: StackingProjectDetail; readonly groups: readonly StackingFilterGroup[] }) {
	const { pending, errors } = useSnapshot(imageStackingRuntime)
	const [referenceGroup, setReferenceGroup] = useState(project.settings.referenceGroup ?? '')
	const [fields, setFields] = useState(() => selectionFields(project.settings.selection))

	function save() {
		const settings: StackingSettings = { ...(referenceGroup && { referenceGroup }), references: project.settings.references, selection: selectionOf(fields) }
		void updateStackingSettings(imageStackingRuntime, project.projectId, settings)
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-end gap-3">
				<Select label="Project Reference" className="w-44" options={['', ...groups.map((item) => item.key)]} value={referenceGroup} format={(key) => (key === '' ? 'Automatic' : key)} onChange={setReferenceGroup} />
				{THRESHOLDS.map((threshold) => (
					<NumberInput
						key={threshold.key}
						label={threshold.label}
						className="w-44 min-w-0"
						value={fields[threshold.key]}
						min={0}
						max={'max' in threshold ? threshold.max : undefined}
						step={threshold.step}
						suffix={threshold.unit || undefined}
						onChange={(value) => setFields({ ...fields, [threshold.key]: value })}
					/>
				))}
				<Button variant="secondary" disabled={pending.settings === true} onClick={save}>
					Save Settings
				</Button>
			</div>
			{errors.settings && <Notice error>{errors.settings}</Notice>}
			<p className="m-0 text-xs text-ink-300">Frames failing a threshold stay in the project and out of the stack. A threshold of 0 checks nothing. Every filter registers onto the reference of the project reference filter.</p>
		</div>
	)
}

// State of a measured frame, in words with a tone.
function frameState(frame: StackingFrameSummary) {
	const { analysis } = frame
	if (!analysis) return { tone: 'muted' as const, label: 'Not Measured' }
	if (frame.stale) return { tone: 'warning' as const, label: 'Stale' }
	if (analysis.error !== undefined) return { tone: 'danger' as const, label: analysis.error }
	if (frame.rejected) return { tone: 'warning' as const, label: [...new Set(frame.rejected.map((reason) => REJECTION_LABELS[reason]))].join(', ') }
	if (analysis.registration?.success === false) return { tone: 'danger' as const, label: 'Not Registered' }
	return { tone: 'success' as const, label: 'Accepted' }
}

// Measured frames of a filter group, with their reference.
function QualityTable({ projectId, group, selected, onSelect }: { readonly projectId: string; readonly group: string; readonly selected?: string; readonly onSelect: (sourceId: string) => void }) {
	const { frames, project, pending } = useSnapshot(imageStackingRuntime)
	const items = (frames?.items ?? []) as readonly StackingFrameSummary[]
	if (!project) return null
	const settings = project.settings
	const reference = project.analysis?.groups[group]?.referenceSourceId
	const pinned = settings.references[group]

	function pin(sourceId: string | undefined) {
		const references = { ...settings.references }
		if (sourceId === undefined) delete references[group]
		else references[group] = sourceId
		void updateStackingSettings(imageStackingRuntime, projectId, { ...settings, references })
	}

	if (items.length === 0) return <EmptyState title="No frames" description="This filter has no included light." />

	return (
		<Table className="shrink-0" headers={['File', 'Stars', 'SNR', 'HFD', 'FWHM', 'Eccentricity', 'Background', 'Score', 'Registration', 'State', 'Reference']}>
			{items.map((frame) => {
				const quality = frame.analysis?.quality
				const state = frameState(frame)

				return (
					<Row key={frame.sourceId} selected={frame.sourceId === selected} onClick={() => onSelect(frame.sourceId)}>
						<Cell>{frame.name}</Cell>
						<Cell>{quality?.starCount ?? MISSING}</Cell>
						<Cell>{metricText(quality?.medianSNR, 1)}</Cell>
						<Cell>{metricText(quality?.medianHFD)}</Cell>
						<Cell>{metricText(quality?.medianFWHM)}</Cell>
						<Cell>{metricText(quality?.medianEccentricity)}</Cell>
						<Cell>{metricText(quality?.estimatedBackground, 4)}</Cell>
						<Cell>{metricText(quality?.normalizedScore)}</Cell>
						<Cell>{registrationText(frame.analysis?.registration)}</Cell>
						<Cell>
							<StatusBadge tone={state.tone} label={state.label} />
						</Cell>
						<Cell>
							<div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
								{frame.sourceId === reference && <StatusBadge tone="active" label={pinned === frame.sourceId ? 'Pinned Reference' : 'Reference'} />}
								{quality && pinned !== frame.sourceId && (
									<Button variant="secondary" disabled={pending.settings === true} onClick={() => pin(frame.sourceId)}>
										Pin
									</Button>
								)}
								{pinned === frame.sourceId && (
									<Button variant="secondary" disabled={pending.settings === true} onClick={() => pin(undefined)}>
										Unpin
									</Button>
								)}
							</div>
						</Cell>
					</Row>
				)
			})}
		</Table>
	)
}
