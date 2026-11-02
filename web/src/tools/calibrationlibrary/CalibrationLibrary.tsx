import type { CalibrationGroupSummary, CalibrationJobSummary, CalibrationKind, CalibrationMasterDetail, CalibrationMasterSummary, CalibrationSource, CalibrationSourceSummary, CompatibilityFinding, Evidenced, ImportCandidate, MasterRequest, OverridableField, Page, RecipeValidation } from 'api'
import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
// oxfmt-ignore
import { buildMaster, CALIBRATION_PAGE_SIZE, calibrationLibraryRuntime, cancelCalibrationJob, commitCalibrationImport, excludeCalibrationSource, jobEnded, loadCalibrationGroup, loadCalibrationGroups, loadCalibrationJobs, loadCalibrationMaster, loadCalibrationMasters, loadCalibrationSource, loadCalibrationSources, loadImportCandidates, overrideCalibrationSource, preferMaster, refreshCalibrationFiles, retryCalibrationJob, startCalibrationImport, validateRecipe } from '../../calibrationlibrary/calibrationlibrary'
import { Actions, Notice, Readout } from '../../equipment-control/parts'
import { FileExplorerModal } from '../../files/FileExplorerModal'
import { imagesState, openImage } from '../../images/images'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { navigate, routeState } from '../../shell/route'
import { EmptyState, useWorkspacePanel, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Modal } from '../../ui/Modal'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { TextInput } from '../../ui/TextInput'
// oxfmt-ignore
import { bytesText, CALIBRATION_KINDS, cameraFilterLabels, cameraText, coverage, EVIDENCE_LABELS, exposureText, groupTitle, JOB_STATE_LABELS, JOB_STATE_TONES, jobFraction, KIND_FILTERS, KIND_LABELS, type KindFilter, LIBRARY_SECTIONS, type LibrarySection, METHOD_LABELS, ORIGIN_LABELS, OVERRIDE_LABELS, overrideIsText, PRODUCT_STATUS_LABELS, PRODUCT_STATUS_TONES, READINESS_LABELS, READINESS_TONES, RECIPE_METHODS, SECTION_LABELS, settingsText, SOURCE_STATUS_LABELS, SOURCE_STATUS_TONES, temperatureText } from './library'

// Calibration Library tool: what calibration frames exist, what can be combined and why not, which masters were made, and the
// jobs making them. It works with no camera and starts no exposure; every capture stays in Images. State lives on the server,
// so a reload, another tab, or a wizard show the same jobs. A master is built from the group it belongs to, a change makes a new
// revision, and this tool never deletes anything.

// Fields of the recipe form.
interface RecipeForm {
	// Combination.
	readonly method: 'sigmaClip' | 'median' | 'mean'
	// Rejection limits, in robust standard deviations.
	readonly sigmaLow: number
	readonly sigmaHigh: number
	// Most rejection passes per pixel.
	readonly maxIterations: number
	// Revision that corrects a flat, as masterId:revision.
	readonly correction: string
	// Whether what asks for a review is accepted.
	readonly acknowledged: boolean
}

// Starting recipe of a group.
const DEFAULT_FORM: RecipeForm = { method: 'sigmaClip', sigmaLow: 3, sigmaHigh: 3, maxIterations: 5, correction: '', acknowledged: false }

// Choice of the group, revision, frame, or job shown in the panel.
type Selection = { readonly type: 'group'; readonly groupId: string } | { readonly type: 'master'; readonly masterId: string; readonly revision: number } | { readonly type: 'source'; readonly sourceId: string } | { readonly type: 'job'; readonly jobId: string }

