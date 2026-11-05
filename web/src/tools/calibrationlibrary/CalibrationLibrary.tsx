import type { CalibrationGroupSummary, CalibrationKind, CalibrationMasterSummary, CalibrationSource, CalibrationSourceSummary, CompatibilityFinding, Evidenced, ImportCandidate, MasterRequest, OverridableField, Page, RecipeValidation } from 'api'
import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
// oxfmt-ignore
import { buildMaster, CALIBRATION_PAGE_SIZE, calibrationLibraryRuntime, cancelCalibrationImport, commitCalibrationImport, deleteCalibrationGroup, deleteCalibrationMaster, deleteCalibrationSource, excludeCalibrationSource, jobEnded, latestGroupJob, loadCalibrationGroup, loadCalibrationGroups, loadCalibrationMaster, loadCalibrationMasters, loadCalibrationSource, loadCalibrationSources, loadFlatCorrections, loadImportCandidates, overrideCalibrationSource, refreshCalibrationFiles, startCalibrationImport, validateRecipe } from '../../calibrationlibrary/calibrationlibrary'
import { FileExplorerModal } from '../../files/FileExplorerModal'
import { IMAGE_EXTENSIONS } from '../../files/files'
import { imagesState, openImage } from '../../images/images'
import { activeProfile, profileState, setLastCalibrationDirectory } from '../../profile/profile'
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
import { bytesText, CALIBRATION_KINDS, cameraText, coverage, EVIDENCE_LABELS, exposureText, groupTitle, jobFraction, KIND_FILTERS, KIND_LABELS, type KindFilter, LIBRARY_SECTIONS, type LibrarySection, masterName, masterWarnings, METHOD_LABELS, ORIGIN_LABELS, OVERRIDE_LABELS, overrideIsText, PRODUCT_STATUS_LABELS, PRODUCT_STATUS_TONES, READINESS_LABELS, READINESS_TONES, RECIPE_METHODS, SECTION_LABELS, settingsText, SOURCE_STATUS_LABELS, SOURCE_STATUS_TONES, temperatureText } from './library'
import { MISSING, formatPercent } from '../../format'
import { Actions } from '../../ui/Actions'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'

// Calibration Library tool: what calibration frames exist, what can be combined and why not, and which masters were made. It
// works with no camera and starts no exposure; every capture stays in Images. State lives on the server, so a reload, another
// tab, or a wizard show the same builds. A master is built from the group it belongs to, whose form follows its build, and
// every build makes a new master, told apart by its id and date. Deleting, after a confirmation, takes a frame or a group
// with their files, or one master.

// Fields of the recipe form.
interface RecipeForm {
	// Role a master of dark frames is built as.
	readonly kind: DarkMasterKind
	// Combination.
	readonly method: 'sigmaClip' | 'median' | 'mean'
	// Rejection limits, in robust standard deviations.
	readonly sigmaLow: number
	readonly sigmaHigh: number
	// Most rejection passes per pixel.
	readonly maxIterations: number
	// Id of the master that corrects a flat, as text; empty for none.
	readonly correction: string
	// Whether what asks for a review is accepted.
	readonly acknowledged: boolean
}

// Starting recipe of a group.
const DEFAULT_FORM: RecipeForm = { kind: 'dark', method: 'sigmaClip', sigmaLow: 3, sigmaHigh: 3, maxIterations: 5, correction: '', acknowledged: false }

// Roles a master of dark frames can be built as: a dark, or a dark-flat of darks taken at the exposure of the flats.
const DARK_MASTER_KINDS = ['dark', 'darkFlat'] as const satisfies readonly CalibrationKind[]

// Role a master of dark frames is built as.
type DarkMasterKind = (typeof DARK_MASTER_KINDS)[number]

