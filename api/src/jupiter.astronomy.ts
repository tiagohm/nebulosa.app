import { analyticalJovianEphemeris, GALILEAN_MOONS, type GalileanMoon, interpolatedJovianEphemeris, JOVIAN_BODIES, JOVIAN_NAIF, type JovianBody, type JovianEphemeris, JovianEphemerisMiss, spkJovianEphemeris } from 'nebulosa/src/astronomy/ephemeris/jovian'
import { greatRedSpotLongitude, type GreatRedSpotModel, greatRedSpotTransitsWithDrift, jupiterCentralMeridian } from 'nebulosa/src/astronomy/events/jupiter'
import { type JovianDiskState, type JovianEclipseState, type JovianMoonMargins, jovianMoonMargins, jovianSystemState, jovianView, projectJovianSurfacePoint } from 'nebulosa/src/astronomy/events/jupiter.geometry'
import { type JovianPhenomenon, type JovianPhenomenonKind, jovianPhenomena } from 'nebulosa/src/astronomy/events/jupiter.phenomena'
import { findGalileanMutualEvents, type MutualEvent } from 'nebulosa/src/astronomy/events/mutual'
import { precessionNutationMatrix, type Time, tdb, timeShift, timeToUnixMillis } from 'nebulosa/src/astronomy/time/time'
import { DEG2RAD, JUPITER_EQUATORIAL_RADIUS_AU } from 'nebulosa/src/core/constants'
import { type Vec3, vecCross, vecDot, vecMinus, vecNormalize } from 'nebulosa/src/math/linear-algebra/vec3'
import { brentRoot } from 'nebulosa/src/math/numerical/optimization'
import { normalizePI } from 'nebulosa/src/math/units/angle'
import type { AstroWeatherNight, AstroWeatherNightRequest } from './astroweather.night'
import type { JupiterGrsModel } from './jupiter.store'
import type { PlanningSite } from './observingplanner.astronomy'
// oxfmt-ignore
import { kernelReadiness as planetaryReadiness, type PlanetaryFallbackReason, type PlanetaryKernels, type PlanetarySource, type PlanetarySourceMiss, PlanetarySourceUnavailableError, type SatelliteSourceConfig, type SourcedResult as PlanetarySourcedResult, toolkitTime, withSatelliteSource, yieldToEventLoop } from './planetary.source'
// oxfmt-ignore
import { definedContacts, type HiddenIntervals, hiddenIntervals, type MoonEventContacts, overlapsOf, physicallyVisible, type PlanetEventVisibility, type PlanetNight, type PlanetVisibilityStatus, rank, siteNights, type SiteReasons, siteVisibility, unixMillisOf, type VisiblePart } from './planetary.visibility'
import type { TimeSpan } from './sky/sun'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'
import type { SpiceEphemerisPolicy } from './spicekernels.store'

// Astronomy of the Jupiter Observing Planner: the apparent view of Jupiter and its Galilean satellites at an instant, the
// sampled tracks of the satellites, and the phenomena over a range (Great Red Spot transits, satellite transits, shadow
// transits, occultations, eclipses, and mutual events) with their visibility from a site. Every computation takes all its
// states from one source chosen once with the shared orchestration of planetary.source.ts: the kernels of the SPICE
// Kernel Library when they resolve every Jovian body, else the analytical VSOP87E + L1.2 theories, unless the ephemeris
// policy is spkOnly, which fails instead; sources are never mixed and Horizons is never asked. Long computations run in
// chunks that restart when the kernel generation changed. Phenomena are geocentric; a site only decides when they can be
// watched (planetary.visibility.ts), with the planetary constraints of the Observing Planner on Jupiter's own altitude,
// which is a separate question from the phenomena. Angles are radians and times Unix milliseconds (UTC).

// NAIF code of Jupiter's centre in the Observing Planner's planning bodies.
const JUPITER_CODE = '599'

// Version of the Jupiter prediction model; changes whenever the meaning of a computed field changes.
export const JUPITER_MODEL_VERSION = 1

// Kind of Jupiter event.
export type JupiterEventKind = 'grsTransit' | JovianPhenomenonKind | 'mutualOccultation' | 'mutualEclipse'

// Every Jupiter event kind, in display order.
export const JUPITER_EVENT_KINDS: readonly JupiterEventKind[] = ['grsTransit', 'satelliteTransit', 'shadowTransit', 'satelliteOccultation', 'satelliteEclipse', 'mutualOccultation', 'mutualEclipse']

