import type { SpiceBody, SpiceCatalogItem, SpiceKernelSummary } from 'api'
import { cn } from 'cn'
import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatByteSize, MISSING } from '../../format'
import { EmptyState, type WorkspacePanel, WorkspaceLayout, useWorkspacePanel } from '../../shell/WorkspaceLayout'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { AddKernel, CatalogDetails } from './AddKernel'
import { Bodies, BodyDetails } from './Bodies'
import { Calculate } from './Calculate'
import { type BodyNames, bodyNames, epochDate, naifName, READINESS, SOURCE_LABELS } from './format'
import { KernelDetails, KernelSegments } from './KernelDetails'
import { LibrarySection } from './LibrarySection'
import { fetchSpiceBodies, fetchSpiceCatalog, importSpiceKernel, spiceKernelsState, updateSpiceKernel } from './spicekernels'

// SPICE Kernel Library tool: the SPK files the server evaluates for accurate solar-system positions, shared by every tab
// and profile. Installed lists them by precedence with their readiness, enabled flag, and coverage, and a selected one
// opens its details and commands in the panel and its segments below the list; Bodies lists, body by body, which kernels
// provide it, and a selected body opens in the panel its preferred kernel and a timeline of its segments; Calculate
// computes the state of a body from the kernels, through the selection or from one chosen segment; Add Kernel shows the
// acquisitions of the server, downloads the curated NASA/JPL kernels (a selected one opens in the panel), generates
// small-body kernels, and imports MPC elements. Import uploads a local .bsp file. The offline switch of the ephemeris
// sources lives in Settings. Everything shown is the server's; closing the tool never stops a download or a generation.

// Sections of the tool.
type Section = 'installed' | 'bodies' | 'calculate' | 'add'

// Sections in display order.
const SECTIONS: readonly Section[] = ['installed', 'bodies', 'calculate', 'add']

// Label of each section.
const SECTION_LABELS: Readonly<Record<Section, string>> = { installed: 'Installed', bodies: 'Bodies', calculate: 'Calculate', add: 'Add Kernel' }

// Bodies of the current set of the server while `enabled`, read again whenever the library changes; undefined while the
// first answer is awaited or when not enabled.
function useSpiceBodies(enabled: boolean, revision: number) {
	const [bodies, setBodies] = useState<readonly SpiceBody[]>()

	useEffect(() => {
		if (!enabled) return
		const controller = new AbortController()
		void fetchSpiceBodies(controller.signal).then((value) => !controller.signal.aborted && setBodies(value?.bodies ?? []))
		return () => controller.abort()
	}, [enabled, revision])

	return enabled ? bodies : undefined
}

// Curated downloads while `enabled`, read again whenever the library changes, so their installed state follows it;
// undefined while the first answer is awaited or when not enabled.
function useSpiceCatalog(enabled: boolean, revision: number) {
	const [catalog, setCatalog] = useState<readonly SpiceCatalogItem[]>()

	useEffect(() => {
		if (!enabled) return
		const controller = new AbortController()
		void fetchSpiceCatalog(controller.signal).then((items) => !controller.signal.aborted && setCatalog(items))
		return () => controller.abort()
	}, [enabled, revision])

	return enabled ? catalog : undefined
}

