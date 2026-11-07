// oxfmt-ignore
import { analyticalSaturnianEphemeris, interpolatedSaturnianEphemeris, interpolatedSaturnianRingEphemeris, SATURNIAN_BODIES, SATURNIAN_MOONS, SATURNIAN_NAIF, SATURNIAN_RING_BODIES, type SaturnianBody, type SaturnianEphemeris, SaturnianEphemerisMiss, type SaturnianMoon, spkSaturnianEphemeris } from 'nebulosa/src/astronomy/ephemeris/saturnian'
import { planetSystemState, type SatelliteDiskState, type SatelliteEclipseState, type SkyBasis } from 'nebulosa/src/astronomy/events/satellites.geometry'
import { type SaturnianMoonView, saturnianMoonView, saturnianSeparationMaxima, saturnianView, type SaturnRingOverlap } from 'nebulosa/src/astronomy/events/saturn.geometry'
// oxfmt-ignore
import { SATURN_MODEL, SATURN_RING_MODEL, type SaturnRingAnnulus, type SaturnRingEventKind, saturnRingEvents, type SaturnRingGeometry, saturnRingGeometry, type SaturnRingIllumination, saturnRingOpenings } from 'nebulosa/src/astronomy/events/saturn.rings'
import { precessionNutationMatrix, timeToUnixMillis } from 'nebulosa/src/astronomy/time/time'
import { SATURN_EQUATORIAL_RADIUS_KM, SATURN_POLAR_RADIUS_KM } from 'nebulosa/src/core/constants'
import { type Vec3, vecCross, vecNormalize } from 'nebulosa/src/math/linear-algebra/vec3'
// oxfmt-ignore
import { kernelReadiness, type PlanetaryFallbackReason, type PlanetaryKernels, type PlanetaryReadinessReport, type PlanetarySource, type PlanetarySourceMiss, PlanetarySourceUnavailableError, type SatelliteSourceConfig, type SourcedResult, toolkitTime, withSatelliteSource } from './planetary.source'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'
import type { SpiceEphemerisPolicy } from './spicekernels.store'

// Astronomy of the Saturn Observing Planner: the geometry of Saturn's disk and rings at an instant and over seasons
// (signed Earth and solar ring openings, pole position angle, apparent sizes, and the ring-plane crossings and opening
// extrema found by root search), the apparent view of the seven major moons at an instant, their sampled tracks, and
// their greatest separations from Saturn. Every computation takes all its states from one source chosen once with the
// shared orchestration of planetary.source.ts, per scope: a rings computation needs only the Sun, the Earth and Saturn's
// centre (NAIF 699, never the barycenter 6), so a planetary kernel such as sat480.bsp serves it even under spkOnly; a
// moons computation needs those and Mimas to Iapetus (601-606, 608), as in sat441.bsp. Without them the analytical
// VSOP87E (+ TASS 1.7 for the moons) theories are used, unless the policy is spkOnly, which fails that scope alone.
// Everything is geocentric; times are Unix milliseconds (UTC), angles radians.

// Version of the Saturn prediction model; changes whenever the meaning of a computed field changes.
export const SATURN_MODEL_VERSION = 1

// A major moon of Saturn, Mimas to Iapetus (Hyperion is not planned).
export type SaturnMoon = SaturnianMoon

// The bodies a computation needs: the rings (the Sun, the Earth and Saturn) or the moons (those and the seven moons).
export type SaturnScope = 'rings' | 'moons'

// Bodies evaluated by each scope.
const SCOPE_BODIES: Readonly<Record<SaturnScope, readonly SaturnianBody[]>> = { rings: SATURNIAN_RING_BODIES, moons: SATURNIAN_BODIES }

// Why the analytical theories were used instead of the kernels (see PlanetaryFallbackReason).
export type SaturnFallbackReason = PlanetaryFallbackReason

// The kernel state that could not be resolved.
export type SaturnSourceMiss = PlanetarySourceMiss<SaturnianBody>