// Why the analytical theories were used instead of the kernels (see PlanetaryFallbackReason).
export type JupiterFallbackReason = PlanetaryFallbackReason

// The kernel state that could not be resolved.
export type JupiterSourceMiss = PlanetarySourceMiss<JovianBody>

// The analytical theories of a Jupiter computation.
interface AnalyticalJupiterSource {
	readonly kind: 'analytical'
	// Planetary theory of the Sun, the Earth and Jupiter.
	readonly planetary: 'VSOP87E'
	// Satellite theory of the Galilean moons.
	readonly satellites: 'L1.2'
}

// Source of the states of a computation.
export type JupiterSource = PlanetarySource<JovianBody, AnalyticalJupiterSource>

// Identity of a computed result: the model, its source, and the inputs that change it.
export interface JupiterSignature {
	// Version of the prediction model.
	readonly modelVersion: number
	// Source of the states.
	readonly source: JupiterSource
	// Ephemeris policy of the SPICE Kernel Library.
	readonly policy: SpiceEphemerisPolicy
	// Generation of the kernel set the source was chosen from.
	readonly generation: number
	// Revision of the Great Red Spot model used; absent when none was.
	readonly grsRevision?: number
}

// Thrown when the ephemeris policy is spkOnly and the kernels cannot give a whole computation, or when the kernel set
// kept changing during one.
export class JupiterSourceUnavailableError extends PlanetarySourceUnavailableError<JovianBody> {
	constructor(reason: JupiterFallbackReason | 'generationChanged', miss?: JupiterSourceMiss) {
		super(reason === 'generationChanged' ? 'The SPICE kernels changed during the computation' : `The SPICE kernels cannot give the Jovian states (${reason})`, reason, miss)
	}
}

// Live kernel snapshots of the SPICE Kernel Library.
export type JupiterKernels = PlanetaryKernels

// How the Jovian system is evaluated from the kernels or the VSOP87E + L1.2 theories.
const JOVIAN_SOURCE: SatelliteSourceConfig<JovianBody, JovianEphemeris, AnalyticalJupiterSource> = {
	naif: JOVIAN_NAIF,
	analytical: analyticalJovianEphemeris,
	analyticalSource: { kind: 'analytical', planetary: 'VSOP87E', satellites: 'L1.2' },
	spk: spkJovianEphemeris,
	miss: JovianEphemerisMiss,
	unavailable: (reason, miss) => new JupiterSourceUnavailableError(reason, miss),
}

// Result of a computation and the source it used.
export type SourcedResult<T> = PlanetarySourcedResult<JovianBody, AnalyticalJupiterSource, T>

// Runs `count` chunks of a computation over every Jovian body with one source for all of them (see
// withSatelliteSource): the kernels when they resolve every Jovian body, else VSOP87E + L1.2, or
// JupiterSourceUnavailableError under spkOnly. `interpolate` wraps the source for dense sampling; a single instant is
// evaluated directly.
export function withJovianSource<T>(kernels: JupiterKernels, count: number, chunk: (ephemeris: JovianEphemeris, index: number) => T, interpolate: boolean, signal?: AbortSignal): Promise<SourcedResult<T>> {
	return withSatelliteSource(kernels, JOVIAN_SOURCE, JOVIAN_BODIES, count, chunk, interpolate ? interpolatedJovianEphemeris : undefined, signal)
}

// Great Red Spot model of the toolkit from the stored model.
function grsModel(model: JupiterGrsModel): GreatRedSpotModel {
	return { longitude: model.longitude, epoch: toolkitTime(model.referenceTime), drift: model.drift }
}

// Days beyond which a Great Red Spot reference is stale: the drift is then extrapolated over more than two months.
export const GRS_STALE_DAYS = 60

// Planetographic latitude at which the Great Red Spot marker is drawn (22° S): a schematic assumption for display only,
// since the spot's latitude and outline are observed quantities the planner does not predict.
export const GRS_SCHEMATIC_LATITUDE = -22 * DEG2RAD

// Default half-width of the Great Red Spot viewing window around a transit: the spot within 30° of the central meridian.
export const GRS_VIEWING_HALF_WIDTH = 30 * DEG2RAD

// Quality of the Great Red Spot model for a computation.
export type JupiterGrsQuality = 'unconfigured' | 'current' | 'stale'

