import type { OperationFailureReason } from '#/orchestration'
import type { SequencerDeviceRole, SequencerDevices } from '#/sequencer'
import type { SequencerArtifactDraft, SequencerCheckpoint } from '#/sequencer.state'
import type { OperationScope } from './operation'
import type { ResourceRequest } from './resource'

// Registry of executable block handlers, and the contract every one of them implements.
//
// A block type is the stable name a definition uses; the handler is the code that runs it. Both the
// compiler and the runtime resolve a type through this registry, and both check the declared version: a
// handler that disappeared or changed version between saving a definition and starting a session must stop
// the session rather than execute something else under the same name.
//
// The registry holds no session state. It is a process-wide table populated at wiring time.

// Logical device reference declared by a block at compile time.
//
// A handler cannot return a `ResourceRequest`, because the physical key of a role is the `hardwareId` and
// that is only known with the device present, while `resources()` runs during compilation with everything
// possibly disconnected. So the handler names the role and the runtime resolves it, never the other way.
export interface ResourceBinding {
	// Device role the block commands.
	readonly role: SequencerDeviceRole
}

// What a handler may look at while validating its own configuration.
export interface SequencerValidationContext {
	// Plan node the configuration belongs to, used to build diagnostic paths.
	readonly nodeId: string
	// Roles the definition declared, so a block can reject a role it needs and the session does not have.
	readonly devices: SequencerDevices
}

// One rejected property, addressed by its path inside the definition so the editor can point at it.
export interface SequencerValidationIssue {
	// Property path relative to the definition root, such as `capture.frames[0].exposureTime`.
	readonly path: string
	// Human-readable explanation of why the value is not accepted.
	readonly message: string
}

// Outcome of validating one block configuration. Success carries the narrowed configuration the handler
// will later execute, so the runtime never re-parses what the compiler already accepted.
export type SequencerValidationResult<C> = { readonly ok: true; readonly configuration: C } | { readonly ok: false; readonly issues: readonly SequencerValidationIssue[] }

// Progress reported while an action runs. Progress is presentation: it travels over WebSocket and is never
// a source of truth, so it is deliberately not part of the checkpoint.
export interface SequencerActionProgress {
	// Fraction of the action already done, in 0..1, when the action can estimate one.
	readonly fraction?: number
	// Short human-readable description of the current step.
	readonly detail?: string
}

// Everything an action is allowed to touch while it runs. Device managers are deliberately absent: an
// action commands hardware through the scope, which is authorized by the session reservation, and receives
// domain services explicitly injected instead of reaching for them.
export interface SequencerActionContext {
	// Session executing the action.
	readonly sessionId: string
	// Plan node being executed.
	readonly nodeId: string
	// Attempt number, starting at 1 and incremented by every retry of the same node.
	readonly attempt: number
	// Scope authorized by the session reservation; every device command starts an operation here.
	readonly scope: OperationScope
	// Cancellation signal of this action, aborted when the node is cancelled or the session stops.
	readonly signal: AbortSignal
	// Wall-clock source in milliseconds since the Unix epoch, injected so actions stay testable.
	readonly now: () => number
	// Resolves a declared role into the physical request the scope can acquire, or undefined when the
	// definition does not declare that role.
	readonly request: (role: SequencerDeviceRole) => ResourceRequest | undefined
	// Reports progress; purely observational and safe to call at any rate.
	readonly progress: (progress: SequencerActionProgress) => void
	// Registers or promotes an artifact produced by the action. A `pending` registration is durable when this
	// returns, so it must be made before the file write starts; a promotion is written with the next durable
	// change of the session.
	readonly artifact: (artifact: SequencerArtifactDraft) => void
	// Read-only view of the current checkpoint. An action reads it and never writes it: the runtime owns it.
	readonly checkpoint: SequencerCheckpoint
}

// Decision an action reports back to the runtime. It is deliberately not an `OperationResult`: an operation
// says whether a device command worked, while this says what the session should do next.
//
// The handler maps a failure to `retryableFailure` or `fatalFailure`, but the final policy is the runtime's.
// `suspend` is reserved by the type and never produced in V1, so adding suspension later does not change
// every handler that already returns this union.
export type SequencerActionResult<R> =
	| { readonly type: 'completed'; readonly value: R }
	| { readonly type: 'skipped'; readonly detail?: string }
	| { readonly type: 'retryableFailure'; readonly reason: OperationFailureReason; readonly detail?: string }
	| { readonly type: 'fatalFailure'; readonly reason: OperationFailureReason; readonly detail?: string }
	| { readonly type: 'pause'; readonly detail?: string }
	| { readonly type: 'suspend'; readonly detail?: string }