// Calibration Library tool.
export function CalibrationLibrary() {
	const runtime = useSnapshot(calibrationLibraryRuntime)
	const route = useSnapshot(routeState).route
	const linked = route.workspace === 'tools' ? route.group : undefined
	const [section, setSection] = useState<LibrarySection>('library')
	const [kind, setKind] = useState<KindFilter>('all')
	const [camera, setCamera] = useState('')
	const [search, setSearch] = useState('')
	const [page, setPage] = useState(0)
	const [selection, setSelection] = useState<Selection | undefined>(linked ? { type: 'group', groupId: linked } : undefined)
	const [importing, setImporting] = useState(false)
	const [importJob, setImportJob] = useState<string>()
	const filter = { kind: kind === 'all' ? undefined : kind, camera: camera || undefined, search: search || undefined }
	const panelState = useWorkspacePanel('tools')

	// Shows something in the panel, which a narrow screen keeps closed until then.
	function select(next: Selection) {
		setSelection(next)
		if (!panelState.docked) panelState.setOpen(true)
	}

	// A link from a wizard shows its group, whichever section was open.
	useEffect(() => {
		if (linked === undefined) return
		setSection('library')
		setSelection({ type: 'group', groupId: linked })
	}, [linked])

	// Fetches the page shown, again whenever the server reports a change.
	useEffect(() => {
		const state = calibrationLibraryRuntime
		if (section === 'library') void loadCalibrationGroups(state, filter, page)
		else if (section === 'frames') void loadCalibrationSources(state, filter, page)
		else if (section === 'masters') void loadCalibrationMasters(state, filter, page)
		else void loadCalibrationJobs(state, page)
	}, [section, kind, camera, search, page, runtime.changes])

	// Fetches what the panel shows, again whenever the server reports a change.
	useEffect(() => {
		const state = calibrationLibraryRuntime
		void loadCalibrationGroup(state, selection?.type === 'group' ? selection.groupId : undefined)
		void loadCalibrationMaster(state, selection?.type === 'master' ? selection : undefined)
		void loadCalibrationSource(state, selection?.type === 'source' ? selection.sourceId : undefined)
	}, [selection, runtime.changes])

	function change<T>(apply: (value: T) => void) {
		return (value: T) => {
			setPage(0)
			apply(value)
		}
	}

	function selectGroup(groupId: string) {
		select({ type: 'group', groupId })
		navigate(routeState, { workspace: 'tools', tool: 'calibration-library', group: groupId })
	}

	async function chooseDirectory(path: string) {
		setImporting(false)
		const job = await startCalibrationImport(calibrationLibraryRuntime, path, true)
		if (job) setImportJob(job.jobId)
	}

	const cameraList = runtime.summary?.cameras ?? []
	const cameras = ['', ...cameraList.map(({ id }) => id)]
	const cameraLabels = cameraFilterLabels(cameraList)
	const panel = selection && <SelectionPanel selection={selection} onGroup={selectGroup} />

	const actions = (
		<Actions>
			<Button variant="secondary" disabled={runtime.pending.refresh === true} onClick={() => void refreshCalibrationFiles(calibrationLibraryRuntime)}>
				Check Files
			</Button>
			<Button onClick={() => setImporting(true)}>Import Frames</Button>
		</Actions>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Calibration Library" actions={actions} panelState={panelState} panel={panel ? { title: 'Details', content: panel } : undefined}>
			<div className="flex h-full flex-col gap-3 overflow-y-auto bg-base-000 p-3">
				{runtime.summary?.unavailable && <Notice error>A newer version of Nebulosa owns this catalog. It was left as it is.</Notice>}
				{runtime.errors.import && <Notice error>{runtime.errors.import}</Notice>}
				{runtime.errors.refresh && <Notice error>{runtime.errors.refresh}</Notice>}
				<div className="flex flex-wrap items-end gap-3">
					<SegmentedControl options={LIBRARY_SECTIONS} value={section} format={(option) => SECTION_LABELS[option]} onChange={change(setSection)} />
					{section !== 'jobs' && <Select label="Frame Type" className="w-36" options={KIND_FILTERS} value={kind} format={(option) => (option === 'all' ? 'All Types' : KIND_LABELS[option])} onChange={change(setKind)} />}
					{section !== 'jobs' && <Select label="Camera" className="w-52" options={cameras} value={camera} format={(option) => (option ? (cameraLabels.get(option) ?? option) : 'All Cameras')} onChange={change(setCamera)} />}
					{section === 'frames' && <TextInput label="Search" className="w-52" value={search} onChange={(event) => change(setSearch)(event.target.value)} />}
				</div>
				{section === 'library' && <GroupsView selected={selection?.type === 'group' ? selection.groupId : undefined} onSelect={selectGroup} />}
				{section === 'frames' && <FramesView selected={selection?.type === 'source' ? selection.sourceId : undefined} onSelect={(sourceId) => select({ type: 'source', sourceId })} />}
				{section === 'masters' && <MastersView selection={selection} onSelect={(masterId, revision) => select({ type: 'master', masterId, revision })} />}
				{section === 'jobs' && <JobsView selected={selection?.type === 'job' ? selection.jobId : undefined} onSelect={(jobId) => select({ type: 'job', jobId })} />}
				<Pager page={page} total={pageTotal(section)} loading={runtime.loading} onPage={setPage} />
			</div>
			<FileExplorerModal open={importing} title="Import Calibration Frames" mode="directory" onChoose={(path) => void chooseDirectory(path)} onClose={() => setImporting(false)} />
			{importJob && <ImportReview jobId={importJob} onClose={() => setImportJob(undefined)} />}
		</WorkspaceLayout>
	)
}

// Rows of the list a section shows.
function pageTotal(section: LibrarySection) {
	const { groups, sources, masters, jobHistory } = calibrationLibraryRuntime
	return (section === 'library' ? groups : section === 'frames' ? sources : section === 'masters' ? masters : jobHistory)?.total ?? 0
}

