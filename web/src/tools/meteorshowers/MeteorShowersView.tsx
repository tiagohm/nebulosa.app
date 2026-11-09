import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatGeographic } from '../../format'
import { locationKey, openObservingSites, type SiteLocation } from '../../location/site'
import { TimeZoneSelect } from '../../location/TimeZoneSelect'
import { ToolLocationSection } from '../../location/ToolLocationSection'
import { useActiveSite, useDisplayZone, useToolLocation } from '../../location/useLocation'
import { describeDisplayZone } from '../../location/zone'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { routeState } from '../../shell/route'
import { WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { Pager } from '../../ui/Pager'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { MeteorShowerCalendar } from './MeteorShowerCalendar'
import { MeteorShowerDetails } from './MeteorShowerDetails'
import { MeteorShowerList } from './MeteorShowerList'
import {
	clearNight,
	clearRanking,
	DARKNESS_ALTITUDES,
	loadActivity,
	loadCalendar,
	loadDetail,
	loadForecast,
	loadNight,
	loadPage,
	loadRanking,
	MAX_RANKED_NIGHTS,
	METEOR_SHOWER_SECTIONS,
	METEOR_STATUS_FILTERS,
	type MeteorDarkness,
	type MeteorShowersSection,
	type MeteorShowersState,
	meteorShowersState,
	type MeteorStatusFilter,
	PAGE_SIZE,
	selectShower,
} from './meteorshowers'
import { STATUS_LABELS } from './meteorshowers.format'
import { meteorShowerSourcesState } from './meteorshowers.sources'
import { MeteorSourcesModal } from './MeteorSourcesModal'

// Meteor Showers tool: the IAU Meteor Data Center catalog with a small curated visual subset, listed by next maximum,
// active now, or whole, as a list or a month; the details of a shower with each source apart; and when its radiant can be
// watched from the tool's location. The location and the zone are the tool's own; nothing here moves the mount, changes a
// site or the profile, or changes the Sky clock unless asked to set it to a maximum.

// Name of each section.
const SECTION_LABELS: Readonly<Record<MeteorShowersSection, string>> = { upcoming: 'Upcoming', active: 'Active Now', all: 'All IAU' }

// Name of each darkness.
const DARKNESS_LABELS: Readonly<Record<MeteorDarkness, string>> = { astronomical: 'Astronomical (Sun below −18°)', nautical: 'Nautical (Sun below −12°)', civil: 'Civil (Sun below −6°)' }

// Meteor Showers tool.
export function MeteorShowers() {
	const state = useSnapshot(meteorShowersState) as MeteorShowersState
	const { revision } = useSnapshot(meteorShowerSourcesState)
	const { route } = useSnapshot(routeState)
	const location = useToolLocation(state.location)
	const active = useActiveSite()
	const displayZone = useDisplayZone(location, state.zone)
	const zone = displayZone.zone
	const [sourcesOpen, setSourcesOpen] = useState(false)
	const site: SiteLocation | undefined = location && { name: location.name, latitude: location.latitude, longitude: location.longitude, elevation: location.elevation, timeZone: location.timeZone }
	const activeSite: SiteLocation | undefined = active && { name: active.name, latitude: active.latitude, longitude: active.longitude, elevation: active.elevation, timeZone: active.timeZone }
	const place = site ? `${locationKey(site)}|${site.timeZone}` : ''
	const latitude = state.reachable ? site?.latitude : undefined
	const linked = route.workspace === 'tools' && route.tool === 'meteor-showers' ? route.meteorShower : undefined

	// A link to a shower selects it.
	useEffect(() => {
		if (linked) selectShower(meteorShowersState, linked)
	}, [linked])

	// The page follows the section, the search, the filters, and the catalog.
	useEffect(() => {
		void loadPage(meteorShowersState, latitude)
	}, [state.section, state.query, state.status, state.reachable, state.offset, latitude, state.minimumAltitude, revision])

	// The month follows the calendar's month, the section, and the catalog.
	useEffect(() => {
		if (state.display === 'calendar') void loadCalendar(meteorShowersState)
	}, [state.display, state.month, state.section, revision])

	// The detail follows the selection and the catalog.
	useEffect(() => {
		void loadDetail(meteorShowersState)
	}, [state.selected, revision])

	// The night follows the selection, the place and zone, the evening, the constraints, and the catalog.
	useEffect(() => {
		if (!site) clearNight(meteorShowersState)
		else if (state.selected) void loadNight(meteorShowersState, site)
	}, [state.selected, place, state.eveningDate, state.darkness, state.minimumAltitude, state.moonSeparation, state.rates.enabled, state.rates.limitingMagnitude, state.rates.obstructedPercent, revision])

	// The activity curve follows the selection, the year of its next occurrence, and the catalog.
	const detail = state.detail?.id === state.selected ? state.detail : undefined
	const nextInstant = detail?.occurrence?.visual?.peak ?? detail?.occurrence?.iau?.reference ?? detail?.occurrence?.iau?.start
	const activityYear = new Date(nextInstant ?? Date.now()).getUTCFullYear()

	useEffect(() => {
		if (detail) void loadActivity(meteorShowersState, activityYear)
	}, [detail?.id, activityYear, revision])

	// The forecast of the location is read once per place, while a shower is selected.
	useEffect(() => {
		if (site && state.selected) void loadForecast(meteorShowersState, site, place)
	}, [place, state.selected])

	// A ranking is computed on request and forgotten when its inputs change.
	useEffect(() => clearRanking(meteorShowersState), [state.selected, place, state.eveningDate, state.darkness, state.minimumAltitude, state.moonSeparation, state.rates.enabled, state.rates.limitingMagnitude, state.rates.obstructedPercent, state.rankedNights, revision])

	const page = state.page
	const pageIndex = Math.floor(state.offset / PAGE_SIZE)

	const panel = (
		<>
			<ToolLocationSection value={state.location} location={location} onChange={(value) => (meteorShowersState.location = value)} collapsibleId="meteorShowers.location" elevation hint="Only decides when a radiant can be watched; the dates of the showers are global." />
			<CollapsibleSection id="meteorShowers.timeZone" title="Time Zone" summary={zone} defaultOpen={false}>
				<TimeZoneSelect label="Times Shown In" value={state.zone} onChange={(value) => (meteorShowersState.zone = value)} site={location} selectedSite={location ? location.source !== 'active' : false} />
			</CollapsibleSection>
			<CollapsibleSection id="meteorShowers.filters" title="Search and Filters" summary={state.query || undefined}>
				<TextInput label="Name, code, or IAU number" value={state.query} onChange={(event) => Object.assign(meteorShowersState, { query: event.currentTarget.value, offset: 0 })} />
				{state.section === 'all' && <Select label="Status" options={METEOR_STATUS_FILTERS} value={state.status} format={(value: MeteorStatusFilter) => (value === 'any' ? 'Any status' : STATUS_LABELS[value])} onChange={(value) => Object.assign(meteorShowersState, { status: value, offset: 0 })} />}
				<Checkbox label="Only radiants that reach the lowest altitude here" checked={state.reachable} disabled={!site} onChange={(on) => Object.assign(meteorShowersState, { reachable: on, offset: 0 })} />
			</CollapsibleSection>
			<CollapsibleSection id="meteorShowers.observing" title="Observing Night" summary={state.eveningDate}>
				<TextInput label="Evening" type="date" value={state.eveningDate ?? ''} disabled={!site} onChange={(event) => (meteorShowersState.eveningDate = event.currentTarget.value || undefined)} />
				<Select label="Darkness" options={Object.keys(DARKNESS_ALTITUDES) as MeteorDarkness[]} value={state.darkness} format={(value: MeteorDarkness) => DARKNESS_LABELS[value]} onChange={(value) => (meteorShowersState.darkness = value)} />
				<NumberInput label="Lowest radiant altitude" value={state.minimumAltitude} min={0} max={80} step={1} suffix="°" onChange={(value) => (meteorShowersState.minimumAltitude = value)} />
				<Checkbox label="Keep the radiant away from the Moon" checked={state.moonSeparation !== undefined} onChange={(on) => (meteorShowersState.moonSeparation = on ? 30 : undefined)} />
				{state.moonSeparation !== undefined && <NumberInput label="Smallest Moon separation" value={state.moonSeparation} min={5} max={120} step={5} suffix="°" onChange={(value) => (meteorShowersState.moonSeparation = value)} />}
				<p className="m-0 text-xs text-ink-300">Windows are geometric: darkness, the radiant above the lowest altitude, and the Moon constraint while the Moon is up. They say when the radiant can be watched, not how many meteors appear.</p>
				<NumberInput label="Nights ranked" value={state.rankedNights} min={1} max={MAX_RANKED_NIGHTS} step={1} onChange={(value) => (meteorShowersState.rankedNights = value)} />
			</CollapsibleSection>
			<CollapsibleSection id="meteorShowers.rates" title="Modelled Rates" summary={state.rates.enabled ? `LM ${state.rates.limitingMagnitude}` : 'Off'} defaultOpen={false}>
				<Checkbox label="Model meteor rates where a published activity profile exists" checked={state.rates.enabled} onChange={(on) => (meteorShowersState.rates.enabled = on)} />
				<NumberInput label="Limiting magnitude" value={state.rates.limitingMagnitude} min={3} max={7.5} step={0.1} disabled={!state.rates.enabled} onChange={(value) => (meteorShowersState.rates.limitingMagnitude = value)} />
				<NumberInput label="Field obstructed" value={state.rates.obstructedPercent} min={0} max={90} step={5} suffix="%" disabled={!state.rates.enabled} onChange={(value) => (meteorShowersState.rates.obstructedPercent = value)} />
				<p className="m-0 text-xs text-ink-300">Your assumptions, not measurements: the rate is the profile ZHR scaled by the radiant height, the limiting magnitude, and the obstruction, for an ideal observer. No Moon, weather, or sporadic background is applied.</p>
			</CollapsibleSection>
		</>
	)

	const actions = (
		<Actions>
			<Button variant="secondary" onClick={() => setSourcesOpen(true)}>
				Sources
			</Button>
		</Actions>
	)

	const context = <SegmentedControl options={METEOR_SHOWER_SECTIONS} value={state.section} format={(value) => SECTION_LABELS[value]} onChange={(value) => Object.assign(meteorShowersState, { section: value, offset: 0 })} />

	return (
		<WorkspaceLayout workspace="tools" title="Meteor Showers" context={context} actions={actions} panel={{ title: 'Location and Filters', content: panel }}>
			<MeteorSourcesModal open={sourcesOpen} onClose={() => setSourcesOpen(false)} timeZone={zone} />
			<div className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
					<div className="flex flex-wrap items-center gap-2">
						<SegmentedControl options={['list', 'calendar'] as const} value={state.display} format={(value) => (value === 'list' ? 'List' : 'Calendar')} onChange={(value) => (meteorShowersState.display = value)} />
						<p className="m-0 flex flex-wrap items-center gap-2 text-xs text-ink-300">
							<span>{location ? `${location.name ?? 'Coordinates entered'} · ${formatGeographic(location.latitude, location.longitude)}` : 'No site: dates and radiants only'}</span>
							<span>· {describeDisplayZone(displayZone)}</span>
							{page && <span>· {page.total} showers</span>}
							{state.pageLoading && <span>· reading…</span>}
						</p>
					</div>
					{!location && (
						<Notice>
							<span className="block">
								{state.location.mode === 'active' ? 'Without a site the showers are listed without when their radiants can be watched. Set the observing site of this profile, or choose a location in the panel.' : 'The site chosen was deleted. Choose another location in the panel.'}
							</span>
							<Button variant="secondary" className="mt-2" onClick={() => openObservingSites()}>
								Set Location
							</Button>
						</Notice>
					)}
					{state.pageError && <Notice error>{state.pageError}</Notice>}
					{state.display === 'list' && page && (
						<>
							{page.showers.length === 0 ? <Notice>{state.section === 'active' ? 'No shower of the catalog is active now.' : 'No shower matches.'}</Notice> : <MeteorShowerList showers={page.showers} selected={state.selected} timeZone={zone} onSelect={(id) => selectShower(meteorShowersState, id)} />}
							<Pager page={pageIndex} total={page.total} pageSize={PAGE_SIZE} noun="showers" loading={state.pageLoading} onPage={(index) => (meteorShowersState.offset = index * PAGE_SIZE)} />
						</>
					)}
					{state.display === 'calendar' && (
						<>
							{state.calendarError && <Notice error>{state.calendarError}</Notice>}
							{state.month && (
								<MeteorShowerCalendar month={state.month} entries={state.calendar?.entries ?? []} annualEvents={state.calendar?.annualEvents ?? []} selected={state.selected} timeZone={zone} onMonth={(month) => (meteorShowersState.month = month)} onSelect={(id) => selectShower(meteorShowersState, id)} />
							)}
							<p className="m-0 text-xs text-ink-300">{state.section === 'upcoming' ? 'Curated visual showers.' : 'Established, working, and to-be-established IAU showers; removed records are not shown.'}</p>
						</>
					)}
					{state.detailError && <Notice error>{state.detailError}</Notice>}
					{state.detail && state.detail.id === state.selected ? (
						<MeteorShowerDetails
							detail={state.detail}
							night={state.night}
							nightLoading={state.nightLoading}
							nightError={state.nightError}
							minimumAltitude={(state.minimumAltitude * Math.PI) / 180}
							site={site}
							activeSite={activeSite}
							timeZone={zone}
							activity={state.activity}
							ranking={state.ranking}
							rankingLoading={state.rankingLoading}
							rankingError={state.rankingError}
							onRank={() => site && void loadRanking(meteorShowersState, site)}
							onSelectNight={(eveningDate) => (meteorShowersState.eveningDate = eveningDate)}
							forecast={state.forecast?.place === place ? state.forecast.forecast : undefined}
						/>
					) : (
						!state.selected && <p className="m-0 text-xs text-ink-300">Choose a shower to see its sources, its dates, and when its radiant can be watched.</p>
					)}
				</div>
			</div>
		</WorkspaceLayout>
	)
}
