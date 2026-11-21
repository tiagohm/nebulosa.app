import type { Evidenced, Page, StackingFilterGroup, StackingFrameSummary, StackingImportCandidate, StackingSourceDetail } from 'api'
import { type SubmitEvent, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { catalogCameraName, catalogState } from '../../equipment/catalog'
import { FileExplorerModal } from '../../files/FileExplorerModal'
import { IMAGE_EXTENSIONS } from '../../files/files'
import { formatByteSize, formatDuration, formatExposureTime, formatTemperature, formatZonedDateTime, MISSING } from '../../format'
import { imagesState, openImage } from '../../images/images'
import { useActiveTimeZone } from '../../location/useLocation'
import { activeProfile, profileState, setLastStackingDirectory } from '../../profile/profile'
import { CollapsibleSection, LoadingSection } from '../../shell/CollapsibleSection'
import { navigate, routeState } from '../../shell/route'
import { EmptyState, useWorkspacePanel, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataRow } from '../../ui/DataRow'
import { Modal } from '../../ui/Modal'
import { Notice } from '../../ui/Notice'
import { Pager } from '../../ui/Pager'
import { Popover } from '../../ui/Popover'
import { SectionHeading } from '../../ui/SectionHeading'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { TextInput } from '../../ui/TextInput'
import { EVIDENCE_LABELS, exposureText, settingsText, SOURCE_STATUS_LABELS, SOURCE_STATUS_TONES } from '../calibrationlibrary/library'
import { CompositionView } from './Composition'
import { ALL_CANDIDATES, candidateChecked, candidateText, candidateUsable, committedCounts, type ImportSelection, isStackingSection, metricText, NO_CANDIDATES, registrationText, ROLE_LABELS, type StackingSection, stepStates, withCandidate } from './format'
import { IntegrationView } from './Integration'
import { CalibrationView, QualityView } from './Planning'
import {
	cancelStackingImport,
	commitStackingImport,
	createStackingProject,
	deleteStackingProject,
	imageStackingRuntime,
	jobEnded,
	loadStackingCandidates,
	loadStackingFrame,
	loadStackingFrames,
	loadStackingProject,
	refreshStackingProject,
	removeStackingFrame,
	renameStackingProject,
	STACKING_PAGE_SIZE,
	type StackingFrameFilter,
	startStackingImport,
	updateStackingFrame,
} from './projects'
import { Steps } from './Steps'

// Image Stacking tool: projects of light frames saved on the server, grouped by the filter their headers write. It
// works with no camera and starts no exposure. A project goes through five steps, each showing where it stands: Frames
// lists its filter groups and its frames, which enter through an import reviewed before it is committed, are left out of
// stacks or included again from their row, and have what a header does not say (role, filter) declared in the panel;
// Calibration pins the masters of each cohort; Quality measures and registers every frame; Integration combines each
// filter into a master and lists the masters; Color composes them. State lives on the server, so a reload or another tab
// shows the same projects; the project and the step shown are part of the URL.

// Group filter of the frames list: every frame, or one filter group by key.
type GroupFilter = { readonly all: true } | { readonly all: false; readonly key: string }

// Choices of the inclusion filter.
const INCLUSION_OPTIONS = ['all', 'included', 'excluded'] as const

// Labels of the inclusion filter.
const INCLUSION_LABELS: Readonly<Record<(typeof INCLUSION_OPTIONS)[number], string>> = { all: 'All Frames', included: 'Included', excluded: 'Left Out' }

// Choices of the role filter.
const ROLE_OPTIONS = ['all', 'light', 'unclassified'] as const

// Choices of the file state filter.
const STATUS_OPTIONS = ['all', 'available', 'missing', 'changed', 'corrupt'] as const

// Image Stacking tool.
export function ImageStacking() {
	const runtime = useSnapshot(imageStackingRuntime)
	const route = useSnapshot(routeState).route
	const linked = route.workspace === 'tools' ? route.project : undefined
	const projects = runtime.snapshot?.projects ?? []
	const projectId = linked ?? projects[0]?.projectId
	const section: StackingSection = route.workspace === 'tools' && isStackingSection(route.stackingStep) ? route.stackingStep : 'frames'
	const [group, setGroup] = useState<GroupFilter>({ all: true })
	const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]>('all')
	const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>('all')
	const [inclusion, setInclusion] = useState<(typeof INCLUSION_OPTIONS)[number]>('all')
	const [search, setSearch] = useState('')
	const [page, setPage] = useState(0)
	const [selected, setSelected] = useState<string>()
	const [qualityGroup, setQualityGroup] = useState<string>()
	const [creating, setCreating] = useState(false)
	const [importing, setImporting] = useState(false)
	const [editing, setEditing] = useState(false)
	const panelState = useWorkspacePanel('tools')
	const groups = (runtime.groups ?? []) as readonly StackingFilterGroup[]
	const qualityKey = groups.some((item) => item.key === qualityGroup) ? qualityGroup : groups[0]?.key
	const listed: StackingFrameFilter = { group: group.all ? undefined : group.key, role: role === 'all' ? undefined : role, status: status === 'all' ? undefined : status, included: inclusion === 'all' ? undefined : inclusion === 'included', search: search || undefined }
	const filter: StackingFrameFilter = section === 'quality' ? { group: qualityKey, role: 'light', included: true } : listed
	// Frames the running analysis of the project has measured, and which kinds of job of the project are working: each
	// measurement is saved as it arrives but announced only as job progress, so the frames shown are fetched again as it grows.
	let measured = 0
	const running: Partial<Record<'analysis' | 'integration' | 'composition', boolean>> = {}

	for (const job of Object.values(runtime.jobs)) {
		if (job.projectId !== projectId || jobEnded(job)) continue
		if (job.type === 'analysis') measured = job.measured ?? 0
		if (job.type !== 'import') running[job.type] = true
	}

	// Fetches the project and its groups, again whenever the server reports a change.
	useEffect(() => {
		void loadStackingProject(imageStackingRuntime, projectId)
	}, [projectId, runtime.changes])

	// Fetches the page of frames shown, again whenever the server reports a change or the analysis measures a frame.
	useEffect(() => {
		if (projectId !== undefined && (section === 'frames' || (section === 'quality' && qualityKey !== undefined))) void loadStackingFrames(imageStackingRuntime, projectId, filter, page)
	}, [projectId, section, group, role, status, inclusion, search, qualityKey, page, runtime.changes, measured])

	// Fetches the frame of the panel, again whenever the server reports a change or the analysis measures a frame.
	useEffect(() => {
		void loadStackingFrame(imageStackingRuntime, selected)
	}, [selected, runtime.changes, measured])

	// Shows a project at its first step, forgetting the frame and filters of the previous one.
	function showProject(next: string | undefined) {
		setSelected(undefined)
		setGroup({ all: true })
		setQualityGroup(undefined)
		setPage(0)
		navigate(routeState, next === undefined ? { workspace: 'tools', tool: 'image-stacking' } : { workspace: 'tools', tool: 'image-stacking', project: next })
	}

	// Shows a step of the project, its first page.
	function showStep(step: StackingSection) {
		if (projectId === undefined) return
		setPage(0)
		navigate(routeState, { workspace: 'tools', tool: 'image-stacking', project: projectId, ...(step !== 'frames' && { stackingStep: step }) })
	}

	// Lists the frames of one filter group, or of every group.
	function showGroup(next: GroupFilter) {
		setGroup(next)
		setPage(0)
	}

	// Shows a frame in the panel, which a narrow screen keeps closed until then.
	function selectFrame(sourceId: string) {
		setSelected(sourceId)
		if (!panelState.docked) panelState.setOpen(true)
	}

	function change<T>(apply: (value: T) => void) {
		return (value: T) => {
			setPage(0)
			apply(value)
		}
	}

	const project = runtime.project?.projectId === projectId ? runtime.project : undefined
	const panel = selected && (section === 'frames' || section === 'quality') && <FramePanel onRemoved={() => setSelected(undefined)} />
	const states = project && stepStates({ project, groups: runtime.groups, cohorts: runtime.cohorts, validation: runtime.validation, products: runtime.products, composites: runtime.composites, running, analyzed: project.analysis !== undefined })

	// Only the import stays in the header, so the title and it fit a phone; Check Files sits by the project.
	const actions = projectId !== undefined && <Button onClick={() => setImporting(true)}>Import Frames</Button>

	return (
		<WorkspaceLayout workspace="tools" title="Image Stacking" actions={actions} panelState={panelState} panel={panel ? { title: 'Frame', content: panel } : undefined}>
			<div className="flex h-full flex-col gap-3 overflow-y-auto bg-base-000 p-3">
				{runtime.errors.refresh && <Notice error>{runtime.errors.refresh}</Notice>}
				{projects.length === 0 && runtime.snapshot && <EmptyState title="No projects" description="A project holds the light frames of one target, saved on this server, grouped by filter." action={<Button onClick={() => setCreating(true)}>New Project</Button>} />}
				{projects.length > 0 && (
					<div className="flex flex-wrap items-end gap-3">
						<div className="flex w-full items-end gap-2 sm:w-64">
							<Select label="Project" className="flex-1" options={projects.map((item) => item.projectId)} value={projectId ?? ''} format={(id) => projects.find((item) => item.projectId === id)?.name ?? 'Unknown project'} onChange={showProject} />
							<Popover disabled={!project} icon="edit" label="Edit Project" open={editing} onOpenChange={setEditing} className="mb-1">
								<EditProject
									onClose={() => setEditing(false)}
									onDeleted={() => {
										setEditing(false)
										showProject(undefined)
									}}
								/>
							</Popover>
						</div>
						<Button variant="secondary" onClick={() => setCreating(true)}>
							New Project
						</Button>
						{projectId !== undefined && (
							<Button variant="secondary" title="Compares every frame of the project with its file on disk" disabled={runtime.pending.refresh === true} onClick={() => void refreshStackingProject(imageStackingRuntime, projectId)}>
								Check Files
							</Button>
						)}
					</div>
				)}
				{linked !== undefined && runtime.snapshot && !projects.some((item) => item.projectId === linked) && <Notice error>This project no longer exists.</Notice>}
				{project && states && <Steps value={section} states={states} onChange={showStep} />}
				{project && section === 'frames' && (
					<>
						<ProjectSummary />
						<GroupsView group={group} onGroup={showGroup} />
						<SectionHeading as="h2" className="mt-2">
							Frames
						</SectionHeading>
						<div className="flex flex-wrap items-end gap-3">
							<Select label="Role" className="w-36 flex-none" options={ROLE_OPTIONS} value={role} format={(option) => (option === 'all' ? 'All Roles' : ROLE_LABELS[option])} onChange={change(setRole)} />
							<Select label="File" className="w-36 flex-none" options={STATUS_OPTIONS} value={status} format={(option) => (option === 'all' ? 'All States' : SOURCE_STATUS_LABELS[option])} onChange={change(setStatus)} />
							<Select label="Inclusion" className="w-36 flex-none" options={INCLUSION_OPTIONS} value={inclusion} format={(option) => INCLUSION_LABELS[option]} onChange={change(setInclusion)} />
							<TextInput label="Search" className="w-48 max-w-full flex-none" value={search} onChange={(event) => change(setSearch)(event.target.value)} />
						</div>
						<FramesView selected={selected} onSelect={selectFrame} onImport={() => setImporting(true)} />
						<Pager page={page} total={runtime.frames?.total ?? 0} pageSize={STACKING_PAGE_SIZE} noun="frames" loading={runtime.loading} onPage={setPage} />
					</>
				)}
				{project && section === 'calibration' && <CalibrationView projectId={project.projectId} />}
				{project && section === 'quality' && (
					<>
						<QualityView projectId={project.projectId} group={qualityKey} onGroup={change(setQualityGroup)} selected={selected} onSelect={selectFrame} onCalibration={() => showStep('calibration')} />
						<Pager page={page} total={runtime.frames?.total ?? 0} pageSize={STACKING_PAGE_SIZE} noun="frames" loading={runtime.loading} onPage={setPage} />
					</>
				)}
				{project && section === 'integration' && <IntegrationView projectId={project.projectId} />}
				{project && section === 'composition' && <CompositionView projectId={project.projectId} />}
			</div>
			{creating && (
				<NewProject
					onClose={() => setCreating(false)}
					onCreated={(id) => {
						setCreating(false)
						showProject(id)
					}}
				/>
			)}
			{importing && projectId !== undefined && <ImportDialog projectId={projectId} onClose={() => setImporting(false)} />}
		</WorkspaceLayout>
	)
}

