import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { downloadText } from '../../download'
import { formatDate, formatGeographic } from '../../format'
import { openObservingSites, type SiteLocation } from '../../location/site'
import { TimeZoneSelect } from '../../location/TimeZoneSelect'
import { ToolLocationSection } from '../../location/ToolLocationSection'
import { useActiveSite, useDisplayZone, useToolLocation } from '../../location/useLocation'
import { describeDisplayZone } from '../../location/zone'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { TextInput } from '../../ui/TextInput'
import { openKernelLibrary } from '../planetary/planetary'
import { spiceKernelsState } from '../spicekernels/spicekernels'
import { PlanetaryEventDetails } from './PlanetaryEventDetails'
import {
	clearVisibility,
	dateInput,
	dayStart,
	EVENT_BODIES,
	EVENT_KINDS,
	initialize,
	listedEvents,
	loadSearch,
	loadSeries,
	loadVisibility,
	monthOf,
	type PlanetaryEventsState,
	planetaryEventsState,
	RANGE_MONTHS,
	type RangeMonths,
	rangeEnd,
	selectEvent,
	siteKey,
	startAtSkyTime,
	THRESHOLD_DEGREES,
	VISIBILITY_FILTERS,
	type VisibilityFilter,
} from './planetaryevents'
import { BODY_LABELS, describeSource, eventsCsv, KIND_LABELS, sourceName } from './planetaryevents.format'
import { PlanetaryEventsCalendar } from './PlanetaryEventsCalendar'
import { PlanetaryEventsTimeline } from './PlanetaryEventsTimeline'

// Planetary Events tool: the almanac phenomena of Mercury to Neptune over a range, as a list or a month, with how each
// can be watched from the tool's location. The server finds every event at its geocentric instant from one ephemeris
// source it names; a site and a display zone only add visibility and format. The range opens on real now; nothing here
// moves the mount, changes a site or the profile, or changes the Sky clock unless asked for an event's time.

// Name of each visibility filter.
const FILTER_LABELS: Readonly<Record<VisibilityFilter, string>> = { all: 'All events', observable: 'Observable at the event or nearby', notObservable: 'Not observable', unknown: 'Unknown (no site)' }

// Name of each range length.
const MONTH_LABELS: Readonly<Record<RangeMonths, string>> = { 1: '1 month', 3: '3 months', 6: '6 months', 12: '12 months', 24: '24 months' }

