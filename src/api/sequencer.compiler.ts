import { isAbsolute } from 'path'
import type { MountTargetCoordinate } from 'nebulosa/src/devices/indi/device'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { Sequencer, SequencerCamera, SequencerCentering, SequencerDeviceRole, SequencerFailureReason, SequencerFrame, SequencerGoto, SequencerLifecycleAction, SequencerRetryPolicy, SequencerTargetTracking } from '#/sequencer'
import type { SequencerCompilation, SequencerDiagnostic, SequencerPlan, SequencerPlanAction, SequencerPlanFrameGroup, SequencerPlanNode, SequencerPlanSequence, SequencerRemoval } from '#/sequencer.plan'
import { isSequencerPathSegment, sequencerArtifactPath, sequencerPathSegments } from './sequencer.path'
import type { SequencerBlockRegistry } from './sequencer.registry'

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

// Configuration of the slew action, with the tracking policy the mount must hold once it arrives.
export interface SequencerSlew extends Omit<SequencerGoto, 'enabled'> {
	// Where to point.
	readonly coordinates: MountTargetCoordinate<Angle>
	// Tracking to establish after arrival, absent when the target does not command tracking.
	readonly tracking?: Omit<SequencerTargetTracking, 'enabled'>
}

// Configuration of the centering action.
export interface SequencerCenter extends Omit<SequencerCentering, 'enabled'> {
	// Coordinates the solved field is compared against.
	readonly coordinates: MountTargetCoordinate<Angle>
}

// Configuration of one capture action, which is the frame group plus the settling the capture plan requires
// before an exposure starts.
export interface SequencerCapture {
	// Group this action exposes for.
	readonly group: SequencerPlanFrameGroup
	// Stable time required before the first or a resumed exposure, in seconds.
	readonly settle: number
}

