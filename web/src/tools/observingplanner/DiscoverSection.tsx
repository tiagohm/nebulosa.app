import type { SkyCatalogClass } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatAngularSize, formatHours, formatSpan } from '../../format'
import type { SiteLocation } from '../../location/site'
import { formatMagnitude } from '../../sky/format'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table, type TableColumn } from '../../ui/Table'
import { TextInput } from '../../ui/TextInput'
import { formatScore } from './format'
import { analyze, CATALOG_CLASSES, CLASS_LABELS, type DiscoverSource, discover, listCatalog, minorBodyTarget, type NamedTarget, type ObservingPlannerState, observingPlannerState, STATUS_LABELS, searchMinorBody, stopDiscovery } from './observingplanner'

// Discover section of the Observing Planner: the static catalog listing, which needs no location, and the best targets of
// the night, evaluated by the server in batches that add up. The coverage line says how many objects were evaluated of how
// many match, so a partial ranking is never shown as the whole catalog's. Asteroids and comets are not ranked: they are
// looked up one at a time in the Small-Body Database, then analyzed or added like any other target.

// Columns of the best targets.
const CANDIDATE_COLUMNS: readonly TableColumn[] = ['Target', 'Type', { key: 'magnitude', label: 'Mag', numeric: true }, { key: 'score', label: 'Score', numeric: true }, 'Best window', { key: 'longest', label: 'Longest', numeric: true }, 'Status', { key: 'actions', label: '' }]

// Columns of the catalog listing.
const CATALOG_COLUMNS: readonly TableColumn[] = ['Target', 'Type', 'Const.', { key: 'magnitude', label: 'Mag', numeric: true }, { key: 'size', label: 'Size', numeric: true }, { key: 'actions', label: '' }]

// What Discover can list, in display order, and the label of each.
const DISCOVER_SOURCES: readonly DiscoverSource[] = ['catalog', 'minorBodies']
const DISCOVER_SOURCE_LABELS: Readonly<Record<DiscoverSource, string>> = { catalog: 'Sky Catalog', minorBodies: 'Asteroids & Comets' }

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

