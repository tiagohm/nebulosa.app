import type { PHD2Settle } from 'nebulosa/src/devices/guiding/phd2'
import type { SequencerGuiderSettle } from '#/sequencer'
import { sequencerActionFailure } from './sequencer.action'
import { runDither } from './sequencer.guiding'
import type { SequencerDitherOutcome, SequencerDitherTrigger, SequencerGuidingServices } from './sequencer.guiding'
import type { SequencerActionContext, SequencerActionResult } from './sequencer.registry'

// The guiding interlock of a safe point: the steps that move pointing, focus or angle run with the guiding
// corrections suspended, and the corrections come back once for all of them.
//
// The steps of a safe point that move something the guider is watching cannot run under an active correction
// loop. An autofocus sweeps the focuser through hundreds of steps and, with an off-axis guider, defocuses the
// guide star along with it: the guider loses the lock and starts correcting against noise, which moves the
// mount while the measurement is being taken. A rotator pushes the guide star out of the search box, and a
// centering moves the mount underneath the loop. None of this fails cleanly — it produces trailed frames with
// nothing reported wrong.
//
// So the bracket is single for the whole safe point rather than one per action: suspending and resuming per
// action would pay one settle per action for the same suspension. It is written with what the guider session
// already exposes — the corrections stop by looping without guiding, which keeps the star acquired, and come
// back with a guide that does not recalibrate.
//
// Recalibrating on the resume would redo work that is still valid and cost minutes of every safe point. The
// one exception is the meridian flip: the declination axis moves the star the other way afterwards, so the
// previous calibration has the wrong sign, and the recalibration happens here, inside the bracket of that
// safe point, rather than as a step of its own.
//
// Settles are fused instead of accumulated. The settle installed on the session is the strongest of the ones
// in play at this safe point, and the dither is emitted immediately after the resume, inside the bracket, so
// the safe point stands still for the settles the guider itself pays and for none of its own. What is never
// done is suppressing the dither because a centering "already moved" the field: a centering corrects drift
// back to the reference position, which is exactly where the previous frames were taken, so it removes the
// positional diversity a dither exists to provide.
//
// Guide errors and settle tolerances are guider pixels; declared settle times and timeouts are seconds.

// What the safe point asks of one bracket.
export interface SequencerInterlockRequest {
	// General guiding settle policy, applied after any state transition of the guiding.
	readonly settle: SequencerGuiderSettle
	// Whether the resume must recalibrate when a meridian flip crossed inside this bracket.
	readonly recalibrateAfterMeridianFlip: boolean
	// Dither that won this safe point, absent when none did. It is emitted with the resume rather than as a
	// step after it, and it is emitted whatever the bracketed steps did.
	readonly dither?: SequencerDitherTrigger
}

// What the bracketed steps report back to the bracket while they run.
export interface SequencerInterlockState {
	// Set by the body when the mount crossed the meridian inside this bracket, which is what turns the resume
	// into a recalibration when the definition asks for one. It is reported by the body rather than decided
	// beforehand because a flip that was planned and then skipped invalidates no calibration.
	flipped: boolean
}

// The steps of the safe point that run with the corrections suspended, in their own fixed order.
export type SequencerInterlockBody<T> = (state: SequencerInterlockState) => Promise<SequencerActionResult<T>>

// Step of the bracket a failure came out of. The bracket runs steps of three different origins around the body
// it was given, and a failure of each of them means something different to the caller.
export type SequencerInterlockPhase = 'suspension' | 'body' | 'resume' | 'dither'

// Mutable record of what the bracket did, filled as it runs so the caller can attribute the failure it returns.
export interface SequencerInterlockReport {
	// Phase the returned failure came from, absent while nothing failed. It is what lets the caller apply the
	// terminal policy of the step that actually failed: the dither is emitted by the bracket rather than walked
	// by the plan, and it carries its own retry budget and `onFailure` (§10).
	phase?: SequencerInterlockPhase
}

