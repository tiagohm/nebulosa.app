import { sequencerCaptureExposureInSeconds } from '#/sequencer'
import type { SequencerDeviceRole } from '#/sequencer'
import type { SequencerPlan, SequencerPlanFrameGroup, SequencerPlanNode } from '#/sequencer.plan'
import type { SequencerActivitySnapshot, SequencerActivityState, SequencerCaptureSnapshot, SequencerDeviceSnapshot, SequencerGroupSnapshot, SequencerSession, SequencerSessionSnapshot, SequencerTriggerAnchor, SequencerTriggerAnchors, SequencerTriggerSnapshot, SequencerWaitSnapshot } from '#/sequencer.state'
import { isSequencerTerminalState } from '#/sequencer.state'
import { groupProgressOf, targetProgressOf } from './sequencer.scheduler'
import type { SequencerTriggerPolicies } from './sequencer.trigger'

// Derivation of the value the UI observes, the meter behind its completion estimate, and the cadence it is
// emitted.
//
// The snapshot is derived on every tick from the session record, its checkpoint, and what the runtime is doing
// right now. It is never stored and never read back by the runtime: an execution decision that consulted it
// would be deciding from presentation, and the checkpoint would stop being the single account of what happened.
//
// Instants are milliseconds since the Unix epoch, durations in the snapshot are seconds, and the emitter
// interval is milliseconds.

// Interval between two progress emissions when nothing changes, in milliseconds. A ten-minute exposure has to
// keep the screen alive without producing ten minutes of traffic, and a transition never waits for it.
export const SEQUENCER_PROGRESS_INTERVAL = 1000

// Intervals the overhead average is taken over.
//
// The average is moving rather than cumulative because the overhead of a night is not stationary: the first
// frames pay a calibration and a settle that the frames in the middle of a run do not, and an autofocus that
// just happened must not keep inflating the estimate for the rest of the session. Eight is long enough to
// absorb one trigger without being dominated by it and short enough to follow the run it is measuring.
const SEQUENCER_OVERHEAD_WINDOW = 8

// Moving average of the interval between the end of one exposure and the start of the next, which is the whole
// overhead the completion estimate projects.
//
// It is measured and never configured: the entire safe point — the write, the triggers it selected, the filter
// change, the cadence spacing — fits inside that interval and is therefore already counted, without anything
// having to predict how many autofocus runs a night will ask for. The estimate starts optimistic, before any
// interval exists, and converges as the run produces them.
export class SequencerOverheadMeter {
	readonly #intervals: number[] = []
	#index = 0
	#total = 0
	#endedAt?: number

	// Average overhead in seconds, or undefined while no interval between two exposures has been measured yet.
	get average() {
		return this.#intervals.length === 0 ? undefined : this.#total / this.#intervals.length
	}

	// Intervals currently averaged, at most the window size.
	get samples() {
		return this.#intervals.length
	}

	// Records the instant an exposure finished integrating.
	//
	// Only the last end is kept: a session that ended an exposure and then stopped, paused, or failed before
	// starting another one has no interval to contribute, and pairing that end with the start of a frame an hour
	// later would report the pause as overhead.
	exposureEnded(at: number) {
		this.#endedAt = at
	}

	// Records the instant an exposure started, closing the interval opened by the previous end.
	//
	// An interval is contributed only when it is finite and non-negative; the first exposure of a session closes
	// nothing, and a clock that moved backwards contributes nothing rather than a negative overhead.
	exposureStarted(at: number) {
		const endedAt = this.#endedAt

		this.#endedAt = undefined

		if (endedAt === undefined) return

		const interval = (at - endedAt) / 1000

		if (!Number.isFinite(interval) || interval < 0) return

		if (this.#intervals.length < SEQUENCER_OVERHEAD_WINDOW) {
			this.#intervals.push(interval)
			this.#total += interval
			return
		}

		this.#total += interval - this.#intervals[this.#index]
		this.#intervals[this.#index] = interval
		this.#index = (this.#index + 1) % SEQUENCER_OVERHEAD_WINDOW
	}

