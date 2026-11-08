import type { Device } from 'nebulosa/src/devices/indi/device'
import { DeviceLifecycle } from 'nebulosa/src/devices/orchestration/device.lifecycle'
import { OperationCoordinator, type OperationFailureReason, type OperationResult, type OperationScope } from 'nebulosa/src/devices/orchestration/operation'
import { ResourceArbiter, type ResourceReservation, resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import type { DeviceRegistry } from './devices'

// Device operations of the whole server process. One resource arbiter grants each physical device to one
// operation at a time, whichever service (the device commands, the camera captures, and the camera operations
// such as Auto Focus, TPPA, and Guiding) or browser tab starts it, and one lifecycle bridge cancels an operation
// when a device it holds disconnects or disappears. Operations are owned here, never by a request or a tab:
// the running ones are listed for any tab that (re)connects, and every start and end is published as an
// operation:updated event naming the exact connection and device ids involved, never a role. An operation
// started for a command token is remembered by it, so a repeated request never commands a device twice.
// A caller inside the process (a service composing tools) can run a tool under a reservation of the arbiter, passed
// as a ToolInvocation: the tool then admits only the devices that reservation holds and runs under its scope, while
// every other operation stays refused on them; and it can await the end of the exact operation it admitted.

// Kind of operation, prefixed by the service that runs it.
export type OperationKind =
	| 'mount.slew'
	| 'mount.goto'
	| 'mount.flip'
	| 'mount.park'
	| 'mount.unpark'
	| 'mount.home'
	| 'mount.findHome'
	| 'mount.nudge'
	| 'mount.remoteMove'
	| 'guideOutput.pulse'
	| 'focuser.move'
	| 'wheel.move'
	| 'rotator.move'
	| 'rotator.home'
	| 'cover.open'
	| 'cover.close'
	| 'dome.slew'
	| 'dome.home'
	| 'dome.park'
	| 'dome.unpark'
	| 'dome.shutter'
	| 'dome.move'
	| 'camera.capture'
	| 'mount.meridianFlipExecutor'
	| 'focuser.autofocus'
	| 'mount.tppa'
	| 'mount.pointingModel'
	| 'mount.pointingVerification'
	| 'mount.targetCentering'
	| 'mount.darv'
	| 'camera.flatWizard'
	| 'camera.darkLibraryWizard'
	| 'camera.guiding'
	| 'guideOutput.guiding'
	| 'indi.propertyWrite'

// Life stage of an operation.
export type OperationState = 'running' | 'succeeded' | 'failed'

// Physical device an operation holds.
export interface OperationDevice {
	// Id of the open connection that provides the device.
	readonly connectionId: string
	// Exact id of the device.
	readonly deviceId: string
}

// Progress of a running operation made of several physical steps, such as the waypoints of a backlash
// compensated focuser move.
export interface OperationProgress {
	// Step in execution, 1-based.
	readonly step: number
	// Number of steps of the operation, >= 1.
	readonly steps: number
	// What the step does, meant for people, such as "Moving to 1100".
	readonly message: string
}

// Reports the progress of the operation it was given to.
export type OperationProgressReporter = (progress: OperationProgress) => void

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
	// Latest progress reported while running; absent from a finished record.
	readonly progress?: OperationProgress
}

// Authorization under which a caller inside the process runs a tool: a reservation of the registry's arbiter that
// holds every device the tool commands. Never serialized: it exists only in process memory, never in a request,
// an event, or the database. A tool run without one is a manual operation, granted only devices nobody holds.
export interface ToolInvocation {
	// Reservation the tool runs inside, holding each device it commands.
	readonly reservation: ResourceReservation
}

// Operation a command started, as its caller holds it.
export interface OperationAdmission {
	// Running record of the operation, published before its work started.
	readonly record: OperationRecord
	// Final record of the operation, succeeded or failed, once its result settled; never rejects.
	readonly finished: Promise<OperationRecord>
	// Whether the token had already started the operation, which this request did not start again.
	readonly repeated: boolean
}

