import type { Sequencer } from '#/sequencer'
import type { SequencerPlan, SequencerPreflight } from '#/sequencer.plan'
import type { SequencerArtifact, SequencerEvent, SequencerSessionSnapshot } from '#/sequencer.state'
import { query, response } from './http'
import type { Endpoints } from './http'
import { compile } from './sequencer.compiler'
import { preflight } from './sequencer.preflight'
import type { SequencerBlockRegistry } from './sequencer.registry'
import type { SequencerControlResult, SequencerRuntime, SequencerRuntimePlanDraft, SequencerStartFailureReason } from './sequencer.runtime'
import { deriveSequencerSnapshot } from './sequencer.snapshot'
import type { SequencerSnapshotObservation } from './sequencer.snapshot'
import type { SequencerStore } from './sequencer.store'

// HTTP surface of the Sequencer: validate a recipe the editor is writing, start a session from that
// object, and everything a session leaves behind.
//
// Recipes are not stored. The UI edits a Sequencer, optionally posts it to validate on every change, and
// posts the same object to start. The handler owns no decision of its own. Storage is the store's, admission
// is the runtime's gate, lowering is the compiler's, and what the UI sees is derived by the snapshot module.
// What lives here is the transport shape and one thing the layers below deliberately do not do: it holds the
// lowered plan of every session it created, because the runtime executes a single action of it and the
// pre-flight view has to keep answering "why is it doing this?" for the whole plan, not for that action.
//
// Instants are milliseconds since the Unix epoch.

// Live half of a session's snapshot, which is the half no store holds: the exposure in progress, the action
// in the foreground, the triggers, and the measured overhead. It is injected rather than read, because the
// runtime that knows those values must not learn about the transport that shows them. Returning undefined —
// the ordinary case for a session nobody is executing — leaves the snapshot to the durable state alone.
export type SequencerLiveObservation = (sessionId: string) => Omit<Partial<SequencerSnapshotObservation>, 'session' | 'plan' | 'now'> | undefined

// Why a Sequencer could not be turned into a session.
// - invalidDefinition: the lowering refused it; the pre-flight view carries the diagnostics.
// - unresolvedHandler: no handler is registered for a block the session would run.
export type SequencerSessionCreationFailure = 'invalidDefinition' | 'unresolvedHandler'

// Outcome of compiling a Sequencer into a session without admitting it.
export type SequencerSessionCreation =
	| {
			readonly ok: true
			// Session as created, already in `created` and holding nothing.
			readonly session: SequencerSessionSnapshot
	  }
	| {
			readonly ok: false
			// Cause of the refusal.
			readonly reason: SequencerSessionCreationFailure
			// Pre-flight view of the refused lowering, present for `invalidDefinition` so the editor can show the
			// same diagnostics it would get from validating.
			readonly preflight?: SequencerPreflight
	  }

// Why a Sequencer could not be started. Compilation failures and admission failures share this surface
// because `POST /sequencer/sessions` does both in one call.
export type SequencerSessionStartFailure = SequencerSessionCreationFailure | SequencerStartFailureReason

// Outcome of starting a session from a Sequencer posted by the editor.
export type SequencerSessionStart =
	| {
			readonly ok: true
			// Session as observed after admission.
			readonly session: SequencerSessionSnapshot
			// True when the session was already running and this start did nothing, as an idempotent retry.
			readonly reentrant: boolean
	  }
	| {
			readonly ok: false
			// Cause of the refusal.
			readonly reason: SequencerSessionStartFailure
			// Pre-flight view of the refused lowering, present for `invalidDefinition`.
			readonly preflight?: SequencerPreflight
			// Diagnostic naming what exactly could not be resolved.
			readonly detail?: string
			// Session holding the claim, for a busy refusal.
			readonly sessionId?: string
	  }

