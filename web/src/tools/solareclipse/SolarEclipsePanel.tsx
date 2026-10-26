import type { LocalViewHandedness, LocalViewOrientationMode } from 'api'
import { cn } from 'cn'
import { useSnapshot } from 'valtio'
import type { SkyObserverSettings } from '../../profile/schema'
import { PanelSection } from '../../shell/ContextualPanel'
import { BROWSER_TIME_ZONE } from '../../sky/clock'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { formatGeoPoint } from '../../ui/worldmap.geometry'
import { displayTimeZone, type EclipsePlace, formatDuration, formatEclipseTime } from '../eclipse/eclipse'
import { Datum, DISPLAY_TIME_ZONES, LocationSection, Note } from '../eclipse/EclipsePanelParts'
import { GlobalPointIcon } from './GlobalPointMarker'
import { contactName, ECLIPSE_TYPE_NAMES, GLOBAL_POINTS, type GlobalPoint, globalPoints, loadLocal, selectEvent, selectPlace, selectPoint, setViewSettings, solarEclipseState } from './solareclipse'
import { SolarEclipseLocalView } from './SolarEclipseLocalView'

// Local Circumstances panel of the Solar Eclipse Map: the place (the shared Location section), the visibility of
// the eclipse from it, its contacts in the time zone shown, the global and local details, and the Local View of
// the selected contact, and the global points with the details of the one chosen. Contacts and durations a place
// lacks are left out, never shown as zero, and the magnitude is a fraction of the solar diameter, not of its area.
// Nothing here changes the profile.

export interface SolarEclipsePanelProps {
	// Sky observer of the active profile; absent when none is set.
	readonly observer?: SkyObserverSettings
}

// Orientations of the Local View, in display order.
const ORIENTATIONS: readonly LocalViewOrientationMode[] = ['zenith', 'north']

// Handedness of the Local View, in display order.
const HANDEDNESS: readonly LocalViewHandedness[] = ['eastRight', 'eastLeft']

// Shows a place chosen in the Location section; going back to the Sky observer also goes back to its time zone.
function choosePlace(place: EclipsePlace) {
	if (place.source === 'observer') solarEclipseState.timeZone = undefined
	void selectPlace(solarEclipseState, place)
}

// Returns an angle in degrees to a tenth, or a dash when it is undefined.
function angle(value: number | undefined) {
	return value === undefined ? '—' : `${value.toFixed(1)}°`
}

interface GlobalPointRowProps {
	// Point listed.
	readonly point: GlobalPoint
	// Whether it is the highlighted point, whose details are shown.
	readonly selected: boolean
	// Time zone of the times.
	readonly timeZone: string
}

// A global point: its marker, name, and time, and once chosen, what it is, where and when, the Sun there, and for
// the greatest eclipse and duration the central phase; it can then become the place of the local circumstances.
function GlobalPointRow({ point, selected, timeZone }: GlobalPointRowProps) {
	const info = GLOBAL_POINTS[point.kind]
	const { extreme } = point

	return (
		<div className={cn('flex flex-col rounded-sm border text-xs', selected ? 'border-accent bg-accent-subtle' : 'border-line-100')}>
			<button type="button" onClick={() => selectPoint(solarEclipseState, point.kind)} className="flex cursor-pointer flex-col gap-0.5 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left font-mono text-inherit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
				<span className="flex items-center gap-2">
					<GlobalPointIcon kind={point.kind} />
					<span className="font-semibold text-ink-100">{point.kind}</span>
					<span className="truncate text-ink-300">{info.name}</span>
				</span>
				{point.time !== undefined && <span className="text-ink-100">{formatEclipseTime(point.time, timeZone)}</span>}
			</button>
			{selected && (
				<div className="flex flex-col gap-1.5 border-t border-line-100 px-2 py-2">
					<Note>{info.description}</Note>
					<Datum label="Position">{formatGeoPoint(point)}</Datum>
					{point.sunAltitude !== undefined && <Datum label="Sun altitude">{point.sunAltitude.toFixed(1)}°</Datum>}
					{extreme && <Datum label="Sun azimuth">{extreme.sunAzimuth.toFixed(1)}°</Datum>}
					{extreme?.kind && <Datum label="Central phase">{extreme.kind === 'annular' ? 'Annular' : 'Total'}</Datum>}
					{extreme?.centralDuration !== undefined && <Datum label="Central duration">{formatDuration(extreme.centralDuration)}</Datum>}
					{extreme?.pathWidth !== undefined && <Datum label="Path width">{extreme.pathWidth.toFixed(1)} km</Datum>}
					<Button variant="secondary" size="sm" className="self-start" onClick={() => choosePlace({ source: 'map', longitude: point.longitude, latitude: point.latitude })}>
						Use as Location
					</Button>
				</div>
			)}
		</div>
	)
}