// Name of a new project, created on the server; Enter creates it.
function NewProject({ onClose, onCreated }: { readonly onClose: () => void; readonly onCreated: (projectId: string) => void }) {
	const { pending, errors } = useSnapshot(imageStackingRuntime)
	const [name, setName] = useState('')
	const ready = name.trim() !== '' && pending.project !== true

	async function create(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!ready) return
		const project = await createStackingProject(imageStackingRuntime, name)
		if (project) onCreated(project.projectId)
	}

	return (
		<Modal open title="New Project" className="w-full max-w-md" onClose={onClose}>
			<form className="flex flex-col gap-3" onSubmit={(event) => void create(event)}>
				<TextInput label="Name" value={name} onChange={(event) => setName(event.target.value)} />
				{errors.project && <Notice error>{errors.project}</Notice>}
				<Actions>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" disabled={!ready} title={name.trim() === '' ? 'Name the project first' : undefined}>
						Create
					</Button>
				</Actions>
			</form>
		</Modal>
	)
}

// Name and deletion of the project shown, in the edit popover. The name starts from the project when the popover
// opens and is renamed from the revision shown, with Rename or Enter; a rename closes the popover, a failure keeps it
// open with its error. Deletion sits apart from the rename, behind its confirmation.
function EditProject({ onClose, onDeleted }: { readonly onClose: () => void; readonly onDeleted: () => void }) {
	const { project, pending, errors } = useSnapshot(imageStackingRuntime)
	const [name, setName] = useState(project?.name ?? '')
	if (!project) return null
	const unchanged = name.trim() === '' || name.trim() === project.name

	async function rename(event: SubmitEvent<HTMLFormElement>, projectId: string, revision: number) {
		event.preventDefault()
		if (unchanged || pending.project === true) return
		if (await renameStackingProject(imageStackingRuntime, projectId, name, revision)) onClose()
	}

	async function remove(projectId: string) {
		if (await deleteStackingProject(imageStackingRuntime, projectId)) onDeleted()
	}

	return (
		<>
			<form className="flex flex-col gap-2" onSubmit={(event) => void rename(event, project.projectId, project.revision)}>
				<TextInput label="Name" className="w-64 max-w-full" value={name} onChange={(event) => setName(event.target.value)} />
				{errors.project && <Notice error>{errors.project}</Notice>}
				<div className="flex justify-end">
					<Button type="submit" disabled={unchanged || pending.project === true} title={unchanged ? 'Type another name first' : undefined}>
						Rename
					</Button>
				</div>
			</form>
			<div className="flex justify-end border-t border-line-100 pt-3">
				<ConfirmButton title="Delete this project?" message="The project and what was declared about its frames are deleted. The frame files stay where they are." confirmLabel="Delete" disabled={pending.project === true} onConfirm={() => void remove(project.projectId)}>
					Delete Project
				</ConfirmButton>
			</div>
		</>
	)
}

