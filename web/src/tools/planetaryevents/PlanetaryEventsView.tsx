import { useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { downloadText } from '../../download'
import { formatDate, MISSING } from '../../format'
import { openObservingSites, type SiteLocation } from '../../location/site'
import { useActiveLocation, useDisplayZone } from '../../location/useLocation'
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
	unmatchedKinds,
	VISIBILITY_FILTERS,
	type VisibilityFilter,
} from './planetaryevents'
import { BODY_LABELS, describeSource, eventsCsv, KIND_LABELS, sourceName, unmatchedSentence } from './planetaryevents.format'
import { PlanetaryEventsCalendar } from './PlanetaryEventsCalendar'
import { PlanetaryEventsTimeline } from './PlanetaryEventsTimeline'

// Planetary Events tool: the almanac phenomena of Mercury to Neptune over a range, as a list or a month, with how each
// can be watched from the tool's location. The server finds every event at its geocentric instant from one ephemeris
// source it names; a site and a display zone only add visibility and format. The range opens on real now; nothing here
// moves the mount, changes a site or the profile, or changes the Sky clock unless asked for an event's time.
// The content fits the width of the workspace (`@container/events`): from 64 rem the list and the inspector stand side by
// side, each filling the height and scrolling itself; below it they stack, the list capped so the inspector follows close,
// and choosing an event brings the inspector into view when it is out of sight.

// Name of each visibility filter, above the list beside the count of the events listed.
const FILTER_LABELS: Readonly<Record<VisibilityFilter, string>> = { all: 'All', observable: 'Observable', notObservable: 'Not observable' }

// What each visibility filter keeps, as its tooltip.
const FILTER_TITLES: Readonly<Record<VisibilityFilter, string>> = {
	all: 'Every event of the range',
	observable: 'The events observable from the site at their instant or nearby',
	notObservable: 'The events that cannot be watched from the site, including the conjunctions with the Sun',
}

// Name of each range length.
const MONTH_LABELS: Readonly<Record<RangeMonths, string>> = { 1: '1 month', 3: '3 months', 6: '6 months', 12: '12 months', 24: '24 months' }