// Executable plan of one session together with its pre-flight view. Both are the compilation the
// session actually runs and never a recompilation of the current definition, which may already have been
// edited into something else.
export interface SequencerSessionPlan {
	// Node tree, groups, and resolved policies of the session.
	readonly plan: SequencerPlan
	// Slots, limits, and projected integration derived from that plan.
	readonly preflight: SequencerPreflight
}

// Collaborators the HTTP surface is wired with.
export interface SequencerHandlerOptions {
	// Durable sessions, events, and artifacts.
	readonly store: SequencerStore
	// Owner of the session lifecycle, including the admission gate `start` delegates to.
	readonly runtime: SequencerRuntime
	// Registry every definition is compiled against, so a session is refused at creation when the block it
	// would run is not registered rather than at start, with a session already stored.
	readonly registry: SequencerBlockRegistry
	// Live half of the snapshot, absent when nothing observes the runtime.
	readonly observe?: SequencerLiveObservation
	// Wall-clock source in milliseconds since the Unix epoch, injected so tests do not depend on real time.
	readonly now?: () => number
}

export class SequencerHandler {
	readonly #store: SequencerStore
	readonly #runtime: SequencerRuntime
	readonly #registry: SequencerBlockRegistry
	readonly #observe?: SequencerLiveObservation
	readonly #now: () => number
	readonly #plans = new Map<string, SequencerSessionPlan>()

	constructor(options: SequencerHandlerOptions) {
		this.#store = options.store
		this.#runtime = options.runtime
		this.#registry = options.registry
		this.#observe = options.observe
		this.#now = options.now ?? Date.now
	}

