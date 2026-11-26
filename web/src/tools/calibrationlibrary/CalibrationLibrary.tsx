import type { CalibrationGroupSummary, CalibrationJobSummary, CalibrationKind, CalibrationMasterSummary, CalibrationSource, CalibrationSourceSummary, CompatibilityFinding, Evidenced, ImportCandidatePage, MasterRequest, OverridableField, RecipeValidation } from 'api'
import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import {
	buildMaster,
	CALIBRATION_PAGE_SIZE,
	calibrationLibraryRuntime,
	calibrationLibraryView,
	cancelCalibrationBuild,
	cancelCalibrationImport,
	commitCalibrationImport,
	deleteCalibrationGroup,
	deleteCalibrationMaster,
	deleteCalibrationSource,
	excludeCalibrationSource,
	groupDeletionKey,
	jobEnded,
	latestGroupJob,
	loadCalibrationGroup,
	loadCalibrationGroups,
	loadCalibrationMaster,
	loadCalibrationMasters,
	loadCalibrationSource,
	loadCalibrationSources,
	loadFlatCorrections,
	loadImportCandidates,
	masterDeletionKey,
	overrideCalibrationSource,
	refreshCalibrationFiles,
	sourceDeletionKey,
	startCalibrationImport,
	validateRecipe,
} from '../../calibrationlibrary/calibrationlibrary'
import { cameraBindingsState, type CatalogCamera, catalogCameraName, catalogState, suggestedCameraId } from '../../equipment/catalog'
import { FileExplorerModal } from '../../files/FileExplorerModal'
import { IMAGE_EXTENSIONS } from '../../files/files'
import { formatByteSize, formatCount, formatExposureTime, formatFixed, formatPercent, formatTemperature, formatZonedDateTime, MISSING } from '../../format'
import { imagesState, openImage } from '../../images/images'
import { useActiveTimeZone } from '../../location/useLocation'
import { activeProfile, profileState, setLastCalibrationDirectory } from '../../profile/profile'
import { CollapsibleSection, LoadingSection } from '../../shell/CollapsibleSection'
import { navigate, routeState } from '../../shell/route'
import { EmptyState, useWorkspacePanel, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataRow } from '../../ui/DataRow'
import { Modal, ModalActions } from '../../ui/Modal'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { Pager } from '../../ui/Pager'
import { ProgressBar } from '../../ui/ProgressBar'
import { SectionHeading } from '../../ui/SectionHeading'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table, type TableColumn } from '../../ui/Table'
import { TextInput } from '../../ui/TextInput'
import {
	CALIBRATION_KINDS,
	CALIBRATION_STATE_LABELS,
	cameraText,
	coverage,
	EVIDENCE_LABELS,
	exposureText,
	groupTitle,
	jobFraction,
	KIND_FILTERS,
	KIND_LABELS,
	type KindFilter,
	LIBRARY_SECTIONS,
	type LibrarySection,
	masterName,
	masterWarnings,
	METHOD_LABELS,
	ORIGIN_LABELS,
	OVERRIDE_LABELS,
	overrideValue,
	PRODUCT_STATUS_LABELS,
	PRODUCT_STATUS_TONES,
	READINESS_LABELS,
	READINESS_TONES,
	RECIPE_METHODS,
	SECTION_LABELS,
	SECTION_LISTS,
	settingsText,
	SOURCE_STATUS_LABELS,
	SOURCE_STATUS_TONES,
	temperatureText,
} from './library'

// Calibration Library tool: what calibration frames exist, what can be combined and why not, and which masters were made. It
// works with no camera and starts no exposure; every capture stays in Images. State lives on the server, so a reload, another
// tab, or a wizard show the same builds. A master is built from the group it belongs to, whose form follows its build, and
// every build makes a new master, told apart by its id and date, and can be cancelled until it publishes. Removing a frame or
// a group, after a confirmation, takes it out of the library and deletes its files only when the operator asks, as this
// browser remembers; deleting a master takes its file. Every frame and master is recorded against a camera of the Equipment Catalog, which an
// import asks for, the filters and lists name, and the coverage groups by.

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

// Classes of a column a phone leaves out, so the name and the state of each row stay on screen.
const WIDE_ONLY = 'max-sm:hidden'

// Column a phone leaves out.
function wide(label: string): TableColumn {
	return { key: label, label, className: WIDE_ONLY }
}

