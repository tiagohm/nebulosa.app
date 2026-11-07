import { analyticalJovianEphemeris, GALILEAN_MOONS, type GalileanMoon, hasJovianTargets, interpolatedJovianEphemeris, JOVIAN_BODIES, JOVIAN_NAIF, type JovianBody, type JovianEphemeris, JovianEphemerisMiss, type SpkJovianEphemeris, spkJovianEphemeris } from 'nebulosa/src/astronomy/ephemeris/jovian'
import type { SpkMissReason } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import { altitudeOf } from 'nebulosa/src/astronomy/events/horizon'
import { greatRedSpotLongitude, type GreatRedSpotModel, greatRedSpotTransitsWithDrift, jupiterCentralMeridian } from 'nebulosa/src/astronomy/events/jupiter'
import { type JovianDiskState, type JovianEclipseState, type JovianMoonMargins, jovianMoonMargins, jovianSystemState, jovianView, projectJovianSurfacePoint } from 'nebulosa/src/astronomy/events/jupiter.geometry'
import { type JovianPhenomenon, type JovianPhenomenonKind, jovianPhenomena } from 'nebulosa/src/astronomy/events/jupiter.phenomena'
import { findGalileanMutualEvents, type MutualEvent } from 'nebulosa/src/astronomy/events/mutual'
import { visibilityWindows } from 'nebulosa/src/astronomy/events/visibility'
import { airmassKastenYoung } from 'nebulosa/src/astronomy/formulas'
import { precessionNutationMatrix, type Time, tdb, timeShift, timeToUnixMillis, timeUnix } from 'nebulosa/src/astronomy/time/time'
import { DEG2RAD, JUPITER_EQUATORIAL_RADIUS_AU } from 'nebulosa/src/core/constants'
import { type Vec3, vecCross, vecDot, vecMinus, vecNormalize } from 'nebulosa/src/math/linear-algebra/vec3'
import { brentRoot } from 'nebulosa/src/math/numerical/optimization'
import { normalizePI } from 'nebulosa/src/math/units/angle'
import type { AstroWeatherNight, AstroWeatherNightRequest } from './astroweather.night'
import type { JupiterGrsModel } from './jupiter.store'
import { OBSERVING_PRESETS, type PlanningSite, PlanningNight, SEARCH_STEP_DAYS } from './observingplanner.astronomy'
import type { TimeSpan } from './sky/sun'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'
import type { SpiceEphemerisPolicy } from './spicekernels.store'

// Astronomy of the Jupiter Observing Planner: the apparent view of Jupiter and its Galilean satellites at an instant, the
// sampled tracks of the satellites, and the phenomena over a range (Great Red Spot transits, satellite transits, shadow
// transits, occultations, eclipses, and mutual events) with their visibility from a site. Every computation takes all its
// states from one source chosen once: the kernels of the SPICE Kernel Library when they resolve every Jovian body, else
// the analytical VSOP87E + L1.2 theories, unless the ephemeris policy is spkOnly, which fails instead. A kernel miss in
// the middle of a computation discards it and reruns it whole from the theories, so sources are never mixed; Horizons is
// never asked. Long computations run in chunks that yield to the event loop and re-read the kernel snapshot, restarting
// when its generation changed so no closed kernel is ever read. Phenomena are geocentric; a site only decides when they
// can be watched, with the planetary constraints of the Observing Planner on Jupiter's own altitude (its local VSOP87E
// position), which is a separate question from the phenomena. Angles are radians and times Unix milliseconds (UTC).

// Version of the Jupiter prediction model; changes whenever the meaning of a computed field changes.
export const JUPITER_MODEL_VERSION = 1

// Kind of Jupiter event.
export type JupiterEventKind = 'grsTransit' | JovianPhenomenonKind | 'mutualOccultation' | 'mutualEclipse'

// Every Jupiter event kind, in display order.
export const JUPITER_EVENT_KINDS: readonly JupiterEventKind[] = ['grsTransit', 'satelliteTransit', 'shadowTransit', 'satelliteOccultation', 'satelliteEclipse', 'mutualOccultation', 'mutualEclipse']