	// Forgets every measured interval and the pending end. A session that resumed after a long pause measures
	// the overhead of the run it is in and not the one of the run it was interrupted from.
	reset() {
		this.#intervals.length = 0
		this.#index = 0
		this.#total = 0
		this.#endedAt = undefined
	}
}

// One action the runtime is running, as the runtime knows it. It is the live half of the snapshot: everything
// else is read from the session record and its checkpoint.
export interface SequencerActivityObservation {
	// Plan node the action belongs to.
	readonly nodeId: string
	// Block type of the node, as registered.
	readonly type: string
	// What the action is doing.
	readonly state: SequencerActivityState
	// Attempt in progress, starting at 1.
	readonly attempt: number
	// Fraction of the action already done, in `0..1`, absent when the handler reports none.
	readonly progress?: number
	// Short human-readable detail reported by the handler.
	readonly detail?: string
	// Instant the action started.
	readonly startedAt: number
	// Condition the action is standing still on, which is what keeps a long wait explainable instead of
	// stalling the completion estimate with no reason attached.
	readonly wait?: SequencerWaitSnapshot
}

// Exposure the sensor is integrating, as the runtime knows it.
export interface SequencerExposureObservation {
	// Instant the exposure started.
	readonly startedAt: number
	// Requested duration, in seconds.
	readonly total: number
}

// Everything the derivation reads. The session record is the only mandatory part: a session whose plan is no
// longer loaded still has to describe itself, which is exactly the case of a terminal session being listed.
export interface SequencerSnapshotObservation {
	// Session record as the store holds it, which carries the checkpoint every counter is read from.
	readonly session: SequencerSession
	// Plan the session executes, absent when no plan is loaded for it. Without one the snapshot carries no
	// target, no groups, and no completion estimate, because all three are properties of the lowering.
	readonly plan?: SequencerPlan
	// Device actually resolved per role at session start, absent for a session that never started.
	readonly resolved?: Readonly<Partial<Record<SequencerDeviceRole, string>>>
	// Exposure in progress, absent whenever the sensor is not integrating.
	readonly exposure?: SequencerExposureObservation
	// Action the UI shows, absent when nothing is running.
	readonly foreground?: SequencerActivityObservation
	// Actions running alongside it, empty in V1.
	readonly background?: readonly SequencerActivityObservation[]
	// Node the plan takes next, absent when it is not determinable.
	readonly next?: string
	// Trigger policies the lowering produced, absent when the plan enables none.
	readonly triggers?: SequencerTriggerPolicies
	// Whether the mount is past the flip point and the flip is still pending. It is an observation of the mount
	// rather than a value the anchors hold, which is why it cannot be derived here.
	readonly meridianFlipDue?: boolean
	// Measured average overhead, in seconds, absent until the meter has an interval.
	readonly overhead?: number
	// Highest event sequence committed for the session.
	readonly lastEventSequence?: number
	// Instant the snapshot describes.
	readonly now: number
}

