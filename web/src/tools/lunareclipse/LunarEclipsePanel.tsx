import type { LocalLunarViewHandedness, LocalLunarViewOrientationMode } from 'api'
import { cn } from 'cn'
import { useSnapshot } from 'valtio'
import type { SkyObserverSettings } from '../../profile/schema'
import { PanelSection } from '../../shell/ContextualPanel'
import { BROWSER_TIME_ZONE } from '../../sky/clock'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { displayTimeZone, type EclipsePlace, formatDuration, formatEclipseTime } from '../eclipse/eclipse'
import { Datum, DISPLAY_TIME_ZONES, LocationSection, Note } from '../eclipse/EclipsePanelParts'
import { CONTACT_NAMES, ECLIPSE_TYPE_NAMES, loadLocal, lunarEclipseState, phaseDurations, selectEvent, selectPlace, setViewSettings } from './lunareclipse'
import { LunarEclipseLocalView } from './LunarEclipseLocalView'

// Local Circumstances panel of the Lunar Eclipse Map: the place (the shared Location section), the visibility of
// the eclipse from it, the contacts in the time zone shown, the magnitudes and durations, and the Local View. The
// global contact times are shown even without a place or when the Moon is below its horizon. Nothing here changes
// the profile.

export interface LunarEclipsePanelProps {
	// Sky observer of the active profile; absent when none is set.
	readonly observer?: SkyObserverSettings
}

// Shows a place chosen in the Location section; going back to the Sky observer also goes back to its time zone.
function choosePlace(place: EclipsePlace) {
	if (place.source === 'observer') lunarEclipseState.timeZone = undefined
	void selectPlace(lunarEclipseState, place)
}

// Orientations of the Local View, in display order.
const ORIENTATIONS: readonly LocalLunarViewOrientationMode[] = ['zenith', 'north']

// Handedness of the Local View, in display order.
const HANDEDNESS: readonly LocalLunarViewHandedness[] = ['eastRight', 'eastLeft']

// Local Circumstances panel.
export function LunarEclipsePanel({ observer }: LunarEclipsePanelProps) {
	const state = useSnapshot(lunarEclipseState)
	const { eclipse, place, local, localLoading, localError, selectedEvent, view } = state
	const timeZone = displayTimeZone(state)
	const events = new Map(local?.events.map((event) => [event.kind, event]))
	const selectedLocal = events.get(selectedEvent)
	const durations = eclipse && phaseDurations(eclipse)

	return (
		<>
			<LocationSection place={place} observer={observer} onSelect={choosePlace} />
			{place && (
				<PanelSection title="Visibility">
					{local && <p className="m-0 font-medium text-ink-100">{local.visibility.text}</p>}
					{local && !local.visibility.hasObservableEclipse && <Note>The Moon stays below the horizon here from P1 to P4; the contact times still hold for everyone.</Note>}
					{local && local.visibility.kind === 'totalVisible' && <Note>The Moon is above the horizon during at least part of totality, but not during the whole eclipse.</Note>}
					{localLoading && <Note>Computing the local circumstances…</Note>}
					{localError && (
						<>
							<Note danger>{localError}</Note>
							<Button variant="secondary" size="sm" className="self-start" onClick={() => void loadLocal(lunarEclipseState)}>
								Retry
							</Button>
						</>
					)}
					<Note>Visible means the Moon's center at or above the 0° horizon, without refraction.</Note>
				</PanelSection>
			)}
			{eclipse && (
				<PanelSection title="Contacts">
					<Select label="Time Zone" options={DISPLAY_TIME_ZONES} value={timeZone} onChange={(zone) => (lunarEclipseState.timeZone = zone)} format={(zone) => zone || `Browser (${BROWSER_TIME_ZONE})`} />
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
								<span className="text-ink-100">{formatEclipseTime(contact.time, timeZone)}</span>
								{event && (
									<span className={event.observable ? 'text-ink-200' : 'text-ink-300'}>
										Alt {event.altitude.toFixed(1)}° · Az {event.azimuth.toFixed(1)}° · {event.observable ? 'Above horizon' : 'Below horizon'}
									</span>
								)}
							</button>
						)
					})}
				</PanelSection>
			)}
			{eclipse && durations && (
				<PanelSection title="Details">
					<Datum label="Type">{ECLIPSE_TYPE_NAMES[eclipse.type]}</Datum>
					<Datum label={eclipse.type === 'PENUMBRAL' ? 'Penumbral magnitude' : 'Umbral magnitude'}>{eclipse.magnitude.toFixed(4)}</Datum>
					{local && eclipse.type !== 'PENUMBRAL' && <Datum label="Penumbral magnitude">{local.details.maximalPenumbralMagnitude.toFixed(4)}</Datum>}
					{durations.penumbral !== undefined && <Datum label="Penumbral phase">{formatDuration(durations.penumbral)}</Datum>}
					{durations.partial !== undefined && <Datum label="Partial phase">{formatDuration(durations.partial)}</Datum>}
					{durations.total !== undefined && <Datum label="Totality">{formatDuration(durations.total)}</Datum>}
					{local && <Datum label="Observable here">{formatDuration(local.details.observableDuration)}</Datum>}
					{selectedLocal && (
						<Datum label={`P / Z at ${selectedEvent}`}>
							{selectedLocal.positionAngle.toFixed(1)}° / {selectedLocal.zenithAngle.toFixed(1)}°
						</Datum>
					)}
				</PanelSection>
			)}
			{local && (
				<PanelSection title="Local View">
					<LunarEclipseLocalView view={local.view} />
					<SegmentedControl label="Up" options={ORIENTATIONS} value={view.orientation} onChange={(orientation) => void setViewSettings(lunarEclipseState, { orientation })} format={(value) => (value === 'zenith' ? 'Zenith' : 'North')} />
					<SegmentedControl label="East" options={HANDEDNESS} value={view.handedness} onChange={(handedness) => void setViewSettings(lunarEclipseState, { handedness })} format={(value) => (value === 'eastRight' ? 'Right' : 'Left')} />
					<Checkbox label="Moon at the other contacts" checked={view.ghosts} onChange={(ghosts) => void setViewSettings(lunarEclipseState, { ghosts })} />
					<Note>The Moon at {local.view.selectedEvent ?? selectedEvent} crossing the Earth's penumbra and umbra; the red band is below the horizon. A geometric diagram, not a photorealistic rendering.</Note>
				</PanelSection>
			)}
		</>
	)
}
