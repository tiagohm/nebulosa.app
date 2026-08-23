import { isAbsolute } from 'path'
import type { MountTargetCoordinate, PierSide } from 'nebulosa/src/devices/indi/device'
import { parseAngle } from 'nebulosa/src/math/units/angle'
import type { Angle } from 'nebulosa/src/math/units/angle'
// oxfmt-ignore
import type { Sequencer, SequencerAutofocus, SequencerAuxiliaryCapture, SequencerCamera, SequencerCentering, SequencerCooling, SequencerCover, SequencerDeviceRole, SequencerDevices, SequencerDither, SequencerFailureReason, SequencerFilterFocusOffset, SequencerFlatPanel, SequencerFrame, SequencerGuiderSettle, SequencerLifecycleActionType, SequencerMeridianFlip, SequencerRetryPolicy, SequencerRotator, SequencerTarget, SequencerTargetTracking } from '#/sequencer'
import type { SequencerCompilation, SequencerDiagnostic, SequencerPlan, SequencerPlanAction, SequencerPlanFrameGroup, SequencerPlanGuider, SequencerPlanNode, SequencerPlanSequence, SequencerRemoval } from '#/sequencer.plan'
import { sequencerUnknownPlaceholders } from './sequencer.identity'
import { SEQUENCER_AUXILIARY_SEGMENT, sequencerArtifactPath, sequencerPathSegments } from './sequencer.path'
import type { SequencerBlockRegistry } from './sequencer.registry'
import { isPathSegment } from './util'

// Lowering of a sequencer definition into the executable plan.
//
// The definition is declarative and organized per feature; the plan is a node tree the runtime walks. This
// module is the only place that knows how one becomes the other, and it is pure: no clock, no filesystem, no
// device, no registry lookup that could depend on what is connected right now. Compiling the same definition
// twice produces byte-identical output, which is what makes node ids, artifact ids, and file names stable
// across a restart.
//
// Lowering is total. It either produces a plan or a list of diagnostics addressed to the exact property that
// caused the refusal; it never produces a plan that would fail at the first node.
//
// Units follow the definition: angles are radians, durations are seconds.

// Block type of every action node the lowering can emit. The registry resolves the handler by this string,
// so the value is part of the persisted checkpoint and must not change once a session has used it.
export const SEQUENCER_BLOCK_TYPE = {
	// Slew of the mount to the target coordinates.
	slew: 'slew',
	// Closed-loop plate-solved centering on the target coordinates.
	center: 'center',
	// One exposure of one frame group.
	captureFrame: 'capture.frame',
	// Safe-point autofocus evaluation.
	autofocus: 'trigger.autofocus',
	// Safe-point dither evaluation.
	dither: 'trigger.dither',
	// Safe-point meridian-flip evaluation.
	meridianFlip: 'trigger.meridianFlip',
} as const

// Prefix of every lifecycle block type; the suffix is the declared action type, such as `lifecycle.openCover`.
export const SEQUENCER_LIFECYCLE_BLOCK_PREFIX = 'lifecycle.'

// Configuration of the slew action. A session that names a mount always slews; the commander skips the
// command only when the mount already reports the target coordinates, with no skip tolerance. Tracking is
// established on arrival, settle is the declared wait after that, and pointing precision is the centering
// block.
export interface SequencerSlew {
	// Where to point.
	readonly coordinates: MountTargetCoordinate<Angle>
	// Tracking to establish after arrival, absent when the target does not command tracking.
	readonly tracking?: Omit<SequencerTargetTracking, 'enabled'>
	// Maximum time allowed for the slew, in seconds, copied from the target.
	readonly timeout: number
	// Seconds to wait after arrival before the next action, copied from the target.
	readonly settle: number
	// Retry policy applied when the slew fails, copied from the target.
	readonly retry: SequencerRetryPolicy
}

// Configuration of the centering action.
export interface SequencerCenter extends Omit<SequencerCentering, 'enabled'> {
	// Coordinates the solved field is compared against.
	readonly coordinates: MountTargetCoordinate<Angle>
	// Rotator position to reach before the plate-solve, present when `moveBeforeCentering` is set. Rotating
	// after the solve undoes the field the centering just verified.
	readonly rotator?: Pick<SequencerRotator, 'angle' | 'tolerance' | 'settle'>
}

// Configuration of the dither trigger: the declared dither policy without its enablement flag, plus the
// settle the lowering resolved for it.
export interface SequencerDitherTrigger extends Omit<SequencerDither, 'enabled'> {
	// Guiding settle the dither waits under, which is the settle of the session. A dither is a displacement of
	// the guiding, so what counts as settled after it is what counts as settled after any other transition of
	// the same guider.
	readonly settle: SequencerGuiderSettle
}

// Configuration of the autofocus trigger, which is the declared autofocus policy without its enablement flag:
// the focuser routine, its capture recipe, the star detection it measures with, and the filter offsets.
export type SequencerFocus = Omit<SequencerAutofocus, 'enabled'>

// Configuration of the meridian-flip trigger: the declared flip policy plus the operations it re-establishes
// on the other side of the meridian.
export interface SequencerMeridianFlipTrigger extends Omit<SequencerMeridianFlip, 'enabled'> {
	// Centering to perform once the mount is on the other side, present only when the flip asks to recenter and
	// undefined otherwise. A flip invalidates the pointing, and a handler is given its configuration and an
	// execution context that does not carry the plan, so the coordinates, solver, tolerance, and auxiliary
	// capture the recentering needs travel with the node that commands it. It is the same centering the target
	// performs before the loop, which is what makes the field the flip restores the field it started from.
	readonly centering?: SequencerCenter
	// Autofocus to run once the mount is on the other side, present only when the flip asks to focus and
	// undefined otherwise. `autofocus` above is the declared request, and it says nothing about how to focus:
	// the routine, the capture recipe, the star detection, and the filter offsets live in the autofocus block,
	// and the execution context of a handler does not carry the plan to read them from.
	readonly focusing?: SequencerFocus
	// Side the mount was on before a crossing that already happened, present only when the executor re-enters
	// this node to finish a recovery an interruption cut short, and never lowered by the compiler: the plan
	// describes a whole flip, and this is the one fact about a particular night the node cannot rediscover.
	// It is what makes the re-entry resume at the recentering and the refocusing instead of commanding a second
	// crossing, which would take a mount that is already across back to the side the flip existed to leave.
	readonly crossedFrom?: PierSide
	// Set when the guiding interlock of this safe point will settle the resume, so the flip must not pay a
	// second wall-clock wait after the crossing. Absent when the session is not guiding, which is when this
	// settle is the only one the mount gets.
	readonly deferSettle?: boolean
}

// Configuration of one capture action, which is the frame group plus the settling the capture plan requires
// before an exposure starts.
export interface SequencerCapture {
	// Group this action exposes for.
	readonly group: SequencerPlanFrameGroup
	// Optical-path policies the safe point in front of this exposure reconciles against.
	readonly preparation: SequencerCapturePreparation
}

// Policies the frame preparation of a capture node reconciles the optical path against, carried on the node
// so the runtime never has to reach back into the definition to run a safe point.
//
// It is declared here rather than imported from the preparation module because the compiler is pure and that
// module owns device commanders. The shape is deliberately the preparation input without its group, which the
// capture node already carries.
export interface SequencerCapturePreparation {
	// Cover policy, absent when the definition declares no cover feature.
	readonly cover?: Omit<SequencerCover, 'enabled'>
	// Flat panel policy, absent when the definition declares no panel feature.
	readonly flatPanel?: Omit<SequencerFlatPanel, 'enabled'>
	// Rotator policy, absent when the definition declares no rotator feature.
	readonly rotator?: Omit<SequencerRotator, 'enabled'>
	// Thermal policy, absent when the definition declares no cooling feature. The preparation only waits on it.
	readonly cooling?: Omit<SequencerCooling, 'enabled'>
	// Tracking policy of the target, absent when the definition does not track.
	readonly tracking?: Omit<SequencerTargetTracking, 'enabled'>
	// Focuser offsets per filter, in device steps, applied when the reconciliation moves the wheel. They are
	// carried whether or not autofocus is enabled: a filter change displaces focus by an amount the definition
	// measured, and compensating for it is not an autofocus run.
	readonly filterOffsets: readonly SequencerFilterFocusOffset[]
}