// Derives everything the UI shows from the durable state and what the runtime is doing right now.
//
// The derivation is total and pure: every session produces a snapshot, including one that never started and
// one whose plan the process no longer holds, and nothing here reads a clock of its own — `now` is the instant
// the caller took, so the elapsed exposure and the completion estimate belong to the same reading.
export function deriveSequencerSnapshot(observation: SequencerSnapshotObservation): SequencerSessionSnapshot {
	const { session, plan, now } = observation
	const checkpoint = session.checkpoint
	const terminal = isSequencerTerminalState(session.state)
	const targetId = plan?.target.id
	const progress = targetId === undefined ? undefined : targetProgressOf(checkpoint.capture, targetId)
	const groups: SequencerGroupSnapshot[] = []

	let accepted = 0
	let requiredSlots = 0
	let integration = 0
	let projectedIntegration = 0
	let cycleRemaining = 0

	const overhead = observation.overhead ?? 0

	for (const group of plan?.groups ?? []) {
		const counters = progress === undefined ? undefined : groupProgressOf(progress, group.id)
		const groupAccepted = counters?.accepted ?? 0

		groups.push({
			id: group.id,
			frameType: group.capture.frameType,
			exposureTime: sequencerCaptureExposureInSeconds(group.capture),
			filter: filterLabel(group),
			cursor: counters?.cursor ?? 0,
			accepted: groupAccepted,
			captured: counters?.captured ?? 0,
			rejected: counters?.rejected ?? 0,
			abandoned: counters?.abandoned ?? 0,
			requiredSlots: group.requiredSlots,
			slotLimit: group.slotLimit,
			integration: counters?.integration ?? 0,
			projectedIntegration: group.projectedIntegration,
		})

		accepted += groupAccepted
		requiredSlots += group.requiredSlots
		integration += counters?.integration ?? 0
		projectedIntegration += group.projectedIntegration

		// Only the slots still to be accepted are projected, and only the required ones: the abandonment budget
		// is margin the plan hopes not to spend, so counting it would present slack as scheduled work.
		cycleRemaining += Math.max(0, group.requiredSlots - groupAccepted) * (sequencerCaptureExposureInSeconds(group.capture) + overhead)
	}

	const capture: SequencerCaptureSnapshot = {
		cycle: progress?.cycle ?? 0,
		groupId: currentGroupId(plan, checkpoint.cursor),
		exposure: observation.exposure === undefined ? undefined : exposureOf(observation.exposure, now),
		groups,
		accepted,
		requiredSlots,
		integration,
		projectedIntegration,
		overhead: observation.overhead,
	}

	// The estimate exists only while there is work left to project. A terminal session has none, and a session
	// with no plan loaded cannot say what its remaining work is without inventing it.
	if (plan !== undefined && !terminal) {
		const cycles = Math.max(0, planRepeat(plan.root) - (progress?.cycle ?? 0) - 1)
		let remaining = cycleRemaining

		for (const group of plan.groups) remaining += cycles * group.requiredSlots * (sequencerCaptureExposureInSeconds(group.capture) + overhead)

		return { ...header(observation, terminal), capture: { ...capture, remaining, estimatedCompletion: now + remaining * 1000 }, ...tail(observation) }
	}

	return { ...header(observation, terminal), capture, ...tail(observation) }
}

// Session-level fields of the snapshot, which every session carries whether or not it ever ran.
function header(observation: SequencerSnapshotObservation, terminal: boolean) {
	const { session, plan } = observation

	return {
		id: session.id,
		definitionId: session.definitionId,
		definitionRevision: session.definitionRevision,
		revision: session.revision,
		state: session.state,
		desiredState: session.desiredState,
		// A terminal session converges nowhere, and its desired state is `stopped` by construction; reading the
		// two against each other there would show every completed session as still converging. A session in
		// `created` converges nowhere either: its desired state is the `running` every session is created with,
		// and it means "run when started" rather than a transition already under way, so reading the two against
		// each other would show a session nobody started as permanently transitioning.
		converging: !terminal && session.state !== 'created' && !converged(session),
		failure: session.failure,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		startedAt: session.startedAt,
		endedAt: session.endedAt,
		devices: devicesOf(observation),
		target: plan === undefined ? undefined : { id: plan.target.id, name: plan.target.name },
	}
}

// Fields the derivation reads straight from what the runtime is doing.
function tail(observation: SequencerSnapshotObservation) {
	return {
		foreground: observation.foreground === undefined ? undefined : activityOf(observation.foreground),
		background: observation.background?.map(activityOf) ?? [],
		next: observation.next,
		triggers: triggersOf(observation),
		// V1 declares no monitors. The field is derived as empty rather than omitted so the UI is written
		// against the final shape instead of one that grows a list later.
		monitors: [],
		lastEventSequence: observation.lastEventSequence ?? 0,
		timestamp: observation.now,
	}
}

// Whether a non-terminal session already reached the state it was asked to converge to.
//
// A session asked to stop has not: the state machine has no `stopping`, so a stop is only over when the
// session is terminal, which is decided before this is ever consulted.
function converged(session: SequencerSession) {
	switch (session.desiredState) {
		case 'running':
			return session.state === 'running'
		case 'paused':
			return session.state === 'paused'
		case 'stopped':
			return false
	}
}

