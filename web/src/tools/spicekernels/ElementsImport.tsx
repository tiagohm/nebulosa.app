import type { SpiceElementList, SpiceElementsObject, SpiceElementsPreview } from 'api'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatByteSize, formatFixed } from '../../format'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { Pager } from '../../ui/Pager'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { Cell, Row, Table } from '../../ui/Table'
import { TextInput } from '../../ui/TextInput'
import { DEFAULT_WINDOW_MONTHS, ELEMENTS_PAGE_SIZE, elementsEstimate, elementsPage, filterElements, MAX_IMPORTED_OBJECTS, markAll, markedElements, toggleMarked } from './elements'
import { JobItem } from './Jobs'
import { LibrarySection } from './LibrarySection'
import { downloadElements, fetchElementLists, findJob, integrateElements, jobActive, parseElementsFile, type SpiceElementsAnswer, spiceKernelsState } from './spicekernels'

// Asteroid elements section of Add Kernel: the MPC 1-line elements of an MPC list the server downloads or of a file of the
// operator, read by the server into the numbered asteroids they hold, shown page by page to mark the ones to integrate,
// then integrated by the server into one kernel over a window from today, whose state shows below the form. The preview is
// transient: it lives in this view only, and nothing is downloaded or integrated without a click.

// Where the elements come from.
type ElementsSource = 'list' | 'file'

// Sources of the selector, in order.
const SOURCES: readonly ElementsSource[] = ['list', 'file']

// Label of each source.
const SOURCE_NAMES: Readonly<Record<ElementsSource, string>> = { list: 'MPC list', file: 'File' }

// Julian date of the Unix epoch, to write the epoch of elements as a calendar date.
const UNIX_EPOCH_JULIAN_DATE = 2440587.5

// A preview and where it came from: the id of the list or the name of the file, and the default name of the kernel.
interface LoadedElements {
	readonly preview: SpiceElementsPreview
	readonly sourceRef: string
	readonly label: string
}

// Calendar date (YYYY-MM-DD) of a Julian date, in its own time scale.
function epochDate(julianDate: number) {
	return new Date((julianDate - UNIX_EPOCH_JULIAN_DATE) * 86_400_000).toISOString().slice(0, 10)
}

// Duration of an estimate, rounded for people.
function formatDuration(seconds: number) {
	return seconds < 60 ? `${Math.max(1, Math.round(seconds))} s` : `${Math.round(seconds / 60)} min`
}

interface ElementsImportProps {
	// Shows the kernel an integration added in Installed.
	readonly onShowKernel: (id: string) => void
}

// Asteroid elements section.
export function ElementsImport({ onShowKernel }: ElementsImportProps) {
	const state = useSnapshot(spiceKernelsState)
	const [source, setSource] = useState<ElementsSource>('list')
	const [lists, setLists] = useState<readonly SpiceElementList[]>([])
	const [listId, setListId] = useState<string>()
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string>()
	const [loaded, setLoaded] = useState<LoadedElements>()
	const input = useRef<HTMLInputElement>(null)

	useEffect(() => {
		void fetchElementLists().then((items) => {
			setLists(items)
			setListId((current) => current ?? items[0]?.id)
		})
	}, [])

	// Reads elements and shows their preview, or why they could not be read.
	async function load(read: () => Promise<SpiceElementsAnswer>, sourceRef: string, label: string) {
		setLoading(true)
		setError(undefined)

		try {
			const answer = await read()
			if (answer.ok) setLoaded({ preview: answer.preview, sourceRef, label })
			else setError(answer.error)
		} finally {
			setLoading(false)
		}
	}

	const list = lists.find((e) => e.id === listId)

	return (
		<LibrarySection title="Asteroid elements from the MPC">
			<Notice className="max-w-3xl">MPC 1-line (MPCORB) elements of an MPC list or a file; only numbered asteroids are imported. The marked ones are integrated by this server into one kernel over the planetary kernels of the library.</Notice>
			<div className="flex flex-wrap items-end gap-2">
				<SegmentedControl label="Source" options={SOURCES} value={source} format={(e) => SOURCE_NAMES[e]} onChange={setSource} />
				{source === 'list' ? (
					<>
						<Select
							label="List"
							className="w-96"
							options={lists.map((e) => e.id)}
							value={listId ?? ''}
							format={(id) => {
								const item = lists.find((e) => e.id === id)
								return item ? `${item.title} · ${formatByteSize(item.bytes)}` : id
							}}
							onChange={setListId}
							disabled={lists.length === 0}
						/>
						<Button variant="secondary" disabled={!list || loading} onClick={() => list && void load(() => downloadElements(list.id), list.id, list.title)}>
							{loading ? 'Downloading…' : 'Download'}
						</Button>
					</>
				) : (
					<>
						<input
							ref={input}
							type="file"
							accept=".txt,.dat,text/plain"
							className="hidden"
							onChange={(event) => {
								const file = event.target.files?.[0]
								event.target.value = ''
								if (file) void load(() => parseElementsFile(file), file.name, file.name)
							}}
						/>
						<Button variant="secondary" disabled={loading} onClick={() => input.current?.click()}>
							{loading ? 'Reading…' : 'Choose file…'}
						</Button>
					</>
				)}
			</div>
			{error && <Notice error>{error}</Notice>}
			{loaded && <ElementsPreview key={`${loaded.sourceRef}:${loaded.preview.objects.length}`} loaded={loaded} onShowKernel={onShowKernel} />}
			{state.errors.integrate && <Notice error>{state.errors.integrate}</Notice>}
		</LibrarySection>
	)
}