// Configuration of one derived lifecycle step: the type the handler commands, plus the timeout, retry and
// requiredness taken from the equipment block that owns that step.
export interface SequencerLifecycle {
	// Reconciliation this step performs.
	readonly type: SequencerLifecycleActionType
	// Whether a failure of this action must make the session terminal.
	// Startup steps are required except for opening the cover when capture will open it anyway; shutdown steps are not.
	readonly required: boolean
	// Maximum time allowed for the action to reach its terminal state, in seconds.
	// Zero runs without a deadline of its own.
	readonly timeout: number
	// Failure policy of the action, taken from the owning equipment block.
	readonly retry: SequencerRetryPolicy
	// Thermal policy the action commands, present only on the actions that command the cooler and undefined on
	// every other one. The cooler actions declare no setpoint of their own, and a handler is given its
	// configuration and an execution context that does not carry the plan, so the policy travels with the node
	// that commands it: temperatures are degrees Celsius, ramps degrees Celsius per minute.
	readonly cooling?: SequencerCooling
	// Tracking policy the action establishes, present only on the action that starts tracking and undefined on
	// every other one. The action declares no mode of its own — the target is the single authority for how the
	// mount tracks — and a handler cannot read the target from its execution context, so the mode and the
	// non-sidereal rates travel with the node that commands them: rates are radians per second.
	readonly tracking?: Omit<SequencerTargetTracking, 'enabled'>
	// Guiding policy the action establishes, present only on the action that starts guiding and undefined on
	// every other one. The action declares nothing of it on its own — the guiding block is the single authority
	// for how the session guides — and a handler cannot read the plan from its execution context, so the policy
	// travels with the node that commands it.
	readonly guiding?: SequencerLifecycleGuiding
}

// What the action that starts guiding establishes on the guiding session, taken from the guiding block of the
// definition. It is the part of the guider the start of the night writes; the connection, the retry policy and
// the recalibration rules are commanded elsewhere and are deliberately not repeated here.
export interface SequencerLifecycleGuiding extends Pick<SequencerPlanGuider, 'calibrateBeforeStart' | 'settle'> {
	// Recipe the guide camera exposes with, present only for a guider this session owns locally and absent for
	// a remote one, whose exposures belong to the program running it. The filter is not part of it: a local
	// guider drives its guide camera alone. Exposure time is seconds.
	readonly capture?: Omit<SequencerAuxiliaryCapture, 'filter'>
}

// Mutable accumulator threaded through the lowering, so every stage reports against the same definition
// without returning partial results up the call chain.
interface CompilerContext {
	// Reasons the definition cannot be lowered, in definition order.
	readonly diagnostics: SequencerDiagnostic[]
	// Declared fields deliberately not lowered.
	readonly removals: SequencerRemoval[]
}

// Node ids of the plan, built from declared ids and never from a position in an array.
//
// A node id is not a label: it is the key of the checkpoint, of the artifact, and of the readable part of the
// file name, so an id that moved would orphan the frames already on disk and make a resume execute the wrong
// node. Inserting a frame or renaming a target therefore has to leave every id that already existed untouched,
// which positional ids cannot promise and declared ids give for free. Lifecycle steps are addressed by their
// action type, which is unique within a pipeline and does not move when another flag is turned on.
//
// The target segment appears in every node below the target, because those nodes exist once per target and
// their artifacts belong to it. Startup and finalize carry no target segment: they run once per session, and
// a target segment there would claim a relationship that does not exist.
export const sequencerNodeId = {
	// Root of the plan.
	root: () => 'plan',
	// Startup or finalize block.
	pipeline: (pipeline: 'startup' | 'finalize') => pipeline,
	// One lifecycle action of a pipeline, addressed by its action type, which is unique within a pipeline.
	pipelineAction: (pipeline: 'startup' | 'finalize', actionId: string) => `${pipeline}.action[${actionId}]`,
	// Target block, addressed by its declared target id.
	target: (targetId: string) => `target[${targetId}]`,
	// Slew of the target block.
	slew: (targetId: string) => `target[${targetId}].slew`,
	// Centering of the target block.
	center: (targetId: string) => `target[${targetId}].center`,
	// Capture loop of the target block.
	captureLoop: (targetId: string) => `target[${targetId}].capture.loop`,
	// One iteration of the capture loop, which is the container of the triggers and the frames.
	captureCycle: (targetId: string) => `target[${targetId}].capture.cycle`,
	// Capture action of one frame group, addressed by its declared frame id.
	captureFrame: (targetId: string, frameId: string) => `target[${targetId}].capture.frame[${frameId}]`,
	// Safe-point trigger of the capture loop.
	trigger: (targetId: string, trigger: 'autofocus' | 'dither' | 'meridianFlip') => `target[${targetId}].trigger.${trigger}`,
} as const

// Walks a node tree in execution order, yielding every node including the one it starts from.
//
// The traversal enters the body of a loop once: the body is one iteration, and how many iterations run is a
// runtime decision the plan deliberately does not encode.
export function* sequencerPlanNodes(node: SequencerPlanNode): Generator<SequencerPlanNode> {
	yield node

	if (node.kind === 'sequence') {
		for (const child of node.children) yield* sequencerPlanNodes(child)
	} else if (node.kind === 'loop') {
		yield* sequencerPlanNodes(node.body)
	}
}

// Applies the per-frame camera overrides over the capture defaults, so the capture action never has to merge
// anything at exposure time. Only properties the frame actually declares override the default.
function cameraSettingsOf(frame: SequencerFrame, defaults: SequencerCamera): SequencerCamera {
	return {
		binX: defaults.binX,
		binY: defaults.binY,
		gain: defaults.gain,
		offset: defaults.offset,
		frameFormat: defaults.frameFormat,
		transferFormat: defaults.transferFormat,
		compressed: defaults.compressed,
		x: defaults.x,
		y: defaults.y,
		width: defaults.width,
		height: defaults.height,
		...frame.camera,
		subframe: frame.camera.subframe ?? defaults.subframe,
	}
}

// Whether a frame group contributes anything to the plan.
//
// The frame count is the only completion criterion, and `0` disables it, so a group asking for no frame
// concludes on nothing. Following the contract, a zero count disables the group, with exactly the effect of
// `enabled: false`; the alternative reading is a group that captures forever, which no operator writes on
// purpose.
function frameGroupEnabled(frame: SequencerFrame) {
	return frame.enabled && frame.count > 0
}

// Reports the three ways the capture plan makes its loop unbounded, which is one of the only situations this
// project checks at runtime.
//
// A slot limit above `Number.MAX_SAFE_INTEGER` is an infinite loop coming through another door: a scheduler
// counting slots one at a time stops changing its counter there, so it never reaches the bound and the
// supposedly bounded loop runs forever. A repetition count of zero would have to be read as "no cycle at
// all", and silently disabling the whole capture through the repetition counter is precisely the quiet
// acceptance the compatibility rule forbids. The repetition count is bounded from above for the same reason
// the slot limit is: the loop counts the cycles it completed, and a bound the counter cannot reach is a loop
// with no end.
//
// The projection derived from those bounded counters is checked here as well, because it is derived from the
// same numbers: slots that terminate can still multiply by an exposure into a value outside the range of a
// number, and a plan carrying an infinite projection reports it over HTTP as `null`, which is a session
// accepted with no answer to how much of the night it asks for.
function checkTermination(context: CompilerContext, definition: Sequencer) {
	const { frames, repeat } = definition.capture
	let projected = 0

	if (repeat < 1) context.diagnostics.push({ path: 'capture.repeat', message: 'the capture must run at least one cycle' })
	else if (repeat > Number.MAX_SAFE_INTEGER) context.diagnostics.push({ path: 'capture.repeat', message: 'the cycle count is above the range a number counts one by one, so a loop counting completed cycles would stop advancing before reaching it' })

	for (let i = 0; i < frames.length; i++) {
		const frame = frames[i]

		if (!frameGroupEnabled(frame)) continue

		const slots = frame.count
		const integration = slots * frame.exposureTime

		if (slots + (frame.abandonmentBudget ?? 0) > Number.MAX_SAFE_INTEGER) context.diagnostics.push({ path: `capture.frames[${i}]`, message: 'the slot limit of the group is above the range a number counts one by one, so a scheduler counting slots would stop advancing before reaching it' })
		else if (!Number.isFinite(integration)) context.diagnostics.push({ path: `capture.frames[${i}].exposureTime`, message: 'the slots of the group exposing for this long overflow the range of a number, so the plan would report no projected integration for it' })
		else projected += integration
	}

	// The pre-flight view sums the projection of every group and scales it by the cycle count, so a sequence
	// total can overflow while each group of one cycle stays inside the range. The cycle count is only read
	// here once it is itself in range, because an out-of-range one is already reported at this path.
	if (repeat >= 1 && repeat <= Number.MAX_SAFE_INTEGER && !Number.isFinite(projected * repeat)) context.diagnostics.push({ path: 'capture.repeat', message: 'the projected integration of the whole sequence overflows the range of a number, so the plan would report no projection for it' })
}

