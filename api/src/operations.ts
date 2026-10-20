import type { Device } from 'nebulosa/src/devices/indi/device'
import { DeviceLifecycle } from 'nebulosa/src/devices/orchestration/device.lifecycle'
import { OperationCoordinator, type OperationFailureReason, type OperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { ResourceArbiter, resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import type { DeviceRegistry } from './devices'

// Device operations of the whole server process. One resource arbiter grants each physical device to one
// operation at a time, whichever service (the device commands and camera captures today; focus, alignment,
// guiding, and the sequencer later) or browser tab starts it, and one lifecycle bridge cancels an operation
// when a device it holds disconnects or disappears. Operations are owned here, never by a request or a tab:
// the running ones are listed for any tab that (re)connects, and every start and end is published as an
// operation:updated event naming the exact connection and device ids involved, never a role. An operation
// started for a command token is remembered by it, so a repeated request never commands a device twice.

// Kind of operation, prefixed by the service that runs it.
export type OperationKind = 'mount.slew' | 'mount.goto' | 'mount.flip' | 'mount.park' | 'mount.unpark' | 'mount.home' | 'mount.findHome' | 'mount.nudge' | 'guideOutput.pulse' | 'focuser.move' | 'wheel.move' | 'rotator.move' | 'rotator.home' | 'cover.open' | 'cover.close' | 'camera.capture'

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

// Command tokens remembered so a repeated request is answered with its first operation; older ones are
// forgotten. A request is never repeated after more than a few others, so the most recent are enough.
const MAX_TOKENS = 256

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
	// Running record of the operation each recent command token started, oldest first (see MAX_TOKENS).
	readonly #tokens = new Map<string, OperationRecord>()
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

	// Whether a device can be granted to a new operation now: connected, at rest, and held by none.
	available(device: Device) {
		return this.arbiter.availability(resourceKey(device)) === 'available'
	}

	// Returns the running record of the operation a command token started, while the token is remembered.
	started(token: string): OperationRecord | undefined {
		return this.#tokens.get(token)
	}

	// Starts and tracks the operation of a command identified by a token the client generated for one
	// request, so a request repeated after a lost response, a retry, or a double submission never commands
	// the device twice: a token already seen returns the record of its operation without calling start.
	run(kind: OperationKind, devices: readonly OperationDevice[], token: string, start: () => Promise<OperationResult<unknown>>): OperationRecord {
		const known = this.#tokens.get(token)
		if (known) return known

		const record = this.track(kind, devices, start())
		this.#tokens.set(token, record)
		if (this.#tokens.size > MAX_TOKENS) this.#tokens.delete(this.#tokens.keys().next().value!)
		return record
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
