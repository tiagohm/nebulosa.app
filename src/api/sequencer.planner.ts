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
	// Geocentric Moon position in ICRS axes, AU.
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

	const [moon] = eraMoon98(a.day, a.fraction)
	const sunAltitude = observedAltitude(astrom, ...eraC2s(...sun))

	return { utc, astrom, moon, moonIllumination: moonIlluminatedFraction(sun, moon), sunAltitude }
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

// Angular separation between an ICRS/J2000 direction and the geocentric Moon, in radians.
// The Moon is taken geocentrically: lunar parallax reaches about one degree, which is immaterial against the
// tens of degrees a moon-avoidance constraint is expressed in.
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

		const samples = new Array<SkySample>(count)
		for (let i = 0; i < count; i++) samples[i] = skySample(start + i * step, position)

		// Reused across candidates so the scan allocates once instead of once per target.
		const altitudes = new Float64Array(count)
		const moonDistances = new Float64Array(count)
		const feasible = new Uint8Array(count)

		const minimumDuration = Math.max(0, (req.minimumDuration ?? 0) * 1000)
		const pending: FeasibleTarget[] = []
		const discarded: DiscardedTarget[] = []

		for (const candidate of targets) {
			const constraints = mergeConstraints(req.constraints, candidate.constraints)
			const duration = Math.max(0, (candidate.duration ?? 0) * 1000)

			let skyReason: TargetPlanDiscardReason | undefined
			let blockedReason: TargetPlanDiscardReason | undefined
			let blockedAltitude = -Infinity
			let anyFeasible = false

			for (let i = 0; i < count; i++) {
				const sample = samples[i]
				feasible[i] = 0

				const violatedSky = violatedSkyConstraint(sample, constraints)

				if (violatedSky !== undefined) {
					skyReason ??= violatedSky
					continue
				}

				const altitude = observedAltitude(sample.astrom, candidate.rightAscension, candidate.declination)
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

			const [first, last] = longestRun(feasible, count)

			let transit = samples[first].utc
			let maximumAltitude = altitudes[first]
			let moonDistance = moonDistances[first]

			for (let i = first + 1; i <= last; i++) {
				if (altitudes[i] > maximumAltitude) {
					maximumAltitude = altitudes[i]!
					moonDistance = moonDistances[i]!
					transit = samples[i].utc
				}
			}

			// A run touching a window edge is truncated by the window, not by a constraint, so there is no edge to refine there.
			const visibilityStart = first === 0 ? start : refineEdge(samples[first - 1].utc, samples[first].utc, candidate, constraints, position)
			const visibilityEnd = last === count - 1 ? end : refineEdge(samples[last + 1].utc, samples[last].utc, candidate, constraints, position)

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