// Planetary Events tool.
export function PlanetaryEvents() {
	const state = useSnapshot(planetaryEventsState) as PlanetaryEventsState
	const kernels = useSnapshot(spiceKernelsState)
	const location = useActiveLocation()
	const displayZone = useDisplayZone(location)
	const zone = displayZone.zone
	const site: SiteLocation | undefined = location && { name: location.name, latitude: location.latitude, longitude: location.longitude, elevation: location.elevation, timeZone: location.timeZone }
	const place = site && siteKey(site)
	// A new kernel generation may change every event, so the search is read again.
	const kernelKey = `${kernels.snapshot?.generation ?? -1}`

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

	const events = answer ? listedEvents(answer.events, state.visibilityFilter, state.visibility, !!site) : []
	const signature = answer?.signature
	const source = signature?.source
	const start = state.start
	const end = start === undefined ? undefined : rangeEnd(start, state.months)
	const firstMonth = start === undefined ? undefined : monthOf(start, zone)
	const lastMonth = end === undefined ? undefined : monthOf(end - 1, zone)
	const month = state.month && firstMonth && lastMonth && state.month >= firstMonth && state.month <= lastMonth ? state.month : firstMonth

	const toggle = <T extends string>(list: readonly T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((e) => e !== value))
	const scroller = useRef<HTMLDivElement>(null)
	const inspector = useRef<HTMLDivElement>(null)

	// Selects an event and brings the inspector to it: its own pane back to the top when it scrolls itself beside the list,
	// else the page down to it when its top is out of sight.
	const choose = (id: string) => {
		selectEvent(planetaryEventsState, id)
		requestAnimationFrame(() => {
			const pane = inspector.current
			const page = scroller.current
			if (!pane || !page) return
			if (getComputedStyle(pane).overflowY === 'auto') pane.scrollTop = 0
			else if (pane.getBoundingClientRect().top > page.getBoundingClientRect().bottom - page.clientHeight / 3) {
				const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
				page.scrollBy({ top: pane.getBoundingClientRect().top - page.getBoundingClientRect().top - 16, behavior: smooth ? 'smooth' : 'auto' })
			}
		})
	}

	// Searches every planet and every kind again.
	const selectAll = () => {
		planetaryEventsState.bodies = [...EVENT_BODIES]
		planetaryEventsState.kinds = [...EVENT_KINDS]
	}

	const exportCsv = () => {
		if (!answer || start === undefined) return
		downloadText(eventsCsv(events, state.visibility?.byId, site ? (site.name ?? 'Coordinates entered') : undefined, signature), `planetary-events-${formatDate(start, 'UTC')}.csv`, 'text/csv')
	}

	const panel = (
		<>
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
				<Actions>
					<Button variant="secondary" onClick={() => (planetaryEventsState.bodies = [...EVENT_BODIES])}>
						Select All
					</Button>
					<Button variant="secondary" onClick={() => (planetaryEventsState.bodies = [])}>
						Select None
					</Button>
				</Actions>
				{EVENT_BODIES.map((code) => (
					<Checkbox key={code} label={BODY_LABELS[code]} checked={state.bodies.includes(code)} onChange={(on) => (planetaryEventsState.bodies = EVENT_BODIES.filter((e) => (e === code ? on : state.bodies.includes(e))))} />
				))}
			</CollapsibleSection>
			<CollapsibleSection id="planetaryEvents.kinds" title="Events" summary={`${state.kinds.length} of ${EVENT_KINDS.length} kinds`}>
				<Actions>
					<Button variant="secondary" onClick={() => (planetaryEventsState.kinds = [...EVENT_KINDS])}>
						Select All
					</Button>
					<Button variant="secondary" onClick={() => (planetaryEventsState.kinds = [])}>
						Select None
					</Button>
				</Actions>
				{EVENT_KINDS.map((kind) => (
					<Checkbox key={kind} label={KIND_LABELS[kind]} checked={state.kinds.includes(kind)} onChange={(on) => (planetaryEventsState.kinds = toggle(state.kinds, kind, on))} />
				))}
				<NumberInput label="Appulse threshold" value={state.thresholdDegrees} min={THRESHOLD_DEGREES.min} max={THRESHOLD_DEGREES.max} step={0.1} suffix="°" onChange={(value) => (planetaryEventsState.thresholdDegrees = value)} />
				<Notice>Appulses wider than the threshold are not listed; conjunctions always are.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="planetaryEvents.ephemeris" title="Ephemeris" summary={sourceName(signature)} defaultOpen={false}>
				<Notice>{describeSource(signature) ?? 'Not computed yet.'}</Notice>
				<Notice>Local only: the SPICE kernels you installed or the VSOP87E theory, never JPL Horizons. Model version {signature?.modelVersion ?? MISSING}.</Notice>
				<Notice>
					Events are geocentric apparent (light time, aberration, solar deflection) on the true ecliptic of date; conjunctions, oppositions, and quadratures are defined by ecliptic longitude, an appulse by the least separation, the closest approach by the geometric distance. Times are refined far below a
					second, but shown to the minute: VSOP87E and the kernels can differ by seconds to minutes.
				</Notice>
				<Notice>The site never changes an event's time; it only says when its planets can be watched.</Notice>
				<Button variant="secondary" onClick={() => openKernelLibrary()}>
					Manage Kernels
				</Button>
			</CollapsibleSection>
		</>
	)

	const actions = (
		<Actions>
			<Button variant="secondary" disabled={!answer || events.length === 0} title={!answer ? (state.searchLoading ? 'The events are being computed' : 'No events were computed') : events.length === 0 ? 'No event is listed' : 'Writes the events listed to a CSV file'} onClick={exportCsv}>
				Export CSV
			</Button>
		</Actions>
	)

	const context = <SegmentedControl options={['timeline', 'calendar'] as const} value={state.view} format={(value) => (value === 'timeline' ? 'Timeline' : 'Calendar')} onChange={(value) => (planetaryEventsState.view = value)} />
	const unmatched = unmatchedKinds(state.kinds, state.bodies)
	const allSearched = state.bodies.length === EVENT_BODIES.length && state.kinds.length === EVENT_KINDS.length
	const count = answer && (events.length === answer.events.length ? `${events.length} event${events.length === 1 ? '' : 's'}` : `${events.length} of ${answer.events.length} events`)

	return (
		<WorkspaceLayout workspace="tools" title="Planetary Events" context={context} actions={actions} panel={{ title: 'Range and Filters', content: panel }}>
			<div className="@container/events h-full bg-base-000">
				<div ref={scroller} className="h-full overflow-y-auto @5xl/events:overflow-hidden">
					<div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 @5xl/events:h-full">
						<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
							<span title={site ? FILTER_TITLES[state.visibilityFilter] : 'Set an observing site to filter the events by their visibility'}>
								<SegmentedControl options={VISIBILITY_FILTERS} value={site ? state.visibilityFilter : 'all'} disabled={!site} format={(value) => FILTER_LABELS[value]} onChange={(value) => (planetaryEventsState.visibilityFilter = value)} />
							</span>
							{count && <span className="text-sm text-ink-100 tabular-nums">{count}</span>}
						</div>
						<p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-300">
							{source && <StatusBadge tone={source.kind === 'spk' ? 'success' : 'neutral'} label={sourceName(signature)!} title={describeSource(signature)} />}
							<span>{describeDisplayZone(displayZone)}</span>
							{start !== undefined && end !== undefined && (
								<span className="tabular-nums">
									· {formatDate(start, zone)} to {formatDate(end, zone)}
								</span>
							)}
							{state.searchLoading && <span>· computing the events…</span>}
							{state.visibilityLoading && <span>· computing the visibility…</span>}
						</p>
						{!location && (
							<Notice>
								<span className="block">Without a site the events are listed without their local visibility. Set the observing site of this profile.</span>
								<Button variant="secondary" className="mt-2" onClick={() => openObservingSites()}>
									Choose Observing Site
								</Button>
							</Notice>
						)}
						{state.searchError && <Notice error>{state.searchError}</Notice>}
						{state.visibilityError && <Notice error>{state.visibilityError}</Notice>}
						{answer && answer.events.length === 0 && (
							<Notice>
								<span className="block">{state.bodies.length === 0 ? 'No planet is chosen.' : state.kinds.length === 0 ? 'No kind of event is chosen.' : `No event of the chosen planets and kinds falls in this range.${unmatched.length > 0 ? ` ${unmatchedSentence(unmatched, state.bodies)}` : ''}`}</span>
								{!allSearched && (
									<Button variant="secondary" className="mt-2" onClick={selectAll}>
										Select All Planets and Kinds
									</Button>
								)}
							</Notice>
						)}
						{answer && answer.events.length > 0 && events.length === 0 && (
							<Notice>
								<span className="block">{state.visibilityLoading ? 'Computing the visibility of the events…' : state.visibilityFilter === 'observable' ? 'No event of the range can be watched from the site.' : 'Every event of the range can be watched from the site.'}</span>
								<Button variant="secondary" className="mt-2" onClick={() => (planetaryEventsState.visibilityFilter = 'all')}>
									Show All Events
								</Button>
							</Notice>
						)}
						{!answer && state.searchLoading && <Notice>Computing the events of the range…</Notice>}
						{answer && (
							<div className="flex flex-col gap-4 @5xl/events:min-h-0 @5xl/events:flex-1 @5xl/events:flex-row">
								<div className="@container/list flex min-w-0 flex-col gap-2 @5xl/events:min-h-0 @5xl/events:flex-1">
									{events.length > 0 && state.view === 'timeline' && <PlanetaryEventsTimeline events={events} visibility={state.visibility} hasSite={!!site} selected={state.selected} timeZone={zone} className="max-h-[60vh] @5xl/events:max-h-none" onSelect={choose} />}
									{state.view === 'calendar' && month && firstMonth && lastMonth && (
										<div className="@5xl/events:min-h-0 @5xl/events:overflow-y-auto">
											<PlanetaryEventsCalendar month={month} events={events} visibility={state.visibility} hasSite={!!site} selected={state.selected} timeZone={zone} first={firstMonth} last={lastMonth} onMonth={(value) => (planetaryEventsState.month = value)} onSelect={choose} />
										</div>
									)}
								</div>
								<div ref={inspector} className="flex min-w-0 flex-col gap-2 @5xl/events:w-104 @5xl/events:flex-none @5xl/events:overflow-y-auto">
									{selected ? (
										<PlanetaryEventDetails
											key={selected.id}
											event={selected}
											all={answer.events}
											visibility={state.visibility?.byId[selected.id]}
											hasSite={!!site}
											visibilityLoading={state.visibilityLoading}
											series={state.series}
											seriesLoading={state.seriesLoading}
											seriesError={state.seriesError}
											timeZone={zone}
											site={site}
											onSelect={choose}
										/>
									) : (
										events.length > 0 && <Notice>Choose an event to see when it can be watched from the site, its curve, and its circumstances.</Notice>
									)}
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</WorkspaceLayout>
	)
}