// Calibration Library tool.
export function CalibrationLibrary() {
	const runtime = useSnapshot(calibrationLibraryRuntime)
	const route = useSnapshot(routeState).route
	const linked = route.workspace === 'tools' ? route.group : undefined
	const [section, setSection] = useState<LibrarySection>('library')
	const [kind, setKind] = useState<KindFilter>('all')
	const [cameraId, setCameraId] = useState('')
	const { cameras: catalog } = useSnapshot(catalogState)
	const [search, setSearch] = useState('')
	const [page, setPage] = useState(0)
	const [selection, setSelection] = useState<Selection | undefined>(linked ? { type: 'group', groupId: linked } : undefined)
	const [importing, setImporting] = useState(false)
	const filter = { kind: kind === 'all' ? undefined : kind, cameraId: cameraId || undefined, search: search || undefined }
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
	}, [section, kind, cameraId, search, page, runtime.changes])

	// Fetches what the panel shows, again whenever the server reports a change, and stops showing a record the server no
	// longer knows, as after another tab, a wizard, or a stale link.
	useEffect(() => {
		const state = calibrationLibraryRuntime
		const forget = (gone: boolean) => gone && deselect()
		void loadCalibrationGroup(state, selection?.type === 'group' ? selection.groupId : undefined).then(forget)
		void loadCalibrationMaster(state, selection?.type === 'master' ? selection.masterId : undefined).then(forget)
		void loadCalibrationSource(state, selection?.type === 'source' ? selection.sourceId : undefined).then(forget)
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

	// Forgets what was deleted, here or elsewhere, and the link to its group.
	function deselect() {
		setSelection(undefined)
		if (linked !== undefined) navigate(routeState, { workspace: 'tools', tool: 'calibration-library' })
	}

	// Every camera of the catalog, and any other camera the library records something against.
	const cameras = ['', ...new Set([...catalog.map(({ id }) => id), ...(runtime.summary?.cameras ?? []).map((usage) => usage.cameraId)])]
	// Whether a filter narrows the lists, which tells an empty page from an empty library.
	const filtered = kind !== 'all' || cameraId !== ''
	const selectMaster = (masterId: number) => select({ type: 'master', masterId })
	const panel = selection && <SelectionPanel selection={selection} onGroup={selectGroup} onMaster={selectMaster} onDeleted={deselect} />

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
					<Select label="Frame Type" className="w-36 flex-none" options={KIND_FILTERS} value={kind} format={(option) => (option === 'all' ? 'All Types' : KIND_LABELS[option])} onChange={change(setKind)} />
					<Select label="Camera" className="w-52 flex-none" options={cameras} value={cameraId} format={(option) => (option ? catalogCameraName(catalog, option) : 'All Cameras')} onChange={change(setCameraId)} />
					{section === 'frames' && <TextInput label="Search" className="w-52 flex-none" value={search} onChange={(event) => change(setSearch)(event.target.value)} />}
				</div>
				{section === 'library' && <GroupsView filtered={filtered} selected={selection?.type === 'group' ? selection.groupId : undefined} onSelect={selectGroup} />}
				{section === 'frames' && <FramesView selected={selection?.type === 'source' ? selection.sourceId : undefined} onSelect={(sourceId) => select({ type: 'source', sourceId })} />}
				{section === 'masters' && <MastersView filtered={filtered} selection={selection} onSelect={selectMaster} />}
				<Pager page={page} total={pageTotal(section)} pageSize={CALIBRATION_PAGE_SIZE} noun="rows" loading={runtime.loading[SECTION_LISTS[section]] === true} onPage={setPage} />
			</div>
			{importing && <ImportDialog onClose={() => setImporting(false)} />}
		</WorkspaceLayout>
	)
}

// Rows of the list a section shows.
function pageTotal(section: LibrarySection) {
	return calibrationLibraryRuntime[SECTION_LISTS[section]]?.total ?? 0
}

// Coverage and groups; filtered says whether a filter narrows them.
function GroupsView({ filtered, selected, onSelect }: { readonly filtered: boolean; readonly selected?: string; readonly onSelect: (groupId: string) => void }) {
	const timeZone = useActiveTimeZone()
	const { groups, summary } = useSnapshot(calibrationLibraryRuntime)
	const { cameras } = useSnapshot(catalogState)
	const items = (groups?.items ?? []) as readonly CalibrationGroupSummary[]

	if (items.length === 0) {
		if (filtered) return <EmptyState title="No groups" description="Nothing matches these filters." />
		return <EmptyState title="No calibration frames" description="Finish a Dark Library plan or a Flat Wizard session in Images, or import a directory of FITS or XISF frames." />
	}

	return (
		<>
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<SectionHeading as="h2">Coverage</SectionHeading>
				<p className="m-0 text-xs text-ink-200 tabular-nums">{`${formatCount(summary?.frames.available ?? 0)} frames available · ${formatCount((summary?.masters.ready ?? 0) + (summary?.masters.warning ?? 0))} usable masters`}</p>
			</div>
			<Coverage groups={items} cameras={cameras} />
			<SectionHeading as="h2" className="mt-2">
				Groups
			</SectionHeading>
			<Table columns={['Type', 'Group', wide('Camera'), wide('Settings'), 'Frames', 'State', 'Latest Master']}>
				{items.map((group) => (
					<Row key={group.groupId} selected={group.groupId === selected} onSelect={() => onSelect(group.groupId)}>
						<Cell>{KIND_LABELS[group.kind]}</Cell>
						<Cell>{groupTitle(group)}</Cell>
						<Cell className={WIDE_ONLY}>{cameraText(group.metadata, cameras)}</Cell>
						<Cell className={WIDE_ONLY}>{settingsText(group.metadata)}</Cell>
						<Cell>{group.required === undefined ? group.usable : `${group.usable}/${group.required}`}</Cell>
						<Cell>
							<StatusBadge tone={READINESS_TONES[group.readiness]} label={READINESS_LABELS[group.readiness]} />
						</Cell>
						<Cell>{group.masters[0] ? masterName(group.masters[0], timeZone) : MISSING}</Cell>
					</Row>
				))}
			</Table>
		</>
	)
}

