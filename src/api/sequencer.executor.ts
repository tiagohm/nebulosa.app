import type { PierSide } from 'nebulosa/src/devices/indi/device'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { SequencerFailureReason, SequencerFilterReference, SequencerGuiderSettle, SequencerRetryPolicy } from '#/sequencer'
import type { SequencerPlan, SequencerPlanAction, SequencerPlanFrameGroup, SequencerPlanLoop, SequencerPlanPipeline, SequencerPlanSequence } from '#/sequencer.plan'
import type { SequencerCaptureProgress, SequencerCheckpoint, SequencerDesiredState, SequencerEventDraft, SequencerFailure, SequencerTriggerAnchors } from '#/sequencer.state'
import { abortableDelay } from './operation.wait'
import { sequencerCadenceBoundary, sequencerExposureEnded, SEQUENCER_INITIAL_CADENCE_ANCHORS, waitForCadenceBoundary } from './sequencer.cadence'
import type { SequencerCadenceAnchors } from './sequencer.cadence'
import { SequencerCheckpointKeeper } from './sequencer.checkpoint'
import type { SequencerCheckpointTrigger } from './sequencer.checkpoint'
import { SEQUENCER_BLOCK_TYPE, sequencerNodeId, sequencerPlanNodes } from './sequencer.compiler'
import type { SequencerCapture, SequencerDitherTrigger, SequencerFocus, SequencerLifecycle, SequencerMeridianFlipTrigger } from './sequencer.compiler'
import { sequencerConvergence, sequencerEndReached } from './sequencer.control'
import type { SequencerSafePoint } from './sequencer.control'
import { sequencerPreExposureGuard, waitForFlipWindow } from './sequencer.guard'
import type { SequencerFlipBoundary } from './sequencer.guard'
import type { SequencerGuidingServices } from './sequencer.guiding'
import { sequencerFrameDirectories, sequencerFrameFileName, sequencerLogicalSlotId } from './sequencer.identity'
import { runGuidingInterlock } from './sequencer.interlock'
import type { SequencerInterlockReport, SequencerInterlockState } from './sequencer.interlock'
import { sequencerAuxiliaryDirectory, sequencerVerifiedArtifactPath } from './sequencer.path'
import type { SequencerPathContext } from './sequencer.path'
import { runSequencerPipeline, SEQUENCER_MAXIMUM_TIMER_DELAY } from './sequencer.pipeline'
import type { SequencerPipelineReport, SequencerPipelineStep } from './sequencer.pipeline'
import { sequencerFailurePolicy } from './sequencer.policy'
import type { SequencerOnFailure } from './sequencer.policy'
import { runFramePreparation, sequencerFramePreparationPending } from './sequencer.prepare'
import type { SequencerPreparationOutcome, SequencerPreparationServices } from './sequencer.prepare'
import { abandonSlot, acceptFrame, advanceCaptureCycle, grantAttemptWindow, SEQUENCER_INITIAL_CAPTURE_PROGRESS } from './sequencer.progress'
import type { AnySequencerActionHandler, SequencerActionContext, SequencerActionResult, SequencerFrameSlot } from './sequencer.registry'
import { frameScheduler, targetProgressOf } from './sequencer.scheduler'
import type { FrameSelection } from './sequencer.scheduler'
import { sequencerDegradedCause, sequencerGroupOutcome, sequencerSlotFailure } from './sequencer.slot'
import type { SequencerSlotCause } from './sequencer.slot'
import { sequencerFinalizeRuns, sequencerStartupOutcome, sequencerTerminalOutcome } from './sequencer.terminal'
import type { SequencerPrimaryOutcome, SequencerTerminalOutcome } from './sequencer.terminal'
import { evaluateSequencerTriggers, sequencerAnchorAdvanced, sequencerFilterBaselined, sequencerFrameCounted, sequencerInitialTriggerAnchors, sequencerTriggerPending } from './sequencer.trigger'
import type { SequencerTriggerDecision, SequencerTriggerObservation, SequencerTriggerPolicies } from './sequencer.trigger'
import type { SequencerWriteEnvironment } from './sequencer.write'

// Execution of a compiled plan: the walk that turns the node tree into a night.
//
// Every decision this module makes is taken somewhere else. The scheduler picks the frame, the trigger
// evaluator picks what runs in front of it, the guard and the cadence decide when the exposure may start, the
// failure and slot policies decide what a failure costs, and the terminal composition decides how the session
// ends. What is here is the order they are asked in and the state that flows between them, which is exactly
// the part that cannot be a pure function: it commands devices and it writes files.
//
// The safe point of one frame runs in the fixed order of §8.5: the triggers are evaluated once against a
// single reading of the observatory, the moving ones run inside the guiding interlock together with the frame
// preparation, the dither is emitted with the resume of that interlock, the pre-exposure guard decides whether
// the exposure fits ahead of the meridian, the cadence boundary is waited for, and only then is the frame
// exposed. Nothing between the guard and the exposure moves the mount, which is what makes the projection the
// guard accepted still true when the shutter opens.
//
// The finalize pipeline runs under its own signal. A stop aborts everything the plan is doing, and the whole
// point of the terminal pipeline is to run after that and leave the observatory safe, so it must not be
// cancelled by the same signal that ended the plan.
//
// Instants are milliseconds since the Unix epoch, exposure times and declared delays are seconds, and hour
// angles are radians.

// Single reading of the observatory taken at one safe point, which every decision of that safe point is made
// against.
//
// It is produced by the host rather than read here, because the roles a session carries and the devices they
// resolve to are the runtime's, and because taking it twice would let the trigger evaluator and the frame
// selection disagree about the same instant.
export interface SequencerSafePointObservation {
	// Hour angle of the target the mount reports, in radians, absent when the session commands no mount or the
	// mount publishes none. No flip is decided and no exposure is guarded without it.
	readonly hourAngle?: Angle
	// Pier side the mount reports, absent when it publishes none.
	readonly pierSide?: PierSide
	// Pier side the mount was on before the flip, which is the side that means the flip is still pending.
	readonly preFlipPierSide?: PierSide
	// Temperature the focus drift is measured against, in degrees Celsius, absent when no device reports one.
	readonly temperature?: number
	// Sensor temperature, in degrees Celsius, absent when the camera reports none.
	readonly sensorTemperature?: number
	// Filter currently installed, absent when the session commands no wheel.
	readonly installedFilter?: string
	// Name the requested filter reference resolves to on the installed wheel, absent when the frame names no
	// filter or the wheel does not carry it.
	readonly filter?: string
}