// Lowers one enabled frame into a normalized group. The delay is resolved here, from the frame when it
// declares one and from the capture plan otherwise, so the scheduler never sees an undefined spacing.
function lowerFrameGroup(definition: Sequencer, frame: SequencerFrame): SequencerPlanFrameGroup {
	const { capture, target } = definition
	const requiredSlots = frame.count
	const abandonmentBudget = frame.abandonmentBudget ?? 0

	return {
		id: frame.id,
		name: frame.name,
		nodeId: sequencerNodeId.captureFrame(target.id, frame.id),
		frameType: frame.frameType,
		exposureTime: frame.exposureTime,
		count: frame.count,
		delay: frame.delay ?? capture.delay,
		weight: frame.weight,
		filter: frame.filter,
		camera: cameraSettingsOf(frame, capture),
		retry: capture.retry,
		requiredSlots,
		abandonmentBudget,
		slotLimit: requiredSlots + abandonmentBudget,
		projectedIntegration: requiredSlots * frame.exposureTime,
	}
}

// Lowers the tracking policy of the target, or undefined when the target does not track. The enablement flag
// is consumed here: a node carrying the policy carries how the mount tracks, not whether it was asked for.
function lowerTracking(definition: Sequencer): Omit<SequencerTargetTracking, 'enabled'> | undefined {
	const { tracking } = definition.target
	if (!tracking.enabled) return undefined
	const { enabled, ...policy } = tracking
	return policy
}

// Lifecycle actions that command the camera cooler and therefore carry the thermal policy of the definition.
const SEQUENCER_COOLER_ACTION: ReadonlySet<SequencerLifecycleActionType> = new Set(['coolCamera', 'warmCamera'])

// One derived lifecycle step, before it is lowered into a plan node.
interface SequencerDerivedLifecycle {
	// Reconciliation this step performs.
	readonly type: SequencerLifecycleActionType
	// Whether a failure of this step must make the session terminal.
	readonly required: boolean
	// Maximum time allowed for the step, in seconds. Zero runs without a deadline of its own.
	readonly timeout: number
	// Failure policy taken from the owning equipment block.
	readonly retry: SequencerRetryPolicy
}

// Lowers one derived lifecycle step into its action node. The node id comes from the action type and the
// pipeline it belongs to, with no target segment: startup and finalize are siblings of the target block and
// run once per session, so a target segment there would claim a relationship that does not exist.
//
// `cooling` is the thermal policy of the definition, or undefined when it declares none; it reaches only the
// actions that command the cooler, which is the whole reason the policy is carried into a node. `tracking` is
// the tracking policy of the target, carried the same way and reaching only the action that starts tracking,
// and `guiding` is the guiding policy of the definition, reaching only the action that starts guiding.
function lowerLifecycleAction(pipeline: 'startup' | 'finalize', step: SequencerDerivedLifecycle, cooling: SequencerCooling | undefined, tracking: Omit<SequencerTargetTracking, 'enabled'> | undefined, guiding: SequencerLifecycleGuiding | undefined): SequencerPlanAction {
	const configuration: SequencerLifecycle = {
		type: step.type,
		required: step.required,
		timeout: step.timeout,
		retry: step.retry,
		cooling: SEQUENCER_COOLER_ACTION.has(step.type) ? cooling : undefined,
		tracking: step.type === 'startTracking' ? tracking : undefined,
		guiding: step.type === 'startGuiding' ? guiding : undefined,
	}
	return { kind: 'action', id: sequencerNodeId.pipelineAction(pipeline, step.type), type: `${SEQUENCER_LIFECYCLE_BLOCK_PREFIX}${step.type}`, configuration }
}

// Lowers an ordered lifecycle pipeline. Returns undefined when the pipeline declares no step: an empty
// container would be a node the runtime enters and leaves for nothing, and it would still show up in the
// checkpoint as a place the session had been.
function lowerPipeline(pipeline: 'startup' | 'finalize', steps: readonly SequencerDerivedLifecycle[], cooling: SequencerCooling | undefined, tracking: Omit<SequencerTargetTracking, 'enabled'> | undefined, guiding: SequencerLifecycleGuiding | undefined): SequencerPlanSequence | undefined {
	const children = steps.map((step) => lowerLifecycleAction(pipeline, step, cooling, tracking, guiding))

	return children.length > 0 ? { kind: 'sequence', id: sequencerNodeId.pipeline(pipeline), children } : undefined
}

// Derives the startup pipeline from the equipment flags. The order is the only physically valid one and is
// not configurable: unpark the mount, open the cover, cool, then guide. Tracking is established by the slew
// on arrival, not by a startup step, because a session that names a mount always slews.
function deriveStartup(definition: Sequencer): SequencerDerivedLifecycle[] {
	if (!definition.startup.enabled) return []

	const { cooling, cover, guiding, mount } = definition
	const steps: SequencerDerivedLifecycle[] = []

	if (mount.enabled && mount.unparkOnStartup) steps.push({ type: 'unparkMount', required: true, timeout: mount.timeout, retry: mount.retry })
	if (cover.enabled && cover.openOnStartup) steps.push({ type: 'openCover', required: !cover.openBeforeCapture, timeout: cover.timeout, retry: cover.retry })
	if (cooling.enabled) steps.push({ type: 'coolCamera', required: true, timeout: cooling.timeout, retry: cooling.retry })
	if (guiding.enabled) steps.push({ type: 'startGuiding', required: true, timeout: guiding.settle.timeout, retry: guiding.retry })

	return steps
}

// Derives the shutdown pipeline from the equipment flags. The order is the reverse of startup, with the
// mount parked while the sky is still open and the camera warmed last.
function deriveShutdown(definition: Sequencer): SequencerDerivedLifecycle[] {
	if (!definition.shutdown.enabled) return []

	const { cooling, cover, guiding, mount, target } = definition
	const steps: SequencerDerivedLifecycle[] = []

	if (guiding.enabled && guiding.stopOnShutdown) steps.push({ type: 'stopGuiding', required: false, timeout: 0, retry: guiding.retry })
	if (target.tracking.enabled && target.tracking.stopOnShutdown) steps.push({ type: 'stopTracking', required: false, timeout: 0, retry: target.tracking.retry })
	if (cover.enabled && cover.closeOnShutdown) steps.push({ type: 'closeCover', required: false, timeout: cover.timeout, retry: cover.retry })
	if (mount.enabled && mount.parkOnShutdown) steps.push({ type: 'parkMount', required: false, timeout: mount.timeout, retry: mount.retry })
	if (cooling.enabled && cooling.warmOnShutdown) steps.push({ type: 'warmCamera', required: false, timeout: cooling.timeout, retry: cooling.retry })

	return steps
}

