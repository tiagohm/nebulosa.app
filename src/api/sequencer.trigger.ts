import type { FrameType, PierSide } from 'nebulosa/src/devices/indi/device'
import type { SequencerAutofocus, SequencerDither, SequencerMeridianFlip } from '#/sequencer'
import type { SequencerPlan } from '#/sequencer.plan'
import type { SequencerTriggerAnchor, SequencerTriggerAnchors, SequencerTriggerEventReason } from '#/sequencer.state'
import { SEQUENCER_BLOCK_TYPE, sequencerPlanNodes } from './sequencer.compiler'
import type { SequencerDitherTrigger, SequencerFocus, SequencerMeridianFlipTrigger } from './sequencer.compiler'

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
export type SequencerTriggerReason = 'onStart' | 'beforeFirstFrame' | SequencerTriggerEventReason | 'filterChange' | 'frames' | 'elapsed' | 'temperature' | 'hourAngle'

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
	readonly dither?: SequencerDitherTrigger
}

// Trigger policies the compiled plan lowered, or undefined when the plan enables none.
//
// The snapshot reads this instead of walking the tree itself: the live half has to name the same triggers
// the walk will evaluate, and the lowering is the only place that already decided which ones exist.
export function sequencerPlanTriggerPolicies(plan: SequencerPlan): SequencerTriggerPolicies | undefined {
	let meridianFlip: SequencerMeridianFlipTrigger | undefined
	let autofocus: SequencerFocus | undefined
	let dither: SequencerDitherTrigger | undefined

	for (const node of sequencerPlanNodes(plan.root)) {
		if (node.kind !== 'action') continue

		if (node.type === SEQUENCER_BLOCK_TYPE.meridianFlip) meridianFlip = node.configuration as SequencerMeridianFlipTrigger
		else if (node.type === SEQUENCER_BLOCK_TYPE.autofocus) autofocus = node.configuration as SequencerFocus
		else if (node.type === SEQUENCER_BLOCK_TYPE.dither) dither = node.configuration as SequencerDitherTrigger
	}

	return meridianFlip === undefined && autofocus === undefined && dither === undefined ? undefined : { meridianFlip, autofocus, dither }
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
	// Whether a crossing that already happened is still owed the recovery it was interrupted during, which
	// makes the flip due again no matter which side the mount is on. The crossing left the pointing raw and
	// the pier side it changed is precisely what would otherwise report the flip as no longer needed.
	readonly flipRecoveryPending?: boolean
	// Temperature the focus drift is measured against, in degrees Celsius, absent when no device reports one.
	readonly temperature?: number
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
// A flip the definition asked to focus by itself is the autofocus of its safe point. Its node runs the same
// sweep the standalone block runs, under the same reservation, so deciding a standalone autofocus next to it
// would sweep the focuser twice in a row and spend minutes measuring the focus that was just measured. The
// standalone decision is therefore omitted while that flip is the one being run, and the anchor advances on
// the focus nested in its outcome, which is what `sequencerTriggerPending` keeps owed if that focus fails.
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

	if (policies.autofocus !== undefined && !focusedByFlip(policies, flipped)) {
		const reason = autofocusReason(policies.autofocus, anchors, observation, flipped)

		if (reason !== undefined) decisions.push({ kind: 'autofocus', reason })
	}

	if (policies.dither !== undefined) {
		const reason = ditherReason(policies.dither, anchors, observation, flipped)

		if (reason !== undefined) decisions.push({ kind: 'dither', reason })
	}

	return decisions
}

// Records the one-shot condition that selected an autofocus, so it outlives the run it selected.
//
// `afterMeridianFlip` is an edge and not a state: the flip is over as soon as the mount publishes the other
// side of the pier. A run that fails, is skipped, is suppressed by `minimumTimeBetweenRuns` or exhausts its
// retries under `continue` correctly leaves the anchor where it was, but the anchor is measured against a
// condition that no longer exists, so the promised focus would simply never be attempted again — the frames
// after a flip would be exposed through whatever focus the event invalidated until an unrelated periodic
// condition happened to fire.
//
// It is therefore applied at the safe point that decided, before the run, and it is `sequencerAnchorAdvanced`
// that clears it once a run focused. The anchors are returned unchanged when no autofocus was selected or when
// the condition that selected it was one the next safe point can observe again on its own.
export function sequencerTriggerPending(policies: SequencerTriggerPolicies, anchors: SequencerTriggerAnchors, decisions: readonly SequencerTriggerDecision[]): SequencerTriggerAnchors {
	const reason = pendingOf(policies, decisions)

	if (reason === undefined || anchors.pendingAutofocus === reason) return anchors

	return { ...anchors, pendingAutofocus: reason }
}

