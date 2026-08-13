import type { FrameType, PierSide } from 'nebulosa/src/devices/indi/device'
import type { SequencerAutofocus, SequencerDither, SequencerMeridianFlip } from '#/sequencer'
import type { SequencerTriggerAnchor, SequencerTriggerAnchors } from '#/sequencer.state'

// Safe-point trigger evaluation: which derived steps run before the next frame, in which order, and what
// moves the anchors they are measured against.
//
// Autofocus, dither and the meridian flip are not nodes in the order of the plan. They are steps derived at
// every safe point from the selected frame, from the anchors in the checkpoint, and from a single reading of
// the observatory. This module is the whole decision and it is pure: it commands nothing, reads no device
// and no clock of its own. The instant it evaluates against is the one the frame selection already used,
// because two clock readings in the same safe point would let an elapsed-time trigger fire against an
// instant the selection never saw.
//
// Angles are radians and elapsed times in the definition are seconds, converted here to the milliseconds the
// anchors are stored in. Temperatures are degrees Celsius.

// Trigger the evaluator can select, named after the step of the safe point it produces.
export type SequencerTriggerKind = 'meridianFlip' | 'autofocus' | 'dither'

// Condition that selected a trigger, reported so the session event says why a run happened rather than only
// that it did. Exactly one is reported per decision, the first one that held in the documented order.
export type SequencerTriggerReason = 'onStart' | 'beforeFirstFrame' | 'afterMeridianFlip' | 'afterRecovery' | 'filterChange' | 'frames' | 'elapsed' | 'temperature' | 'hourAngle'

// One trigger the safe point has to run, before the frame it was evaluated for.
export interface SequencerTriggerDecision {
	// Trigger that won.
	readonly kind: SequencerTriggerKind
	// Condition that selected it.
	readonly reason: SequencerTriggerReason
}

// Declared policies of the triggers the plan lowered, each absent when the definition disabled it.
//
// They arrive without the enablement flag because that flag is what decided the lowering: a disabled trigger
// produces no node and is simply not part of this set.
export interface SequencerTriggerPolicies {
	// Meridian-flip policy, absent when the definition does not flip.
	readonly meridianFlip?: Omit<SequencerMeridianFlip, 'enabled'>
	// Autofocus policy, absent when the definition does not autofocus.
	readonly autofocus?: Omit<SequencerAutofocus, 'enabled'>
	// Dither policy, absent when the definition does not dither.
	readonly dither?: Omit<SequencerDither, 'enabled'>
}

// Single reading of the safe point: what the selection requires and what the observatory reports right now.
//
// Everything here is observed once, before any trigger runs, so every trigger of the same safe point decides
// against the same picture.
export interface SequencerTriggerObservation {
	// Instant of the safe point, in milliseconds since the Unix epoch, shared with the frame selection.
	readonly instant: number
	// Classification of the selected frame. Anything other than `LIGHT` is a calibration frame and excludes
	// the triggers that depend on the sky.
	readonly frameType: FrameType
	// Filter the selected frame requires, absent when the group commands no wheel. The filter-change
	// conditions are stated over this and not over the movement, which only happens later in the safe point.
	readonly filter?: string
	// Filter currently installed, absent when the session commands no wheel.
	readonly installedFilter?: string
	// Hour angle of the target reported by the mount, in radians, normalized to (-PI, PI]. Absent when the
	// session commands no mount, which is also when no flip can be decided.
	readonly hourAngle?: number
	// Pier side reported by the mount, absent when it publishes none.
	readonly pierSide?: PierSide
	// Pier side the mount is on before the flip, which is the side that means the flip is still pending.
	// Absent when the session cannot tell the sides apart, in which case no flip is decided.
	readonly preFlipPierSide?: PierSide
	// Temperature the focus drift is measured against, in degrees Celsius, absent when no device reports one.
	readonly temperature?: number
	// Whether the session reached this safe point through a recovery, which is a condition of its own.
	readonly recovered?: boolean
}

// Anchor of a trigger that has never run, which is how every session starts.
export const SEQUENCER_INITIAL_TRIGGER_ANCHOR: SequencerTriggerAnchor = { frames: 0 }

