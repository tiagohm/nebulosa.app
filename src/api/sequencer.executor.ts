import type { PierSide } from 'nebulosa/src/devices/indi/device'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { SequencerFailureReason, SequencerFilterReference, SequencerGuiderSettle, SequencerRetryPolicy } from '#/sequencer'
import type { SequencerPlan, SequencerPlanAction, SequencerPlanFrameGroup, SequencerPlanLoop, SequencerPlanPipeline, SequencerPlanSequence } from '#/sequencer.plan'
import type { SequencerCaptureProgress, SequencerCheckpoint, SequencerDesiredState, SequencerEventDraft, SequencerTriggerAnchors } from '#/sequencer.state'
import { sequencerCadenceBoundary, sequencerExposureEnded, sequencerSettleAnchored, SEQUENCER_INITIAL_CADENCE_ANCHORS, waitForCadenceBoundary } from './sequencer.cadence'
import type { SequencerCadenceAnchors } from './sequencer.cadence'
import { SequencerCheckpointKeeper } from './sequencer.checkpoint'
import type { SequencerCheckpointTrigger } from './sequencer.checkpoint'
import { SEQUENCER_BLOCK_TYPE, sequencerNodeId, sequencerPlanNodes } from './sequencer.compiler'
import type { SequencerCapture, SequencerFocus, SequencerLifecycle, SequencerMeridianFlipTrigger } from './sequencer.compiler'
import { sequencerConvergence } from './sequencer.control'
import { sequencerPreExposureGuard, waitForFlipWindow } from './sequencer.guard'
import type { SequencerFlipBoundary } from './sequencer.guard'
import type { SequencerDitherTrigger, SequencerGuidingServices } from './sequencer.guiding'
import { sequencerFrameDirectories, sequencerFrameFileName, sequencerLogicalSlotId } from './sequencer.identity'
import { runGuidingInterlock } from './sequencer.interlock'
import type { SequencerInterlockState } from './sequencer.interlock'
import { sequencerAuxiliaryDirectory, sequencerVerifiedArtifactPath } from './sequencer.path'
import type { SequencerPathContext } from './sequencer.path'
import { runSequencerPipeline } from './sequencer.pipeline'
import type { SequencerPipelineReport, SequencerPipelineStep } from './sequencer.pipeline'
import { sequencerFailurePolicy } from './sequencer.policy'
import { runFramePreparation } from './sequencer.prepare'
import type { SequencerPreparationServices } from './sequencer.prepare'
import { abandonSlot, acceptFrame, advanceCaptureCycle, SEQUENCER_INITIAL_CAPTURE_PROGRESS } from './sequencer.progress'
import type { AnySequencerActionHandler, SequencerActionContext, SequencerActionResult, SequencerFrameSlot } from './sequencer.registry'
import { frameScheduler, targetProgressOf } from './sequencer.scheduler'
import type { FrameSelection } from './sequencer.scheduler'
import { sequencerSlotFailure } from './sequencer.slot'
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
	// Cancellation signal of the plan, aborted by a stop and by a shutdown.
	readonly signal: AbortSignal
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
	// Persists the checkpoint together with the events produced since the last write. It is best-effort: a
	// refused write leaves the checkpoint dirty and the next one carries it.
	readonly commit: (checkpoint: SequencerCheckpoint, events: readonly SequencerEventDraft[]) => void
	// Waits `delay` milliseconds, resolving early when the signal aborts.
	readonly delay: (delay: number, signal: AbortSignal) => Promise<void>
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
type SequencerNodeOutcome = { readonly kind: 'continue' } | { readonly kind: 'pause' } | { readonly kind: 'stop' } | { readonly kind: 'fail'; readonly reason: SequencerFailureReason; readonly detail?: string }

// Outcome of a node the plan simply carries on from.
const SEQUENCER_CONTINUE: SequencerNodeOutcome = { kind: 'continue' }

// Settle carried by the interlock request of a session that guides through nothing. The bracket is skipped
// entirely for such a session, so no wait is ever taken against it; it exists because the request is still the
// carrier of the dither, and a zero settle is the honest value for a guider that is not there.
const SEQUENCER_UNGUIDED_SETTLE: SequencerGuiderSettle = { tolerance: 0, time: 0, timeout: 0, minimumFrames: 0 }

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
}

