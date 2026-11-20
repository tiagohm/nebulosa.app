import type { LocalLunarViewHandedness, LocalLunarViewOrientationMode, LunarEclipseSummary } from 'api'
import { cn } from 'cn'
import { Fragment, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { formatLongDateTime, formatLongDuration } from '../../format'
import { useDisplayZone, useToolLocation } from '../../location/useLocation'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Slider } from '../../ui/Slider'
import { formatEclipseAngle, formatEclipseMagnitude, viewFractionOf } from '../eclipse/eclipse'
import { EclipseLocationSection, EclipseZoneSelect, LocalContent } from '../eclipse/EclipsePanelParts'
import { CONTACT_NAMES, ECLIPSE_TYPE_NAMES, isStaleLocal, loadLocal, lunarEclipseState, PHASE_NAMES, phaseAt, phaseDurations, selectEvent, setViewSettings, visibilityHeadline } from './lunareclipse'
import { LunarEclipseLocalView } from './LunarEclipseLocalView'

// Local Circumstances panel of the Lunar Eclipse Map: the location (the shared Location section), what the place sees
// of the eclipse (the moonrise or moonset during it and the phase it falls in, how long the Moon is up, and where the
// Moon is at greatest eclipse), the contacts in the zone shown (resolved with the location), the Local View with the
// Moon's position at the instant drawn, the magnitudes and durations, and About. The global contact times are shown
// even without a place or when the Moon is below its horizon. Nothing here changes the profile or a site; the map
// component asks for the local circumstances of the location chosen.

// Orientations of the Local View, in display order.
const ORIENTATIONS: readonly LocalLunarViewOrientationMode[] = ['zenith', 'north']

// Handedness of the Local View, in display order.
const HANDEDNESS: readonly LocalLunarViewHandedness[] = ['eastRight', 'eastLeft']

interface HorizonCrossingRowProps {
	// Name of the crossing, Moonrise or Moonset.
	readonly label: string
	// Its instant, in Unix milliseconds (UTC).
	readonly time: number
	// Eclipse it falls in, whose phase it names.
	readonly eclipse: LunarEclipseSummary
	// IANA zone the time is shown in.
	readonly timeZone: string
}

// A moonrise or moonset during the eclipse: its time and the phase it falls in.
function HorizonCrossingRow({ label, time, eclipse, timeZone }: HorizonCrossingRowProps) {
	return (
		<DataRow label={label}>
			<span className="flex flex-col items-end">
				<span>{formatLongDateTime(time, timeZone)}</span>
				<span className="text-ink-300">during {PHASE_NAMES[phaseAt(eclipse, time)]}</span>
			</span>
		</DataRow>
	)
}

// Moon's horizontal position in words: altitude, azimuth, and whether it is above the horizon.
function moonPosition(altitude: number, azimuth: number, observable: boolean) {
	return `Alt ${formatEclipseAngle(altitude)} · Az ${formatEclipseAngle(azimuth)} · ${observable ? 'above' : 'below'} horizon`
}