// Everything the executor needs from the session running it.
//
// The host keeps ownership of the session: it builds execution contexts, reads devices, resolves handlers,
// persists checkpoints and holds the artifact registry. The executor owns only the walk.
export interface SequencerExecutorHost {
	// Session the plan is executed for.
	readonly sessionId: string
	// Compiled plan being walked.
	readonly plan: SequencerPlan
	// Namespace every artifact of the session is written below.
	readonly storage: SequencerPathContext
	// Cancellation signal of the action that is running, aborted by a shutdown, by an immediate stop and by an
	// immediate pause. A graceful stop deliberately does not abort it: the frame that is on the sensor is let
	// finish and becomes durable instead of being thrown away (§11.3).
	readonly signal: AbortSignal
	// Cancellation signal of the waits the walk takes between actions, aborted by every stop, graceful included.
	// The spacing between two frames and the wait for a flip window hold nothing a stop should preserve, and a
	// stop that had to sit through them until the sky moved would not be a stop.
	readonly waitSignal: AbortSignal
	// Cancellation signal of the terminal pipeline, aborted only by a shutdown so a stop still leaves the
	// observatory safe.
	readonly terminalSignal: AbortSignal
	// Wall-clock source in milliseconds since the Unix epoch.
	readonly now: () => number
	// Services the frame preparation commands the optical path through.
	readonly preparation: SequencerPreparationServices
	// Services the guiding interlock and the dither command the guider through.
	readonly guiding: SequencerGuidingServices
	// Resolves a block type into its registered handler, or undefined when none is registered.
	readonly handler: (type: string) => AnySequencerActionHandler | undefined
	// Builds the execution context of one node. `frame` is passed exactly for the capture node the scheduler
	// selected a slot for.
	readonly context: (nodeId: string, attempt: number, signal: AbortSignal, frame?: SequencerFrameSlot) => SequencerActionContext
	// Reads the observatory once, resolving the requested filter reference against the installed wheel.
	readonly observe: (filter?: SequencerFilterReference) => SequencerSafePointObservation
	// State the operator commanded the session to converge to.
	readonly desiredState: () => SequencerDesiredState
	// Next physical attempt of a logical slot, derived from the artifact registry.
	readonly slotAttempt: (logicalSlotId: string) => number
	// Holds the walk at the safe point `nodeId` was reached on, publishing the session as `paused` for as long
	// as the hold lasts, and resolves with the state the operator converged it to: `running` when it was
	// resumed, `stopped` when it was stopped or the process is ending. Nothing is released while it holds —
	// the reservation of a paused session is what makes the resume possible (§11.3).
	readonly hold: (nodeId: string) => Promise<SequencerDesiredState>
	// Publishes the session as `finalizing`, called once and only when the terminal pipeline is about to run.
	// Parking a mount and warming a camera take minutes, and a session that spent them published as `running`
	// tells a reader the plan is still capturing and lets the control reduction accept a pause or a resume that
	// nothing can act on any more — the terminal pipeline is never interrupted (§8.6).
	readonly finalizing: () => void
	// Announces that the walk is entering the target block, called once and only when it actually enters it.
	//
	// It is the boundary between the phases that run outside the action signal — the guider being opened, the
	// startup pipeline, both attended on the wait signal — and the one whose nodes run under it. An immediate
	// pause is expressed as the cancellation of what is running (§11.3), and only the target block has something
	// that answer means anything for: cancelling the guider connection or a startup action produces an `aborted`
	// nothing attributes to the operator, which fails the session instead of holding it for the resume.
	readonly capturing: () => void
	// Persists the checkpoint together with the events produced since the last write, answering whether the
	// store accepted the write. It is best-effort: a refused write leaves the checkpoint dirty and the next one
	// carries it, together with the events it could not place, which is what the answer is read for.
	readonly commit: (checkpoint: SequencerCheckpoint, events: readonly SequencerEventDraft[]) => boolean
	// Waits `delay` milliseconds, resolving early when the signal aborts.
	readonly delay: (delay: number, signal: AbortSignal) => Promise<void>
	// Opens the collaborators the walk cannot open for itself, which is the guiding session the plan declares,
	// and answers with the failure that ends the session or undefined when there was nothing to open or it
	// opened. A host with nothing to open omits it.
	readonly open?: () => Promise<SequencerFailure | undefined>
}

// What one execution of a plan produced.
export interface SequencerExecutionOutcome {
	// Terminal state of the session, composed from the plan outcome and the terminal pipeline.
	readonly terminal: SequencerTerminalOutcome
	// Checkpoint as the walk left it, which is what the runtime commits with the terminal state.
	readonly checkpoint: SequencerCheckpoint
	// Capture progress as the walk left it.
	readonly capture: SequencerCaptureProgress
}

// What one node of the plan did, in the vocabulary the walk continues on.
//
// It is deliberately not a `SequencerActionResult`: an action says what happened to the device, this says what
// happens to the rest of the plan.
// `retake` is the answer of a frame that has to be selected and safe-pointed again from scratch, which only
// the capture loop can do; it never leaves that loop.
type SequencerNodeOutcome = { readonly kind: 'continue' } | { readonly kind: 'pause' } | { readonly kind: 'retake' } | { readonly kind: 'stop' } | { readonly kind: 'fail'; readonly reason: SequencerFailureReason; readonly detail?: string }

// Outcome of a node the plan simply carries on from.
const SEQUENCER_CONTINUE: SequencerNodeOutcome = { kind: 'continue' }

// Outcome of a frame whose slot is still on the cursor and whose safe point has to be taken again.
const SEQUENCER_RETAKE: SequencerNodeOutcome = { kind: 'retake' }

// What the pre-exposure guard leaves the safe point doing.
//
// It is not a `SequencerNodeOutcome` because the guard has an answer no node has: neither exposing nor ending
// the plan, but taking the same safe point again.
type SequencerGuardOutcome =
	// The exposure fits ahead of the flip boundary and starts now.
	| { readonly kind: 'expose' }
	// The flip window the guard waited for is open, so the safe point is taken again from the top and the
	// trigger evaluator turns the open window into an actual flip. Nothing consumed an attempt and nothing
	// advanced the cursor, so it is the same slot that is exposed on the other side of the flip.
	| { readonly kind: 'reenter' }
	// The guard ended the plan, carrying what it ended as.
	| { readonly kind: 'ended'; readonly outcome: SequencerNodeOutcome }

// Guard outcome of an exposure that may start now.
const SEQUENCER_EXPOSE: SequencerGuardOutcome = { kind: 'expose' }

// Times one safe point may be taken again for a flip window that opened, before the reordering is reported as
// a defect instead of attempted once more.
//
// The reordering converges in one pass by construction: the window opens, the trigger evaluator of the new
// pass fires the flip, the mount leaves the pre-flip side and the guard admits the exposure. A second pass
// already means the flip was evaluated and did not run, and an unbounded number of them is a session busy
// looping over a safe point that takes no frame, which is worse than ending with the reason for it.
const SEQUENCER_FLIP_REENTRY_LIMIT = 3

// Settle carried by the interlock request of a session that guides through nothing. The bracket is skipped
// entirely for such a session, so no wait is ever taken against it; it exists because the request is still the
// carrier of the dither, and a zero settle is the honest value for a guider that is not there.
const SEQUENCER_UNGUIDED_SETTLE: SequencerGuiderSettle = { tolerance: 0, time: 0, timeout: 0 }

// Mutable state of one walk, threaded through every step instead of living in module scope so two sessions
// never share it.
interface SequencerExecution {
	// Session running the walk.
	readonly host: SequencerExecutorHost
	// Durable checkpoint being maintained.
	readonly keeper: SequencerCheckpointKeeper
	// Events produced since the last durable write.
	events: SequencerEventDraft[]
	// Capture progress of every target.
	capture: SequencerCaptureProgress
	// Trigger anchors of the session.
	anchors: SequencerTriggerAnchors
	// Cadence anchors of the session.
	cadence: SequencerCadenceAnchors
	// Exposure time the accepted frames of the whole session have accumulated, in seconds. The per-group
	// counters cannot answer for it: they are per cycle and reset with it, while the end condition it feeds is
	// stated over the session.
	integration: number
	// Cause of the last slot the capture loop lost, carried so a group that ends degraded is reported with the
	// failure that emptied it instead of with the counter that noticed the emptiness.
	cause?: SequencerSlotCause
}

