import type { ObservingCandidate, SkyCatalogClass } from 'api'
import { cn } from 'cn'
import { type ReactNode, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatAngularSize, formatHours, formatSpan, MISSING } from '../../format'
import type { Framing } from '../../framing/geometry'
import type { SiteLocation } from '../../location/site'
import { formatMagnitude } from '../../sky/format'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { IconButton } from '../../ui/IconButton'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, SortHeader, Table, type TableColumn } from '../../ui/Table'
import { TextInput } from '../../ui/TextInput'
import { formatScore } from './format'
import { FitLabel, FrameLine, fitOf, usePlannerFrame } from './FramingParts'
import {
	analyze,
	CANDIDATE_SORT_KEYS,
	CANDIDATE_SORT_LABELS,
	CATALOG_CLASSES,
	type CandidateSortKey,
	CLASS_LABELS,
	type DiscoverSource,
	discover,
	discoveryStale,
	listCatalog,
	minorBodyTarget,
	type NamedTarget,
	type ObservingPlannerState,
	observingPlannerState,
	STATUS_LABELS,
	searchMinorBody,
	sortCandidates,
	stopDiscovery,
} from './observingplanner'

// Discover section of the Observing Planner: the static catalog listing, which needs no location, and the best targets of
// the night, evaluated by the server in batches that add up. The coverage line says how many objects were evaluated of how
// many match, so a partial ranking is never shown as the whole catalog's. A target is analyzed by choosing its row and
// added to a plan with its own button. Each target with a known size says how it fits the field of view the profile plans
// with (the Equipment Setup's, or the active Sky Framing preset), which also breaks ties of the score. Wide screens show
// tables whose headers sort the best targets; phones show the same targets as two-line rows. Asteroids and comets are not ranked: they are looked up one at a time in the Small-Body
// Database, then analyzed or added like any other target.

// Columns of the catalog listing.
const CATALOG_COLUMNS: readonly TableColumn[] = ['Target', 'Type', 'Const.', { key: 'magnitude', label: 'Mag', numeric: true }, { key: 'size', label: 'Size', numeric: true }, 'Framing', { key: 'actions', label: '' }]

// What Discover can list, in display order, and the label of each.
const DISCOVER_SOURCES: readonly DiscoverSource[] = ['catalog', 'minorBodies']
const DISCOVER_SOURCE_LABELS: Readonly<Record<DiscoverSource, string>> = { catalog: 'Sky Catalog', minorBodies: 'Asteroids & Comets' }

// Uppercase label of a group of controls, the field label style.
const GROUP_LABEL = 'm-0 text-xs font-medium tracking-[0.08em] text-ink-200 uppercase'

export interface DiscoverSectionProps {
	// Location of the tool; undefined without one, which leaves only the catalog listing.
	readonly location?: SiteLocation
	// IANA zone the times are shown in.
	readonly timeZone: string
	// Asks to add a target to a plan.
	readonly onAdd: (target: NamedTarget) => void
}

// Discover section of the Observing Planner.
export function DiscoverSection({ location, timeZone, onAdd }: DiscoverSectionProps) {
	const state = useSnapshot(observingPlannerState) as ObservingPlannerState

	return (
		<div className="flex flex-col gap-4">
			<SegmentedControl className="self-start" options={DISCOVER_SOURCES} value={state.discoverSource} format={(source) => DISCOVER_SOURCE_LABELS[source]} onChange={(source) => (observingPlannerState.discoverSource = source)} />
			{state.discoverSource === 'minorBodies' ? <MinorBodySearch location={location} onAdd={onAdd} /> : <CatalogDiscovery location={location} timeZone={timeZone} onAdd={onAdd} />}
		</div>
	)
}

// Analyzes a target over the tool's night when there is a location.
function analyzeTarget(location: SiteLocation | undefined, target: NamedTarget) {
	if (location) void analyze(observingPlannerState, location, target)
}

