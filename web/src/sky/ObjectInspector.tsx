import type { MinorBody, SkyCatalogObject, SkyEvents, SkyPosition } from 'api'
import { toMas } from 'nebulosa/src/math/units/angle'
import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { PanelSection } from '../shell/ContextualPanel'
import { Button } from '../ui/Button'
import { formatAngularSize, formatDeclination, formatDegrees, formatLocalTime, formatMagnitude, formatRightAscension, formatSolarSystemDistance, formatStellarDistance } from './format'
import { type SkySelection, skyState } from './sky'

// Object Inspector of the Sky workspace: the selected object's identity, catalog data, coordinates, and,
// for an observer, its altitude, azimuth, rise, transit, and set; for solar-system objects, distance,
// magnitude, and illumination; for minor bodies, their SBDB classification and elements. Every value
// says what it is: catalog J2000 or apparent of date, topocentric or geocentric, the instant, and the
// provider (Horizons or a local model, with the reason). Missing data is shown as missing, never as a
// placeholder value, and catalog data stays shown when a position fails.

// Description of each fallback reason.
const FALLBACK_REASONS = { timeout: 'Horizons did not answer in time', network: 'Horizons cannot be reached', breakerOpen: 'Horizons failed repeatedly and is paused' } as const

// Orbital elements and physical parameters of minor bodies shown, in order.
const MINOR_BODY_PARAMETERS = ['a', 'e', 'i', 'q', 'per', 'H', 'G', 'M1', 'diameter'] as const

export interface ObjectInspectorProps {
	// Whether an observer is set in the profile.
	readonly hasObserver: boolean
	// Opens the observer settings.
	readonly onSetObserver: () => void
}

// Label and value of one datum.
function Datum({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="flex-none text-ink-300">{label}</span>
			<span className="min-w-0 text-right font-mono text-[13px] wrap-break-word text-ink-100">{children}</span>
		</div>
	)
}

// Muted note under a section.
function Note({ children, danger }: { readonly children: ReactNode; readonly danger?: boolean }) {
	return <p className={danger ? 'm-0 text-xs leading-4 text-danger' : 'm-0 text-xs leading-4 text-ink-300'}>{children}</p>
}

// Object Inspector.
export function ObjectInspector({ hasObserver, onSetObserver }: ObjectInspectorProps) {
	const { selection } = useSnapshot(skyState)

	if (!selection) {
		return (
			<PanelSection title="Object">
				<p className="m-0 text-ink-300">Select an object in the Planetarium or use Search.</p>
			</PanelSection>
		)
	}

	const { catalog, minorBody, position, events } = selection as SkySelection

	return (
		<>
			<PanelSection title="Object">
				<p className="m-0 text-base leading-6 font-semibold text-ink-100">{selection.name}</p>
				<p className="m-0 text-ink-300">{typeOf(selection)}</p>
				{catalog && catalog.designations.length > 0 && <p className="m-0 text-xs leading-5 text-ink-200">{catalog.designations.join(' · ')}</p>}
				{selection.detailsError && <Note danger>Details unavailable: {selection.detailsError}</Note>}
			</PanelSection>
			{catalog && <CatalogSection catalog={catalog} />}
			{minorBody && <MinorBodySection body={minorBody} />}
			<PositionSection selection={selection} />
			{position && <ObserverSection position={position} events={events} hasObserver={hasObserver} onSetObserver={onSetObserver} isSolarSystem={selection.ref.kind !== 'catalog'} />}
		</>
	)
}

// Object type line of the selection.
function typeOf(selection: SkySelection) {
	if (selection.catalog) return `${selection.catalog.typeName} in ${selection.catalog.constellationName}`
	if (selection.minorBody) return `${selection.minorBody.kind === 'comet' ? 'Comet' : 'Asteroid'} · ${selection.minorBody.orbitClass}`
	if (selection.ref.kind === 'body') return selection.ref.code === '10' ? 'Star' : selection.ref.code === '301' ? 'Natural Satellite' : selection.ref.code === '999' ? 'Dwarf Planet' : 'Planet'
	return selection.loading ? 'Loading…' : ''
}

// Catalog data of a star or deep-sky object.
function CatalogSection({ catalog }: { readonly catalog: SkyCatalogObject }) {
	const star = catalog.category === 'star'
	const pm = catalog.pmRA !== 0 || catalog.pmDEC !== 0

	return (
		<PanelSection title="Catalog">
			{catalog.magnitude !== undefined && <Datum label="Magnitude">{formatMagnitude(catalog.magnitude)}</Datum>}
			{catalog.bv !== undefined && <Datum label="B−V">{catalog.bv.toFixed(2)}</Datum>}
			{catalog.classification && <Datum label={star ? 'Spectral type' : 'Morphology'}>{catalog.classification}</Datum>}
			{catalog.majorAxis !== undefined && (
				<Datum label="Size">
					{formatAngularSize(catalog.majorAxis)}
					{catalog.minorAxis !== undefined && ` × ${formatAngularSize(catalog.minorAxis)}`}
				</Datum>
			)}
			{catalog.orientation !== undefined && catalog.majorAxis !== undefined && <Datum label="Position angle">{formatDegrees(catalog.orientation)}</Datum>}
			{catalog.distance !== undefined && <Datum label="Distance">{formatStellarDistance(catalog.distance)}</Datum>}
			{pm && (
				<Datum label="Proper motion">
					{toMas(catalog.pmRA * Math.cos(catalog.declination)).toFixed(1)}, {toMas(catalog.pmDEC).toFixed(1)} mas/yr
				</Datum>
			)}
			<Datum label="RA (J2000)">{formatRightAscension(catalog.rightAscension)}</Datum>
			<Datum label="Dec (J2000)">{formatDeclination(catalog.declination)}</Datum>
			{pm && <Note>Proper motion is μα·cos δ and μδ. Catalog coordinates are for epoch J2000.</Note>}
		</PanelSection>
	)
}