// Declared roles of the session against the devices they resolved to.
function devicesOf(observation: SequencerSnapshotObservation): readonly SequencerDeviceSnapshot[] {
	const declared = observation.plan?.devices
	const devices: SequencerDeviceSnapshot[] = []

	if (declared === undefined) return devices

	for (const [role, declaredId] of Object.entries(declared) as [SequencerDeviceRole, string | undefined][]) {
		// A role the definition omits is unavailable rather than unresolved, and reporting it would suggest the
		// session is missing a device it never asked for.
		if (declaredId === undefined) continue

		devices.push({ role, declaredId, deviceId: observation.resolved?.[role] })
	}

	return devices
}

// One action as the snapshot reports it, with the block type standing in for a node the plan does not name.
function activityOf(activity: SequencerActivityObservation): SequencerActivitySnapshot {
	return { nodeId: activity.nodeId, type: activity.type, state: activity.state, attempt: activity.attempt, progress: activity.progress, detail: activity.detail, startedAt: activity.startedAt, wait: activity.wait }
}

// Exposure in progress, with the elapsed time clamped to the requested duration.
//
// The clamp is what keeps a bar from overshooting while the sensor reads out: the exposure stays in the
// snapshot until the frame settles, and the elapsed time is a reading of the clock, not of the sensor.
function exposureOf(exposure: SequencerExposureObservation, now: number) {
	const elapsed = Math.min(Math.max(0, (now - exposure.startedAt) / 1000), exposure.total)
	return { startedAt: exposure.startedAt, elapsed, total: exposure.total, remaining: exposure.total - elapsed }
}

// Filter the group captures through, as a label, or undefined when the group commands no wheel.
//
// A reference by position is rendered as the position itself: the wheel is what maps it to a name, and the
// snapshot reports what the definition asked for rather than resolving it against a device it does not read.
function filterLabel(group: SequencerPlanFrameGroup) {
	const { filter } = group.capture

	if (filter === undefined) return undefined

	return filter.type === 'name' ? filter.name : String(filter.position)
}

// Frame group the cursor is inside, found by the capture action node of each group.
//
// The cursor is a node id and the groups carry the node id of their capture action, so a cursor that is not a
// capture — a trigger between two frames, a lifecycle action — selects no group, which is the honest answer:
// the capture is idle and the foreground action says what is running instead.
function currentGroupId(plan: SequencerPlan | undefined, cursor: string | undefined) {
	if (plan === undefined || cursor === undefined) return undefined

	for (const group of plan.groups) {
		if (group.nodeId === cursor) return group.id
	}

	return undefined
}

// Cycles the capture loop of the plan performs, or 1 when the plan holds no loop.
//
// The walk stops at the first loop, which in V1 is the capture loop of the only target. A plan without one
// captures a single pass, so projecting one cycle is what the estimate has to assume.
function planRepeat(node: SequencerPlanNode): number {
	if (node.kind === 'loop') return node.repeat
	if (node.kind === 'action') return 1

	for (const child of node.children) {
		if (child.kind === 'loop') return child.repeat

		const repeat = planRepeat(child)

		if (repeat > 1) return repeat
	}

	return 1
}

// Readiness of every trigger the plan lowered.
//
// Distances are reported per condition and only for the conditions the policy states: a trigger firing on a
// filter change or on a temperature drift has no number to count down, and inventing one would promise a run
// at an instant nothing decided. The meridian flip is reported from the mount observation for the same reason —
// what says a flip is due is the hour angle, not an anchor.
function triggersOf(observation: SequencerSnapshotObservation): readonly SequencerTriggerSnapshot[] {
	const policies = observation.triggers

	if (policies === undefined) return []

	const anchors = observation.session.checkpoint.anchors
	const triggers: SequencerTriggerSnapshot[] = []

	if (policies.meridianFlip !== undefined) triggers.push({ name: 'meridianFlip', armed: observation.meridianFlipDue === true })

	if (policies.autofocus !== undefined) {
		const { everyFrames, everyTime } = policies.autofocus.triggers
		// A one-shot condition owed by a flip or a recovery arms the autofocus regardless of how far the periodic
		// conditions are: the focus those events invalidated is owed at the next safe point.
		triggers.push(periodicTrigger('autofocus', anchors.autofocus, anchors, everyFrames, everyTime, observation.now, anchors.pendingAutofocus !== undefined))
	}

	if (policies.dither !== undefined) {
		const { everyFrames, everyTime } = policies.dither
		triggers.push(periodicTrigger('dither', anchors.dither, anchors, everyFrames, everyTime, observation.now, false))
	}

	return triggers
}

