import type { SpiceKernelSummary } from 'api'
import { type ChangeEvent, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatByteSize, MISSING } from '../../format'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { AddKernel } from './AddKernel'
import { Bodies } from './Bodies'
import { Calculate } from './Calculate'
import { epochDate, naifName, READINESS, SOURCE_LABELS } from './format'
import { KernelDetails, KernelSegments } from './KernelDetails'
import { importSpiceKernel, setEphemerisOffline, spiceKernelsState, updateSpiceKernel } from './spicekernels'

// SPICE Kernel Library tool: the SPK files the server evaluates for accurate solar-system positions, shared by every tab
// and profile. Installed lists them by precedence with their readiness, enabled flag, and coverage, opens the details of
// one in the panel, and shows its segments below the list; Bodies shows, body by body, which segment the ephemeris
// selects where and lets the operator prefer a kernel for a body; Calculate computes the state of a body from the kernels, through the selection
// or from one chosen segment; Add Kernel downloads the curated planetary kernel and generates small-body kernels from
// Horizons; Settings turns the offline switch of the ephemeris sources on or off. Import uploads a local .bsp file. Everything shown is the server's; closing the tool
// never stops a download or a generation.

// Sections of the tool.
type Section = 'installed' | 'bodies' | 'calculate' | 'add' | 'settings'

// Sections in display order.
const SECTIONS: readonly Section[] = ['installed', 'bodies', 'calculate', 'add', 'settings']

// Label of each section.
const SECTION_LABELS: Readonly<Record<Section, string>> = { installed: 'Installed', bodies: 'Bodies', calculate: 'Calculate', add: 'Add Kernel', settings: 'Settings' }

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
		<WorkspaceLayout workspace="tools" title="SPICE Kernel Library" context={context} actions={actions} panel={kernel && section === 'installed' ? { title: 'Kernel', content: <KernelDetails key={kernel.id} kernel={kernel} onDeleted={() => setSelected(undefined)} /> } : undefined}>
			<div className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 max-h-[stretch]">
					{state.errors.import && <Notice error>{state.errors.import}</Notice>}
					{section === 'installed' && <Installed kernels={kernels} selected={selected} onSelect={setSelected} />}
					{section === 'bodies' && <Bodies />}
					{section === 'calculate' && <Calculate />}
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

// Installed kernels by load order, the highest precedence first, with a summary of the library and the segments of the
// selected one below.
function Installed({ kernels, selected, onSelect }: InstalledProps) {
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
			<p className="m-0 text-sm text-ink-300">
				{kernels.length} {kernels.length === 1 ? 'kernel' : 'kernels'}, {usable} ready · {formatByteSize(snapshot.bytes)}
				{snapshot.offline && ' · offline'}
				{snapshot.loading && ' · opening the kernels'}
			</p>
			<Notice>
				Precedence 1 wins: where several kernels cover the same body at the same instant, the one higher in the list provides it, unless a kernel is preferred for that body in Bodies. A new kernel enters at the top. Raise or lower a kernel in its panel. A small body generated by Horizons is relative to the Sun,
				so it needs a planetary kernel with the Sun and the Earth.
			</Notice>
			<div className="min-h-54 flex-1">
				<Table columns={[{ key: 'rank', label: 'Precedence', numeric: true }, 'On', 'Name', 'Source', 'Bodies', 'Coverage', { key: 'size', label: 'Size', numeric: true }, 'Status']}>
					{ordered.map((kernel) => (
						<KernelRow key={kernel.id} rank={ranks.get(kernel.id)} kernel={kernel} selected={kernel.id === selected} onSelect={() => onSelect(kernel.id)} />
					))}
				</Table>
			</div>
			{kernel && <KernelSegments key={kernel.id} kernel={kernel} />}
		</>
	)
}

interface KernelRowProps {
	// Precedence among the enabled kernels, from 1, the highest; absent for a disabled kernel.
	readonly rank?: number
	readonly kernel: SpiceKernelSummary
	readonly selected: boolean
	readonly onSelect: () => void
}

// One installed kernel.
function KernelRow({ rank, kernel, selected, onSelect }: KernelRowProps) {
	const state = useSnapshot(spiceKernelsState)
	const readiness = READINESS[kernel.readiness]
	const bodies = kernel.targets.length > 3 ? `${kernel.targets.length} bodies` : kernel.targets.map(naifName).join(', ') || MISSING
	const coverage = kernel.start === undefined || kernel.end === undefined ? MISSING : `${epochDate(kernel.start)} – ${epochDate(kernel.end)}`

	return (
		<Row selected={selected} onSelect={onSelect} title={kernel.failure}>
			<Cell numeric>{rank ?? MISSING}</Cell>
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

// Ephemeris sources of the server and the storage of the library.
function Settings() {
	const state = useSnapshot(spiceKernelsState)
	const snapshot = state.snapshot
	if (!snapshot) return <EmptyState title="Loading" description="Reading the library of the server." />

	return (
		<section className="flex flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4">
			<h2 className="m-0 text-sm font-semibold text-ink-100">Ephemeris sources</h2>
			<Notice>Positions come from the kernels when they cover the object, the Earth, and the Sun. Otherwise the map, the planners, and the events use the analytical theories, then JPL Horizons; the selected object and mount targets use JPL Horizons, then the analytical theories.</Notice>
			<Checkbox label="Offline" checked={snapshot.offline} disabled={state.pending.settings} onChange={(offline) => void setEphemerisOffline(spiceKernelsState, offline)} />
			<Notice>Offline, no position, event, or plan asks JPL Horizons or SBDB: an object only the network can give is reported as unavailable.</Notice>
			{state.errors.settings && <Notice error>{state.errors.settings}</Notice>}
			<Notice>The switch applies to the whole server and every profile. Downloading or generating a kernel still needs the network. The library uses {formatByteSize(snapshot.bytes)} of the data directory.</Notice>
		</section>
	)
}