// Reduces the declared target pointing to radians. The recipe stores sexagesimal strings from the UI, or
// already-reduced angles in tests; numbers are left as radians, strings are parsed with RA as hours in the
// equatorial frames. Returns undefined when the active frame is missing or does not parse to a finite angle.
function targetCoordinates(target: SequencerTarget): MountTargetCoordinate<Angle> | undefined {
	const type = target.type
	const point = target[type]
	if (point === undefined) return undefined

	const hours = type === 'J2000' || type === 'JNOW' ? true : undefined
	const x = typeof point.x === 'string' ? parseAngle(point.x, hours) : point.x
	const y = typeof point.y === 'string' ? parseAngle(point.y) : point.y
	if (x === undefined || y === undefined) return undefined

	return { type, [type]: { x, y } }
}

// Lowers the centering of the target, or undefined when the target does not center. The coordinates are the
// ones the target points at, so the node carries the pointing the solved field is compared against.
function lowerCentering(definition: Sequencer): SequencerCenter | undefined {
	const { target } = definition

	if (!target.center.enabled) return undefined

	const { enabled, ...center } = target.center
	const rotator = definition.rotator.enabled && definition.rotator.moveBeforeCentering ? { angle: definition.rotator.angle, tolerance: definition.rotator.tolerance, settle: definition.rotator.settle } : undefined

	return { ...center, coordinates: targetCoordinates(target)!, rotator }
}

// Lowers the safe-point triggers of the capture loop, in the order they are evaluated before a frame: the
// flip first, because it invalidates the pointing everything else assumes; then autofocus, which needs the
// final pointing; then the dither, which is the last thing done before the exposure starts.
//
// `centering` is the lowered centering of the target, which the flip carries when it recenters.
function lowerTriggers(definition: Sequencer, targetId: string, centering: SequencerCenter | undefined): SequencerPlanAction[] {
	const { autofocus, dither, guiding, meridianFlip } = definition
	const triggers: SequencerPlanAction[] = []
	const { enabled: focusable, ...focusing } = autofocus

	// What the flip re-establishes is derived from the blocks that own those dimensions instead of being declared
	// a second time: the pointing is re-established when the target declares a centering, and the focus when the
	// autofocus block is enabled and asks to focus after a flip. A flag of its own would be a second source of
	// truth that can disagree with the block it depends on.
	if (meridianFlip.enabled) {
		const { enabled, ...flip } = meridianFlip
		const configuration: SequencerMeridianFlipTrigger = { ...flip, centering, focusing: focusable && autofocus.triggers.afterMeridianFlip ? focusing : undefined }
		triggers.push({ kind: 'action', id: sequencerNodeId.trigger(targetId, 'meridianFlip'), type: SEQUENCER_BLOCK_TYPE.meridianFlip, configuration })
	}

	if (focusable) {
		triggers.push({ kind: 'action', id: sequencerNodeId.trigger(targetId, 'autofocus'), type: SEQUENCER_BLOCK_TYPE.autofocus, configuration: focusing })
	}

	// The dither waits under the settle of the guiding session: a dither is a displacement of the guiding, and
	// a settle of its own would be a second policy for the same guider.
	if (dither.enabled) {
		const { enabled, ...policy } = dither
		const configuration: SequencerDitherTrigger = { ...policy, settle: guiding.settle }
		triggers.push({ kind: 'action', id: sequencerNodeId.trigger(targetId, 'dither'), type: SEQUENCER_BLOCK_TYPE.dither, configuration })
	}

	return triggers
}

// Lowers the optical-path policies every capture node of the plan is prepared against. A feature the
// definition disabled is dropped rather than carried disabled, so the preparation reads absence as "the
// session does not command this dimension" and never has to re-check a flag.
function lowerPreparation(definition: Sequencer): SequencerCapturePreparation {
	const { cover, flatPanel, rotator, cooling, autofocus } = definition

	return {
		cover: cover.enabled ? cover : undefined,
		flatPanel: flatPanel.enabled ? flatPanel : undefined,
		rotator: rotator.enabled ? rotator : undefined,
		cooling: cooling.enabled ? cooling : undefined,
		tracking: lowerTracking(definition),
		filterOffsets: autofocus.filterOffsets,
	}
}

// Lowers the target block: the slew, the optional centering, and the capture loop, in that order.
function lowerTarget(definition: Sequencer, groups: readonly SequencerPlanFrameGroup[]): SequencerPlanSequence {
	const { capture, target } = definition
	const id = sequencerNodeId.target(target.id)
	const children: SequencerPlanNode[] = []

	if (definition.devices.mount !== undefined) {
		const configuration: SequencerSlew = {
			coordinates: targetCoordinates(target)!,
			tracking: lowerTracking(definition),
			timeout: target.timeout,
			settle: target.settle,
			retry: target.retry,
		}
		children.push({ kind: 'action', id: sequencerNodeId.slew(target.id), type: SEQUENCER_BLOCK_TYPE.slew, configuration })
	}

	const centering = lowerCentering(definition)

	if (centering) {
		children.push({ kind: 'action', id: sequencerNodeId.center(target.id), type: SEQUENCER_BLOCK_TYPE.center, configuration: centering })
	}

	const preparation = lowerPreparation(definition)

	const frames = groups.map<SequencerPlanAction>((group) => {
		const configuration: SequencerCapture = { group, preparation }
		return { kind: 'action', id: group.nodeId, type: SEQUENCER_BLOCK_TYPE.captureFrame, configuration }
	})

	const body: SequencerPlanSequence = { kind: 'sequence', id: sequencerNodeId.captureCycle(target.id), children: [...lowerTriggers(definition, target.id, centering), ...frames] }

	children.push({ kind: 'loop', id: sequencerNodeId.captureLoop(target.id), repeat: capture.repeat, order: capture.order, groups, body })

	return { kind: 'sequence', id, children }
}

// Roles in the order of the role union, so the role list of a plan is comparable across compilations
// regardless of the order the features that need them were inspected in.
const SEQUENCER_ROLE_ORDER: readonly SequencerDeviceRole[] = ['camera', 'mount', 'wheel', 'focuser', 'rotator', 'guideCamera', 'guideOutput', 'cover', 'flatPanel', 'dome']

// One role the plan needs, together with the definition property that needs it, so a missing device can be
// reported against the feature that would have commanded it rather than against the device map alone.
interface RoleRequirement {
	// Role that must resolve to a device.
	readonly role: SequencerDeviceRole
	// Property path of the feature requiring it.
	readonly path: string
	// When true, the role is commanded only if the definition declares it. A missing device is then not a
	// refusal: the block runs without that dimension, which is how a field rig omits a cover or a panel.
	readonly optional?: boolean
}

// Collects every role the lowered plan commands. The camera is always required: a definition that exposes
// nothing is refused before this runs.
function roleRequirements(definition: Sequencer, groups: readonly SequencerPlanFrameGroup[]): RoleRequirement[] {
	const { autofocus, guiding, meridianFlip, mount, target } = definition
	const requirements: RoleRequirement[] = [{ role: 'camera', path: 'capture.frames' }]

	if (definition.devices.mount !== undefined) requirements.push({ role: 'mount', path: 'target' })
	if (target.tracking.enabled) requirements.push({ role: 'mount', path: 'target.tracking' })
	if (target.center.enabled) requirements.push({ role: 'mount', path: 'target.center' })
	if (meridianFlip.enabled) requirements.push({ role: 'mount', path: 'meridianFlip' })
	if (mount.enabled) requirements.push({ role: 'mount', path: 'mount' })
	if (definition.cover.enabled) requirements.push({ role: 'cover', path: 'cover' })
	if (definition.rotator.enabled) requirements.push({ role: 'rotator', path: 'rotator' })
	if (definition.flatPanel.enabled) requirements.push({ role: 'flatPanel', path: 'flatPanel' })
	if (groups.some((group) => group.filter !== undefined)) requirements.push({ role: 'wheel', path: 'capture.frames' })

	// An auxiliary capture selects its own filter, so it commands the wheel even when no frame group does.
	if (target.center.enabled && target.center.capture.filter !== undefined) requirements.push({ role: 'wheel', path: 'target.center.capture.filter' })

	if (autofocus.enabled) {
		requirements.push({ role: 'focuser', path: 'autofocus' })
		if (autofocus.capture.filter !== undefined) requirements.push({ role: 'wheel', path: 'autofocus.capture.filter' })
	}

	if (guiding.enabled && guiding.connection.mode === 'local') {
		requirements.push({ role: 'guideCamera', path: 'guiding.connection' })
		requirements.push({ role: 'guideOutput', path: 'guiding.connection' })
	}

	return requirements
}