// Which roles have masters, per camera of the Equipment Catalog and operating point: each role reads the groups with a
// usable master of it over the groups that serve it, in the warning tone while some lack one.
function Coverage({ groups, cameras }: { readonly groups: readonly CalibrationGroupSummary[]; readonly cameras: readonly CatalogCamera[] }) {
	return (
		<Table className="shrink-0" columns={['Camera', wide('Settings'), ...CALIBRATION_KINDS.map((kind) => KIND_LABELS[kind])]}>
			{coverage(groups, cameras).map(({ key, camera, settings, kinds }) => (
				<Row key={key}>
					<Cell title={settings}>{camera}</Cell>
					<Cell className={WIDE_ONLY}>{settings}</Cell>
					{CALIBRATION_KINDS.map((kind) => (
						<Cell key={kind} title={kinds[kind].groups === 0 ? `No ${KIND_LABELS[kind].toLowerCase()} group` : `${kinds[kind].masters} of ${kinds[kind].groups} groups have a usable master`} className={kinds[kind].groups > 0 && kinds[kind].masters < kinds[kind].groups ? 'text-warning' : undefined}>
							{kinds[kind].groups === 0 ? MISSING : `${kinds[kind].masters}/${kinds[kind].groups}`}
						</Cell>
					))}
				</Row>
			))}
		</Table>
	)
}

// List of frames.
function FramesView({ selected, onSelect }: { readonly selected?: string; readonly onSelect: (sourceId: string) => void }) {
	const { sources } = useSnapshot(calibrationLibraryRuntime)
	const { cameras } = useSnapshot(catalogState)
	const items = (sources?.items ?? []) as readonly CalibrationSourceSummary[]

	if (items.length === 0) return <EmptyState title="No frames" description="Nothing matches these filters." />

	return (
		<Table columns={['File', 'Type', wide('Camera'), 'Exposure', 'Temperature', wide('Settings'), wide('Origin'), 'State']}>
			{items.map((source) => (
				<Row key={source.sourceId} selected={source.sourceId === selected} onSelect={() => onSelect(source.sourceId)}>
					<Cell>{source.name}</Cell>
					<Cell>{KIND_LABELS[source.kind]}</Cell>
					<Cell className={WIDE_ONLY}>{catalogCameraName(cameras, source.metadata.cameraId)}</Cell>
					<Cell>{exposureText(source.metadata)}</Cell>
					<Cell>{temperatureText(source.metadata)}</Cell>
					<Cell className={WIDE_ONLY}>{settingsText(source.metadata)}</Cell>
					<Cell className={WIDE_ONLY}>{ORIGIN_LABELS[source.origin]}</Cell>
					<Cell>{!source.excluded ? <StatusBadge tone={SOURCE_STATUS_TONES[source.status]} label={SOURCE_STATUS_LABELS[source.status]} /> : <StatusBadge tone="muted" label="Left Out" />}</Cell>
				</Row>
			))}
		</Table>
	)
}

// List of masters, newest first; filtered says whether a filter narrows it.
function MastersView({ filtered, selection, onSelect }: { readonly filtered: boolean; readonly selection?: Selection; readonly onSelect: (masterId: number) => void }) {
	const timeZone = useActiveTimeZone()
	const { masters } = useSnapshot(calibrationLibraryRuntime)
	const { cameras } = useSnapshot(catalogState)
	const items = (masters?.items ?? []) as readonly CalibrationMasterSummary[]

	if (items.length === 0) return <EmptyState title="No masters" description={filtered ? 'Nothing matches these filters.' : 'Build one from a group of the Library.'} />

	return (
		<Table columns={['Master', 'Type', 'Group', wide('Camera'), 'Frames', wide('Method'), wide('Contents'), 'State']}>
			{items.map((master) => (
				<Row key={master.masterId} selected={selection?.type === 'master' && selection.masterId === master.masterId} onSelect={() => onSelect(master.masterId)}>
					<Cell>{masterName(master, timeZone)}</Cell>
					<Cell>{KIND_LABELS[master.kind]}</Cell>
					<Cell>{groupTitle(master)}</Cell>
					<Cell className={WIDE_ONLY}>{cameraText(master.metadata, cameras)}</Cell>
					<Cell>{master.frames}</Cell>
					<Cell className={WIDE_ONLY}>{METHOD_LABELS[master.method]}</Cell>
					<Cell className={WIDE_ONLY}>{CALIBRATION_STATE_LABELS[master.calibrationState]}</Cell>
					<Cell>
						<StatusBadge tone={PRODUCT_STATUS_TONES[master.status]} label={PRODUCT_STATUS_LABELS[master.status]} />
					</Cell>
				</Row>
			))}
		</Table>
	)
}

// Panel of what is selected; onGroup and onMaster show another group or master, and onDeleted runs once what it shows was
// deleted.
function SelectionPanel({ selection, onGroup, onMaster, onDeleted }: { readonly selection: Selection; readonly onGroup: (groupId: string) => void; readonly onMaster: (masterId: number) => void; readonly onDeleted: () => void }) {
	if (selection.type === 'group') return <GroupPanel onMaster={onMaster} onDeleted={onDeleted} />
	if (selection.type === 'master') return <MasterPanel onGroup={onGroup} onDeleted={onDeleted} />
	return <SourcePanel onDeleted={onDeleted} />
}

// Opens a file of the server in Images.
function openInImages(path: string) {
	void openImage(imagesState, path)
	navigate(routeState, { workspace: 'images' })
}

