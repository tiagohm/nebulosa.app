import type { StackingCalibration, StackingCohort, StackingFilterGroup, StackingFinding, StackingFrameSummary, StackingJobSummary, StackingProjectDetail, StackingSettings, StackingValidation } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { catalogCameraName, catalogState } from '../../equipment/catalog'
import { formatTemperature, MISSING } from '../../format'
import { useActiveTimeZone } from '../../location/useLocation'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { DisclosureSummary } from '../../ui/DisclosureSummary'
import { LinkButton } from '../../ui/LinkButton'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { SectionHeading } from '../../ui/SectionHeading'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { blocksAnalysis, cohortCalibration, cohortText, LIGHT_MASTER_KINDS, LIGHT_MASTER_LABELS, type LightMaster, masterText, metricText, registrationText, REJECTION_LABELS, selectionFields, selectionOf, SEVERITY_LABELS, SEVERITY_TONES, THRESHOLDS } from './format'
import { JobProgress } from './JobProgress'
import { cancelStackingAnalysis, imageStackingRuntime, jobEnded, startStackingAnalysis, updateStackingCohort, updateStackingSettings } from './projects'

// Calibration and quality of an Image Stacking project. Calibration lists its cohorts, the lights of one filter that share
// their acquisition settings, where an operator chooses each master among those of the Calibration Library that match
// them; a cohort with none chosen is not calibrated. Masters are listed only for the camera of the Equipment Catalog that
// took the lights: the one the captures of this server recorded, or the one an operator declares for lights from
// elsewhere. Quality shows what the server found, grouped by kind with a way to Calibration for what it fixes; edits the
// reference and the thresholds the analysis and the stack follow; starts the analysis that measures and registers every
// frame; and lists the measured frames of one filter. Only the blockers of its validation that keep an analysis from
// starting are shown and disable Analyze, since what blocks a stack comes from Integration.

// Findings that choosing or declaring something in Calibration resolves.
const CALIBRATION_CODES: ReadonlySet<StackingFinding['code']> = new Set(['unknownCamera', 'partialCalibration', 'flatWithoutPedestal', 'masterUnavailable', 'masterIncompatible'])

// Cohorts of a project and their calibration.
export function CalibrationView({ projectId }: { readonly projectId: string }) {
	const { cohorts } = useSnapshot(imageStackingRuntime)
	if (!cohorts) return null
	const items = cohorts as readonly StackingCohort[]

	if (items.length === 0) return <EmptyState title="No cohorts" description="Included lights of a filter group with an available file appear here, by acquisition settings." />

	return (
		<>
			<Notice className="max-w-prose">Each list holds the masters of the Calibration Library that match the settings of these frames, newest first. A dark already holds the bias, so a bias is chosen only without one.</Notice>
			{items.map((cohort) => (
				<CohortCard key={cohort.cohortId} projectId={projectId} cohort={cohort} />
			))}
		</>
	)
}

