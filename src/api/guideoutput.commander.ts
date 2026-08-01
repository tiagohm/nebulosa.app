import type { GuideDirection, GuideOutput } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler, GuideOutputManager } from 'nebulosa/src/devices/indi/manager'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import type { OperationResult } from '#/orchestration'
import type { OperationContext, OperationScope } from './operation'
import { abortableDelay, waitForDeviceState } from './operation.wait'
import { resourceKey } from './resource'
import type { ResourceKey } from './resource'

// Timing overrides for one guide pulse; every duration is in milliseconds.
export interface GuidePulseOptions {
	// Maximum time a canceled or finished pulse has to bring the device back to a standstill.
	readonly settleTimeout?: number
}

// One observed guide output transition. The device is passed live rather than snapshotted because
// evaluation always reads the newest values, and the property/state pair is what carries an INDI Alert.
interface GuideOutputUpdate {
	// Device the update came from.
	readonly device: GuideOutput
	// Field that changed, absent when the update is a poll of the current state.
	readonly property?: keyof GuideOutput & string
	// INDI state published with the change, absent when the update is a poll of the current state.
	readonly state?: PropertyState
}

// Default milliseconds a pulse that ended has to be reported as no longer pulsing.
const DEFAULT_SETTLE_TIMEOUT = 15000

// Signal for physical stops issued while the owning operation is already being canceled. Only the
// emergency stop uses it: cleanup cannot inherit the operation signal, which is aborted by then, and would
// never send the command it exists for. The pulse itself waits on the operation signal, so a stop never has
// to outlast a device that keeps reporting motion.
const UNCANCELABLE = new AbortController().signal

// Direction sharing an axis with each one. TELESCOPE_TIMED_GUIDE_NS and TELESCOPE_TIMED_GUIDE_WE are
// single vectors, so a pulse in one direction is stopped by sending zero to the same or the paired one.
const OPPOSITE_DIRECTION: Record<GuideDirection, GuideDirection> = {
	NORTH: 'SOUTH',
	SOUTH: 'NORTH',
	WEST: 'EAST',
	EAST: 'WEST',
}

// Owns every timed pulse of a guide output and turns it into an awaitable operation.
//
// The pulse opens its own nested scope holding the physical device behind the guide output, so a
// composite feature passing its own context inherits the device it already owns, and the axis is stopped
// by the scope's cleanup whenever the pulse is canceled instead of being left running under a released
// device. A guide output is arbitrated under the key of the device providing it, which is why a camera's
// guide port and the camera itself, or a mount's and the mount itself, are one resource.
export class GuideOutputCommander implements DeviceHandler<GuideOutput> {
	// Waiters per physical resource, fed by the manager callbacks. The key is used instead of the device
	// object because a pulse may be commanded through the parent device while the manager reports updates
	// through its guide output proxy, and both resolve to the same key.
	readonly #listeners = new Map<ResourceKey, Set<(update: GuideOutputUpdate) => void>>()

	// Registers the commander as a guide output observer so waits settle on device events instead of polling.
	constructor(readonly guideOutputManager: GuideOutputManager) {
		guideOutputManager.addHandler(this)
	}

	// Required by the manager contract; discovery is published by GuideOutputHandler.
	added() {}

	// Feeds every waiter observing the device, which is how a pulse learns the driver stopped guiding.
	updated(device: GuideOutput, property: keyof GuideOutput & string, state?: PropertyState) {
		this.#emit({ device, property, state })
	}

	// Wakes every waiter so it reevaluates; removal is reported as a disconnected device by evaluation,
	// and the operation itself is canceled independently by DeviceLifecycle.
	removed(device: GuideOutput) {
		this.#emit({ device })
	}

	// Issues a timed pulse in one direction and resolves only after it has run for its whole duration and
	// the device reports no guiding motion. Duration is in milliseconds.
	//
	// The driver times the pulse itself, so the delay is what the caller is waiting for and the device is
	// observed throughout it: a driver that reports Alert fails the pulse at once instead of at the end of a
	// leg that is no longer being drawn. A canceled pulse is stopped before the scope releases the device,
	// so no axis keeps drifting into the next operation.
	async pulse(scope: OperationScope, device: GuideOutput, direction: GuideDirection, duration: number, options: GuidePulseOptions = {}): Promise<OperationResult<void>> {
		return await scope.start<void>('guidePulse', [{ key: resourceKey(device), device }], async (context) => {
			// Capabilities are only published while the device is connected, so a disconnected guide output
			// would otherwise be reported as one that cannot pulse at all.
			if (!device.connected) return { ok: false, reason: 'disconnected' }
			if (!device.canPulseGuide) return { ok: false, reason: 'unexpectedState', error: `guide output ${device.name} cannot pulse guide` }

			return await this.#pulse(context, device, direction, duration, options)
		}).result
	}