// Anchors of a session that has not run any trigger, anchored at the instant the session started.
//
// `instant` is the wall-clock instant of the start, in milliseconds since the Unix epoch.
export function sequencerInitialTriggerAnchors(instant: number): SequencerTriggerAnchors {
	return { sessionStart: instant, autofocus: SEQUENCER_INITIAL_TRIGGER_ANCHOR, dither: SEQUENCER_INITIAL_TRIGGER_ANCHOR, driftCheck: SEQUENCER_INITIAL_TRIGGER_ANCHOR }
}

// Records the filter the session was found on as the reference the first filter change is measured against.
//
// The anchor of a trigger that has never run carries no filter, and without one the only reference of a
// change is the wheel — which stops describing it as soon as the frame preparation of the same safe point
// installs the filter the frame needs. A first run that then fails, is skipped, or is suppressed leaves the
// anchor untouched, so from the next safe point on the selection and the wheel agree and the change reports
// itself as already served by a run that never happened.
//
// It is therefore applied at every safe point, before the triggers are evaluated and before anything moves,
// and the anchors it returns are the ones the checkpoint keeps. It is idempotent and only ever fills an
// anchor that has never run and carries no filter: once a run advanced the anchor, the filter that run was
// made through is the reference. A session commanding no wheel reports no installed filter and is left
// untouched, and the anchors are returned unchanged when there is nothing to record.
export function sequencerFilterBaselined(anchors: SequencerTriggerAnchors, observation: SequencerTriggerObservation): SequencerTriggerAnchors {
	const { installedFilter } = observation

	if (installedFilter === undefined) return anchors

	const autofocus = baselinedAnchor(anchors.autofocus, installedFilter)
	const dither = baselinedAnchor(anchors.dither, installedFilter)

	return autofocus === anchors.autofocus && dither === anchors.dither ? anchors : { ...anchors, autofocus, dither }
}

// Decides which triggers run before the selected frame, in the fixed order of the safe point.
//
// The order of the returned decisions is the order they execute in — flip, autofocus, dither — and it is not
// a preference: the flip invalidates the pointing everything else assumes, the autofocus needs the pointing
// the flip re-established, and the dither is the last movement before the exposure so that nothing wastes
// the guiding settle after it.
//
// The flip is evaluated first for a second reason: whether it won is itself a condition of the two triggers
// after it, so a safe point where the flip fires can autofocus and dither on account of it, in the same
// pass, without a second evaluation.
//
// A calibration frame consults none of them. All three look at the sky — the flip moves the mount across the
// meridian, the dither displaces it, the autofocus measures stars — and behind a closed cover they spend a
// settle each and change nothing. The same exclusion holds for the counters, which `sequencerFrameCounted`
// applies: a run of darks in the middle of the night must not make the next light dither because "ten frames
// passed".
//
// `anchors` is read and never modified; advancing it is `sequencerAnchorAdvanced`, and only a successful run
// may do it. The anchors given here are the ones `sequencerFilterBaselined` returned for the same
// observation, which is what the filter-change conditions of a session that has never run are measured
// against.
export function evaluateSequencerTriggers(policies: SequencerTriggerPolicies, anchors: SequencerTriggerAnchors, observation: SequencerTriggerObservation): readonly SequencerTriggerDecision[] {
	const decisions: SequencerTriggerDecision[] = []

	if (observation.frameType !== 'LIGHT') return decisions

	const flipped = policies.meridianFlip !== undefined && meridianFlipDue(policies.meridianFlip, observation)

	if (flipped) decisions.push({ kind: 'meridianFlip', reason: 'hourAngle' })

	if (policies.autofocus !== undefined) {
		const reason = autofocusReason(policies.autofocus, anchors, observation, flipped)

		if (reason !== undefined) decisions.push({ kind: 'autofocus', reason })
	}

	if (policies.dither !== undefined) {
		const reason = ditherReason(policies.dither, anchors, observation, flipped)

		if (reason !== undefined) decisions.push({ kind: 'dither', reason })
	}

	return decisions
}