// Local Circumstances panel.
export function LunarEclipsePanel() {
	const state = useSnapshot(lunarEclipseState)
	const { eclipse, place, local, localError, selectedEvent, view } = state
	const location = useToolLocation(state.location)
	const displayZone = useDisplayZone(location, state.zone)
	const timeZone = displayZone.zone
	const events = new Map(local?.events.map((event) => [event.kind, event]))
	const maximum = events.get('MAX')
	// Stage of the eclipse the Local View draws, as the slider holds it while its answer is on the way.
	const fraction = state.viewFraction ?? (local && viewFractionOf(local, 'P1', 'P4'))
	const durations = eclipse && phaseDurations(eclipse)
	const stale = isStaleLocal(local, place)
	const viewFractionTimer = useRef<Timer | undefined>(undefined)
	const drawnAt = local?.view.selectedEvent ? ` at ${local.view.selectedEvent}` : ''

	function handleViewFraction(percent: number) {
		const fraction = percent / 100
		if (lunarEclipseState.viewFraction === fraction) return
		lunarEclipseState.viewFraction = fraction
		clearTimeout(viewFractionTimer.current)
		viewFractionTimer.current = setTimeout(loadLocal, 500, lunarEclipseState)
	}

	return (
		<>
			<EclipseLocationSection id="lunarEclipse.location" value={state.location} location={location} onChange={(value) => (lunarEclipseState.location = value)} />
			{place && eclipse && (
				<CollapsibleSection id="lunarEclipse.visibility" title="Visibility">
					<LocalContent stale={stale}>
						{local && <p className="m-0 font-medium text-ink-100">{visibilityHeadline(eclipse.type, local.visibility)}</p>}
						{local?.windows.map((window) => (
							<Fragment key={window.start}>
								{window.rise && <HorizonCrossingRow label="Moonrise" time={window.start} eclipse={eclipse} timeZone={timeZone} />}
								{window.set && <HorizonCrossingRow label="Moonset" time={window.end} eclipse={eclipse} timeZone={timeZone} />}
							</Fragment>
						))}
						{local?.visibility.hasObservableEclipse && <DataRow label="Moon up during the eclipse">{formatLongDuration(local.details.observableDuration)}</DataRow>}
						{maximum && <DataRow label="Moon at MAX">{moonPosition(maximum.altitude, maximum.azimuth, maximum.observable)}</DataRow>}
						{local && !local.visibility.hasObservableEclipse && <Notice>The Moon stays below the horizon here from P1 to P4; the contact times still hold for everyone.</Notice>}
						{eclipse.type === 'PENUMBRAL' && <Notice>A penumbral eclipse only dims the Moon slightly; the shading is usually noticed only near greatest eclipse, and when the penumbral magnitude exceeds about 0.7.</Notice>}
					</LocalContent>
					{localError && (
						<>
							<Notice error>{localError}</Notice>
							<Button variant="secondary" className="self-start" onClick={() => void loadLocal(lunarEclipseState)}>
								Retry
							</Button>
						</>
					)}
					<Notice>Visible means the Moon's center at or above the 0° horizon, without refraction.</Notice>
				</CollapsibleSection>
			)}
			{eclipse && (
				<CollapsibleSection id="lunarEclipse.contacts" title="Contacts">
					<EclipseZoneSelect value={state.zone} zone={displayZone} location={location} selectedSite={state.location.mode !== 'active'} onChange={(zone) => (lunarEclipseState.zone = zone)} />
					{eclipse.contacts.map((contact) => {
						const event = events.get(contact.kind)
						const selected = state.viewFraction === undefined && contact.kind === selectedEvent

						return (
							<button
								key={contact.kind}
								type="button"
								onClick={() => void selectEvent(lunarEclipseState, contact.kind)}
								className={cn(
									'flex cursor-pointer flex-col gap-0.5 rounded-sm border px-2 py-1.5 text-left font-mono text-xs text-inherit transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none',
									selected ? 'border-accent bg-accent-subtle' : 'border-line-100 bg-transparent hover:border-line-200',
								)}
							>
								<span className="flex items-baseline justify-between gap-2">
									<span className="font-semibold text-ink-100">{contact.kind}</span>
									<span className="truncate text-ink-300">{CONTACT_NAMES[contact.kind]}</span>
								</span>
								<span className="text-ink-100">{formatLongDateTime(contact.time, timeZone)}</span>
								{event && (
									<span className={cn('flex flex-wrap items-baseline justify-between gap-x-2 transition-opacity duration-150 motion-reduce:transition-none', event.observable ? 'text-ink-200' : 'text-ink-300', stale && 'opacity-40')}>
										<span>
											Alt {formatEclipseAngle(event.altitude)} · Az {formatEclipseAngle(event.azimuth)}
										</span>
										<span>{event.observable ? 'Above horizon' : 'Below horizon'}</span>
									</span>
								)}
							</button>
						)
					})}
				</CollapsibleSection>
			)}
			{local && (
				<CollapsibleSection id="lunarEclipse.localView" title="Local View">
					<LocalContent stale={stale}>
						<LunarEclipseLocalView view={local.view} />
						{fraction !== undefined && <Slider label="Instant drawn, % from P1 to P4" value={Math.round(fraction * 1000) / 10} min={0} max={100} step={0.1} onChange={handleViewFraction} />}
						{local.view.time !== undefined && <DataRow label="Drawn at">{formatLongDateTime(local.view.time, timeZone)}</DataRow>}
						{local.view.altitude !== undefined && local.view.azimuth !== undefined && local.view.observable !== undefined && <DataRow label={`Moon${drawnAt}`}>{moonPosition(local.view.altitude, local.view.azimuth, local.view.observable)}</DataRow>}
						{local.view.positionAngle !== undefined && <DataRow label={`Position angle${drawnAt}`}>{formatEclipseAngle(local.view.positionAngle)}</DataRow>}
						{local.view.zenithAngle !== undefined && <DataRow label={`Zenith angle${drawnAt}`}>{formatEclipseAngle(local.view.zenithAngle)}</DataRow>}
					</LocalContent>
					<SegmentedControl label="Up" options={ORIENTATIONS} value={view.orientation} onChange={(orientation) => void setViewSettings(lunarEclipseState, { orientation })} format={(value) => (value === 'zenith' ? 'Zenith' : 'North')} />
					<SegmentedControl label="East" options={HANDEDNESS} value={view.handedness} onChange={(handedness) => void setViewSettings(lunarEclipseState, { handedness })} format={(value) => (value === 'eastRight' ? 'Right' : 'Left')} />
					<Checkbox label="Moon at the other contacts" checked={view.ghosts} onChange={(ghosts) => void setViewSettings(lunarEclipseState, { ghosts })} />
					<Notice>
						The Moon crossing the Earth's penumbra and umbra as seen from here; the shaded band is below the horizon. The angles place the contact on the Moon's limb, or between contacts the limb point nearest the shadow's center: the position angle from celestial north through east, the zenith angle from
						the zenith. A geometric diagram, not a rendering.
					</Notice>
				</CollapsibleSection>
			)}
			{eclipse && durations && (
				<CollapsibleSection id="lunarEclipse.details" title="Details">
					<DataRow label="Type">{ECLIPSE_TYPE_NAMES[eclipse.type]}</DataRow>
					<DataRow label={eclipse.type === 'PENUMBRAL' ? 'Penumbral magnitude' : 'Umbral magnitude'}>{formatEclipseMagnitude(eclipse.magnitude)}</DataRow>
					{local && eclipse.type !== 'PENUMBRAL' && (
						<LocalContent stale={stale}>
							<DataRow label="Penumbral magnitude">{formatEclipseMagnitude(local.details.maximalPenumbralMagnitude)}</DataRow>
						</LocalContent>
					)}
					{durations.penumbral !== undefined && <DataRow label="Penumbral phase">{formatLongDuration(durations.penumbral)}</DataRow>}
					{durations.partial !== undefined && <DataRow label="Partial phase">{formatLongDuration(durations.partial)}</DataRow>}
					{durations.total !== undefined && <DataRow label="Totality">{formatLongDuration(durations.total)}</DataRow>}
				</CollapsibleSection>
			)}
			<CollapsibleSection id="lunarEclipse.about" title="About" defaultOpen={false}>
				<Notice>A computed prediction from the toolkit's ephemerides. Partial and total contacts are computed to about 5 s and penumbral ones to about 30 s, though the edges of the Earth's shadow are too diffuse to see them that sharply.</Notice>
			</CollapsibleSection>
		</>
	)
}