// Why the analytical theories were used instead of the kernels:
// - noKernel: no kernel is enabled; loading: the kernels are still being opened at the start of the server;
// - targetMissing: no kernel has a Jovian body; missingCenter: a body is relative to a center no kernel has;
// - outOfCoverage: an epoch falls outside the segments or in a gap;
// - unsupportedFrame or unsupportedType: the selected segment cannot be evaluated; cycle: a center chain never ends.
export type JupiterFallbackReason = 'noKernel' | 'loading' | 'targetMissing' | 'missingCenter' | 'outOfCoverage' | 'unsupportedFrame' | 'unsupportedType' | 'cycle'

// The kernel state that could not be resolved.
export interface JupiterSourceMiss {
	// Jovian body requested.
	readonly target: JovianBody
	// NAIF code of the body of the chain where resolution stopped.
	readonly body: number
	// Epoch that could not be resolved, Unix milliseconds; absent when no epoch was evaluated.
	readonly time?: number
}

// Source of the states of a computation.
export type JupiterSource =
	| {
			readonly kind: 'analytical'
			// Planetary theory of the Sun, the Earth and Jupiter.
			readonly planetary: 'VSOP87E'
			// Satellite theory of the Galilean moons.
			readonly satellites: 'L1.2'
			// Why the kernels were not used.
			readonly fallbackReason: JupiterFallbackReason
			// The state the kernels could not resolve, when one was tried.
			readonly miss?: JupiterSourceMiss
	  }
	| {
			readonly kind: 'spk'
			// Ids of the kernels that supplied each body.
			readonly kernels: Readonly<Partial<Record<JovianBody, readonly string[]>>>
	  }

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
export class JupiterSourceUnavailableError extends Error {
	constructor(
		readonly reason: JupiterFallbackReason | 'generationChanged',
		readonly miss?: JupiterSourceMiss,
	) {
		super(reason === 'generationChanged' ? 'The SPICE kernels changed during the computation' : `The SPICE kernels cannot give the Jovian states (${reason})`)
	}
}

// Live kernel snapshots of the SPICE Kernel Library.
export interface JupiterKernels {
	readonly current: () => SpiceKernelSnapshot
}

// Restarts allowed when the kernel generation changes during a computation.
const GENERATION_RESTARTS = 2

// Yields to the event loop.
function yieldToEventLoop() {
	return new Promise<void>((resolve) => {
		setImmediate(resolve)
	})
}

// Fallback reason of a kernel miss: a missing requested body is a missing target, a missing link of its chain a missing center.
function missReason(miss: JovianEphemerisMiss): JupiterFallbackReason {
	const reason: SpkMissReason = miss.reason
	if (reason === 'missing') return miss.body === JOVIAN_NAIF[miss.target] ? 'targetMissing' : 'missingCenter'
	if (reason === 'coverage') return 'outOfCoverage'
	if (reason === 'frame') return 'unsupportedFrame'
	if (reason === 'dataType') return 'unsupportedType'
	return 'cycle'
}

// Why a snapshot cannot even be tried, or undefined when its set has a segment for every Jovian body.
function snapshotReason(snapshot: SpiceKernelSnapshot): { readonly reason: JupiterFallbackReason; readonly miss?: JupiterSourceMiss } | undefined {
	if (snapshot.loading) return { reason: 'loading' }
	if (!snapshot.set) return { reason: 'noKernel' }
	if (hasJovianTargets(snapshot.set)) return undefined
	const target = JOVIAN_BODIES.find((body) => !snapshot.set!.bodies.has(JOVIAN_NAIF[body]))!
	return { reason: 'targetMissing', miss: { target, body: JOVIAN_NAIF[target] } }
}

// Kernel ids that supplied each body of an SPK ephemeris.
function kernelsOf(ephemeris: SpkJovianEphemeris): Partial<Record<JovianBody, readonly string[]>> {
	const kernels: Partial<Record<JovianBody, readonly string[]>> = {}
	for (const [body, ids] of ephemeris.kernelsByBody) kernels[body] = [...ids]
	return kernels
}