// Word that leads a finding that stops or holds a build, so its weight never rests on its colour alone.
const SEVERITY_LABELS: Readonly<Record<Exclude<CompatibilityFinding['severity'], 'notice'>, string>> = { blocker: 'Blocks', review: 'Review' }

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
						{severity !== 'notice' && <span className="font-medium">{`${SEVERITY_LABELS[severity]}: `}</span>}
						{message}
					</li>
				))}
		</ul>
	)
}

// Group, why it is in its state, its build form, its masters (onMaster shows one), and its removal, last.
function GroupPanel({ onMaster, onDeleted }: { readonly onMaster: (masterId: number) => void; readonly onDeleted: () => void }) {
	const timeZone = useActiveTimeZone()
	const { group, jobs, pending, errors } = useSnapshot(calibrationLibraryRuntime)
	const { cameras } = useSnapshot(catalogState)
	if (!group) return <LoadingSection id="calibration.group" title="Group" />

	const key = groupDeletionKey(group.groupId)
	const job = latestGroupJob(jobs, group.groupId)
	const building = job !== undefined && !jobEnded(job)

	// A failed deletion may still have removed part of the group, which its loader skipped while it ran.
	async function remove(groupId: string, files: boolean) {
		if (await deleteCalibrationGroup(calibrationLibraryRuntime, groupId, files)) onDeleted()
		else void loadCalibrationGroup(calibrationLibraryRuntime, groupId)
	}

	return (
		<>
			<CollapsibleSection id="calibration.group" title={`${KIND_LABELS[group.kind]} · ${groupTitle(group)}`}>
				<StatusBadge tone={READINESS_TONES[group.readiness]} label={READINESS_LABELS[group.readiness]} />
				<DataRow label="Camera">{cameraText(group.metadata, cameras)}</DataRow>
				<DataRow label="Settings">{settingsText(group.metadata)}</DataRow>
				<DataRow label="Frames">{group.required === undefined ? `${group.usable} usable of ${group.total}` : `${group.usable} usable, ${group.required} planned`}</DataRow>
				<Findings findings={group.findings} />
				{group.readiness === 'needsReview' && <Notice>What is marked Review cannot be verified from the files. Accept it in Build Master to build anyway, and the master records it; or declare the missing value on each frame in Frames.</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="calibration.build" title="Build Master">
				<BuildForm key={group.groupId} groupId={group.groupId} kind={group.kind} shown={group.findings} onMaster={onMaster} />
			</CollapsibleSection>
			{group.masters.length > 0 && (
				<CollapsibleSection id="calibration.masters" title="Masters">
					<Table columns={['Master', 'Type', 'Frames', 'State']}>
						{group.masters.map((master) => (
							<Row key={master.masterId} title={METHOD_LABELS[master.method]} onSelect={() => onMaster(master.masterId)}>
								<Cell>{masterName(master, timeZone)}</Cell>
								<Cell>{KIND_LABELS[master.kind]}</Cell>
								<Cell>{master.frames}</Cell>
								<Cell>
									<StatusBadge tone={PRODUCT_STATUS_TONES[master.status]} label={PRODUCT_STATUS_LABELS[master.status]} />
								</Cell>
							</Row>
						))}
					</Table>
				</CollapsibleSection>
			)}
			<CollapsibleSection id="calibration.remove" title="Remove" defaultOpen={false}>
				{errors[key] && <Notice error>{errors[key]}</Notice>}
				<Actions>
					<RemoveFramesButton
						title="Remove this group?"
						message={`Its ${formatCount(group.total)} frames leave the library. Its masters stay.`}
						files={`Also delete the files of its ${formatCount(group.total)} frames from the disk, wherever they are`}
						disabled={building || pending[key] === true}
						tooltip={building ? 'A master of this group is being built' : undefined}
						onConfirm={(files) => void remove(group.groupId, files)}
					>
						Remove Group
					</RemoveFramesButton>
				</Actions>
			</CollapsibleSection>
		</>
	)
}

// Button that removes frames from the library once a dialog confirms it, and also deletes their files when its checkbox
// is checked; the checkbox starts unchecked, and this browser remembers it (calibrationLibraryView). The dialog opens with
// Cancel focused, and its confirming button names the files when they go too.
function RemoveFramesButton({ title, message, files, disabled, tooltip, onConfirm, children }: { readonly title: string; readonly message: string; readonly files: string; readonly disabled: boolean; readonly tooltip?: string; readonly onConfirm: (files: boolean) => void; readonly children: string }) {
	const { deleteFiles } = useSnapshot(calibrationLibraryView)
	const [open, setOpen] = useState(false)

	return (
		<>
			<Button variant="secondary" disabled={disabled} title={tooltip} onClick={() => setOpen(true)}>
				{children}
			</Button>
			<Modal open={open} onClose={() => setOpen(false)} title={title} className="max-w-md">
				<div className="flex flex-col gap-3 text-sm leading-5 text-ink-200">
					<p className="m-0">{message}</p>
					<Checkbox
						label={files}
						checked={deleteFiles}
						onChange={(checked) => {
							calibrationLibraryView.deleteFiles = checked
						}}
					/>
					<p className="m-0 text-xs leading-4 text-ink-300">{deleteFiles ? 'Deleted files cannot be recovered.' : 'The files stay where they are, and an import adds them again.'}</p>
				</div>
				<ModalActions>
					<Button variant="secondary" onClick={() => setOpen(false)} data-autofocus>
						Cancel
					</Button>
					<Button
						variant="danger"
						onClick={() => {
							setOpen(false)
							onConfirm(deleteFiles)
						}}
					>
						{deleteFiles ? 'Remove and Delete Files' : 'Remove'}
					</Button>
				</ModalActions>
			</Modal>
		</>
	)
}

// What a running build is doing, by state of its job.
const BUILD_STATE_LABELS: Readonly<Record<CalibrationJobSummary['state'], string>> = { queued: 'Queued behind another build', validating: 'Checking the frames', integrating: 'Combining the frames', publishing: 'Publishing the master', completed: 'Published', failed: 'Failed', cancelled: 'Cancelled' }

// Recipe of a master, which the server explains as it changes, with the progress of its build, which can be cancelled
// until it publishes. shown is what the group section already lists, so only what the recipe itself adds is listed here;
// onMaster shows the master the last build published.
function BuildForm({ groupId, kind, shown, onMaster }: { readonly groupId: string; readonly kind: CalibrationKind; readonly shown: readonly CompatibilityFinding[]; readonly onMaster: (masterId: number) => void }) {
	const timeZone = useActiveTimeZone()
	const { pending, errors, changes, jobs } = useSnapshot(calibrationLibraryRuntime)
	const [form, setForm] = useState<RecipeForm>(DEFAULT_FORM)
	const [validation, setValidation] = useState<RecipeValidation>()
	const [corrections, setCorrections] = useState<readonly CalibrationMasterSummary[]>([])
	const key = `group:${groupId}`
	const edit = (patch: Partial<RecipeForm>) => setForm({ ...form, ...patch })

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
		return master ? `${KIND_LABELS[master.kind]} ${masterName(master, timeZone)} · ${exposureText(master.metadata)}` : 'None'
	}

	const reason = validation?.findings.find(({ severity }) => severity === 'blocker')?.message
	// Findings of the recipe the group section does not list, such as those of a flat's correction.
	const added = validation?.findings.filter((finding) => !shown.some(({ field, code, message }) => field === finding.field && code === finding.code && message === finding.message)) ?? []
	// The latest build of the group, wherever it was asked for, keeps the button busy until it ends and explains a failure.
	const job = latestGroupJob(jobs, groupId)
	const building = job !== undefined && !jobEnded(job)
	const requesting = pending[key] === true
	const failure = job?.state === 'failed' ? job.error : undefined
	const cancelKey = `build:${job?.jobId}`

	return (
		<>
			{kind === 'dark' && <SegmentedControl label="Master" options={DARK_MASTER_KINDS} value={form.kind} format={(option) => KIND_LABELS[option]} onChange={(next) => edit({ kind: next })} />}
			{kind === 'dark' && form.kind === 'darkFlat' && <Notice>A dark-flat corrects flats taken at its exposure, so build one only from darks taken at the exposure of your flats.</Notice>}
			<Select label="Combination" options={RECIPE_METHODS} value={form.method} format={(option) => METHOD_LABELS[option]} onChange={(method) => edit({ method })} />
			{form.method === 'sigmaClip' && (
				<div className="flex flex-col gap-2">
					<NumberInput label="Low Sigma" value={form.sigmaLow} min={1} max={10} step={0.5} onChange={(sigmaLow) => edit({ sigmaLow })} />
					<NumberInput label="High Sigma" value={form.sigmaHigh} min={1} max={10} step={0.5} onChange={(sigmaHigh) => edit({ sigmaHigh })} />
					<NumberInput label="Passes" value={form.maxIterations} min={1} max={20} onChange={(maxIterations) => edit({ maxIterations })} />
				</div>
			)}
			{kind === 'flat' && <Select label="Correction" className="min-w-0" options={options} value={form.correction} format={correctionLabel} onChange={(correction) => edit({ correction })} />}
			{added.length > 0 && <Findings findings={added} />}
			{validation?.needsAcknowledgement && <Checkbox label="I reviewed the warnings and accept them" checked={form.acknowledged} onChange={(acknowledged) => edit({ acknowledged })} />}
			{validation !== undefined && validation.spillBytes > 0 && <Notice>{`Needs about ${formatByteSize(validation.spillBytes)} of temporary disk.`}</Notice>}
			{errors[key] && <Notice error>{errors[key]}</Notice>}
			{errors[cancelKey] && <Notice error>{errors[cancelKey]}</Notice>}
			{failure && !building && <Notice error>{`The last build failed: ${failure}`}</Notice>}
			{job?.state === 'cancelled' && <Notice>The last build was cancelled; nothing was published.</Notice>}
			{job?.state === 'completed' && job.masterId !== undefined && (
				<div className="flex flex-wrap items-center justify-between gap-2">
					<span className="text-xs leading-4 text-ink-200">{`The last build published master #${job.masterId}.`}</span>
					<Button variant="secondary" onClick={() => onMaster(job.masterId!)}>
						Show Master
					</Button>
				</div>
			)}
			{building ? (
				<div className="flex flex-col gap-2">
					<div className="flex items-baseline justify-between gap-2 text-xs text-ink-200 tabular-nums">
						<span>{BUILD_STATE_LABELS[job.state]}</span>
						{job.state !== 'queued' && <span>{formatPercent(jobFraction(job))}</span>}
					</div>
					{job.state !== 'queued' && <ProgressBar fraction={jobFraction(job)} />}
					<Actions>
						<Button variant="secondary" disabled={job.state === 'publishing' || pending[cancelKey] === true} title={job.state === 'publishing' ? 'The master is being published and can no longer be cancelled' : undefined} onClick={() => void cancelCalibrationBuild(calibrationLibraryRuntime, job.jobId)}>
							Cancel Build
						</Button>
					</Actions>
				</div>
			) : (
				<Button disabled={requesting || !validation?.valid} title={reason ?? (validation === undefined ? 'The recipe is being checked' : undefined)} onClick={() => void buildMaster(calibrationLibraryRuntime, key, request())}>
					{requesting && <span className="size-3.5 flex-none animate-spin rounded-full motion-reduce:animate-none border-2 border-current border-t-transparent" />}
					{requesting ? 'Requesting' : 'Build Master'}
				</Button>
			)}
		</>
	)
}

