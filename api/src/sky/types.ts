import type { EphemerisMode, SkyEvents, SkyObserver, SkyPosition } from './ephemeris'

// Contracts of the sky API shared with the web client: object identity, search results, catalog details,
// and the columnar data the star map renders. Angles are radians, times Unix milliseconds (UTC), and
// distances AU unless a name says otherwise.

// Horizons command of each major solar-system body the API knows: the Sun (10), the Moon (301), the
// planets (199 to 899), and Pluto (999).
export type SolarSystemBodyCode = '10' | '301' | '199' | '299' | '499' | '599' | '699' | '799' | '899' | '999'

// Stable identity of an object, independent of where it was found and of its time-dependent position.
export type SkyObjectRef =
	// Star or deep-sky object of the sky catalog, by its catalog id.
	| { readonly kind: 'catalog'; readonly id: number }
	// Sun, Moon, planet, or Pluto.
	| { readonly kind: 'body'; readonly code: SolarSystemBodyCode }
	// Asteroid or comet of the JPL Small-Body Database, by its SPK-ID, with the designation shown for it.
	| { readonly kind: 'minorBody'; readonly spkId: string; readonly designation: string }
	// IAU constellation, by its upper-case code such as "ORI", located at its label.
	| { readonly kind: 'constellation'; readonly code: string }
	// Artificial satellite of the satellite catalog, by its NORAD catalog number as canonical decimal digits.
	| { readonly kind: 'satellite'; readonly noradId: string }

// Group an object belongs to in search results and in the inspector.
export type SkyObjectCategory = 'star' | 'deepSky' | 'solarSystem' | 'minorBody' | 'constellation' | 'satellite'

// Object matched by a search.
export interface SkySearchResult {
	// Identity of the object.
	readonly ref: SkyObjectRef
	// Display name: the proper name or the preferred designation.
	readonly name: string
	// Other designations, most relevant first.
	readonly designations: readonly string[]
	// Group of the object.
	readonly category: SkyObjectCategory
	// Object type, such as "Galaxy" or "Planet".
	readonly typeName: string
	// Visual magnitude; absent when unknown.
	readonly magnitude?: number
	// IAU abbreviation of the constellation the catalog position lies in; absent for moving objects.
	readonly constellation?: string
}

// Catalog data of a star or deep-sky object. Coordinates are J2000 catalog values, never positions of date.
export interface SkyCatalogObject {
	// Catalog id.
	readonly id: number
	// Group of the object.
	readonly category: 'star' | 'deepSky'
	// Stellarium object type (StellariumObjectType).
	readonly type: number
	// Object type, such as "Open Star Cluster".
	readonly typeName: string
	// Display name.
	readonly name: string
	// Every other designation, most relevant first.
	readonly designations: readonly string[]
	// Right ascension at J2000 in radians.
	readonly rightAscension: number
	// Declination at J2000 in radians.
	readonly declination: number
	// Visual magnitude; absent when unknown.
	readonly magnitude?: number
	// B-V color index in magnitudes; absent when unknown.
	readonly bv?: number
	// Proper motion dα/dt in radians per Julian year.
	readonly pmRA: number
	// Proper motion in declination in radians per Julian year.
	readonly pmDEC: number
	// Distance in AU; absent when unknown.
	readonly distance?: number
	// Radial velocity in AU per day, positive receding.
	readonly rv: number
	// IAU abbreviation of the constellation, such as "CMa".
	readonly constellation: string
	// Full constellation name, such as "Canis Major".
	readonly constellationName: string
	// Spectral type of stars or morphological type of deep-sky objects; absent when unknown.
	readonly classification?: string
	// Apparent major axis in radians; absent when unknown.
	readonly majorAxis?: number
	// Apparent minor axis in radians; absent when unknown.
	readonly minorAxis?: number
	// Position angle of the major axis in radians, from north through east; absent when unknown.
	readonly orientation?: number
}