// Planetary Events tool.
export function PlanetaryEvents() {
	const state = useSnapshot(planetaryEventsState) as PlanetaryEventsState
	const kernels = useSnapshot(spiceKernelsState)
	const location = useToolLocation(state.location)
	const active = useActiveSite()
	const displayZone = useDisplayZone(location, state.zone)
	const zone = displayZone.zone
	const site: SiteLocation | undefined = location && { name: location.name, latitude: location.latitude, longitude: location.longitude, elevation: location.elevation, timeZone: location.timeZone }
	const activeSite: SiteLocation | undefined = active && { name: active.name, latitude: active.latitude, longitude: active.longitude, elevation: active.elevation, timeZone: active.timeZone }
	const place = site && siteKey(site)
	// A new kernel generation or policy may change every event, so the search is read again.
	const kernelKey = `${kernels.snapshot?.generation ?? -1}|${kernels.snapshot?.policy ?? ''}`

	// The range opens on real now, once.
	useEffect(() => initialize(planetaryEventsState), [])

	// The events follow the range, the planets, the kinds, the threshold, and the kernels.
	useEffect(() => {
		void loadSearch(planetaryEventsState)
	}, [state.start, state.months, state.bodies.join(), state.kinds.join(), state.thresholdDegrees, kernelKey])

	// The visibility follows the answer and the site's place, never the zone.
	useEffect(() => {
		if (!site) clearVisibility(planetaryEventsState)
		else if (state.search) void loadVisibility(planetaryEventsState, site)
	}, [state.search, place])

	const answer = state.search
	const selected = answer?.events.find((e) => e.id === state.selected)

	// The curve follows the selected event and the kernels.
	useEffect(() => {
		if (selected) void loadSeries(planetaryEventsState, selected)
	}, [selected?.id, kernelKey])

	const events = answer ? listedEvents(answer.events, state.visibilityFilter, state.visibility) : []
	const signature = answer?.signature
	const source = signature?.source
	const start = state.start
	const end = start === undefined ? undefined : rangeEnd(start, state.months)
	const firstMonth = start === undefined ? undefined : monthOf(start, zone)
	const lastMonth = end === undefined ? undefined : monthOf(end - 1, zone)
	const month = state.month && firstMonth && lastMonth && state.month >= firstMonth && state.month <= lastMonth ? state.month : firstMonth

	const toggle = <T extends string>(list: readonly T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((e) => e !== value))

	const exportCsv = () => {
		if (!answer || start === undefined) return
		downloadText(eventsCsv(events, state.visibility?.byId, site ? (site.name ?? 'Coordinates entered') : undefined, signature), `planetary-events-${formatDate(start, 'UTC')}.csv`, 'text/csv')
	}

	const panel = (
		<>
			<ToolLocationSection value={state.location} location={location} onChange={(value) => (planetaryEventsState.location = value)} collapsibleId="planetaryEvents.location" elevation hint="Only decides when the events can be watched; the events are geocentric." />
			<CollapsibleSection id="planetaryEvents.timeZone" title="Time Zone" summary={zone} defaultOpen={false}>
				<TimeZoneSelect label="Times Shown In" value={state.zone} onChange={(value) => (planetaryEventsState.zone = value)} site={location} selectedSite={location ? location.source !== 'active' : false} />
			</CollapsibleSection>
			<CollapsibleSection id="planetaryEvents.range" title="Range" summary={start === undefined ? undefined : `${formatDate(start, zone)} · ${MONTH_LABELS[state.months]}`}>
				<TextInput
					label="Start"
					type="date"
					value={start === undefined ? '' : dateInput(start, zone)}
					onChange={(e) => {
						const time = e.currentTarget.value ? dayStart(e.currentTarget.value, zone) : undefined
						if (time !== undefined) planetaryEventsState.start = time
					}}
				/>
				<Select label="Length" options={RANGE_MONTHS.map(String) as `${RangeMonths}`[]} value={String(state.months) as `${RangeMonths}`} format={(value) => MONTH_LABELS[Number(value) as RangeMonths]} onChange={(value) => (planetaryEventsState.months = Number(value) as RangeMonths)} />
				<Actions>
					<Button variant="secondary" onClick={() => (planetaryEventsState.start = Date.now())}>
						From Now
					</Button>
					<Button variant="secondary" onClick={() => startAtSkyTime(planetaryEventsState)}>
						Use Sky Time
					</Button>
				</Actions>
			</CollapsibleSection>
			<CollapsibleSection id="planetaryEvents.planets" title="Planets" summary={`${state.bodies.length} of ${EVENT_BODIES.length}`}>
				{EVENT_BODIES.map((code) => (
					<Checkbox key={code} label={BODY_LABELS[code]} checked={state.bodies.includes(code)} onChange={(on) => (planetaryEventsState.bodies = EVENT_BODIES.filter((e) => (e === code ? on : state.bodies.includes(e))))} />
				))}
			</CollapsibleSection>
			<CollapsibleSection id="planetaryEvents.kinds" title="Events" summary={`${state.kinds.length} of ${EVENT_KINDS.length} kinds`}>
				{EVENT_KINDS.map((kind) => (
					<Checkbox key={kind} label={KIND_LABELS[kind]} checked={state.kinds.includes(kind)} onChange={(on) => (planetaryEventsState.kinds = toggle(state.kinds, kind, on))} />
				))}
				<NumberInput label="Appulse threshold" value={state.thresholdDegrees} min={THRESHOLD_DEGREES.min} max={THRESHOLD_DEGREES.max} step={0.1} suffix="°" onChange={(value) => (planetaryEventsState.thresholdDegrees = value)} />
				<p className="m-0 text-xs text-ink-300">Appulses wider than the threshold are not listed; conjunctions always are.</p>
			</CollapsibleSection>
			<CollapsibleSection id="planetaryEvents.visibility" title="Visibility" summary={FILTER_LABELS[state.visibilityFilter]} defaultOpen={false}>
				<Select label="Show" options={VISIBILITY_FILTERS} value={state.visibilityFilter} format={(value: VisibilityFilter) => FILTER_LABELS[value]} onChange={(value) => (planetaryEventsState.visibilityFilter = value)} />
			</CollapsibleSection>
			<CollapsibleSection id="planetaryEvents.ephemeris" title="Ephemeris and Definitions" summary={sourceName(signature)} defaultOpen={false}>
				<p className="m-0 text-xs text-ink-300">{describeSource(signature) ?? 'Not computed yet.'}</p>
				<p className="m-0 text-xs text-ink-300">
					Local only: the SPICE kernels you installed or the VSOP87E theory, never JPL Horizons. Policy: {signature?.policy ?? '—'}. Model version {signature?.modelVersion ?? '—'}.
				</p>
				<p className="m-0 text-xs text-ink-300">
					Events are geocentric apparent (light time, aberration, solar deflection) on the true ecliptic of date; conjunctions, oppositions, and quadratures are defined by ecliptic longitude, an appulse by the least separation, the closest approach by the geometric distance. Times are refined far below a
					second, but shown to the minute: VSOP87E and the kernels can differ by seconds to minutes.
				</p>
				<p className="m-0 text-xs text-ink-300">The site never changes an event's time; it only says when its planets can be watched.</p>
				<Button variant="secondary" onClick={() => openKernelLibrary()}>
					Manage Kernels
				</Button>
			</CollapsibleSection>
		</>
	)

	const actions = (
		<Actions>
			<Button variant="secondary" disabled={!answer || events.length === 0} onClick={exportCsv}>
				Export CSV
			</Button>
		</Actions>
	)

	const context = <SegmentedControl options={['timeline', 'calendar'] as const} value={state.view} format={(value) => (value === 'timeline' ? 'Timeline' : 'Calendar')} onChange={(value) => (planetaryEventsState.view = value)} />

	return (
		<WorkspaceLayout workspace="tools" title="Planetary Events" context={context} actions={actions} panel={{ title: 'Location, Range, and Filters', content: panel }}>
			<div className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
					<p className="m-0 flex flex-wrap items-center gap-2 text-xs text-ink-300">
						{source && <StatusBadge tone={source.kind === 'spk' ? 'success' : 'neutral'} label={sourceName(signature)!} />}
						<span>{location ? `${location.name ?? 'Coordinates entered'} · ${formatGeographic(location.latitude, location.longitude)}` : 'No site: global events only'}</span>
						<span>· {describeDisplayZone(displayZone)}</span>
						{start !== undefined && end !== undefined && (
							<span>
								· {formatDate(start, zone)} to {formatDate(end, zone)}
							</span>
						)}
						{state.searchLoading && <span>· computing the events…</span>}
						{state.visibilityLoading && <span>· computing the visibility…</span>}
					</p>
					{!location && (
						<Notice>
							<span className="block">{state.location.mode === 'active' ? 'Without a site the events are listed without their local visibility. Set the observing site of this profile, or choose a location in the panel.' : 'The site chosen was deleted. Choose another location in the panel.'}</span>
							<Button variant="secondary" className="mt-2" onClick={() => openObservingSites()}>
								Set Location
							</Button>
						</Notice>
					)}
					{state.kernelsRefused && (
						<Notice error>
							<span className="block">{state.searchError} The ephemeris policy allows only SPICE kernels, so nothing is computed from VSOP87E.</span>
							<Button variant="secondary" className="mt-2" onClick={() => openKernelLibrary()}>
								Manage Kernels
							</Button>
						</Notice>
					)}
					{state.searchError && !state.kernelsRefused && <Notice error>{state.searchError}</Notice>}
					{state.visibilityError && <Notice error>{state.visibilityError}</Notice>}
					{answer && events.length === 0 && <Notice>{answer.events.length === 0 ? 'No event of the chosen planets and kinds falls in this range.' : 'No event passes the visibility filter.'}</Notice>}
					<div className="flex flex-col gap-4">
						<div className="flex min-w-0 flex-col gap-2">
							{answer && events.length > 0 && state.view === 'timeline' && <PlanetaryEventsTimeline events={events} visibility={state.visibility} selected={state.selected} timeZone={zone} onSelect={(id) => selectEvent(planetaryEventsState, id)} />}
							{answer && state.view === 'calendar' && month && firstMonth && lastMonth && (
								<PlanetaryEventsCalendar month={month} events={events} selected={state.selected} timeZone={zone} first={firstMonth} last={lastMonth} onMonth={(value) => (planetaryEventsState.month = value)} onSelect={(id) => selectEvent(planetaryEventsState, id)} />
							)}
							{!answer && state.searchLoading && <p className="m-0 text-xs text-ink-300">Computing the events of the range…</p>}
						</div>
						<div className="flex min-w-0 flex-col gap-2">
							{answer && selected ? (
								<PlanetaryEventDetails
									event={selected}
									all={answer.events}
									visibility={state.visibility?.byId[selected.id]}
									hasSite={!!site}
									visibilityLoading={state.visibilityLoading}
									series={state.series}
									seriesLoading={state.seriesLoading}
									seriesError={state.seriesError}
									signature={signature}
									timeZone={zone}
									site={activeSite}
									onSelect={(id) => selectEvent(planetaryEventsState, id)}
								/>
							) : (
								answer && events.length > 0 && <p className="m-0 text-xs text-ink-300">Choose an event to see its circumstances, when it can be watched, and its curve.</p>
							)}
						</div>
					</div>
				</div>
			</div>
		</WorkspaceLayout>
	)
}
