import type { LocalViewHandedness, LocalViewOrientationMode } from 'api'
import { cn } from 'cn'
import { useSnapshot } from 'valtio'
import { formatGeographic, formatKilometers, formatLongDateTime, formatLongDuration } from '../../format'
import { useDisplayZone, useToolLocation } from '../../location/useLocation'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { formatEclipseAngle, formatEclipseMagnitude } from '../eclipse/eclipse'
import { EclipseLocationSection, EclipseZoneSelect, LocalContent } from '../eclipse/EclipsePanelParts'
import { GlobalPointIcon } from './GlobalPointMarker'
import { centralLineText, contactName, ECLIPSE_TYPE_NAMES, GLOBAL_POINTS, type GlobalPoint, globalPoints, loadLocal, selectEvent, selectMapPlace, selectPoint, setViewSettings, solarEclipseState, isStaleLocal, visibilityHeadline } from './solareclipse'
import { SolarEclipseLocalView } from './SolarEclipseLocalView'

// Local Circumstances panel of the Solar Eclipse Map, in the order an observer needs it: the location (the shared
// Location section), what the place sees of the eclipse and for how long, its contacts in the zone shown (resolved
// with the location) with the solar filter warning, the Local View of the selected contact, the global and local
// details, the global points (collapsed at first) with the details of the one chosen, and About. Contacts
// and durations a place lacks are left out, never shown as zero, and the magnitude is a fraction of the solar
// diameter, not of its area. Nothing here changes the profile or a site; the map component asks for the local
// circumstances of the location chosen.

// Orientations of the Local View, in display order.
const ORIENTATIONS: readonly LocalViewOrientationMode[] = ['zenith', 'north']

