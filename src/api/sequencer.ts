import type { Sequencer } from '#/sequencer'
import type { SequencerPlan, SequencerPreflight } from '#/sequencer.plan'
import type { SequencerArtifact, SequencerDefinitionRecord, SequencerEvent, SequencerSessionSnapshot } from '#/sequencer.state'
import { query, response } from './http'
import type { Endpoints } from './http'
import { compile, sequencerPlanNodes } from './sequencer.compiler'
import { preflight } from './sequencer.preflight'
import type { SequencerBlockRegistry } from './sequencer.registry'
import type { SequencerControlResult, SequencerRuntime, SequencerRuntimePlanDraft, SequencerStartResult } from './sequencer.runtime'
import { deriveSequencerSnapshot } from './sequencer.snapshot'
import type { SequencerSnapshotObservation } from './sequencer.snapshot'
import type { SequencerDefinitionRemoval, SequencerStore } from './sequencer.store'

// HTTP surface of the Sequencer (§16.1): the definitions an editor writes, the sessions they are run as, and
// everything a session leaves behind.
//
// The handler owns no decision of its own. Storage is the store's, admission is the runtime's gate, lowering
// is the compiler's, and what the UI sees is derived by the snapshot module. What lives here is the transport
// shape and one thing the layers below deliberately do not do: it holds the lowered plan of every session it
// created, because the runtime executes a single action of it and the pre-flight view of §16.1 has to keep
// answering "why is it doing this?" for the whole plan, not for that action.
//
// Instants are milliseconds since the Unix epoch.

// Live half of a session's snapshot, which is the half no store holds: the exposure in progress, the action
// in the foreground, the triggers, and the measured overhead. It is injected rather than read, because the
// runtime that knows those values must not learn about the transport that shows them. Returning undefined —
// the ordinary case for a session nobody is executing — leaves the snapshot to the durable state alone.
export type SequencerLiveObservation = (sessionId: string) => Omit<Partial<SequencerSnapshotObservation>, 'session' | 'plan' | 'now'> | undefined

// Why a definition could not be turned into a session.
// - unknownDefinition: no definition with that id is stored.
// - invalidDefinition: the lowering refused it; the pre-flight view carries the diagnostics.
// - emptyPlan: the definition compiled to a plan with no action, so a session would have nothing to execute.
// - unresolvedHandler: no handler is registered for the block the session would run.
export type SequencerSessionCreationFailure = 'unknownDefinition' | 'invalidDefinition' | 'emptyPlan' | 'unresolvedHandler'

// Outcome of creating a session from a stored definition.
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

