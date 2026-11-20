import type { SaturnEvent, SaturnMoon } from 'api'
import { useEffect, useMemo, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { formatArcsec, formatDegrees } from '../../format'
import { openObservingSites, type SiteLocation } from '../../location/site'
import { useActiveLocation, useDisplayZone } from '../../location/useLocation'
import { describeDisplayZone } from '../../location/zone'
import { collapsibleSections, sectionOpen, setSectionOpen } from '../../shell/collapsible'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { useWorkspacePanel, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { DisclosureSummary } from '../../ui/DisclosureSummary'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { PanZoomSurface, usePanZoom } from '../planetary/PanZoom'
import { browserPlannerIo, eveningOf, followNow, openKernelLibrary, ORIENTATION_LABELS, PLANET_ORIENTATIONS, type PlanetOrientation, periodRange, setTime } from '../planetary/planetary'
import { PlanetCompass } from '../planetary/PlanetCompass'
import { TimeBar } from '../planetary/TimeBar'
import { spiceKernelsState } from '../spicekernels/spicekernels'
import { MoonChart } from './MoonChart'
import { RingGeometry } from './RingGeometry'
import { RingHistoryChart } from './RingHistoryChart'
import {
	describeSource,
	EVENT_KINDS,
	FALLBACK_LABELS,
	frameHalfWidth,
	historyRange,
	interpolateTrack,
	KIND_LABELS,
	listedEvents,
	listedMoons,
	listedPhenomena,
	loadElongations,
	loadEvents,
	loadSource,
	loadTimeline,
	loadTrack,
	MOON_LABELS,
	PLANET_HALF_WIDTH,
	play,
	RING_HISTORIES,
	RING_HISTORY_LABELS,
	SATURN_MOONS,
	type SaturnListedEvent,
	type SaturnPlannerState,
	type SaturnVisibilityFilter,
	saturnPlannerState,
	scheduleState,
	selectEvent,
	selectPhenomenon,
	showSaturnInSky,
	shownPhenomena,
	VISIBILITY_FILTERS,
} from './saturn'
import { SaturnEventList } from './SaturnEventList'
import { PhenomenaTable, PhenomenonInspector } from './SaturnPhenomena'
import { SaturnViewer } from './SaturnViewer'

// Saturn Observing Planner tool: Saturn's disk, rings and seven major moons at the tool's own instant, the moons over the
// period, the period's phenomena with their visibility from the active site, the ring-plane events and greatest
// separations, and the ring geometry with its seasons over years, all computed by the server from the ephemeris source
// it names for the rings and for the moons. The rings stay available when the moons cannot be computed. The tool's clock
// is its own, never the Sky's: it opens following real now (read again every 30 s until another instant is chosen),
// choosing an event or a point of a chart only moves it, and Show in Sky hands it to the Sky clock. The page leads with
// what the night decides: on a phone the viewer comes first, then the clock and the chart; from 1024 px the clock spans
// the top and the viewer and the chart stand side by side; then the phenomena, opening on those the site can watch, by
// night. Choosing one moves the clock to its maximum, frames and rings its moons in the viewer, and shows it in the
// inspector beside the list (from 64 rem of content, where it stays in sight while the page scrolls) or under it (where
// choosing brings it into view). The ring geometry and seasons, reference for the night rather than its decision, are
// folded under a one-line summary at the end. Nothing here moves the mount, changes a site or the profile, or starts an
// operation.

// Pan and zoom of the viewer, in Saturn radii: from the whole system (Iapetus reaches ~59) to the disk and rings,
// opening on the moons out to Rhea, two units wide for one high.
const ZOOM = { maxHalfWidth: 62, minHalfWidth: 1, initialHalfWidth: 10, aspect: 2 } as const

// Id of the folded Rings section, which keys whether it is open in the tab's section state.
const RINGS_SECTION = 'saturn.rings'

// Name of each visibility filter, above the list beside the count of the phenomena shown.
const FILTER_LABELS: Readonly<Record<SaturnVisibilityFilter, string>> = { watchable: 'Watchable', all: 'All' }

// What each visibility filter keeps, as its tooltip.
const FILTER_TITLES: Readonly<Record<SaturnVisibilityFilter, string>> = {
	watchable: 'The phenomena the site can watch, at least in part, including those the rings may hide',
	all: 'Every phenomenon of the chosen kinds and moons, watchable or not',
}

// Word of each illumination of the rings, in the summary of the folded Rings section.
const FACE_WORDS = { sameFace: 'lit face seen', oppositeFaces: 'unlit face seen', edgeOn: 'edge-on' } as const

// Whether the browser asks for reduced motion.
function prefersReducedMotion() {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Saturn Observing Planner tool.
export function SaturnPlanner() {
	const state = useSnapshot(saturnPlannerState) as SaturnPlannerState
	const kernels = useSnapshot(spiceKernelsState)
	const sections = useSnapshot(collapsibleSections)
	const zoom = usePanZoom(ZOOM)
	const panelState = useWorkspacePanel('tools')
	const scroller = useRef<HTMLDivElement>(null)
	const viewer = useRef<HTMLDivElement>(null)
	const inspector = useRef<HTMLDivElement>(null)
	const location = useActiveLocation()
	const displayZone = useDisplayZone(location)
	const namingZone = location?.timeZone ?? displayZone.zone
	const site: SiteLocation | undefined = location && { name: location.name, latitude: location.latitude, longitude: location.longitude, elevation: location.elevation, timeZone: location.timeZone }
	const siteKey = site && JSON.stringify([site.latitude, site.longitude, site.elevation, site.timeZone])
	const range = useMemo(() => (state.eveningDate ? periodRange(state.eveningDate, state.period, namingZone) : undefined), [state.eveningDate, state.period, namingZone])
	const history = useMemo(() => (range ? historyRange(state.history, range.start) : undefined), [state.history, range?.start])
	// A new kernel generation may change every answer, so they are all read again.
	const kernelKey = `${kernels.snapshot?.generation ?? -1}`

	// The clock starts following real now and the period at tonight, once.
	useEffect(() => {
		const now = browserPlannerIo.time()
		if (saturnPlannerState.time === undefined) followNow(saturnPlannerState, now)
		saturnPlannerState.eveningDate ??= eveningOf(now, namingZone)
	}, [])

	// The period's answers follow the period and the kernels.
	useEffect(() => {
		if (!range) return
		void loadTrack(saturnPlannerState, range)
		void loadElongations(saturnPlannerState, range)
		void loadSource(saturnPlannerState, range)
	}, [range?.start, range?.end, kernelKey])

	// The phenomena follow the period, the site, and the kernels.
	useEffect(() => {
		if (range) void loadEvents(saturnPlannerState, range, site)
	}, [range?.start, range?.end, siteKey, kernelKey])

	// The ring history follows its span and the kernels; it also gives the ring-plane events of the period.
	useEffect(() => {
		if (history) void loadTimeline(saturnPlannerState, history)
	}, [history?.start, history?.end, kernelKey])

	// The exact view follows the clock once it settles; while playing, the play loop asks for it.
	useEffect(() => {
		if (!state.playing && state.time !== undefined) return scheduleState(saturnPlannerState)
		return undefined
	}, [state.time, state.playing, kernelKey])

	// Play moves the clock; a hidden tab stops it.
	useEffect(() => {
		if (!state.playing) return undefined
		const stop = play(saturnPlannerState, prefersReducedMotion())
		const hidden = () => {
			if (document.hidden) saturnPlannerState.playing = false
		}
		document.addEventListener('visibilitychange', hidden)
		return () => {
			stop()
			document.removeEventListener('visibilitychange', hidden)
		}
	}, [state.playing])

	const view = state.moonsState
	const rings = view?.rings
	const model = view?.model
	const ringSignature = view?.signature ?? state.timeline?.signature
	const moonSignature = view?.signature ?? state.track?.signature
	const positions = state.playing && state.time !== undefined ? interpolateTrack(state.track, state.time) : undefined
	const listed = listedEvents(state.timeline, state.elongations, range, state.moons)
	const answer = state.events
	const phenomena = answer ? listedPhenomena(answer.events, state.kinds, state.moons) : []
	const shown = shownPhenomena(phenomena, state.visibilityFilter, !!site, state.order)
	const selectedPhenomenon = answer?.events.find((e) => e.id === state.selectedEvent)
	const jumps = [...listed.map((e) => ({ maximum: e.time })), ...shown]
	const ringRadius = model ? model.annuli.at(-1)!.outer / model.equatorialRadiusKm : 2.27
	const filtering = state.visibilityFilter === 'watchable' && !!site
	const count = answer && (shown.length === answer.events.length ? `${shown.length} phenomen${shown.length === 1 ? 'on' : 'a'}` : `${shown.length} of ${answer.events.length} phenomena`)
	const ringsOpen = sectionOpen(sections, RINGS_SECTION, false)
	const ringsSummary = state.timelineLoading ? 'computing…' : rings && `${FACE_WORDS[rings.illumination]} · seasons over ${RING_HISTORY_LABELS[state.history].toLowerCase()}`
	const smooth = () => (prefersReducedMotion() ? 'auto' : 'smooth')

	const toggle = <T extends string>(list: readonly T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((e) => e !== value))

	// Brings an element of the page into sight when its top is out of it, the page scrolling just enough to show it.
	const reveal = (element: HTMLElement | null) => {
		const page = scroller.current
		if (!element || !page) return
		const top = element.getBoundingClientRect().top - page.getBoundingClientRect().top
		if (top < 0 || top > page.clientHeight * 0.67) page.scrollBy({ top: top - 16, behavior: smooth() })
	}

	// Frames the moons of a chosen event at an instant in the viewer.
	const frame = (moons: readonly SaturnMoon[], time: number) => {
		const halfWidth = frameHalfWidth(moons, time, state.track, state.orientation, ZOOM.aspect)
		if (halfWidth !== undefined) zoom.show(halfWidth)
	}

	// Selects a phenomenon: the clock goes to its maximum, the viewer frames its moons, and the inspector comes into sight
	// when it stands under the list.
	const choosePhenomenon = (event: SaturnEvent) => {
		selectPhenomenon(saturnPlannerState, event)
		frame(event.moons, event.maximum)
		requestAnimationFrame(() => {
			const pane = inspector.current
			if (pane && getComputedStyle(pane).position !== 'sticky') reveal(pane)
		})
	}

	// Selects a ring-plane event or a greatest separation: the clock goes to it and the viewer frames its moon.
	const chooseListed = (event: SaturnListedEvent) => {
		selectEvent(saturnPlannerState, event)
		frame(listedMoons(event), event.time)
	}

	// Lists every kind and every moon again.
	const selectAll = () => {
		saturnPlannerState.kinds = [...EVENT_KINDS]
		saturnPlannerState.moons = [...SATURN_MOONS]
	}

	// One line of readiness of a scope's kernels.
	const readiness = (scope: 'rings' | 'moons') => {
		const report = state.source?.[scope]
		if (!report) return undefined
		const name = scope === 'rings' ? 'Rings' : 'Moons'
		return report.readiness === 'ready' ? `${name}: the enabled kernels cover the period.` : `${name}: ${report.reason ? FALLBACK_LABELS[report.reason] : report.readiness}.`
	}

	// Short name of the source of a scope, as the badges and the Ephemeris summary give it.
	const sourceName = (scope: 'rings' | 'moons') => {
		const signature = scope === 'rings' ? ringSignature : moonSignature
		if (!signature) return undefined
		return signature.source.kind === 'spk' ? 'SPICE kernels' : scope === 'rings' ? 'VSOP87E' : 'VSOP87E + TASS 1.7'
	}

	const panel = (
		<>
			<CollapsibleSection id="saturn.phenomena" title="Phenomena" summary={`${state.kinds.length} of ${EVENT_KINDS.length} kinds`}>
				<Actions>
					<Button variant="secondary" onClick={() => (saturnPlannerState.kinds = [...EVENT_KINDS])}>
						Select All
					</Button>
					<Button variant="secondary" onClick={() => (saturnPlannerState.kinds = [])}>
						Select None
					</Button>
				</Actions>
				{EVENT_KINDS.map((kind) => (
					<Checkbox key={kind} label={KIND_LABELS[kind]} checked={state.kinds.includes(kind)} onChange={(on) => (saturnPlannerState.kinds = toggle(state.kinds, kind, on))} />
				))}
			</CollapsibleSection>
			<CollapsibleSection id="saturn.moons" title="Moons" summary={`${state.moons.length} of ${SATURN_MOONS.length}`}>
				<Actions>
					<Button variant="secondary" onClick={() => (saturnPlannerState.moons = [...SATURN_MOONS])}>
						Select All
					</Button>
					<Button variant="secondary" onClick={() => (saturnPlannerState.moons = [])}>
						Select None
					</Button>
				</Actions>
				{SATURN_MOONS.map((moon) => (
					<Checkbox key={moon} label={MOON_LABELS[moon]} checked={state.moons.includes(moon)} onChange={(on) => (saturnPlannerState.moons = toggle(state.moons, moon, on))} />
				))}
			</CollapsibleSection>
			<CollapsibleSection id="saturn.view" title="View" summary={`${ORIENTATION_LABELS[state.orientation]}${state.showRings ? '' : ', no rings'}`} defaultOpen={false}>
				<Select label="Orientation" options={PLANET_ORIENTATIONS} value={state.orientation} format={(value: PlanetOrientation) => ORIENTATION_LABELS[value]} onChange={(value) => (saturnPlannerState.orientation = value)} />
				<Checkbox label="Rings" checked={state.showRings} onChange={(on) => (saturnPlannerState.showRings = on)} />
			</CollapsibleSection>
			<CollapsibleSection id="saturn.ephemeris" title="Ephemeris" summary={sourceName('moons') ?? sourceName('rings')} defaultOpen={false}>
				<Notice>Rings: {describeSource(ringSignature) ?? 'not computed yet.'}</Notice>
				<Notice>Moons: {describeSource(moonSignature) ?? 'not computed yet.'}</Notice>
				{readiness('rings') && <Notice>{readiness('rings')}</Notice>}
				{readiness('moons') && <Notice>{readiness('moons')}</Notice>}
				<Button variant="secondary" onClick={() => openKernelLibrary()}>
					Manage Kernels
				</Button>
			</CollapsibleSection>
		</>
	)

	const actions = (
		<Actions>
			<Button variant="secondary" onClick={() => showSaturnInSky(saturnPlannerState, site)} title="Shows Saturn in the Sky at this tool's instant">
				Show in Sky
			</Button>
		</Actions>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Saturn Observing Planner" actions={actions} panel={{ title: 'Filters and View', content: panel }} panelState={panelState}>
			<div ref={scroller} className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
					<p className="m-0 flex flex-wrap items-center gap-2 text-sm text-ink-300">
						{ringSignature && <StatusBadge tone={ringSignature.source.kind === 'spk' ? 'success' : 'neutral'} label={`Rings: ${sourceName('rings')}`} title={describeSource(ringSignature)} />}
						{moonSignature && <StatusBadge tone={moonSignature.source.kind === 'spk' ? 'success' : 'neutral'} label={`Moons: ${sourceName('moons')}`} title={describeSource(moonSignature)} />}
						<span>{describeDisplayZone(displayZone)}</span>
						{rings && (
							<span className="tabular-nums">
								· B {rings.earthOpening >= 0 ? '+' : '−'}
								{formatDegrees(Math.abs(rings.earthOpening), 2)} · diameter {formatArcsec(rings.equatorialRadius * 2, 1)}
							</span>
						)}
					</p>
					{!location && (
						<Notice>
							<span className="block">Without a site the phenomena are listed without their local visibility. Set the observing site of this profile.</span>
							<Button variant="secondary" className="mt-2" onClick={() => openObservingSites()}>
								Choose Observing Site
							</Button>
						</Notice>
					)}
					<div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
						<div ref={viewer} className="flex min-w-0 scroll-mt-4 flex-col gap-2 lg:col-start-1 lg:row-start-2">
							<PanZoomSurface zoom={zoom} planetHalfWidth={PLANET_HALF_WIDTH} planet="Saturn" legend={<PlanetCompass orientation={state.orientation} />}>
								<SaturnViewer rings={rings} model={model} moons={view?.moons} positions={positions} orientation={state.orientation} box={zoom.box} radiiPerPixel={zoom.radiiPerPixel} drawn={state.moons} highlight={state.highlight} showRings={state.showRings} />
							</PanZoomSurface>
							{state.moonsError && <Notice error>{state.moonsError}</Notice>}
						</div>
						{range && (
							<div className="min-w-0 lg:col-span-2 lg:row-start-1">
								<TimeBar state={state} store={saturnPlannerState} range={range} events={jumps} timeZone={displayZone.zone} eveningZone={namingZone} now={browserPlannerIo.time} />
							</div>
						)}
						<div className="flex min-w-0 flex-col gap-2 lg:col-start-2 lg:row-start-2">
							{state.track && rings && (
								<MoonChart
									track={state.track}
									equatorialRadius={rings.equatorialRadius}
									ringRadius={ringRadius}
									orientation={state.orientation}
									moons={state.moons}
									nights={answer?.nights ?? []}
									selected={selectedPhenomenon}
									time={state.time}
									timeZone={displayZone.zone}
									onTime={(time) => setTime(saturnPlannerState, time)}
								/>
							)}
							{state.trackLoading && <Notice>{state.track ? 'Computing the moons over the new period…' : 'Computing the moons over the period…'}</Notice>}
							{state.trackError && <Notice error>{state.trackError}</Notice>}
						</div>
					</div>
					<section className="@container/events flex flex-col gap-3">
						<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
							<h2 className="m-0 text-sm font-semibold text-ink-100">Phenomena</h2>
							<span title={site ? FILTER_TITLES[state.visibilityFilter] : 'Set an observing site to show only the phenomena it can watch'}>
								<SegmentedControl options={VISIBILITY_FILTERS} value={site ? state.visibilityFilter : 'all'} disabled={!site} format={(value) => FILTER_LABELS[value]} onChange={(value) => (saturnPlannerState.visibilityFilter = value)} />
							</span>
							{count && <span className="text-sm text-ink-200 tabular-nums">{count}</span>}
							{state.eventsLoading && <span className="text-sm text-ink-300">computing…</span>}
						</div>
						{state.eventsError && <Notice error>{state.eventsError}</Notice>}
						{answer && phenomena.length === 0 && (
							<Notice>
								<span className="block">
									{state.moons.length === 0
										? 'No moon is chosen.'
										: state.kinds.length === 0
											? 'No kind of phenomenon is chosen.'
											: 'No transit, shadow, occultation, eclipse, or mutual event of the chosen kinds and moons falls in this period. With the rings open the moons pass north or south of Saturn: these phenomena happen only within a few years of the ring-plane crossings (around 2025 and 2038–2039).'}
								</span>
								{(state.moons.length < SATURN_MOONS.length || state.kinds.length < EVENT_KINDS.length) && (
									<Button variant="secondary" className="mt-2" onClick={selectAll}>
										Select All Kinds and Moons
									</Button>
								)}
							</Notice>
						)}
						{answer && phenomena.length > 0 && shown.length === 0 && filtering && (
							<Notice>
								<span className="block">The site cannot watch any of the {phenomena.length} phenomena of the chosen kinds and moons in this period.</span>
								<Button variant="secondary" className="mt-2" onClick={() => (saturnPlannerState.visibilityFilter = 'all')}>
									Show All Phenomena
								</Button>
							</Notice>
						)}
						{answer && shown.length > 0 && (
							<div className="flex flex-col gap-4 @5xl/events:flex-row @5xl/events:items-start">
								<div className="min-w-0 @5xl/events:flex-1">
									<PhenomenaTable events={shown} selected={state.selectedEvent} timeZone={displayZone.zone} order={state.order} onOrder={(order) => (saturnPlannerState.order = order)} onSelect={choosePhenomenon} className="max-h-[60vh]" />
								</div>
								<div ref={inspector} className="flex min-w-0 scroll-mt-4 flex-col gap-2 @5xl/events:sticky @5xl/events:top-0 @5xl/events:w-104 @5xl/events:flex-none">
									{selectedPhenomenon ? (
										<PhenomenonInspector event={selectedPhenomenon} all={answer.events} answer={answer} timeZone={displayZone.zone} onShowViewer={() => viewer.current?.scrollIntoView({ behavior: smooth(), block: 'start' })} />
									) : (
										<Notice>Choose a phenomenon to see its contacts and when the site can watch it; the viewer frames its moons at the maximum.</Notice>
									)}
								</div>
							</div>
						)}
					</section>
					<section className="flex flex-col gap-2">
						<h2 className="m-0 text-sm font-semibold text-ink-100">Ring events and greatest separations</h2>
						{state.elongationsError && <Notice error>{state.elongationsError}</Notice>}
						{listed.length === 0 && state.elongations && <Notice>No ring-plane event or greatest separation of the chosen moons falls in this period. Iapetus reaches its greatest separation only every 40 days.</Notice>}
						{listed.length > 0 && <SaturnEventList events={listed} selected={state.selected} timeZone={displayZone.zone} onSelect={chooseListed} />}
					</section>
					<details open={ringsOpen} onToggle={(e) => e.currentTarget.open !== ringsOpen && setSectionOpen(collapsibleSections, RINGS_SECTION, e.currentTarget.open)} className="border-t border-line-100">
						<DisclosureSummary title="Rings">{ringsSummary && <span className="ml-auto min-w-0 truncate text-sm text-ink-200">{ringsSummary}</span>}</DisclosureSummary>
						<div className="flex flex-col gap-3 pb-1">
							<SegmentedControl options={RING_HISTORIES} value={state.history} format={(value) => RING_HISTORY_LABELS[value]} onChange={(value) => (saturnPlannerState.history = value)} className="self-start" />
							<div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
								{rings ? <RingGeometry rings={rings} /> : <Notice>Computing the rings at the clock's instant…</Notice>}
								<div className="min-w-0">
									{ringsOpen && state.timeline && <RingHistoryChart timeline={state.timeline} time={state.time} timeZone={displayZone.zone} onTime={(time) => setTime(saturnPlannerState, time)} />}
									{state.timelineError && <Notice error>{state.timelineError}</Notice>}
								</div>
							</div>
						</div>
					</details>
				</div>
			</div>
		</WorkspaceLayout>
	)
}