// Executes a compiled plan and returns what it ended as.
//
// The startup pipeline decides on its own whether the plan runs at all: a required action of it that failed is
// already the primary outcome of the session, and the target block is never entered. The finalize pipeline then
// runs for the outcomes the definition asked it to run on, under the terminal signal.
//
// Startup runs under the wait signal rather than the action one, so a pause never tears it down. A lifecycle
// pipeline has no paused state (§11.3): a pause is honored at the safe points of the target block, and the
// immediate mode cancelling the running action would end the startup as a commanded stop — every remaining step
// `notRun`, the session terminal and non-resumable — for an operator who only asked it to wait. A stop still
// cancels it, gracefully included, because there is no frame in a lifecycle step worth preserving.
export async function runSequencerPlan(host: SequencerExecutorHost): Promise<SequencerExecutionOutcome> {
	const { plan } = host
	const scheduled = await waitForScheduledStart(host)
	const at = host.now()
	const execution: SequencerExecution = {
		host,
		keeper: new SequencerCheckpointKeeper(initialCheckpoint(plan), at),
		events: [],
		capture: SEQUENCER_INITIAL_CAPTURE_PROGRESS,
		anchors: sequencerInitialTriggerAnchors(at),
		cadence: SEQUENCER_INITIAL_CADENCE_ANCHORS,
		integration: 0,
	}

	execution.keeper.anchors(execution.anchors)

	// A session whose scheduled start was cancelled never enters the plan, and it is stopped rather than failed:
	// the only thing that cancels the wait is the operator or the process ending. The finalize pipeline still
	// runs when the definition asks it to run on a stop, which is what leaves an observatory that was opened for
	// the session closed again.
	let primary: SequencerPrimaryOutcome | undefined = scheduled ? undefined : { kind: 'stopped' }

	// The guider is the one collaborator the walk cannot open for itself, and a session that declared one and
	// could not reach it is not a session that captures unguided: it fails here, before any action. It is opened
	// inside the walk rather than in front of it so the failure is an ordinary primary outcome, which is what
	// leaves the finalize pipeline running for a definition that asked it to run on a failure — an observatory
	// opened for a session whose guider was unreachable is closed again instead of left open until morning. It
	// runs after the scheduled wait for the same reason the startup pipeline does: a session waiting for midnight
	// would otherwise hold a guider connection through the whole evening.
	if (primary === undefined) {
		const refusal = await host.open?.()

		if (refusal !== undefined) primary = { kind: 'failed', reason: refusal.reason, detail: refusal.detail }
	}

	const startup = pipelineOf(plan.root, 'startup')

	if (primary === undefined && startup !== undefined && plan.startup !== undefined) {
		// The scheduled wait ends on the clock and never on the state of the session, and a pause does not abort it,
		// so an operator may well have paused during it. The pipeline asks its `converge` between two steps and
		// never in front of the first one, which the walk already decided to enter it for — the boundary in front of
		// the first startup action therefore has to be taken here. Without it a session told to hold still unparks
		// the mount, opens the cover or starts the cooler, and only notices the pause once that action is over. It
		// is the same `afterAction` boundary the pipeline uses between two steps, so a pause holds and stays
		// resumable while a stop ends the session before it commanded anything. The target block takes the same
		// boundary in front of every node of its own, this one included.
		const converged = await convergeAt(execution, 'afterAction', startup.id)

		if (converged.outcome.kind !== 'continue') primary = outcomeOf(converged.outcome)
		else primary = sequencerStartupOutcome(await runPipelineBlock(execution, plan.startup, startup, host.waitSignal, true))
	}

	// The phase is announced before the block is entered and not after it ended, because what reads it is the
	// operator command that arrives while it runs: from here on there is an action of the plan under the action
	// signal, which is what an immediate pause is allowed to cancel.
	if (primary === undefined) {
		host.capturing()
		primary = outcomeOf(await runTargetBlock(execution))
	}

	let finalized: SequencerPipelineReport | undefined
	const finalize = pipelineOf(plan.root, 'finalize')

	if (finalize !== undefined && plan.finalize !== undefined && sequencerFinalizeRuns(plan.finalize, primary)) {
		// The plan is over and what runs from here is the quiescing, which is published before it starts rather
		// than after it finished: it is the phase the session actually spends the next minutes in.
		host.finalizing()

		finalized = await runPipelineBlock(execution, plan.finalize, finalize, host.terminalSignal, false)
	}

	execution.keeper.leave()
	execution.keeper.capture(execution.capture)
	execution.keeper.anchors(execution.anchors)

	// Whatever was produced since the last checkpoint write is committed here rather than left behind. The walk
	// ends on the events that explain how it ended — the policy that gave up on the last slot, the trigger that
	// fired at the last safe point — and the commit the runtime makes around the terminal state carries its own
	// list and never this one, so dropping them loses exactly the part of the night an operator reads first.
	execution.host.commit(execution.keeper.checkpoint, execution.events)
	execution.events = []

	return { terminal: sequencerTerminalOutcome(primary, finalized), checkpoint: execution.keeper.checkpoint, capture: execution.capture }
}

// Holds the walk until the instant the definition scheduled the session to start, and reports whether it was
// reached.
//
// The wait is taken in front of everything the session does, the startup pipeline included. Cooling a sensor
// and unparking a mount hours before the first exposure spends the night on state that has to be re-established
// anyway, and the anchors of the walk are taken after this returns so a session scheduled for midnight does not
// begin with its elapsed-time triggers measured from the afternoon it was submitted.
//
// The remaining time is recomputed after every chunk rather than handed to a single timer: a timer accepts
// about 24.8 days and anything beyond it overflows into a millisecond, which would start a session scheduled
// for next month immediately. Recomputing also absorbs a timer that fires early and a clock that moved.
//
// A `false` answer means the wait was cancelled, which only a stop or a shutdown does. It is taken on the wait
// signal and not the action one because no action is running here for a pause to cancel: a session pausing
// before its scheduled start is already doing exactly what a pause asks of it, and it is honored at the first
// safe point of the walk.
async function waitForScheduledStart(host: SequencerExecutorHost): Promise<boolean> {
	const { start } = host.plan.execution

	if (start.type !== 'at') return true

	let announced = false

	for (;;) {
		const remaining = start.time - host.now()

		if (remaining <= 0) return true

		if (!announced) {
			announced = true
			host.context(host.plan.root.id, 1, host.waitSignal).progress({ detail: 'waiting for the scheduled start of the session' })
		}

		const waited = await abortableDelay(Math.min(remaining, SEQUENCER_MAXIMUM_TIMER_DELAY), host.waitSignal)

		if (!waited.ok) return false
	}
}

// Checkpoint a session starts from, which records the revisions the plan was compiled and resolved against so
// a later resume can refuse a plan that no longer means the same thing.
function initialCheckpoint(plan: SequencerPlan): SequencerCheckpoint {
	return {
		containers: [],
		attempts: {},
		completed: [],
		capture: SEQUENCER_INITIAL_CAPTURE_PROGRESS,
		anchors: sequencerInitialTriggerAnchors(0),
		definitionRevision: plan.definitionRevision,
		handlerVersions: plan.handlers ?? {},
	}
}

// Finds the startup or finalize block of the plan root, absent when the definition declares none.
function pipelineOf(root: SequencerPlanSequence, pipeline: 'startup' | 'finalize'): SequencerPlanSequence | undefined {
	const id = sequencerNodeId.pipeline(pipeline)

	for (const node of root.children) {
		if (node.kind === 'sequence' && node.id === id) return node
	}

	return undefined
}

// Target block of the plan, which every compiled plan has exactly one of.
function targetOf(root: SequencerPlanSequence, targetId: string): SequencerPlanSequence | undefined {
	const id = sequencerNodeId.target(targetId)

	for (const node of root.children) {
		if (node.kind === 'sequence' && node.id === id) return node
	}

	return undefined
}

// Action nodes of a sequence, in order.
function actionsOf(sequence: SequencerPlanSequence): readonly SequencerPlanAction[] {
	return sequence.children.filter((node): node is SequencerPlanAction => node.kind === 'action')
}

// Loop node of a sequence, absent when it has none.
function loopOf(sequence: SequencerPlanSequence): SequencerPlanLoop | undefined {
	for (const node of sequence.children) {
		if (node.kind === 'loop') return node
	}

	return undefined
}

// Runs one lifecycle pipeline through the pipeline executor, which owns the timeout, the retries and the
// commanded-stop attribution; the only thing supplied here is how a step runs, how a wait is taken and, when
// `attended`, what the boundary between two actions does about the state the session is converging to.
//
// The startup pipeline is attended and the finalize pipeline is not. Attending the finalize pipeline would
// refuse every one of its actions, since it runs precisely because the session is converging to a terminal
// state, and the night would end with the mount unparked and the cover open.
async function runPipelineBlock(execution: SequencerExecution, pipeline: SequencerPlanPipeline, block: SequencerPlanSequence, signal: AbortSignal, attended: boolean): Promise<SequencerPipelineReport> {
	const { host } = execution
	const steps = actionsOf(block).map<SequencerPipelineStep>((node) => ({ nodeId: node.id, type: node.type, configuration: node.configuration as SequencerLifecycle }))

	return await runSequencerPipeline(
		pipeline,
		steps,
		{
			run: async (step, attempt, stepSignal) => {
				execution.keeper.enter(step.nodeId, [block.id])
				execution.keeper.attempt(step.nodeId, attempt)

				const result = await runNode(execution, step.nodeId, step.type, step.configuration, attempt, stepSignal)

				// Only a step that ran is recorded as done. A failed attempt stays open so the retry the pipeline
				// decides re-enters the same node, and a step given up on is never resumed past on a restart.
				if (result.type === 'completed' || result.type === 'skipped') {
					execution.keeper.complete(step.nodeId)
					await checkpointDue(execution, 'action')
				}

				return result
			},
			delay: (delay, delaySignal) => host.delay(delay, delaySignal),
			// The boundary between two lifecycle actions is `afterAction`: the step that was running reached its own
			// terminal decision, so every pause mode is attended here and a pause holds instead of ending the
			// pipeline, which is what keeps a session paused during startup resumable (§11.3).
			...(attended ? { converge: async (step: SequencerPipelineStep) => (await convergeAt(execution, 'afterAction', step.nodeId)).outcome.kind === 'continue' } : {}),
		},
		signal,
	)
}

