import type { MasterReference, StackingCohort, StackingFilterGroup, StackingFrameSummary, StackingJobSummary, StackingProjectDetail, StackingSettings, StackingValidation } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { Actions, Notice } from '../../equipment-control/parts'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { TextInput } from '../../ui/TextInput'
import { bytesText } from '../calibrationlibrary/library'
// oxfmt-ignore
import { cohortText, LIGHT_MASTER_KINDS, LIGHT_MASTER_LABELS, type LightMaster, masterKey, masterText, metricText, registrationText, REJECTION_LABELS, selectionFields, selectionOf, SEVERITY_LABELS, SEVERITY_TONES, THRESHOLDS } from './format'
import { cancelStackingAnalysis, imageStackingRuntime, jobEnded, startStackingAnalysis, updateStackingCohort, updateStackingSettings } from './projects'
import { Cell, Row, Table } from './Table'

// Calibration and quality of an Image Stacking project. Calibration lists its cohorts, the lights of one filter that share
// their acquisition settings, where an operator declares their camera and pins compatible masters of the Calibration
// Library or decides, with a reason, not to calibrate them. Quality starts the analysis that measures and registers every
// frame, edits the reference pins and thresholds, and shows what the server found; what blocks a stack comes from its
// validation, never from this view.

// Cohorts of a project and their calibration.
export function CalibrationView({ projectId }: { readonly projectId: string }) {
	const { cohorts } = useSnapshot(imageStackingRuntime)
	const items = (cohorts ?? []) as readonly StackingCohort[]

	if (items.length === 0) return <EmptyState title="No cohorts" description="Included lights of a filter group with an available file appear here, by acquisition settings." />

	return (
		<>
			<p className="m-0 text-xs text-ink-300">Frames are calibrated with the exact master revisions pinned here. Only revisions the Calibration Library finds compatible can be pinned, and a camera unknown to the headers must be declared for any to match.</p>
			{items.map((cohort) => (
				<CohortCard key={`${cohort.cohortId}:${cohort.cameraId ?? ''}:${JSON.stringify(cohort.calibration ?? null)}`} projectId={projectId} cohort={cohort} />
			))}
		</>
	)
}

// Returns the master choices a cohort starts from: its pins, or what the library suggests.
function initialChoices(cohort: StackingCohort) {
	const pins: Partial<Record<LightMaster, MasterReference>> = cohort.calibration?.kind === 'masters' ? cohort.calibration : cohort.calibration ? {} : cohort.suggested
	const choices: Partial<Record<LightMaster, string>> = {}
	for (const kind of LIGHT_MASTER_KINDS) if (pins[kind]) choices[kind] = masterKey(pins[kind])
	return choices
}

