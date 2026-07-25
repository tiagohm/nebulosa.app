import { errorMessage } from 'src/api/util'
import type { ResourceKey, ResourceLease, ResourceOwner, ResourceRequest } from './resource'
import { ResourceArbiter } from './resource'

// Expected operational terminal causes that callers can handle without exceptions.
export type OperationFailureReason = 'busy' | 'aborted' | 'disconnected' | 'removed' | 'timeout' | 'alert' | 'commandFailed' | 'unexpectedState'

// Discriminated terminal outcome for expected success and operational failure.
export type OperationResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: OperationFailureReason; readonly error?: string }

// Shared ownership, cancellation, and cleanup scope passed through an operation tree.
export interface OperationContext {
	// Stable operation identifier.
	readonly id: string
	// Human-readable operation category.
	readonly kind: string
	// Single cancellation signal shared by every child step.
	readonly signal: AbortSignal
	// Checks whether this exact context owns the resource.
	readonly owns: (resource: ResourceKey) => boolean
	// Registers cleanup in LIFO order and returns an idempotent unregister function.
	readonly onCleanup: (cleanup: () => void | Promise<void>) => VoidFunction
}

// Public control and result surface for one top-level operation.
export interface OperationHandle<T> {
	// Stable operation identifier.
	readonly id: string
	// Human-readable operation category.
	readonly kind: string
	// Signal aborted synchronously when cancellation begins.
	readonly signal: AbortSignal
	// Terminal result resolved only after cleanup and lease release.
	readonly result: Promise<OperationResult<T>>
	// Requests idempotent cancellation and waits for cleanup completion.
	readonly cancel: (reason?: OperationFailureReason) => Promise<void>
}

// Exception wrapper for expected operational failures thrown by an executor.
export class OperationError extends Error {
	// Creates an expected failure with its discriminant and optional diagnostic message.
	constructor(
		readonly reason: OperationFailureReason,
		message?: string,
	) {
		super(message)
		this.name = 'OperationError'
	}
}

// Work invoked only after all requested resources have been acquired; expected failures throw OperationError.
type OperationExecutor<T> = (context: OperationContext) => T | Promise<T>
// Cleanup step that may quiesce a device asynchronously.
type Cleanup = () => void | Promise<void>
// Distinct stack entry retained so each unregister function removes its own cleanup registration.
interface CleanupRegistration {
	// Cleanup callback invoked when this registration remains active at finalization.
	readonly cleanup: Cleanup
}
// Internal terminal value preserving unexpected exceptions outside OperationResult.
type Terminal<T> = { readonly result: OperationResult<T> } | { readonly error: unknown }

// Mutable state retained until cleanup and lease release complete.
interface ActiveOperation<T> {
	// Exact context used as the arbiter owner token.
	readonly context: OperationContext
	// Sole abort source for the operation tree.
	readonly controller: AbortController
	// Public handle returned to callers.
	readonly handle: OperationHandle<T>
	// Resolver for the public terminal result.
	readonly result: PromiseWithResolvers<OperationResult<T>>
	// Cleanup stack in registration order.
	readonly cleanups: CleanupRegistration[]
	// Completion resolver used by idempotent cancellation calls.
	readonly completion: PromiseWithResolvers<void>
	// Atomic resource lease, absent only for busy operations.
	lease?: ResourceLease
	// Prevents cleanup registration after terminalization starts.
	cleanupStarted: boolean
	// Exactly-once guard for all terminal paths.
	terminalStarted: boolean
}

// Owns operation lifetimes, converts expected failures, and releases resources after LIFO cleanup.
export class OperationCoordinator {
	readonly #operations = new Map<string, ActiveOperation<unknown>>()
	readonly #operationsByOwner = new Map<ResourceOwner, ActiveOperation<unknown>>()

	// Creates a coordinator over the process-wide resource arbiter.
	constructor(readonly arbiter: ResourceArbiter) {}

	// Acquires all resources and starts the executor, returning an immediate busy handle on conflict.
	start<T>(kind: string, resources: readonly ResourceRequest[], executor: OperationExecutor<T>): OperationHandle<T> {
		const id = crypto.randomUUID()
		const controller = new AbortController()
		const result = Promise.withResolvers<OperationResult<T>>()
		const completion = Promise.withResolvers<void>()

		const context: OperationContext = Object.freeze({
			id,
			kind,
			signal: controller.signal,
			owns: (resource: ResourceKey) => this.arbiter.owns(context, resource),
			onCleanup: (cleanup: Cleanup) => {
				if (operation.cleanupStarted) return () => {}

				const registration = { cleanup }
				operation.cleanups.push(registration)
				let registered = true

				return () => {
					if (!registered || operation.cleanupStarted) return
					registered = false
					const index = operation.cleanups.indexOf(registration)
					if (index >= 0) operation.cleanups.splice(index, 1)
				}
			},
		})

		const handle: OperationHandle<T> = Object.freeze({
			id,
			kind,
			signal: controller.signal,
			result: result.promise,
			cancel: (reason: OperationFailureReason = 'aborted') => this.#cancel(operation, reason),
		})

		const operation: ActiveOperation<T> = {
			context,
			controller,
			handle,
			result,
			cleanups: [],
			completion,
			cleanupStarted: false,
			terminalStarted: false,
		}

		const acquired = this.arbiter.acquire(context, resources)

		if (!acquired.ok) {
			controller.abort('busy')
			operation.terminalStarted = true
			result.resolve({ ok: false, reason: 'busy', error: formatConflicts(acquired.conflicts) })
			completion.resolve()
			return handle
		}

		operation.lease = acquired.lease
		this.#operations.set(id, operation as ActiveOperation<unknown>)
		this.#operationsByOwner.set(context, operation as ActiveOperation<unknown>)

		void (async () => {
			try {
				const value = await executor(context)
				await this.#finalize(operation, { result: { ok: true, value } })
			} catch (error) {
				const terminal: Terminal<T> = error instanceof OperationError ? { result: { ok: false, reason: error.reason, error: error.message || undefined } } : { error }
				await this.#finalize(operation, terminal)
			}
		})()

		return handle
	}