// One-shot condition owed by this safe point, or undefined when none is.
//
// The condition is read from the autofocus decision when there is one, and from the event itself when there
// is not: the standalone decision is absent both when a flip refocuses inside its own node and when
// `minimumTimeBetweenRuns` suppressed the run, and in neither case has the focus the event invalidated been
// measured. Reading the event directly is what keeps the promise alive through the rate limiter, which filters
// the execution of this safe point and must not cancel a condition that no later safe point can observe again.
//
// It is owed only to a definition whose autofocus asks for that event, and an autofocus decision taken for any
// other condition owes nothing: the run selected at this safe point measures the same focus the event
// invalidated.
function pendingOf(policies: SequencerTriggerPolicies, decisions: readonly SequencerTriggerDecision[]): SequencerTriggerEventReason | undefined {
	const decision = decisions.find((item) => item.kind === 'autofocus')

	if (decision !== undefined) return decision.reason === 'afterMeridianFlip' ? 'afterMeridianFlip' : undefined

	const triggers = policies.autofocus?.triggers

	if (triggers === undefined) return undefined

	return triggers.afterMeridianFlip && decisions.some((item) => item.kind === 'meridianFlip') ? 'afterMeridianFlip' : undefined
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
//
// A run of the autofocus also settles whatever one-shot condition was owed: the focus the flip or the recovery
// invalidated is exactly what this run just measured, and keeping the promise alive would run it again at the
// next safe point for an event that has already been served.
export function sequencerAnchorAdvanced(anchors: SequencerTriggerAnchors, kind: 'autofocus' | 'dither' | 'driftCheck', observation: SequencerTriggerObservation): SequencerTriggerAnchors {
	const anchor = { at: observation.instant, frames: 0, temperature: observation.temperature, filter: observation.filter } satisfies SequencerTriggerAnchor

	if (kind !== 'autofocus') return { ...anchors, [kind]: anchor }

	const { pendingAutofocus, ...rest } = anchors

	return { ...rest, autofocus: anchor }
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

// Whether the flip being run at this safe point refocuses inside its own node, which is what makes a
// standalone autofocus at the same safe point a second sweep of the same focuser through the same field.
//
// It is stated over the flip that actually won, not over the policy alone: a definition whose flip refocuses
// suppresses nothing at the safe points where no flip is due. Whether the flip refocuses is the autofocus
// trigger itself, which is the same condition the lowering nested the focusing into the flip node under.
function focusedByFlip(policies: SequencerTriggerPolicies, flipped: boolean) {
	return flipped && policies.autofocus?.triggers.afterMeridianFlip === true
}

// Whether the flip is due at this safe point.
//
// Two things have to hold, and neither needs an ephemeris. The target has to be past the earliest
// post-meridian hour angle the definition allows the flip to begin at, which the mount reports directly; and
// the mount has to still be on the pre-flip side, which is what distinguishes a flip that is pending from
// one that already happened. Without a pier side there is nothing that says the flip has not already run,
// and the hour angle alone keeps growing, so an unpublished side decides no flip rather than flipping on
// every frame for the rest of the night.
//
// A crossing that already happened and whose recovery was interrupted is due on its own, ahead of both: the
// side changed, so the pier-side condition reports the flip as served while the pointing and the focus that
// crossing invalidated were never re-established, and every frame after it would be taken through the raw
// crossing. The node it selects resumes at that recovery instead of crossing a second time.
function meridianFlipDue(policy: Omit<SequencerMeridianFlip, 'enabled'>, observation: SequencerTriggerObservation) {
	const { hourAngle, pierSide, preFlipPierSide } = observation

	if (observation.flipRecoveryPending === true) return true

	if (hourAngle === undefined || pierSide === undefined || preFlipPierSide === undefined) return false

	return pierSide === preFlipPierSide && hourAngle >= policy.minimumHourAngle
}

// Condition that selects the autofocus, or undefined when none does.
//
// The conditions are tested in a fixed order so that the reported reason is deterministic: the first run of
// the session, the flip that just happened, the flip of an earlier safe point that is still owed a focus, the
// filter the frame needs, and then the three measured conditions — frames, elapsed time and temperature drift.
//
// `minimumTimeBetweenRuns` is applied at the end, over whatever won: it is the only global brake against
// thrashing when the temperature oscillates around its threshold, and half a degree of sensor noise would
// otherwise autofocus all night. It filters the execution and never the anchor, so a run suppressed by it
// advances nothing and the condition that selected it is still true at the next safe point.
function autofocusReason(policy: Omit<SequencerAutofocus, 'enabled'>, anchors: SequencerTriggerAnchors, observation: SequencerTriggerObservation, flipped: boolean): SequencerTriggerReason | undefined {
	const { triggers } = policy
	const anchor = anchors.autofocus
	const elapsed = observation.instant - anchoredAt(anchor, anchors)
	const pending = pendingReason(triggers, anchors.pendingAutofocus)
	const reason =
		anchor.at === undefined && triggers.onStart
			? 'onStart'
			: flipped && triggers.afterMeridianFlip
				? 'afterMeridianFlip'
				: (pending ??
					(triggers.onFilterChange && filterChanged(anchor, observation) ? 'filterChange' : reachedCount(anchor.frames, triggers.everyFrames) ? 'frames' : reachedElapsed(elapsed, triggers.everyTime) ? 'elapsed' : temperatureDrifted(anchor, observation, triggers.temperatureChange) ? 'temperature' : undefined))

	if (reason === undefined) return undefined

	return anchor.at !== undefined && elapsed < triggers.minimumTimeBetweenRuns * 1000 ? undefined : reason
}

// Condition owed by an earlier safe point whose autofocus never focused, or undefined when nothing is owed.
//
// The trigger flag is consulted again rather than assumed: the definition that selected the run is the one
// running, but a session resumed against an edited definition that no longer asks to focus after a flip must
// not focus for a flip it no longer recognizes. The promise is then simply dropped, which is what disabling
// the trigger means, and the next run of the autofocus clears the anchor anyway.
function pendingReason(triggers: SequencerAutofocus['triggers'], pending?: SequencerTriggerEventReason) {
	return pending !== undefined && triggers.afterMeridianFlip ? pending : undefined
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

	return anchor.at === undefined && policy.beforeFirstFrame ? 'beforeFirstFrame' : policy.afterFilterChange && filterChanged(anchor, observation) ? 'filterChange' : reachedCount(anchor.frames, policy.everyFrames) ? 'frames' : reachedElapsed(elapsed, policy.everyTime) ? 'elapsed' : undefined
}
