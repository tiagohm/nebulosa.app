import { orbitCenter } from 'nebulosa/src/astronomy/orbits/mechanics'
import { AU_KM, DEG2RAD } from 'nebulosa/src/core/constants'
import type { OrbitDefinitionPayload } from './orbitalmechanics'

// Built-in scenarios of the Orbital Mechanics Explorer. An illustrative scenario is an invented orbit chosen to show one
// kind of conic; a sourced one reproduces published elements at their own epoch and cites them. Neither is a live or
// precise ephemeris: each is a two-body model, whose divergence from the real motion grows away from its epoch.

// Julian date TDB of J2000.0, the epoch of the illustrative scenarios.
const J2000_JD = 2451545

// Where the elements of a scenario come from.
export type OrbitPresetSource = { readonly kind: 'illustrative' } | { readonly kind: 'sourced'; readonly citation: string; readonly url: string }

// A built-in scenario.
export interface OrbitPreset {
	// Stable identifier.
	readonly id: string
	// Name shown.
	readonly name: string
	// What the scenario shows.
	readonly description: string
	// Where its elements come from.
	readonly source: OrbitPresetSource
	// NAIF ID of its center, one of the toolkit's DE440 centers.
	readonly center: number
	// The orbit, with the center's gravitational parameter.
	readonly definition: OrbitDefinitionPayload
}

// Gravitational parameter (AU³/day²) of a toolkit center.
function mu(code: number) {
	return orbitCenter(code)!.mu
}

// Radians of an angle in degrees.
function rad(degrees: number) {
	return degrees * DEG2RAD
}

