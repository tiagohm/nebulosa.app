import type { LocalViewHandedness, LocalViewOrientationMode } from 'api'
import { cn } from 'cn'
import { useSnapshot } from 'valtio'
import { formatGeographic, formatKilometers, formatLongDateTime, MISSING } from '../../format'
import { useDisplayZone, useToolLocation } from '../../location/useLocation'
import { PanelSection } from '../../shell/ContextualPanel'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { formatDuration } from '../eclipse/eclipse'
import { EclipseLocationSection, EclipseZoneSelect } from '../eclipse/EclipsePanelParts'
import { GlobalPointIcon } from './GlobalPointMarker'
import { contactName, ECLIPSE_TYPE_NAMES, GLOBAL_POINTS, type GlobalPoint, globalPoints, loadLocal, selectEvent, selectMapPlace, selectPoint, setViewSettings, solarEclipseState } from './solareclipse'
import { SolarEclipseLocalView } from './SolarEclipseLocalView'

// Local Circumstances panel of the Solar Eclipse Map: the location (the shared Location section), the visibility of
// the eclipse from it, its contacts in the zone shown (resolved with the location), the global and local details,
// and the Local View of the selected contact, and the global points with the details of the one chosen. Contacts
// and durations a place lacks are left out, never shown as zero, and the magnitude is a fraction of the solar
// diameter, not of its area. Nothing here changes the profile or a site; the map component asks for the local
// circumstances of the location chosen.

// Orientations of the Local View, in display order.
const ORIENTATIONS: readonly LocalViewOrientationMode[] = ['zenith', 'north']

// Handedness of the Local View, in display order.
const HANDEDNESS: readonly LocalViewHandedness[] = ['eastRight', 'eastLeft']

// Returns an angle in degrees to a tenth, or a dash when it is undefined.
function angle(value: number | undefined) {
	return value === undefined ? MISSING : `${value.toFixed(1)}°`
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
				{point.time !== undefined && <span className="text-ink-100">{formatLongDateTime(point.time, timeZone)}</span>}
			</button>
			{selected && (
				<div className="flex flex-col gap-1.5 border-t border-line-100 px-2 py-2">
					<Notice>{info.description}</Notice>
					<DataRow label="Position">{formatGeographic(point.latitude, point.longitude)}</DataRow>
					{point.sunAltitude !== undefined && <DataRow label="Sun altitude">{point.sunAltitude.toFixed(1)}°</DataRow>}
					{extreme && <DataRow label="Sun azimuth">{extreme.sunAzimuth.toFixed(1)}°</DataRow>}
					{extreme?.kind && <DataRow label="Central phase">{extreme.kind === 'annular' ? 'Annular' : 'Total'}</DataRow>}
					{extreme?.centralDuration !== undefined && <DataRow label="Central duration">{formatDuration(extreme.centralDuration)}</DataRow>}
					{extreme?.pathWidth !== undefined && <DataRow label="Path width">{formatKilometers(extreme.pathWidth, 1)}</DataRow>}
					<Button variant="secondary" className="self-start" onClick={() => void selectMapPlace(solarEclipseState, { longitude: point.longitude, latitude: point.latitude })}>
						Use as Location
					</Button>
				</div>
			)}
		</div>
	)
}