// Catalog listing and best targets of the night.
function CatalogDiscovery({ location, timeZone, onAdd }: DiscoverSectionProps) {
	const state = useSnapshot(observingPlannerState) as ObservingPlannerState
	const { filter, discovery, catalog } = state
	const ready = !!location && !!state.eveningDate && !!state.constraints

	// Toggles a class of the filter.
	function toggleClass(value: SkyCatalogClass, checked: boolean) {
		const classes = observingPlannerState.filter.classes
		observingPlannerState.filter.classes = checked ? [...classes, value] : classes.filter((e) => e !== value)
	}

	return (
		<div className="flex flex-col gap-4">
			<section className="flex flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4">
				<div className="flex flex-wrap items-end gap-3">
					<TextInput label="Name or designation" className="min-w-48 flex-1" value={filter.text} placeholder="M 42, Orion, NGC 253…" onChange={(event) => (observingPlannerState.filter.text = event.target.value)} />
					<NumberInput label="Faintest magnitude" className="w-40" value={filter.maximumMagnitude} min={-2} max={20} step={0.5} onChange={(value) => (observingPlannerState.filter.maximumMagnitude = value)} />
				</div>
				<div className="flex flex-wrap gap-x-4 gap-y-2">
					{CATALOG_CLASSES.map((value) => (
						<Checkbox key={value} label={CLASS_LABELS[value]} checked={filter.classes.includes(value)} onChange={(checked) => toggleClass(value, checked)} />
					))}
					<Checkbox label="Unknown magnitudes" checked={filter.includeUnknownMagnitude} onChange={(checked) => (observingPlannerState.filter.includeUnknownMagnitude = checked)} />
					<Checkbox label="Moon and planets" checked={filter.includeBodies} onChange={(checked) => (observingPlannerState.filter.includeBodies = checked)} />
				</div>
				<div className="flex flex-wrap gap-2">
					<Button disabled={!ready || state.discoveryLoading} title={ready ? undefined : 'Choose a location to rank the targets of a night'} onClick={() => location && void discover(observingPlannerState, location)}>
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
				<p className="m-0 text-xs text-ink-300">Computed locally from the sky catalog and the analytical ephemerides; nothing is asked of the network or of a device.</p>
			</section>
			{state.discoveryError && <Notice error>{state.discoveryError}</Notice>}
			{discovery && (
				<section className="flex flex-col gap-2">
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<h3 className="m-0 text-sm font-medium text-ink-100">Best targets</h3>
						<span className="text-xs text-ink-300">
							Evaluated {discovery.evaluated} of {discovery.total} · {discovery.candidates.length} observable
						</span>
					</div>
					{discovery.candidates.length === 0 ? (
						<Notice>No target evaluated so far is observable with these constraints.</Notice>
					) : (
						<Table columns={CANDIDATE_COLUMNS}>
							{discovery.candidates.map((candidate) => {
								const best = candidate.windows.find((window) => window.bestAt === candidate.bestAt) ?? candidate.windows[0]
								const target = { target: candidate.target, name: candidate.name }
								return (
									<Row key={JSON.stringify(candidate.target)}>
										<Cell>
											<span className="text-ink-100">{candidate.name}</span>
											{candidate.constellation && <span className="text-ink-300"> · {candidate.constellation}</span>}
										</Cell>
										<Cell>{candidate.typeName ?? CLASS_LABELS[candidate.class]}</Cell>
										<Cell numeric>{candidate.magnitude === undefined ? '—' : formatMagnitude(candidate.magnitude)}</Cell>
										<Cell numeric>{formatScore(candidate.score)}</Cell>
										<Cell>{best ? formatSpan(best.start, best.end, timeZone) : '—'}</Cell>
										<Cell numeric>{formatHours(candidate.longestWindowMs)}</Cell>
										<Cell>
											<StatusBadge tone={STATUS_LABELS[candidate.status].tone} label={STATUS_LABELS[candidate.status].label} />
										</Cell>
										<Cell>
											<TargetActions target={target} location={location} onAdd={onAdd} />
										</Cell>
									</Row>
								)
							})}
						</Table>
					)}
					{discovery.nextCursor && (
						<Button variant="secondary" className="self-start" disabled={state.discoveryLoading} onClick={() => location && void discover(observingPlannerState, location, true)}>
							{state.discoveryLoading ? 'Evaluating…' : 'Evaluate More'}
						</Button>
					)}
				</section>
			)}
			{!discovery && state.discoveryLoading && <p className="m-0 text-sm text-ink-300">Evaluating the first targets…</p>}
			{state.catalogError && <Notice error>{state.catalogError}</Notice>}
			{catalog && (
				<section className="flex flex-col gap-2">
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<h3 className="m-0 text-sm font-medium text-ink-100">Catalog</h3>
						<span className="text-xs text-ink-300">
							{catalog.entries.length} of {catalog.total}
						</span>
					</div>
					<Table columns={CATALOG_COLUMNS}>
						{catalog.entries.map((entry) => (
							<Row key={entry.ref.id}>
								<Cell>
									<span className="text-ink-100">{entry.name}</span>
									{entry.designations.length > 0 && <span className="text-ink-300"> · {entry.designations.join(', ')}</span>}
								</Cell>
								<Cell>{entry.typeName}</Cell>
								<Cell>{entry.constellation ?? '—'}</Cell>
								<Cell numeric>{entry.magnitude === undefined ? 'Unknown' : formatMagnitude(entry.magnitude)}</Cell>
								<Cell numeric>{entry.majorAxis === undefined ? '—' : formatAngularSize(entry.majorAxis)}</Cell>
								<Cell>
									<TargetActions target={{ target: entry.ref, name: entry.name }} location={location} onAdd={onAdd} />
								</Cell>
							</Row>
						))}
					</Table>
					{catalog.nextCursor && (
						<Button variant="secondary" className="self-start" disabled={state.catalogLoading} onClick={() => void listCatalog(observingPlannerState, true)}>
							More
						</Button>
					)}
				</section>
			)}
		</div>
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
				className="flex flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4"
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
				<p className="m-0 text-xs text-ink-300">Looked up in the JPL Small-Body Database. An analysis uses the SPK kernels, JPL Horizons, or saved orbital elements, as the ephemeris policy of the SPICE Kernel Library allows.</p>
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
				<section className="flex flex-wrap items-start justify-between gap-3 rounded-sm border border-line-100 bg-base-100 p-4">
					<div className="min-w-0">
						<h3 className="m-0 text-base font-medium wrap-break-word text-ink-100">{result.body.name}</h3>
						<p className="m-0 text-xs text-ink-300">
							{result.body.kind === 'comet' ? 'Comet' : 'Asteroid'} · {result.body.orbitClass} · SPK-ID {result.body.spkId} · Orbit solution {result.body.solutionDate}
						</p>
					</div>
					<TargetActions target={minorBodyTarget(result.body)} location={location} onAdd={onAdd} />
				</section>
			)}
		</div>
	)
}

// Actions of a target of a listing: analyze it over the night, or add it to a plan.
function TargetActions({ target, location, onAdd }: { readonly target: NamedTarget; readonly location?: SiteLocation; readonly onAdd: (target: NamedTarget) => void }) {
	return (
		<div className="flex justify-end gap-2">
			<Button variant="ghost" disabled={!location} onClick={() => location && void analyze(observingPlannerState, location, target)}>
				Analyze
			</Button>
			<Button variant="ghost" onClick={() => onAdd(target)}>
				Add
			</Button>
		</div>
	)
}