// What the project holds, and what its frames leave to check.
function ProjectSummary() {
	const { project } = useSnapshot(imageStackingRuntime)
	if (!project) return null
	const review = [project.unclassified > 0 && `${project.unclassified} unclassified`, project.excluded > 0 && `${project.excluded} left out`, project.unavailable > 0 && `${project.unavailable} unavailable`].filter((item) => item !== false)

	return (
		<div className="flex flex-col gap-2">
			<p className="m-0 text-xs text-ink-300 tabular-nums">{[`${project.lights} ${project.lights === 1 ? 'light' : 'lights'} in ${project.filters} ${project.filters === 1 ? 'filter' : 'filters'}`, `${formatDuration(project.exposure)} usable`, ...review].join(' · ')}</p>
			{project.objects.length > 1 && <Notice warning className="max-w-prose">{`The headers name ${project.objects.length} targets (${project.objects.join(', ')}). A project is one field: check that these frames belong together.`}</Notice>}
		</div>
	)
}

// Filter groups of the project, the first row standing for all of them; the row chosen filters the frames listed.
function GroupsView({ group, onGroup }: { readonly group: GroupFilter; readonly onGroup: (group: GroupFilter) => void }) {
	const { groups, project } = useSnapshot(imageStackingRuntime)
	if (!groups || !project || groups.length === 0) return null
	const items = groups as readonly StackingFilterGroup[]
	const targets = items.some((item) => item.objects.length > 0)
	const usable = items.reduce((sum, item) => sum + item.usable, 0)
	const frames = items.reduce((sum, item) => sum + item.frames, 0)

	return (
		<>
			<Table className="shrink-0" columns={['Filter', 'Lights', 'Exposure', 'Settings', ...(targets ? ['Targets'] : [])]}>
				<Row selected={group.all} title="Lists the frames of every filter" onSelect={() => onGroup({ all: true })}>
					<Cell>All Filters</Cell>
					<Cell>{`${usable}/${frames}`}</Cell>
					<Cell className="whitespace-nowrap">{formatDuration(project.exposure)}</Cell>
					<Cell>{MISSING}</Cell>
					{targets && <Cell>{project.objects.join(', ') || MISSING}</Cell>}
				</Row>
				{items.map((item) => (
					<Row key={item.key} selected={!group.all && group.key === item.key} title={`Lists the frames of ${item.key}`} onSelect={() => onGroup({ all: false, key: item.key })}>
						<Cell>{item.key}</Cell>
						<Cell>{item.unavailable > 0 ? `${item.usable}/${item.frames} · ${item.unavailable} unavailable` : `${item.usable}/${item.frames}`}</Cell>
						<Cell className="whitespace-nowrap">{formatDuration(item.exposure)}</Cell>
						<Cell className={item.cohorts > 1 ? 'text-warning' : undefined}>{item.cohorts === 1 ? 'One setup' : `${item.cohorts} setups`}</Cell>
						{targets && <Cell>{item.objects.join(', ') || MISSING}</Cell>}
					</Row>
				))}
			</Table>
			<Notice className="max-w-prose">Lights are grouped by the exact filter name their headers write: names spelled differently are different filters, and lights whose header names none are None.</Notice>
		</>
	)
}

