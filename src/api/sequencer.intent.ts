import type { OperationFailureReason } from '#/orchestration'
import type { SequencerDesiredState, SequencerFailure, SequencerSessionState } from '#/sequencer.state'
import { isSequencerTerminalState } from '#/sequencer.state'

// Control lane of a session: the queue every control command enters and the single reducer that turns the
// queued commands into one decision.
//
// Nothing else in the runtime decides what a `pause` or a `stop` means. A command arrives from an HTTP
// handler, from a monitor, or from the runtime itself when an action settles, and all of them go through the
// same queue and the same fold, in arrival order. That is what makes two commands that raced produce one
// outcome instead of two code paths overwriting each other's state.
//
// The queue always accepts. A state that does not act on a command reduces it to a no-op and records why,
// and no state refuses it at the edge: refusing there would make the transport know the state machine and
// answer for it, and it would make an HTTP response either fail a user who did the right thing or promise a
// shutdown that never happens. The record is what later explains why the night ended the way it did.
//
// Instants are milliseconds since the Unix epoch.

// Commands the control lane serializes.
//
// The three operator commands are the ones a user issues; the rest are produced by the runtime and by the
// resource layer, and they are here rather than in a side channel because the whole point of one queue is
// that they cannot interleave with an operator command halfway through a transition. Adding `safetyUnsafe`
// and `safetySafe` later is two more cases in the fold below, which is why the queue exists in V1 already.
export type SequencerIntentKind = 'pause' | 'resume' | 'stop' | 'resourceLost' | 'resourceRestored' | 'actionCompleted' | 'actionFailed' | 'retryTimer'

// One queued command, stamped with the position it arrived at.
export interface SequencerIntent {
	// Command being issued.
	readonly kind: SequencerIntentKind
	// Arrival position within the session, starting at 1 and strictly increasing. It is what makes the fold
	// deterministic: two commands submitted in the same turn reduce in the order they were submitted, never in
	// the order the runtime happened to look at them.
	readonly sequence: number
	// Instant the command was queued.
	readonly at: number
	// Normalized cause carried by a command that reports a failure, such as a resource that was lost or an
	// action that failed. Absent on the operator commands, which report no cause.
	readonly reason?: OperationFailureReason
	// Human-readable detail, kept short because it is persisted verbatim with the event.
	readonly detail?: string
}

// What the reduction of one command asks the runtime to do.
// - pause: converge to `paused` at the boundary the pause mode selects.
// - resume: converge back to `running` from the node the checkpoint holds.
// - stop: converge to `stopped`, keeping the reservation until the terminal pipeline ran.
// - fail: the session cannot go on; V1 has no state to wait for a resource in.
// - advance: the plan may take another step, because an action settled or a retry timer elapsed.
// - none: the command was accepted, recorded, and did nothing.
export type SequencerIntentEffect = 'pause' | 'resume' | 'stop' | 'fail' | 'advance' | 'none'

// Why a command that was accepted did nothing.
// - terminal: the session already ended, and nothing moves it again.
// - finalizing: the terminal pipeline is running and no command interrupts it.
// - stopping: the session is already converging to `stopped`, which nothing reverses.
// - alreadyPaused: a pause was already pending or in effect.
// - notPaused: a resume arrived at a session nobody paused.
// - nothingWaiting: a resource came back while nothing was waiting for one, which V1 never does.
export type SequencerIntentNoop = 'terminal' | 'finalizing' | 'stopping' | 'alreadyPaused' | 'notPaused' | 'nothingWaiting'

// Explanation persisted with the no-op, so the session history says why the command did nothing rather than
// leaving a reader to infer it from the state the session happened to be in at the time.
export const SEQUENCER_INTENT_NOOP_DETAIL: Readonly<Record<SequencerIntentNoop, string>> = {
	terminal: 'the session had already ended',
	finalizing: 'the terminal pipeline was running and is never interrupted',
	stopping: 'the session was already stopping',
	alreadyPaused: 'the session was already pausing or paused',
	notPaused: 'the session was not paused',
	nothingWaiting: 'nothing was waiting for the resource',
}

// Result of reducing one command.
export interface SequencerIntentOutcome {
	// Command that was reduced.
	readonly intent: SequencerIntent
	// What it asks the runtime to do.
	readonly effect: SequencerIntentEffect
	// Why it did nothing, present exactly when the effect is `none`.
	readonly noop?: SequencerIntentNoop
}

// Result of folding everything the queue held.
export interface SequencerIntentReduction {
	// Desired state after the fold, which the runtime converges the session to.
	readonly desiredState: SequencerDesiredState
	// One outcome per command, in arrival order, whether it acted or not.
	readonly outcomes: readonly SequencerIntentOutcome[]
	// Cause the fold commits the session to, from the first command that failed it. It is the first and not
	// the last on purpose: a lost camera followed by a lost mount is one night ended by the camera.
	readonly failure?: SequencerFailure
}

// Whether a state still acts on control commands at all.
//
// `finalizing` is separated from the terminal states rather than lumped with them because the two produce
// different records: a stop during finalization is a command the operator issued against a session that was
// still running, and it is worth telling apart from one issued at a session that had already ended.
function refusalOf(state: SequencerSessionState): SequencerIntentNoop | undefined {
	if (isSequencerTerminalState(state)) return 'terminal'
	return state === 'finalizing' ? 'finalizing' : undefined
}

