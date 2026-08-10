import { DEFAULT_REFRACTION_PARAMETERS } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { eraAnpm, eraApco13, eraAtciqz, eraAtioq, eraC2s, eraS2p } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import type { EraAstrom } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { eraMoon98 } from 'nebulosa/src/astronomy/coordinates/erfa/moon'
import * as vsop from 'nebulosa/src/astronomy/ephemeris/models/analytical/vsop87e'
import { airmassKastenYoung } from 'nebulosa/src/astronomy/formulas'
import { Ellipsoid, geodeticLocation } from 'nebulosa/src/astronomy/observer/location'
import type { GeographicPosition } from 'nebulosa/src/astronomy/observer/location'
import { pmAngles, tt, ut1 } from 'nebulosa/src/astronomy/time/time'
import { ELLIPSOID_PARAMETERS, PIOVERTWO } from 'nebulosa/src/core/constants'
import { vecAngle, vecLength } from 'nebulosa/src/math/linear-algebra/vec3'
import type { MutVec3, Vec3 } from 'nebulosa/src/math/linear-algebra/vec3'
import { normalizeAngle } from 'nebulosa/src/math/units/angle'
import type { Angle } from 'nebulosa/src/math/units/angle'
import { makeTime } from 'src/api/util'
import type { DiscardedTarget, PlanTargets, PlannedTarget, TargetPlanCandidate, TargetPlanConstraint, TargetPlanDiscardReason } from '#/sequencer.planner'
import { response } from './http'
import type { Endpoints } from './http'

// Target planner for the Sequencer. It is a pure pre-process that orders candidate targets for one night
// and reports, per target, the visibility window and the constraint set that produced the order, so a later
// feasibility gate can re-evaluate the premise against the real clock instead of recomputing ephemerides.
// It touches no device, no session, and no store, and it is the only place in the Sequencer where
// ephemerides are computed. Angles are radians, distances AU, instants Unix milliseconds, and durations
// seconds on the transport boundary and milliseconds internally.

// Default sampling interval, in seconds, used to scan the window for visibility.
// Five minutes resolves every visibility edge coarsely, and the edges are then refined by bisection.
const DEFAULT_STEP = 300

// Maximum number of time samples one request may evaluate.
// The requested step is raised until the window fits, which is what stops a tiny step over a long window
// from allocating and computing without bound.
const MAX_SAMPLES = 4096

// Bisection halvings applied to a visibility edge found between two grid samples.
// Eight halvings turn the default 300 s step into about 1.2 s, well below anything a session can act on.
const EDGE_REFINEMENT_ITERATIONS = 8

// Width the bracket around the turn of the candidate's Moon separation is reduced to, milliseconds.
// Matches the resolution the edge refinement reaches, so both boundaries of a run are located to the same
// second and no violation wider than that survives the refinement.
const TURN_REFINEMENT_TOLERANCE = 1000

// Cap on the evaluations spent narrowing that bracket, which the golden-section fallback alone reaches from a
// two-hour sampling step in about twenty steps. Parabolic steps converge much faster and normally end it first.
const MAX_TURN_REFINEMENT_ITERATIONS = 32

// Fraction of the wider half of the bracket taken by a golden-section step, (3 - sqrt(5)) / 2.
// It is the step that shrinks the bracket the most per evaluation when the parabola cannot be trusted.
const GOLDEN_SECTION_RATIO = 0.3819660112501051

// Rate at which the Earth rotation angle advances, radians per second of UTC.
// It is the mean sidereal rate, and the hour angle of a fixed direction follows it to about 13 ms of drift over
// a four-hour extrapolation, measured against a golden-section maximization of the real altitude curve.
const ERA_RATE = (2 * Math.PI * 1.00273781191135448) / 86400

// Half a sidereal day in milliseconds, the interval between a culmination and the lower culmination that
// follows it. Those two instants are the only ones where the apparent altitude of a fixed direction turns.
const HALF_SIDEREAL_DAY = (Math.PI / ERA_RATE) * 1000