// Great Red Spot model state relative to an instant.
export interface JupiterGrsStatus {
	// Whether a model exists and whether its reference is within GRS_STALE_DAYS of the instant.
	readonly quality: JupiterGrsQuality
	// Days from the reference instant to the instant; absent without a model.
	readonly referenceAgeDays?: number
	// Revision of the model, 0 without one.
	readonly revision: number
}

// Status of a Great Red Spot model at an instant (Unix milliseconds).
export function grsStatus(model: JupiterGrsModel | undefined, revision: number, time: number): JupiterGrsStatus {
	if (!model) return { quality: 'unconfigured', revision }
	const referenceAgeDays = (time - model.referenceTime) / 86_400_000
	return { quality: Math.abs(referenceAgeDays) > GRS_STALE_DAYS ? 'stale' : 'current', referenceAgeDays, revision }
}

// The disk of Jupiter at an instant.
export interface JupiterDisk {
	// Geocentric distance of Jupiter's centre, AU.
	readonly distance: number
	// Apparent equatorial angular radius.
	readonly equatorialRadius: number
	// Apparent polar angular semi-axis of the outline.
	readonly polarRadius: number
	// Position angle of the projected north pole, from the true celestial north toward the east, in (−π, π].
	readonly poleAngle: number
	// Planetocentric latitude of the sub-Earth point.
	readonly subEarthLatitude: number
	// Planetocentric latitude of the sub-solar point.
	readonly subSolarLatitude: number
	// Sun–Jupiter–Earth phase angle.
	readonly phaseAngle: number
	// West-positive central-meridian longitudes in Systems I, II and III, in [0, 2π).
	readonly centralMeridian: Readonly<Record<'I' | 'II' | 'III', number>>
}

// One moon at an instant. Offsets are in apparent equatorial radii of Jupiter.
export interface JupiterMoonState {
	readonly moon: GalileanMoon
	// Sky offset from Jupiter's apparent centre toward the east.
	readonly east: number
	// Sky offset toward the true celestial north.
	readonly north: number
	// Line-of-sight distance in front of Jupiter's centre, in equatorial radii: positive toward the Earth.
	readonly depth: number
	// Apparent radius of the moon.
	readonly radius: number
	// Whether any part overlaps the disk, in front or behind.
	readonly disk: JovianDiskState
	// Whether any part is in Jupiter's penumbra or umbra.
	readonly eclipse: JovianEclipseState
	// Centre of the moon's shadow on Jupiter, when its axis meets the planet.
	readonly shadow?: { readonly east: number; readonly north: number; readonly visible: boolean }
}

// The schematic Great Red Spot marker at an instant.
export interface JupiterGrsMarker {
	// System II west longitude of the spot from the model.
	readonly longitude: number
	// Planetographic latitude the marker is drawn at (GRS_SCHEMATIC_LATITUDE).
	readonly latitude: number
	// Sky offset toward the east, in apparent equatorial radii of Jupiter.
	readonly east: number
	// Sky offset toward the north, in apparent equatorial radii of Jupiter.
	readonly north: number
	// Whether the spot faces the Earth.
	readonly visible: boolean
}

// Request of the view at an instant.
export interface JupiterStateRequest {
	// Observed instant, Unix milliseconds.
	readonly time: number
}

// View of Jupiter and its moons at an instant.
export interface JupiterState {
	// Observed instant, Unix milliseconds.
	readonly time: number
	readonly disk: JupiterDisk
	// The four moons, in orbital order.
	readonly moons: readonly JupiterMoonState[]
	// Great Red Spot marker; absent without a model.
	readonly grs?: JupiterGrsMarker
	// Great Red Spot model state at the instant.
	readonly grsStatus: JupiterGrsStatus
	readonly signature: JupiterSignature
}

