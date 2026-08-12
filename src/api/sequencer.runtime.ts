import type { SequencerDeviceRole, SequencerDevices } from '#/sequencer'
import type { SequencerArtifactDraft, SequencerCheckpoint, SequencerDesiredState, SequencerEventDraft, SequencerFailure, SequencerSession, SequencerSessionState } from '#/sequencer.state'
import type { OperationCoordinator, OperationScope } from './operation'
import type { ResourceArbiter, ResourceRequest, ResourceReservation, ResourceReservationOwner } from './resource'
import { sequencerAuxiliaryFileName } from './sequencer.identity'
import { sequencerAuxiliaryDirectory, sequencerVerifiedAuxiliaryPath } from './sequencer.path'
import type { SequencerAuxiliaryKind, SequencerPathContext } from './sequencer.path'
import type { SequencerActionContext, SequencerActionProgress, SequencerActionResult, SequencerAuxiliaryTarget, SequencerBlockRegistry } from './sequencer.registry'
import type { SequencerStore } from './sequencer.store'

// Session admission, bootstrap reversal, and the V1 execution kernel of the sequencer.
//
// The runtime owns the whole life of a session: admitting it, resolving roles into real resources, holding
// the reservation, executing the plan, persisting every transition, and finalizing. It executes a single
// action per session for now, which is deliberately the least amount of orchestration that still crosses
// every seam this design depends on — gate, store, registry, reservation, coordinator — end to end.
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

// One executable action of a session.
//
// The runtime takes this directly instead of walking the compiled node tree of `sequencer.plan.ts`, because
// tree execution belongs to the scheduler and the seams this runtime exists to prove are the ones around a
// single action: admission, reservation, checkpoint, and teardown. The compiled action node has exactly this
// shape, so wiring the tree in later does not change anything here.
export interface SequencerRuntimeAction {
	// Node identity, unique within the plan and stable across a resume.
	readonly id: string
	// Block type resolved through the registry.
	readonly type: string
	// Block configuration as stored, validated by the handler before the session starts.
	readonly configuration: unknown
}

// Everything a session executes, snapshotted at creation and immutable for its whole life.
export interface SequencerRuntimePlan {
	// Definition the plan was produced from.
	readonly definitionId: string
	// Definition revision snapshotted for the session; a later edit does not affect a running one.
	readonly definitionRevision: number
	// Device id per role declared by the definition.
	readonly devices: SequencerDevices
	// Where the session writes, resolved at creation so the night and the session segment are fixed for its
	// whole life. Absent when the session writes nothing, which makes every auxiliary destination unavailable.
	readonly storage?: SequencerPathContext
	// Guiding session the actions command, absent when the session guides through none. It is resolved for
	// the session rather than declared per block, because a remote or local guider only has an id once it is
	// connected, which happens when the session starts and not when it is compiled.
	readonly guider?: string
	// Sole action of the V1 plan.
	readonly action: SequencerRuntimeAction
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
	// Wall-clock source in milliseconds since the Unix epoch, injected so tests do not depend on real time.
	readonly now?: () => number
	// Receives action progress, which is presentation only and never persisted.
	readonly progress?: (sessionId: string, nodeId: string, progress: SequencerActionProgress) => void
}

// Why a session could not be started.
// - unknownSession: no session with that id exists.
// - busy: another session holds the process claim; its id is reported.
// - notStartable: the session already ran; a started or terminal session is not restarted.
// - handlerUnresolved: the block type is missing or its version no longer matches the one recorded.
// - invalidConfiguration: the handler rejected the stored configuration.
// - roleUnresolved: a role the block commands is not declared, or its device is not present.
// - resourcesUnavailable: the resources are leased or reserved by someone else.
export type SequencerStartFailureReason = 'unknownSession' | 'busy' | 'notStartable' | 'handlerUnresolved' | 'invalidConfiguration' | 'roleUnresolved' | 'resourcesUnavailable'

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
	// Cancellation source of the running action, aborted by a stop and by finalization.
	readonly controller: AbortController
	// Resolves once the session released everything, with the last durable state the store holds.
	readonly done: PromiseWithResolvers<SequencerSession | undefined>
	// Last revision this runtime committed, used as the optimistic guard of the next commit.
	revision: number
	// Set once finalization began, so a stop arriving during it does not start a second one.
	finalizing: boolean
}