	// Returns an active operation handle by id; completed operations are no longer retained.
	get<T = unknown>(id: string): OperationHandle<T> | undefined {
		return this.#operations.get(id)?.handle as OperationHandle<T> | undefined
	}

	// Cancels an active operation by id and waits for cleanup; unknown ids are a no-op.
	cancel(id: string, reason: OperationFailureReason = 'aborted') {
		const operation = this.#operations.get(id)
		return operation === undefined ? Promise.resolve() : this.#cancel(operation, reason)
	}

	// Aborts the owner of one affected resource synchronously, then waits for its cleanup.
	cancelByResource(resource: ResourceKey, reason: OperationFailureReason = 'aborted') {
		return this.#cancelOwners(this.arbiter.ownersOf(resource), reason)
	}

	// Aborts every distinct owner associated with a client, then waits for all cleanup.
	cancelByClient(clientId: string, reason: OperationFailureReason = 'aborted') {
		return this.#cancelOwners(this.arbiter.ownersOfClient(clientId), reason)
	}

	// Aborts all active operations synchronously and waits for every cleanup.
	async cancelAll(reason: OperationFailureReason = 'aborted') {
		const operations = [...this.#operations.values()]
		await Promise.all(operations.map((operation) => this.#cancel(operation, reason)))
	}

	// Resolves arbiter owner tokens to active operations without relying on caller-visible ids.
	async #cancelOwners(owners: readonly ResourceOwner[], reason: OperationFailureReason) {
		const cancellations: Promise<void>[] = []

		for (const owner of owners) {
			const operation = this.#operationsByOwner.get(owner)
			if (operation !== undefined) cancellations.push(this.#cancel(operation, reason))
		}

		await Promise.all(cancellations)
	}

	// Aborts the operation scope immediately, starts cancellation finalization once, and returns shared completion.
	#cancel<T>(operation: ActiveOperation<T>, reason: OperationFailureReason) {
		if (!operation.controller.signal.aborted) operation.controller.abort(reason)
		if (!operation.terminalStarted) void this.#finalize(operation, { result: { ok: false, reason } })

		return operation.completion.promise
	}

	// Runs cleanup exactly once in reverse order, releases the lease, and settles the result.
	async #finalize<T>(operation: ActiveOperation<T>, terminal: Terminal<T>) {
		if (operation.terminalStarted) return operation.completion.promise

		operation.terminalStarted = true

		if (!operation.controller.signal.aborted) {
			if ('error' in terminal) {
				operation.controller.abort(terminal.error)
			} else if (!terminal.result.ok) {
				operation.controller.abort(terminal.result.reason)
			}
		}

		operation.cleanupStarted = true
		const cleanupErrors: unknown[] = []

		try {
			for (let i = operation.cleanups.length - 1; i >= 0; i--) {
				try {
					await operation.cleanups[i].cleanup()
				} catch (error) {
					cleanupErrors.push(error)
				}
			}
		} finally {
			operation.lease?.release()
			this.#operations.delete(operation.context.id)
			this.#operationsByOwner.delete(operation.context)
		}

		try {
			if ('error' in terminal) {
				throw cleanupErrors.length > 0 ? new AggregateError([terminal.error, ...cleanupErrors], 'operation and cleanup failed') : terminal.error
			}

			if (cleanupErrors.length > 0) {
				if (terminal.result.ok) {
					throw new AggregateError(cleanupErrors, 'operation cleanup failed')
				}

				const cleanupError = cleanupErrors.map(errorMessage).join('; ')
				terminal = {
					result: {
						...terminal.result,
						error: terminal.result.error ? `${terminal.result.error}; cleanup failed: ${cleanupError}` : `cleanup failed: ${cleanupError}`,
					},
				}
			}

			operation.result.resolve(terminal.result)
		} catch (error) {
			operation.result.reject(error)
		} finally {
			operation.completion.resolve()
		}
	}
}

// Produces a compact diagnostic for an atomic busy result.
function formatConflicts(conflicts: readonly { readonly key: ResourceKey; readonly ownerId: string; readonly ownerKind: string }[]) {
	return conflicts.map((conflict) => `${conflict.key} is owned by ${conflict.ownerKind} ${conflict.ownerId}`).join(', ')
}