// Previous and next page of a list, shown only when there is more than one.
function Pager({ page, total, loading, onPage }: { readonly page: number; readonly total: number; readonly loading: boolean; readonly onPage: (page: number) => void }) {
	const pages = Math.ceil(total / CALIBRATION_PAGE_SIZE)
	if (pages < 2) return null

	return (
		<div className="flex items-center gap-2 text-xs text-ink-300 tabular-nums">
			<Button variant="secondary" disabled={page === 0 || loading} onClick={() => onPage(page - 1)}>
				Previous
			</Button>
			<span>{`Page ${page + 1} of ${pages} · ${total} rows`}</span>
			<Button variant="secondary" disabled={page + 1 >= pages || loading} onClick={() => onPage(page + 1)}>
				Next
			</Button>
		</div>
	)
}

// Table with a sticky header, of cells any list shares.
function Table({ headers, children }: { readonly headers: readonly string[]; readonly children: React.ReactNode }) {
	return (
		<div className="min-h-0 overflow-auto rounded-md border border-line-100">
			<table className="w-full border-collapse text-xs text-ink-200 tabular-nums">
				<thead className="sticky top-0 z-1 bg-base-100">
					<tr className="border-b border-line-100">
						{headers.map((header) => (
							<th key={header} className="px-2 py-1.5 text-left font-medium whitespace-nowrap text-ink-300">
								{header}
							</th>
						))}
					</tr>
				</thead>
				<tbody>{children}</tbody>
			</table>
		</div>
	)
}

// Row that selects what it shows.
function Row({ selected, onClick, children }: { readonly selected: boolean; readonly onClick: () => void; readonly children: React.ReactNode }) {
	return (
		<tr onClick={onClick} className={cn('cursor-pointer border-b border-line-100 last:border-b-0 hover:bg-base-200', selected && 'bg-accent-subtle')}>
			{children}
		</tr>
	)
}

// Cell of a row.
function Cell({ children, className }: { readonly children: React.ReactNode; readonly className?: string }) {
	return <td className={cn('px-2 py-1.5 whitespace-nowrap', className)}>{children}</td>
}

// Coverage and groups.
function GroupsView({ selected, onSelect }: { readonly selected?: string; readonly onSelect: (groupId: string) => void }) {
	const { groups, summary } = useSnapshot(calibrationLibraryRuntime)
	const items = (groups?.items ?? []) as readonly CalibrationGroupSummary[]

	if (items.length === 0) return <EmptyState title="No calibration frames" description="Finish a Dark Library plan in Images, or import a directory of FITS or XISF frames." />

	return (
		<>
			<p className="m-0 text-xs text-ink-300 tabular-nums">{`${summary?.frames.available ?? 0} frames available · ${(summary?.masters.ready ?? 0) + (summary?.masters.warning ?? 0)} masters`}</p>
			<Coverage groups={items} />
			<Table headers={['Type', 'Group', 'Camera', 'Settings', 'Frames', 'State', 'Master']}>
				{items.map((group) => (
					<Row key={group.groupId} selected={group.groupId === selected} onClick={() => onSelect(group.groupId)}>
						<Cell>{KIND_LABELS[group.kind]}</Cell>
						<Cell>{groupTitle(group)}</Cell>
						<Cell>{cameraText(group.metadata)}</Cell>
						<Cell>{settingsText(group.metadata)}</Cell>
						<Cell>{group.required === undefined ? group.usable : `${group.usable}/${group.required}`}</Cell>
						<Cell>
							<StatusBadge tone={READINESS_TONES[group.readiness]} label={READINESS_LABELS[group.readiness]} />
						</Cell>
						<Cell>{group.masters[0] ? `v${group.masters[0].revision}` : '—'}</Cell>
					</Row>
				))}
			</Table>
		</>
	)
}

// Which roles have masters, per camera and operating point.
function Coverage({ groups }: { readonly groups: readonly CalibrationGroupSummary[] }) {
	return (
		<Table headers={['Camera', 'Settings', ...CALIBRATION_KINDS.map((kind) => KIND_LABELS[kind])]}>
			{coverage(groups).map(({ key, camera, settings, kinds }) => (
				<tr key={key} className="border-b border-line-100 last:border-b-0">
					<Cell>{camera}</Cell>
					<Cell>{settings}</Cell>
					{CALIBRATION_KINDS.map((kind) => (
						<Cell key={kind} className={kinds[kind].groups > 0 && kinds[kind].masters < kinds[kind].groups ? 'text-warning' : undefined}>
							{kinds[kind].groups === 0 ? '—' : `${kinds[kind].masters}/${kinds[kind].groups}`}
						</Cell>
					))}
				</tr>
			))}
		</Table>
	)
}