// Executable plan of one session together with its pre-flight view (§16.1). Both are the compilation the
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
	// Durable definitions, sessions, events, and artifacts.
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

	// Every stored definition, newest revision of each.
	definitions(): readonly SequencerDefinitionRecord[] {
		return this.#store.definitions()
	}

	// One stored definition, or undefined when no definition has that id.
	definition(id: string) {
		return this.#store.definition(id)
	}

	// Stores a new definition, assigning its id and its first revision. Returns undefined when the id the
	// payload carries is already taken, which is the only way this fails.
	create(definition: Sequencer) {
		return this.#store.createDefinition(definition)
	}

	// Replaces a stored definition with a new revision of it. Returns undefined for an unknown id.
	update(id: string, definition: Sequencer) {
		return this.#store.updateDefinition(id, definition)
	}

	// Removes a stored definition. Refused while a session that has not ended still names it.
	remove(id: string) {
		return this.#store.deleteDefinition(id)
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

	// Pre-flight view of a stored definition, which is `validate` over the revision as stored.
	validateStored(id: string): SequencerPreflight | undefined {
		const record = this.#store.definition(id)
		return record === undefined ? undefined : this.validate(record.definition)
	}

	// Creates a session for a stored definition, snapshotting the lowering it will run.
	//
	// The plan is compiled here and kept, so a later edit of the definition changes nothing about a session
	// already created: the session records the revision it was compiled from, and the plan it executes is the
	// one that revision produced. No device is reserved and nothing is admitted; that is `start`.
	createSession(definitionId: string): SequencerSessionCreation {
		const record = this.#store.definition(definitionId)

		if (record === undefined) return { ok: false, reason: 'unknownDefinition' }

		const compilation = compile(record.definition, { registry: this.#registry })
		const view = preflight(compilation)

		if (!compilation.ok) return { ok: false, reason: 'invalidDefinition', preflight: view }

		const { plan } = compilation
		const action = firstActionOf(plan)

		if (action === undefined) return { ok: false, reason: 'emptyPlan' }

		const draft: SequencerRuntimePlanDraft = {
			definitionId: record.id,
			definitionRevision: record.revision,
			devices: plan.devices,
			storage: { root: plan.storage.root, autoSubFolderMode: plan.storage.autoSubFolderMode },
			action: { id: action.id, type: action.type, configuration: action.configuration },
		}

		const session = this.#runtime.create(draft)

		if (session === undefined) return { ok: false, reason: 'unresolvedHandler' }

		this.#plans.set(session.id, { plan, preflight: view })

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

	// Everything the UI observes about one session (§15), derived on the spot from the durable state, the plan
	// of the session, and whatever the runtime is doing right now. Nothing of it is stored, and no execution
	// decision reads it back.
	snapshot(sessionId: string): SequencerSessionSnapshot | undefined {
		const session = this.#store.session(sessionId)

		if (session === undefined) return undefined

		const events = this.#store.events(sessionId)

		return deriveSequencerSnapshot({
			...this.#observe?.(sessionId),
			session,
			plan: this.#plans.get(sessionId)?.plan,
			lastEventSequence: events.at(-1)?.sequence ?? 0,
			now: this.#now(),
		})
	}

	// Executable plan and pre-flight view of one session, absent for a session whose plan this process no
	// longer holds, which is every session that survived a restart.
	plan(sessionId: string): SequencerSessionPlan | undefined {
		return this.#plans.get(sessionId)
	}

	// Starts a session. The handler decides nothing about whether it may start: the check "is another session
	// active?" made here is exactly the race the admission gate of the runtime exists to remove.
	start(sessionId: string): SequencerStartResult {
		return this.#runtime.start(sessionId)
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

// First action node of a plan in execution order, or undefined when the plan has none. It is what the V1
// runtime executes, while the plan the handler keeps stays whole for the pre-flight view.
function firstActionOf(plan: SequencerPlan) {
	for (const node of sequencerPlanNodes(plan.root)) {
		if (node.kind === 'action') return node
	}

	return undefined
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
		'/sequencer/definitions': {
			GET: () => response(handler.definitions()),
			POST: async (req) => response(handler.create((await req.json()) as Sequencer)),
		},
		'/sequencer/definitions/validate': { POST: async (req) => response(handler.validate((await req.json()) as Sequencer)) },
		'/sequencer/definitions/:id': {
			GET: (req) => response(handler.definition(req.params.id)),
			PUT: async (req) => response(handler.update(req.params.id, (await req.json()) as Sequencer)),
			DELETE: (req) => response<SequencerDefinitionRemoval>(handler.remove(req.params.id)),
		},
		'/sequencer/definitions/:id/validate': { POST: (req) => response(handler.validateStored(req.params.id)) },
		'/sequencer/definitions/:id/sessions': { POST: (req) => response<SequencerSessionCreation>(handler.createSession(req.params.id)) },
		'/sequencer/sessions': { GET: () => response(handler.sessions()) },
		'/sequencer/sessions/:id': { GET: (req) => response(handler.snapshot(req.params.id)) },
		'/sequencer/sessions/:id/plan': { GET: (req) => response(handler.plan(req.params.id)) },
		'/sequencer/sessions/:id/start': { POST: (req) => response<SequencerStartResult>(handler.start(req.params.id)) },
		'/sequencer/sessions/:id/pause': { POST: async (req) => response<SequencerControlResult>(await handler.pause(req.params.id)) },
		'/sequencer/sessions/:id/resume': { POST: async (req) => response<SequencerControlResult>(await handler.resume(req.params.id)) },
		'/sequencer/sessions/:id/stop': { POST: async (req) => response<SequencerControlResult>(await handler.stop(req.params.id)) },
		'/sequencer/sessions/:id/events': { GET: (req) => response(handler.events(req.params.id, afterSequenceOf(query(req).afterSequence))) },
		'/sequencer/sessions/:id/artifacts': { GET: (req) => response(handler.artifacts(req.params.id)) },
	} as const satisfies Endpoints
}