// Local Circumstances panel.
export function SolarEclipsePanel() {
	const state = useSnapshot(solarEclipseState)
	const { eclipse, map, place, local, localLoading, localError, selectedEvent, selectedPoint, view } = state
	const location = useToolLocation(state.location)
	const displayZone = useDisplayZone(location, state.zone)
	const timeZone = displayZone.zone
	const visibility = local?.visibility
	const central = visibility?.centralPhaseKind === 'annular' ? 'annular' : 'total'
	const greatest = map?.greatestEclipse
	const duration = map?.greatestDuration

	return (
		<>
			<EclipseLocationSection value={state.location} location={location} onChange={(value) => (solarEclipseState.location = value)} />
			{place && (
				<PanelSection title="Visibility">
					{visibility && <p className="m-0 font-medium text-ink-100">{visibility.text}</p>}
					{visibility && visibility.hasCentralPhase && <DataRow label="Central phase here">{visibility.centralPhaseKind === 'annular' ? 'Annular' : 'Total'}</DataRow>}
					{visibility && visibility.hasGeometricEclipse && !visibility.hasCentralPhase && <Notice>Only a partial eclipse reaches this place.</Notice>}
					{visibility?.kind === 'partialOnlyVisible' && visibility.hasCentralPhase && <Notice>The {central} phase happens with the Sun below the horizon; only the partial phase is visible.</Notice>}
					{visibility && visibility.hasObservableEclipse && visibility.sunMotion !== 'none' && <Notice>The Sun is {visibility.sunMotion === 'rising' ? 'climbing' : 'descending'} during the eclipse.</Notice>}
					{visibility && (!visibility.completeness.partialContactsComplete || !visibility.completeness.centralContactsComplete) && <Notice>Some contacts could not be found; the visibility rests on those that were.</Notice>}
					{localLoading && <Notice>Computing the local circumstances…</Notice>}
					{localError && (
						<>
							<Notice error>{localError}</Notice>
							<Button variant="secondary" className="self-start" onClick={() => void loadLocal(solarEclipseState)}>
								Retry
							</Button>
						</>
					)}
					<Notice>Visible means the Sun's center at or above the 0° horizon; elevation and terrain are not considered.</Notice>
				</PanelSection>
			)}
			{eclipse && (
				<PanelSection title="Contacts">
					<EclipseZoneSelect value={state.zone} zone={displayZone} location={location} selectedSite={state.location.mode !== 'active'} onChange={(zone) => (solarEclipseState.zone = zone)} />
					{!place && <Notice>Select a location to see its contacts.</Notice>}
					{local && local.events.length === 0 && <Notice>The eclipse does not reach this place.</Notice>}
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
								<span className="text-ink-100">{formatLongDateTime(event.time, timeZone)}</span>
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
					<DataRow label="Type">{ECLIPSE_TYPE_NAMES[eclipse.type]}</DataRow>
					<DataRow label="Magnitude">{eclipse.magnitude.toFixed(4)}</DataRow>
					<DataRow label="Gamma">{eclipse.gamma.toFixed(4)}</DataRow>
					{greatest && <DataRow label="Greatest eclipse">{formatLongDateTime(greatest.time, timeZone)}</DataRow>}
					{greatest && <DataRow label="Greatest eclipse at">{formatGeographic(greatest.latitude, greatest.longitude)}</DataRow>}
					{duration?.centralDuration !== undefined && <DataRow label="Greatest duration">{formatDuration(duration.centralDuration)}</DataRow>}
					{greatest?.pathWidth !== undefined && <DataRow label="Path width at greatest">{formatKilometers(greatest.pathWidth, 1)}</DataRow>}
					{local?.details.maximalMagnitude !== undefined && <DataRow label="Magnitude here">{local.details.maximalMagnitude.toFixed(4)}</DataRow>}
					{local?.details.moonSunDiameterRatio !== undefined && <DataRow label="Moon/Sun diameter">{local.details.moonSunDiameterRatio.toFixed(4)}</DataRow>}
					{local?.details.partialPhaseDuration !== undefined && <DataRow label="Eclipse here (C1–C4)">{formatDuration(local.details.partialPhaseDuration)}</DataRow>}
					{local?.details.centralPhaseDuration !== undefined && <DataRow label={`${central === 'annular' ? 'Annularity' : 'Totality'} here (C2–C3)`}>{formatDuration(local.details.centralPhaseDuration)}</DataRow>}
					{local?.details.pathWidthKm !== undefined && <DataRow label="Path width here">{formatKilometers(local.details.pathWidthKm)}</DataRow>}
					{local?.details.shadowPathWidthKm !== undefined && <DataRow label="Shadow chord here">{formatKilometers(local.details.shadowPathWidthKm)}</DataRow>}
					<Notice>
						Magnitude is the fraction of the Sun's diameter covered by the Moon, not of its area. Path width is the distance between the limits of totality or annularity, across the central line. Shadow chord is the narrowest width of the shadow at one instant, which is smaller at a low Sun. Contacts assume
						a smooth lunar limb and are good to about 5 s; the mountains of the limb matter most near the limits of the path.
					</Notice>
				</PanelSection>
			)}
			{map && (
				<PanelSection title="Global Points">
					<Notice>Points of the eclipse as a whole, the same for everyone. Choose one to find it on the map.</Notice>
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
					<Notice>The Moon over the Sun at {local.view.selectedEvent ?? selectedEvent}; the red band is below the horizon. A geometric diagram, not a photorealistic rendering.</Notice>
				</PanelSection>
			)}
			<PanelSection title="About">
				<Notice>A computed prediction from the toolkit's ephemerides, without the site's elevation, the terrain, or the profile of the lunar limb; times near the edges of the path are less certain.</Notice>
				<Notice error>Never look at the Sun without a proper solar filter, except during totality itself.</Notice>
			</PanelSection>
		</>
	)
}