// Result of a computation and the source it used.
export interface SourcedResult<T> {
	readonly results: readonly T[]
	readonly source: JupiterSource
	readonly snapshot: SpiceKernelSnapshot
}

// Runs `count` chunks of a computation with one source for all of them, yielding to the event loop and checking `signal`
// between chunks. The kernels are tried first when they have every Jovian body; a JovianEphemerisMiss in any chunk
// discards the kernel results and reruns every chunk from the analytical theories, or throws
// JupiterSourceUnavailableError under spkOnly. A kernel computation restarts from the first chunk when the kernel
// generation changed during a yield, at most GENERATION_RESTARTS times. `interpolate` wraps the source for dense
// sampling; a single instant is evaluated directly.
export async function withJovianSource<T>(kernels: JupiterKernels, count: number, chunk: (ephemeris: JovianEphemeris, index: number) => T, interpolate: boolean, signal?: AbortSignal): Promise<SourcedResult<T>> {
	let restarts = 0

	attempts: while (true) {
		const snapshot = kernels.current()
		let fallback = snapshotReason(snapshot)

		if (fallback === undefined) {
			const spk = spkJovianEphemeris(snapshot.set!)
			const ephemeris = interpolate ? interpolatedJovianEphemeris(spk) : spk
			const results: T[] = []

			try {
				for (let i = 0; i < count; i++) {
					if (i > 0) {
						await yieldToEventLoop()
						signal?.throwIfAborted()

						if (kernels.current().generation !== snapshot.generation) {
							if (++restarts > GENERATION_RESTARTS) throw new JupiterSourceUnavailableError('generationChanged')
							continue attempts
						}
					}

					results.push(chunk(ephemeris, i))
				}

				return { results, source: { kind: 'spk', kernels: kernelsOf(spk) }, snapshot }
			} catch (error) {
				if (!(error instanceof JovianEphemerisMiss)) throw error
				fallback = { reason: missReason(error), miss: { target: error.target, body: error.body, time: timeToUnixMillis(error.time) } }
			}
		}

		if (snapshot.policy === 'spkOnly') throw new JupiterSourceUnavailableError(fallback.reason, fallback.miss)

		const ephemeris = interpolate ? interpolatedJovianEphemeris(analyticalJovianEphemeris) : analyticalJovianEphemeris
		const results: T[] = []

		for (let i = 0; i < count; i++) {
			if (i > 0) {
				await yieldToEventLoop()
				signal?.throwIfAborted()
			}

			results.push(chunk(ephemeris, i))
		}

		return { results, source: { kind: 'analytical', planetary: 'VSOP87E', satellites: 'L1.2', fallbackReason: fallback.reason, ...(fallback.miss && { miss: fallback.miss }) }, snapshot }
	}
}