// Configuration of one lifecycle action: the declared action without the fields the pipeline itself consumes.
export interface SequencerLifecycle {
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

// Applies the per-frame camera overrides over the capture defaults, so the capture action never has to merge
// anything at exposure time. Only properties the frame actually declares override the default.
function cameraSettingsOf(frame: SequencerFrame, defaults: SequencerCamera): SequencerCamera {
	return { ...defaults, ...frame.camera, subframe: frame.camera.subframe ?? defaults.subframe }
}

// Whether a frame group contributes anything to the plan.
//
// A group concludes on whichever completion criterion is reached first, and `0` disables each criterion, so a
// group that declares neither a frame count nor an integration time concludes on nothing. Following the
// contract, disabling both criteria disables the group, with exactly the effect of `enabled: false`; the
// alternative reading is a group that captures forever, which no operator writes on purpose.
function frameGroupEnabled(frame: SequencerFrame) {
	return frame.enabled && (frame.count > 0 || frame.integrationTime > 0)
}

// Slots one group needs to reach its target in one cycle.
//
// With both criteria active the group concludes at the cheaper of the two, so the smaller demand is the one
// that decides. The integration criterion divides exactly rather than approximately: every slot of a group
// exposes for the same `exposureTime` and, in V1, an accepted frame is every captured frame, so the
// accumulated integration grows in identical steps. The caller guarantees the group is enabled and that
// `exposureTime > 0` whenever `integrationTime > 0`, so the result is finite and >= 1.
function requiredSlotsOf(frame: SequencerFrame) {
	const byCount = frame.count > 0 ? frame.count : Number.POSITIVE_INFINITY
	const byIntegration = frame.integrationTime > 0 ? Math.ceil(frame.integrationTime / frame.exposureTime) : Number.POSITIVE_INFINITY
	return Math.min(byCount, byIntegration)
}

// Reports the two ways a frame group makes the capture loop unbounded, which is one of the only situations
// this project checks at runtime.
//
// An integration target with a zero exposure divides by zero and yields an infinite slot limit, which is the
// infinite loop coming back through another door. A repetition count of zero would have to be read as "no
// cycle at all", and silently disabling the whole capture through the repetition counter is precisely the
// quiet acceptance the compatibility rule forbids.
function checkTermination(context: CompilerContext, definition: Sequencer) {
	const { frames, repeat } = definition.capture

	if (repeat < 1) context.diagnostics.push({ path: 'capture.repeat', message: 'the capture must run at least one cycle' })

	for (let i = 0; i < frames.length; i++) {
		const frame = frames[i]
		if (frameGroupEnabled(frame) && frame.integrationTime > 0 && frame.exposureTime <= 0) context.diagnostics.push({ path: `capture.frames[${i}].exposureTime`, message: 'a frame group with an integration time requires a positive exposure time' })
	}
}

// Lowers one enabled frame into a normalized group. The delay is resolved here, from the frame when it
// declares one and from the capture plan otherwise, so the scheduler never sees an undefined spacing.
function lowerFrameGroup(definition: Sequencer, frame: SequencerFrame): SequencerPlanFrameGroup {
	const { capture, target } = definition
	const requiredSlots = requiredSlotsOf(frame)
	const abandonmentBudget = frame.abandonmentBudget ?? 0

	return {
		id: frame.id,
		name: frame.name,
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
		requiredSlots,
		abandonmentBudget,
		slotLimit: requiredSlots + abandonmentBudget,
		projectedIntegration: requiredSlots * frame.exposureTime,
	}
}

// Lowers one lifecycle action into its action node. The node id comes from the declared action id and the
// pipeline it belongs to, with no target segment: startup and finalize are siblings of the target block and
// run once per session, so a target segment there would claim a relationship that does not exist.
function lowerLifecycleAction(pipeline: 'startup' | 'finalize', action: SequencerLifecycleAction): SequencerPlanAction {
	const configuration: SequencerLifecycle = { action, required: action.required ?? false, timeout: action.timeout, retry: action.retry }
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
	const children: SequencerPlanNode[] = []

	if (target.goto.enabled) {
		const { enabled, ...goto } = target.goto
		const configuration: SequencerSlew = {
			...goto,
			coordinates: { type: target.type, [target.type]: { ...target[target.type] } },
			tracking: target.tracking.enabled ? { mode: target.tracking.mode, rightAscensionRate: target.tracking.rightAscensionRate, declinationRate: target.tracking.declinationRate, retry: target.tracking.retry } : undefined,
		}
		children.push({ kind: 'action', id: sequencerNodeId.slew(target.id), type: SEQUENCER_BLOCK_TYPE.slew, configuration })
	}

	if (target.center.enabled) {
		const { enabled, ...center } = target.center
		const configuration: SequencerCenter = { ...center, coordinates: { type: target.type, [target.type]: { ...target[target.type] } } }
		children.push({ kind: 'action', id: sequencerNodeId.center(target.id), type: SEQUENCER_BLOCK_TYPE.center, configuration })
	}

	const frames = groups.map<SequencerPlanAction>((group) => {
		const configuration: SequencerCapture = { group, settle: capture.settle }
		return { kind: 'action', id: group.nodeId, type: SEQUENCER_BLOCK_TYPE.captureFrame, configuration }
	})

	const body: SequencerPlanSequence = { kind: 'sequence', id: sequencerNodeId.captureCycle(target.id), children: [...lowerTriggers(definition, target.id), ...frames] }

	children.push({ kind: 'loop', id: sequencerNodeId.captureLoop(target.id), repeat: capture.repeat, order: capture.order, groups, body })

	return { kind: 'sequence', id, children }
}

// Roles in the order of the role union, so the role list of a plan is comparable across compilations
// regardless of the order the features that need them were inspected in.
const SEQUENCER_ROLE_ORDER: readonly SequencerDeviceRole[] = ['camera', 'mount', 'wheel', 'focuser', 'rotator', 'guideCamera', 'guideOutput', 'cover', 'flatPanel', 'dome']

// Role each lifecycle action commands, so an action that needs a device the definition never declared is
// refused at compile time instead of failing halfway through the pipeline, with the observatory already
// half open. `connectDevices` is absent because it declares its roles explicitly, `custom` and `switch` are
// absent because they address a host handler and a device id rather than a session role, and the dome actions
// are absent because the compatibility rule refuses them before a role could be required for them.
const SEQUENCER_LIFECYCLE_ROLE: Partial<Record<SequencerLifecycleAction['type'], SequencerDeviceRole>> = {
	unparkMount: 'mount',
	parkMount: 'mount',
	startTracking: 'mount',
	stopTracking: 'mount',
	openCover: 'cover',
	closeCover: 'cover',
	coolCamera: 'camera',
	warmCamera: 'camera',
}

// One role the plan needs, together with the definition property that needs it, so a missing device can be
// reported against the feature that would have commanded it rather than against the device map alone.
interface RoleRequirement {
	// Role that must resolve to a device.
	readonly role: SequencerDeviceRole
	// Property path of the feature requiring it.
	readonly path: string
}

// Collects every role the lowered plan commands. The camera is always required: a definition that exposes
// nothing is refused before this runs.
function roleRequirements(definition: Sequencer, groups: readonly SequencerPlanFrameGroup[]): RoleRequirement[] {
	const { autofocus, guiding, meridianFlip, shutdown, startup, target } = definition
	const requirements: RoleRequirement[] = [{ role: 'camera', path: 'capture.frames' }]

	if (target.goto.enabled) requirements.push({ role: 'mount', path: 'target.goto' })
	if (target.tracking.enabled) requirements.push({ role: 'mount', path: 'target.tracking' })
	if (target.center.enabled) requirements.push({ role: 'mount', path: 'target.center' })
	if (meridianFlip.enabled) requirements.push({ role: 'mount', path: 'meridianFlip' })
	if (groups.some((group) => group.filter !== undefined)) requirements.push({ role: 'wheel', path: 'capture.frames' })
	if (autofocus.enabled) requirements.push({ role: 'focuser', path: 'autofocus' })

	if (guiding.enabled && guiding.connection.mode === 'local') {
		requirements.push({ role: 'guideCamera', path: 'guiding.connection' })
		requirements.push({ role: 'guideOutput', path: 'guiding.connection' })
	}

	for (const pipeline of [
		{ name: 'startup', actions: startup.actions, enabled: startup.enabled },
		{ name: 'shutdown', actions: shutdown.actions, enabled: shutdown.enabled },
	]) {
		if (!pipeline.enabled) continue

		for (let i = 0; i < pipeline.actions.length; i++) {
			const action = pipeline.actions[i]
			if (!action.enabled) continue

			const path = `${pipeline.name}.actions[${i}]`

			if (action.type === 'connectDevices') {
				for (const role of action.devices) requirements.push({ role, path: `${path}.devices` })
			} else {
				const role = SEQUENCER_LIFECYCLE_ROLE[action.type]
				if (role) requirements.push({ role, path })
			}
		}
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
	if (target.id.length > 0 && !isSequencerPathSegment(target.id)) context.diagnostics.push({ path: 'target.id', message: `the target id "${target.id}" contains a path separator or a relative segment and would escape the storage root` })

	for (let i = 0; i < capture.frames.length; i++) {
		const { id } = capture.frames[i]
		if (id.length > 0 && !isSequencerPathSegment(id)) context.diagnostics.push({ path: `capture.frames[${i}].id`, message: `the frame id "${id}" contains a path separator or a relative segment and would escape the storage root` })
	}

	const absolute = isAbsolute(storage.root)

	if (!absolute) context.diagnostics.push({ path: 'storage.root', message: `the storage root "${storage.root}" is not an absolute path` })
	if (storage.temporaryDirectory !== undefined && !isAbsolute(storage.temporaryDirectory)) context.diagnostics.push({ path: 'storage.temporaryDirectory', message: `the temporary directory "${storage.temporaryDirectory}" is not an absolute path` })

	const directories = sequencerPathSegments(storage.directoryTemplate)
	let composable = absolute

	for (const directory of directories) {
		if (!isSequencerPathSegment(directory)) {
			context.diagnostics.push({ path: 'storage.directoryTemplate', message: `the directory segment "${directory}" is a relative segment and would escape the session directory` })
			composable = false
		}
	}

	if (!isSequencerPathSegment(storage.fileNameTemplate)) {
		context.diagnostics.push({ path: 'storage.fileNameTemplate', message: `the file name template "${storage.fileNameTemplate}" is empty or contains a path separator, and the file name is a single segment` })
		composable = false
	}

	if (composable) {
		const probe = sequencerArtifactPath({ root: storage.root, session: SEQUENCER_PROBE_SEGMENT, night: SEQUENCER_PROBE_SEGMENT }, directories, storage.fileNameTemplate)
		if (!probe.ok) context.diagnostics.push({ path: 'storage.root', message: probe.reason })
	}
}

// Reports every role the plan commands without a device declared for it.
function checkRoles(context: CompilerContext, definition: Sequencer, requirements: readonly RoleRequirement[]) {
	for (const requirement of requirements) {
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

// Rebuilds a node with the configuration its handler returned in place of the one the lowering produced.
// Nodes the map does not mention, and nodes whose handler returned its input unchanged, are returned as they
// are, so a compilation whose handlers normalize nothing allocates nothing.
function withConfigurations(node: SequencerPlanNode, configurations: ReadonlyMap<string, unknown>): SequencerPlanNode {
	switch (node.kind) {
		case 'action': {
			if (!configurations.has(node.id)) return node
			const configuration = configurations.get(node.id)
			return configuration === node.configuration ? node : { ...node, configuration }
		}
		case 'sequence':
			return withConfigurationsIn(node, configurations)
		case 'loop': {
			const body = withConfigurationsIn(node.body, configurations)
			return body === node.body ? node : { ...node, body }
		}
	}
}

// Rebuilds a sequence with the rewritten children, preserving its identity when no child changed.
function withConfigurationsIn(sequence: SequencerPlanSequence, configurations: ReadonlyMap<string, unknown>): SequencerPlanSequence {
	let changed = false
	const children: SequencerPlanNode[] = []

	for (const child of sequence.children) {
		const rewritten = withConfigurations(child, configurations)
		changed ||= rewritten !== child
		children.push(rewritten)
	}

	return changed ? { ...sequence, children } : sequence
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

		for (const binding of handler.resources(result.configuration)) requirements.push({ role: binding.role, path: node.id })
	}

	return { versions, requirements, configurations }
}

// Lowers the guider the session will create and own, or undefined when the plan does not guide.
//
// V1 has a single guiding mode, creating and owning the session, and it is not a policy preference: the
// session reserves the logical keys of the guider at start, so a guider session already open holds a lease on
// exactly those keys and the reservation fails before any guiding policy is consulted. A mode that reuses a
// session someone else owns therefore describes a path no session can reach.
function lowerGuider(context: CompilerContext, definition: Sequencer) {
	const { guiding } = definition

	if (!guiding.enabled) return undefined

	if (guiding.connection.mode === 'existing') {
		context.diagnostics.push({ path: 'guiding.connection.mode', message: 'a guider session owned by another component cannot be reserved by this session' })
		return undefined
	}

	if (!guiding.connection.owned) {
		context.diagnostics.push({ path: 'guiding.connection.owned', message: 'the session must own the guider session it reserves' })
		return undefined
	}

	return { connection: guiding.connection, calibrateBeforeStart: guiding.calibrateBeforeStart, recalibrateAfterMeridianFlip: guiding.recalibrateAfterMeridianFlip, restoreAfterInterruption: guiding.restoreAfterInterruption, settle: guiding.settle, retry: guiding.retry }
}

// Schema revision this compiler understands. A definition serialized against another revision may have moved
// a field this lowering reads, so it is refused instead of interpreted with the current reading.
const SEQUENCER_SCHEMA_VERSION = 1

// Lifecycle actions commanding a device the device layer of this version does not implement.
const SEQUENCER_UNSUPPORTED_ACTION: ReadonlySet<SequencerLifecycleAction['type']> = new Set(['openDome', 'closeDome', 'parkDome', 'unparkDome'])

// Whether a pipeline has an enabled action of one of the given types.
function commands(definition: Sequencer, types: readonly SequencerLifecycleAction['type'][]) {
	for (const pipeline of [definition.startup, definition.shutdown]) {
		if (!pipeline.enabled) continue

		for (const action of pipeline.actions) {
			if (action.enabled && types.includes(action.type)) return true
		}
	}

	return false
}

// Failure reasons a retry cannot recover from. A disconnected or removed device is not a transient command
// failure: retrying only repeats it until the attempts are exhausted, because there is nowhere to wait for the
// device to come back — `waitingResources` is not part of this version.
const SEQUENCER_UNRECOVERABLE_REASON: ReadonlySet<SequencerFailureReason> = new Set(['disconnected', 'removed'])

// Checks one retry policy, addressed to the path that declared it.
//
// A policy retrying an unrecoverable reason and a policy suspending on exhaustion are both refused: the first
// would spend its whole budget repeating a failure that cannot succeed, and the second names a state this
// version never enters, so the definition would silently get another terminal action than the one it asked for.
function checkRetry(context: CompilerContext, retry: SequencerRetryPolicy, path: string) {
	for (const reason of retry.retryOn) {
		if (SEQUENCER_UNRECOVERABLE_REASON.has(reason)) context.diagnostics.push({ path: `${path}.retryOn`, message: `a "${reason}" failure ends the session instead of being retried, and retrying it would only repeat the same failure` })
	}

	if (retry.onExhausted === 'suspend') context.diagnostics.push({ path: `${path}.onExhausted`, message: 'this version has no suspended state to exhaust a policy into' })
}

// Checks every failure policy of the definition and the meridian flip window.
//
// The retry policies of a disabled block are deliberately not checked: a block this version refuses when it is
// enabled has nothing to execute, so the policy it declares is inert and reporting it would address the
// operator to a field that changes nothing.
function checkPolicies(context: CompilerContext, definition: Sequencer) {
	const { autofocus, capture, dither, execution, guiding, meridianFlip, shutdown, startup, target } = definition

	checkRetry(context, execution.defaultRetry, 'execution.defaultRetry')
	checkRetry(context, capture.retry, 'capture.retry')
	checkRetry(context, target.tracking.retry, 'target.tracking.retry')
	checkRetry(context, target.goto.retry, 'target.goto.retry')
	checkRetry(context, target.center.retry, 'target.center.retry')
	if (guiding.enabled) checkRetry(context, guiding.retry, 'guiding.retry')
	if (dither.enabled) checkRetry(context, dither.retry, 'dither.retry')
	if (autofocus.enabled) checkRetry(context, autofocus.retry, 'autofocus.retry')

	if (meridianFlip.enabled) {
		checkRetry(context, meridianFlip.retry, 'meridianFlip.retry')

		// An empty window leaves the safe point with no hour angle at which an exposure may resume: the pre-exposure
		// guard already refuses to start and the flip is not permitted yet, which is a wait that never ends.
		if (meridianFlip.maximumHourAngle < meridianFlip.minimumHourAngle) context.diagnostics.push({ path: 'meridianFlip.maximumHourAngle', message: 'the flip window is empty, because it ends before the hour angle it may start at' })
		if (!meridianFlip.waitForCurrentExposure) context.diagnostics.push({ path: 'meridianFlip.waitForCurrentExposure', message: 'the exposure in progress when the window opens is always finished first, and the pre-exposure guard is not switchable' })
	}

	for (const pipeline of [
		{ name: 'startup', actions: startup.actions, enabled: startup.enabled },
		{ name: 'shutdown', actions: shutdown.actions, enabled: shutdown.enabled },
	]) {
		if (!pipeline.enabled) continue

		for (let i = 0; i < pipeline.actions.length; i++) {
			const action = pipeline.actions[i]
			if (action.enabled) checkRetry(context, action.retry, `${pipeline.name}.actions[${i}].retry`)
		}
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
	const { autofocus, calibration, capture, cooling, cover, dome, execution, flatPanel, guiding, monitoring, notification, quality, rotator, safety, shutdown, startup, storage, target } = definition
	const { diagnostics, removals } = context

	if (definition.schemaVersion !== SEQUENCER_SCHEMA_VERSION) diagnostics.push({ path: 'schemaVersion', message: `the definition declares schema version ${definition.schemaVersion}, and this version compiles ${SEQUENCER_SCHEMA_VERSION}` })
	if (!definition.enabled) diagnostics.push({ path: 'enabled', message: 'the definition is disabled and a disabled definition has nothing to execute' })

	if (target.constraints.enabled) diagnostics.push({ path: 'target.constraints.enabled', message: 'target constraints require the ephemeris and the monitor lane this version does not have' })

	if (capture.abortOnDeviceAlert) diagnostics.push({ path: 'capture.abortOnDeviceAlert', message: 'this version has no device alert source, so the flag would promise a protection that does not exist' })
	if (capture.continueAfterRejectedFrame) removals.push({ path: 'capture.continueAfterRejectedFrame', reason: 'quality evaluation is not executed, so no frame is ever rejected and the flag has no path to take effect' })

	if (guiding.thresholds.enabled) diagnostics.push({ path: 'guiding.thresholds.enabled', message: 'guiding thresholds require the continuous monitor lane this version does not have' })
	if (guiding.recovery.enabled) diagnostics.push({ path: 'guiding.recovery.enabled', message: 'guiding recovery requires the continuous monitor lane this version does not have' })
	if (!guiding.enabled && commands(definition, ['startGuiding', 'stopGuiding'])) diagnostics.push({ path: 'guiding.enabled', message: 'a lifecycle action commands guiding, which the definition disables' })

	if (autofocus.triggers.starSizeChange !== 0) diagnostics.push({ path: 'autofocus.triggers.starSizeChange', message: 'triggering on star size requires measuring the star size of every frame, which this version does not do' })

	if (rotator.enabled) diagnostics.push({ path: 'rotator.enabled', message: 'no action of this version commands the rotator, so an enabled rotator would never reach its angle' })
	if (dome.enabled) diagnostics.push({ path: 'dome.enabled', message: 'the device layer of this version has no dome' })
	if (cover.enabled) diagnostics.push({ path: 'cover.enabled', message: 'the cover block only declares automatic behaviors this version does not perform; the cover is commanded by the lifecycle actions, which carry their own timeout and retry' })
	if (flatPanel.enabled) diagnostics.push({ path: 'flatPanel.enabled', message: 'the flat panel is lit only for flat frames, which this version does not capture' })

	if (!cooling.enabled && commands(definition, ['coolCamera', 'warmCamera'])) diagnostics.push({ path: 'cooling.enabled', message: 'a lifecycle action commands the camera cooler, and the cooling block it reads the temperature from is disabled' })

	if (calibration.dark.enabled) diagnostics.push({ path: 'calibration.dark.enabled', message: 'calibration frames are not lowered by this version' })
	if (calibration.bias.enabled) diagnostics.push({ path: 'calibration.bias.enabled', message: 'calibration frames are not lowered by this version' })
	if (calibration.flat.enabled) diagnostics.push({ path: 'calibration.flat.enabled', message: 'calibration frames are not lowered by this version' })
	if (calibration.darkFlat.enabled) diagnostics.push({ path: 'calibration.darkFlat.enabled', message: 'calibration frames are not lowered by this version' })

	if (monitoring.enabled) diagnostics.push({ path: 'monitoring.enabled', message: 'the monitor lane is not part of this version' })
	if (safety.enabled) diagnostics.push({ path: 'safety.enabled', message: 'there is no safety monitor in this version' })
	if (quality.enabled) diagnostics.push({ path: 'quality.enabled', message: 'frame quality evaluation is not part of this version' })
	if (notification.enabled) removals.push({ path: 'notification', reason: 'notifications are delivered by channel adapters over the session events, outside the executable plan' })

	if (execution.start.type === 'sunAltitude' || execution.start.type === 'targetAltitude') diagnostics.push({ path: 'execution.start.type', message: `starting on ${execution.start.type} requires the ephemeris this version does not compute` })
	if (execution.end.type === 'sunAltitude' || execution.end.type === 'targetAltitude') diagnostics.push({ path: 'execution.end.type', message: `ending on ${execution.end.type} requires the ephemeris this version does not compute` })
	if (!execution.checkpoint.enabled) diagnostics.push({ path: 'execution.checkpoint.enabled', message: 'the checkpoint is how a session knows what it already did, and this version always writes it' })
	if (execution.maximumParallelActions !== 1) diagnostics.push({ path: 'execution.maximumParallelActions', message: 'this version executes one action at a time' })
	if (execution.releaseResourcesWhilePaused) diagnostics.push({ path: 'execution.releaseResourcesWhilePaused', message: 'the reservation is held through a pause, which is the entire reason it exists' })
	if (execution.releaseResourcesWhileSuspended) diagnostics.push({ path: 'execution.releaseResourcesWhileSuspended', message: 'the reservation is held through a suspension, which is the entire reason it exists' })
	if (execution.continueAfterApplicationRestart) diagnostics.push({ path: 'execution.continueAfterApplicationRestart', message: 'a session of this version does not survive the process it runs in' })

	if (!storage.enabled) diagnostics.push({ path: 'storage.enabled', message: 'a session with storage disabled would expose and discard every frame it captures' })
	if (!storage.atomicWrite) diagnostics.push({ path: 'storage.atomicWrite', message: 'the write protocol is what keeps a partial file out of the final path, and this version always applies it' })
	if (storage.overwrite) diagnostics.push({ path: 'storage.overwrite', message: 'an existing file is classified and never overwritten in silence' })

	if (shutdown.runOnUnsafe) diagnostics.push({ path: 'shutdown.runOnUnsafe', message: 'there is no safety monitor in this version to declare a session unsafe' })

	for (const pipeline of [
		{ name: 'startup', actions: startup.actions, enabled: startup.enabled },
		{ name: 'shutdown', actions: shutdown.actions, enabled: shutdown.enabled },
	]) {
		if (!pipeline.enabled) continue

		for (let i = 0; i < pipeline.actions.length; i++) {
			const action = pipeline.actions[i]
			if (action.enabled && SEQUENCER_UNSUPPORTED_ACTION.has(action.type)) diagnostics.push({ path: `${pipeline.name}.actions[${i}].type`, message: `the device layer of this version has no dome, so the ${action.type} action cannot be executed` })
		}
	}
}

// Deduplicates the required roles and returns them in the fixed role order, which is what the session
// reserves at start. Two features requiring the same role reserve it once.
function rolesOf(requirements: readonly RoleRequirement[]): SequencerDeviceRole[] {
	const required = new Set(requirements.map((requirement) => requirement.role))
	return SEQUENCER_ROLE_ORDER.filter((role) => required.has(role))
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
	checkUniqueIds(context, startup.actions, 'startup.actions', 'startup action')
	checkUniqueIds(context, shutdown.actions, 'shutdown.actions', 'shutdown action')

	if (!target.enabled) context.diagnostics.push({ path: 'target.enabled', message: 'the definition has no enabled target to observe' })
	if (target.id.length === 0) context.diagnostics.push({ path: 'target.id', message: 'the target id is empty and cannot address a node' })
	if (groups.length === 0) context.diagnostics.push({ path: 'capture.frames', message: 'the definition has no enabled frame group to capture' })

	checkStorage(context, definition)
	checkPolicies(context, definition)
	checkCompatibility(context, definition)

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

	const requirements = roleRequirements(definition, groups)
	const guider = lowerGuider(context, definition)

	const plan: SequencerPlan = {
		definitionId: definition.id ?? '',
		definitionRevision: definition.revision ?? 0,
		name: definition.name,
		description: definition.description,
		target: { id: target.id, name: target.name },
		execution: { start: definition.execution.start, end: definition.execution.end, pauseMode: definition.execution.pauseMode, stopMode: definition.execution.stopMode, defaultRetry: definition.execution.defaultRetry, checkpoint: definition.execution.checkpoint },
		devices: definition.devices,
		roles: rolesOf(requirements),
		root: { kind: 'sequence', id: sequencerNodeId.root(), children },
		groups,
		startup: lowered && { continueOnFailure: startup.continueOnFailure },
		finalize: finalized && { continueOnFailure: shutdown.continueOnFailure, runOn },
		guider,
		cooling: definition.cooling.enabled ? definition.cooling : undefined,
		storage: { root: storage.root, fileNameTemplate: storage.fileNameTemplate, directoryTemplate: storage.directoryTemplate, temporaryDirectory: storage.temporaryDirectory, checksum: storage.checksum, autoSubFolderMode: storage.autoSubFolderMode },
	}

	// The handlers run before the roles are checked, because a role a handler declares is as required as one
	// the lowering derived, and reporting a device missing for it is the same diagnostic.
	const handlers = options?.registry && checkHandlers(context, options.registry, plan)

	if (handlers) {
		for (const requirement of handlers.requirements) requirements.push(requirement)
	}

	checkRoles(context, definition, requirements)

	if (context.diagnostics.length > 0) return { ok: false, diagnostics: context.diagnostics }

	return { ok: true, plan: handlers ? { ...plan, roles: rolesOf(requirements), root: withConfigurationsIn(plan.root, handlers.configurations), handlers: handlers.versions } : plan, removals: context.removals }
}