// Reports every declared id that cannot address a node: an empty one produces an unaddressable node, and a
// repeated one produces two nodes with the same id, which makes the checkpoint of one the checkpoint of the
// other and the artifact of one overwrite the artifact of the other.
function checkUniqueIds(context: CompilerContext, items: readonly { readonly id: string }[], path: string, subject: string) {
	const seen = new Set<string>()

	for (let i = 0; i < items.length; i++) {
		const id = items[i].id

		if (id.length === 0) context.diagnostics.push({ path: `${path}[${i}].id`, message: `the ${subject} id is empty and cannot address a node` })
		else if (seen.has(id)) context.diagnostics.push({ path: `${path}[${i}].id`, message: `the ${subject} id "${id}" is declared more than once` })
		else seen.add(id)
	}
}

// Session segment the containment probe stands in for. The real one is derived from the session id at start,
// which the pure lowering does not have; any safe segment proves the same property, since containment depends
// on the shape of the composition and not on the value of that segment.
const SEQUENCER_PROBE_SEGMENT = 'session'

// Reports every value that reaches a path and could leave the directory the session owns.
//
// `storage.root`, both templates, the target id and the frame ids arrive over HTTP, and the ids are
// interpolated into the file name of every artifact, so a `..` or a separator in any of them addresses a
// directory the operator never approved. They are refused here, at the network boundary, which is where the
// validation doctrine of the project says to refuse them; the composed path is then proved contained rather
// than assumed to be.
function checkStorage(context: CompilerContext, definition: Sequencer) {
	const { capture, storage, target } = definition

	// An empty id is already reported as unaddressable, and reporting it twice would say nothing new.
	if (target.id.length > 0 && !isPathSegment(target.id)) context.diagnostics.push({ path: 'target.id', message: `the target id "${target.id}" contains a path separator or a relative segment and would escape the storage root` })

	for (let i = 0; i < capture.frames.length; i++) {
		const { id } = capture.frames[i]
		if (id.length > 0 && !isPathSegment(id)) context.diagnostics.push({ path: `capture.frames[${i}].id`, message: `the frame id "${id}" contains a path separator or a relative segment and would escape the storage root` })
	}

	const absolute = isAbsolute(storage.root)

	if (!absolute) context.diagnostics.push({ path: 'storage.root', message: `the storage root "${storage.root}" is not an absolute path` })
	if (storage.temporaryDirectory !== undefined && !isAbsolute(storage.temporaryDirectory)) context.diagnostics.push({ path: 'storage.temporaryDirectory', message: `the temporary directory "${storage.temporaryDirectory}" is not an absolute path` })

	const directories = sequencerPathSegments(storage.directoryTemplate)
	let composable = absolute

	for (const directory of directories) {
		if (!isPathSegment(directory)) {
			context.diagnostics.push({ path: 'storage.directoryTemplate', message: `the directory segment "${directory}" is a relative segment and would escape the session directory` })
			composable = false
		} else if (directory === SEQUENCER_AUXILIARY_SEGMENT) {
			// The reserved segment holds the images that fill no slot. A template writing frames into it would
			// mix them with images the reconciliation is meant to ignore, so it is refused while the operator is
			// still editing rather than at the first write.
			context.diagnostics.push({ path: 'storage.directoryTemplate', message: `the directory segment "${directory}" is reserved for the images that are not frames of the plan` })
			composable = false
		}
	}

	if (!isPathSegment(storage.fileNameTemplate)) {
		context.diagnostics.push({ path: 'storage.fileNameTemplate', message: `the file name template "${storage.fileNameTemplate}" is empty or contains a path separator, and the file name is a single segment` })
		composable = false
	}

	// A placeholder the renderer does not interpolate survives into the file name as literal text, so the
	// operator who asked for a value gets the word back and every frame of the group carries it.
	for (const [path, template] of [
		['storage.directoryTemplate', storage.directoryTemplate],
		['storage.fileNameTemplate', storage.fileNameTemplate],
	] as const) {
		for (const placeholder of sequencerUnknownPlaceholders(template)) {
			context.diagnostics.push({ path, message: `the placeholder "{${placeholder}}" is not interpolated, and it would be written into the path verbatim` })
		}
	}

	if (composable) {
		const probe = sequencerArtifactPath({ root: storage.root, session: SEQUENCER_PROBE_SEGMENT, night: SEQUENCER_PROBE_SEGMENT }, directories, storage.fileNameTemplate)
		if (!probe.ok) context.diagnostics.push({ path: 'storage.root', message: probe.reason })
	}
}

// Reports every required role the plan commands without a device declared for it.
//
// An optional binding is a device the block uses when the definition carries it. A definition without that
// role is a session that does not command it, which is what optional means at reservation time too.
function checkRoles(context: CompilerContext, definition: Sequencer, requirements: readonly RoleRequirement[]) {
	for (const requirement of requirements) {
		if (requirement.optional) continue
		if (definition.devices[requirement.role] === undefined) context.diagnostics.push({ path: `devices.${requirement.role}`, message: `${requirement.path} requires the ${requirement.role} role, which the definition does not declare` })
	}
}

// What validating the plan against a registry produced.
interface HandlerCheck {
	// Handler version per block type, recorded in the plan and demanded again at session start.
	readonly versions: Record<string, number>
	// Roles the handlers declared for their own configurations, addressed to the node that declared them.
	readonly requirements: readonly RoleRequirement[]
	// Configuration each handler returned, by node id, replacing the one the lowering produced.
	readonly configurations: Map<string, unknown>
}

// What the handlers returned, keyed by the node it belongs to, and applied to the plan afterwards.
interface Rewrite {
	// Configuration each handler returned, by node id.
	readonly configurations: ReadonlyMap<string, unknown>
	// Frame group each capture handler returned, by the node id of the capture action of the group. The
	// scheduler reads the group list of the loop while the capture action reads its own copy, so a group
	// rewritten in one place has to be rewritten in the other: two copies that disagree would schedule one
	// exposure and take another.
	readonly groups: ReadonlyMap<string, SequencerPlanFrameGroup>
}

// Frame group a capture handler returned, when its configuration still carries one.
//
// The capture block type is declared by this module, so a capture node holds a `SequencerCapture`; the value
// comes back from a handler that may have rebuilt it, so a returned object without a group is treated as a
// configuration the scheduler cannot follow and the compiler keeps its own group.
function capturedGroupOf(configuration: unknown): SequencerPlanFrameGroup | undefined {
	const group = (configuration as SequencerCapture | undefined)?.group
	return typeof group?.nodeId === 'string' ? group : undefined
}

// Restores the compiler-owned fields of a group a capture handler rebuilt, keeping everything else the
// handler returned.
//
// A handler normalizes how a group is captured: its camera settings, its spacing, the filter it selects. What
// the group is, and what it has to capture, is not its to change. The counters were derived from the
// definition and proved finite before any handler ran, so a returned `slotLimit` of `Infinity` would put an
// endless loop in the plan after every termination check had already passed. The count they were derived from
// is restored with them, and so is the exposure the projection is stated in, which keeps the group and its
// bounds describing the same capture.
//
// The two identifiers are restored for the same reason. `nodeId` is what ties the group to the capture action
// that produces it — it keys this rewrite, addresses the checkpoints and the artifacts of the group, and is
// the id the runtime reports progress under — and `id` is the frame id the definition declared and the
// storage path is composed from. A handler returning either one changed would hand the scheduler a group
// pointing at a node that does not run it.
function withCompilerOwned(captured: SequencerPlanFrameGroup, group: SequencerPlanFrameGroup): SequencerPlanFrameGroup {
	return { ...captured, id: group.id, nodeId: group.nodeId, exposureTime: group.exposureTime, count: group.count, requiredSlots: group.requiredSlots, abandonmentBudget: group.abandonmentBudget, slotLimit: group.slotLimit, projectedIntegration: group.projectedIntegration }
}