// Stars to render, as parallel arrays. Positions are referred to the true equator and equinox of `time`
// (precession, nutation, and proper motion applied), the frame the star map projects.
export interface SkyStarData {
	// Instant the positions were computed for, Unix milliseconds (UTC).
	readonly time: number
	// Catalog id of each star.
	readonly ids: readonly number[]
	// Proper name of each star; empty when it has none.
	readonly names: readonly string[]
	// Preferred catalog designation of each star (Bayer, Flamsteed, HIP, HD, or HR); empty when it has none.
	readonly designations: readonly string[]
	// Right ascension of each star in radians.
	readonly ra: readonly number[]
	// Declination of each star in radians.
	readonly dec: readonly number[]
	// Visual magnitude of each star.
	readonly mag: readonly number[]
	// B-V color index of each star in magnitudes; 0.65 when unknown.
	readonly bv: readonly number[]
}

// Deep-sky objects to render, as parallel arrays, in the same frame as SkyStarData.
export interface SkyDeepSkyData {
	// Instant the positions were computed for, Unix milliseconds (UTC).
	readonly time: number
	// Catalog id of each object.
	readonly ids: readonly number[]
	// Display name of each object.
	readonly names: readonly string[]
	// Stellarium object type of each object.
	readonly types: readonly number[]
	// Right ascension of each object in radians.
	readonly ra: readonly number[]
	// Declination of each object in radians.
	readonly dec: readonly number[]
	// Visual magnitude of each object; null when unknown.
	readonly mag: readonly (number | null)[]
	// Apparent major axis of each object in arcminutes; 0 when unknown.
	readonly size: readonly number[]
	// Name of each Stellarium object type, indexed by type.
	readonly typeNames: readonly string[]
}

// Constellation figures, boundaries, and labels. Vertices are [right ascension, declination] in
// radians, in the same frame as SkyStarData.
export interface SkyConstellations {
	// Instant the positions were computed for, Unix milliseconds (UTC).
	readonly time: number
	// Stick-figure polylines.
	readonly lines: readonly (readonly (readonly [number, number])[])[]
	// Boundary polylines.
	readonly boundaries: readonly (readonly (readonly [number, number])[])[]
	// Labels at the constellation centers, with the upper-case IAU code of their constellation (empty when
	// unknown).
	readonly labels: readonly { readonly name: string; readonly code: string; readonly rightAscension: number; readonly declination: number }[]
}

// Orbital element or physical parameter of a minor body, as published by SBDB.
export interface MinorBodyParameter {
	// SBDB parameter name, such as "e" or "H".
	readonly name: string
	// Human-readable title, such as "eccentricity".
	readonly title: string
	// Value as published.
	readonly value: string
	// Units of the value, when it has any.
	readonly units?: string
}

// Asteroid or comet of the JPL Small-Body Database.
export interface MinorBody {
	// SPK-ID, the stable identity of the body.
	readonly spkId: string
	// Primary designation, such as "1" or "1P".
	readonly designation: string
	// Full name, such as "1 Ceres (A801 AA)".
	readonly name: string
	// Kind of body.
	readonly kind: 'asteroid' | 'comet'
	// Whether the body is numbered.
	readonly numbered: boolean
	// Whether it is a near-Earth object.
	readonly neo: boolean
	// Whether it is a potentially hazardous asteroid.
	readonly pha: boolean
	// Orbit class, such as "Main-belt Asteroid".
	readonly orbitClass: string
	// Epoch of the osculating elements, Julian date (TDB); absent when SBDB does not publish one.
	readonly epoch?: number
	// Date of the orbit solution, as published.
	readonly solutionDate: string
	// Orbital elements and physical parameters.
	readonly parameters: readonly MinorBodyParameter[]
}

// Outcome of a minor body search: one body, several candidates to search again by designation, or none.
export type MinorBodySearchResponse = { readonly kind: 'found'; readonly body: MinorBody } | { readonly kind: 'ambiguous'; readonly matches: readonly { readonly designation: string; readonly name: string }[] } | { readonly kind: 'notFound'; readonly message: string }