// Executes one node through its registered handler, turning an unregistered type and a thrown error into the
// decisions the walk knows how to apply.
async function runNode(execution: SequencerExecution, nodeId: string, type: string, configuration: unknown, attempt: number, signal: AbortSignal, frame?: SequencerFrameSlot): Promise<SequencerActionResult<unknown>> {
	const handler = execution.host.handler(type)

	if (handler === undefined) return { type: 'fatalFailure', reason: 'unexpectedState', detail: `no handler is registered for the block type ${type}` }

	const context = execution.host.context(nodeId, attempt, signal, frame)

	try {
		return await handler.execute(context, configuration)
	} catch (e) {
		return { type: 'fatalFailure', reason: 'commandFailed', detail: e instanceof Error ? e.message : String(e) }
	}
}

// Retry policy of a block, which is the one it declares and the execution default for the blocks that declare
// none.
function retryOf(configuration: unknown, fallback: SequencerRetryPolicy): SequencerRetryPolicy {
	return (configuration as { readonly retry?: SequencerRetryPolicy }).retry ?? fallback
}

// Terminal decision a block declares, absent for the blocks that only carry a retry policy. Of the nodes the
// target block walks it is the three safe-point triggers that declare one — the flip, the autofocus and the
// dither — and their answer is the more expressive of the two (§10), so it is what decides once the attempts
// are spent rather than the `onExhausted` of the retry policy.
function onFailureOf(configuration: unknown): SequencerOnFailure | undefined {
	return (configuration as { readonly onFailure?: SequencerOnFailure }).onFailure
}

// Runs one action node under its own retry policy, answering what the rest of the plan does.
//
// `completed` separates a node that ran from one that was skipped or given up on, which is what the meridian
// flip is asked for: a flip that was evaluated and skipped invalidates no calibration.
async function runActionNode(execution: SequencerExecution, node: SequencerPlanAction, signal: AbortSignal): Promise<{ readonly outcome: SequencerNodeOutcome; readonly completed: boolean }> {
	const retry = retryOf(node.configuration, execution.host.plan.execution.defaultRetry)
	let attempt = 1

	for (;;) {
		execution.keeper.enter(node.id, [])
		execution.keeper.attempt(node.id, attempt)

		const result = await runNode(execution, node.id, node.type, node.configuration, attempt, signal)

		if (result.type === 'completed' || result.type === 'skipped') {
			execution.keeper.complete(node.id)
			await checkpointDue(execution, 'action')
			return { outcome: SEQUENCER_CONTINUE, completed: result.type === 'completed' }
		}

		if (result.type === 'pause') return { outcome: { kind: 'pause' }, completed: false }
		if (result.type === 'suspend') return { outcome: { kind: 'fail', reason: 'unexpectedState', detail: result.detail }, completed: false }

		// A fatal failure is decided by the terminal half of the same policy and never retried, which the budget
		// of one attempt expresses without a second decision path.
		const decision = sequencerFailurePolicy({
			reason: result.reason,
			detail: result.detail,
			attempt,
			retry: result.type === 'fatalFailure' ? { ...retry, maxAttempts: 1 } : retry,
			onFailure: onFailureOf(node.configuration),
			commandedBy: commandedBy(execution),
		})

		if (decision.kind === 'retry') {
			await execution.host.delay(decision.delay, signal)
			attempt = decision.attempt
			continue
		}

		execution.events.push({ type: 'policyApplied', nodeId: node.id, detail: decision.kind })

		return { outcome: decisionOutcome(decision, result.reason, result.detail), completed: false }
	}
}

// Signal the waits taken in front of an exposure run under, which is every stop plus the cancellation an
// immediate pause issues.
//
// The wait signal alone answers every stop and no pause, because a pause cancels the action that is running
// (§11.3) and between two frames nothing is running. A session paused while it spaces frames, or while it
// stands in front of a closed flip window, would therefore keep waiting until the spacing elapsed or the sky
// moved before noticing the command — minutes in one case and up to an hour in the other, for an operator who
// asked for the pause that takes effect at once. Joining the two ends the wait immediately, and what the
// cancellation means is decided afterwards by the state the session is converging to.
function waitsOf(host: SequencerExecutorHost): AbortSignal {
	return AbortSignal.any([host.signal, host.waitSignal])
}

// State a control command converged to, when one explains a cancellation. `running` explains nothing and is
// reported as absent, which is what makes an unexplained abort a failure instead of an intentional stop.
function commandedBy(execution: SequencerExecution) {
	const desired = execution.host.desiredState()
	return desired === 'running' ? undefined : desired
}

// Translates a terminal policy decision into what the rest of the plan does.
function decisionOutcome(decision: ReturnType<typeof sequencerFailurePolicy>, reason: SequencerFailureReason, detail?: string): SequencerNodeOutcome {
	switch (decision.kind) {
		case 'skip':
		case 'continue':
			return SEQUENCER_CONTINUE
		case 'pause':
			return { kind: 'pause' }
		case 'stop':
			return { kind: 'stop' }
		case 'fail':
			return { kind: 'fail', reason: decision.reason, detail: decision.detail }
		default:
			return { kind: 'fail', reason, detail }
	}
}

// Holds the walk until the operator resumes or stops the session, and reports what the walk does next.
//
// A pause is not an ending: the session keeps its reservation, its cursor and its progress, and the whole
// point of holding here rather than returning is that the walk still exists to be resumed. `continue` means it
// was resumed and the caller carries on from where it held; `stop` means the operator stopped it instead, or
// the process is ending, and the terminal pipeline runs.
async function holdWalk(execution: SequencerExecution, nodeId: string): Promise<SequencerNodeOutcome> {
	const converged = await execution.host.hold(nodeId)

	if (converged === 'stopped') return { kind: 'stop' }

	return SEQUENCER_CONTINUE
}

// Attends the state the session is converging to, at one boundary of the walk (§11.3).
//
// The safe point is where this call sits, and the configured pause mode decides whether a pending pause is
// attended here or at a later boundary: that is the whole difference between the modes on this side, since what
// separates `immediate` from the other two is the cancellation the runtime issues and not a boundary of its own.
// A stop is attended at every boundary, under either stop mode.
//
// The boundary is re-evaluated after a hold rather than assumed to be clear, because the operator who resumed
// may have paused again while the walk was waking up. A `continue` outcome therefore means the session really is
// running at this point, and the caller may start what comes next.
//
// `held` reports whether the walk actually waited, which the callers that decided something before the boundary
// need: an arbitrary amount of time passes inside a hold, and a decision taken on the observatory reading of
// before it is no longer a decision about now.
async function convergeAt(execution: SequencerExecution, safePoint: SequencerSafePoint, nodeId: string): Promise<{ readonly outcome: SequencerNodeOutcome; readonly held: boolean }> {
	let held = false

	for (;;) {
		const convergence = sequencerConvergence(execution.host.desiredState(), execution.host.plan.execution, safePoint)

		if (convergence === 'continue') return { outcome: SEQUENCER_CONTINUE, held }
		if (convergence === 'stop') return { outcome: { kind: 'stop' }, held }

		const resumed = await holdWalk(execution, nodeId)

		held = true

		if (resumed.kind !== 'continue') return { outcome: resumed, held }
	}
}

// Primary outcome of the session, from what the target block ended as.
//
// Neither a pause nor a retake reaches here: every site that can produce one is handled where the walk can act
// on it, so the only way the walk unwinds to a terminal outcome is a stop, a failure, or the plan running out
// of work. The branches are kept because the outcome union still carries the kinds, and a walk that somehow
// unwound holding a frame it never took is a stopped session — never a completed one.
function outcomeOf(outcome: SequencerNodeOutcome): SequencerPrimaryOutcome {
	switch (outcome.kind) {
		case 'continue':
			return { kind: 'completed' }
		case 'pause':
		case 'retake':
		case 'stop':
			return { kind: 'stopped' }
		default:
			return { kind: 'failed', reason: outcome.reason, detail: outcome.detail }
	}
}

// Writes the checkpoint when the policy says this unit of work should carry one.
async function checkpointDue(execution: SequencerExecution, trigger: SequencerCheckpointTrigger) {
	const at = execution.host.now()

	if (!execution.keeper.due(execution.host.plan.execution.checkpoint, trigger, at)) return

	execution.keeper.capture(execution.capture)
	execution.keeper.anchors(execution.anchors)

	// A refused write leaves the checkpoint dirty and the events staged, so the next unit carries both. Marking
	// it written here would tell the keeper the store holds a value it never took, and the difference would only
	// be noticed by a resume reading a checkpoint from before the frames it is resuming after.
	if (execution.host.commit(execution.keeper.checkpoint, execution.events)) {
		execution.keeper.written(at)
		execution.events = []
	}

	await Promise.resolve()
}