// Sky state at one instant, shared by every candidate evaluated at that instant.
// The ERFA astrometry context is the expensive part and the reason samples are computed once for all targets.
interface SkySample {
	// Instant of the sample, Unix milliseconds.
	readonly utc: number
	// ICRS-to-observed astrometry context for the site at this instant.
	readonly astrom: EraAstrom
	// Topocentric Moon position in ICRS axes, AU: the geocentric vector shifted to the observer, which is what
	// removes the up-to-one-degree lunar parallax from a site-specific separation constraint.
	readonly moon: Vec3
	// Illuminated fraction of the lunar disk, normalized to [0, 1].
	readonly moonIllumination: number
	// Apparent altitude of the Sun at the site, radians.
	readonly sunAltitude: Angle
}

// A candidate that survived the visibility scan and is ready to be scheduled.
interface FeasibleTarget {
	readonly candidate: TargetPlanCandidate
	// Constraints after merging the request-level defaults with the candidate overrides.
	readonly constraints: TargetPlanConstraint
	// Longest continuous interval in which every constraint holds, Unix milliseconds.
	readonly visibilityStart: number
	readonly visibilityEnd: number
	// Instant of maximum altitude inside that interval, Unix milliseconds: the culmination when the interval holds
	// one, and the higher of its two ends otherwise.
	readonly transit: number
	readonly maximumAltitude: Angle
	readonly moonDistance: Angle
	// Observation time the candidate asked for, milliseconds.
	readonly duration: number
}

// Computes the shared sky state at one instant for one site.
// utc is a Unix timestamp in milliseconds; the returned context is valid only for that instant and site.
function skySample(utc: number, location: GeographicPosition): SkySample {
	const time = makeTime(utc, location)
	const ebpv = vsop.earth(time)
	const [sunBarycentric] = vsop.sun(time)

	// Heliocentric Earth position, which ERFA needs for light deflection, and its negation, the geocentric Sun direction.
	const ehp: MutVec3 = [ebpv[0][0] - sunBarycentric[0], ebpv[0][1] - sunBarycentric[1], ebpv[0][2] - sunBarycentric[2]]
	const sun: Vec3 = [-ehp[0], -ehp[1], -ehp[2]]

	const a = tt(time)
	const b = ut1(time)
	const [sp, xp, yp] = pmAngles(time)
	const { pressure, temperature, relativeHumidity, wl } = DEFAULT_REFRACTION_PARAMETERS
	const { radius, flattening } = ELLIPSOID_PARAMETERS[location.ellipsoid ?? Ellipsoid.IERS2010]
	const astrom = eraApco13(a.day, a.fraction, b.day, b.fraction, location.longitude, location.latitude, location.elevation, xp, yp, sp, pressure, temperature, relativeHumidity, wl, ebpv, ehp, radius, flattening)

	const [geocentricMoon] = eraMoon98(a.day, a.fraction)

	// Observer relative to the geocentre, AU: eb is the SSB-to-observer vector the context already carries and
	// ebpv[0] is the SSB-to-geocentre one, so the difference costs nothing beyond three subtractions.
	const { eb } = astrom
	const moon: Vec3 = [geocentricMoon[0] - (eb[0] - ebpv[0][0]), geocentricMoon[1] - (eb[1] - ebpv[0][1]), geocentricMoon[2] - (eb[2] - ebpv[0][2])]

	const sunAltitude = observedAltitude(astrom, ...eraC2s(...sun))

	// Illumination stays geocentric: it is a property of the Sun-Earth-Moon geometry and the topocentric shift
	// changes the phase angle by far less than the resolution any illumination threshold is expressed in.
	return { utc, astrom, moon, moonIllumination: moonIlluminatedFraction(sun, geocentricMoon), sunAltitude }
}

// Apparent altitude of an ICRS/J2000 direction at the site and instant the context was built for, in radians.
// This is the tail of icrsToObserved with the context already built, which is what lets one context serve
// every candidate of a sample instead of rebuilding the expensive ERFA setup per target.
function observedAltitude(astrom: EraAstrom, rightAscension: Angle, declination: Angle): Angle {
	const [ri, di] = eraAtciqz(rightAscension, declination, astrom)
	const [, zenith] = eraAtioq(normalizeAngle(ri), di, astrom)
	return PIOVERTWO - zenith
}

// Illuminated fraction of the lunar disk from the geocentric Sun and Moon position vectors, both in AU.
// Follows Meeus, Astronomical Algorithms, chapter 48, in the atan2 form of 48.2, which stays stable at new
// and full Moon where the tangent form does not. The returned value is normalized to [0, 1].
function moonIlluminatedFraction(sun: Vec3, moon: Vec3) {
	const elongation = vecAngle(sun, moon)
	const sunDistance = vecLength(sun)
	const moonDistance = vecLength(moon)
	const phaseAngle = Math.atan2(sunDistance * Math.sin(elongation), moonDistance - sunDistance * Math.cos(elongation))
	return (1 + Math.cos(phaseAngle)) / 2
}