// Computes the view of Jupiter and its moons at an instant with one source, from the toolkit's apparent geometry, with
// the schematic Great Red Spot marker when a model is given.
export function computeState(ephemeris: JovianEphemeris, time: number, model: JupiterGrsModel | undefined): Omit<JupiterState, 'signature' | 'grsStatus'> {
	const view = jovianView(ephemeris, toolkitTime(time))
	const moons = view.moons.map(({ moon, east, north, depth, radius, disk, eclipse, shadow }): JupiterMoonState => ({ moon, east, north, depth, radius, disk, eclipse, ...(shadow && { shadow }) }))
	const { distance, equatorialRadius, polarRadius, poleAngle, subEarthLatitude, subSolarLatitude, phaseAngle, centralMeridian } = view
	const disk: JupiterDisk = { distance, equatorialRadius, polarRadius, poleAngle, subEarthLatitude, subSolarLatitude, phaseAngle, centralMeridian }
	if (!model) return { time, disk, moons }

	const grs = grsModel(model)
	const longitude = greatRedSpotLongitude(grs, view.time)
	const marker = projectJovianSurfacePoint(view, longitude, GRS_SCHEMATIC_LATITUDE)
	return { time, disk, moons, grs: { longitude, latitude: GRS_SCHEMATIC_LATITUDE, ...marker } }
}

// Most samples of one moon in a track.
export const TRACK_MAX_SAMPLES = 2000

// Shortest spacing of track samples, in milliseconds (one minute).
const TRACK_MIN_STEP_MS = 60_000

// Samples of a track computed between two yields.
const TRACK_CHUNK_SAMPLES = 250

// Request of the satellite tracks over a range.
export interface JupiterTrackRequest {
	// First instant, Unix milliseconds.
	readonly start: number
	// Last instant, Unix milliseconds.
	readonly end: number
}

// One moon over a track, one value per sample.
export interface JupiterTrackMoon {
	// Sky offsets toward the east, in apparent equatorial radii of Jupiter.
	readonly east: readonly number[]
	// Sky offsets toward the true celestial north, in apparent equatorial radii of Jupiter.
	readonly north: readonly number[]
	// Line-of-sight distances in front of Jupiter's centre, in equatorial radii.
	readonly depth: readonly number[]
	// Disk states.
	readonly disk: readonly JovianDiskState[]
	// Eclipse states.
	readonly eclipse: readonly JovianEclipseState[]
}

// Sampled tracks of the moons over a range: the exact geometry at each sample, for display and interpolation only.
export interface JupiterTrack {
	// First sample, Unix milliseconds.
	readonly start: number
	// Spacing of the samples, milliseconds: a whole number of minutes chosen so a moon has at most TRACK_MAX_SAMPLES.
	readonly step: number
	// Instants of the samples, Unix milliseconds.
	readonly times: readonly number[]
	// Each moon's samples.
	readonly moons: Readonly<Record<GalileanMoon, JupiterTrackMoon>>
	readonly signature: JupiterSignature
}

// Spacing of the samples of a track over [start, end], milliseconds.
export function trackStep(start: number, end: number) {
	return Math.max(TRACK_MIN_STEP_MS, Math.ceil((end - start) / (TRACK_MAX_SAMPLES - 1) / TRACK_MIN_STEP_MS) * TRACK_MIN_STEP_MS)
}

// Sky basis on the true equator of the middle of a track: east and north unit vectors at a line of sight.
function skyBasis(truePole: Vec3, lineOfSight: Vec3) {
	const east = vecNormalize(vecCross(truePole, lineOfSight))
	return { east, north: vecCross(lineOfSight, east) }
}

// Disk state of a moon from its margins.
function diskState(margins: JovianMoonMargins): JovianDiskState {
	return margins.disk.distance < margins.disk.radius ? (margins.disk.front ? 'transit' : 'occulted') : 'clear'
}

// Eclipse state of a moon from its margins.
function eclipseState({ eclipse }: JovianMoonMargins): JovianEclipseState {
	if (!eclipse.valid) return 'none'
	return eclipse.umbraDistance < eclipse.radius ? 'umbra' : eclipse.penumbraDistance < eclipse.radius ? 'penumbra' : 'none'
}

// One moon's samples of a track being filled.
interface TrackMoonSamples {
	readonly east: number[]
	readonly north: number[]
	readonly depth: number[]
	readonly disk: JovianDiskState[]
	readonly eclipse: JovianEclipseState[]
}

// Empty samples of every moon.
function emptyTrack(): Record<GalileanMoon, TrackMoonSamples> {
	const empty = (): TrackMoonSamples => ({ east: [], north: [], depth: [], disk: [], eclipse: [] })
	return { io: empty(), europa: empty(), ganymede: empty(), callisto: empty() }
}