// List of frames.
function FramesView({ selected, onSelect }: { readonly selected?: string; readonly onSelect: (sourceId: string) => void }) {
	const { sources } = useSnapshot(calibrationLibraryRuntime)
	const items = (sources?.items ?? []) as readonly CalibrationSourceSummary[]

	if (items.length === 0) return <EmptyState title="No frames" description="Nothing matches these filters." />

	return (
		<Table headers={['File', 'Type', 'Exposure', 'Temperature', 'Settings', 'Origin', 'State']}>
			{items.map((source) => (
				<Row key={source.sourceId} selected={source.sourceId === selected} onClick={() => onSelect(source.sourceId)}>
					<Cell>{source.name}</Cell>
					<Cell>{KIND_LABELS[source.kind]}</Cell>
					<Cell>{exposureText(source.metadata)}</Cell>
					<Cell>{temperatureText(source.metadata)}</Cell>
					<Cell>{settingsText(source.metadata)}</Cell>
					<Cell>{ORIGIN_LABELS[source.origin]}</Cell>
					<Cell>{source.excluded === undefined ? <StatusBadge tone={SOURCE_STATUS_TONES[source.status]} label={SOURCE_STATUS_LABELS[source.status]} /> : <StatusBadge tone="muted" label="Left Out" />}</Cell>
				</Row>
			))}
		</Table>
	)
}

// List of master revisions.
function MastersView({ selection, onSelect }: { readonly selection?: Selection; readonly onSelect: (masterId: string, revision: number) => void }) {
	const { masters } = useSnapshot(calibrationLibraryRuntime)
	const items = (masters?.items ?? []) as readonly CalibrationMasterSummary[]

	if (items.length === 0) return <EmptyState title="No masters" description="Build one from a group of the Library." />

	return (
		<Table headers={['Type', 'Group', 'Camera', 'Revision', 'Frames', 'Method', 'Contents', 'State']}>
			{items.map((master) => (
				<Row key={`${master.masterId}:${master.revision}`} selected={selection?.type === 'master' && selection.masterId === master.masterId && selection.revision === master.revision} onClick={() => onSelect(master.masterId, master.revision)}>
					<Cell>{KIND_LABELS[master.kind]}</Cell>
					<Cell>{groupTitle(master)}</Cell>
					<Cell>{cameraText(master.metadata)}</Cell>
					<Cell>{`v${master.revision}${master.preferred ? ' · Preferred' : ''}`}</Cell>
					<Cell>{master.frames}</Cell>
					<Cell>{METHOD_LABELS[master.method]}</Cell>
					<Cell>{master.units}</Cell>
					<Cell>
						<StatusBadge tone={PRODUCT_STATUS_TONES[master.status]} label={PRODUCT_STATUS_LABELS[master.status]} />
					</Cell>
				</Row>
			))}
		</Table>
	)
}

// Live jobs over the page of the server.
function JobsView({ selected, onSelect }: { readonly selected?: string; readonly onSelect: (jobId: string) => void }) {
	const { jobHistory, jobs } = useSnapshot(calibrationLibraryRuntime)
	const items = ((jobHistory?.items ?? []) as readonly CalibrationJobSummary[]).map((job) => jobs[job.jobId] ?? job)

	if (items.length === 0) return <EmptyState title="No jobs" description="Builds and imports appear here, and keep running when this tab closes." />

	return (
		<Table headers={['Job', 'Requested', 'Frames', 'Progress', 'State', '']}>
			{items.map((job) => (
				<Row key={job.jobId} selected={job.jobId === selected} onClick={() => onSelect(job.jobId)}>
					<Cell>{job.type === 'import' ? `Import · ${job.found ?? 0} files` : `${job.kind ? KIND_LABELS[job.kind] : 'Master'}${job.automatic ? ' · Automatic' : ''}`}</Cell>
					<Cell>{new Date(job.createdAt).toLocaleString()}</Cell>
					<Cell>{job.frames ?? '—'}</Cell>
					<Cell>{jobEnded(job) ? (job.error ?? '—') : `${Math.round(jobFraction(job) * 100)}%`}</Cell>
					<Cell>
						<StatusBadge tone={JOB_STATE_TONES[job.state]} label={JOB_STATE_LABELS[job.state]} />
					</Cell>
					<Cell>
						<JobActions job={job} />
					</Cell>
				</Row>
			))}
		</Table>
	)
}

// Cancel of a job working, and retry of one that failed.
function JobActions({ job }: { readonly job: CalibrationJobSummary }) {
	const { pending } = useSnapshot(calibrationLibraryRuntime)
	const busy = pending[`job:${job.jobId}`] === true

	if (!jobEnded(job)) {
		return (
			<Button variant="secondary" disabled={busy} onClick={() => void cancelCalibrationJob(calibrationLibraryRuntime, job.jobId)}>
				Cancel
			</Button>
		)
	}

	if (job.type === 'master' && (job.state === 'failed' || job.state === 'interrupted')) {
		return (
			<Button variant="secondary" disabled={busy} onClick={() => void retryCalibrationJob(calibrationLibraryRuntime, job.jobId)}>
				Retry
			</Button>
		)
	}

	return null
}

// Panel of what is selected.
function SelectionPanel({ selection, onGroup }: { readonly selection: Selection; readonly onGroup: (groupId: string) => void }) {
	if (selection.type === 'group') return <GroupPanel />
	if (selection.type === 'master') return <MasterPanel onGroup={onGroup} />
	if (selection.type === 'source') return <SourcePanel />
	return <JobPanel jobId={selection.jobId} />
}