// The analytical theories of a Saturn computation: VSOP87E alone for the rings, with TASS 1.7 for the moons.
interface AnalyticalSaturnSource {
	readonly kind: 'analytical'
	// Planetary theory of the Sun, the Earth and Saturn.
	readonly planetary: 'VSOP87E'
	// Satellite theory of the major moons; absent for a rings computation, which needs none.
	readonly satellites?: 'TASS1.7'
}

// Source of the states of a computation.
export type SaturnSource = PlanetarySource<SaturnianBody, AnalyticalSaturnSource>

// Identity of a computed result: the models, the scope, its source, and the inputs that change it.
export interface SaturnSignature {
	// Version of the prediction model.
	readonly modelVersion: number
	// Version of the ring radii (SATURN_RING_MODEL).
	readonly ringModelVersion: number
	// Bodies the computation needed.
	readonly scope: SaturnScope
	// Source of the states.
	readonly source: SaturnSource
	// Ephemeris policy of the SPICE Kernel Library.
	readonly policy: SpiceEphemerisPolicy
	// Generation of the kernel set the source was chosen from.
	readonly generation: number
}

// Thrown when the ephemeris policy is spkOnly and the kernels cannot give a whole computation of a scope, or when the
// kernel set kept changing during one.
export class SaturnSourceUnavailableError extends PlanetarySourceUnavailableError<SaturnianBody> {
	constructor(reason: SaturnFallbackReason | 'generationChanged', miss?: SaturnSourceMiss) {
		super(reason === 'generationChanged' ? 'The SPICE kernels changed during the computation' : `The SPICE kernels cannot give the Saturnian states (${reason})`, reason, miss)
	}
}

// Live kernel snapshots of the SPICE Kernel Library.
export type SaturnKernels = PlanetaryKernels

// How the Saturnian system is evaluated for each scope from the kernels or the theories.
const SATURN_SOURCES: Readonly<Record<SaturnScope, SatelliteSourceConfig<SaturnianBody, SaturnianEphemeris, AnalyticalSaturnSource>>> = {
	rings: sourceConfig({ kind: 'analytical', planetary: 'VSOP87E' }),
	moons: sourceConfig({ kind: 'analytical', planetary: 'VSOP87E', satellites: 'TASS1.7' }),
}

// The Saturnian source configuration with the given description of the analytical theories.
function sourceConfig(analyticalSource: AnalyticalSaturnSource): SatelliteSourceConfig<SaturnianBody, SaturnianEphemeris, AnalyticalSaturnSource> {
	return { naif: SATURNIAN_NAIF, analytical: analyticalSaturnianEphemeris, analyticalSource, spk: spkSaturnianEphemeris, miss: SaturnianEphemerisMiss, unavailable: (reason, miss) => new SaturnSourceUnavailableError(reason, miss) }
}

// Result of a computation of one scope and the source it used.
export type SaturnSourced<T> = SourcedResult<SaturnianBody, AnalyticalSaturnSource, T>

// Runs `count` chunks of a computation of `scope` with one source for all of them (see withSatelliteSource). `wrap`
// interpolates the source for dense sampling; a single instant is evaluated directly.
export function withSaturnianSource<T>(kernels: SaturnKernels, scope: SaturnScope, count: number, chunk: (ephemeris: SaturnianEphemeris, index: number) => T, wrap?: (ephemeris: SaturnianEphemeris) => SaturnianEphemeris, signal?: AbortSignal): Promise<SaturnSourced<T>> {
	return withSatelliteSource(kernels, SATURN_SOURCES[scope], SCOPE_BODIES[scope], count, chunk, wrap, signal)
}

// Signature of a result of a scope computed from a source and a kernel snapshot.
export function saturnSignature(scope: SaturnScope, source: SaturnSource, snapshot: SpiceKernelSnapshot): SaturnSignature {
	return { modelVersion: SATURN_MODEL_VERSION, ringModelVersion: SATURN_RING_MODEL.version, scope, source, policy: snapshot.policy, generation: snapshot.generation }
}