// Page of frames, each left out of stacks or included again from its row; a frame is removed from its panel.
function FramesView({ selected, onSelect, onImport }: { readonly selected?: string; readonly onSelect: (sourceId: string) => void; readonly onImport: () => void }) {
	const timeZone = useActiveTimeZone()
	const { frames, project, pending, errors } = useSnapshot(imageStackingRuntime)
	if (!frames || !project) return null
	const items = frames.items as readonly StackingFrameSummary[]

	if (items.length === 0) {
		if (project.frames === 0) return <EmptyState title="No frames" description="Import the directories of the light frames of this target." action={<Button onClick={onImport}>Import Frames</Button>} />
		return <EmptyState title="No frames" description="Nothing matches these filters." />
	}

	const targets = items.some((frame) => frame.object !== undefined)

	return (
		<>
			{items.map(
				(frame) =>
					errors[`frame:${frame.sourceId}`] && (
						<Notice key={frame.sourceId} error>
							{`${frame.name}: ${errors[`frame:${frame.sourceId}`]}`}
						</Notice>
					),
			)}
			<Table className="shrink-0" columns={['Stacked', 'File', 'Role', 'Filter', 'Exposure', ...(targets ? ['Target'] : []), 'Observed', 'File State']}>
				{items.map((frame) => (
					<Row key={frame.sourceId} selected={frame.sourceId === selected} onSelect={() => onSelect(frame.sourceId)}>
						<Cell>
							<div onClick={(event) => event.stopPropagation()}>
								<Checkbox
									hideLabel
									label={frame.excluded ? `Include ${frame.name} again` : `Leave ${frame.name} out`}
									title={frame.excluded ? 'Left out of every stack; check to include it again' : 'Included in stacks; uncheck to leave it out. Its file stays in the project.'}
									checked={!frame.excluded}
									disabled={pending[`frame:${frame.sourceId}`] === true}
									onChange={(included) => void updateStackingFrame(imageStackingRuntime, frame.sourceId, { excluded: !included })}
								/>
							</div>
						</Cell>
						<Cell className={frame.excluded ? 'text-ink-300' : undefined}>{frame.name}</Cell>
						<Cell>{ROLE_LABELS[frame.role]}</Cell>
						<Cell>{frame.metadata.filter.value ?? 'None'}</Cell>
						<Cell className="whitespace-nowrap">{exposureText(frame.metadata)}</Cell>
						{targets && <Cell>{frame.object ?? MISSING}</Cell>}
						<Cell className="whitespace-nowrap">{frame.observedAt === undefined ? MISSING : formatZonedDateTime(frame.observedAt, timeZone, false)}</Cell>
						<Cell>
							<StatusBadge tone={SOURCE_STATUS_TONES[frame.status]} label={SOURCE_STATUS_LABELS[frame.status]} />
						</Cell>
					</Row>
				))}
			</Table>
		</>
	)
}