// Runs the target block: the slew, the centering, and the capture loop, in the order the lowering emitted.
async function runTargetBlock(execution: SequencerExecution): Promise<SequencerNodeOutcome> {
	const { plan } = execution.host
	const block = targetOf(plan.root, plan.target.id)

	if (block === undefined) return { kind: 'fail', reason: 'unexpectedState', detail: 'the plan carries no target block' }

	const nodes = actionsOf(block)
	let index = 0

	while (index < nodes.length) {
		const node = nodes[index]

		// The previous node reached its terminal decision and this one has not started, which is the boundary a
		// pause is attended at while the target is still being pointed at. Waiting for the capture loop instead
		// would slew and center a target the operator asked the session to stop short of. It is taken before the
		// node rather than after it so a plan that has run out of nodes ends as what it did, not as a stop that
		// interrupted nothing.
		const converged = await convergeAt(execution, 'afterAction', node.id)

		if (converged.outcome.kind !== 'continue') return converged.outcome

		const { outcome } = await runActionNode(execution, node, execution.host.signal)

		if (outcome.kind === 'pause') {
			const held = await holdWalk(execution, node.id)

			if (held.kind !== 'continue') return held

			// The node that asked for the hold is the one that runs again. It never reached a terminal decision,
			// and running what comes after it would point at a target the slew never finished reaching.
			continue
		}

		if (outcome.kind !== 'continue') return outcome

		index++
	}

	const loop = loopOf(block)

	if (loop === undefined) return SEQUENCER_CONTINUE

	return await runCaptureLoop(execution, plan.target.id, loop)
}

// Runs the capture loop for the declared number of cycles.
//
// Advancing the cycle is this loop's job and not the scheduler's: the scheduler answers which frame is next
// inside the current cycle, and how many cycles there are is the only thing it does not know. Each advance
// reopens the body, because both the completion set and the attempt map of the checkpoint are keyed by node id
// and the same nodes run again in the next cycle.
async function runCaptureLoop(execution: SequencerExecution, targetId: string, loop: SequencerPlanLoop): Promise<SequencerNodeOutcome> {
	const scheduler = frameScheduler(loop)
	const body: string[] = []

	for (const node of sequencerPlanNodes(loop.body)) body.push(node.id)

	for (;;) {
		if (targetProgressOf(execution.capture, targetId).cycle >= loop.repeat) return SEQUENCER_CONTINUE

		for (;;) {
			// Nothing of the cursor moves while it holds, so the frame the scheduler picks after a resume is the
			// one it would have picked without the pause — but it is picked from a reading of the moment it
			// resumes, which is why the selection is taken after the boundary and never before it.
			const converged = await convergeAt(execution, 'beforeFrame', loop.id)

			if (converged.outcome.kind !== 'continue') return converged.outcome

			const instant = execution.host.now()

			// The night is bounded from outside the plan as well, and the boundary is honored here rather than at
			// the end of a cycle: a session told to stop at 05:00 or after four hours of integration must not spend
			// the rest of a cycle it can no longer use. It is a normal completion with whatever was captured, so
			// the loop leaves through the same door running out of work leaves through.
			if (sequencerEndReached(execution.host.plan.execution.end, instant, execution.integration)) return SEQUENCER_CONTINUE

			const reading = execution.host.observe()
			const selection = scheduler.next(execution.capture, { targetId, instant, sensorTemperature: reading.sensorTemperature, filter: reading.installedFilter })

			if (selection === undefined) break

			const outcome = await runSafePoint(execution, targetId, loop, selection, instant)

			// The slot is still on the cursor and the scheduler hands it back, so the frame is taken again from
			// a reading of the moment it resumes rather than from the one the safe point was decided on.
			if (outcome.kind === 'retake') continue

			if (outcome.kind === 'pause') {
				const held = await holdWalk(execution, selection.group.nodeId)

				if (held.kind !== 'continue') return held

				// The slot the safe point paused on was never filled, so the scheduler is asked again and hands
				// back the same one: the retake starts from the observatory reading of the moment it resumes,
				// which is the only reading the decisions after an arbitrarily long hold may be made on.
				continue
			}

			if (outcome.kind !== 'continue') return outcome
		}

		// The cycle is over and every cursor of it is final, which is the only moment a degraded group is
		// visible: the advance below reopens the cursors for the next cycle and the evidence would be gone.
		const degraded = degradedOutcome(execution, targetId, loop)

		if (degraded.kind !== 'continue') return degraded

		execution.capture = advanceCaptureCycle(execution.capture, targetId)
		execution.keeper.capture(execution.capture)
		execution.keeper.reenter(body)

		await checkpointDue(execution, 'transition')
	}
}

// What the cycle that just closed ended as, evaluated while its cursors still hold what it spent.
//
// A group that spent its slot limit without reaching its target completed degraded, and a degraded completion
// is a failure of the plan (§8.6), not a night that merely produced fewer frames: the session is what an
// operator reads in the morning to know whether the target is done, and reporting `completed` for a group that
// lost every slot to a camera that stopped answering is the one answer that costs a whole night. The cause
// reported is the one of the last slot lost, which is the camera error rather than the counter that noticed it
// — `unknown` only when nothing recorded why, which a resume after a restart can produce.
//
// The first degraded group decides. Reporting one cause is what the terminal outcome carries, and it is the
// most recent failure of the target either way.
function degradedOutcome(execution: SequencerExecution, targetId: string, loop: SequencerPlanLoop): SequencerNodeOutcome {
	for (const group of loop.groups) {
		if (sequencerGroupOutcome(group, execution.capture, targetId) !== 'degraded') continue

		const cause = sequencerDegradedCause(execution.cause)

		execution.events.push({ type: 'policyApplied', nodeId: group.nodeId, detail: `the frame group ${group.id} completed degraded` })

		return { kind: 'fail', reason: cause.reason, detail: cause.detail }
	}

	return SEQUENCER_CONTINUE
}

// Runs the safe point of one selected frame, up to and including the exposure that fills its slot.
//
// A guard that waited for the flip window takes the whole safe point again instead of exposing: the reading it
// was decided on is the one from before the wait, and what has to happen next is the flip the trigger
// evaluator will now see. The retake is bounded, because a window that opens without a flip ever running would
// otherwise be a loop taking no frames.
async function runSafePoint(execution: SequencerExecution, targetId: string, loop: SequencerPlanLoop, selection: FrameSelection, instant: number): Promise<SequencerNodeOutcome> {
	const { host } = execution
	const { group } = selection
	const node = frameNodeOf(loop, group)

	if (node === undefined) return { kind: 'fail', reason: 'unexpectedState', detail: `the plan carries no capture node for the frame group ${group.id}` }

	const configuration = node.configuration as SequencerCapture
	const policies = triggerPoliciesOf(loop)
	let at = instant
	let reentries = 0

	for (;;) {
		const reading = host.observe(group.filter)
		const observation: SequencerTriggerObservation = {
			instant: at,
			frameType: group.frameType,
			filter: reading.filter,
			installedFilter: reading.installedFilter,
			hourAngle: reading.hourAngle,
			pierSide: reading.pierSide,
			preFlipPierSide: reading.preFlipPierSide,
			temperature: reading.temperature,
		}

		// The filter baseline is taken before the triggers are evaluated, so the first frame of a session does not
		// read the wheel it found as a filter change nobody made.
		execution.anchors = sequencerFilterBaselined(execution.anchors, observation)

		const decisions = evaluateSequencerTriggers(policies, execution.anchors, observation)

		execution.anchors = sequencerTriggerPending(policies, execution.anchors, decisions)

		for (const decision of decisions) execution.events.push({ type: 'triggerFired', nodeId: node.id, detail: `${decision.kind}:${decision.reason}` })

		const bracketed = await runInterlockedSafePoint(execution, loop, node, configuration, decisions, policies, observation)

		if (bracketed.outcome.kind !== 'continue') return bracketed.outcome

		// A bracket that spent its budget and was told to skip did not reconcile the optical path: the filter the
		// group declares may not be in the beam, the cover may still be closed, the mount may not be tracking the
		// mode the frame wants, the rotator may be off its angle and the sensor away from its temperature. Exposing
		// on that state produces a plausible frame under a header describing a setup it was not taken with, and
		// `acceptFrame` would count it for a group it does not belong to. The slot is given up instead, which is
		// what makes the walk advance — leaving it on the cursor would select the same frame forever — and the
		// cause is kept so the group reports the preparation that failed rather than completing degraded on nothing.
		if (bracketed.skipped !== undefined) {
			execution.capture = abandonSlot(execution.capture, targetId, group)
			execution.cause = bracketed.skipped
			execution.keeper.capture(execution.capture)
			// Nothing was exposed and no artifact row was registered, so this write stays on the cadence the frame
			// policy declares instead of the one an artifact commit is due on.
			await checkpointDue(execution, 'frame')
			return SEQUENCER_CONTINUE
		}

		// The triggers of this safe point reached their terminal decision and the bracket closed behind them, which
		// is the boundary the broadest pause mode is attended at: the corrections are back on, the optical path is
		// where the next frame wants it and nothing is on the sensor. Honoring the pause only at the next frame
		// would sit through the whole exposure it was asked to come before.
		const converged = await convergeAt(execution, 'afterAction', node.id)

		if (converged.outcome.kind !== 'continue') return converged.outcome

		// A hold ends the validity of everything above it, so the safe point is taken again from a reading of the
		// moment the session resumed instead of exposing on the one it paused over. It costs no reentry of the
		// flip budget: the loop is being re-entered because the operator stopped the walk, not because a window
		// opened that no flip answered.
		if (converged.held) {
			at = host.now()
			continue
		}

		const guarded = await runExposureGuard(execution, policies, group)

		if (guarded.kind === 'ended') return guarded.outcome
		if (guarded.kind === 'expose') return await runExposure(execution, targetId, loop, node, configuration, selection)

		if (++reentries > SEQUENCER_FLIP_REENTRY_LIMIT) return { kind: 'fail', reason: 'unexpectedState', detail: 'the meridian flip window opened but no flip took the mount off the pre-flip side' }

		at = host.now()
	}
}