// Toolkit instant of a Unix time in milliseconds.
function toolkitTime(time: number): Time {
	return timeUnix(time / 1000, true)
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
export interface JupiterEventContacts {
	readonly external1?: number
	readonly internal1?: number
	readonly center1?: number
	readonly center2?: number
	readonly internal2?: number
	readonly external2?: number
	// For a shadow transit, when its centre starts to face the Earth.
	readonly visibleStart?: number
	// For a shadow transit, when its centre stops facing the Earth.
	readonly visibleEnd?: number
}

// Whether an event can be watched from the site.
export type JupiterVisibilityStatus = 'observable' | 'partial' | 'notObservable' | 'unknownNoSite'

// Why an event, or part of it, cannot be watched from the site:
// - sunTooHigh: the Sun is above the planetary limit (−6°); jupiterTooLow: Jupiter is below the planetary minimum (25°);
// - moonHidden: a participating moon is behind Jupiter or in its shadow; shadowHidden: a shadow faces away from the Earth.
export type JupiterVisibilityReason = 'sunTooHigh' | 'jupiterTooLow' | 'moonHidden' | 'shadowHidden'

// Visibility of an event from the site.
export interface JupiterEventVisibility {
	readonly status: JupiterVisibilityStatus
	// Civil date, in the site's zone, of the evening of the night holding the maximum; absent without a site.
	readonly eveningDate?: string
	// Parts of the event interval that can be watched, Unix milliseconds.
	readonly windows: readonly TimeSpan[]
	// Longest watchable part, milliseconds.
	readonly longestMs: number
	// Highest geometric altitude of Jupiter over the event interval.
	readonly peakAltitude?: number
	// Kasten–Young airmass at the peak altitude; absent below the horizon.
	readonly peakAirmass?: number
	// Geometric altitude of the Sun's centre at the maximum.
	readonly sunAltitude?: number
	// Why the event, or part of it, cannot be watched; empty when it can be watched whole.
	readonly reasons: readonly JupiterVisibilityReason[]
	// Position among the watchable events of the answer, 1 the best (longest watchable part, then highest peak); absent
	// when nothing of it can be watched.
	readonly rank?: number
}

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
export interface JupiterNight {
	// Civil date of the evening in the site's zone.
	readonly eveningDate: string
	// The night, from the Sun's upper transit to the next, Unix milliseconds.
	readonly start: number
	readonly end: number
	// Sunset and sunrise, Unix milliseconds; absent when the Sun does not set or rise.
	readonly sunset?: number
	readonly sunrise?: number
	// Stretches with Jupiter at or above the planetary minimum altitude and the Sun at or below the planetary limit.
	readonly windows: readonly TimeSpan[]
}

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

// Spacing of the altitude samples of an event interval, milliseconds.
const ALTITUDE_SAMPLE_MS = 600_000

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

// Unix milliseconds of an optional toolkit instant.
function ms(time: Time | undefined) {
	return time === undefined ? undefined : timeToUnixMillis(time)
}

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
			const contacts: JupiterEventContacts = { external1: ms(p.external1), internal1: ms(p.internal1), center1: ms(p.center1), center2: ms(p.center2), internal2: ms(p.internal2), external2: ms(p.external2), visibleStart: ms(p.visibleStart), visibleEnd: ms(p.visibleEnd) }
			push({ kind: p.kind, moons: [p.moon], start: contacts.external1 ?? maximum, maximum, end: contacts.external2 ?? maximum, contacts: definedContacts(contacts), grazing: p.grazing, depth: p.depth })
		}

		for (const e of chunk.mutual) {
			const maximum = timeToUnixMillis(e.middle)
			const contacts = definedContacts({ external1: ms(e.start), external2: ms(e.end) })
			push({ kind: e.kind === 'occultation' ? 'mutualOccultation' : 'mutualEclipse', moons: [e.front, e.back], start: contacts.external1 ?? maximum, maximum, end: contacts.external2 ?? maximum, contacts, grazing: false, impactParameter: e.impactParameter })
		}

		for (const t of chunk.grs) {
			push({ kind: 'grsTransit', moons: [], start: t.start, maximum: t.maximum, end: t.end, contacts: {}, grazing: false, grs: { longitude: t.longitude, referenceAgeDays: (t.maximum - grs!.referenceTime) / 86_400_000, halfWidth: GRS_VIEWING_HALF_WIDTH } })
		}
	}

	events.sort((a, b) => a.maximum - b.maximum || a.id.localeCompare(b.id))
	return events
}

// Contacts without their undefined entries.
function definedContacts(contacts: JupiterEventContacts): JupiterEventContacts {
	const defined: Record<string, number> = {}
	for (const [key, value] of Object.entries(contacts)) if (value !== undefined) defined[key] = value
	return defined
}

// Intersection of two sorted lists of spans.
function intersect(a: readonly TimeSpan[], b: readonly TimeSpan[]): TimeSpan[] {
	const out: TimeSpan[] = []

	for (const x of a) {
		for (const y of b) {
			const start = Math.max(x.start, y.start)
			const end = Math.min(x.end, y.end)
			if (end > start) out.push({ start, end })
		}
	}

	return out.sort((x, y) => x.start - y.start)
}