// Angular separation between an ICRS/J2000 direction and the Moon as seen from the site, in radians.
// The Moon is topocentric because lunar parallax reaches about one degree near the horizon, enough to flip the
// decision for a target sitting near the requested limit. Both directions are astrometric, so annual aberration
// and light deflection cancel to well under an arcminute and are not applied.
function moonDistanceOf(sample: SkySample, rightAscension: Angle, declination: Angle): Angle {
	return vecAngle(eraS2p(rightAscension, declination, 1), sample.moon)
}

// Reports the constraint violated by the sky itself, independently of where the target is, or undefined when none is.
function violatedSkyConstraint(sample: SkySample, constraints: TargetPlanConstraint): TargetPlanDiscardReason | undefined {
	if (constraints.maximumSunAltitude !== undefined && sample.sunAltitude > constraints.maximumSunAltitude) return 'sunTooHigh'
	if (constraints.maximumMoonIllumination !== undefined && sample.moonIllumination > constraints.maximumMoonIllumination) return 'moonTooBright'
	return undefined
}

// Reports the constraint violated by the target's own position, or undefined when none is.
// altitude and moonDistance are radians.
function violatedPointingConstraint(altitude: Angle, moonDistance: Angle, constraints: TargetPlanConstraint): TargetPlanDiscardReason | undefined {
	if (constraints.minimumAltitude !== undefined && altitude < constraints.minimumAltitude) return 'belowMinimumAltitude'
	if (constraints.maximumAltitude !== undefined && altitude > constraints.maximumAltitude) return 'aboveMaximumAltitude'
	// Below the horizon the airmass is unbounded and the Kasten-Young approximation is undefined, so the limit is violated by construction.
	if (constraints.maximumAirmass !== undefined && (altitude <= 0 || airmassKastenYoung(altitude) > constraints.maximumAirmass)) return 'airmassTooHigh'
	if (constraints.minimumMoonDistance !== undefined && moonDistance < constraints.minimumMoonDistance) return 'moonTooClose'
	return undefined
}

// Reports whether every constraint holds for the target at the given instant, building the sky state on the spot.
// Used only to refine a visibility edge already bracketed on the sampling grid.
function visibleAt(utc: number, candidate: TargetPlanCandidate, constraints: TargetPlanConstraint, location: GeographicPosition) {
	const sample = skySample(utc, location)
	if (violatedSkyConstraint(sample, constraints)) return false
	const altitude = observedAltitude(sample.astrom, candidate.rightAscension, candidate.declination)
	const moonDistance = moonDistanceOf(sample, candidate.rightAscension, candidate.declination)
	return violatedPointingConstraint(altitude, moonDistance, constraints) === undefined
}

// Narrows a visibility edge bracketed between an instant where the target is not visible and one where it is.
// invisible and visible are Unix milliseconds in either chronological order; the returned instant is the
// visible side of the edge, so the reported window never claims more visibility than was verified.
function refineEdge(invisible: number, visible: number, candidate: TargetPlanCandidate, constraints: TargetPlanConstraint, location: GeographicPosition) {
	for (let i = 0; i < EDGE_REFINEMENT_ITERATIONS; i++) {
		const middle = (invisible + visible) / 2
		if (visibleAt(middle, candidate, constraints, location)) visible = middle
		else invisible = middle
	}

	return visible
}

// Apparent altitude and Moon separation of a candidate at one instant, both radians, building the sky state on
// the spot. Used for the boundaries of a visibility interval, which are refined instants and therefore fall
// between the evaluated points rather than on one of them.
function pointingAt(utc: number, candidate: TargetPlanCandidate, location: GeographicPosition): readonly [Angle, Angle] {
	const sample = skySample(utc, location)
	return [observedAltitude(sample.astrom, candidate.rightAscension, candidate.declination), moonDistanceOf(sample, candidate.rightAscension, candidate.declination)]
}

