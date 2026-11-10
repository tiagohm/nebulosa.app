import type { SpiceEphemerisPolicy, SpiceKernelSummary } from 'api'
import { type ChangeEvent, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatByteSize } from '../../format'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Notice } from '../../ui/Notice'
import { RadioGroup } from '../../ui/RadioGroup'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { AddKernel } from './AddKernel'
import { epochDate, naifName, READINESS, SOURCE_LABELS } from './format'
import { KernelDetails } from './KernelDetails'
import { importSpiceKernel, SPICE_POLICY_LABELS, setSpicePolicy, spiceKernelsState, updateSpiceKernel } from './spicekernels'

// SPICE Kernel Library tool: the SPK files the server evaluates for accurate solar-system positions, shared by every tab
// and profile. Installed lists them with their readiness, enabled flag, and coverage, and opens the details of one in
// the panel; Add Kernel downloads the curated planetary kernel and generates small-body kernels from Horizons; Settings
// chooses the ephemeris policy. Import uploads a local .bsp file. Everything shown is the server's; closing the tool
// never stops a download or a generation.

// Sections of the tool.
type Section = 'installed' | 'add' | 'settings'

// Sections in display order.
const SECTIONS: readonly Section[] = ['installed', 'add', 'settings']

// Label of each section.
const SECTION_LABELS: Readonly<Record<Section, string>> = { installed: 'Installed', add: 'Add Kernel', settings: 'Settings' }

// What each policy does.
const POLICY_DESCRIPTIONS: Readonly<Record<SpiceEphemerisPolicy, string>> = {
	automatic: 'Accurate positions come from the kernels when they cover the target, the Earth, and the Sun; otherwise from JPL Horizons, with the local models when Horizons is unreachable.',
	offline: 'Accurate positions come from the kernels when they cover them, otherwise from the local models. No position, event, or mount target ever asks JPL anything.',
	spkOnly: 'Accurate positions come only from the kernels; anything they do not cover is reported as unavailable. Map positions keep using the local models.',
}

// SPICE Kernel Library tool.
export function SpiceKernelLibrary() {
	const state = useSnapshot(spiceKernelsState)
	const [section, setSection] = useState<Section>('installed')
	const [selected, setSelected] = useState<string>()
	const input = useRef<HTMLInputElement>(null)
	const kernels = state.snapshot?.kernels ?? []
	const kernel = kernels.find((e) => e.id === selected)

	async function importFile({ target: { files } }: ChangeEvent<HTMLInputElement>) {
		const file = files?.[0]
		if (input.current) input.current.value = ''
		if (!file) return
		if (await importSpiceKernel(spiceKernelsState, file)) setSection('installed')
	}

	const actions = (
		<Actions>
			<Button variant="secondary" disabled={state.pending.import} onClick={() => input.current?.click()}>
				{state.pending.import ? 'Importing…' : 'Import'}
			</Button>
			<input ref={input} type="file" accept=".bsp,application/octet-stream" className="hidden" onChange={(event) => void importFile(event)} />
		</Actions>
	)

	const context = <SegmentedControl options={SECTIONS} value={section} onChange={setSection} format={(e) => SECTION_LABELS[e]} />

	return (
		<WorkspaceLayout workspace="tools" title="SPICE Kernel Library" context={context} actions={actions} panel={kernel ? { title: 'Kernel', content: <KernelDetails key={kernel.id} kernel={kernel} onDeleted={() => setSelected(undefined)} /> } : undefined}>
			<div className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
					{state.errors.import && <Notice error>{state.errors.import}</Notice>}
					{section === 'installed' && <Installed kernels={kernels} selected={selected} onSelect={setSelected} />}
					{section === 'add' && <AddKernel />}
					{section === 'settings' && <Settings />}
				</div>
			</div>
		</WorkspaceLayout>
	)
}

interface InstalledProps {
	readonly kernels: readonly SpiceKernelSummary[]
	// Kernel shown in the panel.
	readonly selected?: string
	readonly onSelect: (id: string) => void
}

