import type { Device } from 'nebulosa/src/devices/indi/device'
import { isDeviceQuiescent } from 'nebulosa/src/devices/orchestration/device.lifecycle'
import { failedOperationResult, type OperationContext, type OperationFailureReason, type OperationHandle, type OperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { abortReason } from 'nebulosa/src/devices/orchestration/operation.wait'
import { type ResourceKey, resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { errorResponse, failureCode } from './commands'
import type { OperationKind, OperationRegistry } from './operations'

// Manual motion authorized only while a tab keeps renewing it, shared by the mount nudge and the manual
// rotation of a dome. Each press is a session named by a token the tab generates, run as one operation that
// holds the device from the start request until the motion was released and the device was observed to
// stop. The session holds a lease the tab renews by heartbeat; when the lease runs out (a closed, frozen,
// or disconnected tab), the operation is canceled with reason timeout, which stops the motion exactly as a
// release does. Stopping is idempotent and is never refused: a stop for a token not seen yet, or for one
// that already ended, records the token as ended, so a start request delivered after its own stop can never
// move the device. A stop of a session only ends that session; it never cancels another operation of the
// device. What a motion commands is up to its service; this module owns the session, the lease, and the
// publication of every change.

// Life stage of a leased session:
// - starting: the device is being acquired and the motion commanded.
// - moving: the motion was commanded and runs while the lease is renewed.
// - stopping: the session was ended and is waiting for the device to stop.
// - stopped: the session ended by a release and the motion was stopped.
// - failed: the session ended otherwise (busy, lease expired, disconnected, refused or failed command), as
//   given in reason and error.
export type LeasedPhase = 'starting' | 'moving' | 'stopping' | 'stopped' | 'failed'

// Lease timing of the sessions, in milliseconds.
export interface LeaseOptions {
	// Interval between two heartbeats a tab is told to send.
	readonly heartbeatInterval: number
	// Time without a heartbeat after which a session is stopped; several heartbeat intervals, so one late
	// request over HTTP does not stop a press that is still held.
	readonly leaseTimeout: number
}

// Default lease timing: a heartbeat every 500 ms and a stop after 2 s without one, which tolerates three
// lost or late heartbeats on a local network and still bounds a lost control to about two seconds.
export const DEFAULT_LEASE_OPTIONS: LeaseOptions = { heartbeatInterval: 500, leaseTimeout: 2000 }

// Session fields every leased motion publishes.
export interface LeasedSession {
	// Identity of the press that started it.
	readonly token: string
	// Id of the operation holding the device, repeated by its operation:updated events.
	readonly operationId: string
	// Id of the open connection that provides the device.
	readonly connectionId: string
	// Exact id of the device.
	readonly deviceId: string
	// Life stage.
	readonly phase: LeasedPhase
	// Why the session failed; present only when the phase is failed.
	readonly reason?: OperationFailureReason
	// Human-readable detail of the failure, when there is one.
	readonly error?: string
	// Whether the device was observed to stop once the session ended; false when it was still moving or
	// could no longer be observed (disconnected). Present only once the session ended.
	readonly stopConfirmed?: boolean
	// Instant the session started, Unix milliseconds (UTC).
	readonly startedAt: number
	// Instant the session ended, Unix milliseconds (UTC); absent while it runs.
	readonly endedAt?: number
}

// Response of an accepted press: the session as it stands after the start, and the lease timing the tab
// has to keep, in milliseconds.
export interface LeasedStartResponse<S extends LeasedSession> extends LeaseOptions {
	// Session started; moving, or already ended when it was stopped while starting.
	readonly session: S
}

// Hooks a motion uses while it runs under its session's operation.
export interface LeasedMotion {
	// Resolves when the session is asked to end: a release, an expired lease, or a cancellation.
	readonly ending: Promise<void>
	// Records that a command may have reached the device, so the end verifies that it stopped.
	readonly commanded: () => void
	// Reports that the motion runs; a start request is answered only from then on, or once it ended.
	readonly moving: () => void
}

// Runs the motion of a session under its operation, resolving once the motion was stopped.
export type LeasedMotionRunner = (context: OperationContext, motion: LeasedMotion) => Promise<OperationResult<void>>

// Words naming what the sessions move, for the messages of their responses.
export interface LeasedLabels {
	// The motion, such as "nudge".
	readonly motion: string
	// The device, such as "mount".
	readonly device: string
}

// Session fields a service provides when a press starts: everything but those this module manages.
export type LeasedStart<S extends LeasedSession> = Omit<S, 'operationId' | 'phase' | 'reason' | 'error' | 'stopConfirmed' | 'startedAt' | 'endedAt'>

// Ended tokens remembered so a late start of the same press is refused; older ones are forgotten. A start
// is never delayed by more than a few requests, so the most recent presses are enough.
const MAX_ENDED_TOKENS = 256

// Running session of one device, with what is needed to end it.
interface ActiveSession<S extends LeasedSession> {
	// Published state, replaced on every change.
	session: S
	// Device moved.
	readonly device: Device
	// Resource key of the device.
	readonly key: ResourceKey
	// Operation holding the device; absent only while it is being created.
	operation?: OperationHandle<void>
	// Lease timer, rearmed by every heartbeat.
	lease?: ReturnType<typeof setTimeout>
	// Whether a command may have reached the device, so the end can say whether it was left moving.
	commanded: boolean
	// Resolves when the session is asked to end (release, lease, or cancellation).
	readonly ending: PromiseWithResolvers<void>
	// Resolves once the session is moving or has ended, whichever comes first.
	readonly started: PromiseWithResolvers<void>
}

// Status a failed start is answered with.
export function leasedFailureStatus(reason: OperationFailureReason) {
	return reason === 'unexpectedState' ? 422 : reason === 'commandFailed' ? 502 : 409
}

// Leased manual motions of one kind of device, at most one session per physical device.
export class LeasedMotions<S extends LeasedSession> implements Disposable {
	// Running session of each device, by resource key.
	readonly #active = new Map<ResourceKey, ActiveSession<S>>()
	// Tokens of presses that ended or were stopped, oldest first (see MAX_ENDED_TOKENS).
	readonly #endedTokens = new Set<string>()

	// Creates the sessions of one kind: operations runs them as operations of kind (scope names them in the
	// coordinator), options sets the lease timing, labels name them in messages, and publish receives every
	// change of a session synchronously.
	constructor(
		readonly operations: OperationRegistry,
		readonly kind: OperationKind,
		readonly scope: string,
		readonly labels: LeasedLabels,
		readonly publish: (session: S) => void,
		readonly options: LeaseOptions = DEFAULT_LEASE_OPTIONS,
	) {}

	// Returns the sessions still running, in start order.
	sessions(): S[] {
		return Array.from(this.#active.values(), (active) => active.session)
	}

	// Starts a press on a device and resolves once its motion runs or has ended. A repeated start of a
	// running press answers the same session; a press already stopped is refused with 409; refuse returns
	// why the device cannot run this motion, if it cannot; a device held by any operation is refused as busy.
	// Responds 202 with LeasedStartResponse, or with the failure of a session that ended while starting.
	async start(device: Device, start: LeasedStart<S>, refuse: () => Response | undefined, run: LeasedMotionRunner): Promise<Response> {
		const key = resourceKey(device)
		const current = this.#active.get(key)
		if (current?.session.token === start.token) return await this.#startResponse(current)
		if (this.#endedTokens.has(start.token)) return errorResponse(`The ${this.labels.motion} was already stopped`, 409, 'rejected')

		const refusal = refuse()
		if (refusal) return refusal
		if (current || !this.operations.available(device)) return errorResponse(`The ${this.labels.device} is busy`, 409, 'busy')

		const active: ActiveSession<S> = {
			session: { ...start, operationId: '', phase: 'starting', startedAt: Date.now() } as unknown as S,
			device,
			key,
			commanded: false,
			ending: Promise.withResolvers(),
			started: Promise.withResolvers(),
		}

		this.#active.set(key, active)
		const operation = this.operations.coordinator.start<void>(this.scope, [{ key, device }], (context) => this.#run(active, context, run))
		active.operation = operation
		const { operationId } = this.operations.track(this.kind, [{ connectionId: start.connectionId, deviceId: start.deviceId }], operation.result)
		this.#renew(active)
		this.#update(active, { operationId } as Partial<S>)
		void operation.result.then((result) => this.#ended(active, result))

		return await this.#startResponse(active)
	}

	// Renews the lease of a running press. Responds 204, and 404 when the press is no longer running, so
	// the tab ends it.
	heartbeat(token: string): Response {
		const active = this.#of(token)
		if (!active || active.session.phase === 'stopping') return errorResponse(`The ${this.labels.motion} is not running`, 404, 'notFound')
		this.#renew(active)
		return new Response(null, { status: 204 })
	}

	// Ends a press and resolves once its device stopped. Never refused: a press that already ended, or was
	// not started yet, is recorded as ended so it can no longer start. Responds 204, and 409 when the device
	// could not be observed to stop.
	async stop(token: string): Promise<Response> {
		this.#rememberEnded(token)
		const active = this.#of(token)
		if (!active) return new Response(null, { status: 204 })

		this.#end(active)
		await active.operation?.result
		return active.session.stopConfirmed === false ? errorResponse(`The ${this.labels.device} was not observed to stop`, 409, 'unknownResult') : new Response(null, { status: 204 })
	}

	// Runs a motion under its operation and keeps it until the session is asked to end. Cancellation (lease,
	// disconnect, emergency stop) ends the session like a release; a release after a cancellation is still
	// reported as the cancellation.
	async #run(active: ActiveSession<S>, context: OperationContext, run: LeasedMotionRunner): Promise<OperationResult<void>> {
		context.signal.addEventListener('abort', () => active.ending.resolve(), { once: true })

		const motion: LeasedMotion = {
			ending: active.ending.promise,
			commanded: () => {
				active.commanded = true
			},
			// A press ended while starting is answered only once it has stopped, by the end of the operation.
			moving: () => {
				if (active.session.phase !== 'starting') return
				this.#update(active, { phase: 'moving' } as Partial<S>)
				active.started.resolve()
			},
		}

		const result = await run(context, motion)
		return result.ok && context.signal.aborted ? failedOperationResult(abortReason(context.signal)) : result
	}

	// Answers a start request once its session is moving or has ended.
	async #startResponse(active: ActiveSession<S>): Promise<Response> {
		await active.started.promise
		const { session } = active

		if (session.phase === 'failed' && session.reason !== undefined) {
			return Response.json({ error: session.error ?? `The ${this.labels.motion} failed (${session.reason})`, code: failureCode(session.reason), session }, { status: leasedFailureStatus(session.reason) })
		}

		return Response.json({ session, ...this.options } satisfies LeasedStartResponse<S>, { status: 202 })
	}

	// Returns the running session of a press, if any.
	#of(token: string) {
		for (const active of this.#active.values()) if (active.session.token === token) return active
		return undefined
	}

	// Asks a running session to end, publishing that it is stopping. Idempotent.
	#end(active: ActiveSession<S>) {
		if (active.session.phase === 'starting' || active.session.phase === 'moving') this.#update(active, { phase: 'stopping' } as Partial<S>)
		active.ending.resolve()
	}

	// Rearms the lease of a session; when it runs out, the operation is canceled with reason timeout.
	#renew(active: ActiveSession<S>) {
		clearTimeout(active.lease)

		active.lease = setTimeout(() => {
			active.lease = undefined
			this.#end(active)
			void active.operation?.cancel('timeout')
		}, this.options.leaseTimeout)
	}

	// Publishes how a session ended, once its operation released the device, and whether the device was
	// then observed at rest. A device that disconnected cannot be observed, so its stop is not confirmed.
	#ended(active: ActiveSession<S>, result: OperationResult<void>) {
		clearTimeout(active.lease)
		active.lease = undefined
		if (this.#active.get(active.key) === active) this.#active.delete(active.key)
		this.#rememberEnded(active.session.token)

		const stopConfirmed = !active.commanded || isDeviceQuiescent(active.device)
		const outcome = result.ok ? { phase: 'stopped' as const } : { phase: 'failed' as const, reason: result.reason, error: result.error }
		this.#update(active, { ...outcome, stopConfirmed, endedAt: Date.now() } as Partial<S>)
		active.started.resolve()
	}

	// Records a press as ended, forgetting the oldest beyond MAX_ENDED_TOKENS.
	#rememberEnded(token: string) {
		this.#endedTokens.delete(token)
		this.#endedTokens.add(token)
		if (this.#endedTokens.size > MAX_ENDED_TOKENS) this.#endedTokens.delete(this.#endedTokens.values().next().value!)
	}

	// Publishes a changed session.
	#update(active: ActiveSession<S>, patch: Partial<S>) {
		active.session = { ...active.session, ...patch }
		this.publish(active.session)
	}

	// Stops the leases; the operations belong to the operation registry, whose disposal cancels them,
	// stopping every motion.
	[Symbol.dispose]() {
		for (const active of this.#active.values()) clearTimeout(active.lease)
	}
}