// Rebuilds a node with the configuration its handler returned in place of the one the lowering produced.
// Nodes the rewrite does not mention, and nodes whose handler returned its input unchanged, are returned as
// they are, so a compilation whose handlers normalize nothing allocates nothing.
function withConfigurations(node: SequencerPlanNode, rewrite: Rewrite): SequencerPlanNode {
	switch (node.kind) {
		case 'action': {
			if (!rewrite.configurations.has(node.id)) return node
			const configuration = rewrite.configurations.get(node.id)
			return configuration === node.configuration ? node : { ...node, configuration }
		}
		case 'sequence':
			return withConfigurationsIn(node, rewrite)
		case 'loop': {
			const body = withConfigurationsIn(node.body, rewrite)
			const groups = withGroups(node.groups, rewrite)
			return body === node.body && groups === node.groups ? node : { ...node, body, groups }
		}
	}
}

// Rebuilds a sequence with the rewritten children, preserving its identity when no child changed.
function withConfigurationsIn(sequence: SequencerPlanSequence, rewrite: Rewrite): SequencerPlanSequence {
	let changed = false
	const children: SequencerPlanNode[] = []

	for (const child of sequence.children) {
		const rewritten = withConfigurations(child, rewrite)
		changed ||= rewritten !== child
		children.push(rewritten)
	}

	return changed ? { ...sequence, children } : sequence
}

// Replaces every group by the one its capture handler returned, preserving the array when none changed.
function withGroups(groups: readonly SequencerPlanFrameGroup[], rewrite: Rewrite): readonly SequencerPlanFrameGroup[] {
	let changed = false
	const rewritten: SequencerPlanFrameGroup[] = []

	for (const group of groups) {
		const captured = rewrite.groups.get(group.nodeId) ?? group
		changed ||= captured !== group
		rewritten.push(captured)
	}

	return changed ? rewritten : groups
}

// Validates every action node against the handler registered for its block type, translating each issue into
// a diagnostic addressed to the node it came from. Without a registry the structural result stands on its
// own, which is what lets a definition be checked before the handlers of a session are wired.
//
// A handler also declares the roles its block commands, which the definition alone cannot know: the block
// type is a stable name and the code behind it may command a device no field of the definition mentions.
// Those roles join the ones the lowering derived, because the session reserves the union once at start and a
// role missing from it is a device the action later commands without holding it.
function checkHandlers(context: CompilerContext, registry: SequencerBlockRegistry, plan: SequencerPlan): HandlerCheck {
	const versions: Record<string, number> = Object.create(null)
	const requirements: RoleRequirement[] = []
	const configurations = new Map<string, unknown>()

	for (const node of sequencerPlanNodes(plan.root)) {
		if (node.kind !== 'action') continue

		const handler = registry.handler(node.type)

		if (!handler) {
			context.diagnostics.push({ path: node.id, message: `no handler is registered for the block type "${node.type}"` })
			continue
		}

		const result = handler.validate(node.configuration, { nodeId: node.id, devices: plan.devices })

		if (!result.ok) {
			for (const issue of result.issues) context.diagnostics.push({ path: issue.path.length > 0 ? `${node.id}.${issue.path}` : node.id, message: issue.message })
			continue
		}

		versions[node.type] = handler.version

		// `resources` and `execute` receive exactly what this handler's `validate` returned, which is the only
		// value they are specified against: a validator may normalize or rebuild its input, and the plan carries
		// the narrowed value rather than the one the lowering produced.
		configurations.set(node.id, result.configuration)

		for (const binding of handler.resources(result.configuration)) requirements.push({ role: binding.role, path: node.id, optional: binding.optional })
	}

	return { versions, requirements, configurations }
}

// Lowers the guider the session will create and own, or undefined when the plan does not guide.
//
// The session always creates and owns its guider session, and that is not a policy preference: the session
// reserves the logical keys of the guider at start, so a guider session already open holds a lease on exactly
// those keys and the reservation fails before any guiding policy is consulted.
function lowerGuider(definition: Sequencer) {
	const { guiding } = definition

	if (!guiding.enabled) return undefined

	return { connection: guiding.connection, calibrateBeforeStart: guiding.calibrateBeforeStart, recalibrateAfterMeridianFlip: guiding.recalibrateAfterMeridianFlip, settle: guiding.settle, retry: guiding.retry }
}

// Schema revision this compiler understands. A definition serialized against another revision may have moved
// a field this lowering reads, so it is refused instead of interpreted with the current reading.
const SEQUENCER_SCHEMA_VERSION = 1

// Failure reasons a retry cannot recover from. A disconnected or removed device is not a transient command
// failure: retrying only repeats it until the attempts are exhausted, because there is nowhere to wait for the
// device to come back — `waitingResources` is not part of this version.
const SEQUENCER_UNRECOVERABLE_REASON: ReadonlySet<SequencerFailureReason> = new Set(['disconnected', 'removed'])

// Checks one retry policy, addressed to the path that declared it.
//
// A policy retrying an unrecoverable reason and a policy suspending on exhaustion are both refused: the first
// would spend its whole budget repeating a failure that cannot succeed, and the second names a state this
// version never enters, so the definition would silently get another terminal action than the one it asked for.
//
// The attempt budget is bounded from above for the same reason the slot limit and the cycle count are: an
// attempt counter advances one failure at a time and stops changing above the safe range, so a budget beyond
// it never exhausts and the action retries a failing command without end.
function checkRetry(context: CompilerContext, retry: SequencerRetryPolicy, path: string) {
	for (const reason of retry.retryOn) {
		if (SEQUENCER_UNRECOVERABLE_REASON.has(reason)) context.diagnostics.push({ path: `${path}.retryOn`, message: `a "${reason}" failure ends the session instead of being retried, and retrying it would only repeat the same failure` })
	}

	if (retry.maxAttempts > Number.MAX_SAFE_INTEGER) context.diagnostics.push({ path: `${path}.maxAttempts`, message: 'the attempt budget is above the range a number counts one by one, so a counter of failed attempts would stop advancing before exhausting it' })
	if (retry.onExhausted === 'suspend') context.diagnostics.push({ path: `${path}.onExhausted`, message: 'this version has no suspended state to exhaust a policy into' })
}

// Checks the attempt budget of an operation that repeats itself until it succeeds, addressed to the path that
// declared it.
//
// This is the bound of `checkRetry` applied to the counters a handler keeps on its own: a centering loop
// solves, corrects and solves again, and a flip repeats the crossing, each counting one attempt at a time. A
// budget above the safe range stops changing when it is incremented, so the loop never reaches it and the
// operation repeats a failing command for the rest of the night.
function checkAttempts(context: CompilerContext, maximumAttempts: number, path: string) {
	if (maximumAttempts > Number.MAX_SAFE_INTEGER) context.diagnostics.push({ path, message: 'the attempt budget is above the range a number counts one by one, so a counter of failed attempts would stop advancing before exhausting it' })
}

// Checks the decision a feature applies when it cannot recover, addressed to the path that declared it.
//
// `suspend` is refused for the same reason `onExhausted: 'suspend'` is: the session has no suspended state to
// move into, so the definition would silently get another terminal decision than the one it declared. The
// other members are carried into the configuration of the block and honored by its handler.
function checkOnFailure(context: CompilerContext, onFailure: 'continue' | 'pause' | 'suspend' | 'stop' | 'fail', path: string) {
	if (onFailure === 'suspend') context.diagnostics.push({ path, message: 'this version has no suspended state to move the session into' })
}