// The adopted ring and disk model, for drawing: the named annuli and Saturn's radii.
export interface SaturnRingModel {
	// Version of the ring radii.
	readonly version: number
	// Where the radii come from.
	readonly source: string
	// The C, B and A rings and the Cassini Division, from the inside out, with their radii in km.
	readonly annuli: readonly SaturnRingAnnulus[]
	// Saturn's IAU 1-bar equatorial radius, km.
	readonly equatorialRadiusKm: number
	// Saturn's IAU 1-bar polar radius, km.
	readonly polarRadiusKm: number
}

// The ring and disk model of every answer that draws the planet.
export const SATURN_RING_DRAWING: SaturnRingModel = { version: SATURN_RING_MODEL.version, source: SATURN_RING_MODEL.source, annuli: SATURN_RING_MODEL.annuli, equatorialRadiusKm: SATURN_EQUATORIAL_RADIUS_KM, polarRadiusKm: SATURN_POLAR_RADIUS_KM }

// Apparent geometry of Saturn's disk and rings at an instant.
export interface SaturnRings {
	// Geocentric distance of Saturn's centre, AU.
	readonly distance: number
	// Earth opening B: Saturnicentric latitude of the Earth above the ring plane, north positive.
	readonly earthOpening: number
	// Solar opening B′: Saturnicentric latitude of the Sun above the ring plane, north positive.
	readonly solarOpening: number
	// Position angle of the projected north pole, from the true celestial north toward the east, in (−π, π].
	readonly polePositionAngle: number
	// Apparent equatorial angular radius of the disk.
	readonly equatorialRadius: number
	// Apparent polar angular semi-axis of the disk outline.
	readonly polarRadius: number
	// Apparent angular semi-major axis of the outer edge of the A ring.
	readonly ringSemiMajor: number
	// Apparent angular semi-minor axis of the outer edge of the A ring, non-negative.
	readonly ringSemiMinor: number
	// How the Earth and the Sun face the ring plane.
	readonly illumination: SaturnRingIllumination
}

// The ring geometry of an answer from the toolkit's.
function ringsOf(geometry: SaturnRingGeometry): SaturnRings {
	const { distance, earthOpening, solarOpening, polePositionAngle, equatorialRadius, polarRadius, ringSemiMajor, ringSemiMinor, illumination } = geometry
	return { distance, earthOpening, solarOpening, polePositionAngle, equatorialRadius, polarRadius, ringSemiMajor, ringSemiMinor, illumination }
}

// Request of the geometry at an instant.
export interface SaturnStateRequest {
	// Observed instant, Unix milliseconds.
	readonly time: number
}

// Saturn's disk and rings at an instant (rings scope).
export interface SaturnRingState {
	// Observed instant, Unix milliseconds.
	readonly time: number
	readonly rings: SaturnRings
	readonly model: SaturnRingModel
	readonly signature: SaturnSignature
}

// Computes the disk and ring geometry at an instant.
export function computeRingState(ephemeris: SaturnianEphemeris, time: number): SaturnRings {
	return ringsOf(saturnRingGeometry(ephemeris, toolkitTime(time)))
}

// The centre of a moon's shadow on Saturn's globe.
export interface SaturnShadow {
	// Sky offset toward the east, in apparent equatorial radii of Saturn.
	readonly east: number
	// Sky offset toward the true celestial north, in apparent equatorial radii of Saturn.
	readonly north: number
	// Whether the shadow centre lies on the hemisphere facing the Earth.
	readonly visible: boolean
}