// Refines the instant where the candidate's Moon separation turns, bracketed by three evaluated points,
// t0 < t1 < t2 in Unix milliseconds, whose values v0, v1, v2 are radians with v1 the extremum of the three.
// The direction follows the bracket, so the closest approach of the Moon is refined as the minimum it is.
// Only the lunar curve is refined this way: the Moon moves against the sky, so its separation from a target has
// no closed form, while the altitude turns of a fixed direction are computed by culminationAt.
//
// This is a safeguarded successive parabolic interpolation: each step fits a parabola through the current
// triple, evaluates the real curve at its vertex, and keeps the vertex as the new middle point when it is a
// better extremum, otherwise as the new bracket end on its side. The vertex of a single parabola through coarse
// samples is only an approximation of the turn of the real curve, tens of seconds away from it at a five-minute
// step and far more than that at a coarse one, which is enough to miss the violation the turn was evaluated to
// find. A fixed number of steps is not enough either: the parabola can crawl towards the turn instead of
// converging on it, and a step of hours then leaves the closest approach unevaluated and its crossing unseen.
//
// The step is therefore accepted only when it is at most half the previous one and keeps the tolerance away from
// both ends of the bracket, and a golden-section step into the wider half is taken otherwise. That is what makes
// the bracket shrink geometrically in the worst case, and the loop runs until it is narrower than the tolerance.
//
// Returns the best instant found, always inside the original bracket.
function refineMoonTurn(t0: number, t1: number, t2: number, v0: number, v1: number, v2: number, candidate: TargetPlanCandidate, location: GeographicPosition): number {
	const maximum = v1 >= v0 && v1 >= v2
	let previousStep = t2 - t0

	for (let i = 0; i < MAX_TURN_REFINEMENT_ITERATIONS && t2 - t0 > TURN_REFINEMENT_TOLERANCE; i++) {
		const vertex = turningInstant(t0, t1, t2, v0, v1, v2)
		const useful = vertex > 0 && Math.abs(vertex - t1) <= previousStep / 2 && vertex - t0 > TURN_REFINEMENT_TOLERANCE && t2 - vertex > TURN_REFINEMENT_TOLERANCE
		const next = useful ? vertex : t2 - t1 > t1 - t0 ? t1 + GOLDEN_SECTION_RATIO * (t2 - t1) : t1 - GOLDEN_SECTION_RATIO * (t1 - t0)

		previousStep = Math.abs(next - t1)

		const value = pointingAt(next, candidate, location)[1]

		if (maximum ? value > v1 : value < v1) {
			if (next < t1) {
				t2 = t1
				v2 = v1
			} else {
				t0 = t1
				v0 = v1
			}

			t1 = next
			v1 = value
		} else if (next < t1) {
			t0 = next
			v0 = value
		} else {
			t2 = next
			v2 = value
		}
	}

	return t1
}

// Instant of the candidate's culmination nearest to the given sky sample, Unix milliseconds, which may fall
// outside the request window.
//
// The apparent altitude of a fixed direction peaks when its hour angle is zero: refraction is a monotone
// function of the true altitude and the remaining terms of the transformation are symmetric about the meridian,
// so the observed maximum sits within 50 ms of that instant, measured against a golden-section maximization of
// the real curve at declinations from -70 to +36 degrees. Computing the culmination replaces searching for it
// between samples, which no sampled bracket resolves reliably next to a window boundary and no parabola
// resolves at all near the zenith, where the altitude curve is sharply peaked.
//
// The hour angle comes from the sample's own astrometry context and is carried to zero at the Earth rotation
// rate, which drifts by about 13 ms over four hours, so any sample of the night serves.
function culminationAt(sample: SkySample, candidate: TargetPlanCandidate): number {
	const [ri] = eraAtciqz(candidate.rightAscension, candidate.declination, sample.astrom)
	// Wrapped to -PI..PI so the culmination located is the nearest one: positive means it already happened.
	const hourAngle = eraAnpm(sample.astrom.eral - ri)
	return sample.utc - (hourAngle / ERA_RATE) * 1000
}

// Merges the request-level constraints with the candidate overrides, property by property.
function mergeConstraints(base: TargetPlanConstraint | undefined, override: TargetPlanConstraint | undefined): TargetPlanConstraint {
	if (!base) return override ?? {}
	if (!override) return base
	return { ...base, ...override }
}