// Executes a compiled plan and returns what it ended as.
//
// The startup pipeline decides on its own whether the plan runs at all: a required action of it that failed is
// already the primary outcome of the session, and the target block is never entered. The finalize pipeline then
// runs for the outcomes the definition asked it to run on, under the terminal signal.
export async function runSequencerPlan(host: SequencerExecutorHost): Promise<SequencerExecutionOutcome> {
	const { plan } = host
	const at = host.now()
	const execution: SequencerExecution = {
		host,
		keeper: new SequencerCheckpointKeeper(initialCheckpoint(plan), at),
		events: [],
		capture: SEQUENCER_INITIAL_CAPTURE_PROGRESS,
		anchors: sequencerInitialTriggerAnchors(at),
		cadence: SEQUENCER_INITIAL_CADENCE_ANCHORS,
	}

	execution.keeper.anchors(execution.anchors)

	let primary: SequencerPrimaryOutcome | undefined

	const startup = pipelineOf(plan.root, 'startup')

	if (startup !== undefined && plan.startup !== undefined) {
		const report = await runPipelineBlock(execution, plan.startup, startup, host.signal)
		primary = sequencerStartupOutcome(report)
	}

	primary ??= outcomeOf(await runTargetBlock(execution))

	let finalized: SequencerPipelineReport | undefined
	const finalize = pipelineOf(plan.root, 'finalize')

	if (finalize !== undefined && plan.finalize !== undefined && sequencerFinalizeRuns(plan.finalize, primary)) {
		finalized = await runPipelineBlock(execution, plan.finalize, finalize, host.terminalSignal)
	}

	execution.keeper.leave()
	execution.keeper.capture(execution.capture)

	return { terminal: sequencerTerminalOutcome(primary, finalized), checkpoint: execution.keeper.checkpoint, capture: execution.capture }
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
// commanded-stop attribution; the only thing supplied here is how a step runs and how a wait is taken.
async function runPipelineBlock(execution: SequencerExecution, pipeline: SequencerPlanPipeline, block: SequencerPlanSequence, signal: AbortSignal): Promise<SequencerPipelineReport> {
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

				execution.keeper.complete(step.nodeId)
				await checkpointDue(execution, 'action')

				return result
			},
			delay: (delay, delaySignal) => host.delay(delay, delaySignal),
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

// Primary outcome of the session, from what the target block ended as.
function outcomeOf(outcome: SequencerNodeOutcome): SequencerPrimaryOutcome {
	switch (outcome.kind) {
		case 'continue':
			return { kind: 'completed' }
		case 'pause':
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
	execution.host.commit(execution.keeper.checkpoint, execution.events)
	execution.keeper.written(at)
	execution.events = []

	await Promise.resolve()
}

// Runs the target block: the slew, the centering, and the capture loop, in the order the lowering emitted.
//
// The slew and the centering are what the initial settle is anchored on: they are the movement the first
// exposure of the session has to be stable after, and the cadence charges that settle once rather than before
// every frame.
async function runTargetBlock(execution: SequencerExecution): Promise<SequencerNodeOutcome> {
	const { plan } = execution.host
	const block = targetOf(plan.root, plan.target.id)

	if (block === undefined) return { kind: 'fail', reason: 'unexpectedState', detail: 'the plan carries no target block' }

	for (const node of actionsOf(block)) {
		const { outcome } = await runActionNode(execution, node, execution.host.signal)

		if (outcome.kind !== 'continue') return outcome

		execution.cadence = sequencerSettleAnchored(execution.cadence, execution.host.now())
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
			const convergence = sequencerConvergence(execution.host.desiredState(), execution.host.plan.execution, 'beforeFrame')

			if (convergence === 'pause') return { kind: 'pause' }
			if (convergence === 'stop') return { kind: 'stop' }

			const instant = execution.host.now()
			const reading = execution.host.observe()
			const selection = scheduler.next(execution.capture, { targetId, instant, sensorTemperature: reading.sensorTemperature, filter: reading.installedFilter })

			if (selection === undefined) break

			const outcome = await runSafePoint(execution, targetId, loop, selection, instant)

			if (outcome.kind !== 'continue') return outcome
		}

		execution.capture = advanceCaptureCycle(execution.capture, targetId)
		execution.keeper.capture(execution.capture)
		execution.keeper.reenter(body)

		await checkpointDue(execution, 'transition')
	}
}

// Runs the safe point of one selected frame, up to and including the exposure that fills its slot.
async function runSafePoint(execution: SequencerExecution, targetId: string, loop: SequencerPlanLoop, selection: FrameSelection, instant: number): Promise<SequencerNodeOutcome> {
	const { host } = execution
	const { group } = selection
	const node = frameNodeOf(loop, group)

	if (node === undefined) return { kind: 'fail', reason: 'unexpectedState', detail: `the plan carries no capture node for the frame group ${group.id}` }

	const configuration = node.configuration as SequencerCapture
	const policies = triggerPoliciesOf(loop)
	const reading = host.observe(group.filter)
	const observation: SequencerTriggerObservation = {
		instant,
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

	execution.anchors = sequencerTriggerPending(policies, execution.anchors, decisions, observation)

	for (const decision of decisions) execution.events.push({ type: 'triggerFired', nodeId: node.id, detail: `${decision.kind}:${decision.reason}` })

	const bracketed = await runInterlockedSafePoint(execution, loop, node, configuration, decisions, policies, observation)

	if (bracketed.kind !== 'continue') return bracketed

	// Everything the bracket did is movement the exposure has to be stable after, so the settle is anchored on
	// it rather than on the frame before it.
	execution.cadence = sequencerSettleAnchored(execution.cadence, host.now())

	const guarded = await runExposureGuard(execution, policies, group, configuration, observation)

	if (guarded.kind !== 'continue') return guarded

	return await runExposure(execution, targetId, loop, node, configuration, selection)
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
// The bracket is retried under the execution retry policy, because everything it commands is a device that can
// time out once and answer the next time: a wheel that did not report the filter in place, a rotator that
// missed its angle, a guider that did not settle. Failing the bracket outright would end the night on the
// first of them. What is not repeated on a retry is a trigger that already ran — a flip is not flipped twice
// and an autofocus sweep is not paid twice for the same frame — so only the preparation and the bracket itself
// are actually re-commanded, and the crossing a previous attempt reported still turns the resume into a
// recalibration.
async function runInterlockedSafePoint(execution: SequencerExecution, loop: SequencerPlanLoop, frame: SequencerPlanAction, configuration: SequencerCapture, decisions: readonly SequencerTriggerDecision[], policies: SequencerTriggerPolicies, observation: SequencerTriggerObservation): Promise<SequencerNodeOutcome> {
	const { host } = execution
	const guider = host.plan.guider
	const retry = host.plan.execution.defaultRetry
	// Trigger kinds a previous attempt of this bracket already ran to completion or skipped.
	const ran = new Set<'meridianFlip' | 'autofocus'>()
	let interrupted: SequencerNodeOutcome | undefined
	let flipped = false
	let attempt = 1

	const body = async (state: SequencerInterlockState): Promise<SequencerActionResult<unknown>> => {
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

			if (kind === 'meridianFlip') flipped = completed
			else if (completed) execution.anchors = sequencerAnchorAdvanced(execution.anchors, 'autofocus', observation)
		}

		state.flipped = flipped

		return await runFramePreparation(host.preparation, host.context(frame.id, attempt, host.signal), { ...configuration.preparation, group: configuration.group })
	}

	const dither = decisions.some((decision) => decision.kind === 'dither') ? policies.dither : undefined

	// A session that guides has a settle policy for it; one that does not never enters the bracket, and the
	// request is then only the carrier of the dither the interlock still emits.
	const request = { settle: guider?.settle ?? SEQUENCER_UNGUIDED_SETTLE, recalibrateAfterMeridianFlip: guider?.recalibrateAfterMeridianFlip ?? false, dither }

	for (;;) {
		const result = await runGuidingInterlock(host.guiding, host.context(frame.id, attempt, host.signal), request, body)

		// A trigger that ended the plan spent its own budget already, so it is carried out of the bracket as it
		// is rather than retried a second time under this policy.
		if (interrupted !== undefined) return interrupted

		if (result.type === 'completed') {
			if (result.value.dither !== undefined) execution.anchors = sequencerAnchorAdvanced(execution.anchors, 'dither', observation)
			return SEQUENCER_CONTINUE
		}

		if (result.type === 'skipped') return SEQUENCER_CONTINUE
		if (result.type === 'pause') return { kind: 'pause' }
		if (result.type === 'suspend') return { kind: 'fail', reason: 'unexpectedState', detail: result.detail }

		// A fatal failure is decided by the terminal half of the same policy and never retried, which the budget
		// of one attempt expresses without a second decision path.
		const decision = sequencerFailurePolicy({
			reason: result.reason,
			detail: result.detail,
			attempt,
			retry: result.type === 'fatalFailure' ? { ...retry, maxAttempts: 1 } : retry,
			commandedBy: commandedBy(execution),
		})

		if (decision.kind === 'retry') {
			await host.delay(decision.delay, host.signal)
			attempt = decision.attempt
			continue
		}

		execution.events.push({ type: 'policyApplied', nodeId: frame.id, detail: decision.kind })

		return decisionOutcome(decision, result.reason, result.detail)
	}
}

// Decides whether the selected exposure fits ahead of the meridian boundary, and holds until the flip window
// opens when it does not.
//
// A refusal is not a failure: it reorders the safe point around a flip that is about to become possible, and
// the caller re-enters the safe point so the trigger evaluator turns the open window into an actual flip.
async function runExposureGuard(execution: SequencerExecution, policies: SequencerTriggerPolicies, group: SequencerPlanFrameGroup, configuration: SequencerCapture, observation: SequencerTriggerObservation): Promise<SequencerNodeOutcome> {
	const { meridianFlip } = policies

	if (meridianFlip === undefined || observation.hourAngle === undefined) return SEQUENCER_CONTINUE

	const boundary: SequencerFlipBoundary = { minimumHourAngle: meridianFlip.minimumHourAngle, maximumHourAngle: meridianFlip.maximumHourAngle, safetyMargin: meridianFlip.safetyMargin }
	const now = execution.host.now()
	const flipPending = observation.preFlipPierSide !== undefined && observation.pierSide === observation.preFlipPierSide
	const decision = sequencerPreExposureGuard(boundary, {
		hourAngle: observation.hourAngle,
		exposureTime: group.exposureTime,
		now,
		startsAt: sequencerCadenceBoundary(execution.cadence, { delay: group.delay, settle: configuration.settle }),
		flipPending,
	})

	if (decision.type === 'allowed') return SEQUENCER_CONTINUE

	const waited = await waitForFlipWindow(execution.host.context(group.nodeId, 1, execution.host.signal), boundary, () => execution.host.observe().hourAngle)

	if (waited.type === 'completed' || waited.type === 'skipped') return { kind: 'stop' }

	return waited.type === 'pause' ? { kind: 'pause' } : { kind: 'fail', reason: waited.type === 'suspend' ? 'unexpectedState' : waited.reason, detail: waited.detail }
}

// Waits for the cadence boundary and exposes the selected frame, spending the attempts of the slot the failure
// policy allows it.
//
// The attempt is physical: it is what names the file. The first one of the slot is read back from the artifact
// registry, because a resume must expose past whatever a crash left behind rather than over it. Every retry
// then advances from the decision, and deliberately does not read the registry again — the record of the
// attempt that just failed is only staged until the next commit, so a second read would answer with the same
// number, hand the retry the same file name, and leave the attempt window measuring an attempt that never
// moved, which is a slot that retries forever on a budget it can never spend.
async function runExposure(execution: SequencerExecution, targetId: string, loop: SequencerPlanLoop, node: SequencerPlanAction, configuration: SequencerCapture, selection: FrameSelection): Promise<SequencerNodeOutcome> {
	const { host } = execution
	const { group, cycle, ordinal } = selection
	const logicalSlotId = sequencerLogicalSlotId(group.nodeId, group.id, cycle, ordinal)
	let attempt = host.slotAttempt(logicalSlotId)

	for (;;) {
		const boundary = sequencerCadenceBoundary(execution.cadence, { delay: group.delay, settle: configuration.settle })
		const held = await waitForCadenceBoundary(host.context(node.id, attempt, host.signal), boundary)

		if (held.type !== 'completed') return held.type === 'pause' ? { kind: 'pause' } : { kind: 'stop' }

		const slot = frameSlotOf(execution, targetId, group, selection, attempt, logicalSlotId)

		if (slot === undefined) return { kind: 'fail', reason: 'unexpectedState', detail: `the destination of the frame ${logicalSlotId} could not be composed inside the storage root` }

		execution.keeper.enter(node.id, [loop.id, loop.body.id])
		execution.keeper.attempt(node.id, attempt)

		const result = await runNode(execution, node.id, node.type, configuration, attempt, host.signal, slot)

		if (result.type === 'completed' || result.type === 'skipped') {
			execution.cadence = sequencerExposureEnded(host.now())
			execution.capture = result.type === 'completed' ? acceptFrame(execution.capture, targetId, group) : abandonSlot(execution.capture, targetId, group)
			execution.anchors = sequencerFrameCounted(execution.anchors, group.frameType)
			execution.keeper.capture(execution.capture)
			execution.keeper.anchors(execution.anchors)

			await checkpointDue(execution, 'frame')

			return SEQUENCER_CONTINUE
		}

		if (result.type === 'pause') return { kind: 'pause' }
		if (result.type === 'suspend') return { kind: 'fail', reason: 'unexpectedState', detail: result.detail }

		const decision = sequencerSlotFailure({ targetId, group, progress: execution.capture, attempt, reason: result.reason, detail: result.detail, commandedBy: commandedBy(execution) })

		execution.events.push({ type: 'policyApplied', nodeId: node.id, detail: decision.kind })

		switch (decision.kind) {
			case 'retry':
				await host.delay(decision.delay, host.signal)
				attempt = decision.attempt
				continue
			case 'abandon':
				execution.capture = abandonSlot(execution.capture, targetId, group)
				execution.keeper.capture(execution.capture)
				await checkpointDue(execution, 'frame')
				return SEQUENCER_CONTINUE
			case 'hold':
				return { kind: 'pause' }
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

// File extension of a frame, without the leading dot, from the container format the camera writes.
function frameExtension(group: SequencerPlanFrameGroup) {
	return group.camera.frameFormat.toLowerCase().includes('xisf') ? 'xisf' : 'fits'
}