// Capture node of one frame group inside the loop body.
function frameNodeOf(loop: SequencerPlanLoop, group: SequencerPlanFrameGroup): SequencerPlanAction | undefined {
	for (const node of loop.body.children) {
		if (node.kind === 'action' && node.id === group.nodeId) return node
	}

	return undefined
}

// Declared trigger policies of the loop, read back from the nodes the lowering emitted for them.
//
// The plan carries a trigger as a node and not as a policy block, so a trigger the definition disabled has no
// node and is simply absent here, which is exactly the shape the evaluator expects.
function triggerPoliciesOf(loop: SequencerPlanLoop): SequencerTriggerPolicies {
	let meridianFlip: SequencerMeridianFlipTrigger | undefined
	let autofocus: SequencerFocus | undefined
	let dither: SequencerDitherTrigger | undefined

	for (const node of loop.body.children) {
		if (node.kind !== 'action') continue

		if (node.type === SEQUENCER_BLOCK_TYPE.meridianFlip) meridianFlip = node.configuration as SequencerMeridianFlipTrigger
		else if (node.type === SEQUENCER_BLOCK_TYPE.autofocus) autofocus = node.configuration as SequencerFocus
		else if (node.type === SEQUENCER_BLOCK_TYPE.dither) dither = node.configuration as SequencerDitherTrigger
	}

	return { meridianFlip, autofocus, dither }
}

// Trigger node of one kind inside the loop body.
function triggerNodeOf(loop: SequencerPlanLoop, kind: 'meridianFlip' | 'autofocus'): SequencerPlanAction | undefined {
	const type = kind === 'meridianFlip' ? SEQUENCER_BLOCK_TYPE.meridianFlip : SEQUENCER_BLOCK_TYPE.autofocus

	for (const node of loop.body.children) {
		if (node.kind === 'action' && node.type === type) return node
	}

	return undefined
}

// Runs the moving half of the safe point with the guiding corrections suspended: the triggers that displace
// the optical path, followed by the frame preparation that reconciles it.
//
// The dither travels as part of the interlock request rather than as a step after it, because it is emitted
// with the resume: displacing before the corrections are back on would move a guider that is not correcting,
// and the settle of the resume is the settle of the dither.
//
// The bracket is retried because everything it commands is a device that can time out once and answer the next
// time: a wheel that did not report the filter in place, a rotator that missed its angle, a guider that did not
// settle. Failing the bracket outright would end the night on the first of them. Which budget pays for the
// retry follows the step that failed — the guiding policy for the suspension and the resume, the dither policy
// for the dither, the execution default for everything else. What is not repeated on a retry is a trigger that
// already ran — a flip is not flipped twice and an autofocus sweep is not paid twice for the same frame — so
// only the preparation and the bracket itself are actually re-commanded, and the crossing a previous attempt
// reported still turns the resume into a recalibration.
//
// `skipped` carries the cause of a bracket that spent its budget and was told to skip. That answer flattens
// into the same `continue` a successful bracket returns, and the caller must not read it as one: the optical
// path stands where the failure left it.
async function runInterlockedSafePoint(
	execution: SequencerExecution,
	loop: SequencerPlanLoop,
	frame: SequencerPlanAction,
	configuration: SequencerCapture,
	decisions: readonly SequencerTriggerDecision[],
	policies: SequencerTriggerPolicies,
	observation: SequencerTriggerObservation,
): Promise<{ readonly outcome: SequencerNodeOutcome; readonly skipped?: SequencerSlotCause }> {
	const { host } = execution
	const guider = host.plan.guider
	const retry = host.plan.execution.defaultRetry
	const preparation = { ...configuration.preparation, group: configuration.group }
	// Trigger kinds a previous attempt of this bracket already ran to completion or skipped.
	const ran = new Set<'meridianFlip' | 'autofocus'>()
	let interrupted: SequencerNodeOutcome | undefined
	let flipped = false
	let attempt = 1

	const body = async (state: SequencerInterlockState): Promise<SequencerActionResult<SequencerPreparationOutcome>> => {
		for (const kind of ['meridianFlip', 'autofocus'] as const) {
			if (ran.has(kind)) continue
			if (!decisions.some((decision) => decision.kind === kind)) continue

			const node = triggerNodeOf(loop, kind)

			if (node === undefined) continue

			const { outcome, completed } = await runActionNode(execution, node, host.signal)

			if (outcome.kind !== 'continue') {
				interrupted = outcome
				return { type: 'fatalFailure', reason: 'unexpectedState', detail: `the ${kind} trigger ended the plan` }
			}

			ran.add(kind)

			// A flip that refocuses does it inside its own node, and the trigger evaluator suppresses the standalone
			// autofocus of that safe point precisely because of it (§8.4). The anchor has to advance on that sweep
			// too: leaving it where it was measures the next safe point against a focus two flips old and keeps the
			// `afterMeridianFlip` condition owed by a run that already paid it, so the session refocuses again on the
			// very next frame.
			if (kind === 'meridianFlip') {
				flipped = completed

				if (completed && policies.autofocus?.triggers.afterMeridianFlip === true) execution.anchors = sequencerAnchorAdvanced(execution.anchors, 'autofocus', observation)
			} else if (completed) {
				execution.anchors = sequencerAnchorAdvanced(execution.anchors, 'autofocus', observation)
			}
		}

		state.flipped = flipped

		return await runFramePreparation(host.preparation, host.context(frame.id, attempt, host.signal), preparation)
	}

	const dither = decisions.some((decision) => decision.kind === 'dither') ? policies.dither : undefined

	for (;;) {
		const report: SequencerInterlockReport = {}
		const context = host.context(frame.id, attempt, host.signal)

		// A safe point where no trigger won and the optical path already stands where the frame requires it
		// commands nothing, and the bracket is told so: it is the only place that knows the body ahead of running
		// it. The reading is taken again on every attempt, because a retry follows a preparation that failed part
		// way and left a dimension it had already moved.
		const idle = decisions.length === 0 && !sequencerFramePreparationPending(context, preparation)

		// A session that guides has a settle policy for it; one that does not never enters the bracket, and the
		// request is then only the carrier of the dither the interlock still emits.
		const request = { settle: guider?.settle ?? SEQUENCER_UNGUIDED_SETTLE, recalibrateAfterMeridianFlip: guider?.recalibrateAfterMeridianFlip ?? false, dither, idle }
		const result = await runGuidingInterlock(host.guiding, context, request, body, report)

		// A trigger that ended the plan spent its own budget already, so it is carried out of the bracket as it
		// is rather than retried a second time under this policy.
		if (interrupted !== undefined) return { outcome: interrupted }

		if (result.type === 'completed') {
			if (result.value.dither !== undefined) execution.anchors = sequencerAnchorAdvanced(execution.anchors, 'dither', observation)

			return { outcome: SEQUENCER_CONTINUE }
		}

		if (result.type === 'skipped') return { outcome: SEQUENCER_CONTINUE }
		if (result.type === 'pause') return { outcome: { kind: 'pause' } }
		if (result.type === 'suspend') return { outcome: { kind: 'fail', reason: 'unexpectedState', detail: result.detail } }

		// A dither that failed is decided by the dither, which declares its own budget and its own terminal
		// answer, and a suspension or a resume by the guiding, which declares the budget of the guider commands
		// the session issues outside the plan walk — the bracket is the only place they are issued from, so a
		// guiding retry policy read nowhere else would apply to nothing. The preparation and the triggers of the
		// body stay on the execution default: they belong to the bracket and not to the guiding.
		const failing = report.phase === 'dither' ? dither : undefined
		const guiding = report.phase === 'suspension' || report.phase === 'resume' ? guider : undefined
		const budget = failing?.retry ?? guiding?.retry ?? retry

		// A fatal failure is decided by the terminal half of the same policy and never retried, which the budget
		// of one attempt expresses without a second decision path.
		const decision = sequencerFailurePolicy({
			reason: result.reason,
			detail: result.detail,
			attempt,
			retry: result.type === 'fatalFailure' ? { ...budget, maxAttempts: 1 } : budget,
			onFailure: failing?.onFailure,
			commandedBy: commandedBy(execution),
		})

		if (decision.kind === 'retry') {
			await host.delay(decision.delay, host.waitSignal)

			// The retry delay is where a stop lands: it ends the wait early and leaves standing a decision taken
			// before the operator commanded anything, so the boundary is asked again before the bracket commands
			// a second time. Without it a stopped session goes on to suspend the guider, turn a wheel and sweep a
			// focuser, which is the whole point of the delay being interruptible. The boundary is the earliest of
			// all: nothing is on the sensor and the safe point has not reached its terminal decision, so a pause
			// is attended here only under the immediate mode, exactly as it is between two exposure attempts.
			const converged = await convergeAt(execution, 'afterExposure', frame.id)

			if (converged.outcome.kind !== 'continue') return { outcome: converged.outcome }

			// A hold ends the validity of the reading the safe point was decided on, so the whole safe point is
			// taken again from the moment the session resumed instead of retried against an hour-old sky.
			if (converged.held) return { outcome: SEQUENCER_RETAKE }

			attempt = decision.attempt
			continue
		}

		execution.events.push({ type: 'policyApplied', nodeId: frame.id, detail: decision.kind })

		// A `skip` is the only terminal answer that lets the walk go on after the bracket failed, and it flattens
		// into the same `continue` a successful bracket returns. The caller has to tell them apart: the optical
		// path stands where the failure left it, so the frame ahead is not the frame the plan declared.
		return { outcome: decisionOutcome(decision, result.reason, result.detail), skipped: decision.kind === 'skip' ? { reason: result.reason, detail: result.detail } : undefined }
	}
}