// Choice of the group, master, or frame shown in the panel.
type Selection = { readonly type: 'group'; readonly groupId: string } | { readonly type: 'master'; readonly masterId: number } | { readonly type: 'source'; readonly sourceId: string }

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
		else void loadCalibrationMasters(state, filter, page)
	}, [section, kind, camera, search, page, runtime.changes])

	// Fetches what the panel shows, again whenever the server reports a change.
	useEffect(() => {
		const state = calibrationLibraryRuntime
		void loadCalibrationGroup(state, selection?.type === 'group' ? selection.groupId : undefined)
		void loadCalibrationMaster(state, selection?.type === 'master' ? selection.masterId : undefined)
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

	// Forgets what was deleted, and the link to its group.
	function deselect() {
		setSelection(undefined)
		if (linked !== undefined) navigate(routeState, { workspace: 'tools', tool: 'calibration-library' })
	}

	const cameras = ['', ...(runtime.summary?.cameras ?? [])]
	const panel = selection && <SelectionPanel selection={selection} onGroup={selectGroup} onDeleted={deselect} />

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
				{runtime.errors.refresh && <Notice error>{runtime.errors.refresh}</Notice>}
				<div className="flex flex-wrap items-end gap-3">
					<SegmentedControl options={LIBRARY_SECTIONS} value={section} format={(option) => SECTION_LABELS[option]} onChange={change(setSection)} />
					<Select label="Frame Type" className="w-36" options={KIND_FILTERS} value={kind} format={(option) => (option === 'all' ? 'All Types' : KIND_LABELS[option])} onChange={change(setKind)} />
					<Select label="Camera" className="w-52" options={cameras} value={camera} format={(option) => option || 'All Cameras'} onChange={change(setCamera)} />
					{section === 'frames' && <TextInput label="Search" className="w-52" value={search} onChange={(event) => change(setSearch)(event.target.value)} />}
				</div>
				{section === 'library' && <GroupsView selected={selection?.type === 'group' ? selection.groupId : undefined} onSelect={selectGroup} />}
				{section === 'frames' && <FramesView selected={selection?.type === 'source' ? selection.sourceId : undefined} onSelect={(sourceId) => select({ type: 'source', sourceId })} />}
				{section === 'masters' && <MastersView selection={selection} onSelect={(masterId) => select({ type: 'master', masterId })} />}
				<Pager page={page} total={pageTotal(section)} loading={runtime.loading} onPage={setPage} />
			</div>
			{importing && <ImportDialog onClose={() => setImporting(false)} />}
		</WorkspaceLayout>
	)
}

// Rows of the list a section shows.
function pageTotal(section: LibrarySection) {
	const { groups, sources, masters } = calibrationLibraryRuntime
	return (section === 'library' ? groups : section === 'frames' ? sources : masters)?.total ?? 0
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
			<Table headers={['Type', 'Group', 'Camera', 'Settings', 'Frames', 'State', 'Latest Master']}>
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
						<Cell>{group.masters[0] ? masterName(group.masters[0]) : MISSING}</Cell>
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
							{kinds[kind].groups === 0 ? MISSING : `${kinds[kind].masters}/${kinds[kind].groups}`}
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
					<Cell>{!source.excluded ? <StatusBadge tone={SOURCE_STATUS_TONES[source.status]} label={SOURCE_STATUS_LABELS[source.status]} /> : <StatusBadge tone="muted" label="Left Out" />}</Cell>
				</Row>
			))}
		</Table>
	)
}

