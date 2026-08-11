import type { Angle } from 'nebulosa/src/math/units/angle'
import type { Sequencer, SequencerAutofocus, SequencerCameraSettings, SequencerCentering, SequencerDeviceRole, SequencerDither, SequencerFrame, SequencerGoto, SequencerLifecycleAction, SequencerMeridianFlip, SequencerRetryPolicy, SequencerTarget, SequencerTargetTracking } from '#/sequencer'
import type { SequencerCompilation, SequencerDiagnostic, SequencerPlan, SequencerPlanAction, SequencerPlanFrameGroup, SequencerPlanNode, SequencerPlanSequence, SequencerRemoval } from '#/sequencer.plan'

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

// Target coordinates as the slew and centering actions receive them: the coordinate pair of the declared
// frame and nothing else, so no action has to know about tracking, centering, or constraints to point.
export type SequencerPlanCoordinates =
	| {
			// Equatorial frame the pair is expressed in.
			readonly coordinateType: 'JNOW' | 'J2000'
			// Right ascension, radians normalized to [0, 2π).
			readonly rightAscension: Angle
			// Declination, radians in [-π/2, π/2].
			readonly declination: Angle
	  }
	| {
			// Local horizontal frame.
			readonly coordinateType: 'ALTAZ'
			// Azimuth, radians normalized to [0, 2π).
			readonly azimuth: Angle
			// Altitude above the astronomical horizon, radians in [-π/2, π/2].
			readonly altitude: Angle
	  }
	| {
			// Ecliptic or galactic frame, which share the longitude/latitude pair.
			readonly coordinateType: 'ECLIPTIC' | 'GALACTIC'
			// Longitude, radians normalized to [0, 2π).
			readonly longitude: Angle
			// Latitude, radians in [-π/2, π/2].
			readonly latitude: Angle
	  }

// Configuration of the slew action, with the tracking policy the mount must hold once it arrives.
export interface SequencerSlewConfiguration extends Omit<SequencerGoto, 'enabled'> {
	// Where to point.
	readonly coordinates: SequencerPlanCoordinates
	// Tracking to establish after arrival, absent when the target does not command tracking.
	readonly tracking?: Omit<SequencerTargetTracking, 'enabled'>
}

// Configuration of the centering action.
export interface SequencerCenterConfiguration extends Omit<SequencerCentering, 'enabled'> {
	// Coordinates the solved field is compared against.
	readonly coordinates: SequencerPlanCoordinates
}

// Configuration of one capture action, which is the frame group plus the settling the capture plan requires
// before an exposure starts.
export interface SequencerCaptureConfiguration {
	// Group this action exposes for.
	readonly group: SequencerPlanFrameGroup
	// Stable time required before the first or a resumed exposure, in seconds.
	readonly settle: number
}

// Configuration of the autofocus trigger.
export type SequencerAutofocusConfiguration = Omit<SequencerAutofocus, 'enabled'>

// Configuration of the dither trigger.
export type SequencerDitherConfiguration = Omit<SequencerDither, 'enabled'>

// Configuration of the meridian-flip trigger.
export type SequencerMeridianFlipConfiguration = Omit<SequencerMeridianFlip, 'enabled'>