// Decides whether the selected exposure fits ahead of the meridian boundary, and holds until the flip window
// opens when it does not.
//
// A refusal is not a failure: it reorders the safe point around a flip that is about to become possible, and
// the caller re-enters the safe point so the trigger evaluator turns the open window into an actual flip.
//
// The sky is read again here rather than taken from the observation the safe point was decided on. Everything
// between the two — a meridian flip, an autofocus sweep, the frame preparation, the settle of the guiding
// resume, a hold — takes minutes, and the projection combines the hour angle with the *current* instant
// without adding the interval that elapsed: an angle sampled before the bracket, projected from after it,
// understates the position of the target by exactly the time the bracket took, and admits an exposure that
// starts past `maximumHourAngle` or after the flip window opened. The pier sides come from the same reading,
// so the pending flip is judged on one consistent sample of the mount.
async function runExposureGuard(execution: SequencerExecution, policies: SequencerTriggerPolicies, group: SequencerPlanFrameGroup): Promise<SequencerGuardOutcome> {
	const { meridianFlip } = policies

	if (meridianFlip === undefined) return SEQUENCER_EXPOSE

	const reading = execution.host.observe()

	if (reading.hourAngle === undefined) return SEQUENCER_EXPOSE

	const boundary: SequencerFlipBoundary = { minimumHourAngle: meridianFlip.minimumHourAngle, maximumHourAngle: meridianFlip.maximumHourAngle, safetyMargin: meridianFlip.safetyMargin }
	const now = execution.host.now()
	const flipPending = reading.preFlipPierSide !== undefined && reading.pierSide === reading.preFlipPierSide
	const decision = sequencerPreExposureGuard(boundary, {
		hourAngle: reading.hourAngle,
		exposureTime: group.exposureTime,
		now,
		startsAt: sequencerCadenceBoundary(execution.cadence, group.delay),
		flipPending,
	})

	if (decision.type === 'allowed') return SEQUENCER_EXPOSE

	const waited = await waitForFlipWindow(execution.host.context(group.nodeId, 1, waitsOf(execution.host)), boundary, () => execution.host.observe().hourAngle)

	// The wait ends when the window is open, which is the reordering succeeding and not the session ending: the
	// safe point is taken again so the flip runs, and the frame this guard refused is exposed after it.
	if (waited.type === 'completed' || waited.type === 'skipped') return { kind: 'reenter' }

	const commanded = commandedBy(execution)

	// The window can be an hour away, so the cancellation of an immediate pause is what ends this wait far more
	// often than anything else, and it is a pause: the slot the guard refused is still on the cursor and the
	// safe point is taken again once the session resumes.
	if (waited.type === 'pause' || commanded === 'paused') return { kind: 'ended', outcome: { kind: 'pause' } }

	// A stop ends the same wait, under both modes: it travels on the wait signal precisely because an hour spent
	// waiting for the sky is what a stop must not sit through. It is the operator leaving the plan and not
	// something the mount did, so reporting it as a failure ends the night on a cause nobody caused and, worse,
	// composes the terminal pipeline for the wrong outcome — a finalize declared to run only on a stop is
	// skipped, and the mount is left unparked and the cover open on a session the operator ended deliberately.
	if (commanded === 'stopped') return { kind: 'ended', outcome: { kind: 'stop' } }

	return { kind: 'ended', outcome: { kind: 'fail', reason: waited.type === 'suspend' ? 'unexpectedState' : waited.reason, detail: waited.detail } }
}