// Counts one accepted frame against every anchor, or leaves them untouched when the frame is calibration.
//
// This is the counter half of the sky rule: only a frame that looked at the sky moves a sky trigger closer to
// firing. `frameType` is the classification of the frame that was just accepted.
export function sequencerFrameCounted(anchors: SequencerTriggerAnchors, frameType: FrameType): SequencerTriggerAnchors {
	if (frameType !== 'LIGHT') return anchors

	return { ...anchors, autofocus: countedAnchor(anchors.autofocus), dither: countedAnchor(anchors.dither), driftCheck: countedAnchor(anchors.driftCheck) }
}

// Moves one anchor to the safe point that just ran it successfully.
//
// It is called after the run and never before: an anchor advanced on selection would consume the condition
// that selected it, and a run that then failed would leave the session behaving as if it had focused. The
// frame counter restarts at zero, and the temperature and filter of the observation become the references
// the next change is measured against.
//
// `kind` is the anchored trigger. The meridian flip has no anchor, because what says it already happened is
// the pier side of the mount and not an instant.
export function sequencerAnchorAdvanced(anchors: SequencerTriggerAnchors, kind: 'autofocus' | 'dither' | 'driftCheck', observation: SequencerTriggerObservation): SequencerTriggerAnchors {
	return { ...anchors, [kind]: { at: observation.instant, frames: 0, temperature: observation.temperature, filter: observation.filter } satisfies SequencerTriggerAnchor }
}

// Anchor carrying the filter the session was found on, or the same anchor when it already has a reference.
//
// An anchor that ran has the filter of that run and is never rewritten; one that never ran takes the
// baseline only once, so the reference survives the preparation that installs another filter later in the
// same safe point.
function baselinedAnchor(anchor: SequencerTriggerAnchor, filter: string) {
	return anchor.at === undefined && anchor.filter === undefined ? { ...anchor, filter } : anchor
}

// Adds one accepted sky frame to an anchor.
function countedAnchor(anchor: SequencerTriggerAnchor): SequencerTriggerAnchor {
	return { ...anchor, frames: anchor.frames + 1 }
}

// Instant an anchor measures elapsed time from: the last successful run, or the start of the session while
// the trigger has never run. Without the fallback a trigger with only an elapsed-time condition would never
// have a first run to be measured from.
function anchoredAt(anchor: SequencerTriggerAnchor, anchors: SequencerTriggerAnchors) {
	return anchor.at ?? anchors.sessionStart
}

// Whether a count condition is satisfied. Zero disables the condition, as every numeric trigger of the
// contract does.
function reachedCount(frames: number, every: number) {
	return every > 0 && frames >= every
}

// Whether an elapsed-time condition is satisfied. `every` is in seconds and `elapsed` in milliseconds.
function reachedElapsed(elapsed: number, every: number) {
	return every > 0 && elapsed >= every * 1000
}

// Whether the frame requires a filter other than the one the trigger last ran through.
//
// The reference is the anchor and not the wheel, because the wheel stops describing the change as soon as
// something moves it. The frame preparation of the same safe point installs the filter the frame needs
// whether or not the trigger ran for it — a run suppressed by `minimumTimeBetweenRuns`, one skipped, and one
// whose retries were exhausted under `continue` all leave the anchor where it was — and from the next safe
// point on the selection and the installed filter agree, so a condition stated over the wheel would report
// the change as already served by a run that never happened.
//
// Before the trigger has ever run the reference is the baseline `sequencerFilterBaselined` recorded at the
// first safe point, which is the filter the session was found on: a first frame taken through the filter
// already installed changed nothing. The wheel is only consulted when no baseline was recorded, which is a
// session whose safe point did not apply one.
//
// The comparison is over the selection and not over the movement, which the frame preparation only performs
// later in the safe point: the whole point of the condition is to focus or dither for the filter the frame
// is about to be taken through, before anything moves.
function filterChanged(anchor: SequencerTriggerAnchor, observation: SequencerTriggerObservation) {
	if (observation.filter === undefined) return false

	return observation.filter !== (anchor.filter ?? observation.installedFilter)
}

