import { useEffect, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { formatDegrees, formatGeographic } from '../../format'
import type { SiteLocation } from '../../location/site'
import { TimeZoneSelect } from '../../location/TimeZoneSelect'
import { ToolLocationSection } from '../../location/ToolLocationSection'
import { useActiveSite, useDisplayZone, useToolLocation } from '../../location/useLocation'
import { describeDisplayZone } from '../../location/zone'
import { PanelSection } from '../../shell/ContextualPanel'
import { WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
// oxfmt-ignore
import { browserPlannerIo, eveningOf, openKernelLibrary, ORIENTATION_LABELS, PLANET_ORIENTATIONS, type PlanetOrientation, type PlanetScale, periodRange, SCALE_LABELS, setTime } from '../planetary/planetary'
import { TimeBar } from '../planetary/TimeBar'
import { spiceKernelsState } from '../spicekernels/spicekernels'
import { MoonChart } from './MoonChart'
import { RingGeometry } from './RingGeometry'
import { RingHistoryChart } from './RingHistoryChart'
// oxfmt-ignore
import { describeSource, FALLBACK_LABELS, historyRange, interpolateTrack, listedEvents, loadElongations, loadSource, loadTimeline, loadTrack, MOON_LABELS, play, RING_HISTORIES, RING_HISTORY_LABELS, SATURN_MOONS, type SaturnPlannerState, saturnPlannerState, scheduleState, selectEvent, showSaturnInSky } from './saturn'
import { SaturnEventList } from './SaturnEventList'
import { SaturnViewer } from './SaturnViewer'

// Saturn Observing Planner tool: Saturn's disk, rings and seven major moons at the tool's own instant, the ring openings
// and ring-plane seasons over years, the moons over the period, and their greatest separations, all computed by the server
// from the ephemeris source it names for the rings and for the moons. The rings stay available when the moons cannot be
// computed. The tool's clock is its own, never the Sky's; choosing an event or a point of a chart only moves that clock.
// Nothing here moves the mount, changes a site or the profile, or starts an operation.

// Scales of the viewer, in display order.
const SCALES: readonly PlanetScale[] = ['disk', 'system']

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
	const location = useToolLocation(state.location)
	const active = useActiveSite()
	const displayZone = useDisplayZone(location, state.zone)
	const namingZone = location?.timeZone ?? displayZone.zone
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
			<ToolLocationSection value={state.location} location={location} onChange={(value) => (saturnPlannerState.location = value)} hint="Names the evenings and the zone of the times; the predictions are geocentric." />
			{location && (
				<PanelSection title="Time Zone">
					<TimeZoneSelect label="Times Shown In" value={state.zone} onChange={(value) => (saturnPlannerState.zone = value)} site={location} selectedSite={location.source !== 'active'} />
				</PanelSection>
			)}
			<PanelSection title="Moons">
				{SATURN_MOONS.map((moon) => (
					<Checkbox key={moon} label={MOON_LABELS[moon]} checked={state.moons.includes(moon)} onChange={(on) => (saturnPlannerState.moons = toggle(state.moons, moon, on))} />
				))}
			</PanelSection>
			<PanelSection title="View">
				<Select label="Orientation" options={PLANET_ORIENTATIONS} value={state.orientation} format={(value: PlanetOrientation) => ORIENTATION_LABELS[value]} onChange={(value) => (saturnPlannerState.orientation = value)} />
				<Checkbox label="Rings" checked={state.showRings} onChange={(on) => (saturnPlannerState.showRings = on)} />
			</PanelSection>
			<PanelSection title="Ephemeris">
				<p className="m-0 text-xs text-ink-300">Rings: {describeSource(ringSignature) ?? 'not computed yet.'}</p>
				<p className="m-0 text-xs text-ink-300">Moons: {describeSource(moonSignature) ?? (state.moonsRefused ? 'refused by the ephemeris policy.' : 'not computed yet.')}</p>
				{readiness('rings') && <p className="m-0 text-xs text-ink-300">{readiness('rings')}</p>}
				{readiness('moons') && <p className="m-0 text-xs text-ink-300">{readiness('moons')}</p>}
				<Button variant="secondary" onClick={() => openKernelLibrary()}>
					Manage Kernels
				</Button>
			</PanelSection>
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
		<WorkspaceLayout workspace="tools" title="Saturn Observing Planner" actions={actions} panel={{ title: 'Location, Moons, and View', content: panel }}>
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
					{state.moonsError && !state.moonsRefused && <Notice error>{state.moonsError}</Notice>}
					{state.ringError && <Notice error>{state.ringError}</Notice>}
					{range && <TimeBar state={state} store={saturnPlannerState} range={range} events={events.map((e) => ({ maximum: e.time }))} timeZone={displayZone.zone} now={browserPlannerIo.time} />}
					<div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
						<div className="flex min-w-0 flex-col gap-2">
							<SegmentedControl options={SCALES} value={state.scale} format={(scale) => SCALE_LABELS[scale]} onChange={(scale) => (saturnPlannerState.scale = scale)} />
							<SaturnViewer rings={rings} model={model} moons={view?.moons} positions={positions} orientation={state.orientation} scale={state.scale} drawn={state.moons} showRings={state.showRings} />
						</div>
						<div className="flex min-w-0 flex-col gap-2">
							{state.track && rings && <MoonChart track={state.track} equatorialRadius={rings.equatorialRadius} ringRadius={ringRadius} moons={state.moons} scale={state.scale} time={state.time} timeZone={displayZone.zone} onTime={(time) => setTime(saturnPlannerState, time)} />}
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
						<h2 className="m-0 text-sm font-semibold text-ink-100">Events of the period</h2>
						{state.elongationsError && <Notice error>{state.elongationsError}</Notice>}
						{events.length === 0 && state.elongations && <Notice>No ring-plane event or greatest separation of the chosen moons falls in this period. Iapetus reaches its greatest separation only every 40 days.</Notice>}
						{events.length > 0 && <SaturnEventList events={events} selected={state.selected} timeZone={displayZone.zone} onSelect={(event) => selectEvent(saturnPlannerState, event)} />}
					</section>
				</div>
			</div>
		</WorkspaceLayout>
	)
}