// Computes one chunk of a track: the samples at `times` (Unix milliseconds), on the sky axes of the true equator
// whose pole is `truePole` (unit, ICRF).
export function computeTrackChunk(ephemeris: JovianEphemeris, times: readonly number[], truePole: Vec3): Record<GalileanMoon, TrackMoonSamples> {
	const out = emptyTrack()

	for (const time of times) {
		const state = jovianSystemState(ephemeris, toolkitTime(time))
		const { east, north } = skyBasis(truePole, state.lineOfSight)

		for (const moon of GALILEAN_MOONS) {
			const margins = jovianMoonMargins(ephemeris, state, moon)
			const direction = vecMinus(margins.disk.position, state.earth)
			const depth = vecDot(direction, state.lineOfSight)
			const scale = state.distance / (depth * JUPITER_EQUATORIAL_RADIUS_AU)
			const track = out[moon]
			track.east.push(vecDot(direction, east) * scale)
			track.north.push(vecDot(direction, north) * scale)
			track.depth.push((state.distance - depth) / JUPITER_EQUATORIAL_RADIUS_AU)
			track.disk.push(diskState(margins))
			track.eclipse.push(eclipseState(margins))
		}
	}

	return out
}

// Computes the satellite tracks over a range with one source, in chunks of TRACK_CHUNK_SAMPLES samples.
export async function computeTrack(kernels: JupiterKernels, { start, end }: JupiterTrackRequest, signal?: AbortSignal): Promise<Omit<JupiterTrack, 'signature'> & { readonly sourced: Omit<SourcedResult<unknown>, 'results'> }> {
	const step = trackStep(start, end)
	const times: number[] = []
	for (let time = start; time <= end; time += step) times.push(time)

	const pnm = precessionNutationMatrix(toolkitTime((start + end) / 2))
	const truePole: Vec3 = [pnm[6], pnm[7], pnm[8]]
	const chunks = Math.max(1, Math.ceil(times.length / TRACK_CHUNK_SAMPLES))
	const { results, source, snapshot } = await withJovianSource(kernels, chunks, (ephemeris, i) => computeTrackChunk(ephemeris, times.slice(i * TRACK_CHUNK_SAMPLES, (i + 1) * TRACK_CHUNK_SAMPLES), truePole), true, signal)

	const moons = emptyTrack()

	for (const result of results) {
		for (const moon of GALILEAN_MOONS) {
			const from = result[moon]
			const into = moons[moon]
			into.east.push(...from.east)
			into.north.push(...from.north)
			into.depth.push(...from.depth)
			into.disk.push(...from.disk)
			into.eclipse.push(...from.eclipse)
		}
	}

	return { start, step, times, moons, sourced: { source, snapshot } }
}

// Contacts of an event, Unix milliseconds; each only where it is computed and reached (see the toolkit's
// JovianPhenomenon). A mutual event has only external1 and external2; a Great Red Spot transit has none.
export type JupiterEventContacts = MoonEventContacts

// Whether an event can be watched from the site.
export type JupiterVisibilityStatus = PlanetVisibilityStatus

// Why an event, or part of it, cannot be watched from the site:
// - sunTooHigh: the Sun is above the planetary limit (−6°); jupiterTooLow: Jupiter is below the planetary minimum (25°);
// - moonHidden: a participating moon is behind Jupiter or in its shadow; shadowHidden: a shadow faces away from the Earth.
export type JupiterVisibilityReason = 'sunTooHigh' | 'jupiterTooLow' | 'moonHidden' | 'shadowHidden'

// Visibility of an event from the site.
export type JupiterEventVisibility = PlanetEventVisibility<JupiterVisibilityReason>

// Reason codes of Jupiter's site limits.
const SITE_REASONS: SiteReasons<JupiterVisibilityReason> = { sunTooHigh: 'sunTooHigh', planetTooLow: 'jupiterTooLow' }

// The Great Red Spot of a transit.
export interface JupiterGrsTransit {
	// System II west longitude of the spot at the transit.
	readonly longitude: number
	// Days from the model's reference instant to the transit.
	readonly referenceAgeDays: number
	// Half-width of the viewing window around the central meridian.
	readonly halfWidth: number
}