// Checks every failure policy of the definition, the attempt budgets of the operations that repeat
// themselves, and the meridian flip window.
//
// The retry policies of a disabled block are deliberately not checked: a block this version refuses when it is
// enabled has nothing to execute, so the policy it declares is inert and reporting it would address the
// operator to a field that changes nothing.
function checkPolicies(context: CompilerContext, definition: Sequencer) {
	const { autofocus, capture, cooling, cover, dither, execution, guiding, meridianFlip, mount, target } = definition

	checkRetry(context, execution.defaultRetry, 'execution.defaultRetry')
	checkRetry(context, capture.retry, 'capture.retry')
	if (definition.devices.mount !== undefined) checkRetry(context, target.retry, 'target.retry')
	if (target.tracking.enabled) checkRetry(context, target.tracking.retry, 'target.tracking.retry')
	if (target.center.enabled) {
		checkRetry(context, target.center.retry, 'target.center.retry')
		checkAttempts(context, target.center.maximumAttempts, 'target.center.maximumAttempts')
	}

	if (guiding.enabled) checkRetry(context, guiding.retry, 'guiding.retry')
	if (mount.enabled) checkRetry(context, mount.retry, 'mount.retry')
	if (cooling.enabled) checkRetry(context, cooling.retry, 'cooling.retry')
	if (cover.enabled) checkRetry(context, cover.retry, 'cover.retry')
	if (dither.enabled) {
		checkRetry(context, dither.retry, 'dither.retry')
		checkOnFailure(context, dither.onFailure, 'dither.onFailure')
		// `onFailure` is the terminal decision of this feature (§10). Leaving `onExhausted` in the executable
		// plan would be the silent acceptance the compatibility rule forbids: `onExhausted: 'fail'` next to
		// `onFailure: 'continue'` would look like a night-ending policy and never end the night.
		context.removals.push({ path: 'dither.retry.onExhausted', reason: 'onFailure is the terminal decision of this feature, so onExhausted is not consulted' })
	}

	if (autofocus.enabled) {
		checkRetry(context, autofocus.retry, 'autofocus.retry')
		checkOnFailure(context, autofocus.onFailure, 'autofocus.onFailure')
		context.removals.push({ path: 'autofocus.retry.onExhausted', reason: 'onFailure is the terminal decision of this feature, so onExhausted is not consulted' })
	}

	if (meridianFlip.enabled) {
		checkRetry(context, meridianFlip.retry, 'meridianFlip.retry')
		checkOnFailure(context, meridianFlip.onFailure, 'meridianFlip.onFailure')
		context.removals.push({ path: 'meridianFlip.retry.onExhausted', reason: 'onFailure is the terminal decision of this feature, so onExhausted is not consulted' })

		// An empty window leaves the safe point with no hour angle at which an exposure may resume: the pre-exposure
		// guard already refuses to start and the flip is not permitted yet, which is a wait that never ends.
		if (meridianFlip.maximumHourAngle < meridianFlip.minimumHourAngle) context.diagnostics.push({ path: 'meridianFlip.maximumHourAngle', message: 'the flip window is empty, because it ends before the hour angle it may start at' })
	}
}

// Reports every declared field this version does not execute.
//
// The compatibility rule is that a declared configuration is never silently ignored: a field the runtime does
// not execute either refuses the definition, addressed to the exact property that declared it, or is removed
// from the executable plan and the removal is reported. Accepting a field and doing nothing with it is the one
// outcome the rule forbids, because it produces a session that quietly disagrees with the definition the
// operator wrote, and the disagreement is only discovered from the result of a night.
//
// Rejection is the default and removal is reserved for a field that is inert: the two removals below change
// nothing about what the session does, while everything rejected here would change what it does.
function checkCompatibility(context: CompilerContext, definition: Sequencer) {
	const { capture, cooling, cover, dither, dome, execution, flatPanel, guiding, monitoring, notification, quality, rotator, safety, startup, target } = definition
	const { diagnostics, removals } = context

	if (definition.schemaVersion !== SEQUENCER_SCHEMA_VERSION) diagnostics.push({ path: 'schemaVersion', message: `the definition declares schema version ${definition.schemaVersion}, and this version compiles ${SEQUENCER_SCHEMA_VERSION}` })

	if (target.constraints.enabled) diagnostics.push({ path: 'target.constraints.enabled', message: 'target constraints require the ephemeris and the monitor lane this version does not have' })

	// The capture order selects the scheduler implementation, and this version implements the sequential one
	// only. Lowering another order would produce a plan captured in an order other than the one that was asked
	// for, which is the silent acceptance the compatibility rule forbids.
	if (capture.order !== 'sequential') diagnostics.push({ path: 'capture.order', message: 'this version schedules frames in the declaration order of the groups, so no other capture order is executed' })

	// Weight is the input of the weighted round-robin order, and the sequential scheduler never reads it.
	// Equal weight is the sequential equivalent and is consumed honestly; any other value would change which
	// group is selected next if it were honored, and accepting it here would be the silent disagreement the
	// compatibility rule exists to prevent.
	for (let i = 0; i < capture.frames.length; i++) {
		const frame = capture.frames[i]

		if (frame.enabled && frame.weight !== 1) diagnostics.push({ path: `capture.frames[${i}].weight`, message: 'this version schedules frames in the declaration order of the groups, so a weight other than 1 is not executed' })
	}

	if (capture.continueAfterRejectedFrame) removals.push({ path: 'capture.continueAfterRejectedFrame', reason: 'quality evaluation is not executed, so no frame is ever rejected and the flag has no path to take effect' })

	if (guiding.thresholds.enabled) diagnostics.push({ path: 'guiding.thresholds.enabled', message: 'guiding thresholds require the continuous monitor lane this version does not have' })
	if (guiding.recovery.enabled) diagnostics.push({ path: 'guiding.recovery.enabled', message: 'guiding recovery requires the continuous monitor lane this version does not have' })
	// The interlock of each safe point is what puts the corrections back after a suspension, and a pause
	// re-enters that same safe point. There is no second restore path for an interruption that stopped the
	// guider itself, so the flag would change nothing about the night whether it is set or not.
	if (guiding.enabled) removals.push({ path: 'guiding.restoreAfterInterruption', reason: 'guiding is resumed by the interlock of each safe point, so a restore-after-interruption flag has no path of its own' })
	if (!guiding.enabled && dither.enabled) diagnostics.push({ path: 'dither.enabled', message: 'a dither is a guider command, and the definition declares no guider to send it to' })

	// The runtime opens the guider session before the plan, but opening is a connection and not a correction:
	// nothing calibrates, nothing loops and nothing guides until the derived startup step commands it. The
	// interlock brackets a guider that is running and leaves an idle one alone precisely because a session that
	// never issued `startGuiding` is unguided by configuration, and the dither is skipped for the same reason.
	// So an enabled guiding block with the startup pipeline disarmed captures every frame unguided while
	// reporting a guided plan, which is the silent disagreement the compatibility rule exists to prevent.
	if (guiding.enabled && !startup.enabled) diagnostics.push({ path: 'guiding.enabled', message: 'the guiding block declares the guider the capture runs under, and the startup pipeline that starts it is disabled, so every frame would be captured unguided' })

	if (dome.enabled) diagnostics.push({ path: 'dome.enabled', message: 'the device layer of this version has no dome' })
	if (cover.enabled && cover.closeOnUnsafe) diagnostics.push({ path: 'cover.closeOnUnsafe', message: 'closing the cover on an unsafe condition requires the safety monitor this version does not have' })
	if (rotator.enabled && rotator.restoreAfterMeridianFlip) diagnostics.push({ path: 'rotator.restoreAfterMeridianFlip', message: 'restoring the rotator after a flip is not commanded, so the flag would change nothing about the night' })
	if (rotator.enabled && rotator.reverse) diagnostics.push({ path: 'rotator.reverse', message: 'the rotator is commanded to the declared angle, so reversing it would change nothing about the night' })

	// Cooling to the capture setpoint is implied by the cooling block being enabled, and it is the startup
	// pipeline that commands it. A disabled startup leaves the setpoint at whatever the sensor already is, which
	// is the same session as no cooling at all.
	if (cooling.enabled && !startup.enabled) diagnostics.push({ path: 'cooling.enabled', message: 'the cooling block declares the temperature the capture runs at, and the startup pipeline that cools the camera to it is disabled, so the session would capture at whatever temperature the sensor is already at' })

	if (monitoring.enabled) diagnostics.push({ path: 'monitoring.enabled', message: 'the monitor lane is not part of this version' })
	if (safety.enabled) diagnostics.push({ path: 'safety.enabled', message: 'there is no safety monitor in this version' })
	if (quality.enabled) diagnostics.push({ path: 'quality.enabled', message: 'frame quality evaluation is not part of this version' })
	if (notification.enabled) removals.push({ path: 'notification', reason: 'notifications are delivered by channel adapters over the session events, outside the executable plan' })

	if (execution.start.type === 'sunAltitude' || execution.start.type === 'targetAltitude') diagnostics.push({ path: 'execution.start.type', message: `starting on ${execution.start.type} requires the ephemeris this version does not compute` })
	if (execution.end.type === 'sunAltitude' || execution.end.type === 'targetAltitude') diagnostics.push({ path: 'execution.end.type', message: `ending on ${execution.end.type} requires the ephemeris this version does not compute` })
}

