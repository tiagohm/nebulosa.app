import type { LocalLunarViewHandedness, LocalLunarViewOrientationMode } from 'api'
import { cn } from 'cn'
import { useRef } from 'react'
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
import { CONTACT_NAMES, ECLIPSE_TYPE_NAMES, isStaleLocal, loadLocal, lunarEclipseState, phaseDurations, selectEvent, setViewFraction, setViewSettings } from './lunareclipse'
import { LunarEclipseLocalView } from './LunarEclipseLocalView'

// Local Circumstances panel of the Lunar Eclipse Map: the location (the shared Location section), the visibility of
// the eclipse from it, the contacts in the zone shown (resolved with the location), the Local View, and the
// magnitudes and durations. The global contact times are shown even without a place or when the Moon is below its
// horizon. Nothing here changes the profile or a site; the map component asks for the local circumstances of the
// location chosen.

// Orientations of the Local View, in display order.
const ORIENTATIONS: readonly LocalLunarViewOrientationMode[] = ['zenith', 'north']

// Handedness of the Local View, in display order.
const HANDEDNESS: readonly LocalLunarViewHandedness[] = ['eastRight', 'eastLeft']

// Local Circumstances panel.
export function LunarEclipsePanel() {
	const state = useSnapshot(lunarEclipseState)
	const { eclipse, place, local, localError, selectedEvent, view } = state
	const location = useToolLocation(state.location)
	const displayZone = useDisplayZone(location, state.zone)
	const timeZone = displayZone.zone
	const events = new Map(local?.events.map((event) => [event.kind, event]))
	// Stage of the eclipse the Local View draws, as the slider holds it while its answer is on the way.
	const fraction = state.viewFraction ?? (local && viewFractionOf(local, 'P1', 'P4'))
	const durations = eclipse && phaseDurations(eclipse)
	const stale = isStaleLocal(local, place)
	const viewFractionTimer = useRef<Timer | undefined>(undefined)

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
			{place && (
				<CollapsibleSection id="lunarEclipse.visibility" title="Visibility">
					<LocalContent stale={stale}>
						{local && <p className="m-0 font-medium text-ink-100">{local.visibility.text}</p>}
						{local && !local.visibility.hasObservableEclipse && <Notice>The Moon stays below the horizon here from P1 to P4; the contact times still hold for everyone.</Notice>}
						{local && local.visibility.kind === 'totalVisible' && <Notice>The Moon is above the horizon during at least part of totality, but not during the whole eclipse.</Notice>}
					</LocalContent>
					{localError && (
						<>
							<Notice error>{localError}</Notice>
							<Button variant="secondary" className="self-start" onClick={() => void loadLocal(lunarEclipseState)}>
								Retry
							</Button>
						</>
					)}
					<Notice>Visible means the Moon's center at or above the 0° horizon, without refraction. Partial and total contacts are computed to about 5 s and penumbral ones to about 30 s, and the edges of the Earth's shadow are too diffuse to see them that sharply.</Notice>
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
						{fraction !== undefined && <Slider label="From P1 to P4, %" value={Math.round(fraction * 1000) / 10} min={0} max={100} step={0.1} onChange={handleViewFraction} />}
						{local.view.time !== undefined && <DataRow label="Drawn at">{formatLongDateTime(local.view.time, timeZone)}</DataRow>}
						{local.view.positionAngle !== undefined && local.view.zenithAngle !== undefined && (
							<DataRow label={local.view.selectedEvent ? `Position / zenith angle at ${local.view.selectedEvent}` : 'Position / zenith angle'}>
								{formatEclipseAngle(local.view.positionAngle)} / {formatEclipseAngle(local.view.zenithAngle)}
							</DataRow>
						)}
					</LocalContent>
					<SegmentedControl label="Up" options={ORIENTATIONS} value={view.orientation} onChange={(orientation) => void setViewSettings(lunarEclipseState, { orientation })} format={(value) => (value === 'zenith' ? 'Zenith' : 'North')} />
					<SegmentedControl label="East" options={HANDEDNESS} value={view.handedness} onChange={(handedness) => void setViewSettings(lunarEclipseState, { handedness })} format={(value) => (value === 'eastRight' ? 'Right' : 'Left')} />
					<Checkbox label="Moon at the other contacts" checked={view.ghosts} onChange={(ghosts) => void setViewSettings(lunarEclipseState, { ghosts })} />
					<Notice>
						The Moon at {local.view.selectedEvent ?? 'the instant drawn'} crossing the Earth's penumbra and umbra, anywhere from P1 to P4 with the slider; the red band is below the horizon. The position angle places the contact on the Moon's limb, or between contacts the point of the limb nearest the
						shadow's center, from celestial north through east; the zenith angle from the direction of the zenith. A geometric diagram, not a photorealistic rendering.
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
					{local && (
						<LocalContent stale={stale}>
							<DataRow label="Observable here">{formatLongDuration(local.details.observableDuration)}</DataRow>
						</LocalContent>
					)}
				</CollapsibleSection>
			)}
		</>
	)
}