// Handedness of the Local View, in display order.
const HANDEDNESS: readonly LocalViewHandedness[] = ['eastRight', 'eastLeft']

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
					{point.sunAltitude !== undefined && <DataRow label="Sun altitude">{formatEclipseAngle(point.sunAltitude)}</DataRow>}
					{extreme && <DataRow label="Sun azimuth">{formatEclipseAngle(extreme.sunAzimuth)}</DataRow>}
					{extreme?.kind && <DataRow label="Central phase">{extreme.kind === 'annular' ? 'Annular' : 'Total'}</DataRow>}
					{extreme?.centralDuration !== undefined && <DataRow label="Central duration">{formatLongDuration(extreme.centralDuration)}</DataRow>}
					{extreme?.pathWidth !== undefined && <DataRow label="Path width">{formatKilometers(extreme.pathWidth)}</DataRow>}
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
	const maximum = local?.events.find((event) => event.kind === 'MAX')
	const shown = local?.events.find((event) => event.kind === (local.view.selectedEvent ?? selectedEvent))
	const stale = isStaleLocal(local, place)

	return (
		<>
			<EclipseLocationSection id="solarEclipse.location" value={state.location} location={location} onChange={(value) => (solarEclipseState.location = value)} />
			{place && (
				<CollapsibleSection id="solarEclipse.visibility" title="Visibility">
					<LocalContent stale={stale}>
						{visibility && <p className="m-0 font-medium text-ink-100">{visibilityHeadline(visibility)}</p>}
						{local?.details.centralPhaseDuration !== undefined && <DataRow label={`${central === 'annular' ? 'Annularity' : 'Totality'} here (C2–C3)`}>{formatLongDuration(local.details.centralPhaseDuration)}</DataRow>}
						{local?.details.partialPhaseDuration !== undefined && <DataRow label="Eclipse here (C1–C4)">{formatLongDuration(local.details.partialPhaseDuration)}</DataRow>}
						{local?.details.maximalMagnitude !== undefined && <DataRow label="Magnitude here">{formatEclipseMagnitude(local.details.maximalMagnitude)}</DataRow>}
						{local?.details.centralLineDistance && <DataRow label="From the central line">{centralLineText(local.details.centralLineDistance.distanceKm, local.details.centralLineDistance.side)}</DataRow>}
						{maximum && <DataRow label="Sun altitude at MAX">{formatEclipseAngle(maximum.altitude)}</DataRow>}
						{visibility && visibility.hasObservableEclipse && visibility.sunMotion !== 'none' && <Notice>The Sun is {visibility.sunMotion === 'rising' ? 'climbing' : 'descending'} during the eclipse.</Notice>}
						{visibility?.hasGeometricEclipse && (!visibility.completeness.partialContactsComplete || !visibility.completeness.centralContactsComplete) && <Notice>Some contacts could not be found; the visibility rests on those that were.</Notice>}
					</LocalContent>
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
				</CollapsibleSection>
			)}
			{eclipse && (
				<CollapsibleSection id="solarEclipse.contacts" title="Contacts">
					<EclipseZoneSelect value={state.zone} zone={displayZone} location={location} selectedSite={state.location.mode !== 'active'} onChange={(zone) => (solarEclipseState.zone = zone)} />
					{!place && <Notice>Select a location to see its contacts.</Notice>}
					<LocalContent stale={stale}>
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
									<span className={cn('flex flex-wrap items-baseline justify-between gap-x-2', event.observable ? 'text-ink-200' : 'text-ink-300')}>
										<span>
											Alt {formatEclipseAngle(event.altitude)} · Az {formatEclipseAngle(event.azimuth)}
										</span>
										<span>{event.observable ? 'Above horizon' : 'Below horizon'}</span>
									</span>
								</button>
							)
						})}
					</LocalContent>
					<Notice error>Never look at the Sun without a proper solar filter; only totality itself, never an annular or partial phase, is safe to watch without one.</Notice>
				</CollapsibleSection>
			)}
			{local && local.events.length > 0 && (
				<CollapsibleSection id="solarEclipse.localView" title="Local View">
					<LocalContent stale={stale}>
						<SolarEclipseLocalView view={local.view} />
						{shown?.positionAngle !== undefined && shown.zenithAngle !== undefined && (
							<DataRow label={`Position / zenith angle at ${shown.kind}`}>
								{formatEclipseAngle(shown.positionAngle)} / {formatEclipseAngle(shown.zenithAngle)}
							</DataRow>
						)}
					</LocalContent>
					<SegmentedControl label="Up" options={ORIENTATIONS} value={view.orientation} onChange={(orientation) => void setViewSettings(solarEclipseState, { orientation })} format={(value) => (value === 'zenith' ? 'Zenith' : 'North')} />
					<SegmentedControl label="East" options={HANDEDNESS} value={view.handedness} onChange={(handedness) => void setViewSettings(solarEclipseState, { handedness })} format={(value) => (value === 'eastRight' ? 'Right' : 'Left')} />
					<Checkbox label="Moon at the other contacts" checked={view.ghosts} onChange={(ghosts) => void setViewSettings(solarEclipseState, { ghosts })} />
					<Notice>
						The Moon over the Sun at {local.view.selectedEvent ?? selectedEvent}; the red band is below the horizon. The position angle places the contact on the Sun's limb from celestial north through east, the zenith angle from the direction of the zenith. A geometric diagram, not a photorealistic
						rendering.
					</Notice>
				</CollapsibleSection>
			)}
			{eclipse && (
				<CollapsibleSection id="solarEclipse.details" title="Details">
					<DataRow label="Type">{ECLIPSE_TYPE_NAMES[eclipse.type]}</DataRow>
					<DataRow label="Magnitude">{formatEclipseMagnitude(eclipse.magnitude)}</DataRow>
					<DataRow label="Gamma">{formatEclipseMagnitude(eclipse.gamma)}</DataRow>
					{greatest && <DataRow label="Greatest eclipse">{formatLongDateTime(greatest.time, timeZone)}</DataRow>}
					{greatest && <DataRow label="Greatest eclipse at">{formatGeographic(greatest.latitude, greatest.longitude)}</DataRow>}
					{duration?.centralDuration !== undefined && <DataRow label="Greatest duration">{formatLongDuration(duration.centralDuration)}</DataRow>}
					{greatest?.pathWidth !== undefined && <DataRow label="Path width at greatest">{formatKilometers(greatest.pathWidth)}</DataRow>}
					<LocalContent stale={stale}>
						{local?.details.moonSunDiameterRatio !== undefined && <DataRow label="Moon/Sun diameter">{formatEclipseMagnitude(local.details.moonSunDiameterRatio)}</DataRow>}
						{local?.details.pathWidthKm !== undefined && <DataRow label="Path width here">{formatKilometers(local.details.pathWidthKm)}</DataRow>}
						{local?.details.shadowPathWidthKm !== undefined && <DataRow label="Shadow chord here">{formatKilometers(local.details.shadowPathWidthKm)}</DataRow>}
					</LocalContent>
					<Notice>
						Magnitude is the fraction of the Sun's diameter covered by the Moon, not of its area.
						{eclipse.central && ' Path width is the distance between the limits of totality or annularity, across the central line. Shadow chord is the narrowest width of the shadow at one instant, which is smaller at a low Sun.'}
						{eclipse.central ? ' Contacts assume a smooth lunar limb and are good to about 5 s; the mountains of the limb matter most near the limits of the path.' : ' Contacts assume a smooth lunar limb and are good to about 5 s.'}
					</Notice>
				</CollapsibleSection>
			)}
			{map && (
				<CollapsibleSection id="solarEclipse.globalPoints" title="Global Points" defaultOpen={false}>
					<Notice>Points of the eclipse as a whole, the same for everyone. Choose one to find it on the map.</Notice>
					{globalPoints(map).map((point) => (
						<GlobalPointRow key={point.kind} point={point} selected={point.kind === selectedPoint} timeZone={timeZone} />
					))}
				</CollapsibleSection>
			)}
			<CollapsibleSection id="solarEclipse.about" title="About" defaultOpen={false}>
				<Notice>A computed prediction from the toolkit's ephemerides, without the site's elevation, the terrain, or the profile of the lunar limb; times near the edges of the path are less certain.</Notice>
			</CollapsibleSection>
		</>
	)
}