// One moon at an instant.
export interface SaturnMoonState {
	readonly moon: SaturnMoon
	// Sky offset of its centre from Saturn's apparent centre toward the east, in apparent equatorial radii of Saturn.
	readonly east: number
	// Sky offset toward the true celestial north, in apparent equatorial radii of Saturn.
	readonly north: number
	// Line-of-sight distance in front of Saturn's centre, in equatorial radii: positive toward the Earth.
	readonly depth: number
	// Apparent radius, in apparent equatorial radii of Saturn.
	readonly radius: number
	// Angular separation from Saturn's centre.
	readonly separation: number
	// Position angle from Saturn's centre, from the true celestial north toward the east, in (−π, π].
	readonly positionAngle: number
	// Signed angular clearance of its limb from Saturn's limb: negative when the disks overlap.
	readonly diskClearance: number
	// Signed angular clearance of its limb from the outer edge of the A ring: negative when it reaches inside the ring
	// outline. Geometric only, not an occultation.
	readonly ringClearance: number
	// Whether it overlaps the projected rings, in front of them or behind them (possibly hidden).
	readonly ringOverlap: SaturnRingOverlap
	readonly disk: SatelliteDiskState
	readonly eclipse: SatelliteEclipseState
	// The centre of its shadow on the globe, when the shadow axis meets the planet.
	readonly shadow?: SaturnShadow
}

// Saturn, its rings and its moons at an instant, from one source (moons scope).
export interface SaturnMoonsState {
	// Observed instant, Unix milliseconds.
	readonly time: number
	// The disk and rings, from the same source as the moons.
	readonly rings: SaturnRings
	readonly model: SaturnRingModel
	// The seven moons, in orbital order.
	readonly moons: readonly SaturnMoonState[]
	readonly signature: SaturnSignature
}

// A moon of the answer from the toolkit's view.
function moonOf({ moon, east, north, depth, radius, separation, positionAngle, diskClearance, ringClearance, ringOverlap, disk, eclipse, shadow }: SaturnianMoonView): SaturnMoonState {
	return { moon, east, north, depth, radius, separation, positionAngle, diskClearance, ringClearance, ringOverlap, disk, eclipse, ...(shadow && { shadow }) }
}

// Computes Saturn, its rings and its seven moons at an instant.
export function computeMoonsState(ephemeris: SaturnianEphemeris, time: number): Omit<SaturnMoonsState, 'model' | 'signature'> {
	const view = saturnianView(ephemeris, toolkitTime(time))
	return { time, rings: ringsOf(view), moons: view.moons.map(moonOf) }
}

// Most samples of a ring timeline.
const TIMELINE_MAX_SAMPLES = 2000

// Span of one chunk of a ring timeline, milliseconds: one Julian year.
const TIMELINE_CHUNK_MS = 365.25 * 86_400_000

// Request of the ring timeline over a range.
export interface SaturnRingTimelineRequest {
	// First instant, Unix milliseconds.
	readonly start: number
	// End of the range, exclusive, Unix milliseconds.
	readonly end: number
}

// A ring-plane event: a crossing of the Earth or the Sun, an extremum of the Earth opening, or a near-plane approach.
export interface SaturnRingEvent {
	readonly kind: SaturnRingEventKind
	// Observed geocentric instant found by root or extremum search, Unix milliseconds.
	readonly time: number
	// Earth opening B at the event.
	readonly earthOpening: number
	// Solar opening B′ at the event.
	readonly solarOpening: number
}

// The ring openings over a range: evenly spaced samples for the chart and the events found by search.
export interface SaturnRingTimeline {
	// First instant of the range, Unix milliseconds.
	readonly start: number
	// End of the range, exclusive, Unix milliseconds.
	readonly end: number
	// Spacing of the samples, milliseconds.
	readonly step: number
	// Instants of the samples, Unix milliseconds.
	readonly times: readonly number[]
	// Earth opening B at each sample.
	readonly earthOpening: readonly number[]
	// Solar opening B′ at each sample.
	readonly solarOpening: readonly number[]
	// Events with their instant in [start, end), chronologically; never interpolated from the samples.
	readonly events: readonly SaturnRingEvent[]
	readonly signature: SaturnSignature
}

// Samples and events of one chunk of a timeline.
interface TimelineChunk {
	readonly times: number[]
	readonly earthOpening: number[]
	readonly solarOpening: number[]
	readonly events: SaturnRingEvent[]
}