// Executes one sequencer session at a time.
export class SequencerRuntime {
	readonly #gate = new SessionAdmissionGate()
	readonly #store: SequencerStore
	readonly #registry: SequencerBlockRegistry
	readonly #coordinator: OperationCoordinator
	readonly #arbiter: ResourceArbiter
	readonly #resolve: SequencerDeviceResolver
	readonly #now: () => number
	readonly #progress?: (sessionId: string, nodeId: string, progress: SequencerActionProgress) => void
	readonly #plans = new Map<string, SequencerRuntimePlan>()
	#active?: ActiveSession

	// Wires the runtime; the arbiter comes from the coordinator so both always see the same arbitration.
	constructor(options: SequencerRuntimeOptions) {
		this.#store = options.store
		this.#registry = options.registry
		this.#coordinator = options.coordinator
		this.#arbiter = options.coordinator.arbiter
		this.#resolve = options.resolve
		this.#now = options.now ?? Date.now
		this.#progress = options.progress
	}

	// Session currently holding the process claim, or undefined when the runtime is idle.
	get activeSessionId() {
		return this.#gate.sessionId
	}

	// Creates a session in `created` for a plan, recording the handler version it was compiled against.
	// Returns undefined when the block type cannot be resolved, since such a session could never start.
	create(plan: SequencerRuntimePlan): SequencerSession | undefined {
		const resolution = this.#registry.resolve([{ type: plan.action.type }])

		if (!resolution.ok) return undefined

		const session = this.#store.createSession({ definitionId: plan.definitionId, definitionRevision: plan.definitionRevision, handlerVersions: resolution.versions })

		// The plan is snapshotted, not referenced: the definition revision and the handler versions recorded in
		// the checkpoint describe this plan as it is now, and an edit of the caller's object between `create`
		// and `start` would run something that no longer matches its own metadata. `configuration` is opaque
		// data of arbitrary shape, so the copy has to be deep.
		this.#plans.set(session.id, structuredClone(plan))

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
		const plan = this.#plans.get(sessionId)

		if (plan === undefined) {
			teardown.run()
			return { ok: false, reason: 'unknownSession', detail: 'no plan is loaded for the session' }
		}

		const handler = this.#registry.handler(plan.action.type)
		const recorded = stored.checkpoint.handlerVersions[plan.action.type]
		const resolution = this.#registry.resolve([{ type: plan.action.type, version: recorded }])

		// The version is checked again here and not only at creation, because the registry can change in
		// between and running another handler under the same block type is worse than not running at all.
		if (handler === undefined || !resolution.ok) {
			teardown.run()
			return { ok: false, reason: 'handlerUnresolved', detail: `block type ${plan.action.type} is unavailable at version ${recorded}` }
		}

		const validated = handler.validate(plan.action.configuration, { nodeId: plan.action.id, devices: plan.devices })

		if (!validated.ok) {
			teardown.run()
			return { ok: false, reason: 'invalidConfiguration', detail: validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join(', ') }
		}

		const configuration = validated.configuration
		const requests: ResourceRequest[] = []
		const roles = new Map<SequencerDeviceRole, ResourceRequest>()

		for (const binding of handler.resources(configuration)) {
			const deviceId = plan.devices[binding.role]
			const request = deviceId === undefined ? undefined : this.#resolve(binding.role, deviceId)

			if (request === undefined) {
				teardown.run()
				return { ok: false, reason: 'roleUnresolved', detail: `role ${binding.role} is not available` }
			}

			roles.set(binding.role, request)
			requests.push(request)
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
			controller: new AbortController(),
			done: Promise.withResolvers<SequencerSession | undefined>(),
			revision: stored.revision,
			finalizing: false,
		}

		this.#active = active

		const running = this.#commit(active, { state: 'running', events: [{ type: 'stateChanged', state: 'running', nodeId: plan.action.id }], checkpoint: { ...stored.checkpoint, cursor: plan.action.id, attempts: { [plan.action.id]: 1 } } })

		void this.#execute(active, handler.execute.bind(handler), configuration, roles)

		return { ok: true, session: running, reentrant: false }
	}

	// Requests the active session to stop and resolves once it is fully torn down. Stopping an unknown or
	// already finished session is a no-op that resolves immediately.
	async stop(sessionId: string): Promise<SequencerSession | undefined> {
		const active = this.#active

		if (active === undefined || active.id !== sessionId) return this.#store.session(sessionId)

		// The stop intent is persisted first, but a store refusal must not decide whether the session stops:
		// the action would keep running, holding the reservation and the claim, waiting on a signal that was
		// never aborted because the write failed.
		this.#commitBestEffort(active, { desiredState: 'stopped' })

		// Both signals are needed: the controller stops an action that is merely waiting, and the cancellation
		// by reservation owner reaches every operation tree it started, including the ones the runtime holds
		// no handle for. The latter resolves only after their cleanups ran.
		active.controller.abort('aborted')
		await this.#coordinator.cancelByReservationOwner(active.owner, 'aborted')

		return await active.done.promise
	}