// One value as SBDB publishes it, kept as text so no digit of the value or of its uncertainty is lost.
export interface MinorBodyPublishedValue {
	// Short name, such as "e" or "diameter".
	readonly name: string
	// Title of the value.
	readonly title: string
	// Value; absent when not published.
	readonly value?: string
	// 1-sigma uncertainty, in the units of the value; absent when not published.
	readonly sigma?: string
	// Units; absent for a dimensionless value.
	readonly units?: string
	// Reference of the value; absent when not published.
	readonly reference?: string
	// Notes of the value; absent when not published.
	readonly notes?: string
}

// Orbit solution of a minor body, as published.
export interface MinorBodyOrbitDetails {
	// Identifier of the solution.
	readonly orbitId: string
	// Epoch of the elements, Julian date (TDB) as published.
	readonly epoch: string
	// Epoch of the elements, TDB calendar date as published.
	readonly epochCalendar: string
	// Reference equinox and frame, such as "J2000".
	readonly equinox: string
	// Date of the solution, as published.
	readonly solutionDate: string
	// Author of the solution; absent when not published.
	readonly producer?: string
	// Source of the solution.
	readonly source: string
	// Date of the first observation used.
	readonly firstObservation: string
	// Date of the last observation used.
	readonly lastObservation: string
	// Span of the observations used, in days.
	readonly dataArc?: string
	// Optical observations used.
	readonly observations: number
	// Radar delay observations used; absent when none.
	readonly delayObservations?: number
	// Radar Doppler observations used; absent when none.
	readonly dopplerObservations?: number
	// Weighted RMS of the residuals of the fit, as published.
	readonly rms?: string
	// JPL condition code, 0 (best determined) to 9; absent when not published.
	readonly conditionCode?: string
	// Earth minimum orbit intersection distance in AU: a property of the two orbits, not of any encounter.
	readonly moid?: string
	// Jupiter minimum orbit intersection distance in AU.
	readonly moidJupiter?: string
	// Jupiter Tisserand invariant.
	readonly tisserandJupiter?: string
	// Planetary ephemeris of the solution, such as "DE441".
	readonly planetaryEphemeris?: string
	// Small-body perturbers of the solution, such as "SB441-N16".
	readonly smallBodyEphemeris?: string
	// Comment of the solution; absent when not published.
	readonly comment?: string
	// Last valid date of a solution of limited validity; absent when it has none.
	readonly notValidAfter?: string
	// Osculating elements.
	readonly elements: readonly MinorBodyPublishedValue[]
	// Fitted or assumed force-model parameters, such as non-gravitational accelerations.
	readonly model: readonly MinorBodyPublishedValue[]
}

// Earlier orbit solution of a comet.
export interface MinorBodyAlternateOrbit {
	// Identifier of the solution.
	readonly orbitId: string
	// Epoch of the elements, TDB calendar date as published.
	readonly epochCalendar: string
	// Date of the first observation used.
	readonly firstObservation: string
	// Date of the last observation used.
	readonly lastObservation: string
}

// Discovery circumstances, as published; a field is absent when SBDB does not give it.
export interface MinorBodyDiscovery {
	// Date of the discovery.
	readonly date?: string
	// Place of the discovery.
	readonly location?: string
	// Discoverers.
	readonly who?: string
	// Narrative of the discovery.
	readonly narrative?: string
	// Citation of the name.
	readonly citation?: string
}

// Radar astrometry measurement.
export interface MinorBodyRadarObservation {
	// UTC epoch of the measurement.
	readonly epoch: string
	// Measured delay or Doppler shift, in `units`.
	readonly value: string
	// 1-sigma uncertainty, in `units`.
	readonly sigma?: string
	// Units: us for a delay, Hz for a Doppler shift.
	readonly units: string
	// Transmitter frequency in MHz.
	readonly frequency?: string
	// Observer of the measurement.
	readonly observer?: string
}

// Known satellite of a body.
export interface MinorBodySatellite {
	// Full name.
	readonly name: string
	// Provisional designation.
	readonly designation?: string
	// Whether the satellite is confirmed.
	readonly confirmed: boolean
	// Reference of the discovery.
	readonly reference?: string
}