	// Lowers a definition and returns its pre-flight view: the diagnostics that refuse it, the fields removed
	// from the executable plan, and the slots, limits and projected integration of every group. No session is
	// created and no device is reserved, which is what makes it safe to call on every keystroke.
	//
	// The definition is compiled against the registry, so a block no handler implements is reported while the
	// operator is still editing instead of at the start of the night.
	validate(definition: Sequencer): SequencerPreflight {
		return preflight(compile(definition, { registry: this.#registry }))
	}

	// Compiles a Sequencer and stores a session for the lowering it will run. No device is reserved and
	// nothing is admitted; that is `start`.
	//
	// The plan is compiled here and kept, so a later edit of the object the editor still holds changes
	// nothing about a session already created: the session copies the optional id and revision as labels,
	// and the plan it executes is the one this call produced.
	createSession(definition: Sequencer): SequencerSessionCreation {
		const compilation = compile(definition, { registry: this.#registry })
		const view = preflight(compilation)

		if (!compilation.ok) return { ok: false, reason: 'invalidDefinition', preflight: view }

		const { plan } = compilation
		const draft: SequencerRuntimePlanDraft = { compiled: plan }

		// The plan is kept before the creation is announced: the announcement is a snapshot derived through this
		// very map, and one taken without it would publish a session with no target and no estimate while the
		// answer to this same call carries both.
		const session = this.#runtime.create(draft, (created) => this.#plans.set(created.id, { plan, preflight: view }))

		if (session === undefined) return { ok: false, reason: 'unresolvedHandler' }

		return { ok: true, session: this.snapshot(session.id)! }
	}

	// Snapshot of every session the store holds, in creation order.
	sessions(): readonly SequencerSessionSnapshot[] {
		const snapshots: SequencerSessionSnapshot[] = []

		for (const session of this.#store.sessions()) {
			const snapshot = this.snapshot(session.id)

			if (snapshot !== undefined) snapshots.push(snapshot)
		}

		return snapshots
	}

	// Everything the UI observes about one session, derived on the spot from the durable state, the plan
	// of the session, and whatever the runtime is doing right now. Nothing of it is stored, and no execution
	// decision reads it back.
	snapshot(sessionId: string): SequencerSessionSnapshot | undefined {
		const session = this.#store.session(sessionId)

		if (session === undefined) return undefined

		return deriveSequencerSnapshot({
			...this.#observe?.(sessionId),
			session,
			plan: this.#plans.get(sessionId)?.plan,
			lastEventSequence: this.#store.lastEventSequence(sessionId),
			now: this.#now(),
		})
	}

	// Executable plan and pre-flight view of one session, absent for a session whose plan this process no
	// longer holds, which is every session that survived a restart.
	plan(sessionId: string): SequencerSessionPlan | undefined {
		return this.#plans.get(sessionId)
	}

	// Compiles a Sequencer, creates a session, and admits it. The handler decides nothing about whether it
	// may start: the check "is another session active?" made here is exactly the race the admission gate of
	// the runtime exists to remove.
	//
	// A session that was created and then refused at admission is stopped, so a failed start does not leave
	// a `created` record that HTTP cannot start again.
	async start(definition: Sequencer): Promise<SequencerSessionStart> {
		const active = this.#runtime.activeSessionId

		if (active !== undefined) return { ok: false, reason: 'busy', sessionId: active }

		const created = this.createSession(definition)

		if (!created.ok) return created

		try {
			const started = this.#runtime.start(created.session.id)

			if (!started.ok) {
				await this.stop(created.session.id)
				return started
			}

			return { ok: true, session: this.snapshot(created.session.id)!, reentrant: started.reentrant }
		} catch (e) {
			await this.stop(created.session.id)
			throw e
		}
	}

	// Asks the session to converge to `paused`, at the safe point its pause mode selects.
	pause(sessionId: string): Promise<SequencerControlResult> {
		return this.#runtime.control(sessionId, 'pause')
	}

	// Asks a pausing or paused session to converge back to `running`.
	resume(sessionId: string): Promise<SequencerControlResult> {
		return this.#runtime.control(sessionId, 'resume')
	}

	// Asks the session to end, and resolves once it released everything it held.
	stop(sessionId: string): Promise<SequencerControlResult> {
		return this.#runtime.control(sessionId, 'stop')
	}

	// Events of one session, in sequence order. `afterSequence` returns only the events beyond a position the
	// caller already has, which is how a client that reconnected recovers what it missed without replaying a
	// night from the beginning.
	events(sessionId: string, afterSequence?: number): readonly SequencerEvent[] {
		return this.#store.events(sessionId, afterSequence)
	}

	// Artifacts of one session, every attempt included: a rejected frame and the recapture that replaced it
	// are both part of what the night produced.
	artifacts(sessionId: string): readonly SequencerArtifact[] {
		return this.#store.artifacts(sessionId)
	}
}

// Parses the `afterSequence` query parameter, ignoring anything that is not a number so a malformed cursor
// returns the whole history instead of nothing at all.
function afterSequenceOf(value: string | undefined) {
	if (value === undefined) return undefined

	const sequence = Number(value)

	return Number.isFinite(sequence) ? sequence : undefined
}

export function sequencer(handler: SequencerHandler) {
	return {
		'/sequencer/validate': { POST: async (req) => response(handler.validate(await req.json())) },
		'/sequencer/sessions': {
			GET: () => response(handler.sessions()),
			POST: async (req) => response<SequencerSessionStart>(await handler.start(await req.json())),
		},
		'/sequencer/sessions/:id': { GET: (req) => response(handler.snapshot(req.params.id)) },
		'/sequencer/sessions/:id/plan': { GET: (req) => response(handler.plan(req.params.id)) },
		'/sequencer/sessions/:id/pause': { POST: async (req) => response<SequencerControlResult>(await handler.pause(req.params.id)) },
		'/sequencer/sessions/:id/resume': { POST: async (req) => response<SequencerControlResult>(await handler.resume(req.params.id)) },
		'/sequencer/sessions/:id/stop': { POST: async (req) => response<SequencerControlResult>(await handler.stop(req.params.id)) },
		'/sequencer/sessions/:id/events': { GET: (req) => response(handler.events(req.params.id, afterSequenceOf(query(req).afterSequence))) },
		'/sequencer/sessions/:id/artifacts': { GET: (req) => response(handler.artifacts(req.params.id)) },
	} as const satisfies Endpoints
}