// Catalog listing and best targets of the night.
function CatalogDiscovery({ location, timeZone, onAdd }: DiscoverSectionProps) {
	const state = useSnapshot(observingPlannerState) as ObservingPlannerState
	const { filter, discovery, catalog } = state
	const ready = !!location && !!state.eveningDate && !!state.constraints
	const stale = discoveryStale(state, location)
	const frame = usePlannerFrame()

	// Toggles a class of the filter.
	function toggleClass(value: SkyCatalogClass, checked: boolean) {
		const classes = observingPlannerState.filter.classes
		observingPlannerState.filter.classes = checked ? [...classes, value] : classes.filter((e) => e !== value)
	}

	return (
		<div className="flex flex-col gap-4">
			<section className="flex flex-col gap-3 rounded-md border border-line-100 bg-base-100 p-4">
				<div className="flex flex-wrap items-end gap-3">
					<TextInput label="Name or designation" className="min-w-48 flex-1" value={filter.text} placeholder="M 42, Orion, NGC 253…" onChange={(event) => (observingPlannerState.filter.text = event.target.value)} />
					<NumberInput label="Faintest magnitude" className="w-40" value={filter.maximumMagnitude} min={-2} max={20} step={0.5} onChange={(value) => (observingPlannerState.filter.maximumMagnitude = value)} />
				</div>
				<div className="flex flex-wrap gap-x-8 gap-y-3">
					<div className="flex flex-col gap-2">
						<p className={GROUP_LABEL}>Classes</p>
						<div className="flex flex-wrap gap-x-4 gap-y-2">
							{CATALOG_CLASSES.map((value) => (
								<Checkbox key={value} label={CLASS_LABELS[value]} checked={filter.classes.includes(value)} onChange={(checked) => toggleClass(value, checked)} />
							))}
						</div>
					</div>
					<div className="flex flex-col gap-2">
						<p className={GROUP_LABEL}>Also include</p>
						<div className="flex flex-wrap gap-x-4 gap-y-2">
							<Checkbox label="Moon and planets" checked={filter.includeBodies} onChange={(checked) => (observingPlannerState.filter.includeBodies = checked)} />
							<Checkbox label="Unknown magnitudes" checked={filter.includeUnknownMagnitude} onChange={(checked) => (observingPlannerState.filter.includeUnknownMagnitude = checked)} />
						</div>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button disabled={!ready || state.discoveryLoading} title={ready ? undefined : 'Set the observing site of this profile to rank the targets of a night'} onClick={() => location && void discover(observingPlannerState, location)}>
						Find Best Targets
					</Button>
					<Button variant="secondary" disabled={state.catalogLoading} onClick={() => void listCatalog(observingPlannerState)}>
						List Catalog
					</Button>
					{state.discoveryLoading && (
						<Button variant="secondary" onClick={() => stopDiscovery(observingPlannerState)}>
							Stop
						</Button>
					)}
				</div>
				<Notice>Computed locally from the sky catalog and the analytical ephemerides; nothing is asked of the network or of a device.</Notice>
			</section>
			{state.discoveryError && <Notice error>{state.discoveryError}</Notice>}
			{discovery && (
				<section className="flex flex-col gap-2">
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<h2 className="m-0 text-base font-medium text-ink-100">Best targets</h2>
						<span className="text-xs text-ink-300 tabular-nums">
							Evaluated {discovery.evaluated} of {discovery.total} · {discovery.candidates.length} observable
						</span>
					</div>
					{stale && (
						<div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/60 px-3 py-2">
							<span className="text-sm text-warning">These results are for an earlier night, constraints, or filter.</span>
							<Button variant="secondary" disabled={!ready || state.discoveryLoading} onClick={() => location && void discover(observingPlannerState, location)}>
								Find Again
							</Button>
						</div>
					)}
					<FrameLine frame={frame} />
					{discovery.candidates.length === 0 ? <Notice>No target evaluated so far is observable with these constraints.</Notice> : <Candidates candidates={discovery.candidates} frame={frame.frame} stale={stale} location={location} timeZone={timeZone} onAdd={onAdd} />}
					{discovery.nextCursor && (
						<Button
							variant="secondary"
							className="self-start"
							disabled={state.discoveryLoading || stale}
							title={stale ? 'These results are for an earlier night, constraints, or filter; find the best targets again first' : undefined}
							onClick={() => location && void discover(observingPlannerState, location, true)}
						>
							{state.discoveryLoading ? 'Evaluating…' : `Evaluate ${Math.min(100, discovery.total - discovery.evaluated)} More`}
						</Button>
					)}
				</section>
			)}
			{!discovery && state.discoveryLoading && <p className="m-0 text-sm text-ink-300">Evaluating the first targets…</p>}
			{state.catalogError && <Notice error>{state.catalogError}</Notice>}
			{catalog && (
				<section className="flex flex-col gap-2">
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<h2 className="m-0 text-base font-medium text-ink-100">Catalog</h2>
						<span className="text-xs text-ink-300 tabular-nums">
							{catalog.entries.length} of {catalog.total}
						</span>
					</div>
					<Table columns={CATALOG_COLUMNS} className="max-sm:hidden">
						{catalog.entries.map((entry) => {
							const target = { target: entry.ref, name: entry.name }
							return (
								<Row key={entry.ref.id} onSelect={location ? () => analyzeTarget(location, target) : undefined} title={location ? `Analyze ${entry.name}` : undefined}>
									<Cell>
										<span className="text-ink-100">{entry.name}</span>
										{entry.designations.length > 0 && <span className="text-ink-300"> · {entry.designations.join(', ')}</span>}
									</Cell>
									<Cell>{entry.typeName}</Cell>
									<Cell>{entry.constellation ?? MISSING}</Cell>
									<Cell numeric>{entry.magnitude === undefined ? 'Unknown' : formatMagnitude(entry.magnitude)}</Cell>
									<Cell numeric>{entry.majorAxis === undefined ? MISSING : formatAngularSize(entry.majorAxis)}</Cell>
									<Cell>
										<FitLabel assessment={fitOf(entry, frame.frame)} frame={frame.frame} />
									</Cell>
									<Cell>
										<AddButton target={target} onAdd={onAdd} />
									</Cell>
								</Row>
							)
						})}
					</Table>
					<TargetList>
						{catalog.entries.map((entry) => {
							const target = { target: entry.ref, name: entry.name }
							return (
								<TargetListItem key={entry.ref.id} target={target} location={location} onAdd={onAdd} aside={entry.constellation}>
									<span>{entry.typeName}</span>
									<span>Mag {entry.magnitude === undefined ? 'unknown' : formatMagnitude(entry.magnitude)}</span>
									{entry.majorAxis !== undefined && <span>{formatAngularSize(entry.majorAxis)}</span>}
									<FitLabel assessment={fitOf(entry, frame.frame)} frame={frame.frame} badge={false} />
								</TargetListItem>
							)
						})}
					</TargetList>
					{catalog.nextCursor && (
						<Button variant="secondary" className="self-start" disabled={state.catalogLoading} onClick={() => void listCatalog(observingPlannerState, true)}>
							List 50 More
						</Button>
					)}
				</section>
			)}
		</div>
	)
}

