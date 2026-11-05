import type { SatelliteQuality } from 'api'
import { useSnapshot } from 'valtio'
import { formatDegrees } from '../../format'
import { activeProfile, profileState, satelliteFavorites, setSatelliteFavorite } from '../../profile/profile'
import type { SkyObserverSettings } from '../../profile/schema'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { formatDeclination, formatRightAscension } from '../../sky/format'
import { Button } from '../../ui/Button'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { artificialSatellitesState, formatElementAge, formatSatelliteTime, openSkyObserver, setSatelliteElementSource, SHADOW_LABELS, showSatelliteInSky } from './artificialsatellites'

// Contextual panel of Artificial Satellites: the satellite selected, its position now for the Sky observer (read again
// every POSITION_REFRESH_MS), its orbit, and where its elements come from. Every value is the server's; an absent one is left out, never shown as 0. Positions are
// geometric; the RA/Dec of date are those the Sky draws, J2000 is ICRS.

// Names of the SATCAT object types.
const OBJECT_TYPE_NAMES = { payload: 'Payload', rocketBody: 'Rocket body', debris: 'Debris', unknown: 'Unknown' } as const

// Names of the SATCAT operational status codes.
const STATUS_NAMES: Readonly<Record<string, string>> = { '+': 'Operational', '-': 'Nonoperational', P: 'Partially operational', B: 'Backup', S: 'Spare', X: 'Extended mission', D: 'Decayed', '?': 'Unknown' }

// Words of each reason lowering the quality of a prediction.
const QUALITY_REASONS: Readonly<Record<SatelliteQuality['reasons'][number], string>> = {
	decayed: 'the catalog dates its decay before this time',
	propagationError: 'SGP4 cannot propagate the elements to this time',
	elementsAging: 'the elements are getting old for this orbit',
	elementsOld: 'the elements are too old for this orbit',
	eopApproximate: 'no Earth orientation data for this time (UT1 taken as UTC)',
}

// Quality of a prediction, in words.
export function QualityRow({ quality }: { readonly quality: SatelliteQuality }) {
	const text = quality.suitability === 'usable' ? 'Usable' : `${quality.suitability === 'caution' ? 'Approximate' : 'Unreliable'}: ${quality.reasons.map((reason) => QUALITY_REASONS[reason]).join('; ')}`
	return (
		<DataRow label="Prediction" tone={quality.suitability === 'unavailable' ? 'danger' : quality.suitability === 'usable' ? 'success' : 'default'}>
			{text}
		</DataRow>
	)
}