// Local Circumstances panel.
export function SolarEclipsePanel({ observer }: SolarEclipsePanelProps) {
	const state = useSnapshot(solarEclipseState)
	const { eclipse, map, place, local, localLoading, localError, selectedEvent, selectedPoint, view } = state
	const timeZone = displayTimeZone(state)
	const visibility = local?.visibility
	const central = visibility?.centralPhaseKind === 'annular' ? 'annular' : 'total'
	const greatest = map?.greatestEclipse
	const duration = map?.greatestDuration

	return (
		<>
			<LocationSection place={place} observer={observer} onSelect={choosePlace} />
			{place && (
				<PanelSection title="Visibility">
					{visibility && <p className="m-0 font-medium text-ink-100">{visibility.text}</p>}
					{visibility && visibility.hasCentralPhase && <Datum label="Central phase here">{visibility.centralPhaseKind === 'annular' ? 'Annular' : 'Total'}</Datum>}
					{visibility && visibility.hasGeometricEclipse && !visibility.hasCentralPhase && <Note>Only a partial eclipse reaches this place.</Note>}
					{visibility?.kind === 'partialOnlyVisible' && visibility.hasCentralPhase && <Note>The {central} phase happens with the Sun below the horizon; only the partial phase is visible.</Note>}
					{visibility && visibility.hasObservableEclipse && visibility.sunMotion !== 'none' && <Note>The Sun is {visibility.sunMotion === 'rising' ? 'climbing' : 'descending'} during the eclipse.</Note>}
					{visibility && (!visibility.completeness.partialContactsComplete || !visibility.completeness.centralContactsComplete) && <Note>Some contacts could not be found; the visibility rests on those that were.</Note>}
					{localLoading && <Note>Computing the local circumstances…</Note>}
					{localError && (
						<>
							<Note danger>{localError}</Note>
							<Button variant="secondary" size="sm" className="self-start" onClick={() => void loadLocal(solarEclipseState)}>
								Retry
							</Button>
						</>
					)}
					<Note>Visible means the Sun's center at or above the 0° horizon; elevation and terrain are not considered.</Note>
				</PanelSection>
			)}
			{eclipse && (
				<PanelSection title="Contacts">
					<Select label="Time Zone" options={DISPLAY_TIME_ZONES} value={timeZone} onChange={(zone) => (solarEclipseState.timeZone = zone)} format={(zone) => zone || `Browser (${BROWSER_TIME_ZONE})`} />
					{!place && <Note>Select a location to see its contacts.</Note>}
					{local && local.events.length === 0 && <Note>The eclipse does not reach this place.</Note>}
					{local?.events.map((event) => {
						const selected = event.kind === (local.view.selectedEvent ?? selectedEvent)

						return (
							<button
								key={event.kind}
								type="button"
								onClick={() => void selectEvent(solarEclipseState, event.kind)}
								className={cn(
									'flex cursor-pointer flex-col gap-0.5 rounded-sm border px-2 py-1.5 text-left font-mono text-xs text-inherit transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none',
									selected ? 'border-accent bg-accent-subtle' : 'border-line-100 bg-transparent hover:border-line-200',
								)}
							>
								<span className="flex items-baseline justify-between gap-2">
									<span className="font-semibold text-ink-100">{event.kind}</span>
									<span className="truncate text-ink-300">{contactName(event.kind, local.visibility.centralPhaseKind)}</span>
								</span>
								<span className="text-ink-100">{formatEclipseTime(event.time, timeZone)}</span>
								<span className={event.observable ? 'text-ink-200' : 'text-ink-300'}>
									Alt {event.altitude.toFixed(1)}° · P {angle(event.positionAngle)} · Z {angle(event.zenithAngle)} · {event.observable ? 'Above horizon' : 'Below horizon'}
								</span>
							</button>
						)
					})}
				</PanelSection>
			)}
			{eclipse && (
				<PanelSection title="Details">
					<Datum label="Type">{ECLIPSE_TYPE_NAMES[eclipse.type]}</Datum>
					<Datum label="Magnitude">{eclipse.magnitude.toFixed(4)}</Datum>
					<Datum label="Gamma">{eclipse.gamma.toFixed(4)}</Datum>
					{greatest && <Datum label="Greatest eclipse">{formatEclipseTime(greatest.time, timeZone)}</Datum>}
					{greatest && <Datum label="Greatest eclipse at">{formatGeoPoint(greatest)}</Datum>}
					{duration?.centralDuration !== undefined && <Datum label="Greatest duration">{formatDuration(duration.centralDuration)}</Datum>}
					{greatest?.pathWidth !== undefined && <Datum label="Path width">{greatest.pathWidth.toFixed(1)} km</Datum>}
					{local?.details.maximalMagnitude !== undefined && <Datum label="Magnitude here">{local.details.maximalMagnitude.toFixed(4)}</Datum>}
					{local?.details.moonSunDiameterRatio !== undefined && <Datum label="Moon/Sun diameter">{local.details.moonSunDiameterRatio.toFixed(4)}</Datum>}
					{local?.details.partialPhaseDuration !== undefined && <Datum label="Eclipse here (C1–C4)">{formatDuration(local.details.partialPhaseDuration)}</Datum>}
					{local?.details.centralPhaseDuration !== undefined && <Datum label={`${central === 'annular' ? 'Annularity' : 'Totality'} here (C2–C3)`}>{formatDuration(local.details.centralPhaseDuration)}</Datum>}
					{local?.details.shadowPathWidthKm !== undefined && <Datum label="Shadow chord here">{Math.round(local.details.shadowPathWidthKm)} km</Datum>}
					<Note>Magnitude is the fraction of the Sun's diameter covered by the Moon, not of its area.</Note>
				</PanelSection>
			)}
			{map && (
				<PanelSection title="Global Points">
					<Note>Points of the eclipse as a whole, the same for everyone. Choose one to find it on the map.</Note>
					{globalPoints(map).map((point) => (
						<GlobalPointRow key={point.kind} point={point} selected={point.kind === selectedPoint} timeZone={timeZone} />
					))}
				</PanelSection>
			)}
			{local && local.events.length > 0 && (
				<PanelSection title="Local View">
					<SolarEclipseLocalView view={local.view} />
					<SegmentedControl label="Up" options={ORIENTATIONS} value={view.orientation} onChange={(orientation) => void setViewSettings(solarEclipseState, { orientation })} format={(value) => (value === 'zenith' ? 'Zenith' : 'North')} />
					<SegmentedControl label="East" options={HANDEDNESS} value={view.handedness} onChange={(handedness) => void setViewSettings(solarEclipseState, { handedness })} format={(value) => (value === 'eastRight' ? 'Right' : 'Left')} />
					<Checkbox label="Moon at the other contacts" checked={view.ghosts} onChange={(ghosts) => void setViewSettings(solarEclipseState, { ghosts })} />
					<Note>The Moon over the Sun at {local.view.selectedEvent ?? selectedEvent}; the red band is below the horizon. A geometric diagram, not a photorealistic rendering.</Note>
				</PanelSection>
			)}
			<PanelSection title="About">
				<Note>A computed prediction from the toolkit's ephemerides, without the site's elevation, the terrain, or the profile of the lunar limb; times near the edges of the path are less certain.</Note>
				<Note danger>Never look at the Sun without a proper solar filter, except during totality itself.</Note>
			</PanelSection>
		</>
	)
}