interface ElementsPreviewProps {
	readonly loaded: LoadedElements
	// Shows the kernel the integration added in Installed.
	readonly onShowKernel: (id: string) => void
}

// The numbered asteroids of a preview to mark, page by page, and the integration of the marked ones.
function ElementsPreview({ loaded, onShowKernel }: ElementsPreviewProps) {
	const state = useSnapshot(spiceKernelsState)
	const { objects, skipped } = loaded.preview
	const [query, setQuery] = useState('')
	const [page, setPage] = useState(0)
	const [marked, setMarked] = useState<ReadonlySet<number>>(() => new Set())
	const [label, setLabel] = useState(loaded.label)
	const [months, setMonths] = useState(DEFAULT_WINDOW_MONTHS)
	const [jobId, setJobId] = useState<string>()
	const job = findJob(state.snapshot, jobId)
	const running = job !== undefined && jobActive(job)
	const shown = useMemo(() => filterElements(objects, query), [objects, query])
	const rows = elementsPage(shown, page)
	const estimate = elementsEstimate(marked.size, months)
	const left = [skipped.unnumbered > 0 && `${skipped.unnumbered} unnumbered`, skipped.malformed > 0 && `${skipped.malformed} unreadable`].filter(Boolean).join(' and ')
	const blocked = marked.size === 0 ? 'Mark the asteroids to integrate' : !label.trim() ? 'Name the kernel' : running ? 'This integration is running; its state is below' : undefined

	function mark(number: number, checked: boolean) {
		setMarked((current) => toggleMarked(current, number, checked))
	}

	async function integrate() {
		const started = await integrateElements(spiceKernelsState, { label: label.trim(), sourceRef: loaded.sourceRef, objects: markedElements(objects, marked), months })
		if (started) setJobId(started.jobId)
	}

	return (
		<div className="flex flex-col gap-3">
			<p className="m-0 text-xs text-ink-300">
				{objects.length} numbered asteroids
				{left ? `; left out ${left} lines` : ''}.
			</p>
			{objects.length > 0 && (
				<>
					<div className="flex flex-wrap items-end gap-2">
						<TextInput
							label="Search"
							className="w-60"
							value={query}
							placeholder="Number or name…"
							onChange={(e) => {
								setQuery(e.target.value)
								setPage(0)
							}}
						/>
						<Button variant="secondary" disabled={marked.size >= MAX_IMPORTED_OBJECTS} onClick={() => setMarked((current) => markAll(current, shown))}>
							{query.trim() ? 'Mark all found' : 'Mark all'}
						</Button>
						<Button variant="secondary" disabled={marked.size === 0} onClick={() => setMarked(new Set())}>
							Unmark all
						</Button>
					</div>
					<Table columns={[{ key: 'mark', label: '' }, 'Asteroid', { key: 'h', label: 'H', numeric: true }, { key: 'a', label: 'a (AU)', numeric: true }, { key: 'e', label: 'e', numeric: true }, { key: 'i', label: 'i (°)', numeric: true }, 'Epoch (TT)']} className="max-h-96">
						{rows.map((object) => (
							<ElementsRow key={object.number} object={object} checked={marked.has(object.number)} onMark={mark} />
						))}
					</Table>
					<Pager page={page} total={shown.length} pageSize={ELEMENTS_PAGE_SIZE} noun="asteroids" onPage={setPage} />
					<div className="flex flex-wrap items-end gap-2">
						<TextInput label="Kernel name" className="w-72 max-sm:w-full" value={label} onChange={(e) => setLabel(e.target.value)} />
						<NumberInput label="Duration from today" className="w-48" value={months} onChange={(value) => setMonths(value)} min={1} max={60} suffix="months" />
						<Button disabled={blocked !== undefined || state.pending.integrate} title={blocked} onClick={() => void integrate()}>
							{running ? 'Integrating…' : `Integrate ${marked.size} ${marked.size === 1 ? 'asteroid' : 'asteroids'}`}
						</Button>
					</div>
					{job && <JobItem job={job} onShowKernel={onShowKernel} />}
					<p className="m-0 max-w-3xl text-xs leading-4 text-ink-300">
						{marked.size > 0 ? `About ${formatDuration(estimate.seconds)} and ${formatByteSize(estimate.bytes)}. ` : ''}
						The elements carry no non-gravitational forces; the planets, the Moon, and the Sun's relativistic term are integrated, at most {MAX_IMPORTED_OBJECTS} asteroids at once. Generate the kernel again when the window ends, from the newer elements.
					</p>
				</>
			)}
		</div>
	)
}

// One asteroid of the preview and its mark; selecting the row toggles the mark.
function ElementsRow({ object, checked, onMark }: { readonly object: SpiceElementsObject; readonly checked: boolean; readonly onMark: (number: number, checked: boolean) => void }) {
	return (
		<Row selected={checked} onSelect={() => onMark(object.number, !checked)}>
			<Cell>
				<span className="inline-flex" onClick={(event) => event.stopPropagation()}>
					<Checkbox label={`Mark ${object.name}`} hideLabel checked={checked} onChange={(value) => onMark(object.number, value)} />
				</span>
			</Cell>
			<Cell className="text-ink-100">{object.name}</Cell>
			<Cell numeric>{formatFixed(object.h, 2)}</Cell>
			<Cell numeric>{formatFixed(object.a, 4)}</Cell>
			<Cell numeric>{formatFixed(object.e, 4)}</Cell>
			<Cell numeric>{formatFixed(object.i, 2)}</Cell>
			<Cell>{epochDate(object.epoch)}</Cell>
		</Row>
	)
}
