import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import type { Angle } from 'nebulosa/src/math/units/angle'

// Observing conditions a candidate target must satisfy to be considered visible.
// Every property is optional and an omitted property disables that constraint.
// Constraints declared on a candidate replace, property by property, the ones declared for the whole request.
export interface TargetPlanConstraint {
	// Minimum apparent altitude above the local horizon.
	// Radians in [-π/2, π/2].
	readonly minimumAltitude?: Angle
	// Maximum apparent altitude above the local horizon, useful to avoid the zenith blind spot of a German equatorial mount.
	// Radians in [-π/2, π/2].
	readonly maximumAltitude?: Angle
	// Maximum optical airmass accepted, computed from the apparent altitude.
	// Use a finite value >= 1; values around 2 to 3 are common operational limits.
	readonly maximumAirmass?: number
	// Minimum angular separation between the target and the Moon.
	// Radians in [0, π].
	readonly minimumMoonDistance?: Angle
	// Maximum illuminated fraction of the Moon accepted while the target is observed.
	// Normalized value in [0, 1].
	readonly maximumMoonIllumination?: number
	// Maximum apparent Sun altitude accepted, which is how the caller asks for darkness.
	// Radians in [-π/2, π/2]; -18° selects astronomical night.
	readonly maximumSunAltitude?: Angle
}

// One candidate object offered to the planner.
// Coordinates are ICRS/J2000 because that is the frame catalogs publish and the planner never assumes proper motion.
export interface TargetPlanCandidate {
	// Stable identifier echoed back in the plan, unique within the request.
	readonly id: string
	// Human-readable label carried through to the plan for logs and UI display.
	readonly name: string
	// Right ascension in ICRS/J2000.
	// Radians normalized to [0, 2π).
	readonly rightAscension: Angle
	// Declination in ICRS/J2000.
	// Radians in [-π/2, π/2].
	readonly declination: Angle
	// Seconds of continuous observation this target needs.
	// Omit or use 0 to ask only for an ordering, with the target consuming no time in the schedule.
	readonly duration?: number
	// Constraints overriding the request-level ones for this candidate only.
	readonly constraints?: TargetPlanConstraint
}

// Request for an observation order over a set of candidate targets.
// The planner is a pure pre-process: it touches no device, no session, and no store.
export interface PlanTargets {
	// Observing site whose horizon, refraction, and sidereal time produce every altitude in the plan.
	readonly location: GeographicCoordinate
	// Instant the session is assumed to begin, which is also the anchor of the returned plan.
	// Unix timestamp in milliseconds.
	readonly start: number
	// Instant the session is assumed to end.
	// Unix timestamp in milliseconds, later than start.
	readonly end: number
	// Sampling interval used to scan the window for visibility.
	// Seconds; omit for the default. The planner raises it when the requested window would need more samples than it is willing to compute.
	readonly step?: number
	// Continuous visibility below which a target is discarded regardless of its declared duration.
	// Seconds; omit for no lower bound.
	readonly minimumDuration?: number
	// Constraints applied to every candidate that does not declare its own.
	readonly constraints?: TargetPlanConstraint
	// Candidate targets to order.
	readonly targets: readonly TargetPlanCandidate[]
}

// Why a candidate did not make it into the plan.
// The first six report the constraint that blocked the target at its most favorable instant inside the window.
export type TargetPlanDiscardReason = 'belowMinimumAltitude' | 'aboveMaximumAltitude' | 'airmassTooHigh' | 'moonTooClose' | 'moonTooBright' | 'sunTooHigh' | 'visibilityTooShort' | 'noRemainingTime'

// A candidate the planner could not place, with the reason it was dropped.
export interface DiscardedTarget {
	// Identifier of the discarded candidate.
	readonly id: string
	// Label of the discarded candidate.
	readonly name: string
	// Constraint or scheduling limit that blocked the target.
	readonly reason: TargetPlanDiscardReason
}

// A candidate placed in the plan, carrying the premise that produced its position.
// The window and the constraint below are what a later feasibility gate re-evaluates against the real clock,
// which is why the plan reports them instead of an order alone.
export interface PlannedTarget {
	// Identifier of the planned candidate.
	readonly id: string
	// Label of the planned candidate.
	readonly name: string
	// Zero-based position in the recommended observing order.
	readonly order: number
	// Start of the longest continuous interval in which every constraint holds.
	// Unix timestamp in milliseconds, never earlier than the request start.
	readonly visibilityStart: number
	// End of that interval.
	// Unix timestamp in milliseconds, never later than the request end.
	readonly visibilityEnd: number
	// Start of the interval the scheduler allocated to this target, inside the visibility interval.
	// Unix timestamp in milliseconds.
	readonly slotStart: number
	// End of the allocated interval, equal to slotStart when the candidate declared no duration.
	// Unix timestamp in milliseconds.
	readonly slotEnd: number
	// Instant of maximum altitude inside the visibility interval, which is the best moment to observe it.
	// Unix timestamp in milliseconds.
	readonly transit: number
	// Apparent altitude reached at transit.
	// Radians in [-π/2, π/2].
	readonly maximumAltitude: Angle
	// Angular separation from the Moon at transit.
	// Radians in [0, π].
	readonly moonDistance: Angle
	// Constraints actually used for this target, after request-level defaults were merged with the candidate overrides.
	readonly constraints: TargetPlanConstraint
}

// Ordered observation plan produced from a set of candidates.
// The order is only valid under the anchor, site, and window reported here; a session starting elsewhere invalidates it.
export interface TargetPlan {
	// Instant the ordering assumes the session begins, equal to the requested start.
	// Unix timestamp in milliseconds.
	readonly anchor: number
	// Site the plan was computed for.
	readonly location: GeographicCoordinate
	// End of the window the plan was computed for.
	// Unix timestamp in milliseconds.
	readonly end: number
	// Sampling interval actually used, which may be coarser than the requested one.
	// Seconds.
	readonly step: number
	// Illuminated fraction of the Moon at the anchor, reported because it drives most whole-night discards.
	// Normalized value in [0, 1].
	readonly moonIllumination: number
	// Candidates that made it into the plan, already in observing order.
	readonly targets: readonly PlannedTarget[]
	// Candidates that did not, each with the reason.
	readonly discarded: readonly DiscardedTarget[]
}
