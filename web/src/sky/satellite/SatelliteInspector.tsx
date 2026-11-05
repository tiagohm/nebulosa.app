import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { formatDegrees } from '../../format'
import type { SkyObserverSettings } from '../../profile/schema'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { PanelSection } from '../../shell/ContextualPanel'
import { openArtificialSatellites } from '../../tools/artificialsatellites/artificialsatellites'
import { Button } from '../../ui/Button'
import { DataRow } from '../../ui/DataRow'
import { skyClock, skyTime } from '../clock'
import { formatDeclination, formatLocalTime, formatRightAscension } from '../format'
import { Note } from '../InspectorParts'
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
	// Observer of the active profile; absent when none is set.
	readonly observer?: SkyObserverSettings
	// Opens the observer settings.
	readonly onSetObserver: () => void
	// IANA time zone times are shown in; the browser's when absent.
	readonly timeZone?: string
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
			<PanelSection title="Object">
				<p className="m-0 text-base leading-6 font-semibold text-ink-100">{object?.name ?? selection.name}</p>
				<p className="m-0 text-ink-300">{OBJECT_TYPE_NAMES[object?.objectType ?? 'unknown']}</p>
				<p className="m-0 text-xs leading-5 text-ink-200">{[`NORAD ${noradId}`, object?.cosparId].filter(Boolean).join(' · ')}</p>
				<DataRow label="Brightness">Unknown</DataRow>
				{detailsError && <Note danger>Details unavailable: {detailsError}</Note>}
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
			</PanelSection>
			<CollapsibleSection id="sky.position" title="Position" summary={position?.constellationName ?? position?.constellation}>
				{positionError && <Note danger>{positionError}</Note>}
				{position && (
					<>
						<DataRow label="RA (of date)">{formatRightAscension(position.rightAscension)}</DataRow>
						<DataRow label="Dec (of date)">{formatDeclination(position.declination)}</DataRow>
						<DataRow label="RA (J2000)">{formatRightAscension(position.rightAscensionJ2000)}</DataRow>
						<DataRow label="Dec (J2000)">{formatDeclination(position.declinationJ2000)}</DataRow>
						{position.distance !== undefined && <DataRow label="Distance">{`${Math.round(position.distance * 149_597_870.7)} km`}</DataRow>}
						{position.constellationName && <DataRow label="Constellation">{position.constellationName}</DataRow>}
						<Note>
							Geometric {position.center} place at {formatLocalTime(position.time, Date.now(), undefined, timeZone)}, from the orbital elements of the satellite catalog.
						</Note>
					</>
				)}
			</CollapsibleSection>
			<CollapsibleSection id="sky.visibility" title="Visibility" summary={position?.altitude === undefined ? undefined : formatDegrees(position.altitude)}>
				{!observer && (
					<>
						<Note>Set the observer location to see the altitude and the passes of the satellite.</Note>
						<Button variant="ghost" className="self-start" onClick={onSetObserver}>
							Set Observer
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
				{nextPassError && <Note danger>{nextPassError}</Note>}
				{nextPass === null && <Note>No pass above the horizon in the next two days.</Note>}
				{nextPass && (
					<>
						<DataRow label="Rises">{`${formatLocalTime(nextPass.start.time, Date.now(), undefined, timeZone)} · ${formatDegrees(nextPass.start.azimuth)}`}</DataRow>
						<DataRow label="Highest">{`${formatLocalTime(nextPass.culmination.time, Date.now(), undefined, timeZone)} · ${formatDegrees(nextPass.culmination.altitude)}`}</DataRow>
						<DataRow label="Sets">{`${formatLocalTime(nextPass.end.time, Date.now(), undefined, timeZone)} · ${formatDegrees(nextPass.end.azimuth)}`}</DataRow>
						<DataRow label="Visible">{nextPass.visible.length > 0 ? 'Yes, sunlit in a dark sky' : 'No (daylight or in the shadow)'}</DataRow>
					</>
				)}
			</CollapsibleSection>
			{details?.elements && (
				<CollapsibleSection id="sky.satelliteElements" title="Orbital Data" defaultOpen={false}>
					<DataRow label="Source">{details.elements.kind === 'manual' ? 'Imported' : 'CelesTrak GP'}</DataRow>
					<DataRow label="Epoch">{formatLocalTime(details.elements.epoch, Date.now(), undefined, 'UTC')}</DataRow>
					{details.orbit && <DataRow label="Period">{`${details.orbit.periodMinutes.toFixed(1)} min`}</DataRow>}
					{details.orbit && <DataRow label="Inclination">{formatDegrees(details.orbit.inclination)}</DataRow>}
				</CollapsibleSection>
			)}
		</>
	)
}