// SPICE Kernel Library tool.
export function SpiceKernelLibrary() {
	const state = useSnapshot(spiceKernelsState)
	const [section, setSection] = useState<Section>('installed')
	const [selected, setSelected] = useState<string>()
	const [selectedBody, setSelectedBody] = useState<number>()
	const [selectedItem, setSelectedItem] = useState<string>()
	const input = useRef<HTMLInputElement>(null)
	const panelState = useWorkspacePanel('tools')
	const kernels = state.snapshot?.kernels ?? []
	const names = bodyNames(kernels)
	const bodies = useSpiceBodies(section === 'bodies' || section === 'calculate', state.revision)
	const catalog = useSpiceCatalog(section === 'add', state.revision)
	const kernel = kernels.find((e) => e.id === selected)
	const body = bodies?.find((e) => e.body === selectedBody)
	const item = catalog?.find((e) => e.id === selectedItem)

	async function importFile({ target: { files } }: ChangeEvent<HTMLInputElement>) {
		const file = files?.[0]
		if (input.current) input.current.value = ''
		if (!file) return
		if (await importSpiceKernel(spiceKernelsState, file)) setSection('installed')
	}

	// Selects a body and opens the panel with its details, even where it was hidden.
	function selectBody(code: number) {
		setSelectedBody(code)
		if (!panelState.open) panelState.setOpen(true)
	}

	// Shows a kernel of the library in Installed with its panel, as after an acquisition added it.
	function showKernel(id: string) {
		setSelected(id)
		setSection('installed')
	}

	const actions = (
		<Actions>
			<Button variant="secondary" disabled={state.pending.import} title="Uploads a .bsp file of this device into the library" onClick={() => input.current?.click()}>
				{state.pending.import ? 'Importing…' : 'Import'}
			</Button>
			<input ref={input} type="file" accept=".bsp,application/octet-stream" className="hidden" onChange={(event) => void importFile(event)} />
		</Actions>
	)

	// The sections side by side where they fit, a selector on a phone.
	const context = (
		<>
			<SegmentedControl options={SECTIONS} value={section} onChange={setSection} format={(e) => SECTION_LABELS[e]} className="max-sm:hidden" />
			<Select options={SECTIONS} value={section} onChange={setSection} format={(e) => SECTION_LABELS[e]} className="w-36 sm:hidden" />
		</>
	)

	let panel: WorkspacePanel | undefined
	if (section === 'installed' && kernel) panel = { title: 'Kernel', content: <KernelDetails key={kernel.id} kernel={kernel} onDeleted={() => setSelected(undefined)} /> }
	else if (section === 'bodies' && body) panel = { title: 'Body', content: <BodyDetails key={body.body} body={body} kernels={kernels} names={names} /> }
	else if (section === 'add' && item) panel = { title: 'Curated Kernel', content: <CatalogDetails key={item.id} item={item} onShowKernel={showKernel} /> }

	return (
		<WorkspaceLayout workspace="tools" title="SPICE Kernel Library" context={context} actions={actions} panel={panel} panelState={panelState}>
			<div className="h-full overflow-y-auto bg-base-100">
				{/* Installed and Bodies keep the column to the height of the workspace, so their lists scroll in their own frames below the headings. */}
				<div className={cn('mx-auto flex max-w-7xl flex-col gap-4 p-4', (section === 'installed' || section === 'bodies') && 'h-full')}>
					{state.errors.import && <Notice error>{state.errors.import}</Notice>}
					{section === 'installed' && <Installed kernels={kernels} names={names} selected={selected} onSelect={setSelected} />}
					{section === 'bodies' && <Bodies bodies={bodies} kernels={kernels} names={names} selected={selectedBody} onSelect={selectBody} />}
					{section === 'calculate' && <Calculate bodies={bodies} kernels={kernels} names={names} />}
					{section === 'add' && <AddKernel catalog={catalog} selected={selectedItem} onSelect={setSelectedItem} onShowKernel={showKernel} />}
				</div>
			</div>
		</WorkspaceLayout>
	)
}

interface InstalledProps {
	readonly kernels: readonly SpiceKernelSummary[]
	// Names of the library's small bodies.
	readonly names: BodyNames
	// Kernel shown in the panel.
	readonly selected?: string
	readonly onSelect: (id: string) => void
}