// Properties of the best targets.
interface CandidatesProps {
	// Candidates, in the server's ranking.
	readonly candidates: readonly ObservingCandidate[]
	// Field of view their fits are judged against; absent when unknown.
	readonly frame?: Framing
	// Whether they were found for another night, constraints, or filter.
	readonly stale: boolean
	// Location of the tool, which an analysis needs.
	readonly location?: SiteLocation
	// IANA zone the times are shown in.
	readonly timeZone: string
	// Asks to add a target to a plan.
	readonly onAdd: (target: NamedTarget) => void
}

// Best targets of the night, in the order chosen: a table whose headers sort it on wide screens, two-line rows with an
// order selector on phones.
function Candidates({ candidates, frame, stale, location, timeZone, onAdd }: CandidatesProps) {
	const sort = (useSnapshot(observingPlannerState) as ObservingPlannerState).candidateSort
	const fits = new Map(candidates.map((candidate) => [candidate, fitOf(candidate, frame)]))
	const sorted = sortCandidates(candidates, sort, (candidate) => fits.get(candidate)?.factor)

	// Orders by a quantity, or reverses the order when it is the one already chosen.
	function sortBy(key: CandidateSortKey) {
		observingPlannerState.candidateSort = { key, reversed: sort.key === key && !sort.reversed }
	}

	// Header of a sortable column.
	const header = (key: CandidateSortKey, label: string, numeric = false) => ({
		key,
		numeric,
		label: (
			<SortHeader title={`Order by ${label.toLowerCase()}`} direction={sort.key !== key ? undefined : sort.reversed ? 'up' : 'down'} onClick={() => sortBy(key)}>
				{label}
			</SortHeader>
		),
	})
	const columns: readonly TableColumn[] = [header('name', 'Target'), 'Type', header('magnitude', 'Mag', true), header('size', 'Size', true), header('framing', 'Framing'), header('score', 'Score', true), header('best', 'Best window'), header('longest', 'Longest', true), 'Status', { key: 'add', label: '' }]

	return (
		<div className={cn('flex flex-col gap-2', stale && 'opacity-60')}>
			<Table columns={columns} className="max-sm:hidden">
				{sorted.map((candidate) => {
					const best = candidate.windows.find((window) => window.bestAt === candidate.bestAt) ?? candidate.windows[0]
					const target = { target: candidate.target, name: candidate.name }
					return (
						<Row key={JSON.stringify(candidate.target)} onSelect={location ? () => analyzeTarget(location, target) : undefined} title={location ? `Analyze ${candidate.name}` : undefined}>
							<Cell>
								<span className="text-ink-100">{candidate.name}</span>
								{candidate.constellation && <span className="text-ink-300"> · {candidate.constellation}</span>}
							</Cell>
							<Cell>{candidate.typeName ?? CLASS_LABELS[candidate.class]}</Cell>
							<Cell numeric>{candidate.magnitude === undefined ? MISSING : formatMagnitude(candidate.magnitude)}</Cell>
							<Cell numeric>{candidate.majorAxis === undefined ? MISSING : formatAngularSize(candidate.majorAxis)}</Cell>
							<Cell>
								<FitLabel assessment={fits.get(candidate)} frame={frame} />
							</Cell>
							<Cell numeric className="text-ink-100">
								{formatScore(candidate.score)}
							</Cell>
							<Cell>{best ? formatSpan(best.start, best.end, timeZone) : MISSING}</Cell>
							<Cell numeric>{formatHours(candidate.longestWindowMs)}</Cell>
							<Cell>
								<StatusBadge tone={STATUS_LABELS[candidate.status].tone} label={STATUS_LABELS[candidate.status].label} />
							</Cell>
							<Cell>
								<AddButton target={target} onAdd={onAdd} />
							</Cell>
						</Row>
					)
				})}
			</Table>
			<div className="flex items-end gap-2 sm:hidden">
				<Select label="Order" options={CANDIDATE_SORT_KEYS} value={sort.key} format={(key) => CANDIDATE_SORT_LABELS[key]} onChange={(key) => (observingPlannerState.candidateSort = { key, reversed: false })} />
				<IconButton icon="arrow" label={sort.reversed ? 'Natural order' : 'Reverse the order'} pressed={sort.reversed} className={cn('size-[33.25px]', !sort.reversed && 'rotate-180')} onClick={() => sortBy(sort.key)} />
			</div>
			<TargetList>
				{sorted.map((candidate) => {
					const best = candidate.windows.find((window) => window.bestAt === candidate.bestAt) ?? candidate.windows[0]
					return (
						<TargetListItem key={JSON.stringify(candidate.target)} target={{ target: candidate.target, name: candidate.name }} location={location} onAdd={onAdd} aside={candidate.constellation} status={<StatusBadge tone={STATUS_LABELS[candidate.status].tone} label={STATUS_LABELS[candidate.status].label} />}>
							<span>
								Score <span className="text-ink-100">{formatScore(candidate.score)}</span>
							</span>
							{best && <span>{formatSpan(best.start, best.end, timeZone)}</span>}
							<span>{formatHours(candidate.longestWindowMs)}</span>
							{candidate.majorAxis !== undefined && <span>{formatAngularSize(candidate.majorAxis)}</span>}
							<FitLabel assessment={fits.get(candidate)} frame={frame} badge={false} />
						</TargetListItem>
					)
				})}
			</TargetList>
		</div>
	)
}