// Computes the ring timeline over a range in yearly chunks with one rings source: at most TIMELINE_MAX_SAMPLES evenly
// spaced samples (whole minutes apart) and the ring-plane events of each chunk's half-open span.
export async function computeRingTimeline(kernels: SaturnKernels, { start, end }: SaturnRingTimelineRequest, signal?: AbortSignal): Promise<Omit<SaturnRingTimeline, 'signature'> & { readonly sourced: Omit<SaturnSourced<unknown>, 'results'> }> {
	const step = Math.max(60_000, Math.ceil((end - start) / (TIMELINE_MAX_SAMPLES - 1) / 60_000) * 60_000)
	const count = Math.max(1, Math.ceil((end - start) / TIMELINE_CHUNK_MS))

	const chunk = (ephemeris: SaturnianEphemeris, i: number): TimelineChunk => {
		const from = start + i * TIMELINE_CHUNK_MS
		const to = Math.min(end, from + TIMELINE_CHUNK_MS)
		const out: TimelineChunk = { times: [], earthOpening: [], solarOpening: [], events: [] }

		// The samples of the range's grid start + k·step in [from, to), up to the range's end inclusive in the last chunk.
		for (let k = Math.ceil((from - start) / step); ; k++) {
			const time = start + k * step
			if (time > end || (time >= to && i < count - 1)) break
			const { earthOpening, solarOpening } = saturnRingOpenings(ephemeris, toolkitTime(time))
			out.times.push(time)
			out.earthOpening.push(earthOpening)
			out.solarOpening.push(solarOpening)
		}

		for (const event of saturnRingEvents(ephemeris, toolkitTime(from), toolkitTime(to))) {
			out.events.push({ kind: event.kind, time: timeToUnixMillis(event.time), earthOpening: event.earthOpening, solarOpening: event.solarOpening })
		}

		return out
	}

	const { results, source, snapshot } = await withSaturnianSource(kernels, 'rings', count, chunk, interpolatedSaturnianRingEphemeris, signal)
	const times: number[] = []
	const earthOpening: number[] = []
	const solarOpening: number[] = []
	const events: SaturnRingEvent[] = []

	for (const result of results) {
		for (let k = 0; k < result.times.length; k++) {
			times.push(result.times[k])
			earthOpening.push(result.earthOpening[k])
			solarOpening.push(result.solarOpening[k])
		}

		for (const event of result.events) events.push(event)
	}

	return { start, end, step, times, earthOpening, solarOpening, events, sourced: { source, snapshot } }
}

// Most samples of one moon in a track.
const TRACK_MAX_SAMPLES = 2000

// Shortest spacing of track samples, in milliseconds (one minute).
const TRACK_MIN_STEP_MS = 60_000

// Samples of a track computed between two yields.
const TRACK_CHUNK_SAMPLES = 250

// Request of the moon tracks over a range.
export interface SaturnTrackRequest {
	// First instant, Unix milliseconds.
	readonly start: number
	// Last instant, Unix milliseconds.
	readonly end: number
}

// One moon over a track, one value per sample.
export interface SaturnTrackMoon {
	// Sky offsets toward the east, in apparent equatorial radii of Saturn.
	readonly east: readonly number[]
	// Sky offsets toward the true celestial north, in apparent equatorial radii of Saturn.
	readonly north: readonly number[]
	// Line-of-sight distances in front of Saturn's centre, in equatorial radii.
	readonly depth: readonly number[]
	readonly disk: readonly SatelliteDiskState[]
	readonly eclipse: readonly SatelliteEclipseState[]
	readonly ringOverlap: readonly SaturnRingOverlap[]
}