// Installed kernels by load order, the highest precedence first, with a summary of the library.
function Installed({ kernels, selected, onSelect }: InstalledProps) {
	const state = useSnapshot(spiceKernelsState)
	const snapshot = state.snapshot

	if (!snapshot) return <EmptyState title="Loading" description="Reading the library of the server." />
	if (kernels.length === 0) return <EmptyState title="No kernels" description="Download the planetary kernel or generate a small-body kernel in Add Kernel, or import a .bsp file." />

	const usable = kernels.filter((e) => e.readiness === 'ready').length
	const ordered = kernels.toReversed()

	return (
		<>
			<p className="m-0 text-sm text-ink-300">
				{kernels.length} {kernels.length === 1 ? 'kernel' : 'kernels'}, {usable} ready · {formatByteSize(snapshot.bytes)} · policy {SPICE_POLICY_LABELS[snapshot.policy]}
				{snapshot.loading && ' · opening the kernels'}
			</p>
			<Table columns={['On', 'Name', 'Source', 'Bodies', 'Coverage', { key: 'size', label: 'Size', numeric: true }, 'Status']}>
				{ordered.map((kernel) => (
					<KernelRow key={kernel.id} kernel={kernel} selected={kernel.id === selected} onSelect={() => onSelect(kernel.id)} />
				))}
			</Table>
			<Notice>Kernels higher in the list take precedence where they cover the same body at the same time. A small body generated by Horizons is relative to the Sun, so it needs a planetary kernel with the Sun and the Earth.</Notice>
		</>
	)
}

interface KernelRowProps {
	readonly kernel: SpiceKernelSummary
	readonly selected: boolean
	readonly onSelect: () => void
}

// One installed kernel.
function KernelRow({ kernel, selected, onSelect }: KernelRowProps) {
	const state = useSnapshot(spiceKernelsState)
	const readiness = READINESS[kernel.readiness]
	const bodies = kernel.targets.length > 3 ? `${kernel.targets.length} bodies` : kernel.targets.map(naifName).join(', ') || '—'
	const coverage = kernel.start === undefined || kernel.end === undefined ? '—' : `${epochDate(kernel.start)} – ${epochDate(kernel.end)}`

	return (
		<Row selected={selected} onSelect={onSelect} title={kernel.failure}>
			<Cell>
				{/* The checkbox turns the kernel on or off without selecting the row. */}
				<span className="flex" onClick={(event) => event.stopPropagation()}>
					<Checkbox label="" checked={kernel.enabled} disabled={state.pending[`kernel:${kernel.id}`] || kernel.readiness === 'missing'} onChange={(enabled) => void updateSpiceKernel(spiceKernelsState, kernel.id, { enabled })} />
				</span>
			</Cell>
			<Cell className="max-w-64 truncate">{kernel.name}</Cell>
			<Cell>{SOURCE_LABELS[kernel.sourceKind]}</Cell>
			<Cell className="max-w-64 truncate" title={kernel.targets.map(naifName).join(', ')}>
				{bodies}
			</Cell>
			<Cell>{coverage}</Cell>
			<Cell numeric>{formatByteSize(kernel.bytes)}</Cell>
			<Cell>
				<StatusBadge tone={readiness.tone} label={readiness.label} />
			</Cell>
		</Row>
	)
}

// Ephemeris policy of the server and the storage of the library.
function Settings() {
	const state = useSnapshot(spiceKernelsState)
	const snapshot = state.snapshot
	if (!snapshot) return <EmptyState title="Loading" description="Reading the library of the server." />

	return (
		<section className="flex flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4">
			<h2 className="m-0 text-sm font-semibold text-ink-100">Ephemeris policy</h2>
			<RadioGroup className="items-start" options={['automatic', 'offline', 'spkOnly'] as const} value={snapshot.policy} format={(e) => SPICE_POLICY_LABELS[e]} disabled={state.pending.settings} onChange={(policy) => void setSpicePolicy(spiceKernelsState, policy)} />
			<Notice>{POLICY_DESCRIPTIONS[snapshot.policy]}</Notice>
			{state.errors.settings && <Notice error>{state.errors.settings}</Notice>}
			<Notice>The policy applies to the whole server and every profile. Downloading or generating a kernel, and searching SBDB, still need the network whatever the policy. The library uses {formatByteSize(snapshot.bytes)} of the data directory.</Notice>
		</section>
	)
}