// Button adding a target to a plan.
function AddButton({ target, onAdd, className }: { readonly target: NamedTarget; readonly onAdd: (target: NamedTarget) => void; readonly className?: string }) {
	return (
		<IconButton
			icon="plus"
			label={`Add ${target.name} to a plan`}
			className={className}
			onClick={(event) => {
				event.stopPropagation()
				onAdd(target)
			}}
		/>
	)
}

// List of targets on phones.
function TargetList({ children }: { readonly children: ReactNode }) {
	return <ul className="m-0 flex list-none flex-col rounded-md border border-line-100 p-0 sm:hidden">{children}</ul>
}

// Properties of a target of the phone list.
interface TargetListItemProps {
	// Target.
	readonly target: NamedTarget
	// Location of the tool, which an analysis needs.
	readonly location?: SiteLocation
	// Asks to add the target to a plan.
	readonly onAdd: (target: NamedTarget) => void
	// Short text after the name, such as the constellation.
	readonly aside?: string
	// Status beside the name.
	readonly status?: ReactNode
	// Values of the second line.
	readonly children: ReactNode
}

// Target of the phone list on two lines: its name and status, then its values. The row analyzes it; its button adds it to a plan.
function TargetListItem({ target, location, onAdd, aside, status, children }: TargetListItemProps) {
	return (
		<li className="flex items-center border-b border-line-100 last:border-b-0">
			<button
				type="button"
				disabled={!location}
				title={location ? `Analyze ${target.name}` : 'Set the observing site of this profile to analyze targets'}
				onClick={() => analyzeTarget(location, target)}
				className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 px-3 py-2.5 text-left hover:bg-base-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:hover:bg-transparent"
			>
				<span className="flex min-w-0 items-start gap-2">
					<span className="min-w-0 text-sm wrap-break-word text-ink-100">{target.name}</span>
					{aside && <span className="mt-0.5 flex-none text-xs text-ink-300">{aside}</span>}
					{status && <span className="ml-auto flex-none">{status}</span>}
				</span>
				<span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-300 tabular-nums">{children}</span>
			</button>
			<AddButton target={target} onAdd={onAdd} className="mr-1 size-11" />
		</li>
	)
}