// Value with how it is known, written by `format` (as is by default).
function EvidencedReadout<T extends string | number>({ label, value, format = String }: { readonly label: string; readonly value: Evidenced<T>; readonly format?: (value: T) => string }) {
	return <DataRow label={label}>{value.value === undefined ? 'Unknown' : `${format(value.value)} · ${EVIDENCE_LABELS[value.evidence]}`}</DataRow>
}

// Master, what went in, how to use it, and its deletion, last.
function MasterPanel({ onGroup, onDeleted }: { readonly onGroup: (groupId: string) => void; readonly onDeleted: () => void }) {
	const timeZone = useActiveTimeZone()
	const { master: snapshot, pending, errors } = useSnapshot(calibrationLibraryRuntime)
	const master = snapshot
	if (!master) return <LoadingSection id="calibration.master" title="Master" />

	const key = masterDeletionKey(master.masterId)
	const { diagnostics } = master
	const warnings = masterWarnings(master)

	async function remove(masterId: number) {
		if (await deleteCalibrationMaster(calibrationLibraryRuntime, masterId)) onDeleted()
	}

	return (
		<>
			<CollapsibleSection id="calibration.master" title={`${KIND_LABELS[master.kind]} ${masterName(master, timeZone)}`}>
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
				<DataRow label="Contents">{`${CALIBRATION_STATE_LABELS[master.calibrationState]} · ${master.units}`}</DataRow>
				<Notice>{master.usage}</Notice>
				<Actions>
					<Button disabled={master.status === 'unavailable'} onClick={() => openInImages(master.path)}>
						Open in Images
					</Button>
					<Button variant="secondary" onClick={() => onGroup(master.groupId)}>
						Open Group
					</Button>
				</Actions>
			</CollapsibleSection>
			<CollapsibleSection id="calibration.diagnostics" title="Integration">
				<DataRow label="Frames">{`${diagnostics.integratedFrames} of ${diagnostics.requestedFrames}`}</DataRow>
				<DataRow label="Method">{METHOD_LABELS[diagnostics.method]}</DataRow>
				<DataRow label="Rejected Samples">{`${formatCount(diagnostics.rejectedLow)} low, ${formatCount(diagnostics.rejectedHigh)} high`}</DataRow>
				{diagnostics.hotPixels !== undefined && <DataRow label="Hot Pixels">{formatCount(diagnostics.hotPixels)}</DataRow>}
				{diagnostics.invalidResponsePixels !== undefined && <DataRow label="Invalid Response">{formatCount(diagnostics.invalidResponsePixels)}</DataRow>}
				{diagnostics.planes.map(({ plane, median, sigma }) => (
					<DataRow key={plane} label={`Plane ${plane + 1}`}>{`${formatFixed(median, master.units === 'DN' ? 1 : 4)} ± ${formatFixed(sigma, master.units === 'DN' ? 1 : 4)}`}</DataRow>
				))}
				{diagnostics.excludedFrames?.map(({ sourceId, reason }) => (
					<Notice key={sourceId}>{`A frame was left out: ${reason}`}</Notice>
				))}
			</CollapsibleSection>
			<CollapsibleSection id="calibration.lineage" title="Provenance" defaultOpen={false}>
				{master.dependencies.map(({ masterId }) => (
					<DataRow key={masterId} label="Corrected by">{`#${masterId}`}</DataRow>
				))}
				<DataRow label="Published">{formatZonedDateTime(master.createdAt, timeZone)}</DataRow>
				<DataRow label="SHA-256">
					<span className="break-all">{master.contentDigest}</span>
				</DataRow>
				<DataRow label="Frames">
					<ul className="m-0 flex list-none flex-col p-0">
						{master.sourceNames.map((name) => (
							<li key={name} className="break-all">
								{name}
							</li>
						))}
					</ul>
				</DataRow>
			</CollapsibleSection>
			<CollapsibleSection id="calibration.remove" title="Remove" defaultOpen={false}>
				{errors[key] && <Notice error>{errors[key]}</Notice>}
				<Actions>
					<ConfirmButton
						title={`Delete master #${master.masterId}?`}
						message="Its file is deleted from the disk and cannot be recovered, and its id is never used again. A master that was corrected by it must be deleted first."
						confirmLabel="Delete Master"
						destructive
						disabled={pending[key] === true}
						onConfirm={() => void remove(master.masterId)}
					>
						Delete Master
					</ConfirmButton>
				</Actions>
			</CollapsibleSection>
		</>
	)
}

