import type { CameraTransferFormat, FrameType } from 'nebulosa/src/devices/indi/device'
// oxfmt-ignore
import type { SequencerCamera, SequencerCapture, SequencerCheckpoint, SequencerCooling, SequencerDeviceRole, SequencerDevices, SequencerEndCondition, SequencerExecution, SequencerFilterReference, SequencerGuiderSettle, SequencerLocalGuider, SequencerRemoteGuider, SequencerRetryPolicy, SequencerStartCondition, SequencerStorage } from './sequencer'

// Executable plan produced by lowering a definition, and the diagnostics that lowering emits instead of a
// plan. The definition in `sequencer.ts` is declarative and per feature; this is the node tree the runtime
// walks, and it is the only shape the runtime ever sees.
//
// Everything here is serializable and total: a value the definition leaves optional arrives resolved, so no
// node carries a decision the runtime would have to make again. Angles are radians, durations are seconds,
// and temperatures are degrees Celsius, following the definition they come from.

// Kinds of node the V1 plan is built from. There is no `parallel`: the V1 runtime is serialized, and a node
// no lowering produces would be executed by no code.
export type SequencerPlanNodeKind = 'sequence' | 'action' | 'loop'

// One node of the plan tree.
export type SequencerPlanNode = SequencerPlanSequence | SequencerPlanAction | SequencerPlanLoop

// Ordered container executing its children once, in order.
export interface SequencerPlanSequence {
	// Discriminator of the node union.
	readonly kind: 'sequence'
	// Node identity, derived from the definition path and stable across compilations.
	readonly id: string
	// Children executed in array order.
	readonly children: readonly SequencerPlanNode[]
}

// Leaf node executed by the handler registered for its block type.
export interface SequencerPlanAction {
	// Discriminator of the node union.
	readonly kind: 'action'
	// Node identity, derived from the definition path and stable across compilations.
	readonly id: string
	// Block type resolved through the registry.
	readonly type: string
	// Block configuration, already resolved by the lowering and validated by the handler.
	readonly configuration: unknown
}

// State-driven repetition of the capture body. The number of frames is not known at compile time: it depends
// on how many were accepted, which is why this is a loop and not an unrolled list of actions.
export interface SequencerPlanLoop {
	// Discriminator of the node union.
	readonly kind: 'loop'
	// Node identity, derived from the definition path and stable across compilations.
	readonly id: string
	// Complete passes over the frame groups; always >= 1, since a zero-cycle plan captures nothing.
	readonly repeat: number
	// Scheduling strategy selecting which group provides the next frame.
	readonly order: SequencerCapture['order']
	// Normalized frame groups the scheduler operates on, in declaration order.
	readonly groups: readonly SequencerPlanFrameGroup[]
	// One iteration of the loop: the safe-point triggers followed by the frame actions.
	readonly body: SequencerPlanSequence
}

// One normalized frame group, which is what the scheduler and the termination proof operate on.
export interface SequencerPlanFrameGroup {
	// Frame id as declared, unique within the capture plan.
	readonly id: string
	// Human-readable label of the group, carried so the pre-flight view names a group the same way the editor
	// does instead of showing the id it addresses nodes with.
	readonly name: string
	// Node id of the capture action of this group.
	readonly nodeId: string
	// Frame classification written to the image metadata.
	readonly frameType: FrameType
	// Exposure duration of every frame of the group, in seconds.
	readonly exposureTime: number
	// Requested number of accepted frames per cycle; 0 disables the frame-count criterion.
	readonly count: number
	// Requested accumulated accepted exposure time per cycle, in seconds; 0 disables the criterion.
	readonly integrationTime: number
	// Minimum spacing between the end of one exposure and the start of the next, in seconds. Resolved from
	// the frame delay when declared and from the capture delay otherwise, so the runtime never sees undefined.
	readonly delay: number
	// Relative scheduling weight used by the weighted round-robin order.
	readonly weight: number
	// Filter the group requires, absent when the group does not command the wheel.
	readonly filter?: SequencerFilterReference
	// Camera settings of the group, with the per-frame overrides already applied over the capture defaults.
	readonly camera: SequencerCamera
	// Failure policy of the capture action, which is also the attempt budget of every slot of the group.
	readonly retry: SequencerRetryPolicy
	// Slots the group needs to reach its target in one cycle, derived from whichever completion criteria are
	// active; always >= 1, since a group needing no slot is a disabled group and never reaches the plan.
	readonly requiredSlots: number
	// Extra slots the group may spend on abandoned exposures and still reach its target, `0` when the
	// definition declares none. It is slack, not a stop trigger: it never ends the group by itself.
	readonly abandonmentBudget: number
	// Hard ceiling on the slots the scheduler may emit for the group in one cycle, `requiredSlots +
	// abandonmentBudget`. Together with `retry.maxAttempts` it bounds the exposures of one autonomous cycle
	// by `slotLimit × retry.maxAttempts`, which is what makes the capture loop provably terminate.
	readonly slotLimit: number
	// Accepted exposure time the group produces in one cycle when every required slot is accepted, in
	// seconds. It is the honest projection of the plan, not a promise: abandoned slots reduce it.
	readonly projectedIntegration: number
}

