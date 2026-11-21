import type { MinorBody, SpiceCatalogItem, SpiceCatalogSystem, SpiceKernelGenerationSource } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatByteSize } from '../../format'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { searchMinorBodies } from '../../sky/sky'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { Select } from '../../ui/Select'
import { Cell, Row, Table } from '../../ui/Table'
import { TextInput } from '../../ui/TextInput'
import { DEFAULT_WINDOW_MONTHS } from './elements'
import { ElementsImport } from './ElementsImport'
import { epochDate } from './format'
import { JobItem, Jobs } from './Jobs'
import { LibrarySection } from './LibrarySection'
import { activeJobs, downloadSpiceKernel, findJob, generateSpiceKernel, jobActive, spiceKernelsState } from './spicekernels'

// Add Kernel section of the SPICE Kernel Library tool: the acquisitions of the server with their progress first, then the
// curated NASA/JPL downloads (a selected one opens in the panel with its description, source, and Download), the
// generation of a small-body kernel over a window from today, by Horizons or by this server from the MPC Orbit Database,
// and the import of the MPC elements of numbered asteroids into one kernel. A started acquisition also shows its state
// where it was started, and leads to the kernel it added. Nothing is downloaded or generated without a click here.

interface AddKernelProps {
	// Curated downloads; undefined while they are read.
	readonly catalog?: readonly SpiceCatalogItem[]
	// Curated download shown in the panel, by id.
	readonly selected?: string
	readonly onSelect: (id: string) => void
	// Shows a kernel of the library in Installed.
	readonly onShowKernel: (id: string) => void
}

// Add Kernel section.
export function AddKernel({ catalog, selected, onSelect, onShowKernel }: AddKernelProps) {
	return (
		<>
			<Jobs onShowKernel={onShowKernel} />
			<Curated catalog={catalog} selected={selected} onSelect={onSelect} />
			<SmallBody onShowKernel={onShowKernel} />
			<ElementsImport onShowKernel={onShowKernel} />
		</>
	)
}

// Filter of the curated list: every system, or one.
type SystemFilter = 'all' | SpiceCatalogSystem