	// Cancels any pulse in one direction and waits for the device to report a standstill.
	//
	// This is the emergency stop of the commander: it does not acquire the device, precisely because it is
	// used while the owning operation is being canceled and by cleanup running after the executor returned.
	// The opposite direction is zeroed as well, since both share one INDI vector and only the pair proves
	// the axis is idle.
	async stopPulse(device: GuideOutput, direction: GuideDirection, options: GuidePulseOptions = {}): Promise<OperationResult<void>> {
		if (!device.connected) return { ok: false, reason: 'disconnected' }
		if (!device.canPulseGuide) return { ok: true, value: undefined }

		return await this.#settle(device, options, () => {
			this.guideOutputManager.pulse(device, direction, 0)
			this.guideOutputManager.pulse(device, OPPOSITE_DIRECTION[direction], 0)
		})
	}

	// Commands the pulse and waits out its duration, stopping the axis from the scope's own cleanup.
	//
	// The opposite direction is zeroed before the pulse starts because both directions live in one vector:
	// a leg commanded while the previous one is still counting down would otherwise be added to a driver
	// already guiding the other way.
	async #pulse(context: OperationContext, device: GuideOutput, direction: GuideDirection, duration: number, options: GuidePulseOptions): Promise<OperationResult<void>> {
		// Registered before the command so a cancel arriving during dispatch still finds the stop it needs.
		//
		// The caller's timing is deliberately not forwarded: a settle allowance shortened to fit a deadline
		// bounds how long the leg may be waited for, not how long the axis is given to come to rest, and an
		// emergency stop cut short would release the device while it is still moving.
		context.onCleanup(async () => {
			const stopped = await this.stopPulse(device, direction)

			// A device that went away is not pulsing under our command any more, so only one that stays in
			// motion is reported as a cleanup failure.
			if (!stopped.ok && stopped.reason !== 'disconnected') throw new Error(`guide output ${device.name} did not stop pulsing: ${stopped.reason}`)
		})

		// The driver times the pulse itself, so the delay is dispatched as part of the command and the wait
		// around it observes the device for the whole leg instead of only after it. A pulse the driver
		// refuses would otherwise be invisible: the Alert clears the flag as well, and by the time a
		// separate settle subscribed it would read a device at rest and call the leg a success.
		const alerted = new AbortController()
		let elapsed = false

		const pulsed = await waitForDeviceState<GuideOutputUpdate>({
			signal: context.signal,
			timeout: Math.max(0, duration) + (options.settleTimeout ?? DEFAULT_SETTLE_TIMEOUT),
			subscribe: (listener) => this.#subscribe(device, listener),
			current: () => ({ device }),
			evaluate: (update) => {
				// Cutting the delay short is what turns the verdict into an immediate failure; the command has
				// to return before the wait can settle on it.
				if (update.state === 'Alert' && update.property === 'pulsing') {
					alerted.abort('alert')
					return 'alert'
				}

				// A device that went away cannot finish the leg, and nothing further will ever be reported by
				// one that stopped talking.
				if (!device.connected) return 'disconnected'

				// Before the requested duration is over, a device not reporting motion is one whose driver has
				// not published the flag yet, not one that already finished the pulse.
				return elapsed && !device.pulsing ? 'success' : 'pending'
			},
			command: async (signal) => {
				this.guideOutputManager.pulse(device, OPPOSITE_DIRECTION[direction], 0)
				this.guideOutputManager.pulse(device, direction, duration)

				elapsed = (await abortableDelay(duration, AbortSignal.any([signal, alerted.signal]))).ok
			},
		})

		return pulsed.ok ? { ok: true, value: undefined } : pulsed
	}

	// Waits for the device to report no guiding motion, on a signal of its own so it still runs while the
	// operation that owns the device is being canceled.
	async #settle(device: GuideOutput, options: GuidePulseOptions, command: VoidFunction): Promise<OperationResult<void>> {
		const settled = await waitForDeviceState<GuideOutputUpdate>({
			signal: UNCANCELABLE,
			timeout: options.settleTimeout ?? DEFAULT_SETTLE_TIMEOUT,
			subscribe: (listener) => this.#subscribe(device, listener),
			current: () => ({ device }),
			// A disconnected device is not pulsing under our command any more, and nothing further will ever
			// be reported by a device that stopped talking.
			evaluate: () => (!device.connected || !device.pulsing ? 'success' : 'pending'),
			command,
		})

		return settled.ok ? { ok: true, value: undefined } : settled
	}

	// Registers a waiter for one physical resource and returns its idempotent unsubscriber.
	#subscribe(device: GuideOutput, listener: (update: GuideOutputUpdate) => void) {
		const key = resourceKey(device)
		let listeners = this.#listeners.get(key)

		if (listeners === undefined) {
			listeners = new Set()
			this.#listeners.set(key, listeners)
		}

		listeners.add(listener)

		return () => {
			const current = this.#listeners.get(key)

			if (current?.delete(listener) && current.size === 0) this.#listeners.delete(key)
		}
	}

	// Notifies the waiters of one physical resource.
	#emit(update: GuideOutputUpdate) {
		const listeners = this.#listeners.get(resourceKey(update.device))
		if (listeners === undefined) return
		for (const listener of listeners) listener(update)
	}
}