// One Jupiter event.
export interface JupiterEvent {
	// Stable identity: the kind, the participants, and the maximum to the second.
	readonly id: string
	readonly kind: JupiterEventKind
	// Moons taking part: one for a satellite phenomenon, [front, back] for a mutual event, none for the Great Red Spot.
	readonly moons: readonly GalileanMoon[]
	// First instant of the event: its external contact, or the start of the viewing window of a Great Red Spot transit;
	// the maximum when the contact was not found.
	readonly start: number
	// Maximum: the conjunction, the mutual event's middle, or the Great Red Spot's central-meridian crossing.
	readonly maximum: number
	// Last instant of the event, as start.
	readonly end: number
	readonly contacts: JupiterEventContacts
	// Whether the event starts before the requested range.
	readonly startsBeforeRange: boolean
	// Whether the event ends after the requested range.
	readonly endsAfterRange: boolean
	// Whether a satellite phenomenon is a zero-duration tangency.
	readonly grazing: boolean
	// Deepest external margin of a satellite phenomenon, in Jupiter radii (negative).
	readonly depth?: number
	// Impact parameter of a mutual event, in [0, 1): 0 central, near 1 grazing.
	readonly impactParameter?: number
	// The Great Red Spot of a transit.
	readonly grs?: JupiterGrsTransit
	// Ids of the other events whose intervals intersect this one.
	readonly overlaps: readonly string[]
	readonly visibility: JupiterEventVisibility
}

// Request of the events over a range.
export interface JupiterEventsRequest {
	// First instant of the range, Unix milliseconds.
	readonly start: number
	// End of the range, exclusive, Unix milliseconds.
	readonly end: number
	// Site whose visibility is evaluated; absent for global predictions only.
	readonly site?: PlanningSite
	// Kinds returned; every kind when absent.
	readonly kinds?: readonly JupiterEventKind[]
	// Moons whose events are returned (a mutual event when either moon is selected); every moon when absent.
	readonly moons?: readonly GalileanMoon[]
}

// A night of the site over the range, with Jupiter's watchable windows.
export type JupiterNight = PlanetNight

// Events over a range.
export interface JupiterEvents {
	// First instant of the range, Unix milliseconds.
	readonly start: number
	// End of the range, exclusive, Unix milliseconds.
	readonly end: number
	// Events overlapping the range, chronologically by maximum.
	readonly events: readonly JupiterEvent[]
	// Nights of the site over the range; empty without a site.
	readonly nights: readonly JupiterNight[]
	// Great Red Spot model state at the start of the range.
	readonly grsStatus: JupiterGrsStatus
	readonly signature: JupiterSignature
}

// Days the event scan reaches beyond each end of the range, so an event overlapping the range whose maximum lies outside
// it is found: longer than half of the longest phenomenon (a Callisto eclipse, ~4.7 hours).
const EVENT_PAD_DAYS = 0.25

// Span of one chunk of the event scan, in days.
const EVENT_CHUNK_DAYS = 1

// Step of the Great Red Spot transit search, in days: one hour, far under half a System II rotation.
const GRS_STEP_DAYS = 1 / 24

// Span searched on each side of a Great Red Spot transit for its viewing-window edges, in days (~87° of rotation).
const GRS_WINDOW_SEARCH_DAYS = 0.1

// Events whose visibility is evaluated between two yields to the event loop.
const VISIBILITY_YIELD_EVERY = 10

// Raw events of one chunk of the scan, before the window and visibility are applied.
interface ChunkEvents {
	readonly phenomena: readonly JovianPhenomenon[]
	readonly mutual: readonly MutualEvent<GalileanMoon>[]
	readonly grs: readonly { readonly maximum: number; readonly start: number; readonly end: number; readonly longitude: number }[]
}