// What one bracket did, around what its steps produced.
export interface SequencerInterlockOutcome<T> {
	// Value the bracketed steps completed with.
	readonly value: T
	// Whether the corrections were actually suspended, which is false for a session that is not guiding.
	readonly suspended: boolean
	// Whether the resume recalibrated instead of guiding on the existing solution.
	readonly recalibrated: boolean
	// Dither taken with the resume, absent when none was in play or when the guider had nothing to displace.
	// The trigger anchor advances on this and not on the request, so a skipped dither does not count as taken.
	readonly dither?: SequencerDitherOutcome
}

// Guiding sessions this interlock suspended and did not get back to guiding, by guider id, mapped to whether
// each of them still owes a recalibration.
//
// It is what says a looping guider is a suspension of this bracket rather than the state someone else asked
// for. Looping proves nothing on its own: the operator or another program can be looping deliberately — to
// frame, to acquire a star, to watch the seeing — and a session that never issued the `startGuiding` lifecycle
// action is unguided by configuration, so resuming on the strength of looping alone would enable corrections
// on a guiding session this sequencer never guided.
//
// The debt is carried because the calibration a crossing invalidated stays invalid until it is redone: a
// recalibration that failed leaves the guider suspended, and the next bracket starts with no flip of its own,
// so guiding on the existing solution would correct declination with the sign the crossing reversed and drag
// the star across every exposure that follows.
//
// An entry is added when the suspension lands and removed when the guider is guiding again, so the map only
// ever holds the guiders some bracket left behind, and it is deliberately shared by every session: a guider
// abandoned by one session is picked up by the next bracket that commands it, whichever session opens it. It
// does not survive the process, which is the same lifetime the V1 sessions have.
const suspendedGuiders = new Map<string, boolean>()

// Strongest of two settle policies, field by field.
//
// Strongest means hardest to satisfy for the accuracy fields and most patient for the waiting ones: the
// smallest tolerated error, the longest time it has to be held, the largest number of guide frames observed,
// and the longest the guider may take to get there. Fusing this way keeps a safe point where a dither and the
// bracket are both in play from settling twice, once loosely and once strictly, while never settling to a
// weaker criterion than either of them asked for.
export function sequencerFuseGuiderSettle(settle: SequencerGuiderSettle, other?: SequencerGuiderSettle): SequencerGuiderSettle {
	if (other === undefined) return settle

	return {
		tolerance: Math.min(settle.tolerance, other.tolerance),
		time: Math.max(settle.time, other.time),
		timeout: Math.max(settle.timeout, other.timeout),
		minimumFrames: Math.max(settle.minimumFrames, other.minimumFrames),
	}
}

// Translates a declared settle into the settle the guider transport understands.
//
// `minimumFrames` has no counterpart in the transport, which counts frames by its own settling rule, so it
// survives only in the fused policy the session keeps and not in the command.
function guiderSettle(settle: SequencerGuiderSettle): PHD2Settle {
	return { pixels: settle.tolerance, time: settle.time, timeout: settle.timeout }
}

// Puts the guider back to work at the end of a bracket, reporting which of the two ways it is being done.
//
// `recalibrate` asks for the calibration to be redone instead of guiding on the existing solution, which is
// what a meridian flip inside the bracket requires and nothing else does.
function resumeGuiding(services: SequencerGuidingServices, context: SequencerActionContext, guider: NonNullable<SequencerActionContext['guider']>, recalibrate: boolean) {
	context.progress({ detail: recalibrate ? 'recalibrating the guider' : 'resuming the guiding corrections' })

	return recalibrate ? services.guiderCommander.calibrate(guider, { signal: context.signal }) : services.guiderCommander.startGuiding(guider, { signal: context.signal })
}