// Every built-in scenario, in the order the tool lists them.
export const ORBITAL_MECHANICS_PRESETS: readonly OrbitPreset[] = [
	{
		id: 'circular-leo',
		name: 'Circular low Earth orbit',
		description: 'A circular orbit 400 km above the Earth inclined 51.6°, with a period of about 92 minutes.',
		source: { kind: 'illustrative' },
		center: 399,
		definition: { kind: 'elliptic', mu: mu(399), plane: 'equator', semiMajorAxis: 6778.14 / AU_KM, eccentricity: 0, inclination: rad(51.6), node: rad(40), argumentOfPeriapsis: 0, meanAnomaly: 0, epoch: J2000_JD },
	},
	{
		id: 'molniya',
		name: 'Molniya-type orbit',
		description: 'A half-day orbit of eccentricity 0.74 inclined 63.4°, with its apogee high over the northern hemisphere.',
		source: { kind: 'illustrative' },
		center: 399,
		definition: { kind: 'elliptic', mu: mu(399), plane: 'equator', semiMajorAxis: 26_600 / AU_KM, eccentricity: 0.74, inclination: rad(63.4), node: rad(80), argumentOfPeriapsis: rad(270), meanAnomaly: 0, epoch: J2000_JD },
	},
	{
		id: 'retrograde',
		name: 'Retrograde orbit',
		description: 'A slightly eccentric orbit inclined 120°, moving against the Earth’s rotation.',
		source: { kind: 'illustrative' },
		center: 399,
		definition: { kind: 'elliptic', mu: mu(399), plane: 'equator', semiMajorAxis: 12_000 / AU_KM, eccentricity: 0.1, inclination: rad(120), node: rad(30), argumentOfPeriapsis: rad(45), meanAnomaly: 0, epoch: J2000_JD },
	},
	{
		id: 'highly-eccentric',
		name: 'Highly eccentric orbit',
		description: 'A heliocentric orbit of eccentricity 0.95 whose motion races through perihelion and crawls at aphelion.',
		source: { kind: 'illustrative' },
		center: 10,
		definition: { kind: 'elliptic', mu: mu(10), plane: 'ecliptic', semiMajorAxis: 10, eccentricity: 0.95, inclination: rad(30), node: rad(60), argumentOfPeriapsis: rad(120), meanAnomaly: rad(350), epoch: J2000_JD },
	},
	{
		id: 'near-parabolic',
		name: 'Near-parabolic orbit',
		description: 'A bound orbit of eccentricity 0.999 with its perihelion at 1 AU: an aphelion near 2000 AU and a period of about 31 600 years.',
		source: { kind: 'illustrative' },
		center: 10,
		definition: { kind: 'elliptic', mu: mu(10), plane: 'ecliptic', semiMajorAxis: 1000, eccentricity: 0.999, inclination: rad(45), node: rad(100), argumentOfPeriapsis: rad(30), meanAnomaly: 0, epoch: J2000_JD },
	},
	{
		id: 'parabolic',
		name: 'Parabolic orbit',
		description: 'An orbit of eccentricity exactly 1 with its perihelion at 0.8 AU: zero energy, no period, and no semi-major axis.',
		source: { kind: 'illustrative' },
		center: 10,
		definition: { kind: 'parabolic', mu: mu(10), plane: 'ecliptic', periapsisDistance: 0.8, inclination: rad(60), node: rad(200), argumentOfPeriapsis: rad(90), periapsisTime: J2000_JD + 50 },
	},
	{
		id: 'hyperbolic',
		name: 'Hyperbolic flyby',
		description: 'An unbound orbit of eccentricity 1.5 with its perihelion at 0.5 AU, leaving the Sun for good.',
		source: { kind: 'illustrative' },
		center: 10,
		definition: { kind: 'hyperbolic', mu: mu(10), plane: 'ecliptic', periapsisDistance: 0.5, eccentricity: 1.5, inclination: rad(20), node: rad(300), argumentOfPeriapsis: rad(150), periapsisTime: J2000_JD + 30 },
	},
	{
		id: 'earth-moon-barycenter',
		name: 'Earth–Moon barycenter (J2000 mean elements)',
		description: 'The mean heliocentric orbit of the Earth–Moon barycenter at J2000, from the approximate elements of Standish, valid 1800–2050. The table gives I = −0.00001531° with the node at 0°, written here as the same plane with I > 0 and the node at 180°.',
		source: { kind: 'sourced', citation: 'Standish & Williams (1992), Keplerian elements for approximate positions of the major planets, Table 1 (JPL SSD)', url: 'https://ssd.jpl.nasa.gov/planets/approx_pos.html' },
		center: 10,
		// a = 1.00000261 AU, e = 0.01671123, L = 100.46457166°, ϖ = 102.93768193°: ω = ϖ − Ω and M = L − ϖ.
		definition: { kind: 'elliptic', mu: mu(10), plane: 'ecliptic', semiMajorAxis: 1.00000261, eccentricity: 0.01671123, inclination: rad(0.00001531), node: rad(180), argumentOfPeriapsis: rad(102.93768193 - 180 + 360), meanAnomaly: rad(100.46457166 - 102.93768193 + 360), epoch: J2000_JD },
	},
	{
		id: '1p-halley',
		name: '1P/Halley (JPL solution 75)',
		description: 'The osculating heliocentric orbit of comet 1P/Halley published by JPL SBDB, orbit solution 75 of 2025-11-21, at its epoch of 1968-Jan-20 TDB. Planetary perturbations make it drift from the comet’s real motion away from that epoch.',
		source: { kind: 'sourced', citation: 'JPL Small-Body Database, 1P/Halley, orbit solution 75 (2025-11-21), J2000 ecliptic', url: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=1P' },
		center: 10,
		definition: {
			kind: 'elliptic',
			mu: mu(10),
			plane: 'ecliptic',
			semiMajorAxis: 17.92863504856923,
			eccentricity: 0.9679359956953211,
			inclination: rad(162.1905300439129),
			node: rad(59.09894720612437),
			argumentOfPeriapsis: rad(112.2414314637764),
			meanAnomaly: rad(274.3823371366792),
			epoch: 2439875.5,
		},
	},
]