// Readiness of one trigger stated over accepted frames and elapsed time.
//
// `everyFrames` and `everyTime` are the declared periods, with `0` disabling the condition. Elapsed time is
// measured from the last run and from the start of the session when the trigger has never run, which is the
// same origin the evaluator uses.
function periodicTrigger(name: 'autofocus' | 'dither', anchor: SequencerTriggerAnchor, anchors: SequencerTriggerAnchors, everyFrames: number, everyTime: number, now: number, owed: boolean): SequencerTriggerSnapshot {
	const frames = everyFrames > 0 ? Math.max(0, everyFrames - anchor.frames) : undefined
	const elapsed = everyTime > 0 ? Math.max(0, everyTime - (now - (anchor.at ?? anchors.sessionStart)) / 1000) : undefined

	return { name, armed: owed || frames === 0 || elapsed === 0, frames, elapsed }
}

// Collaborators the progress emitter is wired with.
export interface SequencerProgressEmitterOptions {
	// Produces the snapshot to emit, or undefined when there is nothing to describe. It is called per emission
	// rather than once, because the snapshot is derived and a value held across ticks would be stale by
	// construction.
	readonly snapshot: () => SequencerSessionSnapshot | undefined
	// Receives every emission. A sink that throws is reported and never reaches the runtime.
	readonly emit: (snapshot: SequencerSessionSnapshot) => void
	// Interval between two emissions when nothing changes, in milliseconds.
	readonly interval?: number
}

// Emits progress at a fixed cadence and immediately on every change.
//
// The two halves answer different failures. Without the cadence a ten-minute exposure would leave the screen
// frozen for ten minutes; without the immediate emission a transition would be shown up to a second after it
// happened, which is exactly when an operator is watching. A change also restarts the interval, so a transition
// is never followed by a redundant tick a millisecond later.
export class SequencerProgressEmitter {
	readonly #options: SequencerProgressEmitterOptions
	readonly #interval: number
	#timer?: ReturnType<typeof setInterval>

	constructor(options: SequencerProgressEmitterOptions) {
		this.#options = options
		this.#interval = options.interval ?? SEQUENCER_PROGRESS_INTERVAL
	}

	// Whether the cadence is running.
	get started() {
		return this.#timer !== undefined
	}

	// Starts the cadence and emits once, so a client that just caused the session to start does not wait a full
	// interval for its first reading. Idempotent.
	start() {
		if (this.#timer !== undefined) return

		this.#timer = setInterval(() => this.#tick(), this.#interval)
		this.#timer.unref?.()

		this.#tick()
	}

	// Emits immediately and restarts the interval from this instant.
	//
	// It is inert while the cadence is stopped: a change reported by a session that is not being observed has
	// nothing to emit to, and emitting it anyway would resurrect a stopped emitter.
	changed() {
		if (this.#timer === undefined) return

		clearInterval(this.#timer)

		this.#timer = setInterval(() => this.#tick(), this.#interval)
		this.#timer.unref?.()

		this.#tick()
	}

	// Stops the cadence. Idempotent, and the emitter can be started again afterwards.
	stop() {
		if (this.#timer === undefined) return

		clearInterval(this.#timer)
		this.#timer = undefined
	}

	// Derives one snapshot and hands it to the sink.
	#tick() {
		try {
			const snapshot = this.#options.snapshot()

			if (snapshot !== undefined) this.#options.emit(snapshot)
		} catch (e) {
			// Progress is presentation: a derivation or a fanout that failed must not take the session with it.
			console.error('sequencer progress emission failed:', e)
		}
	}
}