// Frame, with how each value is known, what an operator may state about it, and its removal, last, which explains its
// own failure.
function SourcePanel({ onDeleted }: { readonly onDeleted: () => void }) {
	const { source: snapshot, pending, errors } = useSnapshot(calibrationLibraryRuntime)
	const { cameras } = useSnapshot(catalogState)
	const source = snapshot
	if (!source) return <LoadingSection id="calibration.source" title="Frame" />
	const { metadata } = source
	const removal = sourceDeletionKey(source.sourceId)

	// A failed deletion fetches the frame again, which its loader skipped while it ran.
	async function remove(sourceId: string, files: boolean) {
		if (await deleteCalibrationSource(calibrationLibraryRuntime, sourceId, files)) onDeleted()
		else void loadCalibrationSource(calibrationLibraryRuntime, sourceId)
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
				</Actions>
				<DataRow label="Size">{formatByteSize(source.bytes)}</DataRow>
				<DataRow label="Image">{`${metadata.width}×${metadata.height}×${metadata.channels}, BITPIX ${metadata.bitpix}${metadata.cfa ? `, ${metadata.cfa}` : ''}`}</DataRow>
				<DataRow label="Camera">{cameraText(metadata, cameras)}</DataRow>
				<EvidencedReadout label="Exposure" value={metadata.exposure} format={(value) => formatExposureTime(value / 1000000)} />
				<EvidencedReadout label="Target" value={metadata.setTemperature} format={(value) => `${value} °C`} />
				<EvidencedReadout label="Sensor" value={metadata.sensorTemperature} format={formatTemperature} />
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
			<CollapsibleSection id="calibration.remove" title="Remove" defaultOpen={false}>
				{errors[removal] && <Notice error>{errors[removal]}</Notice>}
				<Actions>
					<RemoveFramesButton title="Remove this frame?" message="The frame leaves the library. Masters made with it stay." files="Also delete its file from the disk, wherever it is" disabled={pending[removal] === true} onConfirm={(files) => void remove(source.sourceId, files)}>
						Remove Frame
					</RemoveFramesButton>
				</Actions>
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
		if (field) void overrideCalibrationSource(calibrationLibraryRuntime, source.sourceId, field, overrideValue(field, value))
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
									<Button variant="secondary" onClick={() => setPaths(paths.filter((other) => other !== path))}>
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
					<ModalActions>
						<Button variant="secondary" onClick={onClose}>
							Cancel
						</Button>
						<Button disabled={paths.length === 0 || pending.import === true} title={paths.length === 0 ? 'Add a directory or files first' : undefined} onClick={() => void start()}>
							Scan Files
						</Button>
					</ModalActions>
				</div>
			) : (
				<ImportReview jobId={jobId} onClose={onClose} />
			)}
			<FileExplorerModal open={choosing === 'directory'} title="Add Directory" mode="directory" initialPath={lastDirectory} onChoose={(path, directory) => add([path], directory)} onClose={() => setChoosing(undefined)} />
			<FileExplorerModal open={choosing === 'open'} title="Add Files" mode="open" action="Add" multiple initialPath={lastDirectory} extensions={IMAGE_EXTENSIONS} onChoose={add} onClose={() => setChoosing(undefined)} />
		</Modal>
	)
}