// Panel of the satellite selected.
export function SatelliteDetailsPanel({ observer }: { readonly observer?: SkyObserverSettings }) {
	const { selectedId, details, detailsError, position, positionError } = useSnapshot(artificialSatellitesState)
	const profiles = useSnapshot(profileState)
	const favorite = !!selectedId && satelliteFavorites(activeProfile(profiles).settings).includes(selectedId)
	if (!selectedId) return null

	const object = details?.object
	const orbit = details?.orbit
	const elements = details?.elements
	const p = position?.position
	const name = object?.name ?? selectedId
	const timeZone = observer?.timeZone ?? ''

	return (
		<div className="flex flex-col">
			<section className="flex flex-col gap-2 border-b border-line-100 px-4 py-3">
				<h3 className="m-0 text-base font-medium text-ink-100">{name}</h3>
				{detailsError && <Notice error>{detailsError}</Notice>}
				<DataList>
					<DataRow label="NORAD ID">{selectedId}</DataRow>
					{object?.cosparId && <DataRow label="COSPAR ID">{object.cosparId}</DataRow>}
					{object?.objectType && <DataRow label="Type">{OBJECT_TYPE_NAMES[object.objectType]}</DataRow>}
					{object?.opsStatus && <DataRow label="Status">{STATUS_NAMES[object.opsStatus] ?? object.opsStatus}</DataRow>}
					{object?.owner && <DataRow label="Owner">{object.owner}</DataRow>}
					{object?.launchDate && <DataRow label="Launch">{object.launchDate}</DataRow>}
					{object?.decayDate && (
						<DataRow label="Decay" tone="danger">
							{object.decayDate}
						</DataRow>
					)}
					<DataRow label="Brightness">Unknown</DataRow>
				</DataList>
				<div className="flex flex-wrap gap-2">
					<Button variant="secondary" onClick={() => setSatelliteFavorite(profileState, selectedId, !favorite)}>
						{favorite ? 'Remove Favorite' : 'Add Favorite'}
					</Button>
					<Button variant="secondary" disabled={!elements} title={elements ? 'Selects the satellite in the Sky, at the time the Sky shows.' : 'The satellite has no orbital elements.'} onClick={() => showSatelliteInSky(selectedId, name, observer)}>
						Open in Sky
					</Button>
				</div>
				{!elements && details && <Notice>This satellite has catalog data only: no orbital elements to predict it with. Download a group that lists it, or import its elements.</Notice>}
			</section>

			{elements && (
				<CollapsibleSection id="satellites.position" title="Position Now" summary={p?.altitude === undefined ? undefined : `altitude ${formatDegrees(p.altitude, 1)}`}>
					{positionError && <Notice error>{positionError}</Notice>}
					{p && position && (
						<DataList>
							<DataRow label="Time">{formatSatelliteTime(p.time, timeZone)}</DataRow>
							<DataRow label="Seen from">{p.center === 'topocentric' ? 'The observer' : "The Earth's center"}</DataRow>
							{p.altitude !== undefined && <DataRow label="Altitude">{`${formatDegrees(p.altitude)} (${p.altitude > 0 ? 'above' : 'below'} the horizon)`}</DataRow>}
							{p.azimuth !== undefined && <DataRow label="Azimuth">{formatDegrees(p.azimuth)}</DataRow>}
							<DataRow label="RA (of date)">{formatRightAscension(p.rightAscension)}</DataRow>
							<DataRow label="Dec (of date)">{formatDeclination(p.declination)}</DataRow>
							<DataRow label="RA (J2000)">{formatRightAscension(p.rightAscensionJ2000)}</DataRow>
							<DataRow label="Dec (J2000)">{formatDeclination(p.declinationJ2000)}</DataRow>
							<DataRow label="Constellation">{p.constellation}</DataRow>
							<DataRow label="Distance">{`${p.distanceKm.toFixed(0)} km`}</DataRow>
							<DataRow label="Height">{`${p.heightKm.toFixed(1)} km`}</DataRow>
							<DataRow label="Below">{`${formatDegrees(p.subpointLatitude)}, ${formatDegrees(p.subpointLongitude)}`}</DataRow>
							<QualityRow quality={position.quality} />
						</DataList>
					)}
					<Notice>{observer ? 'Read every 15 seconds for the observer of the Sky.' : "Read every 15 seconds from the Earth's center: set the observer location in the Sky to see the altitude and the passes."}</Notice>
					{!observer && (
						<Button variant="ghost" className="self-start" onClick={() => openSkyObserver()}>
							Set Observer
						</Button>
					)}
				</CollapsibleSection>
			)}

			{p && (
				<CollapsibleSection id="satellites.motion" title="Motion & Illumination" defaultOpen={false}>
					<DataList>
						{p.rangeRateKmPerSecond !== undefined && <DataRow label="Range rate">{`${p.rangeRateKmPerSecond.toFixed(3)} km/s (${p.rangeRateKmPerSecond > 0 ? 'receding' : 'approaching'})`}</DataRow>}
						{p.angularRate !== undefined && <DataRow label="Angular speed">{`${formatDegrees(p.angularRate, 3)}/s`}</DataRow>}
						<DataRow label="Illumination">{SHADOW_LABELS[p.shadow]}</DataRow>
						{p.sunAltitude !== undefined && <DataRow label="Sun altitude here">{formatDegrees(p.sunAltitude, 1)}</DataRow>}
					</DataList>
					<Notice>Brightness is unknown: no source gives the reflectivity of most satellites, so no magnitude is estimated.</Notice>
				</CollapsibleSection>
			)}

			{orbit && (
				<CollapsibleSection id="satellites.orbit" title="Orbit" defaultOpen={false}>
					<DataList>
						<DataRow label="Mean motion">{`${orbit.meanMotion.toFixed(8)} rev/day`}</DataRow>
						<DataRow label="Period (derived)">{`${orbit.periodMinutes.toFixed(2)} min`}</DataRow>
						<DataRow label="Inclination">{formatDegrees(orbit.inclination, 4)}</DataRow>
						<DataRow label="Eccentricity">{orbit.eccentricity.toFixed(7)}</DataRow>
						<DataRow label="RAAN">{formatDegrees(orbit.rightAscensionOfAscendingNode, 4)}</DataRow>
						<DataRow label="Arg. of perigee">{formatDegrees(orbit.argumentOfPerigee, 4)}</DataRow>
						<DataRow label="Mean anomaly">{formatDegrees(orbit.meanAnomaly, 4)}</DataRow>
						<DataRow label="B*">{orbit.bstar.toExponential(4)}</DataRow>
						<DataRow label="Apogee / perigee (derived)">{`${orbit.apogeeHeightKm.toFixed(0)} / ${orbit.perigeeHeightKm.toFixed(0)} km`}</DataRow>
						{object?.apogeeKm !== undefined && object.perigeeKm !== undefined && <DataRow label="Apogee / perigee (catalog)">{`${object.apogeeKm} / ${object.perigeeKm} km`}</DataRow>}
						{object?.periodMinutes !== undefined && <DataRow label="Period (catalog)">{`${object.periodMinutes} min`}</DataRow>}
						<DataRow label="Model">{orbit.model === 'deepSpace' ? 'SDP4 (deep space)' : 'SGP4 (near Earth)'}</DataRow>
					</DataList>
					<Notice>Derived values come from the mean elements at their epoch; catalog values are published by SATCAT, possibly for another epoch.</Notice>
				</CollapsibleSection>
			)}

			{elements && details && (
				<CollapsibleSection id="satellites.elements" title="Orbital Data" defaultOpen={false}>
					<DataList>
						<DataRow label="Source">{elements.kind === 'manual' ? 'Imported' : `CelesTrak GP (${elements.sourceKey})`}</DataRow>
						<DataRow label="Epoch">{`${formatSatelliteTime(elements.epoch, 'UTC')} UTC`}</DataRow>
						{position && <DataRow label="Age now">{formatElementAge(position.quality.elementAgeDays)}</DataRow>}
						<DataRow label="Digest">
							<span title={elements.digest}>{elements.digest.slice(0, 12)}</span>
						</DataRow>
					</DataList>
					{details.elementSets.length > 1 && (
						<SegmentedControl label="Predict with" options={['gp', 'manual'] as const} value={elements.kind} format={(kind) => (kind === 'gp' ? 'GP elements' : 'Imported elements')} onChange={(kind) => void setSatelliteElementSource(artificialSatellitesState, kind === 'gp' ? null : kind, observer)} />
					)}
				</CollapsibleSection>
			)}
		</div>
	)
}
