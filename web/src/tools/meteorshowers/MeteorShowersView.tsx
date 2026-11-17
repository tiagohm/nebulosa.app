import { useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { locationKey, openObservingSites, type SiteLocation } from '../../location/site'
import { useActiveLocation, useDisplayZone } from '../../location/useLocation'
import { describeDisplayZone } from '../../location/zone'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { routeState } from '../../shell/route'
import { useWorkspacePanel, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { LinkButton } from '../../ui/LinkButton'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { Pager } from '../../ui/Pager'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { MeteorNightList } from './MeteorNightList'
import { MeteorShowerCalendar } from './MeteorShowerCalendar'
import { MeteorShowerDetails } from './MeteorShowerDetails'
import { MeteorShowerList } from './MeteorShowerList'
import {
	clearEvening,
	clearNight,
	clearRanking,
	DARKNESS_ALTITUDES,
	eveningOf,
	loadActivity,
	loadCalendar,
	loadDetail,
	loadEvening,
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
	rankingStartEvening,
	selectShower,
	setEvening,
} from './meteorshowers'
import { formatEvening, STATUS_LABELS } from './meteorshowers.format'
import { meteorShowerSourcesState } from './meteorshowers.sources'
import { MeteorSourcesModal } from './MeteorSourcesModal'

// Meteor Showers tool, answer first: the curated showers of one night at the tool's location (the default section), each
// with its verdict, best window, and maximum, beside the details of the one chosen, which open on that night; then the
// IAU Meteor Data Center catalog with its small curated visual subset, listed by next maximum, active now, or whole, as a
// list or a month. The evening is moved from the content (the night's bar and the details) or set in the panel, with the
// darkness and the constraints. The location and the zone are the tool's own; nothing here moves the mount, changes a site
// or the profile, or changes the Sky clock unless asked to show a best time or a maximum in the Sky. The content fits the
// width of the workspace (`@container/meteors`): from 64 rem the list and the details stand side by side, each filling the
// height and scrolling itself; below it they stack, and choosing a shower brings the details into view.

// Name of each section.
const SECTION_LABELS: Readonly<Record<MeteorShowersSection, string>> = { night: 'Night', upcoming: 'Upcoming', active: 'Active Now', all: 'All IAU' }

// Name of each darkness, with the solar altitude it asks for.
const DARKNESS_LABELS: Readonly<Record<MeteorDarkness, string>> = { astronomical: 'Astronomical, −18°', nautical: 'Nautical, −12°', civil: 'Civil, −6°' }

// What a search that found nothing in a catalog section says: the section's kind of shower, and how many of the whole
// catalog match when some do.
function noMatchText(section: MeteorShowersSection, query: string, otherMatches: number | undefined) {
	const kind = section === 'upcoming' ? 'curated shower' : section === 'active' ? 'active shower' : 'shower'
	const others = otherMatches ? ` ${otherMatches} shower${otherMatches === 1 ? '' : 's'} of the whole IAU catalog match${otherMatches === 1 ? 'es' : ''}.` : ''
	return `No ${kind} matches “${query}”.${others}`
}

// The constraints of the windows in words, as the details and the night's caption echo them.
function constraintsText(state: Pick<MeteorShowersState, 'darkness' | 'minimumAltitude' | 'moonSeparation' | 'rates'>) {
	const darkness = `${state.darkness[0].toUpperCase()}${state.darkness.slice(1)} darkness (Sun below ${DARKNESS_ALTITUDES[state.darkness]}°)`
	const moon = state.moonSeparation === undefined ? 'no Moon constraint' : `the radiant at least ${state.moonSeparation}° from the Moon while it is up`
	const rates = state.rates.enabled ? `, rates modelled for a limiting magnitude of ${state.rates.limitingMagnitude}` : ''
	return `${darkness}, the radiant at least ${state.minimumAltitude}° high, ${moon}${rates}`
}

// Meteor Showers tool.
export function MeteorShowers() {
	const state = useSnapshot(meteorShowersState) as MeteorShowersState
	const { revision } = useSnapshot(meteorShowerSourcesState)
	const { route } = useSnapshot(routeState)
	const location = useActiveLocation()
	const displayZone = useDisplayZone(location)
	const zone = displayZone.zone
	const panelState = useWorkspacePanel('tools')
	const [sourcesOpen, setSourcesOpen] = useState(false)
	const site: SiteLocation | undefined = location && { name: location.name, latitude: location.latitude, longitude: location.longitude, elevation: location.elevation, timeZone: location.timeZone }
	const place = site ? `${locationKey(site)}|${site.timeZone}` : ''
	const latitude = state.reachable ? site?.latitude : undefined
	const linked = route.workspace === 'tools' && route.tool === 'meteor-showers' ? route.meteorShower : undefined
	const nightSection = state.section === 'night'
	const tonightDate = site && eveningOf(Date.now(), site.timeZone)
	const eveningDate = state.eveningDate ?? tonightDate
	const scroller = useRef<HTMLDivElement>(null)
	const inspector = useRef<HTMLDivElement>(null)
	const constraintKey = [state.darkness, state.minimumAltitude, state.moonSeparation, state.rates.enabled, state.rates.limitingMagnitude, state.rates.obstructedPercent].join('|')

	// A link to a shower selects it.
	useEffect(() => {
		if (linked) selectShower(meteorShowersState, linked)
	}, [linked])

	// A catalog section's page follows the section, the search, the filters, and the catalog.
	useEffect(() => {
		if (!nightSection) void loadPage(meteorShowersState, latitude)
	}, [state.section, state.query, state.status, state.reachable, state.offset, latitude, state.minimumAltitude, revision])

	// The month follows the calendar's month, the section, and the catalog.
	useEffect(() => {
		if (!nightSection && state.display === 'calendar') void loadCalendar(meteorShowersState)
	}, [state.display, state.month, state.section, revision])

	// The night's showers follow the section, the place and zone, the evening, the constraints, and the catalog.
	useEffect(() => {
		if (!site) clearEvening(meteorShowersState)
		else if (nightSection) void loadEvening(meteorShowersState, site)
	}, [state.section, place, state.eveningDate, constraintKey, revision])

	// The night section answers first: with nothing chosen, its first shower is.
	const firstOfNight = nightSection ? state.evening?.showers[0]?.shower.id : undefined
	useEffect(() => {
		if (firstOfNight && !state.selected) selectShower(meteorShowersState, firstOfNight)
	}, [firstOfNight])

	// The detail follows the selection and the catalog.
	useEffect(() => {
		void loadDetail(meteorShowersState)
	}, [state.selected, revision])

	// The night follows the selection, the place and zone, the evening, the constraints, and the catalog.
	useEffect(() => {
		if (!site) clearNight(meteorShowersState)
		else if (state.selected) void loadNight(meteorShowersState, site)
	}, [state.selected, place, state.eveningDate, constraintKey, revision])

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

	// A ranking is computed on request and forgotten when its inputs change; choosing a ranked night keeps it.
	useEffect(() => clearRanking(meteorShowersState), [state.selected, place, constraintKey, state.rankedNights, revision])

	// Selects a shower and brings the details to it: their own pane back to the top when it scrolls itself beside the list,
	// else the page down to it when its top is out of sight.
	const choose = (id: string) => {
		selectShower(meteorShowersState, id)
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

	// Shows an evening.
	const showEvening = (date: string) => site && setEvening(meteorShowersState, site, { date })

	// Ranks the nights of the selected shower: from the evening shown while it is active, else around its maximum.
	const rank = () => {
		if (!site || !detail || !eveningDate) return
		void loadRanking(meteorShowersState, site, rankingStartEvening(detail.occurrences, eveningDate, state.rankedNights, site.timeZone))
	}

	const clearSearch = () => Object.assign(meteorShowersState, { query: '', offset: 0 })
	const page = state.page
	const pageIndex = Math.floor(state.offset / PAGE_SIZE)
	const constraints = constraintsText(state)

	const panel = (
		<>
			{!nightSection && (
				<CollapsibleSection id="meteorShowers.filters" title="Search and Filters" summary={state.query || undefined}>
					<TextInput label="Name, code, or IAU number" value={state.query} onChange={(event) => Object.assign(meteorShowersState, { query: event.currentTarget.value, offset: 0 })} />
					{state.section === 'all' && <Select label="Status" options={METEOR_STATUS_FILTERS} value={state.status} format={(value: MeteorStatusFilter) => (value === 'any' ? 'Any status' : STATUS_LABELS[value])} onChange={(value) => Object.assign(meteorShowersState, { status: value, offset: 0 })} />}
					<Checkbox label="Only radiants that reach the lowest altitude here" checked={state.reachable} disabled={!site} onChange={(on) => Object.assign(meteorShowersState, { reachable: on, offset: 0 })} />
				</CollapsibleSection>
			)}
			<CollapsibleSection id="meteorShowers.observing" title="Night Constraints" summary={eveningDate}>
				<TextInput label="Evening" type="date" value={eveningDate ?? ''} disabled={!site} onChange={(event) => (meteorShowersState.eveningDate = event.currentTarget.value || undefined)} />
				<Select label="Darkness (Sun below)" options={Object.keys(DARKNESS_ALTITUDES) as MeteorDarkness[]} value={state.darkness} format={(value: MeteorDarkness) => DARKNESS_LABELS[value]} onChange={(value) => (meteorShowersState.darkness = value)} />
				<NumberInput label="Lowest radiant altitude" value={state.minimumAltitude} min={0} max={80} step={1} suffix="°" onChange={(value) => (meteorShowersState.minimumAltitude = value)} />
				<Checkbox label="Keep the radiant away from the Moon" checked={state.moonSeparation !== undefined} onChange={(on) => (meteorShowersState.moonSeparation = on ? 30 : undefined)} />
				{state.moonSeparation !== undefined && <NumberInput label="Smallest Moon separation" value={state.moonSeparation} min={5} max={120} step={5} suffix="°" onChange={(value) => (meteorShowersState.moonSeparation = value)} />}
				<NumberInput label="Nights ranked" value={state.rankedNights} min={1} max={MAX_RANKED_NIGHTS} step={1} onChange={(value) => (meteorShowersState.rankedNights = value)} />
				<Notice>A window is a stretch of the night dark enough with the radiant high enough, and the Moon away from it when asked: when it can be watched, not how many meteors appear.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="meteorShowers.rates" title="Modelled Rates" summary={state.rates.enabled ? `LM ${state.rates.limitingMagnitude}` : 'Off'} defaultOpen={false}>
				<Checkbox label="Model meteor rates where a published activity profile exists" checked={state.rates.enabled} onChange={(on) => (meteorShowersState.rates.enabled = on)} />
				<NumberInput label="Limiting magnitude" value={state.rates.limitingMagnitude} min={3} max={7.5} step={0.1} disabled={!state.rates.enabled} onChange={(value) => (meteorShowersState.rates.limitingMagnitude = value)} />
				<NumberInput label="Field obstructed" value={state.rates.obstructedPercent} min={0} max={90} step={5} suffix="%" disabled={!state.rates.enabled} onChange={(value) => (meteorShowersState.rates.obstructedPercent = value)} />
				<Notice>Your assumptions, not measurements: the rate is the profile ZHR scaled by the radiant height, the limiting magnitude, and the obstruction, for an ideal observer. No Moon, weather, or sporadic background is applied.</Notice>
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

	const evening = state.evening?.eveningDate === eveningDate ? state.evening : undefined
	const nightCount = evening && `${evening.showers.length} curated shower${evening.showers.length === 1 ? '' : 's'} active`

	return (
		<WorkspaceLayout workspace="tools" title="Meteor Showers" context={context} actions={actions} panel={{ title: 'Night and Filters', content: panel }} panelState={panelState}>
			<MeteorSourcesModal open={sourcesOpen} onClose={() => setSourcesOpen(false)} timeZone={zone} />
			<div className="@container/meteors h-full bg-base-000">
				<div ref={scroller} className="h-full overflow-y-auto @5xl/meteors:overflow-hidden">
					<div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 @5xl/meteors:h-full">
						{nightSection ? (
							<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
								<Actions>
									<Button variant="secondary" disabled={!eveningDate} title="Shows the evening before" onClick={() => site && setEvening(meteorShowersState, site, { days: -1 })}>
										Previous
									</Button>
									<Button variant="secondary" disabled={!eveningDate} title="Shows the evening after" onClick={() => site && setEvening(meteorShowersState, site, { days: 1 })}>
										Next
									</Button>
									<Button variant="secondary" disabled={!tonightDate || eveningDate === tonightDate} title={eveningDate === tonightDate ? 'This is tonight' : 'Shows tonight'} onClick={() => tonightDate && showEvening(tonightDate)}>
										Tonight
									</Button>
								</Actions>
								{eveningDate && (
									<h2 className="m-0 text-sm font-semibold text-ink-100 tabular-nums">
										{formatEvening(eveningDate)}
										{eveningDate === tonightDate && <span className="font-normal text-ink-300"> · tonight</span>}
									</h2>
								)}
								{nightCount && <span className="text-sm text-ink-300 tabular-nums">{nightCount}</span>}
							</div>
						) : (
							<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
								<SegmentedControl options={['list', 'calendar'] as const} value={state.display} format={(value) => (value === 'list' ? 'List' : 'Calendar')} onChange={(value) => (meteorShowersState.display = value)} />
								{page && state.display === 'list' && <span className="text-sm text-ink-100 tabular-nums">{`${page.total} shower${page.total === 1 ? '' : 's'}`}</span>}
								{state.display === 'list' && state.query.trim() && (
									<span className="flex items-center gap-2 text-sm text-ink-300">
										{`matching “${state.query.trim()}”`}
										<LinkButton className="text-sm" onClick={clearSearch}>
											Clear
										</LinkButton>
									</span>
								)}
							</div>
						)}
						<p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-300">
							<span>{describeDisplayZone(displayZone)}</span>
							{nightSection && site && (
								<span>
									· {constraints}.{' '}
									<LinkButton className="text-xs" onClick={() => panelState.setOpen(true)}>
										Change
									</LinkButton>
								</span>
							)}
							{nightSection && state.eveningLoading && <span>· computing the night…</span>}
							{!nightSection && state.pageLoading && <span>· reading…</span>}
						</p>
						{!location && (
							<Notice>
								<span className="block">{nightSection ? 'The night needs a site: without one no window can be computed.' : 'Without a site the showers are listed without when their radiants can be watched.'} Set the observing site of this profile.</span>
								<Button variant="secondary" className="mt-2" onClick={() => openObservingSites()}>
									Choose Observing Site
								</Button>
							</Notice>
						)}
						{nightSection && state.eveningError && <Notice error>{state.eveningError}</Notice>}
						{!nightSection && state.pageError && <Notice error>{state.pageError}</Notice>}
						{state.detailError && <Notice error>{state.detailError}</Notice>}
						<div className="flex flex-col gap-4 @5xl/meteors:min-h-0 @5xl/meteors:flex-1 @5xl/meteors:flex-row">
							<div className="@container/list flex min-w-0 flex-col gap-2 @5xl/meteors:min-h-0 @5xl/meteors:flex-1 @5xl/meteors:overflow-y-auto">
								{nightSection && site && !evening && state.eveningLoading && <Notice>Computing the showers of the night…</Notice>}
								{nightSection && evening && (
									<>
										{evening.showers.length === 0 ? <Notice>No curated shower is active on this night.</Notice> : <MeteorNightList showers={evening.showers} eveningDate={evening.eveningDate} selected={state.selected} timeZone={zone} eveningZone={site?.timeZone ?? zone} onSelect={choose} />}
										<Notice>
											{evening.showers.length > 0 && `Watchable first, then by ${evening.showers.some((entry) => entry.kind === 'modelled') ? 'modelled count' : 'typical ZHR'}. `}
											{`The ${evening.otherActive} other IAU shower${evening.otherActive === 1 ? '' : 's'} active this night have no curated visual data. `}
											{eveningDate === tonightDate && (
												<LinkButton className="text-xs" onClick={() => Object.assign(meteorShowersState, { section: 'active', offset: 0 })}>
													Show Active Now
												</LinkButton>
											)}
										</Notice>
									</>
								)}
								{!nightSection && state.display === 'list' && page && (
									<>
										{page.showers.length === 0 ? (
											<Notice>
												<span className="block">{state.query.trim() ? noMatchText(state.section, state.query.trim(), state.otherMatches) : state.section === 'active' ? 'No shower of the catalog is active now.' : 'No shower matches.'}</span>
												{state.query.trim() && (
													<Actions>
														{!!state.otherMatches && (
															<Button variant="secondary" className="mt-2" onClick={() => Object.assign(meteorShowersState, { section: 'all', status: 'any', offset: 0 })}>
																Search All IAU
															</Button>
														)}
														<Button variant="secondary" className="mt-2" onClick={clearSearch}>
															Clear Search
														</Button>
													</Actions>
												)}
											</Notice>
										) : (
											<MeteorShowerList showers={page.showers} selected={state.selected} timeZone={zone} now={Date.now()} onSelect={choose} />
										)}
										<Pager page={pageIndex} total={page.total} pageSize={PAGE_SIZE} noun="showers" loading={state.pageLoading} onPage={(index) => (meteorShowersState.offset = index * PAGE_SIZE)} />
									</>
								)}
								{!nightSection && state.display === 'calendar' && (
									<>
										{state.calendarError && <Notice error>{state.calendarError}</Notice>}
										{state.month && <MeteorShowerCalendar month={state.month} entries={state.calendar?.entries ?? []} annualEvents={state.calendar?.annualEvents ?? []} selected={state.selected} timeZone={zone} onMonth={(month) => (meteorShowersState.month = month)} onSelect={choose} />}
										<Notice>{state.section === 'upcoming' ? 'Curated visual showers.' : 'Established, working, and to-be-established IAU showers; removed records are not shown.'}</Notice>
									</>
								)}
							</div>
							<div ref={inspector} className="flex min-w-0 flex-col gap-2 @5xl/meteors:w-128 @5xl/meteors:flex-none @5xl/meteors:overflow-y-auto">
								{detail ? (
									<MeteorShowerDetails
										detail={detail}
										night={state.night}
										nightLoading={state.nightLoading}
										nightError={state.nightError}
										minimumAltitude={(state.minimumAltitude * Math.PI) / 180}
										site={site}
										timeZone={zone}
										eveningDate={eveningDate}
										tonightDate={tonightDate}
										onEvening={showEvening}
										nightBar={nightSection}
										constraints={constraints}
										onConstraints={() => panelState.setOpen(true)}
										activity={state.activity}
										ranking={state.ranking}
										rankingLoading={state.rankingLoading}
										rankingError={state.rankingError}
										rankedNights={state.rankedNights}
										onRank={rank}
										forecast={state.forecast?.place === place ? state.forecast.forecast : undefined}
									/>
								) : state.selected ? (
									state.detailLoading && <Notice>Reading the shower…</Notice>
								) : (
									<Notice>Choose a shower to see when it can be watched from the site, its activity, and its sources.</Notice>
								)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</WorkspaceLayout>
	)
}