// Reduces one command against the state the fold has reached so far.
//
// `desired` is the desired state produced by every command ahead of this one in the same fold, not the one
// stored when the drain began. That is what makes a pause followed by a resume in the same turn settle on
// `running`, and a stop followed by a pause settle on `stopped`.
function reduceIntent(state: SequencerSessionState, desired: SequencerDesiredState, intent: SequencerIntent): SequencerIntentOutcome {
	const refusal = refusalOf(state)

	if (refusal !== undefined) return { intent, effect: 'none', noop: refusal }

	switch (intent.kind) {
		case 'pause':
			if (desired === 'stopped') return { intent, effect: 'none', noop: 'stopping' }
			return desired === 'paused' ? { intent, effect: 'none', noop: 'alreadyPaused' } : { intent, effect: 'pause' }
		case 'resume':
			if (desired === 'stopped') return { intent, effect: 'none', noop: 'stopping' }
			return desired === 'paused' ? { intent, effect: 'resume' } : { intent, effect: 'none', noop: 'notPaused' }
		case 'stop':
			// A stop is absorbing: nothing after it moves the session back to running or to paused, so a second
			// one has nothing left to ask for.
			return desired === 'stopped' ? { intent, effect: 'none', noop: 'stopping' } : { intent, effect: 'stop' }
		case 'resourceLost':
			// V1 has no `waitingResources`, so a resource that went away ends the session with the cause that
			// took it. Reducing it to a stop instead would record a decision the operator never made.
			return desired === 'stopped' ? { intent, effect: 'none', noop: 'stopping' } : { intent, effect: 'fail' }
		case 'resourceRestored':
			return { intent, effect: 'none', noop: 'nothingWaiting' }
		case 'actionCompleted':
		case 'actionFailed':
		case 'retryTimer':
			// These carry no control decision of their own: they only say the plan has something to do next, and
			// the failure policy is what decides what. They still travel through the queue so they cannot be
			// observed halfway through an operator command.
			return desired === 'stopped' ? { intent, effect: 'none', noop: 'stopping' } : { intent, effect: 'advance' }
	}
}

// Desired state a command that acted converges the session to, or the current one when it changes nothing.
function desiredStateAfter(effect: SequencerIntentEffect, desired: SequencerDesiredState): SequencerDesiredState {
	switch (effect) {
		case 'pause':
			return 'paused'
		case 'resume':
			return 'running'
		case 'stop':
		case 'fail':
			return 'stopped'
		default:
			return desired
	}
}

// Folds a batch of commands into one decision, in arrival order.
//
// The fold is synchronous and total: every command produces an outcome, and the desired state after it is
// the input of the next one. Concurrency is therefore only a question of arrival order, which the queue
// stamps, and never of which handler ran first.
export function reduceSequencerIntents(state: SequencerSessionState, desiredState: SequencerDesiredState, intents: readonly SequencerIntent[]): SequencerIntentReduction {
	const outcomes: SequencerIntentOutcome[] = []
	let desired = desiredState
	let failure: SequencerFailure | undefined

	for (const intent of intents) {
		const outcome = reduceIntent(state, desired, intent)

		outcomes.push(outcome)

		if (outcome.effect === 'fail' && failure === undefined) failure = { reason: intent.reason ?? 'unexpectedState', detail: intent.detail }

		desired = desiredStateAfter(outcome.effect, desired)
	}

	return { desiredState: desired, outcomes, failure }
}

// Control queue of one session.
//
// It is a queue and not a mailbox of one: several commands can be submitted before the runtime reaches the
// point where it drains them — an operator pausing and then stopping while an exposure runs is the ordinary
// case — and dropping any of them would lose a decision the session has to account for.
export class SequencerIntentQueue {
	readonly #pending: SequencerIntent[] = []
	#sequence = 0

	// Commands waiting to be reduced.
	get size() {
		return this.#pending.length
	}

	// Commands waiting to be reduced, in arrival order, without draining them.
	get pending(): readonly SequencerIntent[] {
		return this.#pending
	}

	// Accepts one command, always, and returns it stamped with its arrival position.
	//
	// `at` is the instant the command was issued, which is the wall clock of the caller rather than a reading
	// this queue takes: a command queued during a safe point belongs to the instant that safe point observed.
	submit(kind: SequencerIntentKind, at: number, options?: { readonly reason?: OperationFailureReason; readonly detail?: string }): SequencerIntent {
		const intent: SequencerIntent = { kind, sequence: ++this.#sequence, at, reason: options?.reason, detail: options?.detail }

		this.#pending.push(intent)

		return intent
	}

	// Empties the queue and reduces everything it held against the current state.
	//
	// Draining before reducing is deliberate: reducing one command can start work that submits another, and a
	// queue emptied afterwards would swallow it.
	drain(state: SequencerSessionState, desiredState: SequencerDesiredState): SequencerIntentReduction {
		const intents = this.#pending.splice(0)
		return reduceSequencerIntents(state, desiredState, intents)
	}
}
