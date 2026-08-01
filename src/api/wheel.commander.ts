import type { Wheel } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler, WheelManager } from 'nebulosa/src/devices/indi/manager'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import { clamp } from 'nebulosa/src/math/numerical/math'
import type { OperationResult } from '#/orchestration'
import type { OperationScope } from './operation'
import { waitForDeviceState } from './operation.wait'
import { resourceKey } from './resource'

// Coordinated mutations of a filter wheel.
//
// A wheel has no abort vector, so a move is only ever waited for, never interrupted: the commands here
// turn the driver's slot change into an awaitable operation and leave the physical motion to finish on its
// own. Slots are 0-based, the same convention the device model publishes, and the INDI vector's 1-based
// numbering stays inside the manager. Every duration is in milliseconds.

// Timing overrides for one wheel command; every duration is in milliseconds.
export interface WheelCommandOptions {
	// Maximum time the commanded slot may take to be reached.
	readonly timeout?: number
}

// One observed wheel transition. The device is passed live rather than snapshotted because evaluation
// always reads the newest values, and the property/state pair is what carries an INDI Alert.
interface WheelUpdate {
	// Device the update came from.
	readonly wheel: Wheel
	// Field that changed, absent when the update is a poll of the current state.
	readonly property?: keyof Wheel & string
	// INDI state published with the change, absent when the update is a poll of the current state.
	readonly state?: PropertyState
}

// Default milliseconds a commanded slot change has to complete. A filter wheel crosses its whole carousel
// in a few seconds, so this is generous even for the longest move a large wheel can be asked for.
const DEFAULT_MOVE_TIMEOUT = 30000

// Properties whose Alert state means the commanded move itself failed. An Alert on an unrelated vector,
// such as the filter names, must not fail a move that is otherwise progressing.
const MOTION_PROPERTIES = new Set<string>(['position', 'moving'])

// Owns every mutation of a filter wheel and turns the ones with a physical effect into awaitable
// operations.
//
// Each command opens its own nested scope holding the wheel, so a direct endpoint runs it as a whole
// operation tree while a composite feature, passing its own context, inherits the wheel it already owns.
export class WheelCommander implements DeviceHandler<Wheel> {
	// Waiters per device, fed by the manager callbacks.
	readonly #listeners = new Map<Wheel, Set<(update: WheelUpdate) => void>>()

	// Registers the commander as a wheel observer so waits settle on device events instead of polling.
	constructor(readonly wheelManager: WheelManager) {
		wheelManager.addHandler(this)
	}

	// Required by the manager contract; discovery is published by WheelHandler.
	added() {}

	// Feeds every waiter observing the device, which is how a move learns it arrived or hit an Alert.
	updated(wheel: Wheel, property: keyof Wheel & string, state?: PropertyState) {
		this.#emit({ wheel, property, state })
	}

	// Wakes every waiter so it reevaluates; removal is reported as a disconnected device by evaluation,
	// and the operation itself is canceled independently by DeviceLifecycle.
	removed(wheel: Wheel) {
		this.#emit({ wheel })
	}

	// Selects a filter slot and resolves only after the wheel reports standing at it.
	//
	// The slot is 0-based and resolved against the carousel, so a target the driver would never echo
	// cannot leave the wait pending until it times out. Nothing is stopped when the move fails: the wheel
	// exposes no abort, and the lifecycle keeps the device unacquirable while it is still turning.
	async moveTo(scope: OperationScope, wheel: Wheel, slot: number, options: WheelCommandOptions = {}): Promise<OperationResult<void>> {
		return await scope.start<void>('wheelMoveTo', [{ key: resourceKey(wheel), device: wheel }], async (context) => {
			// Capabilities are only published while the device is connected, so a disconnected wheel would
			// otherwise be reported as one with a single slot.
			if (!wheel.connected) return { ok: false, reason: 'disconnected' }

			const target = wheelSlot(wheel, slot)

			const observed = await waitForDeviceState<WheelUpdate>({
				signal: context.signal,
				timeout: options.timeout ?? DEFAULT_MOVE_TIMEOUT,
				subscribe: (listener) => this.#subscribe(wheel, listener),
				current: () => ({ wheel }),
				evaluate: (update) => {
					if (!wheel.connected) return 'disconnected'
					if (update.state === 'Alert' && update.property !== undefined && MOTION_PROPERTIES.has(update.property)) return 'alert'
					return !wheel.moving && wheel.position === target ? 'success' : 'pending'
				},
				command: () => this.wheelManager.moveTo(wheel, target),
			})

			return observed.ok ? { ok: true, value: undefined } : observed
		}).result
	}

	// Renames the filter slots, which the driver applies without any movement.
	//
	// This acquires the wheel like a move: the names are what every later capture stamps into its frames,
	// and rewriting them under a running sequence would relabel filters it has already used.
	async setNames(scope: OperationScope, wheel: Wheel, names: readonly string[]): Promise<OperationResult<void>> {
		return await scope.start<void>('wheelNames', [{ key: resourceKey(wheel), device: wheel }], () => {
			if (!wheel.connected) return { ok: false, reason: 'disconnected' }
			if (!wheel.canSetNames) return { ok: false, reason: 'unexpectedState', error: `wheel ${wheel.name} cannot rename its slots` }

			this.wheelManager.slots(wheel, names)

			return { ok: true, value: undefined }
		}).result
	}

	// Registers a waiter for one device and returns its idempotent unsubscriber.
	#subscribe(wheel: Wheel, listener: (update: WheelUpdate) => void) {
		let listeners = this.#listeners.get(wheel)

		if (listeners === undefined) {
			listeners = new Set()
			this.#listeners.set(wheel, listeners)
		}

		listeners.add(listener)

		return () => {
			const current = this.#listeners.get(wheel)

			if (current?.delete(listener) && current.size === 0) this.#listeners.delete(wheel)
		}
	}

	// Notifies the waiters of one device.
	#emit(update: WheelUpdate) {
		const listeners = this.#listeners.get(update.wheel)
		if (listeners === undefined) return
		for (const listener of listeners) listener(update)
	}
}

// Resolves a requested slot to one the wheel can be commanded to and will report back, 0-based. A slot
// outside the carousel is never echoed by the driver, and waiting for it would only end in a timeout.
export function wheelSlot(wheel: Wheel, slot: number) {
	return Math.round(clamp(slot, 0, Math.max(0, wheel.count - 1)))
}