// Explained reasons, the worst first.
function Findings({ findings }: { readonly findings: readonly CompatibilityFinding[] }) {
	if (findings.length === 0) return <Notice>Nothing to report.</Notice>
	const order = { blocker: 0, review: 1, notice: 2 }

	return (
		<ul className="m-0 flex list-none flex-col gap-1 p-0">
			{findings
				.toSorted((a, b) => order[a.severity] - order[b.severity])
				.map(({ field, code, severity, message }) => (
					<li key={`${field}:${code}:${message}`} className={cn('text-xs leading-4', severity === 'blocker' ? 'text-danger' : severity === 'review' ? 'text-warning' : 'text-ink-300')}>
						{message}
					</li>
				))}
		</ul>
	)
}

// Group, why it is in its state, and its build form.
function GroupPanel() {
	const { group } = useSnapshot(calibrationLibraryRuntime)
	if (!group) return <p className="m-0 p-4 text-xs text-ink-300">Loading…</p>

	return (
		<>
			<CollapsibleSection id="calibration.group" title={`${KIND_LABELS[group.kind]} · ${groupTitle(group)}`}>
				<StatusBadge tone={READINESS_TONES[group.readiness]} label={READINESS_LABELS[group.readiness]} />
				<Readout label="Camera">{cameraText(group.metadata)}</Readout>
				<Readout label="Settings">{settingsText(group.metadata)}</Readout>
				<Readout label="Frames">{group.required === undefined ? `${group.usable} usable of ${group.total}` : `${group.usable} usable, ${group.required} planned`}</Readout>
				<Findings findings={group.findings} />
			</CollapsibleSection>
			<CollapsibleSection id="calibration.build" title="Build Master">
				<BuildForm key={group.groupId} groupId={group.groupId} kind={group.kind} />
			</CollapsibleSection>
			{group.masters.length > 0 && (
				<CollapsibleSection id="calibration.revisions" title="Revisions">
					{group.masters.map((master) => (
						<div key={master.revision} className="flex items-center gap-2 text-xs text-ink-200 tabular-nums">
							<span>{`v${master.revision} · ${master.frames} frames · ${METHOD_LABELS[master.method]}`}</span>
							<StatusBadge tone={PRODUCT_STATUS_TONES[master.status]} label={PRODUCT_STATUS_LABELS[master.status]} />
						</div>
					))}
				</CollapsibleSection>
			)}
		</>
	)
}

// Recipe of a master, which the server explains as it changes.
function BuildForm({ groupId, kind }: { readonly groupId: string; readonly kind: CalibrationKind }) {
	const { pending, errors, masters, changes } = useSnapshot(calibrationLibraryRuntime)
	const [form, setForm] = useState<RecipeForm>(DEFAULT_FORM)
	const [validation, setValidation] = useState<RecipeValidation>()
	const [corrections, setCorrections] = useState<readonly CalibrationMasterSummary[]>([])
	const key = `group:${groupId}`
	const edit = (patch: Partial<RecipeForm>) => setForm({ ...form, ...patch })
	void masters

	const request = (): MasterRequest => {
		const [masterId, revision] = form.correction.split(':')
		return { groupId, recipe: { method: form.method, sigmaLow: form.sigmaLow, sigmaHigh: form.sigmaHigh, maxIterations: form.maxIterations }, correction: form.correction ? { masterId, revision: Number(revision) } : undefined, acknowledged: form.acknowledged }
	}

	// The server explains every change of the form, so the reasons shown are the ones Build would meet.
	useEffect(() => {
		let current = true

		void validateRecipe(request()).then((answer) => {
			if (current) setValidation(answer)
		})

		return () => {
			current = false
		}
	}, [form, groupId, changes])

	// A flat chooses among the masters that can correct it.
	useEffect(() => {
		if (kind !== 'flat') return
		let current = true

		void Promise.all(['darkFlat', 'bias'].map(async (each) => ((await (await fetch(`/api/calibration-library/masters?kind=${each}&limit=100`)).json()) as Page<CalibrationMasterSummary>).items)).then((lists) => {
			if (current) setCorrections(lists.flat())
		})

		return () => {
			current = false
		}
	}, [kind, changes])

	const options = ['', ...corrections.map(({ masterId, revision }) => `${masterId}:${revision}`)]

	function correctionLabel(option: string) {
		const master = corrections.find(({ masterId, revision }) => `${masterId}:${revision}` === option)
		return master ? `${KIND_LABELS[master.kind]} v${master.revision} · ${exposureText(master.metadata)}` : 'None'
	}

	const reason = validation?.findings.find(({ severity }) => severity === 'blocker')?.message

	return (
		<>
			<Select label="Combination" options={RECIPE_METHODS} value={form.method} format={(option) => METHOD_LABELS[option]} onChange={(method) => edit({ method })} />
			{form.method === 'sigmaClip' && (
				<div className="flex flex-col gap-2">
					<NumberInput label="Low σ" value={form.sigmaLow} min={1} max={10} step={0.5} onChange={(sigmaLow) => edit({ sigmaLow })} />
					<NumberInput label="High σ" value={form.sigmaHigh} min={1} max={10} step={0.5} onChange={(sigmaHigh) => edit({ sigmaHigh })} />
					<NumberInput label="Passes" value={form.maxIterations} min={1} max={20} onChange={(maxIterations) => edit({ maxIterations })} />
				</div>
			)}
			{kind === 'flat' && <Select label="Correction" options={options} value={form.correction} format={correctionLabel} onChange={(correction) => edit({ correction })} />}
			{validation && <Findings findings={validation.findings} />}
			{validation?.needsAcknowledgement && <Checkbox label="I reviewed these and accept them" checked={form.acknowledged} onChange={(acknowledged) => edit({ acknowledged })} />}
			{validation !== undefined && validation.spillBytes > 0 && <Notice>{`Needs about ${bytesText(validation.spillBytes)} of temporary disk.`}</Notice>}
			{validation?.existing && <Notice>{`This exact recipe is already v${validation.existing.revision}.`}</Notice>}
			{errors[key] && <Notice error>{errors[key]}</Notice>}
			<Button disabled={!validation?.valid || validation.existing !== undefined || pending[key] === true} title={reason} onClick={() => void buildMaster(calibrationLibraryRuntime, key, request())}>
				Build Master
			</Button>
		</>
	)
}

