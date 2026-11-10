import { useEffect, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { formatDegrees } from '../../format'
import { openObservingSites, type SiteLocation } from '../../location/site'
import { useActiveLocation, useDisplayZone } from '../../location/useLocation'
import { describeDisplayZone } from '../../location/zone'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Notice } from '../../ui/Notice'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { PanZoomSurface, usePanZoom } from '../planetary/PanZoom'
import { browserPlannerIo, eveningOf, openKernelLibrary, ORIENTATION_LABELS, PLANET_ORIENTATIONS, type PlanetOrientation, periodRange, setTime } from '../planetary/planetary'
import { TimeBar } from '../planetary/TimeBar'
import { EventInspector, EventTimeline } from './EventTimeline'
import { GrsSettings } from './GrsSettings'
import { describeSource, EVENT_KINDS, FALLBACK_LABELS, GALILEAN_MOONS, interpolateTrack, type JupiterPlannerState, jupiterGrsState, jupiterPlannerState, KIND_LABELS, listedEvents, loadEvents, loadSource, loadTrack, MOON_LABELS, play, scheduleState, selectEvent, showJupiterInSky } from './jupiter'
import { JupiterViewer } from './JupiterViewer'
import { MoonChart } from './MoonChart'

// Jupiter Observing Planner tool: the view of Jupiter and its Galilean moons at the tool's own instant, the moons over the
// period, and the period's phenomena with their visibility from the active site, all computed by the server from one
// ephemeris source it names. The tool's clock is its own, never the Sky's; choosing an event only moves that clock.
// Nothing here moves the mount, changes a site or the profile, or starts an operation.

// Pan and zoom of the viewer, in Jupiter radii: from the whole system (Callisto reaches ~26.3) to the disk, opening on
// Io, Europa, and Ganymede, two units wide for one high.
const ZOOM = { maxHalfWidth: 30, minHalfWidth: 1, initialHalfWidth: 6, aspect: 2 } as const

// Half-width of the close-up of Jupiter, in Jupiter radii.
const PLANET_HALF_WIDTH = 2.6

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

	// The clock starts at real now and the period at tonight, once.
	useEffect(() => {
		const now = browserPlannerIo.time()
		jupiterPlannerState.time ??= now
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
	const events = answer ? listedEvents(answer.events, state.kinds, state.moons) : []
	const selected = answer?.events.find((e) => e.id === state.selected)
	const positions = state.playing && state.time !== undefined ? interpolateTrack(state.track, state.time) : undefined
	const signature = state.state?.signature ?? answer?.signature
	const source = signature?.source

	const toggle = <T extends string>(list: readonly T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((e) => e !== value))

	const panel = (
		<>
			<CollapsibleSection id="jupiter.events" title="Events" summary={`${state.kinds.length} of ${EVENT_KINDS.length} kinds`}>
				{EVENT_KINDS.map((kind) => (
					<Checkbox key={kind} label={KIND_LABELS[kind]} checked={state.kinds.includes(kind)} onChange={(on) => (jupiterPlannerState.kinds = toggle(state.kinds, kind, on))} />
				))}
			</CollapsibleSection>
			<CollapsibleSection id="jupiter.moons" title="Moons" summary={`${state.moons.length} of ${GALILEAN_MOONS.length}`}>
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
				{state.source && <Notice>{state.source.readiness === 'readyForJupiter' ? 'The enabled kernels cover the whole period.' : `Kernels: ${state.source.reason ? FALLBACK_LABELS[state.source.reason] : state.source.readiness}.`}</Notice>}
				<Button variant="secondary" onClick={() => openKernelLibrary()}>
					Manage Kernels
				</Button>
			</CollapsibleSection>
		</>
	)

	const actions = (
		<Actions>
			<Button variant="secondary" onClick={() => showJupiterInSky(site)}>
				Show in Sky
			</Button>
		</Actions>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Jupiter Observing Planner" actions={actions} panel={{ title: 'Filters and Model', content: panel }}>
			<div className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
					<p className="m-0 flex flex-wrap items-center gap-2 text-xs text-ink-300">
						{source && <StatusBadge tone={source.kind === 'spk' ? 'success' : 'neutral'} label={source.kind === 'spk' ? 'SPICE kernels' : 'VSOP87E + L1.2'} />}
						<span>{describeDisplayZone(displayZone)}</span>
						{state.state && (
							<span>
								· CM II {formatDegrees(state.state.disk.centralMeridian.II, 1)} · diameter {((state.state.disk.equatorialRadius * 2 * 180 * 3600) / Math.PI).toFixed(1)}″
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
					{state.kernelsRefused && (
						<Notice error>
							<span className="block">{state.eventsError} The ephemeris policy allows only SPICE kernels, so nothing is computed from the analytical theories.</span>
							<Button variant="secondary" className="mt-2" onClick={() => openKernelLibrary()}>
								Manage Kernels
							</Button>
						</Notice>
					)}
					{range && <TimeBar state={state} store={jupiterPlannerState} range={range} events={events} timeZone={displayZone.zone} now={browserPlannerIo.time} />}
					<div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
						<div className="flex min-w-0 flex-col gap-2">
							<PanZoomSurface zoom={zoom} planetHalfWidth={PLANET_HALF_WIDTH} planet="Jupiter">
								<JupiterViewer state={state.state} positions={positions} orientation={state.orientation} box={zoom.box} moons={state.moons} />
							</PanZoomSurface>
							{state.stateError && <Notice error>{state.stateError}</Notice>}
							{grs.grs && !grs.grs.model && <Notice>No Great Red Spot model: set it in the panel to draw the spot and predict its transits.</Notice>}
						</div>
						<div className="flex min-w-0 flex-col gap-2">
							{state.track && <MoonChart track={state.track} poleAngle={state.state?.disk.poleAngle ?? 0} moons={state.moons} nights={answer?.nights ?? []} selected={selected} time={state.time} timeZone={displayZone.zone} onTime={(time) => setTime(jupiterPlannerState, time)} />}
							{state.trackLoading && !state.track && <Notice>Computing the moons over the period…</Notice>}
							{state.trackError && <Notice error>{state.trackError}</Notice>}
						</div>
					</div>
					<section className="flex flex-col gap-2">
						<h2 className="m-0 text-sm font-semibold text-ink-100">Events {state.eventsLoading && <span className="font-normal text-ink-300">· computing…</span>}</h2>
						{state.eventsError && !state.kernelsRefused && <Notice error>{state.eventsError}</Notice>}
						{answer && events.length === 0 && <Notice>No phenomenon of the chosen kinds and moons falls in this period. Mutual events only happen in the seasons around Jupiter's equinox, and Callisto misses the disk in some years.</Notice>}
						{answer && events.length > 0 && <EventTimeline events={events} selected={state.selected} timeZone={displayZone.zone} onSelect={(event) => selectEvent(jupiterPlannerState, event)} />}
						{answer && selected && <EventInspector event={selected} all={answer.events} answer={answer} timeZone={displayZone.zone} />}
					</section>
				</div>
			</div>
		</WorkspaceLayout>
	)
}