// Masters of one cohort, each chosen from those that match it; a choice is saved as soon as it changes.
function CohortCard({ projectId, cohort }: { readonly projectId: string; readonly cohort: StackingCohort }) {
	const timeZone = useActiveTimeZone()
	const { pending, errors } = useSnapshot(imageStackingRuntime)
	const { cameras } = useSnapshot(catalogState)
	const key = `cohort:${cohort.cohortId}`
	const busy = pending[key] === true
	const { target } = cohort
	const calibration: StackingCalibration = cohort.calibration ?? {}
	const calibrated = cohortCalibration(calibration)

	// Saves the choice with the master of a kind replaced, or removed for an empty option.
	function choose(kind: LightMaster, option: string) {
		const candidate = cohort.candidates.find((item) => item.kind === kind && String(item.masterId) === option)
		const next: StackingCalibration = { ...calibration, [kind]: candidate && { masterId: candidate.masterId, digest: candidate.digest } }
		void updateStackingCohort(imageStackingRuntime, projectId, cohort.cohortId, { calibration: next })
	}

	const settings = [
		`${target.width}×${target.height}×${target.channels}`,
		target.cfa,
		target.binX === undefined ? undefined : `Bin ${target.binX}×${target.binY ?? target.binX}`,
		target.gain === undefined ? undefined : `Gain ${target.gain}`,
		target.offset === undefined ? undefined : `Offset ${target.offset}`,
		target.temperature === undefined ? undefined : formatTemperature(target.temperature),
		target.filter,
	]

	return (
		<div className="flex flex-col gap-2 rounded-md border border-line-100 p-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-sm text-ink-100">{cohortText(cohort)}</span>
				<StatusBadge tone={calibrated.tone} label={calibrated.label} />
			</div>
			<p className="m-0 text-xs text-ink-300 tabular-nums">{[target.cameraId === undefined ? (cohort.cameraName ?? 'Unknown camera') : catalogCameraName(cameras, target.cameraId), ...settings.filter((item) => item !== undefined)].join(' · ')}</p>
			{cohort.capturedCameraId === undefined && (
				<div className="flex flex-col gap-2">
					<Select
						label="Camera"
						className="w-72 max-w-full flex-none"
						options={['', ...cameras.filter((camera) => !camera.archived || camera.id === cohort.cameraId).map((camera) => camera.id)]}
						value={cohort.cameraId ?? ''}
						disabled={busy}
						format={(option) => (option ? catalogCameraName(cameras, option) : 'Which camera took these lights?')}
						onChange={(option) => void updateStackingCohort(imageStackingRuntime, projectId, cohort.cohortId, { cameraId: option || null })}
					/>
					<Notice className="max-w-prose">No capture of this server recorded these lights. Declare the camera of the Equipment Catalog that took them to list its masters.</Notice>
				</div>
			)}
			<div className="flex flex-wrap items-end gap-3">
				{LIGHT_MASTER_KINDS.map((kind) => {
					const candidates = cohort.candidates.filter((item) => item.kind === kind)
					const chosen = calibration[kind]
					const holdsBias = kind === 'bias' && calibration.dark !== undefined

					return (
						<Select
							key={kind}
							label={LIGHT_MASTER_LABELS[kind]}
							className="w-72 max-w-full flex-none"
							options={['', ...candidates.map(({ masterId }) => String(masterId))]}
							value={chosen ? String(chosen.masterId) : ''}
							disabled={busy || holdsBias}
							title={holdsBias ? 'The dark chosen already holds the bias' : undefined}
							format={(option) => {
								const candidate = candidates.find(({ masterId }) => String(masterId) === option)
								return candidate ? masterText(candidate, timeZone) : candidates.length === 0 ? 'None matches' : 'None'
							}}
							onChange={(option) => choose(kind, option)}
						/>
					)
				})}
			</div>
			{calibrated.label === 'Needs a Dark or Bias' && (
				<Notice error className="max-w-prose">
					A flat needs a dark or a bias: divided by the flat, the pedestal of the lights would imprint its dust and vignetting inverted.
				</Notice>
			)}
			{errors[key] && <Notice error>{errors[key]}</Notice>}
		</div>
	)
}

// What the server found about the project that matters to its analysis, one badge for each kind and severity with the
// message of each filter or cohort under it: the blockers that keep an analysis from starting, and the reviews and notes
// about its frames. Blockers of a stack alone, such as a stale analysis, belong to Integration. A kind that Calibration
// resolves offers a way there.
function ValidationList({ validation, onCalibration }: { readonly validation: StackingValidation; readonly onCalibration: () => void }) {
	const findings = validation.findings.filter((finding) => finding.severity !== 'blocker' || blocksAnalysis(finding))
	if (findings.length === 0) return null
	const kinds = new Map<string, StackingFinding[]>()

	for (const finding of findings) {
		const key = `${finding.severity}:${finding.code}`
		const kind = kinds.get(key)
		if (kind) kind.push(finding)
		else kinds.set(key, [finding])
	}

	return (
		<div className="flex flex-col gap-2">
			{[...kinds].map(([key, items]) => (
				<div key={key} className="flex items-start gap-2 text-xs leading-4 text-ink-200">
					<StatusBadge tone={SEVERITY_TONES[items[0].severity]} label={SEVERITY_LABELS[items[0].severity]} />
					<div className="flex min-w-0 flex-col gap-0.5 pt-1">
						{items.map((finding) => (
							<span key={`${finding.groupKey ?? ''}:${finding.cohortId ?? ''}:${finding.message}`}>{finding.message}</span>
						))}
						{CALIBRATION_CODES.has(items[0].code) && (
							<LinkButton className="self-start" onClick={onCalibration}>
								Show Calibration
							</LinkButton>
						)}
					</div>
				</div>
			))}
		</div>
	)
}