// Review of what an import found, inside its dialog: nothing enters the library until it is committed, which closes it.
function ImportReview({ jobId, onClose }: { readonly jobId: string; readonly onClose: () => void }) {
	const { jobs, pending, errors } = useSnapshot(calibrationLibraryRuntime)
	const job = jobs[jobId]
	const ended = job !== undefined && jobEnded(job)
	const [pageIndex, setPageIndex] = useState(0)
	const [page, setPage] = useState<ImportCandidatePage>()
	const [loading, setLoading] = useState(false)
	const [failed, setFailed] = useState(false)
	const [declared, setDeclared] = useState<Readonly<Record<string, CalibrationKind>>>({})
	const [copy, setCopy] = useState(false)
	// Camera of the Equipment Catalog of every file, as chosen; undefined until one is, or one is suggested.
	const [chosenCamera, setChosenCamera] = useState<string>()
	// Camera chosen for one file instead, by path.
	const [fileCameras, setFileCameras] = useState<Readonly<Record<string, string>>>({})
	const { cameras } = useSnapshot(catalogState)
	const bindings = useSnapshot(cameraBindingsState)
	const completed = job?.state === 'completed'

	// Fetches the page shown once the scan ended; a page asked for later replaces an earlier answer.
	useEffect(() => {
		if (!completed) return
		let current = true
		setLoading(true)

		void loadImportCandidates(jobId, pageIndex).then((answer) => {
			if (!current) return
			setLoading(false)
			setFailed(answer === undefined)
			if (answer) setPage(answer)
		})

		return () => {
			current = false
		}
	}, [completed, jobId, pageIndex])

	const items = page?.items ?? []
	// What a commit adds: the candidates ready as they are, on every page, and those an operator declared, on any page.
	const ready = (page?.ready ?? 0) + Object.keys(declared).length
	// Cameras offered: those of the catalog not archived.
	const offered = cameras.filter((camera) => !camera.archived).map((camera) => camera.id)
	// A camera is suggested only when every file of the page names, in its header, the device one binding binds to one camera.
	const suggestions = new Set(items.flatMap((candidate) => (candidate.metadata ? [candidate.metadata.cameraName === undefined ? undefined : suggestedCameraId(bindings, cameras, candidate.metadata.cameraName)] : [])))
	const suggested = suggestions.size === 1 ? [...suggestions][0] : undefined
	const camera = chosenCamera ?? suggested

	async function commit() {
		const answer = await commitCalibrationImport(calibrationLibraryRuntime, jobId, { classifications: declared, ...(camera !== undefined && { cameraId: camera }), cameras: fileCameras, copy })
		if (answer) onClose()
	}

	return (
		<div className="flex min-h-0 flex-col gap-3">
			{!ended && (
				<div className="flex items-center gap-3">
					<Notice>{`Reading headers · ${job?.found ?? 0} files · ${formatByteSize(job?.bytes ?? 0)}`}</Notice>
					<Button variant="secondary" onClick={() => void cancelCalibrationImport(calibrationLibraryRuntime, jobId)}>
						Cancel
					</Button>
				</div>
			)}
			{job?.error && <Notice error>{job.error}</Notice>}
			{job?.truncated && <Notice error>The limit of files was reached; only part of these directories was read.</Notice>}
			{page && (
				<>
					<Notice>{`${formatCount(page.total)} files found, ${formatCount(ready)} ready to add${page.total > 0 && ready === 0 ? ': each one is already in the library or is not a calibration frame' : ''}. Declared types and cameras are kept across pages. Frames are referenced where they are and never changed.`}</Notice>
					{offered.length === 0 ? (
						<Notice error>The Equipment Catalog has no camera. Add the camera that took these frames in Settings → Equipment Catalog first.</Notice>
					) : (
						<>
							<Select label="Camera" className="w-72" options={['', ...offered]} value={camera ?? ''} format={(option) => (option ? catalogCameraName(cameras, option) : 'Choose the camera of these frames')} onChange={(option) => setChosenCamera(option || undefined)} />
							<Notice>
								{camera !== undefined && camera === suggested && chosenCamera === undefined
									? 'Suggested from the camera name the headers give and the device bound to it; confirm it, since two units of one model give the same name.'
									: 'The camera of the Equipment Catalog that took these frames; nothing is read from the files.'}
							</Notice>
						</>
					)}
					<Table columns={['File', 'Found', 'Exposure', 'Declared Type', 'Camera', 'Notes']}>
						{items.map((candidate) => (
							<Row key={candidate.path}>
								<Cell>{candidate.name}</Cell>
								<Cell>{candidate.kind ? KIND_LABELS[candidate.kind] : (candidate.rejectedRole ?? 'Unknown')}</Cell>
								<Cell>{candidate.metadata ? exposureText(candidate.metadata) : MISSING}</Cell>
								<Cell>
									{!candidate.kind && !candidate.rejectedRole && !candidate.error && !candidate.known && candidate.metadata && candidate.format && (
										<Select
											options={['none', ...CALIBRATION_KINDS]}
											value={declared[candidate.path] ?? 'none'}
											format={(option) => (option === 'none' ? 'Not a frame' : KIND_LABELS[option])}
											onChange={(option) => setDeclared(option === 'none' ? Object.fromEntries(Object.entries(declared).filter(([path]) => path !== candidate.path)) : { ...declared, [candidate.path]: option })}
										/>
									)}
								</Cell>
								<Cell>
									{!candidate.rejectedRole && !candidate.error && !candidate.known && candidate.metadata && offered.length > 0 && (
										<Select
											options={['', ...offered]}
											value={fileCameras[candidate.path] ?? ''}
											format={(option) => (option ? catalogCameraName(cameras, option) : 'As above')}
											onChange={(option) => setFileCameras(option ? { ...fileCameras, [candidate.path]: option } : Object.fromEntries(Object.entries(fileCameras).filter(([path]) => path !== candidate.path)))}
										/>
									)}
								</Cell>
								<Cell>{candidate.error ?? (candidate.known ? 'Already in the library' : candidate.warnings[0])}</Cell>
							</Row>
						))}
					</Table>
					<Pager page={pageIndex} total={page.total} pageSize={CALIBRATION_PAGE_SIZE} noun="files" loading={loading} onPage={setPageIndex} />
					<Checkbox label="Copy into the library" checked={copy} onChange={setCopy} />
					{errors.import && <Notice error>{errors.import}</Notice>}
					<ModalActions>
						<Button variant="secondary" onClick={onClose}>
							Close
						</Button>
						<Button disabled={ready === 0 || camera === undefined || pending.import === true} title={ready === 0 ? 'No file found is ready to add' : camera === undefined ? 'Choose the camera of these frames first' : undefined} onClick={() => void commit()}>
							{ready === 1 ? 'Add 1 Frame' : `Add ${formatCount(ready)} Frames`}
						</Button>
					</ModalActions>
				</>
			)}
			{failed && <Notice error>The files found could not be read from the server.</Notice>}
			{ended && !page && (
				<ModalActions>
					<Button variant="secondary" onClick={onClose}>
						Close
					</Button>
				</ModalActions>
			)}
		</div>
	)
}
