import type { SkyEvents, SkyPosition } from 'api'
import type { ReactNode } from 'react'
import { formatDegrees, formatLocalTime, formatPercent } from '../format'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Button } from '../ui/Button'
import { DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { formatDeclination, formatRightAscension, formatSolarSystemDistance } from './format'
import type { SkySelection } from './sky'

// Parts shared by the Object Inspector and the Sun and Moon Inspectors: the collapsible
// Position section with its provider and instant, and the Visibility section of the observer's rise, transit, and set.

// Description of each fallback reason.
const FALLBACK_REASONS = { timeout: 'Horizons did not answer in time', network: 'Horizons cannot be reached', breakerOpen: 'Horizons failed repeatedly and is paused' } as const

// Rows of the apparent coordinates of the selection, with their provider and instant; `children` adds rows before
// the note.
function PositionData({ selection, timeZone, children }: { readonly selection: SkySelection; readonly timeZone: string; readonly children?: ReactNode }) {
	const { position, positionError, loading } = selection

	return (
		<>
			{position ? (
				<>
					<DataRow label="Constellation">{position.constellationName ?? position.constellation}</DataRow>
					<DataRow label="RA (of date)">{formatRightAscension(position.rightAscension)}</DataRow>
					<DataRow label="Dec (of date)">{formatDeclination(position.declination)}</DataRow>
					{selection.ref.kind !== 'catalog' && (
						<>
							<DataRow label="RA (J2000)">{formatRightAscension(position.rightAscensionJ2000)}</DataRow>
							<DataRow label="Dec (J2000)">{formatDeclination(position.declinationJ2000)}</DataRow>
						</>
					)}
					{position.distance !== undefined && <DataRow label="Distance">{formatSolarSystemDistance(position.distance)}</DataRow>}
					{position.illuminated !== undefined && selection.ref.kind !== 'catalog' && <DataRow label="Illuminated">{formatPercent(position.illuminated, 1)}</DataRow>}
					{position.elongation !== undefined && !(selection.ref.kind === 'body' && selection.ref.code === '10') && selection.ref.kind !== 'catalog' && <DataRow label="Solar elongation">{formatDegrees(position.elongation)}</DataRow>}
					{children}
					<Notice>{positionNote(position, selection.ref.kind === 'constellation', timeZone)}</Notice>
				</>
			) : (
				!positionError && <p className="m-0 text-ink-300">{loading ? 'Computing the position…' : 'No position.'}</p>
			)}
			{positionError && <Notice error>Ephemeris unavailable: {positionError}</Notice>}
		</>
	)
}

// Apparent coordinates of the selection, with their provider and instant; `children` adds rows before the note.
export function PositionSection({ selection, timeZone, children }: { readonly selection: SkySelection; readonly timeZone: string; readonly children?: ReactNode }) {
	return (
		<CollapsibleSection id="sky.position" title="Position" summary={selection.position && (selection.position.constellationName ?? selection.position.constellation)}>
			<PositionData selection={selection} timeZone={timeZone}>
				{children}
			</PositionData>
		</CollapsibleSection>
	)
}

// Describes how and when a position was computed; a constellation is located at its label, a fixed J2000
// point near its center. Times are shown in a time zone, or in the browser's when absent.
function positionNote(position: SkyPosition, constellation: boolean, timeZone: string) {
	const source = position.source === 'horizons' ? 'JPL Horizons' : position.fallbackReason ? `local model (${FALLBACK_REASONS[position.fallbackReason]})` : 'local model'
	const place = `Apparent ${position.center} place at ${formatLocalTime(position.time, timeZone, Date.now())}, from ${source}.`
	return constellation ? `${place} The position is the constellation label, a fixed J2000 point near its center.` : place
}

// Horizontal coordinates and events for the observer, or an invitation to set one.
export function ObserverSection({ position, events, hasObserver, onSetObserver, isSolarSystem, timeZone }: { readonly position: SkyPosition; readonly events?: SkyEvents; readonly hasObserver: boolean; readonly onSetObserver: () => void; readonly isSolarSystem: boolean; readonly timeZone: string }) {
	if (!hasObserver || position.altitude === undefined || position.azimuth === undefined) {
		return (
			<CollapsibleSection id="sky.visibility" title="Visibility">
				<p className="m-0 text-ink-300">Altitude, azimuth, rise, and set need an observing site.</p>
				<div>
					<Button variant="secondary" onClick={onSetObserver}>
						Set Location
					</Button>
				</div>
			</CollapsibleSection>
		)
	}

	return (
		<CollapsibleSection id="sky.visibility" title="Visibility" summary={`Altitude ${formatDeclination(position.altitude)}`}>
			<DataRow label="Altitude">{formatDeclination(position.altitude)}</DataRow>
			{position.altitude < 0 && <Notice>Below the horizon at this instant, so the map does not show it.</Notice>}
			<DataRow label="Azimuth">{formatDegrees(position.azimuth)}</DataRow>
			{events?.state === 'circumpolar' && <DataRow label="Rise and set">Circumpolar</DataRow>}
			{events?.state === 'belowHorizon' && <DataRow label="Rise and set">Below the horizon all day</DataRow>}
			{events?.rise !== undefined && <DataRow label="Rise">{formatLocalTime(events.rise, timeZone, position.time)}</DataRow>}
			{events?.transit !== undefined && (
				<DataRow label="Transit">
					{formatLocalTime(events.transit, timeZone, position.time)}
					{events.transitAltitude !== undefined && ` · ${formatDeclination(events.transitAltitude)}`}
				</DataRow>
			)}
			{events?.set !== undefined && <DataRow label="Set">{formatLocalTime(events.set, timeZone, position.time)}</DataRow>}
			<Notice>Refracted altitude. Rise and set are at the standard horizon (34′ of refraction), and the transit is on the meridian: the ones nearest the instant, within 12 hours{isSolarSystem ? ', from the local model' : ''}.</Notice>
		</CollapsibleSection>
	)
}
