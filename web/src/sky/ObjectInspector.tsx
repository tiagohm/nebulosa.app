import type { MinorBody, SkyCatalogObject, SkyEvents, SkyPosition } from 'api'
import { toMas } from 'nebulosa/src/math/units/angle'
import { useSnapshot } from 'valtio'
import type { SkyObserverSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { PanelSection } from '../shell/ContextualPanel'
import { Button } from '../ui/Button'
import { DataRow } from '../ui/DataRow'
import { formatAngularSize, formatDeclination, formatDegrees, formatLocalTime, formatMagnitude, formatRightAscension, formatStellarDistance } from './format'
import { Note, ObserverSection, PositionSection } from './InspectorParts'
import { MoonInspector } from './moon/MoonInspector'
import { MountInspector } from './MountInspector'
import { ObjectActions } from './ObjectActions'
import { type SkySelection, skyState } from './sky'
import { SunInspector } from './sun/SunInspector'

// Object Inspector of the Sky workspace: the selected object's identity, catalog data, coordinates, and,
// for an observer, its altitude, azimuth, rise, transit, and set; for solar-system objects, distance,
// magnitude, and illumination; for minor bodies, their SBDB classification and elements. Every value
// says what it is: catalog J2000 or apparent of date, topocentric or geocentric, the instant, and the
// provider (Horizons or a local model, with the reason). Missing data is shown as missing, never as a
// placeholder value, and catalog data stays shown when a position fails. With a mount on the profile's
// connection, the object can be slewed to from its Object section. The mount marker, the Sun, and the Moon have their own views.

// Orbital elements and physical parameters of minor bodies shown, in order.
const MINOR_BODY_PARAMETERS = ['a', 'e', 'i', 'q', 'per', 'H', 'G', 'M1', 'diameter'] as const

export interface ObjectInspectorProps {
	// Observer of the active profile; absent when none is set.
	readonly observer?: SkyObserverSettings
	// Opens the observer settings.
	readonly onSetObserver: () => void
	// IANA time zone times are shown in; the browser's when absent.
	readonly timeZone?: string
	// Opens the framing settings, which draw the field of view around the selection.
	readonly onShowFraming: () => void
}

// Object Inspector.
export function ObjectInspector({ observer, onSetObserver, timeZone, onShowFraming }: ObjectInspectorProps) {
	const { selection } = useSnapshot(skyState)

	if (!selection) {
		return (
			<PanelSection title="Object">
				<p className="m-0 text-ink-300">Select an object in the Planetarium or use Search.</p>
			</PanelSection>
		)
	}

	if (selection.ref.kind === 'mount') return <MountInspector mountRef={selection.ref} observer={observer} onShowFraming={onShowFraming} />
	if (selection.ref.kind === 'body' && selection.ref.code === '10') return <SunInspector selection={selection} observer={observer} onSetObserver={onSetObserver} timeZone={timeZone} onShowFraming={onShowFraming} />
	if (selection.ref.kind === 'body' && selection.ref.code === '301') return <MoonInspector selection={selection} observer={observer} onSetObserver={onSetObserver} timeZone={timeZone} onShowFraming={onShowFraming} />

	const hasObserver = !!observer
	const { catalog, minorBody, constellation, position, events } = selection as SkySelection
	const designations = catalog ? catalog.designations : constellation ? [constellation.abbreviation, constellation.genitive] : []
	const magnitude = catalog ? catalog.magnitude : position?.magnitude

	return (
		<>
			<PanelSection title="Object">
				<p className="m-0 text-base leading-6 font-semibold text-ink-100">{selection.name}</p>
				<p className="m-0 text-ink-300">{typeOf(selection)}</p>
				{designations.length > 0 && <p className="m-0 text-xs leading-5 text-ink-200">{designations.join(' · ')}</p>}
				{magnitude !== undefined && <DataRow label="Magnitude">{formatMagnitude(magnitude)}</DataRow>}
				{selection.detailsError && <Note danger>Details unavailable: {selection.detailsError}</Note>}
				<ObjectActions target={selection.ref} targetName={selection.name} observer={observer} onShowFraming={onShowFraming} />
			</PanelSection>
			<PositionSection selection={selection} timeZone={timeZone} />
			{position && <ObserverSection position={position} events={events} hasObserver={hasObserver} onSetObserver={onSetObserver} isSolarSystem={selection.ref.kind === 'body' || selection.ref.kind === 'minorBody'} timeZone={timeZone} />}
			{catalog && <CatalogSection catalog={catalog} />}
			{minorBody && <MinorBodySection body={minorBody} />}
		</>
	)
}

// Object type line of the selection.
function typeOf(selection: SkySelection) {
	if (selection.catalog) return `${selection.catalog.typeName} in ${selection.catalog.constellationName}`
	if (selection.minorBody) return `${selection.minorBody.kind === 'comet' ? 'Comet' : 'Asteroid'} · ${selection.minorBody.orbitClass}`
	if (selection.ref.kind === 'constellation') return 'Constellation'
	if (selection.ref.kind === 'body') return selection.ref.code === '10' ? 'Star' : selection.ref.code === '301' ? 'Natural Satellite' : selection.ref.code === '999' ? 'Dwarf Planet' : 'Planet'
	return selection.loading ? 'Loading…' : ''
}

// Catalog data of a star or deep-sky object.
function CatalogSection({ catalog }: { readonly catalog: SkyCatalogObject }) {
	const star = catalog.category === 'star'
	const pm = catalog.pmRA !== 0 || catalog.pmDEC !== 0

	return (
		<CollapsibleSection id="sky.catalog" title="Catalog" summary={catalog.classification} defaultOpen={false}>
			{catalog.bv !== undefined && <DataRow label="B−V">{catalog.bv.toFixed(2)}</DataRow>}
			{catalog.classification && <DataRow label={star ? 'Spectral type' : 'Morphology'}>{catalog.classification}</DataRow>}
			{catalog.majorAxis !== undefined && (
				<DataRow label="Size">
					{formatAngularSize(catalog.majorAxis)}
					{catalog.minorAxis !== undefined && ` × ${formatAngularSize(catalog.minorAxis)}`}
				</DataRow>
			)}
			{catalog.orientation !== undefined && catalog.majorAxis !== undefined && <DataRow label="Position angle">{formatDegrees(catalog.orientation)}</DataRow>}
			{catalog.distance !== undefined && <DataRow label="Distance">{formatStellarDistance(catalog.distance)}</DataRow>}
			{pm && (
				<DataRow label="Proper motion">
					{toMas(catalog.pmRA * Math.cos(catalog.declination)).toFixed(2)}, {toMas(catalog.pmDEC).toFixed(2)} mas/yr
				</DataRow>
			)}
			<DataRow label="RA (J2000)">{formatRightAscension(catalog.rightAscension)}</DataRow>
			<DataRow label="Dec (J2000)">{formatDeclination(catalog.declination)}</DataRow>
			{pm && <Note>Proper motion is μα·cos δ and μδ. Catalog coordinates are for epoch J2000.</Note>}
		</CollapsibleSection>
	)
}

// SBDB data of a minor body.
function MinorBodySection({ body }: { readonly body: MinorBody }) {
	const parameters = MINOR_BODY_PARAMETERS.map((name) => body.parameters.find((e) => e.name === name)).filter((e) => !!e)

	return (
		<CollapsibleSection id="sky.smallBody" title="Small Body" summary={`SPK-ID ${body.spkId}`} defaultOpen={false}>
			<DataRow label="SPK-ID">{body.spkId}</DataRow>
			{body.neo && <DataRow label="Near-Earth object">{body.pha ? 'Yes, potentially hazardous' : 'Yes'}</DataRow>}
			{parameters.map((e) => (
				<DataRow key={e.name} label={parameterTitle(e.title)}>
					{parameterValue(e.value)}
					{e.units && ` ${e.units}`}
				</DataRow>
			))}
			<Note>
				Orbit solution {body.solutionDate}
				{body.epoch !== undefined && `, elements at JD ${body.epoch}`}. Source: JPL Small-Body Database.
			</Note>
		</CollapsibleSection>
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