// Ordered lifecycle pipeline executed once per session, as a sibling of the target block.
export interface SequencerPlanPipeline {
	// Whether a failing optional action lets the remaining ones execute.
	readonly continueOnFailure: boolean
}

// Terminal pipeline, which additionally selects the states it runs for.
export interface SequencerPlanFinalize extends SequencerPlanPipeline {
	// Terminal states that trigger the pipeline.
	readonly runOn: readonly ('completed' | 'stopped' | 'failed')[]
}

// Target the plan observes, which in V1 is exactly one.
export interface SequencerPlanTarget {
	// Target id as declared, which is also the segment every node below the target block carries.
	readonly id: string
	// Human-readable label of the target, carried for the pre-flight view and the session snapshot.
	readonly name: string
}

// Guider the session creates and owns, with the policy every guiding command runs under. The connection is
// part of the plan because the session reserves the logical keys of that guider at start, before any guiding
// command, and the policy travels with it so no handler has to read the definition again.
export interface SequencerPlanGuider {
	// How the session reaches the guider. V1 always creates and owns the session.
	readonly connection: SequencerRemoteGuider | SequencerLocalGuider
	// Whether guiding calibrates before the first exposure of the session.
	readonly calibrateBeforeStart: boolean
	// Whether guiding recalibrates after a meridian flip, where the calibration no longer matches the sky.
	readonly recalibrateAfterMeridianFlip: boolean
	// Whether guiding is restored after an interruption that stopped it.
	readonly restoreAfterInterruption: boolean
	// Settling required after guiding starts or resumes, before an exposure may begin.
	readonly settle: SequencerGuiderSettle
	// Failure policy of the guiding commands.
	readonly retry: SequencerRetryPolicy
}

// Execution policy of the session: when it may start and end, how it reacts to a pause or a stop, and how
// often it checkpoints. It is snapshotted with the plan so an edit to the definition does not change the
// semantics of a session already running.
export interface SequencerPlanExecution {
	// Condition allowing the session to start.
	readonly start: SequencerStartCondition
	// Condition ending the session.
	readonly end: SequencerEndCondition
	// Where a pause takes effect.
	readonly pauseMode: SequencerExecution['pauseMode']
	// Whether a stop finishes the current work or interrupts it.
	readonly stopMode: SequencerExecution['stopMode']
	// Failure policy applied to an action that declares none.
	readonly defaultRetry: SequencerRetryPolicy
	// When durable checkpoints are written.
	readonly checkpoint: SequencerCheckpoint
}

// Storage decisions the plan carries, already checked for containment under the root.
export interface SequencerPlanStorage {
	// Root directory every artifact of the session is written below.
	readonly root: string
	// Template of the readable part of the file name.
	readonly fileNameTemplate: string
	// Template of the directories created below the session segment.
	readonly directoryTemplate: string
	// Directory of the temporary file of the atomic write, when the definition declares one.
	readonly temporaryDirectory?: string
	// Boundary of the automatic per-night subdirectory, resolved once at session start.
	readonly autoSubFolderMode: SequencerStorage['autoSubFolderMode']
}

// Everything a session executes, snapshotted at compilation and immutable for its whole life.
export interface SequencerPlan {
	// Definition the plan was lowered from.
	readonly definitionId: string
	// Definition revision snapshotted for the session; a later edit does not affect a running one.
	readonly definitionRevision: number
	// Human-readable name of the definition, shown wherever a session is listed.
	readonly name: string
	// Target the session observes.
	readonly target: SequencerPlanTarget
	// Execution policy of the session.
	readonly execution: SequencerPlanExecution
	// Device id per role declared by the definition.
	readonly devices: SequencerDevices
	// Roles the plan actually commands, which is what the session reserves at start.
	readonly roles: readonly SequencerDeviceRole[]
	// Root of the node tree, whose children are the startup, target, and finalize blocks.
	readonly root: SequencerPlanSequence
	// Every frame group of the plan, flattened for the pre-flight view.
	readonly groups: readonly SequencerPlanFrameGroup[]
	// Startup pipeline policy; absent when the definition declares no startup action to run.
	readonly startup?: SequencerPlanPipeline
	// Finalize pipeline policy; absent when the definition declares no terminal action to run.
	readonly finalize?: SequencerPlanFinalize
	// Guider the session creates and owns, absent when the plan does not guide.
	readonly guider?: SequencerPlanGuider
	// Cooling policy the camera is held at, absent when the definition does not cool. The cooling and warming
	// lifecycle actions declare no temperature of their own, so this is where they read it from.
	readonly cooling?: SequencerCooling
	// Handler version per block type, recorded when the compilation resolved the registry. The session start
	// demands the same versions again, because a handler can be registered, replaced, or removed between
	// validating a definition and running it, and a version that changed means the block no longer does what
	// the plan was compiled against. Absent when the definition was compiled without a registry, which is the
	// pre-flight compilation: such a plan is refused at session start, because a handler that was never asked
	// also never declared the roles its block commands.
	readonly handlers?: Readonly<Record<string, number>>
	// Storage decisions of the session.
	readonly storage: SequencerPlanStorage
}