// Spans of `spans` with the parts covered by `holes` removed.
function subtract(spans: readonly TimeSpan[], holes: readonly TimeSpan[]): TimeSpan[] {
	let out = [...spans]

	for (const hole of holes) {
		const next: TimeSpan[] = []

		for (const span of out) {
			if (hole.end <= span.start || hole.start >= span.end) next.push(span)
			else {
				if (hole.start > span.start) next.push({ start: span.start, end: hole.start })
				if (hole.end < span.end) next.push({ start: hole.end, end: span.end })
			}
		}

		out = next
	}

	return out
}

// Total length of spans, milliseconds.
function totalMs(spans: readonly TimeSpan[]) {
	let sum = 0
	for (const span of spans) sum += span.end - span.start
	return sum
}

// Intervals in which a moon is hidden from the Earth, by moon: its centre behind Jupiter's limb (occulted) or inside
// Jupiter's umbra (eclipsed).
interface HiddenIntervals {
	readonly occulted: Readonly<Record<GalileanMoon, readonly TimeSpan[]>>
	readonly eclipsed: Readonly<Record<GalileanMoon, readonly TimeSpan[]>>
}

// Collects the centre-contact intervals of the occultations and eclipses of every moon.
function hiddenIntervals(events: readonly ScannedEvent[]): HiddenIntervals {
	const occulted: Record<GalileanMoon, TimeSpan[]> = { io: [], europa: [], ganymede: [], callisto: [] }
	const eclipsed: Record<GalileanMoon, TimeSpan[]> = { io: [], europa: [], ganymede: [], callisto: [] }

	for (const event of events) {
		if (event.kind !== 'satelliteOccultation' && event.kind !== 'satelliteEclipse') continue
		const { center1, center2 } = event.contacts
		if (center1 === undefined || center2 === undefined) continue
		const into = event.kind === 'satelliteOccultation' ? occulted : eclipsed
		into[event.moons[0]].push({ start: center1, end: center2 })
	}

	return { occulted, eclipsed }
}

// The physically visible part of an event, before any site, and why part of it is not.
interface VisiblePart {
	readonly spans: readonly TimeSpan[]
	readonly reason?: JupiterVisibilityReason
}

// The part of an event that is physically visible from the Earth: a shadow transit while its centre faces the Earth,
// an eclipse while the moon is not behind the disk (its fading is what is watched), a mutual event while neither moon
// is behind the disk or in the umbra; transits, occultations and Great Red Spot transits whole. A zero-length event is
// one instant, visible or not.
function physicallyVisible(event: ScannedEvent, { occulted, eclipsed }: HiddenIntervals): VisiblePart {
	const whole: TimeSpan[] = [{ start: event.start, end: Math.max(event.end, event.start) }]
	let holes: readonly TimeSpan[] = []
	let reason: JupiterVisibilityReason = 'moonHidden'

	if (event.kind === 'shadowTransit') {
		const { visibleStart, visibleEnd } = event.contacts
		const facing = visibleStart !== undefined && visibleEnd !== undefined ? [{ start: visibleStart, end: visibleEnd }] : []
		holes = subtract(whole, facing)
		reason = 'shadowHidden'
	} else if (event.kind === 'satelliteEclipse') {
		holes = occulted[event.moons[0]]
	} else if (event.kind === 'mutualOccultation' || event.kind === 'mutualEclipse') {
		holes = event.moons.flatMap((moon) => [...occulted[moon], ...eclipsed[moon]])
	}

	const hit = holes.some((hole) => hole.start <= event.end && hole.end >= event.start)
	if (!hit) return { spans: whole }
	if (event.end <= event.start) return { spans: [], reason }
	return { spans: subtract(whole, holes), reason }
}

// A night of a site prepared for the visibility of the events.
interface SiteNight {
	readonly planning: PlanningNight
	readonly night: JupiterNight
}

