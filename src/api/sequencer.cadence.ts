import { abortableDelay } from './operation.wait'
import { sequencerActionFailure } from './sequencer.action'
import type { SequencerActionContext, SequencerActionResult } from './sequencer.registry'

// Inter-frame cadence: the minimum spacing between exposures, expressed as a boundary instead of as a sleep.
//
// `capture.delay`, `frame.delay` and `capture.settle` do not ask for additional time, they ask for a minimum
// spacing. Written as a sleep appended to the safe point they would be paid twice: an autofocus that took two
// minutes already gave the sensor far more read-out and thermal recovery slack than the sixty seconds the
// delay asks for, and sleeping those sixty seconds again buys nothing but sky.
//
// So the delay is a deadline the work of the safe point absorbs. Whatever the triggers, the flip, the
// centering, the focus run and the frame preparation spent counts against it, and the wait at the end is only
// what is still missing — usually nothing.
//
// The settle is the same boundary anchored on a different event. It is not a spacing between two frames of a
// group: it covers the mechanical settling no device reports as state, so it is anchored on the completion of
// a slew or a centering and on the resume after a pause, and it stops applying once a frame has been exposed
// against it.
//
// The boundary has to be knowable at guard time, which is why the cadence is step 9 of the safe point and not
// step 0: the pre-exposure guard projects the exposure from it, and applying it before the dither would spend
// the guiding settle standing still.
//
// Durations are seconds, instants are epoch milliseconds.

// Events the cadence boundary is measured from.
//
// Both are absent at the start of a session, which is the only state in which nothing spaces the first
// exposure: there is no previous frame to space it from and no movement for it to settle after.
export interface SequencerCadenceAnchors {
	// Instant the last exposure of the session ended, in epoch milliseconds, absent before the first one.
	readonly exposureEndedAt?: number
	// Instant of the last movement the initial settle covers, in epoch milliseconds — the completion of a
	// slew or a centering, or a resume — absent once an exposure has already been spaced against it.
	readonly settleAnchoredAt?: number
}

// Spacing the capture plan declares, as the lowering resolved it for the selected frame.
export interface SequencerCadenceSpacing {
	// Minimum spacing between the end of one exposure and the start of the next, in seconds, which is the
	// frame delay when declared and the capture delay otherwise.
	readonly delay: number
	// Stable time required before the first or a resumed exposure, in seconds.
	readonly settle: number
}

// Anchors of a session that has neither exposed nor moved yet.
export const SEQUENCER_INITIAL_CADENCE_ANCHORS: SequencerCadenceAnchors = {}

// Earliest instant the selected frame may start at, in epoch milliseconds, or `0` when nothing spaces it.
//
// The two spacings are a maximum and never a sum: they are both minimum distances from an instant that has
// already passed, so the later of the two satisfies both. Adding them would charge the session for a slew and
// a read-out that overlapped in time.
export function sequencerCadenceBoundary(anchors: SequencerCadenceAnchors, spacing: SequencerCadenceSpacing): number {
	const delayed = anchors.exposureEndedAt === undefined || spacing.delay <= 0 ? 0 : anchors.exposureEndedAt + spacing.delay * 1000
	const settled = anchors.settleAnchoredAt === undefined || spacing.settle <= 0 ? 0 : anchors.settleAnchoredAt + spacing.settle * 1000

	return Math.max(delayed, settled)
}

// Records the end of an exposure, which starts the spacing of the next one and retires the initial settle.
//
// The settle is retired because a frame that was exposed after the movement was already spaced against it;
// keeping the anchor would make the settle a per-frame delay, which is exactly what it is not.
export function sequencerExposureEnded(at: number): SequencerCadenceAnchors {
	return { exposureEndedAt: at }
}

// Records the movement the initial settle is measured from, keeping the spacing of the previous exposure.
//
// Both anchors coexist on purpose: a slew that happens between two frames of a group has to satisfy the read
// out spacing of the previous frame and the mechanical settling of the movement, whichever ends later.
export function sequencerSettleAnchored(anchors: SequencerCadenceAnchors, at: number): SequencerCadenceAnchors {
	return { ...anchors, settleAnchoredAt: at }
}

// Waits until the cadence boundary, returning the seconds actually waited, which is zero whenever the work of
// the safe point already absorbed the spacing.
//
// The boundary is an absolute instant rather than a duration, so the remaining time is recomputed after every
// tick and a timer that fires early does not release the exposure ahead of the spacing it was asked to honor.
export async function waitForCadenceBoundary(context: SequencerActionContext, boundary: number): Promise<SequencerActionResult<number>> {
	const started = context.now()
	let announced = false

	for (;;) {
		const remaining = boundary - context.now()

		if (remaining <= 0) break

		if (!announced) {
			announced = true
			context.progress({ detail: 'waiting for the minimum spacing between frames' })
		}

		const waited = await abortableDelay(remaining, context.signal)

		if (!waited.ok) return sequencerActionFailure(waited, 'the wait for the minimum spacing between frames was interrupted')
	}

	return { type: 'completed', value: (context.now() - started) / 1000 }
}