// Value with how it is known.
function EvidencedReadout({ label, value, format = String }: { readonly label: string; readonly value: Evidenced<string | number>; readonly format?: (value: string | number) => string }) {
	return <Readout label={label}>{value.value === undefined ? 'Unknown' : `${format(value.value)} · ${EVIDENCE_LABELS[value.evidence]}`}</Readout>
}

// Revision, what went in, and how to use it.
function MasterPanel({ onGroup }: { readonly onGroup: (groupId: string) => void }) {
	const { master: snapshot, pending, errors } = useSnapshot(calibrationLibraryRuntime)
	const master = snapshot
	if (!master) return <p className="m-0 p-4 text-xs text-ink-300">Loading…</p>

	const key = `master:${master.masterId}`
	const { diagnostics } = master

	function open() {
		if (!master) return
		void openImage(imagesState, master.path)
		navigate(routeState, { workspace: 'images' })
	}

	return (
		<>
			<CollapsibleSection id="calibration.master" title={`${KIND_LABELS[master.kind]} v${master.revision}`}>
				<StatusBadge tone={PRODUCT_STATUS_TONES[master.status]} label={PRODUCT_STATUS_LABELS[master.status]} />
				<Readout label="Contents">{`${master.calibrationState} · ${master.units}`}</Readout>
				<Notice>{master.usage}</Notice>
				<Actions>
					<Button disabled={master.status === 'unavailable'} onClick={open}>
						Open in Images
					</Button>
					<Button variant="secondary" disabled={master.preferred || master.status === 'unavailable' || pending[key] === true} onClick={() => void preferMaster(calibrationLibraryRuntime, master.masterId, master.revision)}>
						{master.preferred ? 'Preferred' : 'Set Preferred'}
					</Button>
					<Button variant="secondary" onClick={() => onGroup(master.groupId)}>
						Open Group
					</Button>
				</Actions>
				{errors[key] && <Notice error>{errors[key]}</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="calibration.diagnostics" title="Integration">
				<Readout label="Frames">{`${diagnostics.integratedFrames} of ${diagnostics.requestedFrames}`}</Readout>
				<Readout label="Method">{METHOD_LABELS[diagnostics.method]}</Readout>
				<Readout label="Rejected Samples">{`${diagnostics.rejectedLow} low, ${diagnostics.rejectedHigh} high`}</Readout>
				{diagnostics.hotPixels !== undefined && <Readout label="Hot Pixels">{diagnostics.hotPixels}</Readout>}
				{diagnostics.invalidResponsePixels !== undefined && <Readout label="Invalid Response">{diagnostics.invalidResponsePixels}</Readout>}
				{diagnostics.planes.map(({ plane, median, sigma }) => (
					<Readout key={plane} label={`Plane ${plane + 1}`}>{`${median.toFixed(master.units === 'DN' ? 1 : 4)} ± ${sigma.toFixed(master.units === 'DN' ? 1 : 4)}`}</Readout>
				))}
				{diagnostics.lowSampleCount && <Notice>Fewer frames than recommended.</Notice>}
				{diagnostics.excludedFrames?.map(({ sourceId, reason }) => (
					<Notice key={sourceId}>{`A frame was left out: ${reason}`}</Notice>
				))}
				{master.acknowledged.map(({ message }) => (
					<Notice key={message}>{`Accepted: ${message}`}</Notice>
				))}
			</CollapsibleSection>
			<CollapsibleSection id="calibration.lineage" title="Provenance" defaultOpen={false}>
				{master.dependencies.map(({ masterId, revision }) => (
					<Readout key={masterId} label="Corrected by">{`${masterId.slice(0, 8)} v${revision}`}</Readout>
				))}
				<Readout label="Published">{new Date(master.createdAt).toLocaleString()}</Readout>
				<Readout label="SHA-256">
					<span className="break-all">{master.contentDigest}</span>
				</Readout>
				{master.sourceNames.map((name) => (
					<p key={name} className="m-0 text-xs text-ink-300">
						{name}
					</p>
				))}
			</CollapsibleSection>
		</>
	)
}

// Frame, with how each value is known, and what an operator may state about it.
function SourcePanel() {
	const { source: snapshot } = useSnapshot(calibrationLibraryRuntime)
	const source = snapshot
	if (!source) return <p className="m-0 p-4 text-xs text-ink-300">Loading…</p>
	const { metadata } = source

	return (
		<>
			<CollapsibleSection id="calibration.source" title="Frame">
				<StatusBadge tone={SOURCE_STATUS_TONES[source.status]} label={SOURCE_STATUS_LABELS[source.status]} />
				<Readout label="Path">
					<span className="break-all">{source.path}</span>
				</Readout>
				<Readout label="Size">{bytesText(source.bytes)}</Readout>
				<Readout label="Image">{`${metadata.width}×${metadata.height}×${metadata.channels}, BITPIX ${metadata.bitpix}${metadata.cfa ? `, ${metadata.cfa}` : ''}`}</Readout>
				<EvidencedReadout label="Camera" value={metadata.cameraId} />
				<EvidencedReadout label="Exposure" value={metadata.exposure} format={(value) => `${Number(value) / 1000000} s`} />
				<EvidencedReadout label="Target" value={metadata.setTemperature} format={(value) => `${value} °C`} />
				<EvidencedReadout label="Sensor" value={metadata.sensorTemperature} format={(value) => `${value} °C`} />
				<EvidencedReadout label="Gain" value={metadata.gain} />
				<EvidencedReadout label="Offset" value={metadata.offset} />
				<EvidencedReadout label="Readout" value={metadata.readoutMode} />
				<EvidencedReadout label="Filter" value={metadata.filter} />
				{source.warnings.map((warning) => (
					<Notice key={warning}>{warning}</Notice>
				))}
			</CollapsibleSection>
			<CollapsibleSection id="calibration.review" title="Review">
				<ReviewForm key={source.sourceId} source={source} />
			</CollapsibleSection>
		</>
	)
}

// Declares an unknown value or leaves a frame out, always with its reason.
function ReviewForm({ source }: { readonly source: CalibrationSource }) {
	const { pending, errors } = useSnapshot(calibrationLibraryRuntime)
	const fields = (Object.keys(OVERRIDE_LABELS) as OverridableField[]).filter((field) => source.metadata[field].evidence === 'unknown')
	const [field, setField] = useState<OverridableField | undefined>(fields[0])
	const [value, setValue] = useState('')
	const [reason, setReason] = useState('')
	const key = `source:${source.sourceId}`

	function declare() {
		if (field) void overrideCalibrationSource(calibrationLibraryRuntime, source.sourceId, field, overrideIsText(field) ? value : Number(value), reason)
	}

	return (
		<>
			{field && <Select label="Field" options={fields} value={field} format={(option) => OVERRIDE_LABELS[option]} onChange={setField} />}
			{field && <TextInput label="Value" value={value} onChange={(event) => setValue(event.target.value)} />}
			<TextInput label="Reason" value={reason} onChange={(event) => setReason(event.target.value)} />
			{errors[key] && <Notice error>{errors[key]}</Notice>}
			<Actions>
				{field && (
					<Button variant="secondary" disabled={!value || !reason || pending[key] === true} onClick={declare}>
						Declare Value
					</Button>
				)}
				{source.excluded === undefined ? (
					<Button variant="secondary" disabled={!reason || pending[key] === true} onClick={() => void excludeCalibrationSource(calibrationLibraryRuntime, source.sourceId, reason)}>
						Leave Out
					</Button>
				) : (
					<Button variant="secondary" disabled={pending[key] === true} onClick={() => void excludeCalibrationSource(calibrationLibraryRuntime, source.sourceId, undefined)}>
						Include Again
					</Button>
				)}
			</Actions>
			{source.excluded !== undefined && <Notice>{`Left out: ${source.excluded}`}</Notice>}
		</>
	)
}

// Job, with why it ended.
function JobPanel({ jobId }: { readonly jobId: string }) {
	const { jobs, jobHistory } = useSnapshot(calibrationLibraryRuntime)
	const job = (jobs[jobId] ?? jobHistory?.items.find((each) => each.jobId === jobId)) as CalibrationJobSummary | undefined
	if (!job) return null

	return (
		<CollapsibleSection id="calibration.job" title="Job">
			<StatusBadge tone={JOB_STATE_TONES[job.state]} label={JOB_STATE_LABELS[job.state]} />
			<Readout label="Frames Checked">{job.progress.framesValidated}</Readout>
			<Readout label="Rows">{`${job.progress.rowsCombined} of ${job.progress.rowsTotal}`}</Readout>
			<Readout label="Written">{bytesText(job.progress.bytesWritten)}</Readout>
			{job.error && <Notice error>{job.error}</Notice>}
			<JobActions job={job} />
		</CollapsibleSection>
	)
}

// Review of what an import found: nothing enters the library until it is committed.
function ImportReview({ jobId, onClose }: { readonly jobId: string; readonly onClose: () => void }) {
	const { jobs, pending, errors } = useSnapshot(calibrationLibraryRuntime)
	const job = jobs[jobId]
	const ended = job !== undefined && jobEnded(job)
	const [page, setPage] = useState<Page<ImportCandidate>>()
	const [declared, setDeclared] = useState<Readonly<Record<string, CalibrationKind>>>({})
	const [reason, setReason] = useState('')
	const [copy, setCopy] = useState(false)
	const [committed, setCommitted] = useState<number>()

	// Fetches what was found once the scan ended.
	useEffect(() => {
		if (job?.state === 'completed' && !page) void loadImportCandidates(jobId, 0).then(setPage)
	}, [job?.state, jobId, page])

	async function commit() {
		const classifications = Object.fromEntries(Object.entries(declared).map(([path, kind]) => [path, { kind, reason }]))
		const answer = await commitCalibrationImport(calibrationLibraryRuntime, jobId, { classifications, copy })
		if (answer) setCommitted(answer.committed)
	}

	const items = page?.items ?? []
	const ready = items.filter(({ path, kind, rejectedRole, error, known }) => (kind ?? declared[path]) !== undefined && !rejectedRole && !error && !known).length
	const needsReason = Object.keys(declared).length > 0 && !reason

	return (
		<Modal open title="Import Calibration Frames" fit className="w-full max-w-4xl" onClose={onClose}>
			<div className="flex min-h-0 flex-col gap-3">
				{!ended && (
					<div className="flex items-center gap-3">
						<Notice>{`Reading headers · ${job?.found ?? 0} files · ${bytesText(job?.bytes ?? 0)}`}</Notice>
						<Button variant="secondary" onClick={() => void cancelCalibrationJob(calibrationLibraryRuntime, jobId)}>
							Cancel
						</Button>
					</div>
				)}
				{job?.error && <Notice error>{job.error}</Notice>}
				{job?.truncated && <Notice error>The limit of files was reached; only part of this directory was read.</Notice>}
				{committed !== undefined && <Notice>{`${committed} frames entered the library.`}</Notice>}
				{page && committed === undefined && (
					<>
						<Notice>{`${page.total} files found, ${ready} ready. Frames are referenced where they are and never changed.`}</Notice>
						<Table headers={['File', 'Found', 'Exposure', 'Declared Type', 'Notes']}>
							{items.map((candidate) => (
								<tr key={candidate.path} className="border-b border-line-100 last:border-b-0">
									<Cell>{candidate.name}</Cell>
									<Cell>{candidate.kind ? KIND_LABELS[candidate.kind] : (candidate.rejectedRole ?? 'Unknown')}</Cell>
									<Cell>{candidate.metadata ? exposureText(candidate.metadata) : '—'}</Cell>
									<Cell>
										{!candidate.kind && !candidate.rejectedRole && !candidate.error && (
											<Select
												options={['none', ...CALIBRATION_KINDS]}
												value={declared[candidate.path] ?? 'none'}
												format={(option) => (option === 'none' ? 'Not a frame' : KIND_LABELS[option])}
												onChange={(option) => setDeclared(option === 'none' ? Object.fromEntries(Object.entries(declared).filter(([path]) => path !== candidate.path)) : { ...declared, [candidate.path]: option })}
											/>
										)}
									</Cell>
									<Cell>{candidate.error ?? (candidate.known ? 'Already in the library' : candidate.warnings[0])}</Cell>
								</tr>
							))}
						</Table>
						{Object.keys(declared).length > 0 && <TextInput label="Why these types" value={reason} onChange={(event) => setReason(event.target.value)} />}
						<Checkbox label="Copy into the library" checked={copy} onChange={setCopy} />
						{errors.import && <Notice error>{errors.import}</Notice>}
						<Actions>
							<Button disabled={ready === 0 || needsReason || pending.import === true} onClick={() => void commit()}>
								{`Add ${ready} Frames`}
							</Button>
						</Actions>
					</>
				)}
				{(committed !== undefined || (ended && !page)) && (
					<Actions>
						<Button variant="secondary" onClick={onClose}>
							Close
						</Button>
					</Actions>
				)}
			</div>
		</Modal>
	)
}
