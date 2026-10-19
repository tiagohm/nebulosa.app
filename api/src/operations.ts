import { DeviceLifecycle } from 'nebulosa/src/devices/orchestration/device.lifecycle'
import { OperationCoordinator, type OperationFailureReason, type OperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { ResourceArbiter } from 'nebulosa/src/devices/orchestration/resource'
import type { DeviceRegistry } from './devices'

// Device operations of the whole server process. One resource arbiter grants each physical device to one
// operation at a time, whichever service (mount commands and camera captures today; focus, alignment,
// guiding, and the sequencer later) or browser tab starts it, and one lifecycle bridge cancels an operation when a
// device it holds disconnects or disappears. Operations are owned here, never by a request or a tab: the
// running ones are listed for any tab that (re)connects, and every start and end is published as an
// operation:updated event naming the exact connection and device ids involved, never a role.

// Kind of operation, prefixed by the service that runs it.
export type OperationKind = 'mount.slew' | 'mount.nudge' | 'camera.capture'

// Life stage of an operation.
export type OperationState = 'running' | 'succeeded' | 'failed'

// Physical device an operation holds.
export interface OperationDevice {
	// Id of the open connection that provides the device.
	readonly connectionId: string
	// Exact id of the device.
	readonly deviceId: string
}

// Operation as published to clients.
export interface OperationRecord {
	// Id of the operation.
	readonly operationId: string
	// Kind of operation.
	readonly kind: OperationKind
	// Devices the operation holds.
	readonly devices: readonly OperationDevice[]
	// Life stage.
	readonly state: OperationState
	// Why the operation failed; present only when state is failed.
	readonly reason?: OperationFailureReason
	// Human-readable detail of the failure, when there is one.
	readonly error?: string
	// Instant the operation started, Unix milliseconds (UTC).
	readonly startedAt: number
}

// Notification published when an operation starts or ends.
export type OperationEvent = { readonly type: 'operation:updated'; readonly operation: OperationRecord }

// Receiver of operation events.
export type OperationListener = (event: OperationEvent) => void

// Process-wide registry of device operations.
export class OperationRegistry implements Disposable {
	// Arbiter granting each physical device to one operation at a time.
	readonly arbiter = new ResourceArbiter()
	// Coordinator every service starts its operations with.
	readonly coordinator = new OperationCoordinator(this.arbiter)
	// Bridge making devices available only while connected and cancelling operations on disconnect.
	readonly #lifecycle = new DeviceLifecycle(this.arbiter, this.coordinator)
	// Operations still running, by id.
	readonly #running = new Map<string, OperationRecord>()
	// Stops the lifecycle bridge following the registry's devices.
	readonly #unobserve: VoidFunction

	// Creates the registry over the devices of every open connection; listener receives every operation
	// event synchronously.
	constructor(
		devices: DeviceRegistry,
		readonly listener: OperationListener,
	) {
		this.#unobserve = devices.observe(this.#lifecycle)
	}

	// Returns the operations still running, in start order.
	running(): OperationRecord[] {
		return Array.from(this.#running.values())
	}

	// Publishes an operation of a kind holding devices as running, and as succeeded or failed once its
	// result settles; a rejected result fails with reason commandFailed. Returns the running record, whose
	// id names the operation in every later event.
	track(kind: OperationKind, devices: readonly OperationDevice[], result: Promise<OperationResult<unknown>>): OperationRecord {
		const record: OperationRecord = { operationId: crypto.randomUUID(), kind, devices, state: 'running', startedAt: Date.now() }
		this.#running.set(record.operationId, record)
		this.listener({ type: 'operation:updated', operation: record })

		void result.then(
			(outcome) => this.#finish(outcome.ok ? { ...record, state: 'succeeded' } : { ...record, state: 'failed', reason: outcome.reason, error: outcome.error }),
			(error: unknown) => this.#finish({ ...record, state: 'failed', reason: 'commandFailed', error: Error.isError(error) ? error.message : undefined }),
		)

		return record
	}

	// Forgets a finished operation and publishes its final record.
	#finish(record: OperationRecord) {
		this.#running.delete(record.operationId)
		this.listener({ type: 'operation:updated', operation: record })
	}

	// Cancels every running operation and stops following the devices.
	[Symbol.dispose]() {
		void this.coordinator.cancelAll()
		this.#unobserve()
		this.#lifecycle.dispose()
	}
}