// Orders the feasible targets and allocates a slot to each one.
//
// The policy is earliest-deadline-first among the targets already up at the cursor: whatever sets first is
// observed first. When nothing is up yet the cursor jumps to the next target to rise instead of idling one
// sample at a time.
//
// Choosing only among the targets already up is not enough when durations differ, because a long target
// started now can outlive a short window that has not opened yet. So before committing a slot the scheduler
// looks one release ahead: if the target it is about to start would leave a tighter, not-yet-risen target with
// no room, and observing that one first still leaves room for the current choice, it waits for the release
// instead. Maximizing the number of targets exactly is NP-hard once releases, deadlines, and durations all
// vary, so this stays a heuristic; it is the cheapest lookahead that removes the obvious loss.
//
// anchor is the instant the session is assumed to begin, Unix milliseconds. Every iteration either removes
// one target from the pending set or strictly advances the cursor to a later release, so the loop always
// terminates.
function schedule(pending: FeasibleTarget[], anchor: number, discarded: DiscardedTarget[]): PlannedTarget[] {
	const planned: PlannedTarget[] = []
	let cursor = anchor

	while (pending.length > 0) {
		let chosen = -1
		let earliestDeadline = Infinity
		let earliestRelease = Infinity
		// Tightest target still to rise, which is the one a slot committed now is most likely to destroy.
		let tightest = -1
		let tightestDeadline = Infinity

		for (let i = 0; i < pending.length; i++) {
			const target = pending[i]

			// A target that occupies time expires once the cursor reaches the end of its window. One with no
			// declared duration consumes none, so it stays eligible at the endpoint itself, which is a verified
			// visible instant: the contract defines a zero duration as asking for an ordering only.
			if (target.duration > 0 ? target.visibilityEnd <= cursor : target.visibilityEnd < cursor) continue

			if (target.visibilityStart <= cursor) {
				if (target.visibilityEnd < earliestDeadline) {
					earliestDeadline = target.visibilityEnd
					chosen = i
				}
			} else {
				if (target.visibilityStart < earliestRelease) earliestRelease = target.visibilityStart

				if (target.visibilityEnd < tightestDeadline) {
					tightestDeadline = target.visibilityEnd
					tightest = i
				}
			}
		}

		// Nothing is up at the cursor: wait for the next target to rise, or stop when every remaining window has closed.
		if (chosen < 0) {
			if (!Number.isFinite(earliestRelease)) break
			cursor = earliestRelease
			continue
		}

		const target = pending[chosen]

		// One-step lookahead. Only a target that sets earlier than the current choice is worth waiting for, and
		// only when starting now would actually leave it without room and observing it first still leaves room
		// for the current choice. The cursor moves strictly forward to the release, so the loop still terminates.
		if (tightest >= 0 && tightestDeadline < earliestDeadline) {
			const next = pending[tightest]
			const losesNext = Math.max(cursor + target.duration, next.visibilityStart) + next.duration > next.visibilityEnd
			const keepsChosen = next.visibilityStart + next.duration + target.duration <= target.visibilityEnd

			if (losesNext && keepsChosen) {
				cursor = next.visibilityStart
				continue
			}
		}

		pending.splice(chosen, 1)

		const slotStart = Math.max(cursor, target.visibilityStart)
		const slotEnd = slotStart + target.duration

		if (slotEnd > target.visibilityEnd) {
			discarded.push({ id: target.candidate.id, name: target.candidate.name, reason: 'noRemainingTime' })
			continue
		}

		planned.push({
			id: target.candidate.id,
			name: target.candidate.name,
			order: planned.length,
			visibilityStart: target.visibilityStart,
			visibilityEnd: target.visibilityEnd,
			slotStart,
			slotEnd,
			transit: target.transit,
			maximumAltitude: target.maximumAltitude,
			moonDistance: target.moonDistance,
			constraints: target.constraints,
		})

		cursor = slotEnd
	}

	for (const target of pending) {
		discarded.push({ id: target.candidate.id, name: target.candidate.name, reason: 'noRemainingTime' })
	}

	return planned
}

