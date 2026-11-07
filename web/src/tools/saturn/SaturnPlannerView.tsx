import { useEffect, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { formatDegrees, formatGeographic } from '../../format'
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
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
// oxfmt-ignore
import { browserPlannerIo, eveningOf, openKernelLibrary, ORIENTATION_LABELS, PLANET_ORIENTATIONS, type PlanetOrientation, periodRange, setTime } from '../planetary/planetary'
import { PanZoomSurface, usePanZoom } from '../planetary/PanZoom'
import { TimeBar } from '../planetary/TimeBar'
import { spiceKernelsState } from '../spicekernels/spicekernels'
import { MoonChart } from './MoonChart'
import { RingGeometry } from './RingGeometry'
import { RingHistoryChart } from './RingHistoryChart'
// oxfmt-ignore
import { describeSource, EVENT_KINDS, FALLBACK_LABELS, historyRange, interpolateTrack, KIND_LABELS, listedEvents, listedPhenomena, loadElongations, loadEvents, loadSource, loadTimeline, loadTrack, MOON_LABELS, play, RING_HISTORIES, RING_HISTORY_LABELS, SATURN_MOONS, type SaturnPlannerState, saturnPlannerState, scheduleState, selectEvent, selectPhenomenon, showSaturnInSky } from './saturn'
import { SaturnEventList } from './SaturnEventList'
import { PhenomenaTable, PhenomenonInspector } from './SaturnPhenomena'
import { SaturnViewer } from './SaturnViewer'

// Saturn Observing Planner tool: Saturn's disk, rings and seven major moons at the tool's own instant, the ring openings
// and ring-plane seasons over years, the moons over the period, and their greatest separations, all computed by the server
// from the ephemeris source it names for the rings and for the moons. The rings stay available when the moons cannot be
// computed. The tool's clock is its own, never the Sky's; choosing an event or a point of a chart only moves that clock.
// Nothing here moves the mount, changes a site or the profile, or starts an operation.

// Pan and zoom of the viewer, in Saturn radii: from the whole system (Iapetus reaches ~59) to the disk and rings,
// opening on the moons out to Rhea, two units wide for one high.
const ZOOM = { maxHalfWidth: 62, minHalfWidth: 1, initialHalfWidth: 7, aspect: 2 } as const

// Half-width of the close-up of Saturn and its rings, in Saturn radii.
const PLANET_HALF_WIDTH = 2.8

// Arcseconds per radian.
const ARCSEC = (180 / Math.PI) * 3600

// Whether the browser asks for reduced motion.
function prefersReducedMotion() {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Saturn Observing Planner tool.
export function SaturnPlanner() {
	const state = useSnapshot(saturnPlannerState) as SaturnPlannerState
	const kernels = useSnapshot(spiceKernelsState)
	const zoom = usePanZoom(ZOOM)
	const location = useToolLocation(state.location)
	const active = useActiveSite()
	const displayZone = useDisplayZone(location, state.zone)
	const namingZone = location?.timeZone ?? displayZone.zone
	const site: SiteLocation | undefined = location && { name: location.name, latitude: location.latitude, longitude: location.longitude, elevation: location.elevation, timeZone: location.timeZone }
	const siteKey = site && JSON.stringify([site.latitude, site.longitude, site.elevation, site.timeZone])
	const activeSite: SiteLocation | undefined = active && { name: active.name, latitude: active.latitude, longitude: active.longitude, elevation: active.elevation, timeZone: active.timeZone }
	const range = useMemo(() => (state.eveningDate ? periodRange(state.eveningDate, state.period, namingZone) : undefined), [state.eveningDate, state.period, namingZone])
	const history = useMemo(() => (range ? historyRange(state.history, range.start) : undefined), [state.history, range?.start])
	// A new kernel generation or policy may change every answer, so they are all read again.
	const kernelKey = `${kernels.snapshot?.generation ?? -1}|${kernels.snapshot?.policy ?? ''}`

	// The clock starts at real now and the period at tonight, once.
	useEffect(() => {
		const now = browserPlannerIo.time()
		saturnPlannerState.time ??= now
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

	// The ring history follows its span and the kernels.
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
	const rings = view?.rings ?? state.ringState?.rings
	const model = view?.model ?? state.ringState?.model
	const ringSignature = view?.signature ?? state.ringState?.signature ?? state.timeline?.signature
	const moonSignature = view?.signature ?? state.track?.signature
	const positions = state.playing && state.time !== undefined ? interpolateTrack(state.track, state.time) : undefined
	const events = listedEvents(state.timeline, state.elongations, range, state.moons)
	const phenomena = state.events ? listedPhenomena(state.events.events, state.kinds, state.moons) : []
	const selectedPhenomenon = state.events?.events.find((e) => e.id === state.selectedEvent)
	const jumps = [...events.map((e) => ({ maximum: e.time })), ...phenomena]
	const ringRadius = model ? model.annuli.at(-1)!.outer / model.equatorialRadiusKm : 2.27

	const toggle = <T extends string>(list: readonly T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((e) => e !== value))

	// One line of readiness of a scope's kernels.
	const readiness = (scope: 'rings' | 'moons') => {
		const report = state.source?.[scope]
		if (!report) return undefined
		const name = scope === 'rings' ? 'Rings' : 'Moons'
		return report.readiness === 'ready' ? `${name}: the enabled kernels cover the period.` : `${name}: ${report.reason ? FALLBACK_LABELS[report.reason] : report.readiness}${report.source === 'unavailable' ? ', and the policy allows only kernels' : ''}.`
	}

	const panel = (
		<>
			<ToolLocationSection value={state.location} location={location} onChange={(value) => (saturnPlannerState.location = value)} collapsibleId="saturn.location" elevation hint="Only decides when the phenomena can be watched; the predictions are geocentric." />
			{location && (
				<CollapsibleSection id="saturn.timeZone" title="Time Zone" summary={displayZone.zone} defaultOpen={false}>
					<TimeZoneSelect label="Times Shown In" value={state.zone} onChange={(value) => (saturnPlannerState.zone = value)} site={location} selectedSite={location.source !== 'active'} />
				</CollapsibleSection>
			)}
			<CollapsibleSection id="saturn.phenomena" title="Phenomena" summary={`${state.kinds.length} of ${EVENT_KINDS.length} kinds`}>
				{EVENT_KINDS.map((kind) => (
					<Checkbox key={kind} label={KIND_LABELS[kind]} checked={state.kinds.includes(kind)} onChange={(on) => (saturnPlannerState.kinds = toggle(state.kinds, kind, on))} />
				))}
			</CollapsibleSection>
			<CollapsibleSection id="saturn.moons" title="Moons" summary={`${state.moons.length} of ${SATURN_MOONS.length}`}>
				{SATURN_MOONS.map((moon) => (
					<Checkbox key={moon} label={MOON_LABELS[moon]} checked={state.moons.includes(moon)} onChange={(on) => (saturnPlannerState.moons = toggle(state.moons, moon, on))} />
				))}
			</CollapsibleSection>
			<CollapsibleSection id="saturn.view" title="View" summary={`${ORIENTATION_LABELS[state.orientation]}${state.showRings ? '' : ', no rings'}`} defaultOpen={false}>
				<Select label="Orientation" options={PLANET_ORIENTATIONS} value={state.orientation} format={(value: PlanetOrientation) => ORIENTATION_LABELS[value]} onChange={(value) => (saturnPlannerState.orientation = value)} />
				<Checkbox label="Rings" checked={state.showRings} onChange={(on) => (saturnPlannerState.showRings = on)} />
			</CollapsibleSection>
			<CollapsibleSection id="saturn.ephemeris" title="Ephemeris" summary={moonSignature ? (moonSignature.source.kind === 'spk' ? 'SPICE kernels' : 'VSOP87E + TASS 1.7') : ringSignature ? (ringSignature.source.kind === 'spk' ? 'SPICE kernels' : 'VSOP87E') : undefined} defaultOpen={false}>
				<p className="m-0 text-xs text-ink-300">Rings: {describeSource(ringSignature) ?? 'not computed yet.'}</p>
				<p className="m-0 text-xs text-ink-300">Moons: {describeSource(moonSignature) ?? (state.moonsRefused ? 'refused by the ephemeris policy.' : 'not computed yet.')}</p>
				{readiness('rings') && <p className="m-0 text-xs text-ink-300">{readiness('rings')}</p>}
				{readiness('moons') && <p className="m-0 text-xs text-ink-300">{readiness('moons')}</p>}
				<Button variant="secondary" onClick={() => openKernelLibrary()}>
					Manage Kernels
				</Button>
			</CollapsibleSection>
		</>
	)

	const actions = (
		<Actions>
			<Button variant="secondary" onClick={() => showSaturnInSky(activeSite)}>
				Show in Sky
			</Button>
		</Actions>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Saturn Observing Planner" actions={actions} panel={{ title: 'Location, Filters, and View', content: panel }}>
			<div className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
					<p className="m-0 flex flex-wrap items-center gap-2 text-xs text-ink-300">
						{ringSignature && <StatusBadge tone={ringSignature.source.kind === 'spk' ? 'success' : 'neutral'} label={`Rings: ${ringSignature.source.kind === 'spk' ? 'SPICE kernels' : 'VSOP87E'}`} />}
						{moonSignature && <StatusBadge tone={moonSignature.source.kind === 'spk' ? 'success' : 'neutral'} label={`Moons: ${moonSignature.source.kind === 'spk' ? 'SPICE kernels' : 'TASS 1.7'}`} />}
						{state.moonsRefused && <StatusBadge tone="danger" label="Moons refused" />}
						<span>{location ? `${location.name ?? 'Coordinates entered'} · ${formatGeographic(location.latitude, location.longitude)}` : 'No site'}</span>
						<span>· {describeDisplayZone(displayZone)}</span>
						{rings && (
							<span>
								· B {rings.earthOpening >= 0 ? '+' : '−'}
								{formatDegrees(Math.abs(rings.earthOpening), 2)} · diameter {(rings.equatorialRadius * 2 * ARCSEC).toFixed(1)}″
							</span>
						)}
					</p>
					{state.moonsRefused && (
						<Notice error>
							<span className="block">{state.moonsError} The ephemeris policy allows only SPICE kernels and none gives Saturn's moons, so only the rings are shown. A Saturnian satellite kernel such as sat441.bsp gives them.</span>
							<Button variant="secondary" className="mt-2" onClick={() => openKernelLibrary()}>
								Manage Kernels
							</Button>
						</Notice>
					)}
					{!location && (
						<Notice>
							<span className="block">{state.location.mode === 'active' ? 'Without a site the phenomena are listed without their local visibility. Set the observing site of this profile, or choose a location in the panel.' : 'The site chosen was deleted. Choose another location in the panel.'}</span>
							<Button variant="secondary" className="mt-2" onClick={() => openObservingSites()}>
								Set Location
							</Button>
						</Notice>
					)}
					{state.moonsError && !state.moonsRefused && <Notice error>{state.moonsError}</Notice>}
					{state.ringError && <Notice error>{state.ringError}</Notice>}
					{range && <TimeBar state={state} store={saturnPlannerState} range={range} events={jumps} timeZone={displayZone.zone} now={browserPlannerIo.time} />}
					<div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
						<div className="flex min-w-0 flex-col gap-2">
							<PanZoomSurface zoom={zoom} planetHalfWidth={PLANET_HALF_WIDTH} planet="Saturn">
								<SaturnViewer rings={rings} model={model} moons={view?.moons} positions={positions} orientation={state.orientation} box={zoom.box} drawn={state.moons} showRings={state.showRings} />
							</PanZoomSurface>
						</div>
						<div className="flex min-w-0 flex-col gap-2">
							{state.track && rings && <MoonChart track={state.track} equatorialRadius={rings.equatorialRadius} ringRadius={ringRadius} moons={state.moons} time={state.time} timeZone={displayZone.zone} onTime={(time) => setTime(saturnPlannerState, time)} />}
							{state.trackLoading && !state.track && <p className="m-0 text-xs text-ink-300">Computing the moons over the period…</p>}
							{state.trackError && <Notice error>{state.trackError}</Notice>}
						</div>
					</div>
					<section className="flex flex-col gap-2">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h2 className="m-0 text-sm font-semibold text-ink-100">Rings {state.timelineLoading && <span className="font-normal text-ink-300">· computing the seasons…</span>}</h2>
							<SegmentedControl options={RING_HISTORIES} value={state.history} format={(value) => RING_HISTORY_LABELS[value]} onChange={(value) => (saturnPlannerState.history = value)} />
						</div>
						<div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
							{rings ? <RingGeometry rings={rings} /> : <p className="m-0 text-xs text-ink-300">Computing the rings…</p>}
							<div className="min-w-0">
								{state.timeline && <RingHistoryChart timeline={state.timeline} time={state.time} timeZone={displayZone.zone} onTime={(time) => setTime(saturnPlannerState, time)} />}
								{state.timelineError && <Notice error>{state.timelineError}</Notice>}
							</div>
						</div>
					</section>
					<section className="flex flex-col gap-2">
						<h2 className="m-0 text-sm font-semibold text-ink-100">Phenomena {state.eventsLoading && <span className="font-normal text-ink-300">· computing…</span>}</h2>
						{state.eventsError && !state.moonsRefused && <Notice error>{state.eventsError}</Notice>}
						{state.events && phenomena.length === 0 && (
							<Notice>No transit, shadow, occultation, eclipse, or mutual event of the chosen kinds and moons falls in this period. With the rings open the moons pass north or south of Saturn: these phenomena happen only within a few years of the ring-plane crossings (around 2025 and 2038–2039).</Notice>
						)}
						{phenomena.length > 0 && <PhenomenaTable events={phenomena} selected={state.selectedEvent} timeZone={displayZone.zone} onSelect={(event) => selectPhenomenon(saturnPlannerState, event)} />}
						{state.events && selectedPhenomenon && <PhenomenonInspector event={selectedPhenomenon} all={state.events.events} answer={state.events} timeZone={displayZone.zone} />}
					</section>
					<section className="flex flex-col gap-2">
						<h2 className="m-0 text-sm font-semibold text-ink-100">Ring events and greatest separations</h2>
						{state.elongationsError && <Notice error>{state.elongationsError}</Notice>}
						{events.length === 0 && state.elongations && <Notice>No ring-plane event or greatest separation of the chosen moons falls in this period. Iapetus reaches its greatest separation only every 40 days.</Notice>}
						{events.length > 0 && <SaturnEventList events={events} selected={state.selected} timeZone={displayZone.zone} onSelect={(event) => selectEvent(saturnPlannerState, event)} />}
					</section>
				</div>
			</div>
		</WorkspaceLayout>
	)
}