// Scans one chunk [from, to) of the range: the satellite phenomena, the mutual events, and the Great Red Spot transits
// whose maximum falls in it, all from `ephemeris`. The searches run in TDB, so the many epochs they derive by shifting
// the bounds need no further time-scale conversion.
function scanChunk(ephemeris: JovianEphemeris, start: Time, stop: Time, grs: GreatRedSpotModel | undefined): ChunkEvents {
	const from = tdb(start)
	const to = tdb(stop)
	const phenomena = jovianPhenomena(ephemeris, from, to)
	const mutual = findGalileanMutualEvents(ephemeris, from, to)
	if (!grs) return { phenomena, mutual, grs: [] }

	const jupiterToEarth = (time: Time) => {
		const state = jovianSystemState(ephemeris, time)
		return vecMinus(state.earth, state.jupiter)
	}

	// Angle of the spot from the central meridian, wrapped to (−π, π]: increasing through zero at a transit.
	const offset = (time: Time) => normalizePI(jupiterCentralMeridian('II', time, jupiterToEarth(time)) - greatRedSpotLongitude(grs, time))
	const fromMs = timeToUnixMillis(from)
	const toMs = timeToUnixMillis(to)
	const transits = []

	for (const time of greatRedSpotTransitsWithDrift(grs, jupiterToEarth, from, to, { step: GRS_STEP_DAYS })) {
		const maximum = timeToUnixMillis(time)
		if (maximum < fromMs || maximum >= toMs) continue
		const edge = (sign: number) => {
			const f = (x: number) => offset(timeShift(time, x)) - sign * GRS_VIEWING_HALF_WIDTH
			const root = sign < 0 ? brentRoot(f, -GRS_WINDOW_SEARCH_DAYS, 0) : brentRoot(f, 0, GRS_WINDOW_SEARCH_DAYS)
			return maximum + root.root * 86_400_000
		}
		transits.push({ maximum, start: edge(-1), end: edge(1), longitude: greatRedSpotLongitude(grs, time) })
	}

	return { phenomena, mutual, grs: transits }
}

// An event of the scan before the site is considered.
type ScannedEvent = Omit<JupiterEvent, 'overlaps' | 'visibility'>

// Builds the events of the range from the chunks: the identity, interval, contacts and range flags of each.
function scannedEvents(chunks: readonly ChunkEvents[], start: number, end: number, grs: JupiterGrsModel | undefined): ScannedEvent[] {
	const events: ScannedEvent[] = []
	const push = (event: Omit<ScannedEvent, 'id' | 'startsBeforeRange' | 'endsAfterRange'>) => {
		if (event.end < start || event.start >= end) return
		events.push({ ...event, id: `${event.kind}|${event.moons.join('-')}|${Math.round(event.maximum / 1000)}`, startsBeforeRange: event.start < start, endsAfterRange: event.end > end })
	}

	for (const chunk of chunks) {
		for (const p of chunk.phenomena) {
			const maximum = timeToUnixMillis(p.maximum)
			const contacts: JupiterEventContacts = {
				external1: unixMillisOf(p.external1),
				internal1: unixMillisOf(p.internal1),
				center1: unixMillisOf(p.center1),
				center2: unixMillisOf(p.center2),
				internal2: unixMillisOf(p.internal2),
				external2: unixMillisOf(p.external2),
				visibleStart: unixMillisOf(p.visibleStart),
				visibleEnd: unixMillisOf(p.visibleEnd),
			}
			push({ kind: p.kind, moons: [p.moon], start: contacts.external1 ?? maximum, maximum, end: contacts.external2 ?? maximum, contacts: definedContacts(contacts), grazing: p.grazing, depth: p.depth })
		}

		for (const e of chunk.mutual) {
			const maximum = timeToUnixMillis(e.middle)
			const contacts = definedContacts({ external1: unixMillisOf(e.start), external2: unixMillisOf(e.end) })
			push({ kind: e.kind === 'occultation' ? 'mutualOccultation' : 'mutualEclipse', moons: [e.front, e.back], start: contacts.external1 ?? maximum, maximum, end: contacts.external2 ?? maximum, contacts, grazing: false, impactParameter: e.impactParameter })
		}

		for (const t of chunk.grs) {
			push({ kind: 'grsTransit', moons: [], start: t.start, maximum: t.maximum, end: t.end, contacts: {}, grazing: false, grs: { longitude: t.longitude, referenceAgeDays: (t.maximum - grs!.referenceTime) / 86_400_000, halfWidth: GRS_VIEWING_HALF_WIDTH } })
		}
	}

	events.sort((a, b) => a.maximum - b.maximum || a.id.localeCompare(b.id))
	return events
}

