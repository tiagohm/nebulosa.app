import { abortableDelay } from './operation.wait'
import { sequencerActionFailure } from './sequencer.action'
import type { SequencerActionContext, SequencerActionResult } from './sequencer.registry'

// Inter-frame cadence: the minimum spacing between exposures, expressed as a boundary instead of as a sleep.
//
// `capture.delay` and `frame.delay` do not ask for additional time, they ask for a minimum spacing. Written as
// a sleep appended to the safe point they would be paid twice: an autofocus that took two minutes already gave
// the sensor far more read-out and thermal recovery slack than the sixty seconds the delay asks for, and
// sleeping those sixty seconds again buys nothing but sky.
//
// So the delay is a deadline the work of the safe point absorbs. Whatever the triggers, the flip, the
// centering, the focus run and the frame preparation spent counts against it, and the wait at the end is only
// what is still missing — usually nothing.
//
// The mechanical settling of a movement is not spaced here: every operation that moves the optical path
// settles under its own declared settle before it reports completion, so the cadence measures only the
// distance between two exposures.
//
// The boundary has to be knowable at guard time, which is why the cadence is step 9 of the safe point and not
// step 0: the pre-exposure guard projects the exposure from it, and applying it before the dither would spend
// the guiding settle standing still.
//
// Durations are seconds, instants are epoch milliseconds.

// Event the cadence boundary is measured from.
//
// It is absent at the start of a session, which is the only state in which nothing spaces the first exposure:
// there is no previous frame to space it from.
export interface SequencerCadenceAnchors {
	// Instant the last exposure of the session ended, in epoch milliseconds, absent before the first one.
	readonly exposureEndedAt?: number
}

// Anchors of a session that has not exposed yet.
export const SEQUENCER_INITIAL_CADENCE_ANCHORS: SequencerCadenceAnchors = {}

// Earliest instant the selected frame may start at, in epoch milliseconds, or `0` when nothing spaces it.
//
// `delay` is the spacing the lowering resolved for the selected frame, in seconds: the frame delay when it
// declares one and the capture delay otherwise.
export function sequencerCadenceBoundary(anchors: SequencerCadenceAnchors, delay: number): number {
	return anchors.exposureEndedAt === undefined || delay <= 0 ? 0 : anchors.exposureEndedAt + delay * 1000
}

// Records the end of an exposure, which starts the spacing of the next one.
export function sequencerExposureEnded(at: number): SequencerCadenceAnchors {
	return { exposureEndedAt: at }
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