// SBDB data of a minor body.
function MinorBodySection({ body }: { readonly body: MinorBody }) {
	const parameters = MINOR_BODY_PARAMETERS.map((name) => body.parameters.find((e) => e.name === name)).filter((e) => !!e)

	return (
		<PanelSection title="Small Body">
			<Datum label="SPK-ID">{body.spkId}</Datum>
			{body.neo && <Datum label="Near-Earth object">{body.pha ? 'Yes, potentially hazardous' : 'Yes'}</Datum>}
			{parameters.map((e) => (
				<Datum key={e.name} label={parameterTitle(e.title)}>
					{parameterValue(e.value)}
					{e.units && ` ${e.units}`}
				</Datum>
			))}
			<Note>
				Orbit solution {body.solutionDate}
				{body.epoch !== undefined && `, elements at JD ${body.epoch}`}. Source: JPL Small-Body Database.
			</Note>
		</PanelSection>
	)
}

// Short title of an SBDB parameter: its text before any explanation after a semicolon, capitalized.
function parameterTitle(title: string) {
	const short = title.split(';')[0].trim()
	return short.charAt(0).toUpperCase() + short.slice(1)
}

// Value of an SBDB parameter with at most seven significant digits; text values are kept as published.
function parameterValue(value: string) {
	const number = Number(value)
	return value.trim() !== '' && Number.isFinite(number) ? `${Number(number.toPrecision(7))}` : value
}

// Apparent coordinates of the selection, with their provider and instant.
function PositionSection({ selection }: { readonly selection: SkySelection }) {
	const { position, positionError, loading } = selection

	return (
		<PanelSection title="Position">
			{position ? (
				<>
					<Datum label="RA (of date)">{formatRightAscension(position.rightAscension)}</Datum>
					<Datum label="Dec (of date)">{formatDeclination(position.declination)}</Datum>
					{selection.ref.kind !== 'catalog' && (
						<>
							<Datum label="RA (J2000)">{formatRightAscension(position.rightAscensionJ2000)}</Datum>
							<Datum label="Dec (J2000)">{formatDeclination(position.declinationJ2000)}</Datum>
						</>
					)}
					{position.distance !== undefined && <Datum label="Distance">{formatSolarSystemDistance(position.distance)}</Datum>}
					{position.magnitude !== undefined && selection.ref.kind !== 'catalog' && <Datum label="Magnitude">{formatMagnitude(position.magnitude)}</Datum>}
					{position.illuminated !== undefined && selection.ref.kind !== 'catalog' && <Datum label="Illuminated">{(position.illuminated * 100).toFixed(1)}%</Datum>}
					{position.elongation !== undefined && !(selection.ref.kind === 'body' && selection.ref.code === '10') && selection.ref.kind !== 'catalog' && <Datum label="Solar elongation">{formatDegrees(position.elongation)}</Datum>}
					<Note>{positionNote(position)}</Note>
				</>
			) : (
				!positionError && <p className="m-0 text-ink-300">{loading ? 'Computing the position…' : 'No position.'}</p>
			)}
			{positionError && <Note danger>Ephemeris unavailable: {positionError}</Note>}
		</PanelSection>
	)
}

// Describes how and when a position was computed.
function positionNote(position: SkyPosition) {
	const source = position.source === 'horizons' ? 'JPL Horizons' : position.fallbackReason ? `local model (${FALLBACK_REASONS[position.fallbackReason]})` : 'local model'
	return `Apparent ${position.center} place at ${formatLocalTime(position.time)}, from ${source}.`
}

// Horizontal coordinates and events for the observer, or an invitation to set one.
function ObserverSection({ position, events, hasObserver, onSetObserver, isSolarSystem }: { readonly position: SkyPosition; readonly events?: SkyEvents; readonly hasObserver: boolean; readonly onSetObserver: () => void; readonly isSolarSystem: boolean }) {
	if (!hasObserver || position.altitude === undefined || position.azimuth === undefined) {
		return (
			<PanelSection title="Visibility">
				<p className="m-0 text-ink-300">Altitude, azimuth, rise, and set need the observer&apos;s location.</p>
				<div>
					<Button variant="secondary" size="sm" onClick={onSetObserver}>
						Set Location
					</Button>
				</div>
			</PanelSection>
		)
	}

	return (
		<PanelSection title="Visibility">
			<Datum label="Altitude">{formatDeclination(position.altitude)}</Datum>
			{position.altitude < 0 && <Note>Below the horizon now, so the map does not show it.</Note>}
			<Datum label="Azimuth">{formatDegrees(position.azimuth)}</Datum>
			{events?.state === 'circumpolar' && <Datum label="Rise and set">Circumpolar</Datum>}
			{events?.state === 'belowHorizon' && <Datum label="Rise and set">Below the horizon all day</Datum>}
			{events?.rise !== undefined && <Datum label="Rise">{formatLocalTime(events.rise, position.time)}</Datum>}
			{events?.transit !== undefined && (
				<Datum label="Transit">
					{formatLocalTime(events.transit, position.time)}
					{events.transitAltitude !== undefined && ` · ${formatDeclination(events.transitAltitude)}`}
				</Datum>
			)}
			{events?.set !== undefined && <Datum label="Set">{formatLocalTime(events.set, position.time)}</Datum>}
			<Note>Refracted altitude. Rise, transit, and set are the ones nearest the instant, within 12 hours{isSolarSystem ? ', from the local model' : ''}.</Note>
		</PanelSection>
	)
}