// Value and how it is known.
function EvidencedReadout({ label, value, format = String }: { readonly label: string; readonly value: Evidenced<string | number>; readonly format?: (value: string | number) => string }) {
	return <DataRow label={label}>{value.value === undefined ? 'Unknown' : `${format(value.value)} · ${EVIDENCE_LABELS[value.evidence]}`}</DataRow>
}

// Opens a file of the server in Images.
function openInImages(path: string) {
	void openImage(imagesState, path)
	navigate(routeState, { workspace: 'images' })
}

// Frame, how each value is known, what an operator may declare about it, and its removal from the project.
function FramePanel({ onRemoved }: { readonly onRemoved: () => void }) {
	const timeZone = useActiveTimeZone()
	const { frame, pending } = useSnapshot(imageStackingRuntime)
	const { cameras } = useSnapshot(catalogState)
	if (!frame) return <LoadingSection id="stacking.frame" title="File" />
	const { metadata } = frame

	async function remove(sourceId: string) {
		if (await removeStackingFrame(imageStackingRuntime, sourceId)) onRemoved()
	}

	return (
		<>
			<CollapsibleSection id="stacking.frame" title="File">
				<StatusBadge tone={SOURCE_STATUS_TONES[frame.status]} label={SOURCE_STATUS_LABELS[frame.status]} />
				<DataRow label="Path">
					<span className="break-all">{frame.path}</span>
				</DataRow>
				<Actions>
					<Button disabled={frame.status === 'missing'} title={frame.status === 'missing' ? 'Its file is missing' : undefined} onClick={() => openInImages(frame.path)}>
						Open in Images
					</Button>
					<ConfirmButton title="Remove this frame?" message="The frame leaves this project. Its file stays where it is and can be imported again." confirmLabel="Remove" disabled={pending[`frame:${frame.sourceId}`] === true} onConfirm={() => void remove(frame.sourceId)}>
						Remove
					</ConfirmButton>
				</Actions>
				<DataRow label="Role">{ROLE_LABELS[frame.role]}</DataRow>
				<DataRow label="Size">{formatByteSize(frame.bytes)}</DataRow>
				<DataRow label="Image">{`${metadata.width}×${metadata.height}×${metadata.channels}, BITPIX ${metadata.bitpix}${metadata.cfa ? `, ${metadata.cfa}` : ''}`}</DataRow>
				<EvidencedReadout label="Filter" value={metadata.filter} />
				<DataRow label="Target">{frame.object ?? 'Unknown'}</DataRow>
				<DataRow label="Camera">{frame.cameraId === undefined ? `${metadata.cameraName ?? 'Unknown'} (not recorded by a capture)` : catalogCameraName(cameras, frame.cameraId)}</DataRow>
				<EvidencedReadout label="Exposure" value={metadata.exposure} format={(value) => formatExposureTime(Number(value) / 1000000)} />
				<DataRow label="Settings">{settingsText(metadata)}</DataRow>
				<EvidencedReadout label="Sensor" value={metadata.sensorTemperature} format={(value) => formatTemperature(Number(value))} />
				{frame.warnings.map((warning) => (
					<Notice key={warning}>{warning}</Notice>
				))}
				{(frame.role === 'unclassified' || metadata.filter.evidence === 'unknown') && <DeclareForm key={frame.sourceId} frame={frame} />}
			</CollapsibleSection>
			{frame.analysis && (
				<CollapsibleSection id="stacking.analysis" title="Analysis">
					{frame.analysis.error !== undefined && <Notice error>{frame.analysis.error}</Notice>}
					{frame.analysis.quality && (
						<>
							<DataRow label="Stars">{String(frame.analysis.quality.starCount)}</DataRow>
							<DataRow label="SNR">{metricText(frame.analysis.quality.medianSNR, 1)}</DataRow>
							<DataRow label="HFD">{metricText(frame.analysis.quality.medianHFD, 2, 'px')}</DataRow>
							<DataRow label="Background">{metricText(frame.analysis.quality.estimatedBackground, 4)}</DataRow>
							<DataRow label="Score">{metricText(frame.analysis.quality.normalizedScore)}</DataRow>
						</>
					)}
					<DataRow label="Registration">{registrationText(frame.analysis.registration)}</DataRow>
					<DataRow label="Measured">{formatZonedDateTime(frame.analysis.analyzedAt, timeZone, false)}</DataRow>
				</CollapsibleSection>
			)}
		</>
	)
}

