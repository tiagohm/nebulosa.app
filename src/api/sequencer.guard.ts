import { SIDEREAL_DAYSEC, TAU } from 'nebulosa/src/core/constants'
import type { Angle } from 'nebulosa/src/math/units/angle'
import { abortableDelay } from './operation.wait'
import { sequencerActionFailure } from './sequencer.action'
import type { SequencerActionContext, SequencerActionResult } from './sequencer.registry'

// Pre-exposure guard: the only step of the safe point that compares a projected future against a boundary
// instead of comparing state against state.
//
// Every other step asks whether the observatory is where the frame needs it. This one asks whether the frame
// still fits. Starting a 300 s exposure 200 s before the meridian is not a mistake any state check can see: at
// the moment of the decision everything is correct, and the frame is only wrong once it has been taken.
//
// What is projected is the real end of the exposure and not `now + exposureTime`, because the cadence boundary
// of the safe point can still hold the start back. A group with 300 s exposures and a 60 s spacing would
// otherwise cross the boundary by a minute, silently, with the guard having declared that it fit.
//
// A refusal is not a failure. The selected frame stays selected, no attempt is consumed, and what follows is a
// reordering: the session waits until the flip window opens and then runs the flip the safe point was already
// going to run. That is also why the guard only exists where a flip exists — the lowering emits it when the
// definition enables the meridian flip and the session commands a mount that publishes a pier side. Written
// without that condition, the refusal is a loop with no progress: nothing ever flips, and nothing ever
// exposes.
//
// The wait is measured against the hour angle the mount reports, never against accumulated wall clock: the
// boundary is a position in the sky, and re-reading it costs nothing the mount does not already publish.
//
// Angles are radians, hour angles normalized to (-PI, PI], durations are seconds and instants are epoch
// milliseconds.

// Sidereal rotation in radians per mean solar second, which is the rate an hour angle grows at while the mount
// tracks. It is the only conversion the guard needs, and it needs no ephemeris: the boundary is an hour angle
// and the exposure is a duration.
const SEQUENCER_SIDEREAL_RATE = TAU / SIDEREAL_DAYSEC

// Milliseconds between two readings of the hour angle while waiting for the flip window.
//
// The remaining time is recomputed from the mount on every tick, so this only bounds how long a wait can be
// wrong after something moved the telescope underneath it, such as a manual slew or a synchronization.
const SEQUENCER_HOUR_ANGLE_SAMPLE = 30000

// Hour-angle boundaries the guard projects against, as the meridian flip policy declares them.
export interface SequencerFlipBoundary {
	// First post-meridian hour angle at which the flip may be executed, in radians. It is what a refusal
	// waits for, since that is when the reordering the refusal counts on becomes possible.
	readonly minimumHourAngle: Angle
	// Last hour angle at which another exposure may begin, in radians. An exposure projected past it is
	// refused.
	readonly maximumHourAngle: Angle
	// Time reserved ahead of the boundary so no exposure overruns it, in seconds.
	readonly safetyMargin: number
}

// State the guard projects from.
export interface SequencerGuardObservation {
	// Hour angle of the target the mount reports, in radians.
	readonly hourAngle: Angle
	// Exposure duration of the selected frame, in seconds.
	readonly exposureTime: number
	// Wall clock of the decision, in epoch milliseconds.
	readonly now: number
	// Earliest instant the exposure may start, in epoch milliseconds, which is the cadence boundary of the
	// safe point. A boundary already in the past adds nothing to the projection.
	readonly startsAt: number
	// Whether the flip this boundary protects may still be owed, which is the mount reporting the pre-flip
	// pier side. It is the same condition the trigger evaluator decides the flip on, and it has to be the
	// same one here: the hour angle only grows, so past the boundary a guard that does not ask this refuses
	// every exposure of the rest of the night for a flip that already happened and cannot happen again.
	//
	// A caller that cannot tell the sides apart reports it as pending, because the evidence that the flip is
	// no longer needed is exactly what it is missing. The refusal that follows is then not a reordering — no
	// window opens onto a flip nobody can decide — and it is the caller that says so.
	readonly flipPending: boolean
}

