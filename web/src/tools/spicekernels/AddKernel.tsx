import type { MinorBody, SpiceCatalogItem, SpiceCatalogSystem, SpiceKernelGenerationSource, SpiceKernelJob } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatByteSize } from '../../format'
import { searchMinorBodies } from '../../sky/sky'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { ProgressBar } from '../../ui/ProgressBar'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { TextInput } from '../../ui/TextInput'
import { DEFAULT_WINDOW_MONTHS } from './elements'
import { ElementsImport } from './ElementsImport'
import { epochDate, JOB_STATE_LABELS } from './format'
import { activeJobs, cancelSpiceKernelJob, downloadSpiceKernel, fetchSpiceCatalog, generateSpiceKernel, spiceKernelsState } from './spicekernels'

// Add Kernel section of the SPICE Kernel Library tool: the curated NASA/JPL downloads, the generation of a small-body
// kernel over a window from today, by Horizons or by this server from the MPC Orbit Database, the import of the MPC
// elements of numbered asteroids into one kernel, and the acquisitions of the server with their progress. Nothing is
// downloaded or generated without a click here.

// Add Kernel section.
export function AddKernel() {
	return (
		<>
			<Curated />
			<SmallBody />
			<ElementsImport />
			<Jobs />
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

// Curated NASA/JPL downloads: one compact row each, filtered by system and text, with the description and source of the
// selected one below the list.
function Curated() {
	const state = useSnapshot(spiceKernelsState)
	const [catalog, setCatalog] = useState<readonly SpiceCatalogItem[]>([])
	const [system, setSystem] = useState<SystemFilter>('all')
	const [query, setQuery] = useState('')
	const [selected, setSelected] = useState<string>()
	const shown = catalog.filter((item) => matches(item, system, query.trim()))
	const chosen = catalog.find((e) => e.id === selected)
	const installed = catalog.filter((e) => e.kernelId).length

	useEffect(() => {
		const controller = new AbortController()
		void fetchSpiceCatalog(controller.signal).then((items) => !controller.signal.aborted && setCatalog(items))
		return () => controller.abort()
	}, [state.revision])

	return (
		<section className="flex flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4 min-h-0">
			<div className="flex flex-wrap items-end justify-between gap-3 flex-1">
				<div className="flex flex-col gap-1">
					<h2 className="m-0 text-sm font-semibold text-ink-100">Ephemerides from NASA/JPL</h2>
					<p className="m-0 text-xs text-ink-300">
						{catalog.length} planetary and satellite kernels of NAIF and the JPL Solar System Dynamics group, {installed} installed
					</p>
				</div>
				<div className="flex flex-wrap items-end gap-2">
					<Select label="System" className="w-40" options={SYSTEM_FILTERS} value={system} format={(e) => SYSTEM_LABELS[e]} onChange={setSystem} />
					<TextInput label="Search" className="w-60" value={query} placeholder="File or body…" onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
				</div>
			</div>
			{shown.length > 0 ? (
				<Table columns={['File', 'System', 'Bodies', 'Coverage', { key: 'size', label: 'Size', numeric: true }, { key: 'action', label: '' }]} className="min-h-0 flex-1">
					{shown.map((item) => (
						<CatalogRow key={item.id} item={item} selected={item.id === selected} onSelect={() => setSelected(item.id)} />
					))}
				</Table>
			) : (
				<p className="m-0 text-sm text-ink-300">{catalog.length === 0 ? 'Reading the catalog of the server.' : 'No kernel matches the filter.'}</p>
			)}
			{chosen ? (
				<div className="flex flex-col gap-1">
					<span className="text-sm text-ink-100">
						{chosen.name} · {chosen.bodies}
					</span>
					<span className="text-xs leading-4 text-ink-300">{chosen.description}</span>
					<span className="text-xs leading-4 break-all text-ink-300">{chosen.url}</span>
				</div>
			) : (
				shown.length > 0 && <p className="m-0 text-xs text-ink-300">Select a kernel to read what it provides and where it comes from.</p>
			)}
			{catalog.map(
				(item) =>
					state.errors[`download:${item.id}`] && (
						<Notice key={item.id} error>
							{item.name}: {state.errors[`download:${item.id}`]}
						</Notice>
					),
			)}
		</section>
	)
}

interface CatalogRowProps {
	readonly item: SpiceCatalogItem
	// Whether its description is shown below the list.
	readonly selected: boolean
	readonly onSelect: () => void
}

// One curated download and its Download button, or Installed once the library has it.
function CatalogRow({ item, selected, onSelect }: CatalogRowProps) {
	const state = useSnapshot(spiceKernelsState)
	const key = `download:${item.id}`
	const running = activeJobs(state.snapshot).some((e) => e.key === key)

	return (
		<Row selected={selected} onSelect={onSelect}>
			<Cell className="text-ink-100">{item.name}</Cell>
			<Cell>{SYSTEM_LABELS[item.system]}</Cell>
			<Cell className="max-w-96 truncate" title={item.bodies}>
				{item.bodies}
			</Cell>
			<Cell>
				{item.startYear}–{item.endYear}
			</Cell>
			<Cell numeric>{formatByteSize(item.bytes)}</Cell>
			<Cell className="py-1 text-right">
				{item.kernelId ? (
					<StatusBadge tone="success" label="Installed" />
				) : (
					// The button downloads without selecting the row; small, so every row keeps the height of the Installed badge.
					<span className="inline-flex" onClick={(event) => event.stopPropagation()}>
						<Button variant="secondary" size="sm" disabled={running || state.pending[key]} onClick={() => void downloadSpiceKernel(spiceKernelsState, item.id)}>
							{running ? 'Downloading…' : 'Download'}
						</Button>
					</span>
				)}
			</Cell>
		</Row>
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

// Generation of a small-body kernel: an SBDB search that resolves the body to its SPK-ID, then the source and the duration
// from today. An orbit is refined within months, so a kernel covers a short window and is generated again when it ends.
function SmallBody() {
	const state = useSnapshot(spiceKernelsState)
	const [query, setQuery] = useState('')
	const [searching, setSearching] = useState(false)
	const [message, setMessage] = useState<string>()
	const [matches, setMatches] = useState<readonly { readonly designation: string; readonly name: string }[]>([])
	const [body, setBody] = useState<MinorBody>()
	const [months, setMonths] = useState(DEFAULT_WINDOW_MONTHS)
	const [source, setSource] = useState<SpiceKernelGenerationSource>('horizons')
	const installed = body ? state.snapshot?.kernels.filter((e) => e.targets.includes(Number(body.spkId))) : undefined

	async function search(text: string) {
		if (!text.trim()) return
		setSearching(true)
		setMessage(undefined)
		setMatches([])

		try {
			const result = await searchMinorBodies(text.trim(), AbortSignal.timeout(30_000))
			if (result.kind === 'found') setBody(result.body)
			else if (result.kind === 'ambiguous') setMatches(result.matches)
			else setMessage(result.message)
		} catch (error) {
			setMessage(Error.isError(error) ? error.message : 'SBDB could not be reached.')
		} finally {
			setSearching(false)
		}
	}

	return (
		<section className="flex flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4">
			<h2 className="m-0 text-sm font-semibold text-ink-100">Asteroid or comet</h2>
			<form
				onSubmit={(event) => {
					event.preventDefault()
					void search(query)
				}}
				className="flex flex-wrap items-end gap-2"
			>
				<TextInput label="Asteroid or comet" className="w-72" value={query} placeholder="Ceres, 433, 1P/Halley…" onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
				<Button type="submit" variant="secondary" disabled={searching || !query.trim()}>
					{searching ? 'Searching…' : 'Search SBDB'}
				</Button>
			</form>
			{message && <Notice>{message}</Notice>}
			{matches.length > 0 && (
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
			)}
			{body && (
				<>
					<p className="m-0 text-sm text-ink-100">
						{body.name} · SPK-ID {body.spkId}
					</p>
					{installed && installed.length > 0 && <Notice>Already covered by {installed.map((e) => `${e.name}${e.start !== undefined && e.end !== undefined ? ` (${epochDate(e.start)} – ${epochDate(e.end)})` : ''}`).join(', ')}.</Notice>}
					<div className="flex flex-wrap items-end gap-2">
						<Select label="Integrated by" className="w-56" options={GENERATION_SOURCES} value={source} format={(e) => GENERATION_LABELS[e]} onChange={setSource} />
						<NumberInput label="Duration from today" className="w-44" value={months} onChange={(value) => setMonths(value)} min={1} max={60} suffix="mo" />
						<Button disabled={state.pending.generate} onClick={() => void generateSpiceKernel(spiceKernelsState, { spkId: body.spkId, name: body.name, designation: body.designation, source, months })}>
							Generate
						</Button>
					</div>
					<Notice>{GENERATION_NOTES[source]}</Notice>
				</>
			)}
			{state.errors.generate && <Notice error>{state.errors.generate}</Notice>}
		</section>
	)
}

// Acquisitions of the server: the active ones with their progress, then the latest ended ones.
function Jobs() {
	const state = useSnapshot(spiceKernelsState)
	const jobs = state.snapshot?.jobs ?? []
	if (jobs.length === 0) return null

	return (
		<section className="flex flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4">
			<h2 className="m-0 text-sm font-semibold text-ink-100">Acquisitions</h2>
			<ul className="m-0 flex list-none flex-col gap-3 p-0">
				{jobs.map((job) => (
					<JobItem key={job.jobId} job={job} />
				))}
			</ul>
		</section>
	)
}

// One acquisition.
function JobItem({ job }: { readonly job: SpiceKernelJob }) {
	const state = useSnapshot(spiceKernelsState)
	const active = job.state !== 'completed' && job.state !== 'failed' && job.state !== 'cancelled'
	const fraction = job.bytes !== undefined && job.totalBytes ? job.bytes / job.totalBytes : undefined
	const outcome = job.state === 'completed' && job.alreadyInstalled ? 'Already installed' : job.state === 'running' && job.unit === 'objects' ? 'Integrating' : JOB_STATE_LABELS[job.state]

	return (
		<li className="flex flex-col gap-1">
			<div className="flex items-center justify-between gap-3 text-sm">
				<span className="min-w-0 truncate text-ink-100">{job.label}</span>
				<span className="flex items-center gap-3">
					<span className={job.state === 'failed' ? 'text-danger' : 'text-ink-300'}>
						{outcome}
						{job.state === 'running' && job.bytes !== undefined ? ` · ${job.unit === 'objects' ? `${job.bytes} of ${job.totalBytes ?? '?'} objects` : formatByteSize(job.bytes)}` : ''}
					</span>
					{active && (
						<Button variant="secondary" disabled={state.pending[`job:${job.jobId}`]} onClick={() => void cancelSpiceKernelJob(spiceKernelsState, job.jobId)}>
							Cancel
						</Button>
					)}
				</span>
			</div>
			{active && <ProgressBar fraction={job.state === 'running' ? fraction : undefined} />}
			{job.error && <Notice error>{job.error}</Notice>}
		</li>
	)
}