// Whether the flip is due at this safe point.
//
// Two things have to hold, and neither needs an ephemeris. The target has to be past the earliest
// post-meridian hour angle the definition allows the flip to begin at, which the mount reports directly; and
// the mount has to still be on the pre-flip side, which is what distinguishes a flip that is pending from
// one that already happened. Without a pier side there is nothing that says the flip has not already run,
// and the hour angle alone keeps growing, so an unpublished side decides no flip rather than flipping on
// every frame for the rest of the night.
function meridianFlipDue(policy: Omit<SequencerMeridianFlip, 'enabled'>, observation: SequencerTriggerObservation) {
	const { hourAngle, pierSide, preFlipPierSide } = observation

	if (hourAngle === undefined || pierSide === undefined || preFlipPierSide === undefined) return false

	return pierSide === preFlipPierSide && hourAngle >= policy.minimumHourAngle
}

// Condition that selects the autofocus, or undefined when none does.
//
// The conditions are tested in a fixed order so that the reported reason is deterministic: the first run of
// the session, the flip that just happened, the recovery that just happened, the filter the frame needs, and
// then the three measured conditions — frames, elapsed time and temperature drift.
//
// `minimumTimeBetweenRuns` is applied at the end, over whatever won: it is the only global brake against
// thrashing when the temperature oscillates around its threshold, and half a degree of sensor noise would
// otherwise autofocus all night. It filters the execution and never the anchor, so a run suppressed by it
// advances nothing and the condition that selected it is still true at the next safe point.
//
// `starSizeChange` is not evaluated: measuring the star size of every frame is not part of this version, and
// the compiler rejects a definition that asks for it rather than letting it silently never fire.
function autofocusReason(policy: Omit<SequencerAutofocus, 'enabled'>, anchors: SequencerTriggerAnchors, observation: SequencerTriggerObservation, flipped: boolean): SequencerTriggerReason | undefined {
	const { triggers } = policy
	const anchor = anchors.autofocus
	const elapsed = observation.instant - anchoredAt(anchor, anchors)
	const reason =
		anchor.at === undefined && triggers.onStart
			? 'onStart'
			: flipped && triggers.afterMeridianFlip
				? 'afterMeridianFlip'
				: observation.recovered === true && triggers.afterRecovery
					? 'afterRecovery'
					: triggers.onFilterChange && filterChanged(anchor, observation)
						? 'filterChange'
						: reachedCount(anchor.frames, triggers.everyFrames)
							? 'frames'
							: reachedElapsed(elapsed, triggers.everyTime)
								? 'elapsed'
								: temperatureDrifted(anchor, observation, triggers.temperatureChange)
									? 'temperature'
									: undefined

	if (reason === undefined) return undefined

	return anchor.at !== undefined && elapsed < triggers.minimumTimeBetweenRuns * 1000 ? undefined : reason
}

// Whether the temperature moved far enough from the one observed at the last run. Zero disables it, and so
// does a missing reading on either side: without a reference there is no change to measure.
function temperatureDrifted(anchor: SequencerTriggerAnchor, observation: SequencerTriggerObservation, change: number) {
	if (change <= 0 || anchor.temperature === undefined || observation.temperature === undefined) return false

	return Math.abs(observation.temperature - anchor.temperature) >= change
}

// Condition that selects the dither, or undefined when none does.
//
// A dither is never suppressed because something else already moved the field. Its purpose is to impose
// small random displacements between subframes so that hot pixels and fixed pattern do not stack on the same
// point of the sky, and a centering does the opposite of that: it corrects the drift back to the reference
// position, which is exactly where the previous frames were taken. Treating a movement as a dither already
// performed would quietly lower the effective dither rate below what was configured.
function ditherReason(policy: Omit<SequencerDither, 'enabled'>, anchors: SequencerTriggerAnchors, observation: SequencerTriggerObservation, flipped: boolean): SequencerTriggerReason | undefined {
	const anchor = anchors.dither
	const elapsed = observation.instant - anchoredAt(anchor, anchors)

	return anchor.at === undefined && policy.beforeFirstFrame
		? 'beforeFirstFrame'
		: flipped && policy.afterMeridianFlip
			? 'afterMeridianFlip'
			: policy.afterFilterChange && filterChanged(anchor, observation)
				? 'filterChange'
				: reachedCount(anchor.frames, policy.everyFrames)
					? 'frames'
					: reachedElapsed(elapsed, policy.everyTime)
						? 'elapsed'
						: undefined
}