// Runs the moving steps of a safe point inside one guiding bracket, and emits the dither with the resume.
//
// A session whose guider is neither guiding nor looping runs the body with no bracket at all: there are no
// corrections to stop, and suspending a guider that is idle would only wait for a state it is already in. The
// dither still goes through, because deciding it has nothing to displace belongs to the dither and not to the
// bracket.
//
// The resume is attempted even when the body failed, so a safe point that ends badly does not leave the
// session looping without corrections until the next one. The failure of the body is what gets reported,
// since it is the one that explains the safe point.
//
// `report` is filled in place with the phase a returned failure came from, and is left untouched by a bracket
// that completed. A body that throws reports nothing, because the exception is what explains the safe point
// and it never reaches the caller as a result.
export async function runGuidingInterlock<T>(services: SequencerGuidingServices, context: SequencerActionContext, request: SequencerInterlockRequest, body: SequencerInterlockBody<T>, report?: SequencerInterlockReport): Promise<SequencerActionResult<SequencerInterlockOutcome<T>>> {
	// A guider looping under the marker of this interlock is a suspension a previous bracket could not resume,
	// and bracketing it is what ends it: leaving it out because it is not guiding right now runs the body
	// unbracketed and, more importantly, never resumes, so the session keeps exposing uncorrected for the rest
	// of the night with the guider still dutifully looping. Looping without the marker belongs to whoever asked
	// for it and is left exactly as it is.
	const guider = context.guider !== undefined && (services.guiderCommander.running(context.guider) || (suspendedGuiders.has(context.guider) && services.guiderCommander.looping(context.guider))) ? context.guider : undefined
	// Recalibration a previous bracket of this guider could not complete, which this one has to pay before the
	// corrections come back, whether or not anything crosses the meridian inside it.
	const owed = guider !== undefined && suspendedGuiders.get(guider) === true
	const state: SequencerInterlockState = { flipped: false }
	const settle = sequencerFuseGuiderSettle(request.settle, request.dither?.settle)

	if (guider !== undefined) {
		context.progress({ detail: 'suspending the guiding corrections' })

		// Looping is the suspension: the exposures continue, so the star stays acquired and the resume has
		// something to guide on, while no correction reaches the mount. The fused settle is installed with the
		// same command, which is what makes the resume and the dither after it settle under one policy.
		const suspended = await services.guiderCommander.loop(guider, { settle: guiderSettle(settle) }, { signal: context.signal })

		if (!suspended.ok) {
			if (report !== undefined) report.phase = 'suspension'
			return sequencerActionFailure(suspended, 'the guiding corrections could not be suspended')
		}

		suspendedGuiders.set(guider, owed)
	}

	let executed: SequencerActionResult<T>

	try {
		executed = await body(state)
	} catch (e) {
		// A body that throws reports nothing, but it leaves the guider looping exactly like a body that failed:
		// the runtime turns the exception into a fatal failure and the session ends with the corrections stopped
		// and the guider still exposing. The resume is therefore attempted here too, and whatever it answers is
		// discarded — the exception is what explains the safe point and is the one that continues on its way.
		if (guider !== undefined) {
			const recalibrate = owed || (state.flipped && request.recalibrateAfterMeridianFlip)
			const resumed = await resumeGuiding(services, context, guider, recalibrate).catch(() => undefined)

			if (resumed?.ok) suspendedGuiders.delete(guider)
			else suspendedGuiders.set(guider, recalibrate)
		}

		throw e
	}

	let recalibrated = false

	if (guider !== undefined) {
		recalibrated = owed || (state.flipped && request.recalibrateAfterMeridianFlip)

		const resumed = await resumeGuiding(services, context, guider, recalibrated)

		if (resumed.ok) suspendedGuiders.delete(guider)
		else suspendedGuiders.set(guider, recalibrated)

		if (executed.type !== 'completed') {
			if (report !== undefined) report.phase = 'body'
			return executed
		}

		if (!resumed.ok) {
			if (report !== undefined) report.phase = 'resume'
			return sequencerActionFailure(resumed, 'the guiding corrections could not be resumed')
		}
	} else if (executed.type !== 'completed') {
		if (report !== undefined) report.phase = 'body'
		return executed
	}

	const outcome: SequencerInterlockOutcome<T> = { value: executed.value, suspended: guider !== undefined, recalibrated }

	if (request.dither === undefined) return { type: 'completed', value: outcome }

	const dithered = await runDither(services, context, request.dither)

	if (dithered.type !== 'completed' && dithered.type !== 'skipped') {
		if (report !== undefined) report.phase = 'dither'
		return dithered
	}

	return { type: 'completed', value: dithered.type === 'completed' ? { ...outcome, dither: dithered.value } : outcome }
}