// Lookup of asteroids and comets in SBDB: one found body to analyze or add, candidates to choose from, or why none.
function MinorBodySearch({ location, onAdd }: Pick<DiscoverSectionProps, 'location' | 'onAdd'>) {
	const search = (useSnapshot(observingPlannerState) as ObservingPlannerState).minorBodySearch
	const [text, setText] = useState(search.text)
	const result = search.result

	// Searches a text, keeping it in the field.
	function find(query: string) {
		setText(query)
		void searchMinorBody(observingPlannerState, query)
	}

	return (
		<div className="flex flex-col gap-4">
			<form
				className="flex flex-col gap-3 rounded-md border border-line-100 bg-base-100 p-4"
				onSubmit={(event) => {
					event.preventDefault()
					find(text)
				}}
			>
				<div className="flex flex-wrap items-end gap-3">
					<TextInput label="Name, designation, or SPK-ID" className="min-w-48 flex-1" value={text} placeholder="4 Vesta, C/1995 O1, 2000433…" onChange={(event) => setText(event.target.value)} />
					<Button type="submit" disabled={search.loading || text.trim().length < 2}>
						{search.loading ? 'Searching…' : 'Search'}
					</Button>
				</div>
				<Notice>Looked up in the JPL Small-Body Database. An analysis uses the SPK kernels, JPL Horizons, or saved orbital elements; offline, JPL is never asked.</Notice>
			</form>
			{search.error && <Notice error>{search.error}</Notice>}
			{result?.kind === 'notFound' && <Notice>{result.message || 'No asteroid or comet matches this text.'}</Notice>}
			{result?.kind === 'ambiguous' && (
				<section className="flex flex-col gap-2">
					<p className="m-0 text-sm text-ink-200">Several bodies match. Choose one:</p>
					<div className="flex flex-wrap gap-2">
						{result.matches.map((match) => (
							<Button key={match.designation} variant="secondary" disabled={search.loading} onClick={() => find(match.designation)}>
								{match.name || match.designation}
							</Button>
						))}
					</div>
				</section>
			)}
			{result?.kind === 'found' && (
				<section className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-line-100 bg-base-100 p-4">
					<div className="min-w-0">
						<h2 className="m-0 text-base font-medium wrap-break-word text-ink-100">{result.body.name}</h2>
						<Notice>
							{result.body.kind === 'comet' ? 'Comet' : 'Asteroid'} · {result.body.orbitClass} · SPK-ID {result.body.spkId} · Orbit solution {result.body.solutionDate}
						</Notice>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button variant="secondary" disabled={!location} title={location ? undefined : 'Set the observing site of this profile to analyze targets'} onClick={() => analyzeTarget(location, minorBodyTarget(result.body))}>
							Analyze
						</Button>
						<Button variant="secondary" onClick={() => onAdd(minorBodyTarget(result.body))}>
							Add to Plan
						</Button>
					</div>
				</section>
			)}
		</div>
	)
}