// Sampled tracks of the moons over a range: the exact geometry at each sample, for display and interpolation only.
export interface SaturnTrack {
	// First sample, Unix milliseconds.
	readonly start: number
	// Spacing of the samples, milliseconds: a whole number of minutes chosen so a moon has at most TRACK_MAX_SAMPLES.
	readonly step: number
	// Instants of the samples, Unix milliseconds.
	readonly times: readonly number[]
	// Position angle of Saturn's projected north pole at the middle of the range, for the chart's ring-plane axis.
	readonly poleAngle: number
	// Each moon's samples.
	readonly moons: Readonly<Record<SaturnMoon, SaturnTrackMoon>>
	readonly signature: SaturnSignature
}

// Mutable samples of one moon.
interface TrackMoonSamples {
	east: number[]
	north: number[]
	depth: number[]
	disk: SatelliteDiskState[]
	eclipse: SatelliteEclipseState[]
	ringOverlap: SaturnRingOverlap[]
}

// Empty samples of every moon.
function emptyTrack(): Record<SaturnMoon, TrackMoonSamples> {
	const out = {} as Record<SaturnMoon, TrackMoonSamples>
	for (const moon of SATURNIAN_MOONS) out[moon] = { east: [], north: [], depth: [], disk: [], eclipse: [], ringOverlap: [] }
	return out
}

// Sky basis around a line of sight with a fixed true celestial pole (unit, ICRF): east toward increasing right
// ascension, north toward the pole.
function basisAround(truePole: Vec3, lineOfSight: Vec3): SkyBasis {
	const east = vecNormalize(vecCross(truePole, lineOfSight))
	return { east, north: vecCross(lineOfSight, east), lineOfSight }
}

// Computes the moons over a list of instants with one ephemeris, on the sky axes of a fixed true pole.
function computeTrackChunk(ephemeris: SaturnianEphemeris, times: readonly number[], truePole: Vec3): Record<SaturnMoon, TrackMoonSamples> {
	const out = emptyTrack()

	for (const time of times) {
		const state = planetSystemState(SATURN_MODEL, ephemeris, toolkitTime(time))
		const basis = basisAround(truePole, state.lineOfSight)

		for (const moon of SATURNIAN_MOONS) {
			const view = saturnianMoonView(ephemeris, state, basis, moon)
			const track = out[moon]
			track.east.push(view.east)
			track.north.push(view.north)
			track.depth.push(view.depth)
			track.disk.push(view.disk)
			track.eclipse.push(view.eclipse)
			track.ringOverlap.push(view.ringOverlap)
		}
	}

	return out
}

// Computes the moon tracks over a range with one moons source, in chunks of TRACK_CHUNK_SAMPLES samples.
export async function computeTrack(kernels: SaturnKernels, { start, end }: SaturnTrackRequest, signal?: AbortSignal): Promise<Omit<SaturnTrack, 'signature'> & { readonly sourced: Omit<SaturnSourced<unknown>, 'results'> }> {
	const step = Math.max(TRACK_MIN_STEP_MS, Math.ceil((end - start) / (TRACK_MAX_SAMPLES - 1) / TRACK_MIN_STEP_MS) * TRACK_MIN_STEP_MS)
	const times: number[] = []
	for (let time = start; time <= end; time += step) times.push(time)

	const middle = toolkitTime((start + end) / 2)
	const pnm = precessionNutationMatrix(middle)
	const truePole: Vec3 = [pnm[6], pnm[7], pnm[8]]
	const chunks = Math.max(1, Math.ceil(times.length / TRACK_CHUNK_SAMPLES))
	let poleAngle = 0

	const { results, source, snapshot } = await withSaturnianSource(
		kernels,
		'moons',
		chunks,
		(ephemeris, i) => {
			if (i === 0) poleAngle = saturnRingGeometry(ephemeris, middle).polePositionAngle
			return computeTrackChunk(ephemeris, times.slice(i * TRACK_CHUNK_SAMPLES, (i + 1) * TRACK_CHUNK_SAMPLES), truePole)
		},
		interpolatedSaturnianEphemeris,
		signal,
	)

	const moons = emptyTrack()

	for (const result of results) {
		for (const moon of SATURNIAN_MOONS) {
			const from = result[moon]
			const into = moons[moon]

			for (let k = 0; k < from.east.length; k++) {
				into.east.push(from.east[k])
				into.north.push(from.north[k])
				into.depth.push(from.depth[k])
				into.disk.push(from.disk[k])
				into.eclipse.push(from.eclipse[k])
				into.ringOverlap.push(from.ringOverlap[k])
			}
		}
	}

	return { start, step, times, poleAngle, moons, sourced: { source, snapshot } }
}