// Camera, masters, and decision of one cohort.
function CohortCard({ projectId, cohort }: { readonly projectId: string; readonly cohort: StackingCohort }) {
	const { pending, errors } = useSnapshot(imageStackingRuntime)
	const [camera, setCamera] = useState(cohort.cameraId ?? '')
	const [cameraReason, setCameraReason] = useState(cohort.cameraReason ?? '')
	const [choices, setChoices] = useState(() => initialChoices(cohort))
	const [reason, setReason] = useState(cohort.calibration?.kind === 'none' ? cohort.calibration.reason : '')
	const key = `cohort:${cohort.cohortId}`
	const busy = pending[key] === true
	const { target } = cohort
	const suggested = LIGHT_MASTER_KINDS.some((kind) => cohort.suggested[kind])
	const chosen = LIGHT_MASTER_KINDS.some((kind) => choices[kind])

	function update(patch: Parameters<typeof updateStackingCohort>[3]) {
		void updateStackingCohort(imageStackingRuntime, projectId, cohort.cohortId, patch)
	}

	function pin() {
		const calibration: { kind: 'masters' } & Partial<Record<LightMaster, MasterReference>> = { kind: 'masters' }

		for (const kind of LIGHT_MASTER_KINDS) {
			const candidate = cohort.candidates.find((item) => item.kind === kind && masterKey(item) === choices[kind])
			if (candidate) calibration[kind] = { masterId: candidate.masterId, revision: candidate.revision, digest: candidate.digest }
		}

		update({ calibration })
	}

	const decided = cohort.calibration === undefined ? { tone: 'danger' as const, label: 'Undecided' } : cohort.calibration.kind === 'none' ? { tone: 'warning' as const, label: 'Not Calibrated' } : { tone: 'success' as const, label: 'Masters Pinned' }
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
				<StatusBadge tone={decided.tone} label={decided.label} />
			</div>
			<p className="m-0 text-xs text-ink-300 tabular-nums">{[cohort.cameraName ?? 'Unknown camera', ...settings.filter((item) => item !== undefined)].join(' · ')}</p>
			<div className="flex flex-wrap items-end gap-3">
				<TextInput label="Camera ID" className="w-48" value={camera} onChange={(event) => setCamera(event.target.value)} />
				<TextInput label="How it is known" className="w-64" value={cameraReason} onChange={(event) => setCameraReason(event.target.value)} />
				<Button variant="secondary" disabled={!camera.trim() || !cameraReason || busy || (camera.trim() === cohort.cameraId && cameraReason === cohort.cameraReason)} onClick={() => update({ camera: { id: camera, reason: cameraReason } })}>
					Declare Camera
				</Button>
				{cohort.cameraId !== undefined && (
					<Button variant="secondary" disabled={busy} onClick={() => update({ camera: null })}>
						Forget Camera
					</Button>
				)}
			</div>
			{cohort.candidates.length === 0 && (
				<Notice>
					{cohort.reviewCandidates > 0
						? `${cohort.reviewCandidates} masters of the library match these frames only if what they do not know is settled. Declare the camera that took them.`
						: 'No master of the library matches these frames. Build their masters in the Calibration Library, or decide they are not calibrated.'}
				</Notice>
			)}
			{cohort.candidates.length > 0 && (
				<>
					<div className="flex flex-wrap items-end gap-3">
						{LIGHT_MASTER_KINDS.map((kind) => (
							<Select
								key={kind}
								label={LIGHT_MASTER_LABELS[kind]}
								className="w-72"
								options={['', ...cohort.candidates.filter((item) => item.kind === kind).map(masterKey)]}
								value={choices[kind] ?? ''}
								format={(option) => {
									const candidate = cohort.candidates.find((item) => item.kind === kind && masterKey(item) === option)
									return candidate ? masterText(candidate) : 'None'
								}}
								onChange={(value) => setChoices({ ...choices, [kind]: value || undefined })}
							/>
						))}
					</div>
					{choices.dark && choices.bias && <Notice>A dark already holds the bias pedestal, so the bias is not applied with it.</Notice>}
					<Actions>
						<Button disabled={!chosen || busy} onClick={pin}>
							Pin Masters
						</Button>
						{suggested && (
							<Button variant="secondary" disabled={busy} onClick={() => update({ calibration: { kind: 'masters', ...cohort.suggested } })}>
								Use Suggested
							</Button>
						)}
					</Actions>
				</>
			)}
			<div className="flex flex-wrap items-end gap-3">
				<TextInput label="Why not calibrate" className="w-80" value={reason} onChange={(event) => setReason(event.target.value)} />
				<Button variant="secondary" disabled={!reason || busy} onClick={() => update({ calibration: { kind: 'none', reason } })}>
					No Calibration
				</Button>
				{cohort.calibration !== undefined && (
					<Button variant="secondary" disabled={busy} onClick={() => update({ calibration: null })}>
						Decide Again
					</Button>
				)}
			</div>
			{errors[key] && <Notice error>{errors[key]}</Notice>}
		</div>
	)
}

// What the server found about a stack of the project.
function ValidationList({ validation }: { readonly validation: StackingValidation }) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex flex-wrap items-center gap-2">
				<StatusBadge tone={validation.ready ? 'success' : 'danger'} label={validation.ready ? 'Ready to Stack' : 'Not Ready'} />
				{validation.samples > 0 && <span className="text-xs text-ink-300 tabular-nums">{`About ${bytesText(validation.memoryBytes)} of memory for the largest frame`}</span>}
			</div>
			{validation.findings.map((finding) => (
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
	const filters = ((groups ?? []) as readonly StackingFilterGroup[]).filter((item) => item.key !== '')

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
					<Button disabled={pending.analysis === true} onClick={() => void startStackingAnalysis(imageStackingRuntime, projectId)}>
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
					<Select label="Filter" className="w-44" options={filters.map((item) => item.key)} value={group} format={(key) => filters.find((item) => item.key === key)?.name ?? key} onChange={onGroup} />
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
				<Select label="Project Reference" className="w-44" options={['', ...groups.map((item) => item.key)]} value={referenceGroup} format={(key) => (key === '' ? 'Automatic' : (groups.find((item) => item.key === key)?.name ?? key))} onChange={setReferenceGroup} />
				{THRESHOLDS.map(({ key, label, unit }) => (
					<TextInput key={key} label={unit ? `${label} (${unit})` : label} className="w-36" value={fields[key] ?? ''} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} />
				))}
				<Button variant="secondary" disabled={pending.settings === true} onClick={save}>
					Save Settings
				</Button>
			</div>
			{errors.settings && <Notice error>{errors.settings}</Notice>}
			<p className="m-0 text-xs text-ink-300">Frames failing a threshold stay in the project and out of the stack. A blank threshold checks nothing. Every filter registers onto the reference of the project reference filter.</p>
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
						<Cell>{quality?.starCount ?? '—'}</Cell>
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
