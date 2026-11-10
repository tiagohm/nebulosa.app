import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { formatDegrees, formatLocalTime } from '../../format'
import type { SiteLocation } from '../../location/site'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { openArtificialSatellites } from '../../tools/artificialsatellites/artificialsatellites'
import { Button } from '../../ui/Button'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { ObjectTitle } from '../../ui/ObjectTitle'
import { skyClock, skyTime } from '../clock'
import { formatDeclination, formatRightAscension, formatSolarSystemDistance } from '../format'
import type { SkySelection } from '../sky'
import { findNextSatellitePass, inspectSatellite, skySatelliteState } from './satellite'

// Object Inspector of an artificial satellite in the Sky: its identity, its geometric position at the instant the Sky
// shows (from the satellite catalog's elements, never with rise, transit, or set), its next pass for the observer, and
// actions to follow it on the map, draw its track, and open it in Artificial Satellites. A satellite cannot be slewed
// to: a one-time goto would not track it, so no Slew to Object is offered.

// Names of the SATCAT object types.
const OBJECT_TYPE_NAMES = { payload: 'Payload', rocketBody: 'Rocket body', debris: 'Debris', unknown: 'Artificial satellite' } as const

export interface SatelliteInspectorProps {
	// Selection of a satellite.
	readonly selection: SkySelection
	// Observing site of the active profile; absent when it has none.
	readonly observer?: SiteLocation
	// Opens Settings → Observing Sites to choose or add a site.
	readonly onSetObserver: () => void
	// IANA time zone times are shown in: the profile's display zone.
	readonly timeZone: string
}

// Satellite Inspector.
export function SatelliteInspector({ selection, observer, onSetObserver, timeZone }: SatelliteInspectorProps) {
	const noradId = selection.ref.kind === 'satellite' ? selection.ref.noradId : ''
	const { details, detailsError, nextPass, nextPassLoading, nextPassError, tracking, trail } = useSnapshot(skySatelliteState)
	const { position, positionError } = selection
	const object = details?.object

	// Reads the details of the satellite selected.
	useEffect(() => void inspectSatellite(skySatelliteState, noradId), [noradId])

	return (
		<>
			<CollapsibleSection id="sky.object" title="Object" summary={object?.name ?? selection.name}>
				<ObjectTitle name={object?.name ?? selection.name} kind={OBJECT_TYPE_NAMES[object?.objectType ?? 'unknown']} designations={[`NORAD ${noradId}`, object?.cosparId].filter(Boolean).join(' · ')} />
				<DataRow label="Brightness">Unknown</DataRow>
				{detailsError && <Notice error>Details unavailable: {detailsError}</Notice>}
				<div className="flex flex-wrap gap-2">
					<Button variant={tracking ? 'primary' : 'secondary'} disabled={!position} title="Keeps the view on the satellite; panning the map stops it." onClick={() => (skySatelliteState.tracking = !tracking)}>
						{tracking ? 'Stop Tracking' : 'Track on Sky'}
					</Button>
					<Button variant={trail ? 'primary' : 'secondary'} title="Draws the track of the satellite around the time shown." onClick={() => (skySatelliteState.trail = !trail)}>
						{trail ? 'Hide Track' : 'Show Track'}
					</Button>
					<Button variant="secondary" onClick={() => openArtificialSatellites(noradId)}>
						Open in Artificial Satellites
					</Button>
				</div>
			</CollapsibleSection>
			<CollapsibleSection id="sky.position" title="Position" summary={position?.constellationName ?? position?.constellation}>
				{positionError && <Notice error>{positionError}</Notice>}
				{position && (
					<>
						<DataRow label="RA (of date)">{formatRightAscension(position.rightAscension)}</DataRow>
						<DataRow label="Dec (of date)">{formatDeclination(position.declination)}</DataRow>
						<DataRow label="RA (J2000)">{formatRightAscension(position.rightAscensionJ2000)}</DataRow>
						<DataRow label="Dec (J2000)">{formatDeclination(position.declinationJ2000)}</DataRow>
						{position.distance !== undefined && <DataRow label="Distance">{formatSolarSystemDistance(position.distance)}</DataRow>}
						{position.constellationName && <DataRow label="Constellation">{position.constellationName}</DataRow>}
						<Notice>
							Geometric {position.center} place at {formatLocalTime(position.time, timeZone, Date.now())}, from the orbital elements of the satellite catalog.
						</Notice>
					</>
				)}
			</CollapsibleSection>
			<CollapsibleSection id="sky.visibility" title="Visibility" summary={position?.altitude === undefined ? undefined : formatDegrees(position.altitude)}>
				{!observer && (
					<>
						<Notice>Select an observing site to see the altitude and the passes of the satellite.</Notice>
						<Button variant="ghost" className="self-start" onClick={onSetObserver}>
							Set Location
						</Button>
					</>
				)}
				{observer && position?.altitude !== undefined && (
					<>
						<DataRow label="Altitude">{`${formatDegrees(position.altitude)} (${position.altitude > 0 ? 'above' : 'below'} the horizon)`}</DataRow>
						{position.azimuth !== undefined && <DataRow label="Azimuth">{formatDegrees(position.azimuth)}</DataRow>}
					</>
				)}
				{observer && (
					<Button variant="secondary" className="self-start" disabled={nextPassLoading} onClick={() => void findNextSatellitePass(skySatelliteState, observer, skyTime(skyClock, Date.now()))}>
						Show Next Pass
					</Button>
				)}
				{nextPassError && <Notice error>{nextPassError}</Notice>}
				{nextPass === null && <Notice>No pass above the horizon in the next two days.</Notice>}
				{nextPass && (
					<>
						<DataRow label="Rises">{`${formatLocalTime(nextPass.start.time, timeZone, Date.now())} · ${formatDegrees(nextPass.start.azimuth)}`}</DataRow>
						<DataRow label="Highest">{`${formatLocalTime(nextPass.culmination.time, timeZone, Date.now())} · ${formatDegrees(nextPass.culmination.altitude)}`}</DataRow>
						<DataRow label="Sets">{`${formatLocalTime(nextPass.end.time, timeZone, Date.now())} · ${formatDegrees(nextPass.end.azimuth)}`}</DataRow>
						<DataRow label="Visible">{nextPass.visible.length > 0 ? 'Yes, sunlit in a dark sky' : 'No (daylight or in the shadow)'}</DataRow>
					</>
				)}
			</CollapsibleSection>
			{details?.elements && (
				<CollapsibleSection id="sky.satelliteElements" title="Orbital Data" defaultOpen={false}>
					<DataRow label="Source">{details.elements.kind === 'manual' ? 'Imported' : 'CelesTrak GP'}</DataRow>
					<DataRow label="Epoch">{formatLocalTime(details.elements.epoch, 'UTC', Date.now())}</DataRow>
					{details.orbit && <DataRow label="Period">{`${details.orbit.periodMinutes.toFixed(1)} min`}</DataRow>}
					{details.orbit && <DataRow label="Inclination">{formatDegrees(details.orbit.inclination)}</DataRow>}
				</CollapsibleSection>
			)}
		</>
	)
}