// Declares what the header of a frame does not say: that an unclassified frame is a light, or the filter of a frame
// whose header names none.
function DeclareForm({ frame }: { readonly frame: StackingSourceDetail }) {
	const { pending, errors } = useSnapshot(imageStackingRuntime)
	const [filter, setFilter] = useState('')
	const key = `frame:${frame.sourceId}`
	const busy = pending[key] === true
	const unknownFilter = frame.metadata.filter.evidence === 'unknown'

	return (
		<>
			{unknownFilter && <TextInput label="Filter" value={filter} onChange={(event) => setFilter(event.target.value)} />}
			{errors[key] && <Notice error>{errors[key]}</Notice>}
			<Actions>
				{frame.role === 'unclassified' && (
					<Button variant="secondary" disabled={busy} onClick={() => void updateStackingFrame(imageStackingRuntime, frame.sourceId, { light: true })}>
						Declare Light
					</Button>
				)}
				{unknownFilter && (
					<Button variant="secondary" disabled={!filter.trim() || busy} title={filter.trim() ? undefined : 'Type the filter name first'} onClick={() => void updateStackingFrame(imageStackingRuntime, frame.sourceId, { filter })}>
						Declare Filter
					</Button>
				)}
			</Actions>
		</>
	)
}

// Chooses where to look, reads the headers there, and reviews what was found: every usable candidate is checked, and
// only the checked ones enter the project when the review is committed, which closes the dialog.
function ImportDialog({ projectId, onClose }: { readonly projectId: string; readonly onClose: () => void }) {
	const { jobs, pending, errors } = useSnapshot(imageStackingRuntime)
	const profiles = useSnapshot(profileState)
	const [paths, setPaths] = useState<readonly string[]>([])
	const [recursive, setRecursive] = useState(true)
	const [choosing, setChoosing] = useState<'directory' | 'open'>()
	const [jobId, setJobId] = useState<string>()
	const [page, setPage] = useState<Page<StackingImportCandidate>>()
	const [pageIndex, setPageIndex] = useState(0)
	const [loading, setLoading] = useState(false)
	const [declared, setDeclared] = useState<ReadonlySet<string>>(new Set())
	const [selection, setSelection] = useState<ImportSelection>(ALL_CANDIDATES)
	const job = jobId === undefined ? undefined : jobs[jobId]
	const ended = job !== undefined && jobEnded(job)

	// Fetches the page of what was found shown, once the scan ended; a late page of another index is dropped.
	useEffect(() => {
		if (jobId === undefined || job?.state !== 'completed') return
		let current = true
		setLoading(true)

		void loadStackingCandidates(jobId, pageIndex).then((found) => {
			if (!current) return
			setLoading(false)
			if (found) setPage(found)
		})

		return () => {
			current = false
		}
	}, [job?.state, jobId, pageIndex])

	// Adds chosen directories or files to where the import looks, each once, and remembers the directory listed.
	function add(chosen: readonly string[], directory: string) {
		setChoosing(undefined)
		setPaths([...paths, ...chosen.filter((path) => !paths.includes(path))])
		setLastStackingDirectory(profileState, directory)
	}

	async function start() {
		const started = await startStackingImport(imageStackingRuntime, projectId, paths, recursive)
		if (started) setJobId(started.jobId)
	}

	async function commit() {
		if (jobId === undefined) return
		const except = [...selection.except.keys()]
		const answer = await commitStackingImport(imageStackingRuntime, jobId, selection.all ? { skipped: except, lights: declaredChecked } : { paths: except, lights: declaredChecked })
		if (answer) onClose()
	}

	function toggle(path: string, light: boolean) {
		const next = new Set(declared)
		if (light) next.add(path)
		else next.delete(path)
		setDeclared(next)
	}

	const items = page?.items ?? []
	// Declared lights that are checked, the only ones a commit adds.
	const declaredChecked = [...declared].filter((path) => candidateChecked(selection, path))
	const counts = committedCounts(job ?? {}, selection, declaredChecked.length)
	const totalCount = counts.lights + counts.unclassified

	return (
		<Modal open title="Import Frames" fit className="w-full max-w-4xl" onClose={onClose}>
			<div className="flex min-h-0 flex-col gap-3">
				{jobId === undefined && (
					<>
						<Notice className="max-w-prose">Choose directories or files of this server. Frames are referenced where they are and never changed; their roles and filters come from their headers, never from their names.</Notice>
						{paths.length > 0 && (
							<div className="flex min-h-0 flex-col gap-0 overflow-y-auto">
								{paths.map((path) => (
									<div key={path} className="flex items-center gap-2 rounded px-2 py-1 text-xs text-ink-200 hover:bg-base-300">
										<span className="min-w-0 flex-1 break-all">{path}</span>
										<Button size="sm" variant="secondary" onClick={() => setPaths(paths.filter((other) => other !== path))}>
											Remove
										</Button>
									</div>
								))}
							</div>
						)}
						<Actions>
							<Button variant="secondary" onClick={() => setChoosing('directory')}>
								Add Directory
							</Button>
							<Button variant="secondary" onClick={() => setChoosing('open')}>
								Add Files
							</Button>
						</Actions>
						<Checkbox label="Include subdirectories" checked={recursive} onChange={setRecursive} />
						{errors.import && <Notice error>{errors.import}</Notice>}
						<div className="flex flex-wrap justify-end gap-2">
							<Button variant="secondary" onClick={onClose}>
								Cancel
							</Button>
							<Button disabled={paths.length === 0 || pending.import === true} title={paths.length === 0 ? 'Add a directory or files first' : undefined} onClick={() => void start()}>
								Read Headers
							</Button>
						</div>
					</>
				)}
				{jobId !== undefined && !ended && (
					<div className="flex flex-wrap items-center gap-3">
						<Notice>{`Reading headers · ${job?.found ?? 0} files · ${formatByteSize(job?.bytes ?? 0)}`}</Notice>
						<Button variant="secondary" onClick={() => void cancelStackingImport(imageStackingRuntime, jobId)}>
							Cancel Reading
						</Button>
					</div>
				)}
				{job?.error && <Notice error>{job.error}</Notice>}
				{job?.state === 'cancelled' && <Notice>The import was cancelled.</Notice>}
				{job?.truncated && <Notice error>The limit of files was reached; only part of these directories was read.</Notice>}
				{page && (
					<>
						<Notice>{`${page.total} files found: ${counts.lights} lights and ${counts.unclassified} unclassified files will be added. Checked files and declared lights are kept across pages.`}</Notice>
						<Actions>
							<Button disabled={totalCount === 0} variant="secondary" onClick={() => setSelection(ALL_CANDIDATES)}>
								Select All
							</Button>
							<Button disabled={totalCount === 0} variant="secondary" onClick={() => setSelection(NO_CANDIDATES)}>
								Deselect All
							</Button>
						</Actions>
						<Table columns={['File', 'Found', 'Filter', 'Exposure', 'Target', 'Declare Light']}>
							{items.map((candidate) => (
								<Row key={candidate.path}>
									<Cell>{candidateUsable(candidate) && candidate.role ? <Checkbox label={candidate.name} checked={candidateChecked(selection, candidate.path)} onChange={(checked) => setSelection(withCandidate(selection, candidate.path, candidate.role!, checked))} /> : candidate.name}</Cell>
									<Cell className={candidateUsable(candidate) ? undefined : 'text-ink-300'}>{candidateText(candidate)}</Cell>
									<Cell>{candidate.filter ?? MISSING}</Cell>
									<Cell className="whitespace-nowrap">{candidate.metadata ? exposureText(candidate.metadata) : MISSING}</Cell>
									<Cell>{candidate.object ?? MISSING}</Cell>
									<Cell>{candidate.role === 'unclassified' && candidateUsable(candidate) && <Checkbox label="Light" checked={declared.has(candidate.path)} onChange={(light) => toggle(candidate.path, light)} />}</Cell>
								</Row>
							))}
						</Table>
						<Pager page={pageIndex} total={page.total} pageSize={STACKING_PAGE_SIZE} noun="files" loading={loading} onPage={setPageIndex} />
						{errors.import && <Notice error>{errors.import}</Notice>}
						<div className="flex flex-wrap justify-end gap-2">
							<Button variant="secondary" onClick={onClose}>
								Cancel
							</Button>
							<Button disabled={totalCount === 0 || pending.import === true} title={totalCount === 0 ? 'Check at least one file' : undefined} onClick={() => void commit()}>
								{`Add ${totalCount} ${totalCount === 1 ? 'Frame' : 'Frames'}`}
							</Button>
						</div>
					</>
				)}
				{ended && job?.state !== 'completed' && (
					<div className="flex justify-end">
						<Button variant="secondary" onClick={onClose}>
							Close
						</Button>
					</div>
				)}
			</div>
			<FileExplorerModal open={choosing === 'directory'} title="Add Directory" mode="directory" initialPath={activeProfile(profiles).settings.lastStackingDirectory} onChoose={(path, directory) => add([path], directory)} onClose={() => setChoosing(undefined)} />
			<FileExplorerModal open={choosing === 'open'} title="Add Files" mode="open" multiple initialPath={activeProfile(profiles).settings.lastStackingDirectory} extensions={IMAGE_EXTENSIONS} onChoose={add} onClose={() => setChoosing(undefined)} />
		</Modal>
	)
}