// Installed kernels by load order, the highest precedence first, with a summary of the library and the segments of the
// selected one below.
function Installed({ kernels, names, selected, onSelect }: InstalledProps) {
	const state = useSnapshot(spiceKernelsState)
	const snapshot = state.snapshot

	if (!snapshot) return <EmptyState title="Loading" description="Reading the library of the server." />
	if (kernels.length === 0) return <EmptyState title="No kernels" description="Download the planetary kernel or generate a small-body kernel in Add Kernel, or import a .bsp file." />

	const usable = kernels.filter((e) => e.readiness === 'ready').length
	const ordered = kernels.toReversed()
	// Precedence of each enabled kernel, from 1, the highest.
	const ranks = new Map(ordered.filter((e) => e.enabled).map((e, i) => [e.id, i + 1]))
	const kernel = kernels.find((e) => e.id === selected)

	return (
		<>
			<LibrarySection
				title="Load order"
				// With a kernel's segments below, the list keeps at most half the height and the segments take the rest.
				className={cn('min-h-0', kernel && 'max-h-1/2 shrink-0')}
				aside={
					<span className="text-xs text-ink-300">
						{kernels.length} {kernels.length === 1 ? 'kernel' : 'kernels'}, {usable} ready · {formatByteSize(snapshot.bytes)}
						{snapshot.loading && ' · opening the kernels'}
					</span>
				}
			>
				<Notice className="max-w-3xl">Where kernels overlap, the one with precedence 1 provides the body, unless Bodies prefers another kernel for it. A new kernel enters at precedence 1; move a kernel from its panel.</Notice>
				<Table
					columns={[
						{ key: 'rank', label: '#', numeric: true },
						'On',
						'Name',
						{ key: 'source', label: 'Source', className: 'max-sm:hidden' },
						{ key: 'bodies', label: 'Bodies', className: 'max-md:hidden' },
						{ key: 'coverage', label: 'Coverage', className: 'max-sm:hidden' },
						{ key: 'size', label: 'Size', numeric: true, className: 'max-sm:hidden' },
						'Status',
					]}
				>
					{ordered.map((kernel) => (
						<KernelRow key={kernel.id} rank={ranks.get(kernel.id)} kernel={kernel} names={names} selected={kernel.id === selected} onSelect={() => onSelect(kernel.id)} />
					))}
				</Table>
			</LibrarySection>
			{kernel && <KernelSegments key={kernel.id} kernel={kernel} names={names} />}
		</>
	)
}

interface KernelRowProps {
	// Precedence among the enabled kernels, from 1, the highest; absent for a disabled kernel.
	readonly rank?: number
	readonly kernel: SpiceKernelSummary
	// Names of the library's small bodies.
	readonly names: BodyNames
	readonly selected: boolean
	readonly onSelect: () => void
}

// One installed kernel. A ready kernel says so in plain text, so only the kernels that need attention carry a badge. On a
// phone the precedence column is left out, since the rows are already in that order.
function KernelRow({ rank, kernel, names, selected, onSelect }: KernelRowProps) {
	const state = useSnapshot(spiceKernelsState)
	const readiness = READINESS[kernel.readiness]
	const bodies = kernel.targets.length > 3 ? `${kernel.targets.length} bodies` : kernel.targets.map((e) => naifName(e, names)).join(', ') || MISSING
	const coverage = kernel.start === undefined || kernel.end === undefined ? MISSING : `${epochDate(kernel.start)} – ${epochDate(kernel.end)}`
	const missing = kernel.readiness === 'missing'

	return (
		<Row selected={selected} onSelect={onSelect} title={kernel.failure}>
			<Cell numeric>{rank ?? MISSING}</Cell>
			<Cell>
				{/* The checkbox turns the kernel on or off without selecting the row. */}
				<span className="flex" onClick={(event) => event.stopPropagation()}>
					<Checkbox
						label={`Enable ${kernel.name}`}
						hideLabel
						title={missing ? 'The file of this kernel is gone; delete it or import the file again' : kernel.enabled ? 'Turns this kernel off' : 'Turns this kernel on'}
						checked={kernel.enabled}
						disabled={state.pending[`kernel:${kernel.id}`] || missing}
						onChange={(enabled) => void updateSpiceKernel(spiceKernelsState, kernel.id, { enabled })}
					/>
				</span>
			</Cell>
			<Cell className="max-w-64 truncate text-ink-100" title={kernel.name}>
				{kernel.name}
			</Cell>
			<Cell className="max-sm:hidden">{SOURCE_LABELS[kernel.sourceKind]}</Cell>
			<Cell className="max-w-64 truncate max-md:hidden" title={kernel.targets.map((e) => naifName(e, names)).join(', ')}>
				{bodies}
			</Cell>
			<Cell className="whitespace-nowrap max-sm:hidden">{coverage}</Cell>
			<Cell numeric className="whitespace-nowrap max-sm:hidden">
				{formatByteSize(kernel.bytes)}
			</Cell>
			<Cell>{kernel.readiness === 'ready' ? <span className="text-ink-300">{readiness.label}</span> : <StatusBadge tone={readiness.tone} label={readiness.label} />}</Cell>
		</Row>
	)
}