// The planning nights of a site covering [start, end): each with its PlanningNight and Jupiter's watchable windows.
// Yields to the event loop between nights, whose Sun and Moon take a noticeable time to compute the first time.
async function siteNights(nights: (request: AstroWeatherNightRequest) => AstroWeatherNight, site: PlanningSite, start: number, end: number, signal?: AbortSignal) {
	const out: SiteNight[] = []
	const { minimumAltitude, maximumSunAltitude } = OBSERVING_PRESETS.planetary
	let time = start

	while (time < end) {
		if (out.length > 0) {
			await yieldToEventLoop()
			signal?.throwIfAborted()
		}

		const night = nights({ observer: site, timeZone: site.timeZone, time })
		const planning = new PlanningNight(site, night)
		const found = visibilityWindows(planning.bodyAt('599'), planning.location, planning.start, planning.end, { minimumAltitude, maximumSunAltitude }, { sunAt: planning.sunAt, step: SEARCH_STEP_DAYS })
		const windows = found.map((e) => ({ start: timeToUnixMillis(e.start), end: timeToUnixMillis(e.end) }))
		out.push({ planning, night: { eveningDate: night.sun.localDate, start: night.sun.start, end: night.sun.end, sunset: night.sun.sunset, sunrise: night.sun.sunrise, windows } })
		time = night.sun.end
	}

	return out
}

// Visibility of an event from the nights of a site. A zero-length event is observable when its instant is physically
// visible and inside a watchable window.
function siteVisibility(event: ScannedEvent, visible: VisiblePart, nights: readonly SiteNight[]): JupiterEventVisibility {
	const { minimumAltitude, maximumSunAltitude } = OBSERVING_PRESETS.planetary
	const watchable = nights.flatMap((e) => e.night.windows)
	const windows = intersect(visible.spans, watchable)
	let longestMs = 0
	for (const window of windows) longestMs = Math.max(longestMs, window.end - window.start)
	const whole = Math.max(event.end - event.start, 0)
	const covered = totalMs(windows)
	const instant = whole === 0 && visible.spans.length > 0 && watchable.some((e) => event.maximum >= e.start && event.maximum <= e.end)
	const status: JupiterVisibilityStatus = whole === 0 ? (instant ? 'observable' : 'notObservable') : longestMs === 0 ? 'notObservable' : covered >= whole - 1000 ? 'observable' : 'partial'

	// The night holding the maximum, or the nearest one.
	const holder = nights.find((e) => event.maximum >= e.night.start && event.maximum < e.night.end) ?? nights[0]
	const { planning } = holder
	const location = planning.location
	const jupiterAt = planning.bodyAt('599')
	const altitude = (time: number) => {
		const t = planning.time(time)
		return altitudeOf(jupiterAt(t), t, location)
	}
	const sunAltitude = (time: number) => {
		const t = planning.time(time)
		return altitudeOf(planning.sunAt(t), t, location)
	}

	let peakAltitude = altitude(event.maximum)
	for (let time = event.start; time <= event.end; time += ALTITUDE_SAMPLE_MS) peakAltitude = Math.max(peakAltitude, altitude(time))
	peakAltitude = Math.max(peakAltitude, altitude(event.end))

	const reasons = new Set<JupiterVisibilityReason>()
	if (visible.reason) reasons.add(visible.reason)

	if (status !== 'observable') {
		// Explain the longest part of the physically visible interval the site cannot watch.
		const missed = subtract(visible.spans, windows).sort((a, b) => b.end - b.start - (a.end - a.start))[0]
		const probe = missed ? (missed.start + missed.end) / 2 : event.maximum
		if (sunAltitude(probe) > maximumSunAltitude) reasons.add('sunTooHigh')
		if (altitude(probe) < minimumAltitude) reasons.add('jupiterTooLow')
	}

	return {
		status,
		eveningDate: holder.night.eveningDate,
		windows,
		longestMs,
		peakAltitude,
		peakAirmass: peakAltitude > 0 ? airmassKastenYoung(peakAltitude) : undefined,
		sunAltitude: sunAltitude(event.maximum),
		reasons: [...reasons],
	}
}