// Deduplicates the required roles and returns them in the fixed role order, which is what the session
// reserves at start. Two features requiring the same role reserve it once.
function rolesOf(requirements: readonly RoleRequirement[], devices: SequencerDevices): SequencerDeviceRole[] {
	const selected = new Set<SequencerDeviceRole>()

	for (const requirement of requirements) {
		if (requirement.optional && devices[requirement.role] === undefined) continue
		selected.add(requirement.role)
	}

	return SEQUENCER_ROLE_ORDER.filter((role) => selected.has(role))
}

// Options of a compilation, all of them optional so a definition can be checked before a session exists.
export interface SequencerCompilerOptions {
	// Registry validating the configuration of every action node against the handler that will execute it.
	// Without it the compilation checks only what the definition itself can answer, which is what lets the
	// pre-flight endpoint validate a definition without wiring the handlers of a session.
	readonly registry?: SequencerBlockRegistry
}

// Lowers a definition into the plan a session executes.
//
// Returns the plan and the fields observably dropped from it, or every diagnostic that prevented the
// lowering. The definition is not mutated and nothing outside it is read, so the result depends only on the
// arguments.
export function compile(definition: Sequencer, options?: SequencerCompilerOptions): SequencerCompilation {
	const context: CompilerContext = { diagnostics: [], removals: [] }
	const { capture, shutdown, startup, storage, target } = definition

	const groups: SequencerPlanFrameGroup[] = []

	checkTermination(context, definition)

	for (const frame of capture.frames) {
		if (frameGroupEnabled(frame)) groups.push(lowerFrameGroup(definition, frame))
	}

	checkUniqueIds(context, capture.frames, 'capture.frames', 'frame')

	if (target.id.length === 0) context.diagnostics.push({ path: 'target.id', message: 'the target id is empty and cannot address a node' })
	// The coordinate of the declared frame is optional in the transport type, and only a pointing action reads
	// it: without it the slew would be commanded with an undefined right ascension and declination. Sexagesimal
	// strings from the UI must parse to a finite angle; an unreadable token would otherwise become NaN in the
	// plan and look like a pointing the mount can execute.
	if (definition.devices.mount !== undefined || target.center.enabled) {
		if (target[target.type] === undefined) context.diagnostics.push({ path: `target.${target.type}`, message: `the target points in ${target.type} and declares no ${target.type} coordinate to point at` })
		else if (targetCoordinates(target) === undefined) context.diagnostics.push({ path: `target.${target.type}`, message: `the ${target.type} coordinate is not a finite angle the session can point at` })
	}
	if (groups.length === 0) context.diagnostics.push({ path: 'capture.frames', message: 'the definition has no enabled frame group to capture' })

	checkStorage(context, definition)
	checkPolicies(context, definition)
	checkCompatibility(context, definition)

	if (context.diagnostics.length > 0) return { ok: false, diagnostics: context.diagnostics }

	const children: SequencerPlanNode[] = []
	const cooling = definition.cooling.enabled ? definition.cooling : undefined
	const tracking = lowerTracking(definition)
	const guider = lowerGuider(definition)
	// Only what the start of the guiding establishes reaches the node: the calibration it runs under, the settle
	// it installs on the guider session for the rest of the night, and — for a guider this session owns — the
	// recipe its guide camera exposes with. The rest of the guider is the connection and the policy the session
	// itself commands through, and copying it into every guiding action would carry a second, staler authority
	// for what the plan already states once. A remote guider exposes under the program that runs it, so it
	// carries no recipe of ours.
	const guiding = guider === undefined ? undefined : { calibrateBeforeStart: guider.calibrateBeforeStart, settle: guider.settle, capture: guider.connection.mode === 'local' ? guider.connection.capture : undefined }
	const lowered = lowerPipeline('startup', deriveStartup(definition), cooling, tracking, guiding)
	const finalized = lowerPipeline('finalize', deriveShutdown(definition), cooling, tracking, guiding)

	if (lowered) children.push(lowered)
	children.push(lowerTarget(definition, groups))
	if (finalized) children.push(finalized)

	const runOn: ('completed' | 'stopped' | 'failed')[] = []

	if (shutdown.runOnCompletion) runOn.push('completed')
	if (shutdown.runOnStop) runOn.push('stopped')
	if (shutdown.runOnFailure) runOn.push('failed')

	const requirements = roleRequirements(definition, groups)

	const plan: SequencerPlan = {
		definitionId: definition.id ?? '',
		definitionRevision: definition.revision ?? 0,
		name: definition.name,
		target: { id: target.id, name: target.name },
		execution: { start: definition.execution.start, end: definition.execution.end, pauseMode: definition.execution.pauseMode, stopMode: definition.execution.stopMode, defaultRetry: definition.execution.defaultRetry, checkpoint: definition.execution.checkpoint },
		devices: definition.devices,
		roles: rolesOf(requirements, definition.devices),
		root: { kind: 'sequence', id: sequencerNodeId.root(), children },
		groups,
		startup: lowered && { continueOnFailure: startup.continueOnFailure },
		finalize: finalized && { continueOnFailure: shutdown.continueOnFailure, runOn },
		guider,
		cooling,
		storage: { root: storage.root, fileNameTemplate: storage.fileNameTemplate, directoryTemplate: storage.directoryTemplate, temporaryDirectory: storage.temporaryDirectory, autoSubFolderMode: storage.autoSubFolderMode },
	}

	// The handlers run before the roles are checked, because a role a handler declares is as required as one
	// the lowering derived, and reporting a device missing for it is the same diagnostic.
	const handlers = options?.registry && checkHandlers(context, options.registry, plan)

	if (handlers) {
		for (const requirement of handlers.requirements) requirements.push(requirement)
	}

	checkRoles(context, definition, requirements)

	if (context.diagnostics.length > 0) return { ok: false, diagnostics: context.diagnostics }

	if (!handlers) return { ok: true, plan, removals: context.removals }

	const rewritten = new Map<string, SequencerPlanFrameGroup>()
	const configurations = new Map(handlers.configurations)

	// The corrected group replaces the returned one in both places it lives: the group list the scheduler reads
	// and the configuration the capture action carries, which are required to agree.
	for (const group of groups) {
		const configuration = configurations.get(group.nodeId)
		const captured = capturedGroupOf(configuration)

		if (captured === undefined) continue

		const corrected = withCompilerOwned(captured, group)

		rewritten.set(group.nodeId, corrected)
		configurations.set(group.nodeId, { ...(configuration as SequencerCapture), group: corrected })
	}

	const rewrite: Rewrite = { configurations, groups: rewritten }

	return { ok: true, plan: { ...plan, roles: rolesOf(requirements, definition.devices), root: withConfigurationsIn(plan.root, rewrite), groups: withGroups(groups, rewrite), handlers: handlers.versions }, removals: context.removals }
}