// Waits for the cadence boundary and exposes the selected frame, spending the attempts of the slot the failure
// policy allows it.
//
// The attempt is physical: it is what names the file. The first one of the slot is read back from the artifact
// registry, because a resume must expose past whatever a crash left behind rather than over it. Every retry
// then advances from the decision, and deliberately does not read the registry again — the record of the
// attempt that just failed is only staged until the next commit, so a second read would answer with the same
// number, hand the retry the same file name, and leave the attempt window measuring an attempt that never
// moved, which is a slot that retries forever on a budget it can never spend. A retake reads it again, and may:
// every path that leaves the loop for one commits the failed attempt first, so the registry it reads is the one
// that already knows the attempt is over.
async function runExposure(execution: SequencerExecution, targetId: string, loop: SequencerPlanLoop, node: SequencerPlanAction, configuration: SequencerCapture, selection: FrameSelection): Promise<SequencerNodeOutcome> {
	const { host } = execution
	const { group, cycle, ordinal } = selection
	const logicalSlotId = sequencerLogicalSlotId(group.nodeId, group.id, cycle, ordinal)
	let attempt = host.slotAttempt(logicalSlotId)

	for (;;) {
		const boundary = sequencerCadenceBoundary(execution.cadence, group.delay)
		const held = await waitForCadenceBoundary(host.context(node.id, attempt, waitsOf(host)), boundary)

		// A cancellation the operator paused with is a pause and not a stop: the loop holds on the slot the wait
		// was taken for and hands it back on the resume, so the frame is retaken instead of lost.
		if (held.type !== 'completed') return held.type === 'pause' || commandedBy(execution) === 'paused' ? { kind: 'pause' } : { kind: 'stop' }

		// The spacing may have taken an arbitrary part of the cadence, so the boundary is asked again before the
		// camera is commanded: a stop or a pause that arrived while the session was spacing frames must not be
		// answered by exposing one more. A hold also invalidates the safe point above it, which is what the retake
		// takes again.
		const converged = await convergeAt(execution, 'beforeFrame', node.id)

		if (converged.outcome.kind !== 'continue') return converged.outcome
		if (converged.held) return SEQUENCER_RETAKE

		// The boundary of the night is asked again immediately before the camera is commanded, for the same reason
		// the convergence above is. Everything between the check the loop made and this instant — a meridian flip,
		// an autofocus sweep, the settle of the guiding resume, the wait for the flip window, this very cadence
		// spacing, and the retry delay of a previous attempt — takes minutes, so a session told to stop at 05:00
		// would otherwise start one more exposure well past it. Leaving through `continue` returns the walk to the
		// loop, which asks the same question in front of the next frame and ends the session normally there.
		if (sequencerEndReached(host.plan.execution.end, host.now(), execution.integration)) return SEQUENCER_CONTINUE

		const slot = frameSlotOf(execution, targetId, group, selection, attempt, logicalSlotId)

		if (slot === undefined) return { kind: 'fail', reason: 'unexpectedState', detail: `the destination of the frame ${logicalSlotId} could not be composed inside the storage root` }

		execution.keeper.enter(node.id, [loop.id, loop.body.id])
		execution.keeper.attempt(node.id, attempt)

		const result = await runNode(execution, node.id, node.type, configuration, attempt, host.signal, slot)

		if (result.type === 'completed' || result.type === 'skipped') {
			execution.cadence = sequencerExposureEnded(host.now())
			execution.capture = result.type === 'completed' ? acceptFrame(execution.capture, targetId, group) : abandonSlot(execution.capture, targetId, group)

			// Only an accepted frame integrates, and it integrates the exposure the group declares rather than the
			// time the node spent: the declared time is what the group counters are stated in, and a session ending
			// on integration must not have the read-out and the safe point of every frame counted into its target.
			if (result.type === 'completed') execution.integration += group.exposureTime

			execution.anchors = sequencerFrameCounted(execution.anchors, group.frameType)
			execution.keeper.capture(execution.capture)
			execution.keeper.anchors(execution.anchors)

			// Every terminating path of the capture block registers a terminal artifact row — committed for the frame
			// it published, rejected for the one it lost — so the progress that counts this slot and the row that
			// records it are one unit (§13.2), and the checkpoint carrying the progress is written as the `artifact`
			// it belongs to rather than as a `frame` the policy may space out. Written apart, a restart finds a
			// committed artifact no progress counted and exposes the slot a second time, or progress for a frame no
			// row records. A `skipped` result registered nothing, so it stays on the cadence the policy declares.
			await checkpointDue(execution, result.type === 'completed' ? 'artifact' : 'frame')

			return SEQUENCER_CONTINUE
		}

		if (result.type === 'pause') return { kind: 'pause' }
		if (result.type === 'suspend') return { kind: 'fail', reason: 'unexpectedState', detail: result.detail }

		// A fatal failure is decided by the terminal half of the same policy and never retried, which the budget
		// of one attempt expresses without a second decision path, exactly as an action node spends it. Handing
		// the declared budget to a camera that reported a fatal failure would expose the same slot again against
		// a condition no attempt of the same node can change.
		const failed = result.type === 'fatalFailure' ? { ...group, retry: { ...group.retry, maxAttempts: 1 } } : group
		const decision = sequencerSlotFailure({ targetId, group: failed, progress: execution.capture, attempt, reason: result.reason, detail: result.detail, commandedBy: commandedBy(execution) })

		execution.events.push({ type: 'policyApplied', nodeId: node.id, detail: decision.kind })

		switch (decision.kind) {
			case 'retry': {
				// The record of the attempt that just failed is only staged, and both paths below hand the slot back
				// to a retake that derives the physical attempt from the registry — the flip window opening here, a
				// hold taken at the cadence boundary of the next attempt. A registry that has not seen the failure
				// answers with the number that failed and the retake exposes over its file, which is why the hold
				// path makes the same write before it lets go of the loop.
				execution.keeper.capture(execution.capture)

				if (host.commit(execution.keeper.checkpoint, execution.events)) execution.events = []

				await host.delay(decision.delay, host.waitSignal)

				// The delay is sky the guard that admitted this exposure never saw: it decided the frame fits ahead
				// of the meridian before the attempt that failed, and the mount has been tracking through the
				// failure and the wait ever since. Without asking it again a retried exposure starts past
				// `maximumHourAngle`, or after the flip window opened, and runs the mount into the pier — the very
				// case the guard exists for, and the one a retry makes likeliest, since a slot that failed is a slot
				// whose frames are being taken later than planned. A window that opened in the meantime reorders the
				// safe point around the flip instead of exposing before it.
				const guarded = await runExposureGuard(execution, triggerPoliciesOf(loop), group)

				if (guarded.kind === 'ended') return guarded.outcome
				if (guarded.kind === 'reenter') return SEQUENCER_RETAKE

				attempt = decision.attempt
				continue
			}
			case 'abandon':
				execution.capture = abandonSlot(execution.capture, targetId, group)
				execution.cause = decision.cause
				execution.keeper.capture(execution.capture)
				// The attempt that gave up the slot registered a rejected row, so this write carries the same unit the
				// accepted frame above does and is due for the same reason.
				await checkpointDue(execution, 'artifact')
				return SEQUENCER_CONTINUE
			case 'hold': {
				execution.cause = decision.cause

				// The session is about to sit still for an unbounded time, so what it has produced is made durable
				// before it does. It is also what the resume reads back: the record of the attempt that just failed
				// is only staged until a commit, and the physical attempt the retake derives from the registry
				// would otherwise answer with the number that failed and expose over its file.
				execution.keeper.capture(execution.capture)

				if (host.commit(execution.keeper.checkpoint, execution.events)) execution.events = []

				const resumed = await holdWalk(execution, node.id)

				if (resumed.kind !== 'continue') return resumed

				// A slot held because it spent its budget gets the window restarted under it, since the operator
				// resuming is the judgement the exhaustion was waiting for. Without it the next failure would be
				// weighed against attempts already counted and hold again immediately, which is a resume that
				// resumes nothing.
				if (decision.exhausted) {
					execution.capture = grantAttemptWindow(execution.capture, targetId, group.id, attempt + 1)
					execution.keeper.capture(execution.capture)
				}

				// The resume goes back to the safe point, not straight to the cadence wait. Everything the safe
				// point establishes was established before the hold and none of it survives one: the observatory
				// reading is old, the triggers were evaluated against it, the guiding interlock was released with
				// the bracket, the optical path was prepared for a frame that never happened and the flip window
				// may have opened while the session sat still. Exposing from here would command the camera under
				// conditions nobody looked at, and it would also skip the pause the operator may have asked for
				// in the meantime.
				return SEQUENCER_RETAKE
			}
			case 'stop':
				return { kind: 'stop' }
			default:
				return { kind: 'fail', reason: decision.reason, detail: decision.detail }
		}
	}
}

// Composes the destination of one frame, or undefined when it would fall outside the approved root.
//
// The name carries the physical attempt, so a recaptured slot never overwrites the file a previous attempt
// left behind, and the whole path is proven contained before anything is written to it.
function frameSlotOf(execution: SequencerExecution, targetId: string, group: SequencerPlanFrameGroup, selection: FrameSelection, attempt: number, logicalSlotId: string): SequencerFrameSlot | undefined {
	const { storage } = execution.host.plan
	const naming = { targetId, group, cycle: selection.cycle, ordinal: selection.ordinal, attempt, filter: execution.host.observe(group.filter).installedFilter }
	const directories = sequencerFrameDirectories(storage.directoryTemplate, naming)
	const fileName = sequencerFrameFileName(storage.fileNameTemplate, naming, logicalSlotId, frameExtension(group))
	const resolution = sequencerVerifiedArtifactPath(execution.host.storage, directories, fileName)

	if (!resolution.ok) return undefined

	const write: SequencerWriteEnvironment = {
		temporaryDirectory: storage.temporaryDirectory,
		session: execution.host.storage.session,
		quarantineDirectory: sequencerAuxiliaryDirectory(execution.host.storage, 'quarantine'),
	}

	return { logicalSlotId, cycle: selection.cycle, ordinal: selection.ordinal, path: resolution.path, write }
}

// File extension of a frame, without the leading dot, from the transfer format the camera writes it in.
//
// `NATIVE` is written as FITS, which is the container the driver delivers it in.
function frameExtension(group: SequencerPlanFrameGroup) {
	return group.camera.transferFormat === 'XISF' ? 'xisf' : 'fits'
}
