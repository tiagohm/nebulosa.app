import { statSync } from 'fs'
import { dirname, resolve } from 'path'
import { localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import { isCamera, isGuideOutput, isMount, isWheel } from 'nebulosa/src/devices/indi/device'
import type { PierSide } from 'nebulosa/src/devices/indi/device'
import { normalizePI } from 'nebulosa/src/math/units/angle'
import type { GuiderConnect } from '#/guider'
import type { SequencerDeviceRole, SequencerDevices, SequencerFilterReference } from '#/sequencer'
import type { SequencerPlan, SequencerPlanAction } from '#/sequencer.plan'
import type { SequencerArtifact, SequencerArtifactDraft, SequencerCheckpoint, SequencerDesiredState, SequencerEvent, SequencerEventDraft, SequencerFailure, SequencerSession, SequencerSessionState } from '#/sequencer.state'
import { localGuiderCameraKey, localGuiderOutputKey, remoteGuiderKey } from './guider.session'
import type { OperationCoordinator, OperationScope } from './operation'
import { abortableDelay } from './operation.wait'
import type { ResourceArbiter, ResourceRequest, ResourceReservation, ResourceReservationOwner } from './resource'
import { sequencerPlanNodes } from './sequencer.compiler'
import { sequencerCancelsActiveAction } from './sequencer.control'
import { runSequencerPlan } from './sequencer.executor'
import type { SequencerExecutionOutcome, SequencerExecutorHost, SequencerSafePointObservation } from './sequencer.executor'
import type { SequencerGuidingServices } from './sequencer.guiding'
import { sequencerAuxiliaryFileName, sequencerSlotAttempt } from './sequencer.identity'
import { SEQUENCER_INTENT_NOOP_DETAIL, SequencerIntentQueue } from './sequencer.intent'
import type { SequencerIntentEffect, SequencerIntentNoop } from './sequencer.intent'
import { sequencerFilterSlot } from './sequencer.optics'
import { sequencerAuxiliaryDirectory, sequencerNightSegment, sequencerVerifiedAuxiliaryPath } from './sequencer.path'
import type { SequencerAuxiliaryKind, SequencerPathContext } from './sequencer.path'
import type { SequencerPreparationServices } from './sequencer.prepare'
import type { ResourceBinding, SequencerActionContext, SequencerActionProgress, SequencerAuxiliaryTarget, SequencerBlockRegistry, SequencerFrameSlot } from './sequencer.registry'
import type { SequencerActivityObservation, SequencerExposureObservation, SequencerSnapshotObservation } from './sequencer.snapshot'
import { SequencerOverheadMeter } from './sequencer.snapshot'
import type { SequencerStore } from './sequencer.store'
import { sequencerPlanTriggerPolicies } from './sequencer.trigger'
import { makeTime } from './util'

// Session admission, bootstrap reversal, and the execution kernel of the sequencer.
//
// The runtime owns the whole life of a session: admitting it, resolving roles into real resources, holding
// the reservation, walking the plan, persisting every transition, and finalizing. The walk itself belongs to
// the executor: what is here is everything the walk is not allowed to own — the process claim, the
// reservation, the device readings, the artifact registry, and the durable state.
//
// Instants are milliseconds since the Unix epoch.
//
// "One active session per process" is a declared constraint, and a declared constraint without a mechanism
// is a race: two concurrent starts can both observe that nothing is running and both succeed. The resource
// arbiter does not cover it, because two sessions over disjoint devices reserve without conflicting, and the
// per-session intent queue does not either, because the race is global.
//
// The claim is deliberately distinct from the reservation: the reservation protects devices, the claim
// protects the single-session invariant, which holds even when two definitions share no device at all. When
// the constraint eventually becomes a configurable limit of simultaneous sessions, only this gate changes.

// Why an admission request was not granted a claim.
// - busy: another session holds the claim; its id is reported so the caller can say which one.
export type SessionAdmissionRefusal = 'busy'

// Process-wide claim of the single active session slot, released once the session is fully torn down.
export interface SessionClaim {
	// Session holding the claim.
	readonly sessionId: string
	// Releases the claim. Idempotent, and inert once another session has already been admitted.
	readonly release: VoidFunction
}

// Outcome of asking for admission.
// - admitted: the caller now owns the claim and must bootstrap the session.
// - reentrant: this same session already holds the claim, so the caller returns the current snapshot and
//   starts nothing. It deliberately carries no claim: a second start must not be able to release the first.
// - refused: another session holds the claim.
export type SessionAdmission = { readonly ok: true; readonly kind: 'admitted'; readonly claim: SessionClaim } | { readonly ok: true; readonly kind: 'reentrant'; readonly sessionId: string } | { readonly ok: false; readonly kind: 'refused'; readonly reason: SessionAdmissionRefusal; readonly sessionId: string }

// Live claim, kept by identity so a stale `release` cannot revoke a later session's claim.
interface ClaimRecord {
	// Session holding the slot.
	readonly sessionId: string
	// Set by the first release, making further releases inert.
	released: boolean
}

// Gate serializing session starts within the process.
export class SessionAdmissionGate {
	#claim?: ClaimRecord

	// Session currently holding the claim, or undefined when the process is admissible.
	get sessionId() {
		return this.#claim?.sessionId
	}

	// Claims the session slot.
	//
	// The whole decision is synchronous — there is no `await` between the test and the mark — which is what
	// makes it a gate on a single-threaded runtime. Callers must therefore claim before resolving roles and
	// before creating the reservation, since both of those suspend.
	//
	// A refusal is immediate and names the holder; the caller never waits for the slot.
	claim(sessionId: string): SessionAdmission {
		const claim = this.#claim

		if (claim !== undefined) {
			return claim.sessionId === sessionId ? { ok: true, kind: 'reentrant', sessionId } : { ok: false, kind: 'refused', reason: 'busy', sessionId: claim.sessionId }
		}

		const record: ClaimRecord = { sessionId, released: false }
		this.#claim = record

		return {
			ok: true,
			kind: 'admitted',
			claim: {
				sessionId,
				release: () => {
					if (record.released) return

					record.released = true

					// Only the record still installed is cleared. Releasing a claim the gate already moved past
					// would silently evict whichever session was admitted afterwards.
					if (this.#claim === record) this.#claim = undefined
				},
			},
		}
	}
}

// Ordered undo steps of a session bootstrap.
//
// Bootstrap acquires the claim, resolves roles, creates the reservation, and opens the scope, and any of
// those can fail after the previous ones succeeded. Unwinding in reverse order is what leaves the process
// admissible again instead of holding a claim over a session that never started.
//
// The same list is the teardown sequence of a session that did start: finalization runs the scope cleanups,
// releases the reservation, and releases the claim last, in the exact reverse of how they were acquired.
// The claim is released only there, never on reaching a terminal state, which still has work behind it.
export class SessionTeardown {
	readonly #steps: VoidFunction[] = []

	// Steps still pending.
	get size() {
		return this.#steps.length
	}

	// Records an undo step for a bootstrap stage that just succeeded.
	add(step: VoidFunction) {
		this.#steps.push(step)
	}

	// Runs every pending step in reverse order and empties the list, so a second call is inert.
	//
	// A step that throws never skips the ones behind it: giving up halfway would leak the reservation or the
	// claim precisely when the process is already in a bad state. Failures are reported through `onError`.
	run(onError?: (error: unknown) => void) {
		for (let i = this.#steps.length - 1; i >= 0; i--) {
			try {
				this.#steps[i]()
			} catch (e) {
				try {
					onError?.(e)
				} catch (er) {
					console.error('onError failed:', er)
				}
			}
		}

		this.#steps.length = 0
	}
}

// Everything a session executes, snapshotted at creation and immutable for its whole life.
export interface SequencerRuntimePlan {
	// Compiled plan the session walks. Everything declarative about the session — the definition it came from,
	// the devices, the storage policy, the execution policy and the node tree — is read from here, so the
	// runtime never carries a second copy of a decision the lowering already made.
	readonly compiled: SequencerPlan
	// Where the session writes, complete once the session starts, so the night and the session segment are
	// fixed for its whole life.
	readonly storage: SequencerPathContext
}

// Plan as a caller hands it in, which is everything the runtime executes except the two storage segments the
// caller cannot decide. The session directory is derived from the session id, and the id only exists once the
// store assigned it; the night directory belongs to the instant the session starts, which is not the instant
// it was created — a session created at 23:50 and started at 00:10 writes into the night it observes, not the
// one it was configured in. The runtime completes both, so nothing outside it has to invent a segment for a
// session that does not exist yet or, worse, reuse one across two runs of the same definition.
export type SequencerRuntimePlanDraft = Omit<SequencerRuntimePlan, 'storage'>

// Plan as the runtime keeps it between creation and start: the session segment is already fixed and the night
// segment is still a policy, because the session has no start instant to resolve it against yet.
interface PendingPlan extends SequencerRuntimePlanDraft {
	// Session segment of the storage, fixed at creation.
	readonly session: string
}

// Turns a declared role and the device id behind it into the resource the arbiter arbitrates.
//
// The runtime cannot compute this itself: the physical key is the device `hardwareId`, which only exists
// with the device present, so resolution is injected and happens at session start rather than at compile
// time. Returning undefined means the device is unknown right now, which stops the session before it holds
// anything.
export type SequencerDeviceResolver = (role: SequencerDeviceRole, deviceId: string) => ResourceRequest | undefined

// Collaborators the runtime is wired with.
export interface SequencerRuntimeOptions {
	// Durable state of every session.
	readonly store: SequencerStore
	// Block handlers and their versions.
	readonly registry: SequencerBlockRegistry
	// Owner of every operation tree the session starts.
	readonly coordinator: OperationCoordinator
	// Role resolution against the live devices.
	readonly resolve: SequencerDeviceResolver
	// Services the frame preparation of every safe point commands the optical path through.
	readonly preparation: SequencerPreparationServices
	// Services the guiding interlock and the dither command the guider through.
	readonly guiding: SequencerGuidingServices
	// Wall-clock source in milliseconds since the Unix epoch, injected so tests do not depend on real time.
	readonly now?: () => number
	// Receives action progress, which is presentation only and never persisted.
	readonly progress?: (sessionId: string, nodeId: string, progress: SequencerActionProgress) => void
	// Receives every durable change the runtime writes, after it is stored. A sink that throws is reported and
	// never reaches the session: what is already committed does not depend on anyone being able to observe it.
	readonly observe?: (change: SequencerRuntimeChange) => void
}

// One durable change as it was written, handed to the observer of the runtime.
//
// It is the commit as accepted, not an invitation to re-read: `session` is the record the store now holds, and
// `events` and `artifacts` are exactly the ones this unit wrote, so a subscriber can fan them out without
// diffing anything. A session that was just created reports itself with both lists empty.
export interface SequencerRuntimeChange {
	// Session as stored after the change.
	readonly session: SequencerSession
	// Events appended by this change, in sequence order.
	readonly events: readonly SequencerEvent[]
	// Artifacts written by this change, in the order they were handed to the store.
	readonly artifacts: readonly SequencerArtifact[]
}

// Why a session could not be started.
// - unknownSession: no session with that id exists.
// - busy: another session holds the process claim; its id is reported.
// - notStartable: the session already ran; a started or terminal session is not restarted.
// - handlerUnresolved: the block type is missing or its version no longer matches the one recorded.
// - invalidConfiguration: the handler rejected the stored configuration.
// - roleUnresolved: a role the block commands is not declared, or its device is not present.
// - resourcesUnavailable: the resources are leased or reserved by someone else.
// - shuttingDown: the process is ending and admits no further session.
export type SequencerStartFailureReason = 'unknownSession' | 'busy' | 'notStartable' | 'handlerUnresolved' | 'invalidConfiguration' | 'roleUnresolved' | 'resourcesUnavailable' | 'shuttingDown'

// Outcome of a start. Success carries the session as stored, which for a reentrant start is the running one.
export type SequencerStartResult =
	| {
			readonly ok: true
			// Session as stored after admission.
			readonly session: SequencerSession
			// True when the session was already running and this start did nothing, as an idempotent retry.
			readonly reentrant: boolean
	  }
	| {
			readonly ok: false
			// Cause of the refusal.
			readonly reason: SequencerStartFailureReason
			// Diagnostic naming what exactly could not be resolved.
			readonly detail?: string
			// Session holding the claim, for a busy refusal.
			readonly sessionId?: string
	  }

// Outcome of one operator command. The only failure is a session that does not exist: every other command is
// accepted, and a command that changed nothing reports the effect `none` together with why.
export type SequencerControlResult =
	| {
			readonly ok: true
			// What the fold decided the command does.
			readonly effect: SequencerIntentEffect
			// Why it did nothing, present exactly when the effect is `none`.
			readonly noop?: SequencerIntentNoop
			// Session as stored after the command was recorded.
			readonly session: SequencerSession
	  }
	| {
			readonly ok: false
			// Cause of the refusal.
			readonly reason: 'unknownSession'
	  }

// One durable change the runtime applies, mirroring the fields of a store commit it actually uses.
interface SessionChange {
	// New lifecycle state, when it changes.
	readonly state?: SequencerSessionState
	// New desired state, when the operator asked for one.
	readonly desiredState?: SequencerDesiredState
	// Definitive cause, recorded together with a failed state.
	readonly failure?: SequencerFailure
	// Replacement checkpoint.
	readonly checkpoint?: SequencerCheckpoint
	// Events appended by this change, in order.
	readonly events?: readonly SequencerEventDraft[]
}

// Live state of the single admitted session.
interface ActiveSession {
	// Session being executed.
	readonly id: string
	// Plan snapshotted at creation.
	readonly plan: SequencerRuntimePlan
	// Reservation owner identity, which is also what cancels every operation of the session.
	readonly owner: ResourceReservationOwner
	// Reservation held for the whole session.
	readonly reservation: ResourceReservation
	// Scope authorized by the reservation, handed to the action.
	readonly scope: OperationScope
	// Undo steps of the bootstrap, which is also the finalization sequence.
	readonly teardown: SessionTeardown
	// Artifacts registered by the action and not yet written.
	readonly artifacts: SequencerArtifactDraft[]
	// Next ordinal per auxiliary kind, so two images of the same kind never share a file name within the
	// session. It is deliberately not persisted: an auxiliary image fills no slot and is never resumed, and a
	// counter restarting at zero after a restart can only collide with a file the session no longer needs.
	readonly auxiliaries: Map<SequencerAuxiliaryKind, number>
	// Control lane of the session. Every operator command enters it, so two that raced reduce in arrival order
	// instead of overwriting each other's desired state.
	readonly intents: SequencerIntentQueue
	// Cancellation source of the session itself, aborted by every stop and by the shutdown. It ends the waits the
	// walk takes between actions and releases a hold, and it is deliberately not what cancels the running action:
	// a graceful stop ends the session without taking the frame that is on the sensor away from it.
	readonly controller: AbortController
	// Cancellation source of the action that is running, aborted by an immediate stop and by an immediate pause
	// (§11.3). It is replaced rather than reused after a cancelled action, because a signal that already fired
	// cannot carry the next one and an immediate pause is followed by a resume that has to run again.
	action: AbortController
	// Cancellation source of the terminal pipeline, aborted only by a shutdown. A stop ends the plan and the
	// finalization is precisely what has to run after it, so it must not be cancelled by the same signal.
	readonly terminal: AbortController
	// Physical request per role the session reserved, which is what every device reading resolves through.
	readonly roles: ReadonlyMap<SequencerDeviceRole, ResourceRequest>
	// Block type per plan node, so the activity of a node names its type without walking the tree again.
	readonly types: ReadonlyMap<string, string>
	// Resolves once the session released everything, with the last durable state the store holds.
	readonly done: PromiseWithResolvers<SequencerSession | undefined>
	// Device actually bound per role at start, which is what the session commands for its whole life.
	readonly resolved: Readonly<Partial<Record<SequencerDeviceRole, string>>>
	// Action being executed, as the runtime knows it. It is the live half of the snapshot, replaced whole on
	// every progress report so a reader never observes a half-updated activity. It is cleared before the
	// transition that ends the session is committed, because there is no action in the foreground of a session
	// that just reached its last state.
	activity?: SequencerActivityObservation
	// Exposure the sensor is integrating, absent whenever the shutter is not open. It is a field of its own
	// so the snapshot can say "capture is idle" without inspecting the foreground action type (§15.1).
	exposure?: SequencerExposureObservation
	// Moving average of the interval between two exposures, which is what the completion estimate projects.
	readonly meter: SequencerOverheadMeter
	// Release of the hold the walk is sitting in, present only while the session is actually paused. It is
	// resolved by the command that takes the desired state off `paused` and by the abort that ends the session,
	// so a stop never waits on an operator who is no longer there.
	resume?: PromiseWithResolvers<void>
	// Last revision this runtime committed, used as the optimistic guard of the next commit.
	revision: number
	// Set while the walk is inside the target block, which is the only phase whose actions run under the action
	// signal. The guider connection and the startup pipeline run outside it, and the terminal pipeline runs after
	// it, so a cancellation issued during either of them is an `aborted` no command explains (§11.3).
	capturing: boolean
	// Set once finalization began, so a stop arriving during it does not start a second one.
	finalizing: boolean
	// Set once the session was published as `finalizing`, which the walk does before it enters the terminal
	// pipeline and the finalization does otherwise. It keeps the transition to a single commit whichever of the
	// two got there first.
	finalized: boolean
	// Pier side the mount reported while the target was still east of the meridian, which is the side that means
	// the flip is still pending. It is re-read for as long as the target is east of the meridian and then frozen,
	// because the side the mount takes after it flips is precisely what must stop matching it.
	preFlipPierSide?: PierSide
	// Guiding session every action of this session commands, absent while the plan declares no guider. It is
	// session state and not plan configuration: a remote or local guider only has an id once its connection is
	// open, which happens after the reservation exists and before the first node runs.
	guider?: string
}

// Identity of the filesystem holding `path`, or the nearest ancestor that exists. Undefined when nothing
// along the chain can be inspected.
function filesystemIdOf(path: string) {
	let current = resolve(path)

	for (;;) {
		try {
			return statSync(current).dev
		} catch {
			const parent = dirname(current)

			if (parent === current) return undefined

			current = parent
		}
	}
}

// Why the temporary directory cannot host the atomic rename, or undefined when it can. A cross-filesystem
// rename is a copy, and an interrupted copy leaves a partial file under the final name.
function sequencerTemporaryDirectoryIssue(root: string, temporaryDirectory?: string) {
	if (temporaryDirectory === undefined) return undefined

	const rootId = filesystemIdOf(root)
	const temporaryId = filesystemIdOf(temporaryDirectory)

	if (rootId === undefined || temporaryId === undefined) return 'storage.temporaryDirectory: the temporary directory and the storage root cannot be inspected'
	if (rootId !== temporaryId) return 'storage.temporaryDirectory: the temporary directory is on another filesystem than the storage root, which would turn the atomic commit into a copy'

	return undefined
}

// Executes one sequencer session at a time.
export class SequencerRuntime {
	readonly #gate = new SessionAdmissionGate()
	readonly #store: SequencerStore
	readonly #registry: SequencerBlockRegistry
	readonly #coordinator: OperationCoordinator
	readonly #arbiter: ResourceArbiter
	readonly #resolve: SequencerDeviceResolver
	readonly #preparation: SequencerPreparationServices
	readonly #guiding: SequencerGuidingServices
	readonly #now: () => number
	readonly #progress?: (sessionId: string, nodeId: string, progress: SequencerActionProgress) => void
	readonly #observe?: (change: SequencerRuntimeChange) => void
	readonly #plans = new Map<string, PendingPlan>()
	#active?: ActiveSession
	// Tail of the operator command that is still taking effect, which is what `control` chains the next one onto,
	// and undefined while no command is in flight. It never rejects: a command that failed is reported to its own
	// caller and the chain continues.
	#controlling?: Promise<void>
	// Set once the process began shutting down, after which no session starts again.
	#closed = false

	// Wires the runtime; the arbiter comes from the coordinator so both always see the same arbitration.
	constructor(options: SequencerRuntimeOptions) {
		this.#store = options.store
		this.#registry = options.registry
		this.#coordinator = options.coordinator
		this.#arbiter = options.coordinator.arbiter
		this.#resolve = options.resolve
		this.#preparation = options.preparation
		this.#guiding = options.guiding
		this.#now = options.now ?? Date.now
		this.#progress = options.progress
		this.#observe = options.observe
	}

	// Reports one written change, keeping a failing subscriber out of the session's path.
	#observed(change: SequencerRuntimeChange) {
		try {
			this.#observe?.(change)
		} catch (e) {
			console.error('sequencer change observation failed:', change.session.id, e)
		}
	}

	// Session currently holding the process claim, or undefined when the runtime is idle.
	get activeSessionId() {
		return this.#gate.sessionId
	}

	// Live half of the snapshot of one session (§15.1), or undefined when that session is not the running one.
	//
	// It is deliberately not the whole observation: the session record, its plan and the instant of the reading
	// belong to whoever derives the snapshot, and everything here is state only the runtime holds. A session
	// that already finalized reports nothing, which is what makes its snapshot describe the record alone.
	observation(sessionId: string): Pick<SequencerSnapshotObservation, 'resolved' | 'foreground' | 'exposure' | 'overhead' | 'triggers' | 'meridianFlipDue'> | undefined {
		const active = this.#active

		if (active?.id !== sessionId) return undefined

		const triggers = sequencerPlanTriggerPolicies(active.plan.compiled)
		const reading = this.#observation(active)
		const flip = triggers?.meridianFlip
		const hourAngle = reading.hourAngle
		const pierSide = reading.pierSide
		const determined = hourAngle !== undefined && pierSide !== undefined && pierSide !== 'NEITHER' && reading.preFlipPierSide !== undefined
		const meridianFlipDue = flip !== undefined && determined && pierSide === reading.preFlipPierSide && hourAngle >= flip.minimumHourAngle

		return { resolved: active.resolved, foreground: active.activity, exposure: active.exposure, overhead: active.meter.average, triggers, meridianFlipDue }
	}

	// Creates a session in `created` for a plan, recording the handler version it was compiled against.
	// Returns undefined when the block type cannot be resolved, since such a session could never start.
	//
	// `registered` is invoked with the stored session before the creation is announced, and exists because the
	// announcement is derived and not merely forwarded: whatever the caller keeps per session — the lowered plan
	// the target, the groups and the completion estimate come from — is keyed by an id only the store assigns, so
	// an observer reached before that is in place would publish a session with no plan behind it and disagree
	// with the answer the same call returns.
	create(draft: SequencerRuntimePlanDraft, registered?: (session: SequencerSession) => void): SequencerSession | undefined {
		const resolution = this.#registry.resolve(planActionsOf(draft.compiled).map((node) => ({ type: node.type })))

		if (!resolution.ok) return undefined

		const session = this.#store.createSession({ definitionId: draft.compiled.definitionId, definitionRevision: draft.compiled.definitionRevision, handlerVersions: resolution.versions })

		// The plan is snapshotted, not referenced: the definition revision and the handler versions recorded in
		// the checkpoint describe this plan as it is now, and an edit of the caller's object between `create`
		// and `start` would run something that no longer matches its own metadata. `configuration` is opaque
		// data of arbitrary shape, so the copy has to be deep.
		const snapshotted = structuredClone(draft)

		this.#plans.set(session.id, { ...snapshotted, session: session.id })

		registered?.(session)

		this.#observed({ session, events: [], artifacts: [] })

		return session
	}

	// Starts a session, executing its action in the background.
	//
	// Everything up to and including the claim is synchronous, which is what makes the gate a gate. The stages
	// after it can fail, and each one that succeeded records its undo step, so a refusal at any point — and an
	// unexpected exception just the same — leaves the process exactly as admissible as it was before.
	start(sessionId: string): SequencerStartResult {
		const stored = this.#store.session(sessionId)

		if (stored === undefined) return { ok: false, reason: 'unknownSession' }
		if (this.#closed) return { ok: false, reason: 'shuttingDown', detail: 'the process is shutting down' }

		const admission = this.#gate.claim(sessionId)

		if (!admission.ok) return { ok: false, reason: 'busy', sessionId: admission.sessionId, detail: `session ${admission.sessionId} is already active` }
		if (admission.kind === 'reentrant') return { ok: true, session: this.#store.session(sessionId) ?? stored, reentrant: true }

		const teardown = new SessionTeardown()
		teardown.add(admission.claim.release)

		try {
			return this.#bootstrap(sessionId, stored, teardown)
		} catch (e) {
			// Every stage after the claim runs code the runtime does not own — a handler's `validate` or
			// `resources`, the device resolver, the arbiter, the store — and an exception from any of them used
			// to escape with the claim still held, refusing every later session as busy for the life of the
			// process. The bootstrap is unwound here and the defect still surfaces to the caller.
			this.#active = undefined
			teardown.run((error) => console.error('sequencer bootstrap teardown failed:', sessionId, error))

			throw e
		}
	}

	// Runs the stages between the claim and the first action, recording an undo step per stage that succeeded.
	#bootstrap(sessionId: string, stored: SequencerSession, teardown: SessionTeardown): SequencerStartResult {
		// A session that already ran must not run again: its checkpoint describes work that was done and
		// re-executing it would recapture frames the plan already considers complete.
		if (stored.state !== 'created') {
			teardown.run()
			return { ok: false, reason: 'notStartable', detail: `session is ${stored.state}` }
		}

		// Plans live in memory only, so a `created` session without one survived a restart of the process and
		// has to be compiled again before it can start.
		const pending = this.#plans.get(sessionId)

		if (pending === undefined) {
			teardown.run()
			return { ok: false, reason: 'unknownSession', detail: 'no plan is loaded for the session' }
		}

		// The night segment is resolved here and never again, which is what fixes it for a session that runs
		// past its own boundary. It is read at the start and not at the creation because the observing night is
		// the one the session captures in: a session prepared before midnight and started after it belongs to
		// the night it is actually observing, and it is also the instant the resolution of §14 dates it from.
		const storageIssue = sequencerTemporaryDirectoryIssue(pending.compiled.storage.root, pending.compiled.storage.temporaryDirectory)

		if (storageIssue !== undefined) {
			teardown.run()
			return { ok: false, reason: 'invalidConfiguration', detail: storageIssue }
		}

		const plan: SequencerRuntimePlan = { ...pending, storage: { root: pending.compiled.storage.root, session: pending.session, night: sequencerNightSegment(pending.compiled.storage.autoSubFolderMode, this.#now()) } }
		const nodes = planActionsOf(plan.compiled)
		const devices = plan.compiled.devices
		const requests: ResourceRequest[] = []
		const roles = new Map<SequencerDeviceRole, ResourceRequest>()
		const types = new Map<string, string>()

		// Every node of the tree is resolved, validated and charged for its roles before anything runs. Doing it
		// per node as the walk reaches it would start a night that fails halfway on a block the registry never
		// had, with devices already moved and frames already written.
		for (const node of nodes) {
			types.set(node.id, node.type)

			const handler = this.#registry.handler(node.type)
			const recorded = stored.checkpoint.handlerVersions[node.type]
			const resolution = this.#registry.resolve([{ type: node.type, version: recorded }])

			// The version is checked again here and not only at creation, because the registry can change in
			// between and running another handler under the same block type is worse than not running at all.
			if (handler === undefined || !resolution.ok) {
				teardown.run()
				return { ok: false, reason: 'handlerUnresolved', detail: `block type ${node.type} is unavailable at version ${recorded}` }
			}

			// The narrowed configuration is used to declare the roles and then dropped: validation is a gate over
			// a configuration the lowering already resolved, and the walk executes the node of the plan, which is
			// the same value this accepted.
			const validated = handler.validate(node.configuration, { nodeId: node.id, devices })

			if (!validated.ok) {
				teardown.run()
				return { ok: false, reason: 'invalidConfiguration', detail: validated.issues.map((issue) => `${node.id}.${issue.path}: ${issue.message}`).join(', ') }
			}

			const refusal = this.#reserveRoles(handler.resources(validated.configuration), devices, roles, requests)

			if (refusal !== undefined) {
				teardown.run()
				return refusal
			}
		}

		const guiderRefusal = this.#reserveGuider(plan.compiled, devices, roles, requests)

		if (guiderRefusal !== undefined) {
			teardown.run()
			return guiderRefusal
		}

		const owner: ResourceReservationOwner = { id: sessionId, kind: 'sequencer' }
		const reserved = this.#arbiter.reserve(owner, requests)

		if (!reserved.ok) {
			teardown.run()
			return { ok: false, reason: 'resourcesUnavailable', detail: reserved.conflicts.map((conflict) => `${conflict.key} is held by ${conflict.ownerKind} ${conflict.ownerId}`).join(', ') }
		}

		teardown.add(reserved.reservation.release)

		const active: ActiveSession = {
			id: sessionId,
			plan,
			owner,
			reservation: reserved.reservation,
			scope: this.#coordinator.reservedScope(reserved.reservation),
			teardown,
			artifacts: [],
			auxiliaries: new Map(),
			intents: new SequencerIntentQueue(),
			controller: new AbortController(),
			action: new AbortController(),
			terminal: new AbortController(),
			roles,
			types,
			done: Promise.withResolvers<SequencerSession | undefined>(),
			resolved: resolvedDevices(devices, roles),
			meter: new SequencerOverheadMeter(),
			revision: stored.revision,
			capturing: false,
			finalizing: false,
			finalized: false,
		}

		this.#active = active

		const running = this.#commit(active, { state: 'running', events: [{ type: 'stateChanged', state: 'running' }] })

		void this.#execute(active)

		return { ok: true, session: running, reentrant: false }
	}

	// Resolves the roles one block declares into the physical requests the arbiter arbitrates, accumulating
	// them into the reservation set of the session. Returns the refusal that stops the start, or undefined when
	// every binding resolved.
	//
	// The set is a union over every block of the plan: a role two blocks command is reserved once, and the
	// session holds for its whole life everything any of its nodes will ever touch.
	#reserveRoles(bindings: readonly ResourceBinding[], devices: SequencerDevices, roles: Map<SequencerDeviceRole, ResourceRequest>, requests: ResourceRequest[]): SequencerStartResult | undefined {
		for (const binding of bindings) {
			if (roles.has(binding.role)) continue

			const deviceId = devices[binding.role]

			if (deviceId === undefined) {
				// An optional role the session does not carry is not an error: the block declared that it
				// commands the device when it is there and runs without it when it is not.
				if (binding.optional) continue

				return { ok: false, reason: 'roleUnresolved', detail: `role ${binding.role} is not available` }
			}

			const request = this.#resolve(binding.role, deviceId)

			// A device the definition named and the resolver cannot find is a failure of every binding,
			// optional included. Optional means the block works without the role at all, not that it works
			// without hardware the session was configured with: skipping here would run the autofocus or the
			// centering with no wheel in its role map, silently through the installed path, while the
			// definition asked for a filter and a disconnected wheel is what actually happened.
			if (request === undefined) return { ok: false, reason: 'roleUnresolved', detail: `device ${deviceId} of role ${binding.role} is not available` }

			roles.set(binding.role, request)
			requests.push(request)
		}

		return undefined
	}

	// Reserves what the guiding session of the plan occupies, accumulating into the same role map and request
	// set the blocks charge. Returns the refusal that stops the start, or undefined when the plan declares no
	// guider or everything it declares resolved.
	//
	// No block declares any of this, which is why it cannot come from `handler.resources`: the session opens the
	// guider itself, between the reservation and its first node, and there are two halves to take.
	//
	// The physical roles of a local guider are what `#openGuider` names in its connect request, and no lifecycle
	// action binds them — `startGuiding` commands a session, not a device — so a local guider without this
	// resolves to nothing in `roles` and refuses every start as disconnected.
	//
	// The logical `logical:guider:*` keys are the other half. `guider.session.ts` reserves a guiding session by
	// those keys and deliberately leaves the physical device acquirable so the guider's own operations can lease
	// it, so reserving only the physical half produces a state worse than a clean failure: a guider opened by
	// hand during the session connects, because the logical keys are free, and only fails at its first command.
	// A local guider takes one key per device rather than one naming the pair, because a combined key would
	// differ for every combination and two sessions sharing only the camera would both be accepted.
	#reserveGuider(plan: SequencerPlan, devices: SequencerDevices, roles: Map<SequencerDeviceRole, ResourceRequest>, requests: ResourceRequest[]): SequencerStartResult | undefined {
		const guider = plan.guider

		if (guider === undefined) return undefined

		const { connection } = guider

		if (connection.mode === 'remote') {
			requests.push({ key: remoteGuiderKey(connection.host, connection.port) })
			return undefined
		}

		const refusal = this.#reserveRoles([{ role: 'guideCamera' }, { role: 'guideOutput' }], devices, roles, requests)

		if (refusal !== undefined) return refusal

		const camera = roles.get('guideCamera')?.device
		const guideOutput = roles.get('guideOutput')?.device

		// The resolver already refused a device that cannot do what its role requires, so these narrowings only
		// restate what the bindings above guarantee.
		if (camera === undefined || !isCamera(camera)) return { ok: false, reason: 'roleUnresolved', detail: 'device of role guideCamera is not a camera' }
		if (guideOutput === undefined || !isGuideOutput(guideOutput)) return { ok: false, reason: 'roleUnresolved', detail: 'device of role guideOutput is not a guide output' }

		requests.push({ key: localGuiderCameraKey(camera) }, { key: localGuiderOutputKey(guideOutput) })

		return undefined
	}

	// Requests the active session to stop and resolves once it is fully torn down. Stopping an unknown or
	// already finished session is a no-op that resolves immediately.
	async stop(sessionId: string): Promise<SequencerSession | undefined> {
		const active = this.#active

		if (active === undefined || active.id !== sessionId) return this.#store.session(sessionId)

		// The terminal pipeline is never interrupted (§8.6). A stop that arrived while it is already running
		// is recorded as a no-op by the reducer; a direct call must do the same instead of cancelling a park.
		if (active.finalizing || active.finalized) return await active.done.promise

		// The stop intent is persisted first, but a store refusal must not decide whether the session stops:
		// the action would keep running, holding the reservation and the claim, waiting on a signal that was
		// never aborted because the write failed.
		this.#commitBestEffort(active, { desiredState: 'stopped' })

		// The session signal always goes down: it is what ends the waits the walk takes between actions and what
		// releases a hold, and a stop that left the walk sitting in either would be waiting for itself.
		active.controller.abort('aborted')

		// The action itself is cancelled only under the immediate stop mode. A graceful stop exists precisely so
		// the frame that is already on the sensor finishes and becomes durable, and the walk then leaves the plan
		// at the next boundary of §11.3 instead of throwing the exposure away.
		if (sequencerCancelsActiveAction('stopped', active.plan.compiled.execution)) await this.#cancelActiveAction(active)

		return await active.done.promise
	}

	// Cancels the action that is running and waits for its cleanups, then arms the session with a fresh
	// cancellation source.
	//
	// Both halves are needed: the controller stops an action that is merely waiting, and the cancellation by
	// reservation owner reaches every operation tree it started, including the ones the runtime holds no handle
	// for. The latter resolves only after their cleanups ran, which is why the new state is never reported before
	// it does — reporting early would leave a device mid-command while the UI says nothing is running (§12).
	//
	// The replacement is what makes an immediate pause resumable: the walk that wakes up runs a node again, and a
	// spent signal would abort it before it commanded anything. A session that is stopping never reaches for the
	// new one, and arming it on the single path is what guarantees a resume is never handed a spent signal.
	//
	// The drain is the non-terminal form for the same reason. Neither caller is giving the reservation up: a
	// pause resumes into it and an immediate stop runs its terminal pipeline under it, so closing it for good
	// here would refuse the resumed action and every park and warm of the finalize as `reservation has been
	// cancelled`. The reservation is released by the finalization and by the shutdown, which is where the
	// terminal form belongs and where it stayed.
	//
	// The guiding session is the one root the drain leaves alone, for the same reason. It is a root of this
	// reservation rather than a tree of the action, because a connection outlives every command issued through
	// it, so draining it would disconnect the guider of a session that is only being interrupted: the binding
	// left behind names a session that no longer exists, and nothing on the resume path reconnects it, which is
	// a night whose remaining frames are exposed unguided while the interlock and the dither silently find
	// nothing to command. It is released where every other resource of the session is, by the finalization and
	// by the shutdown.
	async #cancelActiveAction(active: ActiveSession) {
		active.action.abort('aborted')
		await this.#coordinator.drainByReservationOwner(active.owner, 'aborted', active.guider)
		active.action = new AbortController()
	}

	// Ends the sequencer with the process (§20.2), in the only order that leaves no device commanded.
	//
	// It is not the finalization pipeline: shutting down ends the night, it does not conclude it, so no
	// terminal state is written and nothing quiesces the way a completed session does. The session is recorded
	// as `interrupted`, which is what it is — ended by the process, not stopped by the operator and not failed
	// — and the day a session stops dying with the process, that record is the only step that changes.
	//
	// The steps are ordered against each other, not merely listed. New sessions are refused first, so nothing
	// starts behind the shutdown; the state is written before anything is cancelled, because the caller's
	// `cancelAll` would otherwise tear down operations whose session was never recorded; the cancellation is by
	// reservation owner and not by the handles this runtime keeps, which is what catches the owned guiding
	// session whose handle lives in the guider commander and which would otherwise escape past the release;
	// and the reservation is released only after those cleanups ran, so no third party is handed a device that
	// is still moving.
	//
	// Resolves once the session let go of everything. A runtime with nothing running resolves immediately, and
	// calling it twice waits for the first one instead of starting a second.
	async shutdown(): Promise<void> {
		this.#closed = true

		const active = this.#active

		if (active === undefined) return

		// A finalization already in flight owns the release path: it cancels the same operations by the same
		// owner and runs the same teardown, and a second one would commit over it. What the shutdown needs from
		// it is not to start another but to wait for this one, because everything the caller does next —
		// cancelling every remaining operation, disposing the devices — is exactly what this method exists to
		// keep behind the cleanups of the session.
		if (active.finalizing) {
			await active.done.promise
			return
		}

		// The action still runs until its cancellation lands, and its natural finalization must not race this
		// one: whichever committed first would be overwritten by the other, and both would run the teardown.
		active.finalizing = true

		// The cancellation is the next thing that happens to the action, so the record of the interruption shows
		// the session cancelling and not an action the process is about to take away.
		if (active.activity !== undefined) active.activity = { ...active.activity, state: 'cancelling' }

		this.#commitBestEffort(active, {
			state: 'interrupted',
			desiredState: 'stopped',
			events: [{ type: 'stateChanged', state: 'interrupted', nodeId: active.activity?.nodeId, detail: 'the process is shutting down' }],
		})

		try {
			// Every signal goes down here and only here: the terminal pipeline exists to survive a stop, not the
			// process ending, and a finalization still running would otherwise hold the release behind it. The
			// action is cancelled under either stop mode, because a graceful stop is a promise about a session that
			// is ending on its own terms and not about one whose process is going away.
			active.terminal.abort('aborted')
			active.controller.abort('aborted')
			active.action.abort('aborted')
			await this.#coordinator.cancelByReservationOwner(active.owner, 'aborted')
		} catch (e) {
			// A cleanup that misbehaved does not entitle the session to keep the devices past this point.
			console.error('sequencer shutdown cancellation failed:', active.id, e)
		} finally {
			active.teardown.run((error) => console.error('sequencer shutdown teardown failed:', active.id, error))

			this.#plans.delete(active.id)
			this.#active = undefined
			active.artifacts.length = 0
			active.done.resolve(this.#store.session(active.id))
		}
	}

	// Issues one operator command against a session and reports what it did.
	//
	// The command is never refused at the edge: it enters the control lane, the fold decides whether it acts,
	// and the record of a command that did nothing is committed with the reason it did nothing. A transport
	// that decided instead would have to answer for the state machine, and it would answer late.
	//
	// A pause records the state the session converges to and does not itself stop anything: the walk observes
	// the desired state at the boundaries §11.3 declares — before a frame and, under the immediate mode, at the
	// end of the exposure that is running — and holds there, keeping its cursor, its progress and its
	// reservation until a resume or a stop arrives. The state therefore still says `running` between the command
	// and the boundary the walk reaches. A stop is different and is carried through here, because the stop path
	// is the one that also cancels and releases.
	//
	// Commands are serialized against each other, and the queue is not enough for it: the fold is synchronous,
	// but what a command does after folding is not — an immediate pause cancels the running action, which awaits.
	// A second command folding during that window reads a state its predecessor has not established yet, so a
	// resume could persist `running` while the pause it answers is still tearing the action down, and two
	// cancellations could race on the controller that replaces the spent one. Chaining makes one command's whole
	// effect the state the next one folds against.
	//
	// A command that arrives on an idle runtime folds on the spot rather than a microtask later, so the state a
	// caller reads right after awaiting it is the one its own command produced and not one the walk reached in
	// between.
	control(sessionId: string, kind: 'pause' | 'resume' | 'stop'): Promise<SequencerControlResult> {
		const released = Promise.withResolvers<void>()
		const pending = this.#controlling
		const commanded = pending === undefined ? this.#control(sessionId, kind, released.resolve) : pending.then(() => this.#control(sessionId, kind, released.resolve))

		// The chain carries no failure: a command that rejected is reported to its own caller, and the next one
		// still runs. Its rejection is answered here so the tail is never an unhandled one. The tail also ends at
		// the early release a stop takes, since the terminal pipeline it then waits for is not part of the effect
		// the next command folds against — and a pause commanded from inside a finalize action would otherwise be
		// waiting for the very pipeline it is running in.
		const tail = Promise.race([
			released.promise,
			commanded.then(
				() => undefined,
				() => undefined,
			),
		])

		this.#controlling = tail

		void tail.then(() => {
			if (this.#controlling === tail) this.#controlling = undefined
		})

		return commanded
	}

	// Reduces one operator command. Never called directly: `control` is what serializes it.
	//
	// `release` ends the serialization early and is called before waiting for anything that is no longer part of
	// the state the next command folds against.
	async #control(sessionId: string, kind: 'pause' | 'resume' | 'stop', release: () => void): Promise<SequencerControlResult> {
		const stored = this.#store.session(sessionId)

		if (stored === undefined) return { ok: false, reason: 'unknownSession' }

		const active = this.#active?.id === sessionId ? this.#active : undefined

		// A session nobody is running has no lane of its own to serialize against: nothing else submits to it,
		// so reducing the command on the spot is the same fold over the same single command.
		const queue = active?.intents ?? new SequencerIntentQueue()

		queue.submit(kind, this.#now())

		const reduction = queue.drain(stored.state, stored.desiredState)
		const outcome = reduction.outcomes.at(-1)!
		const events = reduction.outcomes.map<SequencerEventDraft>((it) => ({ type: 'policyApplied', detail: it.noop === undefined ? `${it.intent.kind} accepted` : `${it.intent.kind} did nothing: ${SEQUENCER_INTENT_NOOP_DETAIL[it.noop]}` }))

		if (outcome.effect === 'stop') {
			// A session nobody is executing ends here and now: there is no action to settle, nothing to cancel and
			// no reservation to give back, so recording only the desire would leave it non-terminal forever — the
			// state a session created and never started would otherwise be stuck in, which is also what keeps its
			// definition undeletable. The stop path of a running session already persists the desired state, so
			// committing it here too would write it twice.
			let session: SequencerSession | undefined

			if (active === undefined) {
				session = this.#commitControl(stored, { state: 'stopped', desiredState: 'stopped', events: [...events, { type: 'stateChanged', state: 'stopped' }] })
			} else {
				// The stopped desire has to land before `release()`: the next command is scheduled on the
				// microtask that `release` unblocks, and an `await` at the top of `stop` would let a resume
				// persist `running` over a session that is already leaving.
				this.#commitBestEffort(active, { desiredState: 'stopped', events })

				release()

				session = await this.stop(sessionId)
			}

			return { ok: true, effect: outcome.effect, noop: outcome.noop, session: session ?? stored }
		}

		const change = { desiredState: outcome.effect === 'none' ? undefined : reduction.desiredState, events }
		const session = active === undefined ? this.#commitControl(stored, change) : this.#commitBestEffort(active, change)

		if (reduction.desiredState !== 'paused') {
			// The desired state is written before the hold is released, so the walk that wakes up reads the state
			// this command produced and not the one it was holding on.
			active?.resume?.resolve()
		} else if (outcome.effect !== 'none' && active?.capturing === true && sequencerCancelsActiveAction('paused', active.plan.compiled.execution)) {
			// An immediate pause does not wait for a boundary: it cancels what is running and the walk holds where
			// the cancellation left it, which is the whole difference between the three pause modes. The cancelled
			// action reports `aborted`, the desired state written above is what attributes it to this command, and
			// the slot policy therefore holds the slot on the cursor without spending an attempt on the operator
			// (§8.3). A command that changed nothing cancels nothing: the session it would interrupt is already
			// paused or already converging to it.
			//
			// Only the target block is cancelled, because it is the only phase that carries the attribution. The
			// guider connection runs under no action signal at all and the startup pipeline runs under the wait
			// signal, which a pause deliberately never aborts: the drain would still reach their operations through
			// the reservation, and the `aborted` they answered with would be read as an ordinary failure — the
			// guider becoming an unreachable one that fails the session, a required startup action failing the
			// night instead of holding it for the resume. Both phases are attended anyway, at the `afterAction`
			// boundary the walk takes in front of every step, so the pause is honored without cancelling anything.
			await this.#cancelActiveAction(active)
		}

		return { ok: true, effect: outcome.effect, noop: outcome.noop, session: session ?? stored }
	}

	// Applies one control change to a session this runtime is not executing, under the revision the store
	// currently holds. Nothing else writes such a session, so a mismatch is not retried: it means a second
	// writer exists, and the command is reported as it was stored rather than forced over the other one.
	#commitControl(stored: SequencerSession, change: { readonly state?: SequencerSessionState; readonly desiredState?: SequencerDesiredState; readonly events: readonly SequencerEventDraft[] }) {
		const result = this.#store.commit({ sessionId: stored.id, expectedRevision: stored.revision, state: change.state, desiredState: change.desiredState, events: change.events })

		if (!result.ok) {
			console.error('sequencer control commit refused:', stored.id, result.reason)
			return undefined
		}

		this.#observed(result)

		return result.session
	}

	// Resolves once the active session finished, or immediately when nothing is running.
	settled(sessionId: string): Promise<SequencerSession | undefined> {
		const active = this.#active
		return active === undefined || active.id !== sessionId ? Promise.resolve(this.#store.session(sessionId)) : active.done.promise
	}

	// Closes the guiding session this runtime opened, before the reservation is released.
	//
	// The connection is a root under the reservation token and is not an action of the plan, so the terminal
	// pipeline's `stopGuiding` leaves it attached. Releasing the reservation while it is still open would keep
	// the logical guider keys occupied and refuse the next start the way an idle PHD2 session does.
	async #closeGuider(active: ActiveSession) {
		if (active.guider === undefined) return

		const disconnect = this.#guiding.guiderCommander.disconnect?.bind(this.#guiding.guiderCommander)

		if (disconnect !== undefined) {
			const closed = await disconnect(active.guider)

			if (!closed.ok) console.error('sequencer guider disconnect failed:', active.id, closed.reason, closed.error)
		}

		active.guider = undefined
	}

	// Opens the guiding session the plan declares and binds it to every action of the session.
	//
	// This is the `open` hook of the executor host, so the walk calls it after the scheduled wait and before its
	// first action, which is the only window that works: the connection acquires the guider resources under the
	// reservation token, so it takes the very keys the session already reserved for it instead of competing with
	// itself for them, and a guider bound after the walk started would leave the first frames exposed with the
	// corrections off. A refusal is an ordinary primary outcome of the walk, which is what keeps the finalize
	// pipeline running for it.
	//
	// A session whose plan declares no guider opens nothing and leaves the binding absent, which is what the
	// dither and the guiding interlock read as "this session guides through no guider".
	//
	// Returns the failure that stops the session, or undefined when there was nothing to open or it opened.
	async #openGuider(active: ActiveSession): Promise<SequencerFailure | undefined> {
		const declared = active.plan.compiled.guider

		if (declared === undefined) return undefined

		const { connection } = declared
		let request: GuiderConnect

		if (connection.mode === 'remote') {
			request = { mode: 'remote', host: connection.host, port: connection.port }
		} else {
			const camera = active.roles.get('guideCamera')?.device
			const guideOutput = active.roles.get('guideOutput')?.device

			// The lowering requires both roles of a local guider and the bootstrap reserved them, so a session
			// reaching this without them is one whose devices went away between the reservation and the first node.
			if (camera === undefined || guideOutput === undefined) return { reason: 'disconnected', detail: 'the local guider devices are no longer available' }

			// The focal length is millimetres on both sides, so it travels as declared.
			request = { mode: 'local', focalLength: connection.focalLength, camera: camera.id, guideOutput: guideOutput.id }
		}

		const opened = await this.#guiding.guiderCommander.connect(request, active.reservation.token)

		if (!opened.ok) return { reason: opened.reason, detail: opened.error ?? 'the guider session could not be opened' }

		active.guider = opened.value.id

		return undefined
	}

	// Walks the plan and finalizes on what it ended as.
	async #execute(active: ActiveSession) {
		let outcome: SequencerExecutionOutcome | undefined

		try {
			outcome = await runSequencerPlan(this.#host(active))
		} catch (e) {
			// An exception escaping the walk is a defect, not an operational outcome, so it fails the session
			// with a normalized cause instead of turning into an unhandled rejection.
			console.error('sequencer plan failed unexpectedly:', active.id, e)
		}

		await this.#finalize(active, outcome)
	}

	// Everything the executor is allowed to reach of the session, which is the whole impure half of the walk.
	#host(active: ActiveSession): SequencerExecutorHost {
		return {
			sessionId: active.id,
			plan: active.plan.compiled,
			storage: active.plan.storage,
			// Read through a getter and never captured: an immediate pause cancels the action and the walk that
			// resumes must be handed the controller that replaced the spent one.
			get signal() {
				return active.action.signal
			},
			waitSignal: active.controller.signal,
			terminalSignal: active.terminal.signal,
			now: this.#now,
			preparation: this.#preparation,
			guiding: this.#guiding,
			handler: (type) => this.#registry.handler(type),
			context: (nodeId, attempt, signal, frame) => this.#context(active, nodeId, attempt, signal, frame),
			observe: (filter) => this.#observation(active, filter),
			desiredState: () => this.#store.session(active.id)?.desiredState ?? 'running',
			slotAttempt: (logicalSlotId) => sequencerSlotAttempt(this.#store.artifacts(active.id), logicalSlotId),
			hold: (nodeId) => this.#hold(active, nodeId),
			capturing: () => void (active.capturing = true),
			finalizing: () => this.#enterFinalizing(active),
			commit: (checkpoint, events) => this.#commitBestEffort(active, { checkpoint, events }) !== undefined,
			delay: async (delay, signal) => void (await abortableDelay(delay, signal)),
			open: () => this.#openGuider(active),
		}
	}

	// Holds the walk at a safe point for as long as the session is meant to stay paused, and answers with the
	// state the operator converged it to.
	//
	// This is where a pause becomes a real one. The walk reaches here both when the operator already asked for
	// `paused` and when a failure policy or a handler answered `pause` without writing that desire — the default
	// of a meridian flip that cannot recover is exactly that. A session still marked `running` is therefore
	// paused here rather than returned to the caller: bouncing off would retry the same node forever, which is
	// the loop the slot budget exists to rule out and which a policy pause is the opposite of.
	//
	// A stop already in place, or the abort of the session, is left alone. The reservation is kept for the whole
	// hold — that is what makes the resume possible (§11.3) — and the state is published as `paused` so a reader
	// sees a session that is waiting rather than one that is merely slow.
	//
	// The abort of the session releases the hold as surely as a resume does, and it has to: `stop` waits for the
	// walk to unwind before it reports, so a hold that only listened for the operator would deadlock the very
	// command meant to end it. An abort answers `stopped`, which is what the walk carries into the finalization.
	async #hold(active: ActiveSession, nodeId: string): Promise<SequencerDesiredState> {
		if (active.controller.signal.aborted) return 'stopped'

		const desired = this.#store.session(active.id)?.desiredState ?? 'running'

		if (desired === 'stopped') return 'stopped'

		// A policy or handler asked the walk to hold. That is itself a pause: without writing the desire here, a
		// session that is still `running` would bounce off this method and retry the same node forever.
		if (desired !== 'paused') {
			this.#commitBestEffort(active, { desiredState: 'paused', events: [{ type: 'policyApplied', nodeId, detail: 'pause accepted' }] })
		}

		this.#commitBestEffort(active, { state: 'paused', events: [{ type: 'stateChanged', state: 'paused', nodeId }] })

		const resume = Promise.withResolvers<void>()
		const release = () => resume.resolve()

		active.resume = resume
		active.controller.signal.addEventListener('abort', release, { once: true })

		try {
			await resume.promise
		} finally {
			active.controller.signal.removeEventListener('abort', release)
			active.resume = undefined
		}

		// Only an explicit resume puts the session back on its feet. Anything else — a stop, the process ending,
		// a store that lost the session — ends it, and reporting it as running would restart a walk whose devices
		// are already being taken away.
		if ((this.#store.session(active.id)?.desiredState ?? 'stopped') !== 'running') return 'stopped'

		this.#commitBestEffort(active, { state: 'running', events: [{ type: 'stateChanged', state: 'running', nodeId }] })

		// A pause is not overhead: pairing the last exposure before it with the first one after it would
		// report the hold as the interval the estimate projects, and a session that sat still for an hour
		// would then look an hour behind for the rest of the night.
		active.meter.reset()

		return 'running'
	}

	// Builds the execution context of one node and puts that node in the foreground of the session.
	//
	// The activity is set here rather than by the walk, because the context is created exactly once per attempt
	// of a node: an observer that reads the snapshot between two nodes sees the one that is actually running.
	#context(active: ActiveSession, nodeId: string, attempt: number, signal: AbortSignal, frame?: SequencerFrameSlot): SequencerActionContext {
		if (active.activity?.nodeId !== nodeId || active.activity.attempt !== attempt) {
			this.#endExposure(active)
			active.activity = { nodeId, type: active.types.get(nodeId) ?? nodeId, state: 'running', attempt, startedAt: this.#now() }
		}

		return {
			sessionId: active.id,
			nodeId,
			attempt,
			scope: active.scope,
			signal,
			now: this.#now,
			request: (role) => active.roles.get(role),
			progress: (progress) => this.#report(active.id, nodeId, progress),
			artifact: (artifact) => this.#register(active, artifact),
			auxiliary: (kind, extension) => this.#auxiliary(active, kind, extension),
			guider: active.guider,
			checkpoint: this.#checkpoint(active),
			frame,
		}
	}

	// Reads the observatory once for one safe point, resolving the requested filter reference against the wheel
	// the session actually holds.
	//
	// Every field is absent when the session does not carry the role or the device publishes nothing for it,
	// which is what the executor reads as "this dimension is not decidable" rather than as a value.
	//
	// The hour angle is the one field no device publishes: it is derived from the local sidereal time of the
	// site the mount reports and the right ascension it is pointing at, both at date, and it is normalized to
	// `-PI..PI` so a negative value is a target still east of the meridian. It is what the flip trigger and the
	// pre-exposure guard are decided from, so a mount that publishes no site or no coordinates leaves the
	// dimension undecidable rather than answering zero.
	#observation(active: ActiveSession, filter?: SequencerFilterReference): SequencerSafePointObservation {
		const mount = active.roles.get('mount')?.device
		const camera = active.roles.get('camera')?.device
		const wheel = active.roles.get('wheel')?.device
		const observation: {
			hourAngle?: number
			pierSide?: SequencerSafePointObservation['pierSide']
			preFlipPierSide?: PierSide
			sensorTemperature?: number
			temperature?: number
			installedFilter?: string
			filter?: string
		} = {}

		if (mount !== undefined && isMount(mount)) {
			const lst = localSiderealTime(makeTime(this.#now(), mount.geographicCoordinate), mount.geographicCoordinate, true)
			const hourAngle = normalizePI(lst - mount.equatorialCoordinate.rightAscension)

			observation.hourAngle = hourAngle

			if (mount.hasPierSide) {
				observation.pierSide = mount.pierSide

				// The side the mount is on while the target is still east of the meridian is the side that means the
				// flip has not happened yet, and it is taken from the mount itself rather than assumed: a session
				// re-reads it for as long as the target is east of the meridian, so whatever convention the mount
				// publishes is the one the flip is decided against.
				if (hourAngle < 0 && mount.pierSide !== 'NEITHER') active.preFlipPierSide = mount.pierSide

				// Without a sample east of the meridian the pre-flip side is unknown. Guessing WEST would flip a
				// session that started already west, or a driver with the opposite convention, and the guard
				// already fails when the sides cannot be told apart.
				observation.preFlipPierSide = active.preFlipPierSide
			}
		}

		if (camera !== undefined && isCamera(camera) && camera.hasThermometer) {
			observation.sensorTemperature = camera.temperature
			// The sensor is the only thermometer every session has, and focus drift is measured against whatever
			// the session can read: an ambient probe would be the better one and no role of the definition names it.
			observation.temperature = camera.temperature
		}

		if (wheel !== undefined && isWheel(wheel)) {
			observation.installedFilter = wheel.names[wheel.position]

			// The requested reference is resolved through the same wheel the frame is exposed through, so a group
			// addressing a filter by position is comparable with the installed name instead of reading as a change
			// nobody made.
			if (filter !== undefined) {
				const slot = sequencerFilterSlot(wheel, filter)
				if (slot !== undefined) observation.filter = wheel.names[slot]
			}
		}

		return observation
	}

	// Publishes the session as `finalizing`, once, when the walk is about to enter the terminal pipeline.
	//
	// The phase is what the session is really doing: parking a mount and warming a camera are minutes in which
	// nothing of the plan is left to run, and publishing them as `running` both misreports the night and lets
	// the intent reducer accept a pause or a resume the terminal pipeline never honors. Recording it here also
	// keeps `#finalize` from committing the same transition a second time once the walk returns.
	#enterFinalizing(active: ActiveSession) {
		// The target block is over whether or not the transition is written here, and what the flag decides is
		// whether a command still cancels what is running: the terminal pipeline is never interrupted (§8.6).
		active.capturing = false

		if (active.finalized) return

		active.finalized = true

		this.#commitBestEffort(active, { state: 'finalizing', events: [{ type: 'stateChanged', state: 'finalizing', nodeId: active.activity?.nodeId }] })
	}

	// Moves the session to its terminal state, releases everything, and settles the waiters.
	//
	// Nothing in here may prevent the release: whatever the durable state ends up being, the devices and the
	// process claim have to come back, or a single refused write would keep the observatory hostage.
	async #finalize(active: ActiveSession, outcome?: SequencerExecutionOutcome) {
		if (active.finalizing) return

		active.finalizing = true
		// The walk is over, including a plan that ran no terminal pipeline and therefore never published the
		// finalizing phase. Nothing of the plan is under the action signal any more.
		active.capturing = false

		const node = active.activity?.nodeId

		try {
			// The walk returned and its operations are about to be cancelled, so what the foreground shows from
			// here on is the cleanups running and not an action still doing work.
			if (active.activity !== undefined) active.activity = { ...active.activity, state: 'cancelling' }

			// A walk that ran the terminal pipeline already published the phase, so the transition is not repeated
			// and no second `finalizing` event is written for one session. The commit itself still happens: it is
			// what publishes the foreground as cancelling, which is the only notice a reader gets that what is
			// running now is the cleanups.
			const transition: readonly SequencerEventDraft[] = active.finalized ? [] : [{ type: 'stateChanged', state: 'finalizing', nodeId: node }]

			active.finalized = true

			this.#commitBestEffort(active, { state: 'finalizing', events: transition })

			// Nothing the session started may still be touching a device when the reservation is released, or the
			// devices would be handed to a third party mid-quiescing.
			active.terminal.abort('aborted')
			active.controller.abort('aborted')
			active.action.abort('aborted')
			await this.#coordinator.cancelByReservationOwner(active.owner, 'aborted')
			await this.#closeGuider(active)

			// A walk that threw produced no outcome at all, which is a defect of this process and not a night that
			// ended: it fails the session with the cause the exception was normalized to.
			const state: SequencerSessionState = outcome?.terminal.state ?? 'failed'
			const events: SequencerEventDraft[] = [{ type: 'stateChanged', state, nodeId: node }]

			// A finalize action that failed or never ran is recorded whatever the terminal state is: a park that
			// did not happen after a successful capture is what the operator has to know about in the morning.
			for (const issue of outcome?.terminal.issues ?? []) {
				events.push({ type: 'policyApplied', nodeId: issue.nodeId, detail: `finalize ${issue.outcome}${issue.reason === undefined ? '' : `: ${issue.reason}`}` })
			}

			// Nothing is in the foreground of a session that ended, and this commit is the last one an observer
			// sees for it: leaving the activity in place would publish the session as completed and still running
			// an action, with nothing behind it to correct that afterwards.
			this.#endExposure(active)
			active.activity = undefined

			this.#commitBestEffort(active, {
				state,
				// A terminal session converges nowhere: it is not running and never will be again. Carrying the
				// previous desire over would leave every completed session asking to run, and a stop that arrived
				// while this very finalization was awaiting the cleanups would look like an intent the runtime
				// ignored. The action result still decides the state — a stop reaching a session whose only action
				// already completed does not turn that run into a stopped one.
				desiredState: 'stopped',
				failure: outcome?.terminal.failure ?? (outcome === undefined ? { reason: 'unexpectedState', detail: 'the plan ended with an unexpected error' } : undefined),
				checkpoint: outcome === undefined ? undefined : { ...outcome.checkpoint, cursor: undefined },
				events,
			})
		} catch (e) {
			// Cancelling the operation trees is the remaining step that can reject, and its failure says a
			// cleanup misbehaved, not that the session may keep the devices.
			console.error('sequencer finalization failed:', active.id, e)
		} finally {
			// The claim is released here, after the cleanups and the reservation, and never on reaching the
			// terminal state, which still had this work behind it.
			active.teardown.run((error) => console.error('sequencer teardown failed:', active.id, error))

			// A terminal session never starts again, so its plan is dead weight the process would otherwise
			// carry until it exits.
			this.#plans.delete(active.id)

			this.#active = undefined
			active.artifacts.length = 0
			active.done.resolve(this.#store.session(active.id))
		}
	}

	// Applies one change on the release path, retrying once without the pending artifacts when the store
	// refuses, and returning undefined rather than throwing when it refuses again.
	//
	// A refusal reachable here comes from what the action registered — two committed artifacts for the same
	// logical slot, for instance — and dropping those artifacts is a far smaller loss than a session left
	// holding its reservation. The retry also realigns the revision, so a refusal caused by a stale guard
	// settles on the second attempt. Every caller of this is a step that has to keep going regardless of what
	// the store accepted.
	#commitBestEffort(active: ActiveSession, change: SessionChange) {
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				return this.#commit(active, change)
			} catch (e) {
				console.error('sequencer commit refused while releasing the session:', active.id, e)

				active.artifacts.length = 0
				active.revision = this.#store.session(active.id)?.revision ?? active.revision
			}
		}

		return undefined
	}

	// Stages one artifact registration, writing it on its own when it is the `pending` record.
	//
	// `pending` exists to survive a crash: it is registered before the file write starts precisely so that a
	// recovery finds a record for the attempt that was in flight instead of a file no session ever claimed.
	// Holding it in memory until the session finalizes is exactly the window the status was invented to close,
	// so it is committed here, immediately. The terminal statuses do not need that and are left staged for the
	// unit that also writes the state transition: an action registers `committed` once the file is durable, and
	// a crash that loses the promotion leaves the record `pending`, which a resume already handles by
	// re-executing the same attempt against the file it finds.
	//
	// The pending record is written alone, ahead of everything already staged, and a refusal is raised to the
	// caller. Both follow from the guarantee: swallowing the refusal would let the action write a file with no
	// record behind it, which is the very state `pending` exists to make impossible, and letting the write share
	// the unit of a draft the store already refused would take the record down with it. Registering a terminal
	// status cannot fail this way, because it is only staged.
	#register(active: ActiveSession, artifact: SequencerArtifactDraft) {
		if (artifact.status !== 'pending') {
			active.artifacts.push(artifact)
			return
		}

		const staged = active.artifacts.splice(0)

		active.artifacts.push(artifact)

		try {
			this.#commit(active, {})
		} finally {
			// A successful commit emptied the buffer and a refusal left the draft in it; either way the staged
			// drafts go back in front of what remains, in the order the action registered them.
			for (let i = staged.length - 1; i >= 0; i--) active.artifacts.unshift(staged[i])
		}
	}

	// Reserves the destination of one auxiliary image and proves it is contained on the filesystem it will be
	// written to.
	//
	// The ordinal is consumed whether or not the composition succeeds, because the name it produced must not
	// be handed out again by a later call that happens to succeed: a refusal here is about the directory, not
	// about the name, and reusing the name after the directory is repaired would overwrite the earlier image.
	#auxiliary(active: ActiveSession, kind: SequencerAuxiliaryKind, extension: string): SequencerAuxiliaryTarget | undefined {
		const storage = active.plan.storage
		const ordinal = active.auxiliaries.get(kind) ?? 1
		active.auxiliaries.set(kind, ordinal + 1)

		const fileName = sequencerAuxiliaryFileName(kind, ordinal, extension)
		const resolution = sequencerVerifiedAuxiliaryPath(storage, kind, fileName)

		if (!resolution.ok) {
			console.error('sequencer auxiliary path refused:', active.id, resolution.reason)
			return undefined
		}

		return { directory: sequencerAuxiliaryDirectory(storage, kind), fileName, path: resolution.path }
	}

	// Opens the live exposure the snapshot reads, pairing it with the previous end so the overhead meter
	// can close the interval between two frames.
	#beginExposure(active: ActiveSession, total: number) {
		if (active.exposure !== undefined) return

		const at = this.#now()

		active.meter.exposureStarted(at)
		active.exposure = { startedAt: at, total }
	}

	// Closes the live exposure. Called when the frame settles, when another node starts, and when the
	// session ends, so a snapshot never shows a shutter that is no longer open.
	#endExposure(active: ActiveSession) {
		if (active.exposure === undefined) return

		active.meter.exposureEnded(this.#now())
		active.exposure = undefined
	}

	// Hands one progress report to the observer, if any, without letting it reach the action.
	//
	// Progress is presentation and never a source of truth. A sink that throws — a fanout over a transport
	// that just died, typically — would otherwise surface inside the handler that called `context.progress`
	// and end a perfectly good session as `commandFailed`.
	#report(sessionId: string, nodeId: string, progress: SequencerActionProgress) {
		const active = this.#active

		// The report is also what the derived snapshot reads, so it is recorded before it is fanned out: an
		// observer that never runs still leaves the live half current.
		if (active?.id === sessionId && active.activity?.nodeId === nodeId) {
			if (progress.exposure !== undefined) this.#beginExposure(active, progress.exposure)
			if (progress.fraction === 1) this.#endExposure(active)

			active.activity = {
				...active.activity,
				state: progress.wait === undefined ? 'running' : 'waiting',
				progress: progress.fraction,
				detail: progress.detail,
				wait: progress.wait,
			}
		}

		try {
			this.#progress?.(sessionId, nodeId, progress)
		} catch (e) {
			console.error('sequencer progress observer failed:', sessionId, nodeId, e)
		}
	}

	// Current checkpoint of the session. The store holds it, so nothing else can drift from it.
	#checkpoint(active: ActiveSession): SequencerCheckpoint {
		return this.#store.session(active.id)!.checkpoint
	}

	// Applies one durable change under the revision this runtime last wrote.
	//
	// The runtime is the only writer of an active session, so a mismatch here is a defect rather than a race
	// to retry: it means two code paths inside the runtime believe they own the same session.
	#commit(active: ActiveSession, change: SessionChange) {
		const artifacts = active.artifacts.length > 0 ? active.artifacts.slice() : undefined

		// The event announcing a committed artifact is derived here, from the artifacts this very commit
		// writes, so both land in the same atomic unit. Deriving it anywhere else means either an event for an
		// artifact the store refused, or an artifact no event ever announced.
		let events = change.events

		if (artifacts !== undefined) {
			// An action may report the same artifact more than once before the commit runs — pending, then
			// committed, then rejected for a frame the analysis threw away. The store keeps the last draft of
			// each identity, so the event has to be derived from that same collapse: reading every draft would
			// announce as committed an artifact whose stored status is not.
			const latest = new Map<string, SequencerArtifactDraft>()

			for (const artifact of artifacts) latest.set(`${artifact.logicalSlotId}#${artifact.attempt}`, artifact)

			const committed: SequencerEventDraft[] = []

			for (const artifact of latest.values()) {
				if (artifact.status === 'committed') committed.push({ type: 'artifactCommitted', nodeId: active.activity?.nodeId, detail: artifact.logicalSlotId })
			}

			if (committed.length > 0) events = events === undefined ? committed : [...events, ...committed]
		}

		const result = this.#store.commit({
			sessionId: active.id,
			expectedRevision: active.revision,
			state: change.state,
			desiredState: change.desiredState,
			failure: change.failure,
			checkpoint: change.checkpoint,
			events,
			artifacts,
		})

		if (!result.ok) throw new Error(`sequencer commit refused: ${result.reason} (session ${active.id})`)

		active.artifacts.length = 0
		active.revision = result.session.revision

		this.#observed(result)

		return result.session
	}
}

// Names the device bound to each role the action actually reserved.
//
// `devices` is what the definition declared and `roles` is what the start resolved, so the intersection is the
// honest answer: an optional role the block skipped is declared and commands nothing, and reporting it as
// resolved would show a device the session never took.
function resolvedDevices(devices: SequencerDevices, roles: ReadonlyMap<SequencerDeviceRole, ResourceRequest>) {
	const resolved: Partial<Record<SequencerDeviceRole, string>> = {}

	for (const role of roles.keys()) resolved[role] = devices[role]

	return resolved
}

// Every action node of a plan, in execution order.
//
// It is the set the start resolves handlers for, validates, and reserves roles from, which is why it is
// flattened once rather than discovered as the walk reaches each node.
function planActionsOf(plan: SequencerPlan): readonly SequencerPlanAction[] {
	const actions: SequencerPlanAction[] = []

	for (const node of sequencerPlanNodes(plan.root)) {
		if (node.kind === 'action') actions.push(node)
	}

	return actions
}
