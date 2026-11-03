import type { Evidenced, Page, StackingFilterGroup, StackingFrameSummary, StackingImportCandidate, StackingSourceDetail } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { Actions, ConfirmButton, Notice } from '../../equipment-control/parts'
import { FileExplorerModal } from '../../files/FileExplorerModal'
import { IMAGE_EXTENSIONS } from '../../files/files'
import { imagesState, openImage } from '../../images/images'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { navigate, routeState } from '../../shell/route'
import { EmptyState, useWorkspacePanel, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { DataRow } from '../../ui/DataRow'
import { Modal } from '../../ui/Modal'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { TextInput } from '../../ui/TextInput'
import { bytesText, EVIDENCE_LABELS, exposureText, settingsText, SOURCE_STATUS_LABELS, SOURCE_STATUS_TONES } from '../calibrationlibrary/library'
import { candidateText, candidateUsable, committedCounts, groupLabel, integrationText, metricText, registrationText, ROLE_LABELS, SECTION_LABELS, STACKING_SECTIONS, type StackingSection } from './format'
import { CalibrationView, QualityView } from './Planning'
// oxfmt-ignore
import { cancelStackingImport, commitStackingImport, createStackingProject, deleteStackingProject, imageStackingRuntime, jobEnded, loadStackingCandidates, loadStackingFrame, loadStackingFrames, loadStackingProject, mergeStackingFilter, refreshStackingProject, removeStackingFrame, renameStackingProject, separateStackingFilter, STACKING_PAGE_SIZE, type StackingFrameFilter, startStackingImport, updateStackingFrame } from './projects'
import { Cell, Row, Table } from './Table'

// Image Stacking tool: projects of light frames saved on the server, grouped by the filter they were taken through. It
// works with no camera and starts no exposure. Frames enter a project through an import that is reviewed before it is
// committed; what an operator declares about a frame (its role, its filter, its exclusion) always carries a reason, and
// filters spelled differently stay apart until merged here. Calibration pins the masters of each cohort, and Quality
// measures and registers every frame before a stack. State lives on the server, so a reload or another tab shows
// the same projects; the project shown is part of the URL.

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
	const [section, setSection] = useState<StackingSection>('filters')
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
	const panelState = useWorkspacePanel('tools')
	const groups = (runtime.groups ?? []) as readonly StackingFilterGroup[]
	const qualityKey = groups.some((item) => item.key === qualityGroup) ? qualityGroup : groups.find((item) => item.key !== '')?.key
	const listed: StackingFrameFilter = { group: group.all ? undefined : group.key, role: role === 'all' ? undefined : role, status: status === 'all' ? undefined : status, included: inclusion === 'all' ? undefined : inclusion === 'included', search: search || undefined }
	const filter: StackingFrameFilter = section === 'quality' ? { group: qualityKey, role: 'light', included: true } : listed

	// Fetches the project and its groups, again whenever the server reports a change.
	useEffect(() => {
		void loadStackingProject(imageStackingRuntime, projectId)
	}, [projectId, runtime.changes])

	// Fetches the page of frames shown, again whenever the server reports a change.
	useEffect(() => {
		if (projectId !== undefined && (section === 'frames' || (section === 'quality' && qualityKey !== undefined))) void loadStackingFrames(imageStackingRuntime, projectId, filter, page)
	}, [projectId, section, group, role, status, inclusion, search, qualityKey, page, runtime.changes])

	// Fetches the frame of the panel, again whenever the server reports a change.
	useEffect(() => {
		void loadStackingFrame(imageStackingRuntime, selected)
	}, [selected, runtime.changes])

	// Shows a project, forgetting the frame and filters of the previous one.
	function showProject(next: string | undefined) {
		setSelected(undefined)
		setGroup({ all: true })
		setQualityGroup(undefined)
		setPage(0)
		navigate(routeState, next === undefined ? { workspace: 'tools', tool: 'image-stacking' } : { workspace: 'tools', tool: 'image-stacking', project: next })
	}

	// Lists the frames of one filter group.
	function showGroup(key: string) {
		setGroup({ all: false, key })
		setSection('frames')
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
	const groupKeys = ['*', ...groups.map((item) => item.key)]
	const panel = selected && <FramePanel onRemoved={() => setSelected(undefined)} />

	const actions = projectId !== undefined && (
		<Actions>
			<Button variant="secondary" disabled={runtime.pending.refresh === true} onClick={() => void refreshStackingProject(imageStackingRuntime, projectId)}>
				Check Files
			</Button>
			<Button onClick={() => setImporting(true)}>Import Frames</Button>
		</Actions>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Image Stacking" actions={actions} panelState={panelState} panel={panel ? { title: 'Frame', content: panel } : undefined}>
			<div className="flex h-full flex-col gap-3 overflow-y-auto bg-base-000 p-3">
				{runtime.errors.refresh && <Notice error>{runtime.errors.refresh}</Notice>}
				{projects.length === 0 && runtime.snapshot && <EmptyState title="No projects" description="A project holds the light frames of one target, saved on this server, grouped by filter." action={<Button onClick={() => setCreating(true)}>New Project</Button>} />}
				{projects.length > 0 && (
					<div className="flex flex-wrap items-end gap-3">
						<Select label="Project" className="w-64" options={projects.map((item) => item.projectId)} value={projectId ?? ''} format={(id) => projects.find((item) => item.projectId === id)?.name ?? 'Unknown project'} onChange={showProject} />
						<Button variant="secondary" onClick={() => setCreating(true)}>
							New Project
						</Button>
						<SegmentedControl options={STACKING_SECTIONS} value={section} format={(option) => SECTION_LABELS[option]} onChange={change(setSection)} />
					</div>
				)}
				{linked !== undefined && runtime.snapshot && !projects.some((item) => item.projectId === linked) && <Notice error>This project no longer exists.</Notice>}
				{project && <ProjectHeader key={`${project.projectId}:${project.revision}`} onDeleted={() => showProject(undefined)} />}
				{project && section === 'filters' && <GroupsView projectId={project.projectId} onShow={showGroup} />}
				{project && section === 'frames' && (
					<>
						<div className="flex flex-wrap items-end gap-3">
							<Select
								label="Filter"
								className="w-44"
								options={groupKeys}
								value={group.all ? '*' : group.key}
								format={(key) => (key === '*' ? 'All Filters' : groupLabel(key, groups.find((item) => item.key === key)?.name ?? key))}
								onChange={change((key: string) => setGroup(key === '*' ? { all: true } : { all: false, key }))}
							/>
							<Select label="Role" className="w-36" options={ROLE_OPTIONS} value={role} format={(option) => (option === 'all' ? 'All Roles' : ROLE_LABELS[option])} onChange={change(setRole)} />
							<Select label="File" className="w-36" options={STATUS_OPTIONS} value={status} format={(option) => (option === 'all' ? 'All States' : SOURCE_STATUS_LABELS[option])} onChange={change(setStatus)} />
							<Select label="Inclusion" className="w-36" options={INCLUSION_OPTIONS} value={inclusion} format={(option) => INCLUSION_LABELS[option]} onChange={change(setInclusion)} />
							<TextInput label="Search" className="w-48" value={search} onChange={(event) => change(setSearch)(event.target.value)} />
						</div>
						<FramesView selected={selected} onSelect={selectFrame} />
						<Pager page={page} total={runtime.frames?.total ?? 0} loading={runtime.loading} onPage={setPage} />
					</>
				)}
				{project && section === 'calibration' && <CalibrationView projectId={project.projectId} />}
				{project && section === 'quality' && (
					<>
						<QualityView projectId={project.projectId} group={qualityKey} onGroup={change(setQualityGroup)} selected={selected} onSelect={selectFrame} />
						<Pager page={page} total={runtime.frames?.total ?? 0} loading={runtime.loading} onPage={setPage} />
					</>
				)}
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

// Previous and next page of the frames, shown only when there is more than one.
function Pager({ page, total, loading, onPage }: { readonly page: number; readonly total: number; readonly loading: boolean; readonly onPage: (page: number) => void }) {
	const pages = Math.ceil(total / STACKING_PAGE_SIZE)
	if (pages < 2) return null

	return (
		<div className="flex items-center gap-2 text-xs text-ink-300 tabular-nums">
			<Button variant="secondary" disabled={page === 0 || loading} onClick={() => onPage(page - 1)}>
				Previous
			</Button>
			<span>{`Page ${page + 1} of ${pages} · ${total} frames`}</span>
			<Button variant="secondary" disabled={page + 1 >= pages || loading} onClick={() => onPage(page + 1)}>
				Next
			</Button>
		</div>
	)
}

// Name of a new project, created on the server.
function NewProject({ onClose, onCreated }: { readonly onClose: () => void; readonly onCreated: (projectId: string) => void }) {
	const { pending, errors } = useSnapshot(imageStackingRuntime)
	const [name, setName] = useState('')

	async function create() {
		const project = await createStackingProject(imageStackingRuntime, name)
		if (project) onCreated(project.projectId)
	}

	return (
		<Modal open title="New Project" className="w-full max-w-md" onClose={onClose}>
			<div className="flex flex-col gap-3">
				<TextInput label="Name" value={name} onChange={(event) => setName(event.target.value)} />
				{errors.project && <Notice error>{errors.project}</Notice>}
				<Actions>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button disabled={!name.trim() || pending.project === true} onClick={() => void create()}>
						Create
					</Button>
				</Actions>
			</div>
		</Modal>
	)
}

// What the project holds, its name, and its deletion. The name is edited from the revision shown.
function ProjectHeader({ onDeleted }: { readonly onDeleted: () => void }) {
	const { project, pending, errors } = useSnapshot(imageStackingRuntime)
	const [name, setName] = useState(project?.name ?? '')
	if (!project) return null

	async function remove(projectId: string) {
		if (await deleteStackingProject(imageStackingRuntime, projectId)) onDeleted()
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-end gap-3">
				<TextInput label="Name" className="w-64" value={name} onChange={(event) => setName(event.target.value)} />
				<Button variant="secondary" disabled={!name.trim() || name.trim() === project.name || pending.project === true} onClick={() => void renameStackingProject(imageStackingRuntime, project.projectId, name, project.revision)}>
					Rename
				</Button>
				<ConfirmButton title="Delete this project?" message="The project, its filter merges, and what was declared about its frames are deleted. The frame files stay where they are." confirmLabel="Delete" disabled={pending.project === true} onConfirm={() => void remove(project.projectId)}>
					Delete Project
				</ConfirmButton>
			</div>
			{errors.project && <Notice error>{errors.project}</Notice>}
			<p className="m-0 text-xs text-ink-300 tabular-nums">{`${project.lights} lights in ${project.filters} filters · ${integrationText(project.exposure)} usable · ${project.unclassified} unclassified · ${project.excluded} left out · ${project.unavailable} unavailable`}</p>
			{project.objects.length > 1 && <Notice>{`The headers name ${project.objects.length} targets (${project.objects.join(', ')}). A project is one field: check that these frames belong together.`}</Notice>}
			{project.unassigned > 0 && <Notice>{project.unassigned === 1 ? 'One light names no filter. Declare its filter in Frames to stack it.' : `${project.unassigned} lights name no filter. Declare their filter in Frames to stack them.`}</Notice>}
		</div>
	)
}

// Filter groups of the project, with their merges.
function GroupsView({ projectId, onShow }: { readonly projectId: string; readonly onShow: (key: string) => void }) {
	const { groups, project, pending, errors } = useSnapshot(imageStackingRuntime)
	const items = (groups ?? []) as readonly StackingFilterGroup[]
	const aliases = project?.aliases ?? []

	if (items.length === 0) return <EmptyState title="No lights" description="Import the directories of the light frames of this target." />

	return (
		<>
			{Object.entries(errors).flatMap(([key, error]) =>
				key.startsWith('alias:')
					? [
							<Notice key={key} error>
								{error}
							</Notice>,
						]
					: [],
			)}
			<Table headers={['Filter', 'Written As', 'Lights', 'Exposure', 'Settings', 'Targets', 'Merge']}>
				{items.map((item) => (
					<Row key={item.key} onClick={() => onShow(item.key)}>
						<Cell>{groupLabel(item.key, item.name)}</Cell>
						<Cell>{item.names.join(', ') || '—'}</Cell>
						<Cell>{item.unavailable > 0 ? `${item.usable}/${item.frames} · ${item.unavailable} unavailable` : `${item.usable}/${item.frames}`}</Cell>
						<Cell>{integrationText(item.exposure)}</Cell>
						<Cell className={item.cohorts > 1 ? 'text-warning' : undefined}>{item.cohorts === 1 ? 'One setup' : `${item.cohorts} setups`}</Cell>
						<Cell>{item.objects.join(', ') || '—'}</Cell>
						<Cell>
							<div className="flex gap-2" onClick={(event) => event.stopPropagation()}>
								{item.suggestion !== undefined && (
									<Button variant="secondary" disabled={pending[`alias:${item.key}`] === true} onClick={() => void mergeStackingFilter(imageStackingRuntime, projectId, item.key, item.suggestion!)}>
										{`Merge into ${items.find((other) => other.key === item.suggestion)?.name ?? item.suggestion}`}
									</Button>
								)}
								{aliases
									.filter((alias) => alias.targetKey === item.key)
									.map((alias) => (
										<Button key={alias.filterKey} variant="secondary" disabled={pending[`alias:${alias.filterKey}`] === true} onClick={() => void separateStackingFilter(imageStackingRuntime, projectId, alias.filterKey)}>
											{`Separate ${alias.filterKey}`}
										</Button>
									))}
							</div>
						</Cell>
					</Row>
				))}
			</Table>
			<p className="m-0 text-xs text-ink-300">Filters are grouped by the name their files write. A suggested merge joins names that usually mean one filter; nothing is merged until you choose it.</p>
		</>
	)
}

// Page of frames.
function FramesView({ selected, onSelect }: { readonly selected?: string; readonly onSelect: (sourceId: string) => void }) {
	const { frames } = useSnapshot(imageStackingRuntime)
	const items = (frames?.items ?? []) as readonly StackingFrameSummary[]

	if (items.length === 0) return <EmptyState title="No frames" description="Nothing matches these filters." />

	return (
		<Table headers={['File', 'Role', 'Filter', 'Exposure', 'Target', 'Observed', 'State']}>
			{items.map((frame) => (
				<Row key={frame.sourceId} selected={frame.sourceId === selected} onClick={() => onSelect(frame.sourceId)}>
					<Cell>{frame.name}</Cell>
					<Cell>{ROLE_LABELS[frame.role]}</Cell>
					<Cell>{frame.metadata.filter.value ?? '—'}</Cell>
					<Cell>{exposureText(frame.metadata)}</Cell>
					<Cell>{frame.object ?? '—'}</Cell>
					<Cell>{frame.observedAt === undefined ? '—' : new Date(frame.observedAt).toISOString().slice(0, 16).replace('T', ' ')}</Cell>
					<Cell>{frame.excluded === undefined ? <StatusBadge tone={SOURCE_STATUS_TONES[frame.status]} label={SOURCE_STATUS_LABELS[frame.status]} /> : <StatusBadge tone="muted" label="Left Out" />}</Cell>
				</Row>
			))}
		</Table>
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

// Frame, how each value is known, and what an operator may declare about it.
function FramePanel({ onRemoved }: { readonly onRemoved: () => void }) {
	const { frame, pending } = useSnapshot(imageStackingRuntime)
	if (!frame) return <p className="m-0 p-4 text-xs text-ink-300">Loading…</p>
	const { metadata } = frame

	async function remove(sourceId: string) {
		if (await removeStackingFrame(imageStackingRuntime, sourceId)) onRemoved()
	}

	return (
		<>
			<CollapsibleSection id="stacking.frame" title="Frame">
				<StatusBadge tone={SOURCE_STATUS_TONES[frame.status]} label={SOURCE_STATUS_LABELS[frame.status]} />
				<DataRow label="Path">
					<span className="break-all">{frame.path}</span>
				</DataRow>
				<Actions>
					<Button disabled={frame.status === 'missing'} onClick={() => openInImages(frame.path)}>
						Open in Images
					</Button>
					<ConfirmButton title="Remove this frame?" message="The frame leaves this project. Its file stays where it is and can be imported again." confirmLabel="Remove" disabled={pending[`frame:${frame.sourceId}`] === true} onConfirm={() => void remove(frame.sourceId)}>
						Remove
					</ConfirmButton>
				</Actions>
				<DataRow label="Role">{ROLE_LABELS[frame.role]}</DataRow>
				<DataRow label="Size">{bytesText(frame.bytes)}</DataRow>
				<DataRow label="Image">{`${metadata.width}×${metadata.height}×${metadata.channels}, BITPIX ${metadata.bitpix}${metadata.cfa ? `, ${metadata.cfa}` : ''}`}</DataRow>
				<EvidencedReadout label="Filter" value={metadata.filter} />
				<DataRow label="Target">{frame.object ?? 'Unknown'}</DataRow>
				<DataRow label="Camera">{metadata.cameraName ?? 'Unknown'}</DataRow>
				<EvidencedReadout label="Exposure" value={metadata.exposure} format={(value) => `${Number(value) / 1000000} s`} />
				<DataRow label="Settings">{settingsText(metadata)}</DataRow>
				<EvidencedReadout label="Sensor" value={metadata.sensorTemperature} format={(value) => `${value} °C`} />
				{frame.warnings.map((warning) => (
					<Notice key={warning}>{warning}</Notice>
				))}
			</CollapsibleSection>
			{frame.analysis && (
				<CollapsibleSection id="stacking.analysis" title="Analysis">
					{frame.analysis.error !== undefined && <Notice error>{frame.analysis.error}</Notice>}
					{frame.analysis.quality && (
						<>
							<DataRow label="Stars">{String(frame.analysis.quality.starCount)}</DataRow>
							<DataRow label="SNR">{metricText(frame.analysis.quality.medianSNR, 1)}</DataRow>
							<DataRow label="HFD">{`${metricText(frame.analysis.quality.medianHFD)} px`}</DataRow>
							<DataRow label="Background">{metricText(frame.analysis.quality.estimatedBackground, 4)}</DataRow>
							<DataRow label="Score">{metricText(frame.analysis.quality.normalizedScore)}</DataRow>
						</>
					)}
					<DataRow label="Registration">{registrationText(frame.analysis.registration)}</DataRow>
					<DataRow label="Measured">{new Date(frame.analysis.analyzedAt).toISOString().slice(0, 16).replace('T', ' ')}</DataRow>
				</CollapsibleSection>
			)}
			<CollapsibleSection id="stacking.review" title="Review">
				<ReviewForm key={frame.sourceId} frame={frame} />
			</CollapsibleSection>
		</>
	)
}

// Declares what a header does not say, or leaves a frame out, always with a reason.
function ReviewForm({ frame }: { readonly frame: StackingSourceDetail }) {
	const { pending, errors } = useSnapshot(imageStackingRuntime)
	const [filter, setFilter] = useState('')
	const [reason, setReason] = useState('')
	const key = `frame:${frame.sourceId}`
	const busy = pending[key] === true
	const unknownFilter = frame.metadata.filter.evidence === 'unknown'

	return (
		<>
			{unknownFilter && <TextInput label="Filter" value={filter} onChange={(event) => setFilter(event.target.value)} />}
			<TextInput label="Reason" value={reason} onChange={(event) => setReason(event.target.value)} />
			{errors[key] && <Notice error>{errors[key]}</Notice>}
			<Actions>
				{frame.role === 'unclassified' && (
					<Button variant="secondary" disabled={!reason || busy} onClick={() => void updateStackingFrame(imageStackingRuntime, frame.sourceId, { light: { reason } })}>
						Declare Light
					</Button>
				)}
				{unknownFilter && (
					<Button variant="secondary" disabled={!filter.trim() || !reason || busy} onClick={() => void updateStackingFrame(imageStackingRuntime, frame.sourceId, { filter: { value: filter, reason } })}>
						Declare Filter
					</Button>
				)}
				{frame.excluded === undefined ? (
					<Button variant="secondary" disabled={!reason || busy} onClick={() => void updateStackingFrame(imageStackingRuntime, frame.sourceId, { excluded: reason })}>
						Leave Out
					</Button>
				) : (
					<Button variant="secondary" disabled={busy} onClick={() => void updateStackingFrame(imageStackingRuntime, frame.sourceId, { excluded: null })}>
						Include Again
					</Button>
				)}
			</Actions>
			{frame.excluded !== undefined && <Notice>{`Left out: ${frame.excluded}`}</Notice>}
		</>
	)
}

// Chooses where to look, scans, and reviews what was found: nothing enters the project until it is committed.
function ImportDialog({ projectId, onClose }: { readonly projectId: string; readonly onClose: () => void }) {
	const { jobs, pending, errors } = useSnapshot(imageStackingRuntime)
	const [paths, setPaths] = useState<readonly string[]>([])
	const [recursive, setRecursive] = useState(true)
	const [choosing, setChoosing] = useState<'directory' | 'open'>()
	const [jobId, setJobId] = useState<string>()
	const [page, setPage] = useState<Page<StackingImportCandidate>>()
	const [declared, setDeclared] = useState<ReadonlySet<string>>(new Set())
	const [reason, setReason] = useState('')
	const [committed, setCommitted] = useState<number>()
	const job = jobId === undefined ? undefined : jobs[jobId]
	const ended = job !== undefined && jobEnded(job)

	// Fetches what was found once the scan ended.
	useEffect(() => {
		if (jobId !== undefined && job?.state === 'completed' && !page) void loadStackingCandidates(jobId, 0).then(setPage)
	}, [job?.state, jobId, page])

	function add(path: string) {
		setChoosing(undefined)
		if (!paths.includes(path)) setPaths([...paths, path])
	}

	async function start() {
		const started = await startStackingImport(imageStackingRuntime, projectId, paths, recursive)
		if (started) setJobId(started.jobId)
	}

	async function commit() {
		if (jobId === undefined) return
		const lights = Object.fromEntries([...declared].map((path) => [path, { reason }]))
		const answer = await commitStackingImport(imageStackingRuntime, jobId, { lights })
		if (answer) setCommitted(answer.committed)
	}

	function toggle(path: string, light: boolean) {
		const next = new Set(declared)
		if (light) next.add(path)
		else next.delete(path)
		setDeclared(next)
	}

	const items = page?.items ?? []
	const counts = committedCounts(items, declared)

	return (
		<Modal open title="Import Light Frames" fit className="w-full max-w-4xl" onClose={onClose}>
			<div className="flex min-h-0 flex-col gap-3">
				{jobId === undefined && (
					<>
						<Notice>Choose directories or files of this server. Frames are referenced where they are and never changed; their roles and filters come from their headers, never from their names.</Notice>
						{paths.map((path) => (
							<div key={path} className="flex items-center gap-2 text-xs text-ink-200">
								<span className="min-w-0 flex-1 break-all">{path}</span>
								<Button variant="secondary" onClick={() => setPaths(paths.filter((other) => other !== path))}>
									Remove
								</Button>
							</div>
						))}
						<Actions>
							<Button variant="secondary" onClick={() => setChoosing('directory')}>
								Add Directory
							</Button>
							<Button variant="secondary" onClick={() => setChoosing('open')}>
								Add File
							</Button>
						</Actions>
						<Checkbox label="Include subdirectories" checked={recursive} onChange={setRecursive} />
						{errors.import && <Notice error>{errors.import}</Notice>}
						<Actions>
							<Button disabled={paths.length === 0 || pending.import === true} onClick={() => void start()}>
								Read Headers
							</Button>
						</Actions>
					</>
				)}
				{jobId !== undefined && !ended && (
					<div className="flex items-center gap-3">
						<Notice>{`Reading headers · ${job?.found ?? 0} files · ${bytesText(job?.bytes ?? 0)}`}</Notice>
						<Button variant="secondary" onClick={() => void cancelStackingImport(imageStackingRuntime, jobId)}>
							Cancel
						</Button>
					</div>
				)}
				{job?.error && <Notice error>{job.error}</Notice>}
				{job?.state === 'cancelled' && <Notice>The import was cancelled.</Notice>}
				{job?.truncated && <Notice error>The limit of files was reached; only part of these directories was read.</Notice>}
				{committed !== undefined && <Notice>{`${committed} frames entered the project.`}</Notice>}
				{page && committed === undefined && (
					<>
						<Notice>{`${page.total} files found: ${counts.lights} lights and ${counts.unclassified} unclassified files will be added.${page.total > items.length ? ` Only the first ${items.length} are listed.` : ''}`}</Notice>
						<Table headers={['File', 'Found', 'Filter', 'Exposure', 'Target', 'Declare Light']}>
							{items.map((candidate) => (
								<Row key={candidate.path}>
									<Cell>{candidate.name}</Cell>
									<Cell className={candidateUsable(candidate) ? undefined : 'text-ink-300'}>{candidateText(candidate)}</Cell>
									<Cell>{candidate.filter ?? '—'}</Cell>
									<Cell>{candidate.metadata ? exposureText(candidate.metadata) : '—'}</Cell>
									<Cell>{candidate.object ?? '—'}</Cell>
									<Cell>{candidate.role === 'unclassified' && candidateUsable(candidate) && <Checkbox label="Light" checked={declared.has(candidate.path)} onChange={(light) => toggle(candidate.path, light)} />}</Cell>
								</Row>
							))}
						</Table>
						{declared.size > 0 && <TextInput label="Why these are lights" value={reason} onChange={(event) => setReason(event.target.value)} />}
						{errors.import && <Notice error>{errors.import}</Notice>}
						<Actions>
							<Button disabled={counts.lights + counts.unclassified === 0 || (declared.size > 0 && !reason) || pending.import === true} onClick={() => void commit()}>
								{`Add ${counts.lights + counts.unclassified} Frames`}
							</Button>
						</Actions>
					</>
				)}
				{(committed !== undefined || (ended && job?.state !== 'completed')) && (
					<Actions>
						<Button variant="secondary" onClick={onClose}>
							Close
						</Button>
					</Actions>
				)}
			</div>
			<FileExplorerModal open={choosing === 'directory'} title="Add Directory" mode="directory" onChoose={add} onClose={() => setChoosing(undefined)} />
			<FileExplorerModal open={choosing === 'open'} title="Add File" mode="open" extensions={IMAGE_EXTENSIONS} onChoose={add} onClose={() => setChoosing(undefined)} />
		</Modal>
	)
}