// Returns the latest analysis of a project this tab has seen.
export function latestAnalysis(jobs: Readonly<Record<string, StackingJobSummary>>, projectId: string) {
	let latest: StackingJobSummary | undefined
	for (const job of Object.values(jobs)) if (job.type === 'analysis' && job.projectId === projectId && (!latest || job.createdAt > latest.createdAt)) latest = job
	return latest
}

export interface QualityViewProps {
	readonly projectId: string
	// Key of the filter group whose frames are listed.
	readonly group?: string
	// Lists the frames of another filter group.
	readonly onGroup: (key: string) => void
	// Frame shown in the panel, and shows another one.
	readonly selected?: string
	readonly onSelect: (sourceId: string) => void
	// Shows the Calibration step.
	readonly onCalibration: () => void
}

// What the server found, the settings of the analysis, the analysis, and the measured frames of one filter group.
export function QualityView({ projectId, group, onGroup, selected, onSelect, onCalibration }: QualityViewProps) {
	const { project, validation, groups, jobs, pending, errors } = useSnapshot(imageStackingRuntime)
	const job = latestAnalysis(jobs, projectId)
	const running = job !== undefined && !jobEnded(job)
	const filters = (groups ?? []) as readonly StackingFilterGroup[]
	const blocker = validation?.findings.find(blocksAnalysis)

	return (
		<>
			{validation && <ValidationList validation={validation} onCalibration={onCalibration} />}
			{project && <SettingsForm key={JSON.stringify(project.settings)} project={project} groups={filters} />}
			{running ? (
				<JobProgress job={job} cancelLabel="Cancel Analysis" cancelling={pending[`analysis:${job.jobId}`] === true} onCancel={() => void cancelStackingAnalysis(imageStackingRuntime, job.jobId)} />
			) : (
				<div>
					<Button disabled={blocker !== undefined || pending.analysis === true} title={blocker?.message ?? 'Measures and registers every included light'} onClick={() => void startStackingAnalysis(imageStackingRuntime, projectId)}>
						Analyze
					</Button>
				</div>
			)}
			{errors.analysis && <Notice error>{errors.analysis}</Notice>}
			{errors[`analysis:${job?.jobId}`] && <Notice error>{errors[`analysis:${job?.jobId}`]}</Notice>}
			{job?.state === 'failed' && job.error && <Notice error>{job.error}</Notice>}
			{job?.state === 'cancelled' && <Notice>The analysis was cancelled; what it measured is kept.</Notice>}
			{filters.length > 0 && group !== undefined && (
				<>
					<div className="flex flex-wrap items-end gap-3">
						<Select label="Filter" className="w-44 flex-none" options={filters.map((item) => item.key)} value={group} onChange={onGroup} />
					</div>
					<QualityTable projectId={projectId} group={group} selected={selected} onSelect={onSelect} />
				</>
			)}
		</>
	)
}

// Text of what the settings of a project ask, for the summary of their disclosure.
function settingsSummary(settings: StackingSettings) {
	const thresholds = THRESHOLDS.filter((threshold) => settings.selection[threshold.key] !== undefined).length
	return `Reference ${settings.referenceGroup ?? 'automatic'} · ${thresholds === 0 ? 'no thresholds' : thresholds === 1 ? '1 threshold' : `${thresholds} thresholds`}`
}