// One executable block type.
export interface SequencerActionHandler<C, R> {
	// Stable block type named by the definition.
	readonly type: string
	// Handler version. It changes whenever the meaning of a configuration or of the execution changes, and
	// a session compiled against another version is refused instead of being run by this one.
	readonly version: number
	// Validates an untrusted configuration, narrowing it for execution.
	validate(configuration: unknown, context: SequencerValidationContext): SequencerValidationResult<C>
	// Declares the roles this block commands, for compile-time analysis and for the reservation set.
	resources(configuration: C): readonly ResourceBinding[]
	// Executes the block. It must return a decision rather than throw for expected failures.
	execute(context: SequencerActionContext, configuration: C): Promise<SequencerActionResult<R>>
}

// Handler as the registry stores it and as the runtime consumes it, with the configuration type erased.
//
// The erasure is what the execution path actually looks like: the configuration arrives from a stored
// definition as `unknown`, `validate` narrows it, and the narrowed value flows straight into `resources`
// and `execute` without the caller ever naming the concrete type.
export type AnySequencerActionHandler = SequencerActionHandler<unknown, unknown>

// Block type required by a compiled plan, with the version it was compiled against when there is one.
export interface SequencerHandlerRequirement {
	// Block type to resolve.
	readonly type: string
	// Version recorded at compile time. Absent while compiling, since that is when it is decided.
	readonly version?: number
}

// Why a required block type could not be resolved.
// - missing: no handler is registered for the type.
// - versionMismatch: a handler exists, but not the version the plan was compiled against.
export type SequencerHandlerIssueKind = 'missing' | 'versionMismatch'

// One unresolvable block type.
export interface SequencerHandlerIssue {
	// Block type that failed to resolve.
	readonly type: string
	// Nature of the failure.
	readonly kind: SequencerHandlerIssueKind
	// Version the plan required, when it required one.
	readonly expected?: number
	// Version currently registered, absent when nothing is registered.
	readonly actual?: number
}

// Outcome of resolving the block types of a plan. Success carries the version of every type, which the
// caller records in the plan and in the checkpoint so the same resolution can be demanded again later.
export type SequencerHandlerResolution = { readonly ok: true; readonly versions: Readonly<Record<string, number>> } | { readonly ok: false; readonly issues: readonly SequencerHandlerIssue[] }

// Process-wide table of block handlers.
export class SequencerBlockRegistry {
	readonly #handlers = new Map<string, AnySequencerActionHandler>()

	// Registers one handler, keeping its concrete configuration type at the declaration site.
	//
	// Two handlers for the same type is a wiring defect rather than an operational outcome — the second
	// would silently shadow the first and change what every existing definition means.
	register<C, R>(handler: SequencerActionHandler<C, R>) {
		const registered = this.#handlers.get(handler.type)

		if (registered !== undefined) throw new Error(`block type already registered: ${handler.type} (version ${registered.version})`)

		// Storing the handler erases `C`. That is sound because the only value ever reaching `resources` and
		// `execute` is what this same handler's `validate` produced, and that value is a `C` by construction.
		this.#handlers.set(handler.type, handler)
	}

	// Returns the handler for a block type, or undefined when none is registered.
	handler(type: string) {
		return this.#handlers.get(type)
	}

	// Lists the registered block types, sorted.
	types(): readonly string[] {
		return this.#handlers.keys().toArray().sort()
	}

	// Resolves every required block type at once, reporting all issues instead of the first one.
	//
	// This is the only check of the compiler that is not pure, which is why it runs twice and why both runs
	// are required: once while the user edits, so an invalid definition is rejected at once, and again when
	// the session starts, because a handler can be registered or removed in between. Running only the first
	// produces a definition marked valid that fails at bootstrap; running only the second turns an editing
	// mistake into a failure in the middle of the night.
	resolve(requirements: readonly SequencerHandlerRequirement[]): SequencerHandlerResolution {
		const issues: SequencerHandlerIssue[] = []
		const versions: Record<string, number> = {}

		for (const requirement of requirements) {
			const handler = this.#handlers.get(requirement.type)

			if (handler === undefined) {
				issues.push({ type: requirement.type, kind: 'missing', expected: requirement.version })
			} else if (requirement.version !== undefined && requirement.version !== handler.version) {
				issues.push({ type: requirement.type, kind: 'versionMismatch', expected: requirement.version, actual: handler.version })
			} else {
				versions[requirement.type] = handler.version
			}
		}

		return issues.length > 0 ? { ok: false, issues } : { ok: true, versions }
	}
}