// One reason a definition could not be lowered, addressed to the exact property that caused it.
export interface SequencerDiagnostic {
	// Property path within the definition, such as `capture.frames[1].exposureTime`.
	readonly path: string
	// What is wrong with the value, phrased for the operator editing the definition.
	readonly message: string
}

// One field the compiler accepted but deliberately did not lower, reported so the operator can see that the
// declared configuration has no effect instead of discovering it from the result of a night.
export interface SequencerRemoval {
	// Property path within the definition that was dropped.
	readonly path: string
	// Why the field has no effect in this version.
	readonly reason: string
}

// Outcome of compiling a definition. A failure carries no plan at all: lowering is total, so it either
// produces something executable or explains every reason it could not.
export type SequencerCompilation =
	| {
			readonly ok: true
			// Plan the session executes.
			readonly plan: SequencerPlan
			// Fields observably dropped from the executable plan.
			readonly removals: readonly SequencerRemoval[]
	  }
	| {
			readonly ok: false
			// Every reason the definition was refused, in definition order.
			readonly diagnostics: readonly SequencerDiagnostic[]
	  }

// One frame group as the pre-flight view reports it. Every number is per cycle, which is the unit the
// termination proof is stated in; the session totals are on the view itself.
export interface SequencerPreflightGroup {
	// Frame group the numbers belong to.
	readonly id: string
	// Human-readable label of the group, as the editor shows it.
	readonly name: string
	// Frame classification of the group.
	readonly frameType: FrameType
	// Exposure duration of every frame of the group, in seconds.
	readonly exposureTime: number
	// Slots the group needs to reach its target in one cycle.
	readonly requiredSlots: number
	// Extra slots the group may spend on abandoned exposures in one cycle.
	readonly abandonmentBudget: number
	// Hard ceiling on the slots the scheduler may emit for the group in one cycle.
	readonly slotLimit: number
	// Accepted exposure time of one cycle when every required slot is accepted, in seconds.
	readonly projectedIntegration: number
}

// Everything a definition tells about itself before it runs: why it was refused, what was dropped from it,
// and how much of the night it asks for. It is the answer of `validate`, of the compilation event, and of
// the plan of a session, so the operator compares what was written against what was compiled instead of
// discovering the difference from the result of a night.
export interface SequencerPreflight {
	// Whether the definition lowered into an executable plan.
	readonly ok: boolean
	// Every reason the definition was refused, empty when it compiled.
	readonly diagnostics: readonly SequencerDiagnostic[]
	// Fields accepted but observably dropped from the executable plan.
	readonly removals: readonly SequencerRemoval[]
	// Complete passes over the frame groups, `0` when the definition was refused.
	readonly repeat: number
	// Per-cycle numbers of every frame group, in declaration order.
	readonly groups: readonly SequencerPreflightGroup[]
	// Slots the full sequence needs, `repeat` times the required slots of every group. It is an upper bound:
	// an end condition may stop the session earlier, and `integrationLimit` reports the one that is known
	// before the session runs.
	readonly requiredSlots: number
	// Slots the full sequence may emit at most, `repeat` times the slot limit of every group. With the
	// attempt budget of each group it is the bound that makes the capture loop provably terminate.
	readonly slotLimit: number
	// Accepted exposure time of the full sequence when every required slot is accepted, in seconds. It is a
	// projection, not a promise: abandoned slots reduce it and an end condition may stop the session before
	// the sequence completes.
	readonly projectedIntegration: number
	// Accumulated integration that ends the session, in seconds, when it ends on integration time; absent for
	// every other end condition. Below `projectedIntegration` it is the limit the session actually reaches,
	// which is what keeps the totals above readable as the upper bound they are.
	readonly integrationLimit?: number
	// Roles the session reserves at start, empty when the definition was refused.
	readonly roles: readonly SequencerDeviceRole[]
}

// Transfer format of a plan camera setting, re-exported so consumers of the plan do not have to reach into
// the device layer for the type of a field they read.
export type SequencerPlanTransferFormat = CameraTransferFormat