// Ids of the events whose intervals intersect each event's, a zero-length event intersecting what contains its instant.
function overlapsOf(events: readonly ScannedEvent[]): string[][] {
	return events.map((a) => events.filter((b) => b !== a && a.start <= b.end && b.start <= a.end && (a.end > a.start || b.end > b.start)).map((b) => b.id))
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
	const hidden = hiddenIntervals(all)
	const selected = all.filter((e) => kinds.has(e.kind) && (e.moons.length === 0 || e.moons.some((moon) => moons.has(moon))))
	const overlaps = overlapsOf(selected)
	// Nights over the padded range, so the parts of the events beyond the range are judged too.
	const siteNightList = site ? await siteNights(nights, site, from, to, signal) : []

	const events: JupiterEvent[] = []

	for (let i = 0; i < selected.length; i++) {
		if (site && i > 0 && i % VISIBILITY_YIELD_EVERY === 0) {
			await yieldToEventLoop()
			signal?.throwIfAborted()
		}

		const event = selected[i]
		const visibility: JupiterEventVisibility = site ? siteVisibility(event, physicallyVisible(event, hidden), siteNightList) : { status: 'unknownNoSite', windows: [], longestMs: 0, reasons: physicallyVisibleReason(event, hidden) }
		events.push({ ...event, overlaps: overlaps[i], visibility })
	}

	rank(events)
	const shown = siteNightList.map((e) => e.night).filter((e) => e.end > start && e.start < end)
	return { start, end, events, nights: shown, sourced: { source, snapshot }, grsUsed: model !== undefined }
}

// Reasons an event is partly hidden from the Earth whatever the site.
function physicallyVisibleReason(event: ScannedEvent, hidden: HiddenIntervals): JupiterVisibilityReason[] {
	const { reason } = physicallyVisible(event, hidden)
	return reason ? [reason] : []
}

// Ranks the watchable events in place: the longest watchable part first, then the highest peak altitude.
function rank(events: JupiterEvent[]) {
	const watchable = events.filter((e) => e.visibility.longestMs > 0).sort((a, b) => b.visibility.longestMs - a.visibility.longestMs || (b.visibility.peakAltitude ?? 0) - (a.visibility.peakAltitude ?? 0))
	const ranks = new Map(watchable.map((e, i) => [e.id, i + 1]))

	for (let i = 0; i < events.length; i++) {
		const value = ranks.get(events[i].id)
		if (value !== undefined) events[i] = { ...events[i], visibility: { ...events[i].visibility, rank: value } }
	}
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

// Spacing of the readiness probes, milliseconds.
const PROBE_STEP_MS = 6 * 3_600_000

// Probes the kernels over a range: every Jovian body at every 6 hours, both ends included. Not a guarantee for a scan,
// which evaluates many more epochs, but an explanation of what the kernels lack.
export function kernelReadiness(snapshot: SpiceKernelSnapshot, { start, end }: JupiterSourceRequest): JupiterSourceReport {
	const { policy, generation } = snapshot
	const unready = (readiness: JupiterKernelReadiness, reason: JupiterFallbackReason, probes: number, miss?: JupiterSourceMiss): JupiterSourceReport => ({ readiness, source: policy === 'spkOnly' ? 'unavailable' : 'analytical', reason, ...(miss && { miss }), policy, generation, probes })
	const fallback = snapshotReason(snapshot)
	if (fallback) return unready('missingDependencies', fallback.reason, 0, fallback.miss)

	const ephemeris = spkJovianEphemeris(snapshot.set!)
	let probes = 0

	for (let time = start; ; time = Math.min(end, time + PROBE_STEP_MS)) {
		probes++

		for (const body of JOVIAN_BODIES) {
			try {
				ephemeris.position(body, toolkitTime(time))
			} catch (error) {
				if (!(error instanceof JovianEphemerisMiss)) throw error
				const reason = missReason(error)
				const readiness = reason === 'outOfCoverage' ? 'partialCoverage' : reason === 'unsupportedFrame' || reason === 'unsupportedType' ? 'unsupported' : 'missingDependencies'
				return unready(readiness, reason, probes, { target: error.target, body: error.body, time })
			}
		}

		if (time >= end) break
	}

	return { readiness: 'readyForJupiter', source: 'spk', policy, generation, probes }
}