// Notification published when an operation starts, progresses, or ends.
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
	// Admission of the operation each recent command token started, oldest first (see MAX_TOKENS).
	readonly #tokens = new Map<string, OperationAdmission>()
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

	// Whether a tool can be granted a device now: without an invocation, when the device is connected, at rest, and
	// held by none (available); with one, when the device is reserved by the invocation's reservation and no operation
	// holds it, so a tool never takes a device outside the reservation it was given.
	admits(device: Device, invocation?: ToolInvocation) {
		if (!invocation) return this.available(device)
		return this.arbiter.availability(resourceKey(device)) === 'reserved' && this.reserves(device, invocation)
	}

	// Whether the reservation of an invocation holds a device, whatever operation of it holds the device now.
	reserves(device: Device, invocation: ToolInvocation) {
		return this.arbiter.reservationOwnerOf(resourceKey(device)) === invocation.reservation.token.owner
	}

	// Scope a tool starts its operations with: the process coordinator for a manual operation, or the scope of the
	// invocation's reservation, whose operations acquire the devices it holds.
	scope(invocation?: ToolInvocation): OperationScope {
		return invocation ? this.coordinator.reservedScope(invocation.reservation) : this.coordinator
	}

	// Returns the running record of the operation a command token started, while the token is remembered.
	started(token: string): OperationRecord | undefined {
		return this.#tokens.get(token)?.record
	}

	// Returns the admission of the operation a command token started, marked repeated, while the token is remembered.
	repeated(token: string): OperationAdmission | undefined {
		const known = this.#tokens.get(token)
		return known && { ...known, repeated: true }
	}

	// Starts and tracks the operation of a command identified by a token the client generated for one
	// request, so a request repeated after a lost response, a retry, or a double submission never commands
	// the device twice: a token already seen returns the admission of its operation, marked repeated, without
	// calling start. start is called once the operation is published as running, and receives a reporter
	// publishing the progress of the operation while it runs, from its first synchronous step on.
	admit(kind: OperationKind, devices: readonly OperationDevice[], token: string, start: (report: OperationProgressReporter) => Promise<OperationResult<unknown>>): OperationAdmission {
		const known = this.repeated(token)
		if (known) return known

		const operationId = Bun.randomUUIDv7()
		const admission = this.#track(operationId, kind, devices, () => start((progress) => this.#progress(operationId, progress)))
		this.#tokens.set(token, admission)
		if (this.#tokens.size > MAX_TOKENS) this.#tokens.delete(this.#tokens.keys().next().value!)
		return admission
	}

	// Starts the operation of a command identified by a token, as admit does, and returns its running record.
	run(kind: OperationKind, devices: readonly OperationDevice[], token: string, start: (report: OperationProgressReporter) => Promise<OperationResult<unknown>>): OperationRecord {
		return this.admit(kind, devices, token, start).record
	}

	// Publishes an operation of a kind holding devices as running, and as succeeded or failed once its
	// result settles; a rejected result fails with reason commandFailed. Returns the running record, whose
	// id names the operation in every later event.
	track(kind: OperationKind, devices: readonly OperationDevice[], result: Promise<OperationResult<unknown>>): OperationRecord {
		return this.#track(Bun.randomUUIDv7(), kind, devices, () => result).record
	}

	// Publishes the operation operationId as running, then starts it with start, and publishes it as finished once the
	// result settles; a start that throws fails it with reason commandFailed. Returns its admission, not repeated.
	#track(operationId: string, kind: OperationKind, devices: readonly OperationDevice[], start: () => Promise<OperationResult<unknown>>): OperationAdmission {
		const record: OperationRecord = { operationId, kind, devices, state: 'running', startedAt: Date.now() }
		this.#running.set(record.operationId, record)
		this.listener({ type: 'operation:updated', operation: record })

		const finished = Promise.try(start).then(
			(outcome) => this.#finish(outcome.ok ? { ...record, state: 'succeeded' } : { ...record, state: 'failed', reason: outcome.reason, error: outcome.error }),
			(error: unknown) => this.#finish({ ...record, state: 'failed', reason: 'commandFailed', error: Error.isError(error) ? error.message : undefined }),
		)

		return { record, finished, repeated: false }
	}

	// Publishes the progress of a running operation; ignored once it finished.
	#progress(operationId: string, progress: OperationProgress) {
		const record = this.#running.get(operationId)
		if (!record) return
		const updated: OperationRecord = { ...record, progress }
		this.#running.set(operationId, updated)
		this.listener({ type: 'operation:updated', operation: updated })
	}

	// Forgets a finished operation, publishes its final record, and returns it.
	#finish(record: OperationRecord) {
		this.#running.delete(record.operationId)
		this.listener({ type: 'operation:updated', operation: record })
		return record
	}

	// Cancels every running operation and resolves once each one finished its cleanup, which stops what it commanded (a
	// held motion, a slew, an exposure), or once timeout milliseconds passed, whichever comes first, so a cleanup that
	// never ends cannot hold its caller. Never rejects.
	async stop(timeout: number): Promise<void> {
		const { promise, resolve } = Promise.withResolvers<void>()
		const timer = setTimeout(resolve, timeout)

		void this.coordinator.cancelAll().then(resolve, (error: unknown) => {
			console.error('The running operations could not be stopped', error)
			resolve()
		})

		await promise
		clearTimeout(timer)
	}

	// Cancels every running operation and stops following the devices.
	[Symbol.dispose]() {
		void this.coordinator.cancelAll()
		this.#unobserve()
		this.#lifecycle.dispose()
	}
}

// Routes of the device operations.
export function createOperationRoutes(operations: OperationRegistry) {
	return {
		'/api/operations': {
			// The device operations still running, started by any tab.
			GET: () => Response.json(operations.running()),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