// What the guard decided about the selected frame.
//
// Neither outcome is a failure: one starts the exposure and the other reorders the safe point around a flip
// that is about to become possible.
export type SequencerGuardDecision =
	// The exposure fits ahead of the boundary and may start.
	| { readonly type: 'allowed'; readonly projectedHourAngle: Angle }
	// The exposure would cross the boundary. `wait` is how long the flip window takes to open, in seconds,
	// and is zero when the window is already open and the flip only has to be evaluated again.
	| { readonly type: 'refused'; readonly projectedHourAngle: Angle; readonly wait: number }

// Hour angle the exposure would end at, in radians, counting the hold of the cadence boundary, the exposure
// itself and the declared safety margin.
//
// The margin is part of the projection rather than of the comparison so the reported angle is the one that
// must fit, which is what makes a refusal explainable with the number it was decided on.
function projectedHourAngle(boundary: SequencerFlipBoundary, observation: SequencerGuardObservation): Angle {
	const held = Math.max(0, observation.startsAt - observation.now) / 1000

	return observation.hourAngle + (held + observation.exposureTime + boundary.safetyMargin) * SEQUENCER_SIDEREAL_RATE
}

// Seconds the flip window takes to open, from an hour angle to the first one the flip may run at.
//
// Zero means the window is already open, which is a refusal that re-evaluates immediately instead of waiting:
// the trigger evaluator of the next safe point is what turns it into an actual flip.
export function sequencerFlipWindowDelay(boundary: SequencerFlipBoundary, hourAngle: Angle): number {
	return Math.max(0, (boundary.minimumHourAngle - hourAngle) / SEQUENCER_SIDEREAL_RATE)
}

// Decides whether the selected frame may be exposed before the flip boundary.
//
// The projection assumes the mount keeps tracking at the sidereal rate for the whole exposure, which is what
// the hour angle of a tracked target does by definition. A session that stops tracking mid-exposure is not
// taking the frame the guard admitted either way.
//
// A boundary with no flip left ahead of it admits everything. The angle it protects is the last one an
// exposure may begin at before the crossing, so once the mount has crossed there is nothing left to reserve
// and the projection is only a number: the target keeps setting, the hour angle never comes back under the
// boundary, and a guard that still refused would refuse the whole rest of the night for a flip that already
// happened.
export function sequencerPreExposureGuard(boundary: SequencerFlipBoundary, observation: SequencerGuardObservation): SequencerGuardDecision {
	const projected = projectedHourAngle(boundary, observation)

	if (!observation.flipPending || projected <= boundary.maximumHourAngle) return { type: 'allowed', projectedHourAngle: projected }

	return { type: 'refused', projectedHourAngle: projected, wait: sequencerFlipWindowDelay(boundary, observation.hourAngle) }
}

// Waits until the flip window opens, re-reading the hour angle from the mount on every tick.
//
// The remaining time is derived from the sky and not accumulated on the wall clock, so a slew, a sync or a
// mount that was already past the boundary ends the wait at the next tick instead of holding the session for a
// duration computed once. A mount that stops publishing an hour angle ends the wait as well: with nothing to
// measure against, holding the safe point would be a hold with no end in sight.
//
// Returns the seconds actually waited, which is what the session reports as the reordering it performed.
export async function waitForFlipWindow(context: SequencerActionContext, boundary: SequencerFlipBoundary, hourAngle: () => Angle | undefined): Promise<SequencerActionResult<number>> {
	const started = context.now()
	let announced = false

	for (;;) {
		const current = hourAngle()

		if (current === undefined) break

		const remaining = sequencerFlipWindowDelay(boundary, current)

		if (remaining <= 0) break

		if (!announced) {
			announced = true
			context.progress({ detail: 'waiting for the meridian flip window to open' })
		}

		const waited = await abortableDelay(Math.min(remaining * 1000, SEQUENCER_HOUR_ANGLE_SAMPLE), context.signal)

		if (!waited.ok) return sequencerActionFailure(waited, 'the wait for the meridian flip window was interrupted')
	}

	return { type: 'completed', value: (context.now() - started) / 1000 }
}