// Project reference group and quality thresholds, saved together, in a closed disclosure whose summary says what they
// ask, so the frames come first and a phone does not scroll through six fields to reach them.
function SettingsForm({ project, groups }: { readonly project: StackingProjectDetail; readonly groups: readonly StackingFilterGroup[] }) {
	const { pending, errors } = useSnapshot(imageStackingRuntime)
	const [referenceGroup, setReferenceGroup] = useState(project.settings.referenceGroup ?? '')
	const [fields, setFields] = useState(() => selectionFields(project.settings.selection))

	function save() {
		const settings: StackingSettings = { ...(referenceGroup && { referenceGroup }), references: project.settings.references, selection: selectionOf(fields) }
		void updateStackingSettings(imageStackingRuntime, project.projectId, settings)
	}

	return (
		<details className="group rounded-md border border-line-100 px-3">
			<DisclosureSummary title="Settings">
				<span className="min-w-0 truncate text-xs text-ink-300 group-open:hidden">{settingsSummary(project.settings)}</span>
			</DisclosureSummary>
			<div className="-mt-1 flex flex-col gap-3 pb-3">
				<div className="flex flex-wrap gap-x-7 gap-y-3">
					<div className="flex flex-col gap-2">
						<SectionHeading>Registration</SectionHeading>
						<Select label="Project Reference" className="w-44 flex-none" options={['', ...groups.map((item) => item.key)]} value={referenceGroup} format={(key) => (key === '' ? 'Automatic' : key)} onChange={setReferenceGroup} />
					</div>
					<div className="flex flex-col gap-2">
						<SectionHeading>Thresholds</SectionHeading>
						<div className="flex flex-wrap items-end gap-3">
							{THRESHOLDS.map((threshold) => (
								<NumberInput
									key={threshold.key}
									label={threshold.label}
									className="w-40 min-w-0 flex-none"
									value={fields[threshold.key]}
									min={0}
									max={'max' in threshold ? threshold.max : undefined}
									step={threshold.step}
									suffix={threshold.unit || undefined}
									onChange={(value) => setFields({ ...fields, [threshold.key]: value })}
								/>
							))}
						</div>
					</div>
				</div>
				<div>
					<Button variant="secondary" disabled={pending.settings === true} onClick={save}>
						Save Settings
					</Button>
				</div>
				{errors.settings && <Notice error>{errors.settings}</Notice>}
				<Notice className="max-w-prose">Frames failing a threshold stay in the project and out of the stack. A threshold of 0 checks nothing. Every filter registers onto the reference of the project reference filter.</Notice>
			</div>
		</details>
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
	if (!project || !frames) return null
	const items = frames.items as readonly StackingFrameSummary[]
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
		<Table className="shrink-0" columns={['File', 'Stars', 'SNR', 'HFD', 'FWHM', 'Eccentricity', 'Background', 'Score', 'Registration', 'State', 'Reference']}>
			{items.map((frame) => {
				const quality = frame.analysis?.quality
				const state = frameState(frame)

				return (
					<Row key={frame.sourceId} selected={frame.sourceId === selected} onSelect={() => onSelect(frame.sourceId)}>
						<Cell>{frame.name}</Cell>
						<Cell>{quality?.starCount ?? MISSING}</Cell>
						<Cell>{metricText(quality?.medianSNR, 1)}</Cell>
						<Cell className="whitespace-nowrap">{metricText(quality?.medianHFD, 2, 'px')}</Cell>
						<Cell className="whitespace-nowrap">{metricText(quality?.medianFWHM, 2, 'px')}</Cell>
						<Cell>{metricText(quality?.medianEccentricity)}</Cell>
						<Cell>{metricText(quality?.estimatedBackground, 4)}</Cell>
						<Cell>{metricText(quality?.normalizedScore)}</Cell>
						<Cell>{registrationText(frame.analysis?.registration)}</Cell>
						<Cell>
							<StatusBadge tone={state.tone} label={state.label} />
						</Cell>
						<Cell>
							<div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
								{frame.sourceId === reference && <StatusBadge tone="neutral" label={pinned === frame.sourceId ? 'Pinned Reference' : 'Reference'} />}
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