// Returns the longest visibility interval among the runs of set flags in the first count entries, as its refined
// boundaries in Unix milliseconds. flags marks
// the evaluated points where every constraint holds and instants holds their sorted, unequally spaced times:
// the sequence carries extra points at the turns of the curves being scanned, so counting flags would let a
// run win merely for containing one. windowStart and windowEnd close a run that reaches an end of the request
// window, where the truncation is the window and not a constraint, so there is no edge to refine.
//
// Each run is measured after both of its edges are refined, because a run reaches past the evaluated points
// that produced it by a different amount at each end: comparing the innermost evaluated points instead can
// order two runs by where the grid happened to fall rather than by how long they last. The caller only calls
// it when at least one flag is set, so the returned bounds are always a real run.
function longestInterval(flags: Uint8Array, instants: Float64Array, count: number, windowStart: number, windowEnd: number, candidate: TargetPlanCandidate, constraints: TargetPlanConstraint, location: GeographicPosition): readonly [number, number] {
	let bestStart = windowStart
	let bestEnd = windowStart
	let bestElapsed = -1
	let currentFirst = -1

	for (let i = 0; i < count; i++) {
		if (flags[i] === 0) {
			currentFirst = -1
			continue
		}

		if (currentFirst < 0) currentFirst = i

		// The run continues, so there is nothing to measure yet.
		if (i < count - 1 && flags[i + 1] === 1) continue

		const start = currentFirst === 0 ? windowStart : refineEdge(instants[currentFirst - 1], instants[currentFirst], candidate, constraints, location)
		const end = i === count - 1 ? windowEnd : refineEdge(instants[i + 1], instants[i], candidate, constraints, location)
		const elapsed = end - start

		if (elapsed > bestElapsed) {
			bestElapsed = elapsed
			bestStart = start
			bestEnd = end
		}

		currentFirst = -1
	}

	return [bestStart, bestEnd]
}

// Instant where the parabola through three consecutive samples of a smooth curve turns, or -1 when the three
// samples carry no interior turn. Instants are Unix milliseconds and need not be equally spaced; values are
// whatever quantity is being tracked, in its own unit.
//
// This is what makes a sampled scan able to see between its own samples. Every quantity the planner constrains
// is smooth and turns at most once per sampling neighbourhood, so a crossing hidden between two samples of
// equal feasibility can only happen around a turn: anywhere else the quantity is monotonic over the interval
// and a crossing would show up as two samples that disagree, which the edge refinement already brackets.
function turningInstant(t0: number, t1: number, t2: number, v0: number, v1: number, v2: number) {
	// A turn requires the middle sample to be an extremum of the three; a flat triple has nothing to refine.
	if (v0 === v1 && v1 === v2) return -1
	if (!((v1 >= v0 && v1 >= v2) || (v1 <= v0 && v1 <= v2))) return -1

	const first = (v1 - v0) / (t1 - t0)
	const second = ((v2 - v1) / (t2 - t1) - first) / (t2 - t0)

	// Near-collinear samples put the vertex arbitrarily far away, so there is nothing worth evaluating.
	if (Math.abs(second) < 1e-30) return -1

	const vertex = (t0 + t1) / 2 - first / (2 * second)

	// Reject a vertex that rounding pushed outside the bracket, and one that lands on a sample already evaluated.
	if (!(vertex > t0 && vertex < t2)) return -1
	if (Math.abs(vertex - t1) < 1) return -1

	return vertex
}