// Systems of the filter, in the order of the catalog.
const SYSTEM_FILTERS: readonly SystemFilter[] = ['all', 'planets', 'asteroids', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']

// Label of each system of the filter.
const SYSTEM_LABELS: Readonly<Record<SystemFilter, string>> = { all: 'All systems', planets: 'Planets', asteroids: 'Asteroids', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune', pluto: 'Pluto' }

// Whether item belongs to system and contains every word of query, case-insensitive, in its file name, bodies, or
// description.
function matches(item: SpiceCatalogItem, system: SystemFilter, query: string) {
	if (system !== 'all' && item.system !== system) return false
	const text = `${item.name} ${item.bodies} ${item.description}`.toLowerCase()
	return query
		.toLowerCase()
		.split(/\s+/)
		.every((word) => text.includes(word))
}

// Whether the download of a curated kernel is queued or running.
function useDownloading(id: string) {
	const state = useSnapshot(spiceKernelsState)
	return activeJobs(state.snapshot).some((e) => e.key === `download:${id}`)
}

interface CuratedProps {
	readonly catalog?: readonly SpiceCatalogItem[]
	readonly selected?: string
	readonly onSelect: (id: string) => void
}

// Curated NASA/JPL downloads: one compact row each, filtered by system and text; a selected one opens in the panel.
function Curated({ catalog, selected, onSelect }: CuratedProps) {
	const state = useSnapshot(spiceKernelsState)
	const [system, setSystem] = useState<SystemFilter>('all')
	const [query, setQuery] = useState('')
	const items = catalog ?? []
	const shown = items.filter((item) => matches(item, system, query.trim()))
	const installed = items.filter((e) => e.kernelId).length

	return (
		<LibrarySection
			title="Ephemerides from NASA/JPL"
			aside={
				<div className="flex flex-wrap items-end gap-2">
					<Select label="System" className="w-40 flex-none" options={SYSTEM_FILTERS} value={system} format={(e) => SYSTEM_LABELS[e]} onChange={setSystem} />
					<TextInput label="Search" className="w-60 max-sm:w-full" value={query} placeholder="File or body…" onChange={(e) => setQuery(e.target.value)} />
				</div>
			}
		>
			<p className="m-0 text-xs leading-4 text-ink-300">
				{items.length} planetary and satellite kernels of NAIF and the JPL Solar System Dynamics group, {installed} installed. Select one to read what it provides and where it comes from.
			</p>
			{shown.length > 0 ? (
				<Table
					columns={[
						'File',
						{ key: 'system', label: 'System', className: 'max-sm:hidden' },
						{ key: 'bodies', label: 'Bodies', className: 'max-md:hidden' },
						{ key: 'coverage', label: 'Coverage', className: 'max-sm:hidden' },
						{ key: 'size', label: 'Size', numeric: true, className: 'max-sm:hidden' },
						{ key: 'action', label: '' },
					]}
					className="max-h-[32rem]"
				>
					{shown.map((item) => (
						<CatalogRow key={item.id} item={item} selected={item.id === selected} onSelect={() => onSelect(item.id)} />
					))}
				</Table>
			) : (
				<Notice>{catalog === undefined ? 'Reading the catalog of the server.' : 'No kernel matches the filter.'}</Notice>
			)}
			{items.map(
				(item) =>
					state.errors[`download:${item.id}`] && (
						<Notice key={item.id} error>
							{item.name}: {state.errors[`download:${item.id}`]}
						</Notice>
					),
			)}
		</LibrarySection>
	)
}

interface CatalogRowProps {
	readonly item: SpiceCatalogItem
	// Whether it is shown in the panel.
	readonly selected: boolean
	readonly onSelect: () => void
}

// One curated download and its Download button, or Installed once the library has it.
function CatalogRow({ item, selected, onSelect }: CatalogRowProps) {
	const state = useSnapshot(spiceKernelsState)
	const key = `download:${item.id}`
	const running = useDownloading(item.id)

	return (
		<Row selected={selected} onSelect={onSelect}>
			<Cell className="text-ink-100 max-sm:break-all">{item.name}</Cell>
			<Cell className="max-sm:hidden">{SYSTEM_LABELS[item.system]}</Cell>
			<Cell className="max-w-96 truncate max-md:hidden" title={item.bodies}>
				{item.bodies}
			</Cell>
			<Cell className="whitespace-nowrap max-sm:hidden">
				{item.startYear}–{item.endYear}
			</Cell>
			<Cell numeric className="whitespace-nowrap max-sm:hidden">
				{formatByteSize(item.bytes)}
			</Cell>
			<Cell className="py-1 text-right">
				{item.kernelId ? (
					<span className="px-2 text-ink-300">Installed</span>
				) : (
					// The button downloads without selecting the row; small, so every row keeps the height of a text row.
					<span className="inline-flex" onClick={(event) => event.stopPropagation()}>
						<Button variant="secondary" size="sm" disabled={running || state.pending[key]} title={running ? 'Downloading; its progress is under Acquisitions' : `Downloads ${formatByteSize(item.bytes)} from NASA/JPL`} onClick={() => void downloadSpiceKernel(spiceKernelsState, item.id)}>
							{running ? 'Downloading…' : 'Download'}
						</Button>
					</span>
				)}
			</Cell>
		</Row>
	)
}

interface CatalogDetailsProps {
	readonly item: SpiceCatalogItem
	// Shows the installed kernel in Installed.
	readonly onShowKernel: (id: string) => void
}

// Panel of a curated download: what it provides and needs, where it comes from, and its Download, with the progress of
// its download while it runs.
export function CatalogDetails({ item, onShowKernel }: CatalogDetailsProps) {
	const state = useSnapshot(spiceKernelsState)
	const key = `download:${item.id}`
	const running = useDownloading(item.id)
	const job = activeJobs(state.snapshot).find((e) => e.key === key)

	return (
		<CollapsibleSection id="spiceKernels.catalog" title="Download" summary={item.kernelId ? 'Installed' : formatByteSize(item.bytes)}>
			<span className="min-w-0 text-sm font-medium wrap-break-word text-ink-100">{item.name}</span>
			<Notice>{item.description}</Notice>
			<DataList>
				<DataRow label="System">{SYSTEM_LABELS[item.system]}</DataRow>
				<DataRow label="Bodies">{item.bodies}</DataRow>
				<DataRow label="Coverage">
					{item.startYear}–{item.endYear}
				</DataRow>
				<DataRow label="Size">{formatByteSize(item.bytes)}</DataRow>
			</DataList>
			<span className="text-xs leading-4 break-all text-ink-300">{item.url}</span>
			{job && <JobItem job={job} onShowKernel={onShowKernel} />}
			{state.errors[key] && <Notice error>{state.errors[key]}</Notice>}
			<Actions>
				{item.kernelId ? (
					<Button variant="secondary" onClick={() => item.kernelId && onShowKernel(item.kernelId)}>
						Show in Installed
					</Button>
				) : (
					<Button disabled={running || state.pending[key]} title={running ? 'Downloading' : undefined} onClick={() => void downloadSpiceKernel(spiceKernelsState, item.id)}>
						{running ? 'Downloading…' : `Download ${formatByteSize(item.bytes)}`}
					</Button>
				)}
			</Actions>
		</CollapsibleSection>
	)
}

// Who integrates a generated kernel, in the order of the selector.
const GENERATION_SOURCES: readonly SpiceKernelGenerationSource[] = ['horizons', 'mpc']

// Label of each generation source.
const GENERATION_LABELS: Readonly<Record<SpiceKernelGenerationSource, string>> = { horizons: 'JPL Horizons', mpc: 'MPC orbit, integrated here' }

// What each generation source does, shown below the form.
const GENERATION_NOTES: Readonly<Record<SpiceKernelGenerationSource, string>> = {
	horizons: 'Horizons integrates the current JPL orbit of the body from today; the kernel is relative to the Sun, so positions also need a planetary kernel.',
	mpc: 'This server integrates the current MPC orbit of the body from today over the planetary kernels of the library, with the asteroids of sb441-n16.bsp when it is installed and the non-gravitational forces of the orbit; the kernel is relative to the Sun.',
}

// Outcome of an SBDB search that found no single body, for people: a miss or a failure.
interface SearchMessage {
	readonly text: string
	readonly error: boolean
}

// Generation of a small-body kernel: an SBDB search that resolves the body to its SPK-ID, then the source and the duration
// from today. An orbit is refined within months, so a kernel covers a short window and is generated again when it ends.
// The generation it starts shows its state below the form.
function SmallBody({ onShowKernel }: { readonly onShowKernel: (id: string) => void }) {
	const state = useSnapshot(spiceKernelsState)
	const [query, setQuery] = useState('')
	const [searching, setSearching] = useState(false)
	const [message, setMessage] = useState<SearchMessage>()
	const [matches, setMatches] = useState<readonly { readonly designation: string; readonly name: string }[]>([])
	const [body, setBody] = useState<MinorBody>()
	const [months, setMonths] = useState(DEFAULT_WINDOW_MONTHS)
	const [source, setSource] = useState<SpiceKernelGenerationSource>('horizons')
	const [jobId, setJobId] = useState<string>()
	const installed = body ? state.snapshot?.kernels.filter((e) => e.targets.includes(Number(body.spkId))) : undefined
	const job = findJob(state.snapshot, jobId)
	const running = job !== undefined && jobActive(job)

	async function search(text: string) {
		if (!text.trim()) return
		setSearching(true)
		setMessage(undefined)
		setMatches([])
		setBody(undefined)
		setJobId(undefined)

		try {
			const result = await searchMinorBodies(text.trim(), AbortSignal.timeout(30_000))
			if (result.kind === 'found') setBody(result.body)
			else if (result.kind === 'ambiguous') setMatches(result.matches)
			else setMessage({ text: `SBDB has no asteroid or comet called “${text.trim()}”. Check the spelling, or search by number or designation, such as 433 or 1P.`, error: false })
		} catch (error) {
			setMessage({ text: `SBDB could not be reached${Error.isError(error) && error.message ? `: ${error.message.replace(/\.$/, '')}` : ''}. Search again when the server is online.`, error: true })
		} finally {
			setSearching(false)
		}
	}

	async function generate(body: MinorBody) {
		const started = await generateSpiceKernel(spiceKernelsState, { spkId: body.spkId, name: body.name, designation: body.designation, source, months })
		if (started) setJobId(started.jobId)
	}

	return (
		<LibrarySection title="Asteroid or comet">
			<form
				onSubmit={(event) => {
					event.preventDefault()
					void search(query)
				}}
				className="flex flex-wrap items-end gap-2"
			>
				<TextInput label="Name, number, or designation" className="w-72 max-sm:w-full" value={query} placeholder="Ceres, 433, 1P/Halley…" onChange={(e) => setQuery(e.target.value)} />
				<Button type="submit" variant="secondary" disabled={searching || !query.trim()} title={query.trim() ? undefined : 'Enter a name, number, or designation'}>
					{searching ? 'Searching…' : 'Search SBDB'}
				</Button>
			</form>
			{message && (
				<Notice error={message.error} warning={!message.error}>
					{message.text}
				</Notice>
			)}
			{matches.length > 0 && (
				<>
					<Notice>Several bodies match; choose one.</Notice>
					<div className="flex flex-wrap gap-2">
						{matches.map((match) => (
							<Button
								key={match.designation}
								variant="secondary"
								onClick={() => {
									setQuery(match.name)
									void search(match.designation)
								}}
							>
								{match.name}
							</Button>
						))}
					</div>
				</>
			)}
			{body && (
				<>
					<p className="m-0 text-sm text-ink-100">
						{body.name} · SPK-ID {body.spkId}
					</p>
					{installed && installed.length > 0 && <Notice>Already covered by {installed.map((e) => `${e.name}${e.start !== undefined && e.end !== undefined ? ` (${epochDate(e.start)} – ${epochDate(e.end)})` : ''}`).join(', ')}.</Notice>}
					<div className="flex flex-wrap items-end gap-2">
						<Select label="Integrated by" className="w-56" options={GENERATION_SOURCES} value={source} format={(e) => GENERATION_LABELS[e]} onChange={setSource} />
						<NumberInput label="Duration from today" className="w-48" value={months} onChange={(value) => setMonths(value)} min={1} max={60} suffix="months" />
						<Button disabled={state.pending.generate || running} title={running ? 'This generation is running; its state is below' : undefined} onClick={() => void generate(body)}>
							{running ? 'Generating…' : 'Generate'}
						</Button>
					</div>
					<Notice className="max-w-3xl">{GENERATION_NOTES[source]}</Notice>
				</>
			)}
			{job && <JobItem job={job} onShowKernel={onShowKernel} />}
			{state.errors.generate && <Notice error>{state.errors.generate}</Notice>}
		</LibrarySection>
	)
}
