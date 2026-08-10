import { DEFAULT_REFRACTION_PARAMETERS } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { eraApco13, eraAtciqz, eraAtioq, eraC2s, eraS2p } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
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
	// Instant of maximum altitude inside that interval, Unix milliseconds, resolved to the sampling grid.
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

// Returns the inclusive index bounds of the longest run of set flags in the first count entries.
// The caller only calls it when at least one flag is set, so the returned bounds are always a real run.
function longestRun(flags: Uint8Array, count: number): readonly [number, number] {
	let bestFirst = 0
	let bestLast = 0
	let bestLength = 0
	let currentFirst = -1

	for (let i = 0; i < count; i++) {
		if (flags[i] === 1) {
			if (currentFirst < 0) currentFirst = i

			const length = i - currentFirst + 1

			if (length > bestLength) {
				bestLength = length
				bestFirst = currentFirst
				bestLast = i
			}
		} else {
			currentFirst = -1
		}
	}

	return [bestFirst, bestLast]
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
		// contribute one extra evaluation point at the turn of the candidate's own altitude curve, which bounds
		// the merged sequence at twice the sample count.
		const capacity = 2 * sampleCount
		const instants = new Float64Array(capacity)
		const sources = new Int32Array(capacity)
		const gridAltitudes = new Float64Array(sampleCount)
		const altitudes = new Float64Array(capacity)
		const moonDistances = new Float64Array(capacity)
		const feasible = new Uint8Array(capacity)

		const minimumDuration = Math.max(0, (req.minimumDuration ?? 0) * 1000)
		const pending: FeasibleTarget[] = []
		const discarded: DiscardedTarget[] = []

		for (const candidate of targets) {
			const constraints = mergeConstraints(req.constraints, candidate.constraints)
			const duration = Math.max(0, (candidate.duration ?? 0) * 1000)

			// The altitude of this candidate on the grid, needed in full because locating a turn of the curve is a
			// comparison against both neighbours and cannot skip the samples another constraint already rejects.
			for (let i = 0; i < sampleCount; i++) gridAltitudes[i] = observedAltitude(samples[i].astrom, candidate.rightAscension, candidate.declination)

			// Evaluation sequence for this candidate: the grid plus the instant its altitude turns, which is the
			// only place a constraint on altitude or airmass can open or close between two samples that agree.
			let size = 0

			for (let i = 0; i < sampleCount; i++) {
				const turn = i > 0 && i < sampleCount - 1 ? turningInstant(samples[i - 1].utc, samples[i].utc, samples[i + 1].utc, gridAltitudes[i - 1], gridAltitudes[i], gridAltitudes[i + 1]) : -1

				if (turn > 0 && turn < samples[i].utc) {
					instants[size] = turn
					sources[size] = -1
					size++
				}

				instants[size] = samples[i].utc
				sources[size] = i
				size++

				if (turn > samples[i].utc) {
					instants[size] = turn
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
				const moonDistance = moonDistanceOf(sample, candidate.rightAscension, candidate.declination)
				altitudes[i] = altitude
				moonDistances[i] = moonDistance

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

			const [first, last] = longestRun(feasible, size)

			let transit = instants[first]
			let maximumAltitude = altitudes[first]
			let moonDistance = moonDistances[first]

			for (let i = first + 1; i <= last; i++) {
				if (altitudes[i] > maximumAltitude) {
					maximumAltitude = altitudes[i]!
					moonDistance = moonDistances[i]!
					transit = instants[i]
				}
			}

			// A run touching a window edge is truncated by the window, not by a constraint, so there is no edge to refine there.
			const visibilityStart = first === 0 ? start : refineEdge(instants[first - 1], instants[first], candidate, constraints, position)
			const visibilityEnd = last === size - 1 ? end : refineEdge(instants[last + 1], instants[last], candidate, constraints, position)

			if (visibilityEnd - visibilityStart < Math.max(minimumDuration, duration)) {
				discarded.push({ id: candidate.id, name: candidate.name, reason: 'visibilityTooShort' })
				continue
			}

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
