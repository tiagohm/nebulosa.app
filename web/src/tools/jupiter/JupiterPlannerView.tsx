import type { JupiterEvent } from 'api'
import { useEffect, useMemo, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { formatArcsec, formatDegrees } from '../../format'
import { openObservingSites, type SiteLocation } from '../../location/site'
import { useActiveLocation, useDisplayZone } from '../../location/useLocation'
import { describeDisplayZone } from '../../location/zone'
import { collapsibleSections, setSectionOpen } from '../../shell/collapsible'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { useWorkspacePanel, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { PanZoomSurface, usePanZoom } from '../planetary/PanZoom'
import { browserPlannerIo, eveningOf, followNow, openKernelLibrary, ORIENTATION_LABELS, PLANET_ORIENTATIONS, type PlanetOrientation, periodRange, setTime } from '../planetary/planetary'
import { PlanetCompass } from '../planetary/PlanetCompass'
import { TimeBar } from '../planetary/TimeBar'
import { EventInspector, EventTimeline } from './EventTimeline'
import { GrsSettings } from './GrsSettings'
import {
	describeSource,
	EVENT_KINDS,
	eventHalfWidth,
	FALLBACK_LABELS,
	GALILEAN_MOONS,
	interpolateTrack,
	type JupiterPlannerState,
	type JupiterVisibilityFilter,
	jupiterGrsState,
	jupiterPlannerState,
	KIND_LABELS,
	listedEvents,
	loadEvents,
	loadSource,
	loadTrack,
	MOON_LABELS,
	PLANET_HALF_WIDTH,
	play,
	scheduleState,
	selectEvent,
	shownEvents,
	showJupiterInSky,
	VISIBILITY_FILTERS,
} from './jupiter'
import { JupiterViewer } from './JupiterViewer'
import { MoonChart } from './MoonChart'

// Jupiter Observing Planner tool: the view of Jupiter and its Galilean moons at the tool's own instant, the moons over the
// period, and the period's phenomena with their visibility from the active site, all computed by the server from one
// ephemeris source it names. The tool's clock is its own, never the Sky's: it opens following real now (read again every
// 30 s until another instant is chosen), and Show in Sky hands it to the Sky clock. Choosing an event moves it to its
// maximum, frames the moons taking part in the viewer and rings them, and shows the event in the inspector beside the
// list (from 64 rem of content, where the inspector stays in sight while the page scrolls) or under it (where choosing
// brings it into view). On a phone the viewer comes first, then the clock and the chart; from 1024 px the clock spans
// the top and the viewer and the chart stand side by side. The list opens on the events the site can watch, by night.
// Nothing here moves the mount, changes a site or the profile, or starts an operation.

// Pan and zoom of the viewer, in Jupiter radii: from the whole system (Callisto reaches ~26.3) to the disk, opening on
// Io, Europa, and Ganymede (which reaches ~15), two units wide for one high.
const ZOOM = { maxHalfWidth: 30, minHalfWidth: 1, initialHalfWidth: 16, aspect: 2 } as const

// Name of each visibility filter, above the list beside the count of the events shown.
const FILTER_LABELS: Readonly<Record<JupiterVisibilityFilter, string>> = { watchable: 'Watchable', all: 'All' }

// What each visibility filter keeps, as its tooltip.
const FILTER_TITLES: Readonly<Record<JupiterVisibilityFilter, string>> = {
	watchable: 'The events the site can watch, at least in part',
	all: 'Every event of the chosen kinds and moons, watchable or not',
}

// Whether the browser asks for reduced motion.
function prefersReducedMotion() {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Jupiter Observing Planner tool.
export function JupiterPlanner() {
	const state = useSnapshot(jupiterPlannerState) as JupiterPlannerState
	const grs = useSnapshot(jupiterGrsState)
	const location = useActiveLocation()
	const displayZone = useDisplayZone(location)
	const namingZone = location?.timeZone ?? displayZone.zone
	const site: SiteLocation | undefined = location && { name: location.name, latitude: location.latitude, longitude: location.longitude, elevation: location.elevation, timeZone: location.timeZone }
	const range = useMemo(() => (state.eveningDate ? periodRange(state.eveningDate, state.period, namingZone) : undefined), [state.eveningDate, state.period, namingZone])
	const siteKey = site && JSON.stringify([site.latitude, site.longitude, site.elevation, site.timeZone])
	const grsRevision = grs.grs?.revision ?? 0
	const zoom = usePanZoom(ZOOM)
	const panelState = useWorkspacePanel('tools')
	const scroller = useRef<HTMLDivElement>(null)
	const viewer = useRef<HTMLDivElement>(null)
	const inspector = useRef<HTMLDivElement>(null)

	// The clock starts following real now and the period at tonight, once.
	useEffect(() => {
		const now = browserPlannerIo.time()
		if (jupiterPlannerState.time === undefined) followNow(jupiterPlannerState, now)
		jupiterPlannerState.eveningDate ??= eveningOf(now, namingZone)
	}, [])

	// The period's answers follow the period, the site, and the Great Red Spot model.
	useEffect(() => {
		if (!range) return
		void loadEvents(jupiterPlannerState, range, site)
		void loadSource(jupiterPlannerState, range)
	}, [range?.start, range?.end, siteKey, grsRevision])

	useEffect(() => {
		if (range) void loadTrack(jupiterPlannerState, range)
	}, [range?.start, range?.end])

	// The exact view follows the clock once it settles; while playing, the play loop asks for it.
	useEffect(() => {
		if (!state.playing && state.time !== undefined) return scheduleState(jupiterPlannerState)
		return undefined
	}, [state.time, state.playing, grsRevision])

	// Play moves the clock; a hidden tab stops it.
	useEffect(() => {
		if (!state.playing) return undefined
		const stop = play(jupiterPlannerState, prefersReducedMotion())
		const hidden = () => {
			if (document.hidden) jupiterPlannerState.playing = false
		}
		document.addEventListener('visibilitychange', hidden)
		return () => {
			stop()
			document.removeEventListener('visibilitychange', hidden)
		}
	}, [state.playing])

	const answer = state.events
	const listed = answer ? listedEvents(answer.events, state.kinds, state.moons) : []
	const events = shownEvents(listed, state.visibilityFilter, !!site, state.order)
	const selected = answer?.events.find((e) => e.id === state.selected)
	const positions = state.playing && state.time !== undefined ? interpolateTrack(state.track, state.time) : undefined
	const signature = state.state?.signature ?? answer?.signature
	const source = signature?.source
	const filtering = state.visibilityFilter === 'watchable' && !!site
	const count = answer && (events.length === answer.events.length ? `${events.length} event${events.length === 1 ? '' : 's'}` : `${events.length} of ${answer.events.length} events`)
	const smooth = () => (prefersReducedMotion() ? 'auto' : 'smooth')

	const toggle = <T extends string>(list: readonly T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((e) => e !== value))

	// Brings an element of the page into sight when its top is out of it, the page scrolling just enough to show it.
	const reveal = (element: HTMLElement | null) => {
		const page = scroller.current
		if (!element || !page) return
		const top = element.getBoundingClientRect().top - page.getBoundingClientRect().top
		if (top < 0 || top > page.clientHeight * 0.67) page.scrollBy({ top: top - 16, behavior: smooth() })
	}

	// Selects an event: the clock goes to its maximum, the viewer frames its moons, and the inspector comes into sight
	// when it stands under the list.
	const choose = (event: JupiterEvent) => {
		selectEvent(jupiterPlannerState, event)
		const halfWidth = eventHalfWidth(event, state.track, state.orientation, ZOOM.aspect)
		if (halfWidth !== undefined) zoom.show(halfWidth)
		requestAnimationFrame(() => {
			const pane = inspector.current
			if (pane && getComputedStyle(pane).position !== 'sticky') reveal(pane)
		})
	}

	// Opens the panel on the Great Red Spot section.
	const openGrs = () => {
		setSectionOpen(collapsibleSections, 'jupiter.grs', true)
		panelState.setOpen(true)
	}

	// Lists every kind and every moon again.
	const selectAll = () => {
		jupiterPlannerState.kinds = [...EVENT_KINDS]
		jupiterPlannerState.moons = [...GALILEAN_MOONS]
	}

	// The kernels' readiness, when it says more than the source line: the kernels cover the period, or why they were not
	// used when the answer did not already say it.
	const readiness =
		state.source && (state.source.readiness === 'readyForJupiter' ? 'The enabled kernels cover the whole period.' : source?.kind === 'analytical' && source.fallbackReason === state.source.reason ? undefined : `Kernels: ${state.source.reason ? FALLBACK_LABELS[state.source.reason] : state.source.readiness}.`)

	const panel = (
		<>
			<CollapsibleSection id="jupiter.events" title="Events" summary={`${state.kinds.length} of ${EVENT_KINDS.length} kinds`}>
				<Actions>
					<Button variant="secondary" onClick={() => (jupiterPlannerState.kinds = [...EVENT_KINDS])}>
						Select All
					</Button>
					<Button variant="secondary" onClick={() => (jupiterPlannerState.kinds = [])}>
						Select None
					</Button>
				</Actions>
				{EVENT_KINDS.map((kind) => (
					<Checkbox key={kind} label={KIND_LABELS[kind]} checked={state.kinds.includes(kind)} onChange={(on) => (jupiterPlannerState.kinds = toggle(state.kinds, kind, on))} />
				))}
			</CollapsibleSection>
			<CollapsibleSection id="jupiter.moons" title="Moons" summary={`${state.moons.length} of ${GALILEAN_MOONS.length}`}>
				<Actions>
					<Button variant="secondary" onClick={() => (jupiterPlannerState.moons = [...GALILEAN_MOONS])}>
						Select All
					</Button>
					<Button variant="secondary" onClick={() => (jupiterPlannerState.moons = [])}>
						Select None
					</Button>
				</Actions>
				{GALILEAN_MOONS.map((moon) => (
					<Checkbox key={moon} label={MOON_LABELS[moon]} checked={state.moons.includes(moon)} onChange={(on) => (jupiterPlannerState.moons = toggle(state.moons, moon, on))} />
				))}
			</CollapsibleSection>
			<CollapsibleSection id="jupiter.view" title="View" summary={ORIENTATION_LABELS[state.orientation]} defaultOpen={false}>
				<Select label="Orientation" options={PLANET_ORIENTATIONS} value={state.orientation} format={(value: PlanetOrientation) => ORIENTATION_LABELS[value]} onChange={(value) => (jupiterPlannerState.orientation = value)} />
			</CollapsibleSection>
			<GrsSettings timeZone={displayZone.zone} />
			<CollapsibleSection id="jupiter.ephemeris" title="Ephemeris" summary={source ? (source.kind === 'spk' ? 'SPICE kernels' : 'VSOP87E + L1.2') : undefined} defaultOpen={false}>
				<Notice>{describeSource(signature) ?? 'Not computed yet.'}</Notice>
				{readiness && <Notice>{readiness}</Notice>}
				<Button variant="secondary" onClick={() => openKernelLibrary()}>
					Manage Kernels
				</Button>
			</CollapsibleSection>
		</>
	)

	const actions = (
		<Actions>
			<Button variant="secondary" onClick={() => showJupiterInSky(jupiterPlannerState, site)} title="Shows Jupiter in the Sky at this tool's instant">
				Show in Sky
			</Button>
		</Actions>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Jupiter Observing Planner" actions={actions} panel={{ title: 'Filters and Model', content: panel }} panelState={panelState}>
			<div ref={scroller} className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
					<p className="m-0 flex flex-wrap items-center gap-2 text-sm text-ink-300">
						{source && <StatusBadge tone={source.kind === 'spk' ? 'success' : 'neutral'} label={source.kind === 'spk' ? 'SPICE kernels' : 'Analytical theories'} title={describeSource(signature)} />}
						<span>{describeDisplayZone(displayZone)}</span>
						{state.state && (
							<span className="tabular-nums">
								· CM II {formatDegrees(state.state.disk.centralMeridian.II, 1)} · diameter {formatArcsec(state.state.disk.equatorialRadius * 2, 1)}
							</span>
						)}
					</p>
					{!location && (
						<Notice>
							<span className="block">Without a site the events are listed without their local visibility. Set the observing site of this profile.</span>
							<Button variant="secondary" className="mt-2" onClick={() => openObservingSites()}>
								Choose Observing Site
							</Button>
						</Notice>
					)}
					<div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
						<div ref={viewer} className="flex min-w-0 scroll-mt-4 flex-col gap-2 lg:col-start-1 lg:row-start-2">
							<PanZoomSurface zoom={zoom} planetHalfWidth={PLANET_HALF_WIDTH} planet="Jupiter" legend={<PlanetCompass orientation={state.orientation} />}>
								<JupiterViewer state={state.state} positions={positions} orientation={state.orientation} box={zoom.box} radiiPerPixel={zoom.radiiPerPixel} moons={state.moons} highlight={selected?.moons} highlightSpot={selected?.kind === 'grsTransit'} />
							</PanZoomSurface>
							{state.stateError && <Notice error>{state.stateError}</Notice>}
							{grs.grs && !grs.grs.model && (
								<Notice>
									<span className="block">No Great Red Spot model: the spot is not drawn and its transits are not predicted.</span>
									<Button variant="secondary" className="mt-2" onClick={openGrs}>
										Set Spot Model
									</Button>
								</Notice>
							)}
						</div>
						{range && (
							<div className="min-w-0 lg:col-span-2 lg:row-start-1">
								<TimeBar state={state} store={jupiterPlannerState} range={range} events={events} timeZone={displayZone.zone} eveningZone={namingZone} now={browserPlannerIo.time} />
							</div>
						)}
						<div className="flex min-w-0 flex-col gap-2 lg:col-start-2 lg:row-start-2">
							{state.track && (
								<MoonChart track={state.track} poleAngle={state.state?.disk.poleAngle ?? 0} orientation={state.orientation} moons={state.moons} nights={answer?.nights ?? []} selected={selected} time={state.time} timeZone={displayZone.zone} onTime={(time) => setTime(jupiterPlannerState, time)} />
							)}
							{state.trackLoading && <Notice>{state.track ? 'Computing the moons over the new period…' : 'Computing the moons over the period…'}</Notice>}
							{state.trackError && <Notice error>{state.trackError}</Notice>}
						</div>
					</div>
					<section className="@container/events flex flex-col gap-3">
						<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
							<h2 className="m-0 text-sm font-semibold text-ink-100">Events</h2>
							<span title={site ? FILTER_TITLES[state.visibilityFilter] : 'Set an observing site to show only the events it can watch'}>
								<SegmentedControl options={VISIBILITY_FILTERS} value={site ? state.visibilityFilter : 'all'} disabled={!site} format={(value) => FILTER_LABELS[value]} onChange={(value) => (jupiterPlannerState.visibilityFilter = value)} />
							</span>
							{count && <span className="text-sm text-ink-200 tabular-nums">{count}</span>}
							{state.eventsLoading && <span className="text-sm text-ink-300">computing…</span>}
						</div>
						{state.eventsError && <Notice error>{state.eventsError}</Notice>}
						{answer && listed.length === 0 && (
							<Notice>
								<span className="block">
									{state.moons.length === 0
										? 'No moon is chosen.'
										: state.kinds.length === 0
											? 'No kind of event is chosen.'
											: "No phenomenon of the chosen kinds and moons falls in this period. Mutual events only happen in the seasons around Jupiter's equinox, and Callisto misses the disk in some years."}
								</span>
								{(state.moons.length < GALILEAN_MOONS.length || state.kinds.length < EVENT_KINDS.length) && (
									<Button variant="secondary" className="mt-2" onClick={selectAll}>
										Select All Kinds and Moons
									</Button>
								)}
							</Notice>
						)}
						{answer && listed.length > 0 && events.length === 0 && filtering && (
							<Notice>
								<span className="block">The site cannot watch any of the {listed.length} events of the chosen kinds and moons in this period.</span>
								<Button variant="secondary" className="mt-2" onClick={() => (jupiterPlannerState.visibilityFilter = 'all')}>
									Show All Events
								</Button>
							</Notice>
						)}
						{answer && events.length > 0 && (
							<div className="flex flex-col gap-4 @5xl/events:flex-row @5xl/events:items-start">
								<div className="min-w-0 @5xl/events:flex-1">
									<EventTimeline events={events} selected={state.selected} timeZone={displayZone.zone} order={state.order} onOrder={(order) => (jupiterPlannerState.order = order)} onSelect={choose} className="max-h-[60vh]" />
								</div>
								<div ref={inspector} className="flex min-w-0 scroll-mt-4 flex-col gap-2 @5xl/events:sticky @5xl/events:top-0 @5xl/events:w-104 @5xl/events:flex-none">
									{selected ? (
										<EventInspector event={selected} all={answer.events} answer={answer} timeZone={displayZone.zone} onShowViewer={() => viewer.current?.scrollIntoView({ behavior: smooth(), block: 'start' })} />
									) : (
										<Notice>Choose an event to see its contacts and when the site can watch it; the viewer frames its moons at the maximum.</Notice>
									)}
								</div>
							</div>
						)}
					</section>
				</div>
			</div>
		</WorkspaceLayout>
	)
}