// Span of one chunk of the separation search, milliseconds: 30 days.
const ELONGATION_CHUNK_MS = 30 * 86_400_000

// Request of the greatest separations over a range.
export interface SaturnElongationsRequest {
	// First instant, Unix milliseconds.
	readonly start: number
	// End of the range, exclusive, Unix milliseconds.
	readonly end: number
	// Moons searched; every moon when absent.
	readonly moons?: readonly SaturnMoon[]
}

// A greatest apparent separation of a moon from Saturn: a true local maximum of the separation, not an east-west
// elongation.
export interface SaturnElongation {
	readonly moon: SaturnMoon
	// Observed geocentric instant, Unix milliseconds.
	readonly time: number
	// Angular separation from Saturn's centre.
	readonly separation: number
	// Position angle from Saturn's centre, from the true celestial north toward the east, in (−π, π].
	readonly positionAngle: number
}

// Greatest separations over a range.
export interface SaturnElongations {
	// First instant of the range, Unix milliseconds.
	readonly start: number
	// End of the range, exclusive, Unix milliseconds.
	readonly end: number
	// Maxima with their instant in [start, end), chronologically; a slow moon may have none in a short range.
	readonly elongations: readonly SaturnElongation[]
	readonly signature: SaturnSignature
}

// Computes the greatest separations over a range in 30-day chunks with one moons source.
export async function computeElongations(kernels: SaturnKernels, { start, end, moons }: SaturnElongationsRequest, signal?: AbortSignal): Promise<Omit<SaturnElongations, 'signature'> & { readonly sourced: Omit<SaturnSourced<unknown>, 'results'> }> {
	const count = Math.max(1, Math.ceil((end - start) / ELONGATION_CHUNK_MS))
	const searched = moons ?? SATURNIAN_MOONS

	const chunk = (ephemeris: SaturnianEphemeris, i: number) => {
		const from = start + i * ELONGATION_CHUNK_MS
		const to = Math.min(end, from + ELONGATION_CHUNK_MS)
		return saturnianSeparationMaxima(ephemeris, toolkitTime(from), toolkitTime(to), searched).map(({ moon, time, separation, positionAngle }): SaturnElongation => ({ moon, time: timeToUnixMillis(time), separation, positionAngle }))
	}

	const { results, source, snapshot } = await withSaturnianSource(kernels, 'moons', count, chunk, interpolatedSaturnianEphemeris, signal)
	return { start, end, elongations: results.flat(), sourced: { source, snapshot } }
}

// Request of the kernel readiness over a range.
export interface SaturnSourceRequest {
	// First instant, Unix milliseconds.
	readonly start: number
	// Last instant, Unix milliseconds.
	readonly end: number
}

// Readiness of the kernels for each scope over a range (see PlanetaryReadinessReport).
export interface SaturnSourceReport {
	readonly rings: PlanetaryReadinessReport<SaturnianBody>
	readonly moons: PlanetaryReadinessReport<SaturnianBody>
}

// Probes the kernels over a range for each scope: the ring bodies and every Saturnian body.
export function computeSource(snapshot: SpiceKernelSnapshot, { start, end }: SaturnSourceRequest): SaturnSourceReport {
	return { rings: kernelReadiness(SATURN_SOURCES.rings, SCOPE_BODIES.rings, snapshot, start, end), moons: kernelReadiness(SATURN_SOURCES.moons, SCOPE_BODIES.moons, snapshot, start, end) }
}
