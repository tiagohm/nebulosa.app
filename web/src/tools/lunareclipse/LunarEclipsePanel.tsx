import type { LocalLunarViewHandedness, LocalLunarViewOrientationMode } from 'api'
import { cn } from 'cn'
import { useSnapshot } from 'valtio'
import { formatLongDateTime, formatLongDuration } from '../../format'
import { useDisplayZone, useToolLocation } from '../../location/useLocation'
import { PanelSection } from '../../shell/ContextualPanel'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { formatEclipseAngle, formatEclipseMagnitude } from '../eclipse/eclipse'
import { EclipseLocationSection, EclipseZoneSelect } from '../eclipse/EclipsePanelParts'
import { CONTACT_NAMES, ECLIPSE_TYPE_NAMES, loadLocal, lunarEclipseState, phaseDurations, selectEvent, setViewSettings } from './lunareclipse'
import { LunarEclipseLocalView } from './LunarEclipseLocalView'

// Local Circumstances panel of the Lunar Eclipse Map: the location (the shared Location section), the visibility of
// the eclipse from it, the contacts in the zone shown (resolved with the location), the magnitudes and durations,
// and the Local View. The global contact times are shown even without a place or when the Moon is below its
// horizon. Nothing here changes the profile or a site; the map component asks for the local circumstances of the
// location chosen.

// Orientations of the Local View, in display order.
const ORIENTATIONS: readonly LocalLunarViewOrientationMode[] = ['zenith', 'north']

// Handedness of the Local View, in display order.
const HANDEDNESS: readonly LocalLunarViewHandedness[] = ['eastRight', 'eastLeft']

// Local Circumstances panel.
export function LunarEclipsePanel() {
	const state = useSnapshot(lunarEclipseState)
	const { eclipse, place, local, localLoading, localError, selectedEvent, view } = state
	const location = useToolLocation(state.location)
	const displayZone = useDisplayZone(location, state.zone)
	const timeZone = displayZone.zone
	const events = new Map(local?.events.map((event) => [event.kind, event]))
	const selectedLocal = events.get(selectedEvent)
	const durations = eclipse && phaseDurations(eclipse)

	return (
		<>
			<EclipseLocationSection value={state.location} location={location} onChange={(value) => (lunarEclipseState.location = value)} />
			{place && (
				<PanelSection title="Visibility">
					{local && <p className="m-0 font-medium text-ink-100">{local.visibility.text}</p>}
					{local && !local.visibility.hasObservableEclipse && <Notice>The Moon stays below the horizon here from P1 to P4; the contact times still hold for everyone.</Notice>}
					{local && local.visibility.kind === 'totalVisible' && <Notice>The Moon is above the horizon during at least part of totality, but not during the whole eclipse.</Notice>}
					{localLoading && <Notice>Computing the local circumstances…</Notice>}
					{localError && (
						<>
							<Notice error>{localError}</Notice>
							<Button variant="secondary" className="self-start" onClick={() => void loadLocal(lunarEclipseState)}>
								Retry
							</Button>
						</>
					)}
					<Notice>Visible means the Moon's center at or above the 0° horizon, without refraction. Partial and total contacts are computed to about 5 s and penumbral ones to about 30 s, and the edges of the Earth's shadow are too diffuse to see them that sharply.</Notice>
				</PanelSection>
			)}
			{eclipse && (
				<PanelSection title="Contacts">
					<EclipseZoneSelect value={state.zone} zone={displayZone} location={location} selectedSite={state.location.mode !== 'active'} onChange={(zone) => (lunarEclipseState.zone = zone)} />
					{eclipse.contacts.map((contact) => {
						const event = events.get(contact.kind)
						const selected = contact.kind === selectedEvent

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
									<span className={event.observable ? 'text-ink-200' : 'text-ink-300'}>
										Alt {formatEclipseAngle(event.altitude)} · Az {formatEclipseAngle(event.azimuth)} · {event.observable ? 'Above horizon' : 'Below horizon'}
									</span>
								)}
							</button>
						)
					})}
				</PanelSection>
			)}
			{eclipse && durations && (
				<PanelSection title="Details">
					<DataRow label="Type">{ECLIPSE_TYPE_NAMES[eclipse.type]}</DataRow>
					<DataRow label={eclipse.type === 'PENUMBRAL' ? 'Penumbral magnitude' : 'Umbral magnitude'}>{formatEclipseMagnitude(eclipse.magnitude)}</DataRow>
					{local && eclipse.type !== 'PENUMBRAL' && <DataRow label="Penumbral magnitude">{formatEclipseMagnitude(local.details.maximalPenumbralMagnitude)}</DataRow>}
					{durations.penumbral !== undefined && <DataRow label="Penumbral phase">{formatLongDuration(durations.penumbral)}</DataRow>}
					{durations.partial !== undefined && <DataRow label="Partial phase">{formatLongDuration(durations.partial)}</DataRow>}
					{durations.total !== undefined && <DataRow label="Totality">{formatLongDuration(durations.total)}</DataRow>}
					{local && <DataRow label="Observable here">{formatLongDuration(local.details.observableDuration)}</DataRow>}
					{selectedLocal && (
						<DataRow label={`P / Z at ${selectedEvent}`}>
							{formatEclipseAngle(selectedLocal.positionAngle)} / {formatEclipseAngle(selectedLocal.zenithAngle)}
						</DataRow>
					)}
				</PanelSection>
			)}
			{local && (
				<PanelSection title="Local View">
					<LunarEclipseLocalView view={local.view} />
					<SegmentedControl label="Up" options={ORIENTATIONS} value={view.orientation} onChange={(orientation) => void setViewSettings(lunarEclipseState, { orientation })} format={(value) => (value === 'zenith' ? 'Zenith' : 'North')} />
					<SegmentedControl label="East" options={HANDEDNESS} value={view.handedness} onChange={(handedness) => void setViewSettings(lunarEclipseState, { handedness })} format={(value) => (value === 'eastRight' ? 'Right' : 'Left')} />
					<Checkbox label="Moon at the other contacts" checked={view.ghosts} onChange={(ghosts) => void setViewSettings(lunarEclipseState, { ghosts })} />
					<Notice>The Moon at {local.view.selectedEvent ?? selectedEvent} crossing the Earth's penumbra and umbra; the red band is below the horizon. A geometric diagram, not a photorealistic rendering.</Notice>
				</PanelSection>
			)}
		</>
	)
}