// Virtual impactor of the JPL Sentry risk table, as published through SBDB; never computed here.
export interface MinorBodyVirtualImpactor {
	// Date of the potential impact, TDB calendar day with a decimal fraction.
	readonly date: string
	// Impact probability, as published.
	readonly probability: string
	// Palermo scale, as published.
	readonly palermo?: string
	// Torino scale, as published.
	readonly torino?: string
}

// What SBDB publishes about a body beyond MinorBody. A block SBDB has nothing for is empty or absent.
export interface MinorBodyDetails {
	// Other designations of the body.
	readonly alternateDesignations: readonly string[]
	// Orbit class code, such as "ATE".
	readonly orbitClassCode: string
	// Current orbit solution.
	readonly orbit: MinorBodyOrbitDetails
	// Earlier orbit solutions, of comets.
	readonly alternateOrbits: readonly MinorBodyAlternateOrbit[]
	// Measured physical parameters.
	readonly physical: readonly MinorBodyPublishedValue[]
	// Discovery circumstances.
	readonly discovery?: MinorBodyDiscovery
	// Radar astrometry.
	readonly radar: readonly MinorBodyRadarObservation[]
	// Known satellites.
	readonly satellites: readonly MinorBodySatellite[]
	// Virtual impactors; empty says only that SBDB lists none, never that the risk is zero.
	readonly virtualImpactors: readonly MinorBodyVirtualImpactor[]
	// Source of the data.
	readonly source: string
	// Format version of the source.
	readonly sourceVersion: string
	// When the data was read from SBDB, Unix milliseconds.
	readonly fetchedAt: number
}

// Outcome of asking for a body by designation: the body, several candidates to choose from, or none.
export type MinorBodyDetailsResponse = { readonly kind: 'found'; readonly body: MinorBody; readonly details: MinorBodyDetails } | { readonly kind: 'ambiguous'; readonly matches: readonly { readonly designation: string; readonly name: string }[] } | { readonly kind: 'notFound'; readonly message: string }

// Position of a major body for drawing it on the map.
export interface SkyBodyPosition {
	// Horizons command.
	readonly code: SolarSystemBodyCode
	// Kind of body, which selects its map symbol.
	readonly kind: 'sun' | 'moon' | 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto'
	// Display name.
	readonly name: string
	// Apparent right ascension of date in radians.
	readonly rightAscension: number
	// Apparent declination of date in radians.
	readonly declination: number
	// Apparent visual magnitude; absent when unknown.
	readonly magnitude?: number
}

// Body of POST /api/sky/position.
export interface SkyPositionRequest {
	// Object to locate.
	readonly target: SkyObjectRef
	// Instant, Unix milliseconds (UTC).
	readonly time: number
	// Observer; the geocenter when absent, which also omits azimuth, altitude, and events.
	readonly observer?: SkyObserver
	// `accurate` (default) asks Horizons first for solar-system objects; `fast` is local only.
	readonly mode?: EphemerisMode
}

// Response of POST /api/sky/position.
export interface SkyPositionResponse {
	// Position at the requested instant.
	readonly position: SkyPosition
	// Rise, transit, and set; absent without an observer or without a local model. Computed locally in both modes.
	readonly events?: SkyEvents
}

// Body of POST /api/sky/bodies.
export interface SkyBodiesRequest {
	// Instant, Unix milliseconds (UTC).
	readonly time: number
	// Observer; the geocenter when absent.
	readonly observer?: SkyObserver
}

// IAU constellation, located at its label: a fixed J2000 point near its center, without proper motion,
// distance, or radial velocity.
export interface SkyConstellation {
	// Upper-case IAU code, such as "ORI".
	readonly code: string
	// IAU abbreviation, such as "Ori".
	readonly abbreviation: string
	// Name, such as "Orion".
	readonly name: string
	// Genitive, such as "Orionis".
	readonly genitive: string
	// Right ascension of the label at J2000 in radians.
	readonly rightAscension: number
	// Declination of the label at J2000 in radians.
	readonly declination: number
}