// Configuration of one lifecycle action: the declared action without the fields the pipeline itself consumes.
export interface SequencerLifecycleConfiguration {
	// Declared action, verbatim, so the handler reads its own variant fields.
	readonly action: SequencerLifecycleAction
	// Whether a failure of this action must make the session terminal, normalized from the optional flag.
	readonly required: boolean
	// Maximum time allowed for the action to reach its terminal state, in seconds.
	readonly timeout: number
	// Failure policy of the action.
	readonly retry: SequencerRetryPolicy
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
// node. Inserting an action, reordering the list, or renaming a target therefore has to leave every id that
// already existed untouched, which positional ids cannot promise and declared ids give for free.
//
// The target segment appears in every node below the target, because those nodes exist once per target and
// their artifacts belong to it. Startup and finalize carry no target segment: they run once per session, and
// a target segment there would claim a relationship that does not exist.
export const sequencerNodeId = {
	// Root of the plan.
	root: () => 'plan',
	// Startup or finalize block.
	pipeline: (pipeline: 'startup' | 'finalize') => pipeline,
	// One lifecycle action of a pipeline, addressed by its declared action id.
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

// Reads the coordinate pair of a target, dropping the blocks that are lowered into their own nodes.
function coordinatesOf(target: SequencerTarget): SequencerPlanCoordinates {
	switch (target.coordinateType) {
		case 'JNOW':
		case 'J2000':
			return { coordinateType: target.coordinateType, rightAscension: target.rightAscension, declination: target.declination }
		case 'ALTAZ':
			return { coordinateType: 'ALTAZ', azimuth: target.azimuth, altitude: target.altitude }
		default:
			return { coordinateType: target.coordinateType, longitude: target.longitude, latitude: target.latitude }
	}
}

// Applies the per-frame camera overrides over the capture defaults, so the capture action never has to merge
// anything at exposure time. Only properties the frame actually declares override the default.
function cameraSettingsOf(frame: SequencerFrame, defaults: SequencerCameraSettings): SequencerCameraSettings {
	return { ...defaults, ...frame.camera, subframe: frame.camera.subframe ?? defaults.subframe }
}

// Lowers one enabled frame into a normalized group. The delay is resolved here, from the frame when it
// declares one and from the capture plan otherwise, so the scheduler never sees an undefined spacing.
function lowerFrameGroup(definition: Sequencer, frame: SequencerFrame): SequencerPlanFrameGroup {
	const { capture, target } = definition

	return {
		id: frame.id,
		nodeId: sequencerNodeId.captureFrame(target.id, frame.id),
		frameType: frame.frameType,
		exposureTime: frame.exposureTime,
		count: frame.count,
		integrationTime: frame.integrationTime,
		delay: frame.delay ?? capture.delay,
		weight: frame.weight,
		filter: frame.filter,
		camera: cameraSettingsOf(frame, capture.defaults),
		retry: capture.retry,
	}
}

// Lowers one lifecycle action into its action node. The node id comes from the declared action id and the
// pipeline it belongs to, with no target segment: startup and finalize are siblings of the target block and
// run once per session, so a target segment there would claim a relationship that does not exist.
function lowerLifecycleAction(pipeline: 'startup' | 'finalize', action: SequencerLifecycleAction): SequencerPlanAction {
	const configuration: SequencerLifecycleConfiguration = { action, required: action.required ?? false, timeout: action.timeout, retry: action.retry }
	return { kind: 'action', id: sequencerNodeId.pipelineAction(pipeline, action.id), type: `${SEQUENCER_LIFECYCLE_BLOCK_PREFIX}${action.type}`, configuration }
}

// Lowers an ordered lifecycle pipeline. Returns undefined when the pipeline is disabled or declares no
// enabled action: an empty container would be a node the runtime enters and leaves for nothing, and it would
// still show up in the checkpoint as a place the session had been.
function lowerPipeline(pipeline: 'startup' | 'finalize', enabled: boolean, actions: readonly SequencerLifecycleAction[]): SequencerPlanSequence | undefined {
	if (!enabled) return undefined

	const children: SequencerPlanAction[] = []

	for (const action of actions) {
		if (action.enabled) children.push(lowerLifecycleAction(pipeline, action))
	}

	return children.length > 0 ? { kind: 'sequence', id: sequencerNodeId.pipeline(pipeline), children } : undefined
}

// Lowers the safe-point triggers of the capture loop, in the order they are evaluated before a frame: the
// flip first, because it invalidates the pointing everything else assumes; then autofocus, which needs the
// final pointing; then the dither, which is the last thing done before the exposure starts.
function lowerTriggers(definition: Sequencer, targetId: string): SequencerPlanAction[] {
	const { autofocus, dither, meridianFlip } = definition
	const triggers: SequencerPlanAction[] = []

	if (meridianFlip.enabled) {
		const { enabled, ...configuration } = meridianFlip
		triggers.push({ kind: 'action', id: sequencerNodeId.trigger(targetId, 'meridianFlip'), type: SEQUENCER_BLOCK_TYPE.meridianFlip, configuration })
	}

	if (autofocus.enabled) {
		const { enabled, ...configuration } = autofocus
		triggers.push({ kind: 'action', id: sequencerNodeId.trigger(targetId, 'autofocus'), type: SEQUENCER_BLOCK_TYPE.autofocus, configuration })
	}

	if (dither.enabled) {
		const { enabled, ...configuration } = dither
		triggers.push({ kind: 'action', id: sequencerNodeId.trigger(targetId, 'dither'), type: SEQUENCER_BLOCK_TYPE.dither, configuration })
	}

	return triggers
}

// Lowers the target block: the slew, the optional centering, and the capture loop, in that order.
function lowerTarget(definition: Sequencer, groups: readonly SequencerPlanFrameGroup[]): SequencerPlanSequence {
	const { capture, target } = definition
	const id = sequencerNodeId.target(target.id)
	const coordinates = coordinatesOf(target)
	const children: SequencerPlanNode[] = []

	if (target.goto.enabled) {
		const { enabled, ...goto } = target.goto
		const configuration: SequencerSlewConfiguration = { ...goto, coordinates, tracking: target.tracking.enabled ? { mode: target.tracking.mode, rightAscensionRate: target.tracking.rightAscensionRate, declinationRate: target.tracking.declinationRate, retry: target.tracking.retry } : undefined }
		children.push({ kind: 'action', id: sequencerNodeId.slew(target.id), type: SEQUENCER_BLOCK_TYPE.slew, configuration })
	}

	if (target.center.enabled) {
		const { enabled, ...center } = target.center
		const configuration: SequencerCenterConfiguration = { ...center, coordinates }
		children.push({ kind: 'action', id: sequencerNodeId.center(target.id), type: SEQUENCER_BLOCK_TYPE.center, configuration })
	}

	const frames = groups.map<SequencerPlanAction>((group) => {
		const configuration: SequencerCaptureConfiguration = { group, settle: capture.settle }
		return { kind: 'action', id: group.nodeId, type: SEQUENCER_BLOCK_TYPE.captureFrame, configuration }
	})

	const body: SequencerPlanSequence = { kind: 'sequence', id: sequencerNodeId.captureCycle(target.id), children: [...lowerTriggers(definition, target.id), ...frames] }

	children.push({ kind: 'loop', id: sequencerNodeId.captureLoop(target.id), repeat: capture.repeat, order: capture.order, groups, body })

	return { kind: 'sequence', id, children }
}

// Collects the device roles the lowered plan actually commands, in the fixed order of the role union so the
// result is comparable across compilations. The camera is always present: a session that exposes nothing is
// refused before this runs.
function rolesOf(definition: Sequencer, groups: readonly SequencerPlanFrameGroup[]): SequencerDeviceRole[] {
	const { autofocus, cover, dome, flatPanel, guiding, meridianFlip, rotator, target } = definition
	const roles: SequencerDeviceRole[] = ['camera']

	if (target.goto.enabled || target.tracking.enabled || target.center.enabled || meridianFlip.enabled) roles.push('mount')
	if (groups.some((group) => group.filter !== undefined)) roles.push('wheel')
	if (autofocus.enabled) roles.push('focuser')
	if (rotator.enabled) roles.push('rotator')

	if (guiding.enabled && guiding.connection.mode === 'local') {
		roles.push('guideCamera')
		roles.push('guideOutput')
	}

	if (cover.enabled) roles.push('cover')
	if (flatPanel.enabled) roles.push('flatPanel')
	if (dome.enabled) roles.push('dome')

	return roles
}

// Lowers a definition into the plan a session executes.
//
// Returns the plan and the fields observably dropped from it, or every diagnostic that prevented the
// lowering. The definition is not mutated and nothing outside it is read, so the result depends only on the
// argument.
export function compile(definition: Sequencer): SequencerCompilation {
	const context: CompilerContext = { diagnostics: [], removals: [] }
	const { capture, shutdown, startup, storage, target } = definition

	const groups: SequencerPlanFrameGroup[] = []

	for (const frame of capture.frames) {
		if (frame.enabled) groups.push(lowerFrameGroup(definition, frame))
	}

	if (!target.enabled) context.diagnostics.push({ path: 'target.enabled', message: 'the definition has no enabled target to observe' })
	if (groups.length === 0) context.diagnostics.push({ path: 'capture.frames', message: 'the definition has no enabled frame group to capture' })

	if (context.diagnostics.length > 0) return { ok: false, diagnostics: context.diagnostics }

	const children: SequencerPlanNode[] = []
	const lowered = lowerPipeline('startup', startup.enabled, startup.actions)
	const finalized = lowerPipeline('finalize', shutdown.enabled, shutdown.actions)

	if (lowered) children.push(lowered)
	children.push(lowerTarget(definition, groups))
	if (finalized) children.push(finalized)

	const runOn: ('completed' | 'stopped' | 'failed')[] = []

	if (shutdown.runOnCompletion) runOn.push('completed')
	if (shutdown.runOnStop) runOn.push('stopped')
	if (shutdown.runOnFailure) runOn.push('failed')

	const plan: SequencerPlan = {
		definitionId: definition.id ?? '',
		definitionRevision: definition.revision ?? 0,
		devices: definition.devices,
		roles: rolesOf(definition, groups),
		root: { kind: 'sequence', id: sequencerNodeId.root(), children },
		groups,
		startup: lowered && { continueOnFailure: startup.continueOnFailure },
		finalize: finalized && { continueOnFailure: shutdown.continueOnFailure, runOn },
		storage: { root: storage.root, fileNameTemplate: storage.fileNameTemplate, directoryTemplate: storage.directoryTemplate, temporaryDirectory: storage.temporaryDirectory, checksum: storage.checksum, autoSubFolderMode: storage.autoSubFolderMode },
	}

	return { ok: true, plan, removals: context.removals }
}