// List of masters, newest first.
function MastersView({ selection, onSelect }: { readonly selection?: Selection; readonly onSelect: (masterId: number) => void }) {
	const { masters } = useSnapshot(calibrationLibraryRuntime)
	const items = (masters?.items ?? []) as readonly CalibrationMasterSummary[]

	if (items.length === 0) return <EmptyState title="No masters" description="Build one from a group of the Library." />

	return (
		<Table headers={['Master', 'Type', 'Group', 'Camera', 'Frames', 'Method', 'Contents', 'State']}>
			{items.map((master) => (
				<Row key={master.masterId} selected={selection?.type === 'master' && selection.masterId === master.masterId} onClick={() => onSelect(master.masterId)}>
					<Cell>{masterName(master)}</Cell>
					<Cell>{KIND_LABELS[master.kind]}</Cell>
					<Cell>{groupTitle(master)}</Cell>
					<Cell>{cameraText(master.metadata)}</Cell>
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

// Panel of what is selected; onDeleted runs once what it shows was deleted.
function SelectionPanel({ selection, onGroup, onDeleted }: { readonly selection: Selection; readonly onGroup: (groupId: string) => void; readonly onDeleted: () => void }) {
	if (selection.type === 'group') return <GroupPanel onDeleted={onDeleted} />
	if (selection.type === 'master') return <MasterPanel onGroup={onGroup} onDeleted={onDeleted} />
	return <SourcePanel onDeleted={onDeleted} />
}

// Opens a file of the server in Images.
function openInImages(path: string) {
	void openImage(imagesState, path)
	navigate(routeState, { workspace: 'images' })
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

// Group, why it is in its state, its build form, and its deletion.
function GroupPanel({ onDeleted }: { readonly onDeleted: () => void }) {
	const { group, jobs, pending, errors } = useSnapshot(calibrationLibraryRuntime)
	if (!group) return <p className="m-0 p-4 text-xs text-ink-300">Loading…</p>

	const key = `delete:${group.groupId}`
	const job = latestGroupJob(jobs, group.groupId)
	const building = job !== undefined && !jobEnded(job)

	async function remove(groupId: string) {
		if (await deleteCalibrationGroup(calibrationLibraryRuntime, groupId)) onDeleted()
	}

	return (
		<>
			<CollapsibleSection id="calibration.group" title={`${KIND_LABELS[group.kind]} · ${groupTitle(group)}`}>
				<StatusBadge tone={READINESS_TONES[group.readiness]} label={READINESS_LABELS[group.readiness]} />
				<DataRow label="Camera">{cameraText(group.metadata)}</DataRow>
				<DataRow label="Settings">{settingsText(group.metadata)}</DataRow>
				<DataRow label="Frames">{group.required === undefined ? `${group.usable} usable of ${group.total}` : `${group.usable} usable, ${group.required} planned`}</DataRow>
				<Findings findings={group.findings} />
				{group.readiness === 'needsReview' && (
					<Notice>
						Needs Review: what is listed in yellow cannot be verified from the files. To build a master anyway, check that you accept it in Build Master; the master records what you accepted. A value the files leave out can instead be declared on each frame in Frames, which is then reported as declared by
						you.
					</Notice>
				)}
				{errors[key] && <Notice error>{errors[key]}</Notice>}
				<Actions>
					<ConfirmButton title="Delete this group?" message={`The files of its ${group.total} frames are deleted from the disk, wherever they are, and leave the library. Its masters stay.`} confirmLabel="Delete" disabled={building || pending[key] === true} onConfirm={() => void remove(group.groupId)}>
						Delete Group
					</ConfirmButton>
				</Actions>
			</CollapsibleSection>
			<CollapsibleSection id="calibration.build" title="Build Master">
				<BuildForm key={group.groupId} groupId={group.groupId} kind={group.kind} shown={group.findings} />
			</CollapsibleSection>
			{group.masters.length > 0 && (
				<CollapsibleSection id="calibration.masters" title="Masters">
					{group.masters.map((master) => (
						<div key={master.masterId} className="flex items-center gap-2 text-xs text-ink-200 tabular-nums">
							<span>{`${masterName(master)} · ${master.frames} frames · ${METHOD_LABELS[master.method]}`}</span>
							<StatusBadge tone={PRODUCT_STATUS_TONES[master.status]} label={PRODUCT_STATUS_LABELS[master.status]} />
						</div>
					))}
				</CollapsibleSection>
			)}
		</>
	)
}

// Recipe of a master, which the server explains as it changes.
// shown is what the group section already lists, so only what the recipe itself adds is listed here.
function BuildForm({ groupId, kind, shown }: { readonly groupId: string; readonly kind: CalibrationKind; readonly shown: readonly CompatibilityFinding[] }) {
	const { pending, errors, masters, changes, jobs } = useSnapshot(calibrationLibraryRuntime)
	const [form, setForm] = useState<RecipeForm>(DEFAULT_FORM)
	const [validation, setValidation] = useState<RecipeValidation>()
	const [corrections, setCorrections] = useState<readonly CalibrationMasterSummary[]>([])
	const key = `group:${groupId}`
	const edit = (patch: Partial<RecipeForm>) => setForm({ ...form, ...patch })
	void masters

	const request = (): MasterRequest => ({ groupId, ...(kind === 'dark' && { kind: form.kind }), recipe: { method: form.method, sigmaLow: form.sigmaLow, sigmaHigh: form.sigmaHigh, maxIterations: form.maxIterations }, correction: form.correction ? Number(form.correction) : undefined, acknowledged: form.acknowledged })

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

		void loadFlatCorrections().then((masters) => {
			if (current) setCorrections(masters)
		})

		return () => {
			current = false
		}
	}, [kind, changes])

	const options = ['', ...corrections.map(({ masterId }) => String(masterId))]

	function correctionLabel(option: string) {
		const master = corrections.find(({ masterId }) => String(masterId) === option)
		return master ? `${KIND_LABELS[master.kind]} ${masterName(master)} · ${exposureText(master.metadata)}` : 'None'
	}

	const reason = validation?.findings.find(({ severity }) => severity === 'blocker')?.message
	// Findings of the recipe the group section does not list, such as those of a flat's correction.
	const added = validation?.findings.filter((finding) => !shown.some(({ field, code, message }) => field === finding.field && code === finding.code && message === finding.message)) ?? []
	// The latest build of the group, wherever it was asked for, keeps the button busy until it ends and explains a failure.
	const job = latestGroupJob(jobs, groupId)
	const building = job !== undefined && !jobEnded(job)
	const requesting = pending[key] === true
	const failure = job?.state === 'failed' ? job.error : undefined

	return (
		<>
			{kind === 'dark' && <SegmentedControl label="Master" options={DARK_MASTER_KINDS} value={form.kind} format={(option) => KIND_LABELS[option]} onChange={(next) => edit({ kind: next })} />}
			{kind === 'dark' && form.kind === 'darkFlat' && <Notice>A dark-flat corrects flats taken at its exposure, so build one only from darks taken at the exposure of your flats.</Notice>}
			<Select label="Combination" options={RECIPE_METHODS} value={form.method} format={(option) => METHOD_LABELS[option]} onChange={(method) => edit({ method })} />
			{form.method === 'sigmaClip' && (
				<div className="flex flex-col gap-2">
					<NumberInput label="Low σ" value={form.sigmaLow} min={1} max={10} step={0.5} onChange={(sigmaLow) => edit({ sigmaLow })} />
					<NumberInput label="High σ" value={form.sigmaHigh} min={1} max={10} step={0.5} onChange={(sigmaHigh) => edit({ sigmaHigh })} />
					<NumberInput label="Passes" value={form.maxIterations} min={1} max={20} onChange={(maxIterations) => edit({ maxIterations })} />
				</div>
			)}
			{kind === 'flat' && <Select label="Correction" className="min-w-0" options={options} value={form.correction} format={correctionLabel} onChange={(correction) => edit({ correction })} />}
			{added.length > 0 && <Findings findings={added} />}
			{validation?.needsAcknowledgement && <Checkbox label="I reviewed the warnings and accept them" checked={form.acknowledged} onChange={(acknowledged) => edit({ acknowledged })} />}
			{validation !== undefined && validation.spillBytes > 0 && <Notice>{`Needs about ${bytesText(validation.spillBytes)} of temporary disk.`}</Notice>}
			{errors[key] && <Notice error>{errors[key]}</Notice>}
			{failure && !building && <Notice error>{`The last build failed: ${failure}`}</Notice>}
			<Button disabled={building || requesting || !validation?.valid} title={reason} onClick={() => void buildMaster(calibrationLibraryRuntime, key, request())}>
				{(building || requesting) && <span className="size-3.5 flex-none animate-spin rounded-full border-2 border-current border-t-transparent" />}
				{building ? (job.state === 'queued' ? 'Queued' : `Building ${formatPercent(jobFraction(job))}`) : requesting ? 'Building' : 'Build Master'}
			</Button>
		</>
	)
}

// Value with how it is known.
function EvidencedReadout({ label, value, format = String }: { readonly label: string; readonly value: Evidenced<string | number>; readonly format?: (value: string | number) => string }) {
	return <DataRow label={label}>{value.value === undefined ? 'Unknown' : `${format(value.value)} · ${EVIDENCE_LABELS[value.evidence]}`}</DataRow>
}

// Master, what went in, how to use it, and its deletion.
function MasterPanel({ onGroup, onDeleted }: { readonly onGroup: (groupId: string) => void; readonly onDeleted: () => void }) {
	const { master: snapshot, pending, errors } = useSnapshot(calibrationLibraryRuntime)
	const master = snapshot
	if (!master) return <p className="m-0 p-4 text-xs text-ink-300">Loading…</p>

	const key = `master:${master.masterId}`
	const { diagnostics } = master
	const warnings = masterWarnings(master)

	async function remove(masterId: number) {
		if (await deleteCalibrationMaster(calibrationLibraryRuntime, masterId)) onDeleted()
	}

	return (
		<>
			<CollapsibleSection id="calibration.master" title={`${KIND_LABELS[master.kind]} ${masterName(master)}`}>
				<StatusBadge tone={PRODUCT_STATUS_TONES[master.status]} label={PRODUCT_STATUS_LABELS[master.status]} />
				{warnings.length > 0 && (
					<ul className="m-0 flex list-none flex-col gap-1 p-0">
						{warnings.map((warning) => (
							<li key={warning} className={cn('text-xs leading-4', master.status === 'unavailable' ? 'text-danger' : 'text-warning')}>
								{warning}
							</li>
						))}
					</ul>
				)}
				<DataRow label="Contents">{`${master.calibrationState} · ${master.units}`}</DataRow>
				<Notice>{master.usage}</Notice>
				<Actions>
					<Button disabled={master.status === 'unavailable'} onClick={() => openInImages(master.path)}>
						Open in Images
					</Button>
					<Button variant="secondary" onClick={() => onGroup(master.groupId)}>
						Open Group
					</Button>
					<ConfirmButton title={`Delete master #${master.masterId}?`} message="Its file is deleted from the disk, and its id is never used again. A master that was corrected by it must be deleted first." confirmLabel="Delete" disabled={pending[key] === true} onConfirm={() => void remove(master.masterId)}>
						Delete
					</ConfirmButton>
				</Actions>
				{errors[key] && <Notice error>{errors[key]}</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="calibration.diagnostics" title="Integration">
				<DataRow label="Frames">{`${diagnostics.integratedFrames} of ${diagnostics.requestedFrames}`}</DataRow>
				<DataRow label="Method">{METHOD_LABELS[diagnostics.method]}</DataRow>
				<DataRow label="Rejected Samples">{`${diagnostics.rejectedLow} low, ${diagnostics.rejectedHigh} high`}</DataRow>
				{diagnostics.hotPixels !== undefined && <DataRow label="Hot Pixels">{diagnostics.hotPixels}</DataRow>}
				{diagnostics.invalidResponsePixels !== undefined && <DataRow label="Invalid Response">{diagnostics.invalidResponsePixels}</DataRow>}
				{diagnostics.planes.map(({ plane, median, sigma }) => (
					<DataRow key={plane} label={`Plane ${plane + 1}`}>{`${median.toFixed(master.units === 'DN' ? 1 : 4)} ± ${sigma.toFixed(master.units === 'DN' ? 1 : 4)}`}</DataRow>
				))}
				{diagnostics.excludedFrames?.map(({ sourceId, reason }) => (
					<Notice key={sourceId}>{`A frame was left out: ${reason}`}</Notice>
				))}
			</CollapsibleSection>
			<CollapsibleSection id="calibration.lineage" title="Provenance" defaultOpen={false}>
				{master.dependencies.map(({ masterId }) => (
					<DataRow key={masterId} label="Corrected by">{`#${masterId}`}</DataRow>
				))}
				<DataRow label="Published">{new Date(master.createdAt).toLocaleString()}</DataRow>
				<DataRow label="SHA-256">
					<span className="break-all">{master.contentDigest}</span>
				</DataRow>
				{master.sourceNames.map((name) => (
					<p key={name} className="m-0 text-xs text-ink-300">
						{name}
					</p>
				))}
			</CollapsibleSection>
		</>
	)
}

// Frame, with how each value is known, what an operator may state about it, and its deletion, whose failure the review shows.
function SourcePanel({ onDeleted }: { readonly onDeleted: () => void }) {
	const { source: snapshot, pending } = useSnapshot(calibrationLibraryRuntime)
	const source = snapshot
	if (!source) return <p className="m-0 p-4 text-xs text-ink-300">Loading…</p>
	const { metadata } = source

	async function remove(sourceId: string) {
		if (await deleteCalibrationSource(calibrationLibraryRuntime, sourceId)) onDeleted()
	}

	return (
		<>
			<CollapsibleSection id="calibration.source" title="Frame">
				<StatusBadge tone={SOURCE_STATUS_TONES[source.status]} label={SOURCE_STATUS_LABELS[source.status]} />
				<DataRow label="Path">
					<span className="break-all">{source.path}</span>
				</DataRow>
				<Actions>
					<Button disabled={source.status === 'missing'} onClick={() => openInImages(source.path)}>
						Open in Images
					</Button>
					<ConfirmButton title="Delete this frame?" message="Its file is deleted from the disk, wherever it is, and the frame leaves the library. Masters made with it stay." confirmLabel="Delete" disabled={pending[`source:${source.sourceId}`] === true} onConfirm={() => void remove(source.sourceId)}>
						Delete
					</ConfirmButton>
				</Actions>
				<DataRow label="Size">{bytesText(source.bytes)}</DataRow>
				<DataRow label="Image">{`${metadata.width}×${metadata.height}×${metadata.channels}, BITPIX ${metadata.bitpix}${metadata.cfa ? `, ${metadata.cfa}` : ''}`}</DataRow>
				<DataRow label="Camera">{cameraText(metadata)}</DataRow>
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

// Declares an unknown value or leaves a frame out.
function ReviewForm({ source }: { readonly source: CalibrationSource }) {
	const { pending, errors } = useSnapshot(calibrationLibraryRuntime)
	const fields = (Object.keys(OVERRIDE_LABELS) as OverridableField[]).filter((field) => source.metadata[field].evidence === 'unknown')
	const [field, setField] = useState<OverridableField | undefined>(fields[0])
	const [value, setValue] = useState('')
	const key = `source:${source.sourceId}`

	function declare() {
		if (field) void overrideCalibrationSource(calibrationLibraryRuntime, source.sourceId, field, overrideIsText(field) ? value : Number(value))
	}

	return (
		<>
			{field && <Select label="Field" options={fields} value={field} format={(option) => OVERRIDE_LABELS[option]} onChange={setField} />}
			{field && <TextInput label="Value" value={value} onChange={(event) => setValue(event.target.value)} />}
			{errors[key] && <Notice error>{errors[key]}</Notice>}
			<Actions>
				{field && (
					<Button variant="secondary" disabled={!value || pending[key] === true} onClick={declare}>
						Declare Value
					</Button>
				)}
				<Button variant="secondary" disabled={pending[key] === true} onClick={() => void excludeCalibrationSource(calibrationLibraryRuntime, source.sourceId, !source.excluded)}>
					{source.excluded ? 'Include Again' : 'Leave Out'}
				</Button>
			</Actions>
		</>
	)
}

// Chooses directories and files of the server, several at a time, scans them, and reviews what was found. Both choosers
// start in the directory listed last.
function ImportDialog({ onClose }: { readonly onClose: () => void }) {
	const { pending, errors } = useSnapshot(calibrationLibraryRuntime)
	const profiles = useSnapshot(profileState)
	const [paths, setPaths] = useState<readonly string[]>([])
	const [recursive, setRecursive] = useState(true)
	const [choosing, setChoosing] = useState<'directory' | 'open'>()
	const [jobId, setJobId] = useState<string>()
	const lastDirectory = activeProfile(profiles).settings.lastCalibrationDirectory

	// Adds chosen directories or files to where the import looks, each once, and remembers the directory listed.
	function add(chosen: readonly string[], directory: string) {
		setChoosing(undefined)
		setPaths([...paths, ...chosen.filter((path) => !paths.includes(path))])
		setLastCalibrationDirectory(profileState, directory)
	}

	async function start() {
		const job = await startCalibrationImport(calibrationLibraryRuntime, paths, recursive)
		if (job) setJobId(job.jobId)
	}

	return (
		<Modal open title="Import Calibration Frames" fit className="w-full max-w-4xl" onClose={onClose}>
			{jobId === undefined ? (
				<div className="flex min-h-0 flex-col gap-3">
					<Notice>Choose directories or files of this server. Their roles come from their headers, never from their names.</Notice>
					{paths.length > 0 && (
						<div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
							{paths.map((path) => (
								<div key={path} className="flex items-center gap-2 text-xs text-ink-200">
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
					<Actions>
						<Button disabled={paths.length === 0 || pending.import === true} onClick={() => void start()}>
							Open
						</Button>
					</Actions>
				</div>
			) : (
				<ImportReview jobId={jobId} onClose={onClose} />
			)}
			<FileExplorerModal open={choosing === 'directory'} title="Add Directory" mode="directory" initialPath={lastDirectory} onChoose={(path, directory) => add([path], directory)} onClose={() => setChoosing(undefined)} />
			<FileExplorerModal open={choosing === 'open'} title="Add Files" mode="open" multiple initialPath={lastDirectory} extensions={IMAGE_EXTENSIONS} onChoose={add} onClose={() => setChoosing(undefined)} />
		</Modal>
	)
}

// Review of what an import found, inside its dialog: nothing enters the library until it is committed, which closes it.
function ImportReview({ jobId, onClose }: { readonly jobId: string; readonly onClose: () => void }) {
	const { jobs, pending, errors } = useSnapshot(calibrationLibraryRuntime)
	const job = jobs[jobId]
	const ended = job !== undefined && jobEnded(job)
	const [page, setPage] = useState<Page<ImportCandidate>>()
	const [declared, setDeclared] = useState<Readonly<Record<string, CalibrationKind>>>({})
	const [copy, setCopy] = useState(false)

	// Fetches what was found once the scan ended.
	useEffect(() => {
		if (job?.state === 'completed' && !page) void loadImportCandidates(jobId, 0).then(setPage)
	}, [job?.state, jobId, page])

	async function commit() {
		const answer = await commitCalibrationImport(calibrationLibraryRuntime, jobId, { classifications: declared, copy })
		if (answer) onClose()
	}

	const items = page?.items ?? []
	const ready = items.filter(({ path, kind, rejectedRole, error, known }) => (kind ?? declared[path]) !== undefined && !rejectedRole && !error && !known).length

	return (
		<div className="flex min-h-0 flex-col gap-3">
			{!ended && (
				<div className="flex items-center gap-3">
					<Notice>{`Reading headers · ${job?.found ?? 0} files · ${bytesText(job?.bytes ?? 0)}`}</Notice>
					<Button variant="secondary" onClick={() => void cancelCalibrationImport(calibrationLibraryRuntime, jobId)}>
						Cancel
					</Button>
				</div>
			)}
			{job?.error && <Notice error>{job.error}</Notice>}
			{job?.truncated && <Notice error>The limit of files was reached; only part of these directories was read.</Notice>}
			{page && (
				<>
					<Notice>{`${page.total} files found, ${ready} ready. Frames are referenced where they are and never changed.`}</Notice>
					<Table headers={['File', 'Found', 'Exposure', 'Declared Type', 'Notes']}>
						{items.map((candidate) => (
							<tr key={candidate.path} className="border-b border-line-100 last:border-b-0">
								<Cell>{candidate.name}</Cell>
								<Cell>{candidate.kind ? KIND_LABELS[candidate.kind] : (candidate.rejectedRole ?? 'Unknown')}</Cell>
								<Cell>{candidate.metadata ? exposureText(candidate.metadata) : MISSING}</Cell>
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
					<Checkbox label="Copy into the library" checked={copy} onChange={setCopy} />
					{errors.import && <Notice error>{errors.import}</Notice>}
					<Actions>
						<Button disabled={ready === 0 || pending.import === true} onClick={() => void commit()}>
							{`Add ${ready} Frames`}
						</Button>
					</Actions>
				</>
			)}
			{ended && !page && (
				<Actions>
					<Button variant="secondary" onClick={onClose}>
						Close
					</Button>
				</Actions>
			)}
		</div>
	)
}