export class SequencerPlannerHandler {
	// Orders candidate targets for one night and reports why each discarded candidate was dropped.
	// The result is valid only under the anchor, site, and window it reports: it is an input to a definition,
	// never an executable plan.
	planTargets(req: PlanTargets) {
		const { location, start, end, targets } = req
		const span = end - start

		const position = geodeticLocation(location.longitude, location.latitude, location.elevation)

		// A window that does not move forward has no visibility to offer, and no sample would tell us otherwise.
		if (span <= 0) {
			return {
				anchor: start,
				location,
				end,
				step: 0,
				moonIllumination: skySample(start, position).moonIllumination,
				targets: [],
				discarded: targets.map((target) => ({ id: target.id, name: target.name, reason: 'visibilityTooShort' as const })),
			}
		}

		const requestedStep = (req.step !== undefined && req.step > 0 ? req.step : DEFAULT_STEP) * 1000
		const count = Math.min(MAX_SAMPLES, Math.max(2, Math.floor(span / requestedStep) + 1))
		const step = span / (count - 1)

		const grid = new Array<SkySample>(count)
		for (let i = 0; i < count; i++) grid[i] = skySample(start + i * step, position)

		// The Sun's altitude turns once or twice inside a night-long window, and a darkness constraint set close
		// to that turn opens or closes entirely between two grid samples. Evaluating the turn itself is what
		// stops the scan from bridging or missing it, and the turn is target-independent so it is found once.
		const samples: SkySample[] = [grid[0]]

		for (let i = 1; i < count - 1; i++) {
			const turn = turningInstant(grid[i - 1].utc, grid[i].utc, grid[i + 1].utc, grid[i - 1].sunAltitude, grid[i].sunAltitude, grid[i + 1].sunAltitude)
			if (turn > 0 && turn < grid[i].utc) samples.push(skySample(turn, position))
			samples.push(grid[i])
			if (turn > grid[i].utc) samples.push(skySample(turn, position))
		}

		if (count > 1) samples.push(grid[count - 1])

		const sampleCount = samples.length

		// Reused across candidates so the scan allocates once instead of once per target. Each interior sample can
		// contribute two extra evaluation points, one at the turn of the candidate's altitude curve and one at the
		// turn of its Moon separation, which bounds the merged sequence at three times the sample count.
		const capacity = 3 * sampleCount
		const instants = new Float64Array(capacity)
		const sources = new Int32Array(capacity)
		const gridAltitudes = new Float64Array(sampleCount)
		const gridMoonDistances = new Float64Array(sampleCount)
		const feasible = new Uint8Array(capacity)

		const minimumDuration = Math.max(0, (req.minimumDuration ?? 0) * 1000)
		const pending: FeasibleTarget[] = []
		const discarded: DiscardedTarget[] = []

		for (const candidate of targets) {
			const constraints = mergeConstraints(req.constraints, candidate.constraints)
			const duration = Math.max(0, (candidate.duration ?? 0) * 1000)

			// The altitude and Moon separation of this candidate on the grid, both needed in full: the altitude of
			// every sample feeds the constraint decision and the discard reason, and locating a turn of the Moon
			// curve is a comparison against both neighbours, which cannot skip the samples a constraint rejects.
			for (let i = 0; i < sampleCount; i++) {
				gridAltitudes[i] = observedAltitude(samples[i].astrom, candidate.rightAscension, candidate.declination)
				gridMoonDistances[i] = moonDistanceOf(samples[i], candidate.rightAscension, candidate.declination)
			}

			// Computed once per candidate: it locates every altitude turn of the evaluation sequence and is also the
			// peak that gets published, so the sequence and the reported transit cannot disagree.
			const culmination = culminationAt(samples[0], candidate)

			// A turn is worth locating at all only where a constraint reads that curve, since that is the only thing
			// the evaluation sequence decides. Evaluating one costs a full sky state, so it follows the constraint set.
			const altitudeConstrained = constraints.minimumAltitude !== undefined || constraints.maximumAltitude !== undefined || constraints.maximumAirmass !== undefined
			const moonConstrained = constraints.minimumMoonDistance !== undefined

			// Evaluation sequence for this candidate: the grid plus the instants its own curves turn. Altitude turns
			// at culmination and Moon separation turns at the closest approach of the Moon, and those are the only
			// places where a constraint on altitude, airmass, or lunar distance can open and close between two
			// samples that agree. Away from a turn each curve is monotonic over a sampling interval, so a crossing
			// shows up as two samples that disagree and the edge refinement already brackets it.
			let size = 0

			for (let i = 0; i < sampleCount; i++) {
				const utc = samples[i].utc
				let firstTurn = -1
				let secondTurn = -1

				// The altitude of a fixed direction turns at its culmination and at the lower culmination half a
				// sidereal day away, so the turn that can fall inside a sampling interval is computed from the
				// culmination instead of being bracketed and refined against four fresh sky states. Each interval is
				// handled by the sample that opens it, which covers the first and the last as well, where a
				// three-point bracket does not reach at all.
				if (altitudeConstrained && i < sampleCount - 1) {
					const after = samples[i + 1].utc
					const turn = culmination + Math.ceil((utc - culmination) / HALF_SIDEREAL_DAY) * HALF_SIDEREAL_DAY
					if (turn > utc && turn < after) firstTurn = turn
				}

				// A Moon turn with no lunar constraint to read it changes nothing, and the separation reported for the
				// target is the one at its transit, so it is not even evaluated.
				if (moonConstrained && i > 0 && i < sampleCount - 1) {
					const before = samples[i - 1].utc
					const after = samples[i + 1].utc

					secondTurn = turningInstant(before, utc, after, gridMoonDistances[i - 1], gridMoonDistances[i], gridMoonDistances[i + 1])
					if (secondTurn > 0) secondTurn = refineMoonTurn(before, utc, after, gridMoonDistances[i - 1], gridMoonDistances[i], gridMoonDistances[i + 1], candidate, position)
				}

				// Ordering the pair is what keeps the sequence sorted when both turns land on the same side of the
				// sample, and it puts the only present turn first when there is one.
				if (firstTurn < 0 || (secondTurn > 0 && secondTurn < firstTurn)) {
					const earlier = secondTurn
					secondTurn = firstTurn
					firstTurn = earlier
				}

				// Two turns closer than a millisecond describe the same instant; evaluating it twice buys nothing.
				if (secondTurn > 0 && secondTurn - firstTurn < 1) secondTurn = -1

				if (firstTurn > 0 && firstTurn < utc) {
					instants[size] = firstTurn
					sources[size] = -1
					size++
				}

				if (secondTurn > 0 && secondTurn < utc) {
					instants[size] = secondTurn
					sources[size] = -1
					size++
				}

				instants[size] = utc
				sources[size] = i
				size++

				if (firstTurn > utc) {
					instants[size] = firstTurn
					sources[size] = -1
					size++
				}

				if (secondTurn > utc) {
					instants[size] = secondTurn
					sources[size] = -1
					size++
				}
			}

			let skyReason: TargetPlanDiscardReason | undefined
			let blockedReason: TargetPlanDiscardReason | undefined
			let blockedAltitude = -Infinity
			let anyFeasible = false

			for (let i = 0; i < size; i++) {
				const source = sources[i]
				const sample = source >= 0 ? samples[source] : skySample(instants[i], position)
				feasible[i] = 0

				const violatedSky = violatedSkyConstraint(sample, constraints)

				if (violatedSky !== undefined) {
					skyReason ??= violatedSky
					continue
				}

				const altitude = source >= 0 ? gridAltitudes[source] : observedAltitude(sample.astrom, candidate.rightAscension, candidate.declination)
				const moonDistance = source >= 0 ? gridMoonDistances[source] : moonDistanceOf(sample, candidate.rightAscension, candidate.declination)
				const violatedPointing = violatedPointingConstraint(altitude, moonDistance, constraints)

				if (violatedPointing === undefined) {
					feasible[i] = 1
					anyFeasible = true
				} else if (altitude > blockedAltitude) {
					// Reported as the reason when nothing is feasible: the constraint that blocked the target at its best moment.
					blockedAltitude = altitude
					blockedReason = violatedPointing
				}
			}

			if (!anyFeasible) {
				discarded.push({ id: candidate.id, name: candidate.name, reason: blockedReason ?? skyReason ?? 'visibilityTooShort' })
				continue
			}

			const [visibilityStart, visibilityEnd] = longestInterval(feasible, instants, size, start, end, candidate, constraints, position)

			if (visibilityEnd - visibilityStart < Math.max(minimumDuration, duration)) {
				discarded.push({ id: candidate.id, name: candidate.name, reason: 'visibilityTooShort' })
				continue
			}

			// The peak of the interval is the culmination whenever the interval holds one.
			let transit = culmination
			let pointing = culmination > visibilityStart && culmination < visibilityEnd ? pointingAt(culmination, candidate, position) : undefined

			if (pointing === undefined) {
				// With the culmination outside it the interval has no interior maximum, so the peak is at one of the
				// ends. Both are evaluated because an interval longer than half a sidereal day holds the lower
				// culmination instead and climbs again after it, which can leave the far end higher than the near one.
				const atStart = pointingAt(visibilityStart, candidate, position)
				const atEnd = pointingAt(visibilityEnd, candidate, position)
				const ending = atEnd[0] > atStart[0]

				transit = ending ? visibilityEnd : visibilityStart
				pointing = ending ? atEnd : atStart
			}

			const [maximumAltitude, moonDistance] = pointing

			pending.push({ candidate, constraints, visibilityStart, visibilityEnd, transit, maximumAltitude, moonDistance, duration })
		}

		return {
			anchor: start,
			location,
			end,
			step: step / 1000,
			moonIllumination: samples[0].moonIllumination,
			targets: schedule(pending, start, discarded),
			discarded,
		}
	}
}

export function sequencerPlanner(planner: SequencerPlannerHandler) {
	return {
		'/sequencer/plan-targets': { POST: async (req) => response(planner.planTargets(await req.json())) },
	} as const satisfies Endpoints
}