	// Resolves once the active session finished, or immediately when nothing is running.
	settled(sessionId: string): Promise<SequencerSession | undefined> {
		const active = this.#active
		return active === undefined || active.id !== sessionId ? Promise.resolve(this.#store.session(sessionId)) : active.done.promise
	}

	// Runs the sole action of the plan and finalizes on its decision.
	async #execute(active: ActiveSession, execute: (context: SequencerActionContext, configuration: unknown) => Promise<SequencerActionResult<unknown>>, configuration: unknown, roles: ReadonlyMap<SequencerDeviceRole, ResourceRequest>) {
		const node = active.plan.action.id

		const context: SequencerActionContext = {
			sessionId: active.id,
			nodeId: node,
			attempt: 1,
			scope: active.scope,
			signal: active.controller.signal,
			now: this.#now,
			request: (role) => roles.get(role),
			progress: (progress) => this.#report(active.id, node, progress),
			artifact: (artifact) => this.#register(active, artifact),
			auxiliary: (kind, extension) => this.#auxiliary(active, kind, extension),
			guider: active.plan.guider,
			checkpoint: this.#checkpoint(active),
		}

		let result: SequencerActionResult<unknown>

		try {
			result = await execute(context, configuration)
		} catch (e) {
			// An exception from a handler is a defect, not an operational outcome, so it fails the session
			// with a normalized cause instead of escaping into an unhandled rejection.
			console.error('sequencer action failed unexpectedly:', active.id, node, e)
			result = { type: 'fatalFailure', reason: 'commandFailed', detail: e instanceof Error ? e.message : String(e) }
		}

		await this.#finalize(active, result)
	}

	// Moves the session to its terminal state, releases everything, and settles the waiters.
	//
	// Nothing in here may prevent the release: whatever the durable state ends up being, the devices and the
	// process claim have to come back, or a single refused write would keep the observatory hostage.
	async #finalize(active: ActiveSession, result: SequencerActionResult<unknown>) {
		if (active.finalizing) return

		active.finalizing = true

		const node = active.plan.action.id

		try {
			this.#commitBestEffort(active, { state: 'finalizing', events: [{ type: 'stateChanged', state: 'finalizing', nodeId: node }] })

			// Nothing the session started may still be touching a device when the reservation is released, or the
			// devices would be handed to a third party mid-quiescing.
			active.controller.abort('aborted')
			await this.#coordinator.cancelByReservationOwner(active.owner, 'aborted')

			const state = terminalStateOf(result)
			const events: SequencerEventDraft[] = [{ type: 'stateChanged', state, nodeId: node }]

			this.#commitBestEffort(active, {
				state,
				// A terminal session converges nowhere: it is not running and never will be again. Carrying the
				// previous desire over would leave every completed session asking to run, and a stop that arrived
				// while this very finalization was awaiting the cleanups would look like an intent the runtime
				// ignored. The action result still decides the state — a stop reaching a session whose only action
				// already completed does not turn that run into a stopped one.
				desiredState: 'stopped',
				failure: result.type === 'fatalFailure' || result.type === 'retryableFailure' ? { reason: result.reason, detail: result.detail } : undefined,
				checkpoint: { ...this.#checkpoint(active), cursor: undefined, completed: [node] },
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

		if (storage === undefined) return undefined

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

	// Hands one progress report to the observer, if any, without letting it reach the action.
	//
	// Progress is presentation and never a source of truth. A sink that throws — a fanout over a transport
	// that just died, typically — would otherwise surface inside the handler that called `context.progress`
	// and end a perfectly good session as `commandFailed`.
	#report(sessionId: string, nodeId: string, progress: SequencerActionProgress) {
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
				if (artifact.status === 'committed') committed.push({ type: 'artifactCommitted', nodeId: active.plan.action.id, detail: artifact.logicalSlotId })
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

		return result.session
	}
}

// Maps an action decision to the terminal state of a single-action session. `pause` and `suspend` have no
// resume path in V1, so a session asking for one is stopped rather than left holding devices forever.
function terminalStateOf(result: SequencerActionResult<unknown>): SequencerSessionState {
	switch (result.type) {
		case 'completed':
		case 'skipped':
			return 'completed'
		case 'retryableFailure':
		case 'fatalFailure':
			return 'failed'
		case 'pause':
		case 'suspend':
			return 'stopped'
	}
}