// Computes the events over a range: scans the padded range in day chunks with one source, keeps the events overlapping
// the range, filters them by kind and moon, and evaluates their visibility from the site when one is given. The
// visibility of a mutual event or an eclipse uses the occultations and eclipses of every moon, filtered or not.
export async function computeEvents(kernels: JupiterKernels, nights: (request: AstroWeatherNightRequest) => AstroWeatherNight, request: JupiterEventsRequest, grs: JupiterGrsModel | undefined, signal?: AbortSignal) {
	const { start, end, site } = request
	const kinds = new Set(request.kinds ?? JUPITER_EVENT_KINDS)
	const moons = new Set(request.moons ?? GALILEAN_MOONS)
	const model = grs && kinds.has('grsTransit') ? grsModel(grs) : undefined
	const from = start - EVENT_PAD_DAYS * 86_400_000
	const to = end + EVENT_PAD_DAYS * 86_400_000
	const chunkMs = EVENT_CHUNK_DAYS * 86_400_000
	const count = Math.max(1, Math.ceil((to - from) / chunkMs))
	const { results, source, snapshot } = await withJovianSource(kernels, count, (ephemeris, i) => scanChunk(ephemeris, toolkitTime(from + i * chunkMs), toolkitTime(Math.min(to, from + (i + 1) * chunkMs)), model), true, signal)

	const all = scannedEvents(results, start, end, grs)
	const hidden = hiddenIntervals(all, GALILEAN_MOONS)
	const selected = all.filter((e) => kinds.has(e.kind) && (e.moons.length === 0 || e.moons.some((moon) => moons.has(moon))))
	const overlaps = overlapsOf(selected)
	// Nights over the padded range, so the parts of the events beyond the range are judged too.
	const siteNightList = site ? await siteNights(nights, site, JUPITER_CODE, from, to, signal) : []

	const events: JupiterEvent[] = []

	for (let i = 0; i < selected.length; i++) {
		if (site && i > 0 && i % VISIBILITY_YIELD_EVERY === 0) {
			await yieldToEventLoop()
			signal?.throwIfAborted()
		}

		const event = selected[i]
		const visibility: JupiterEventVisibility = site ? siteVisibility(event, physicallyVisible(event, hidden), siteNightList, JUPITER_CODE, SITE_REASONS) : { status: 'unknownNoSite', windows: [], longestMs: 0, reasons: physicallyVisibleReason(event, hidden) }
		events.push({ ...event, overlaps: overlaps[i], visibility })
	}

	rank(events)
	const shown = siteNightList.map((e) => e.night).filter((e) => e.end > start && e.start < end)
	return { start, end, events, nights: shown, sourced: { source, snapshot }, grsUsed: model !== undefined }
}

// Reasons an event is partly hidden from the Earth whatever the site.
function physicallyVisibleReason(event: ScannedEvent, hidden: HiddenIntervals<GalileanMoon>): JupiterVisibilityReason[] {
	const { reason } = physicallyVisible(event, hidden)
	return reason ? [reason] : []
}

// Readiness of the kernels for the planner over a range:
// - readyForJupiter: every Jovian body resolves at every probe;
// - partialCoverage: some probe falls outside the segments or in a gap;
// - unsupported: a selected segment cannot be evaluated;
// - missingDependencies: no kernel, a missing body or center, a cycle, or the kernels still loading.
export type JupiterKernelReadiness = 'readyForJupiter' | 'partialCoverage' | 'unsupported' | 'missingDependencies'

// Request of the kernel readiness over a range.
export interface JupiterSourceRequest {
	// First instant, Unix milliseconds.
	readonly start: number
	// Last instant, Unix milliseconds.
	readonly end: number
}

// Readiness of the kernels and the source a computation over the range would use.
export interface JupiterSourceReport {
	readonly readiness: JupiterKernelReadiness
	// Source a computation would use: the kernels, the theories, or none under spkOnly.
	readonly source: 'spk' | 'analytical' | 'unavailable'
	// Why the kernels are not ready; absent when they are.
	readonly reason?: JupiterFallbackReason
	// First state the kernels could not resolve.
	readonly miss?: JupiterSourceMiss
	readonly policy: SpiceEphemerisPolicy
	readonly generation: number
	// Number of probed epochs (every 6 hours of the range, both ends included).
	readonly probes: number
}

// Probes the kernels over a range for every Jovian body (see kernelReadiness of planetary.source.ts: every 6 hours,
// both ends included, for the ranges of the planner). Not a guarantee for a scan, which evaluates many more epochs, but
// an explanation of what the kernels lack.
export function kernelReadiness(snapshot: SpiceKernelSnapshot, { start, end }: JupiterSourceRequest): JupiterSourceReport {
	const report = planetaryReadiness(JOVIAN_SOURCE, JOVIAN_BODIES, snapshot, start, end)
	return { ...report, readiness: report.readiness === 'ready' ? 'readyForJupiter' : report.readiness }
}
