import type { Camera, Cover, Device, Focuser, GuideOutput, Mount, Rotator, Wheel } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler } from 'nebulosa/src/devices/indi/manager'
import type { OperationFailureReason } from './operation'
import { OperationCoordinator } from './operation'
import { resourceDevice, resourceKey, ResourceArbiter } from './resource'
import type { ResourceKey } from './resource'

// Minimal manager surface required to observe device lifecycle without depending on transport handlers.
export interface DeviceLifecycleManager<D extends Device> {
	// Registers a device lifecycle observer.
	readonly addHandler: (handler: DeviceHandler<D>) => void
	// Removes a previously registered observer.
	readonly removeHandler: (handler: DeviceHandler<D>) => void
	// Enumerates devices already known when observation begins.
	readonly list: () => Iterable<D>
}

// Verifies whether a connected device is physically quiescent and safe to acquire.
export type DeviceAvailabilityVerifier<D extends Device> = (device: D) => boolean | Promise<boolean>

// Idempotent manager-observer registration retained for lifecycle disposal.
interface Registration {
	// Detaches the observer from its manager.
	readonly dispose: VoidFunction
}

// One manager-specific view contributing readiness to a shared physical resource.
interface DeviceView {
	// Exact device or subdevice instance emitted by its manager.
	readonly device: Device
	// Evaluates type-specific quiescence for this view.
	readonly verify: () => boolean | Promise<boolean>
}

// Bridges manager add/update/remove events into availability and operation cancellation.
export class DeviceLifecycle {
	readonly #devices = new Map<ResourceKey, Map<Device, DeviceView>>()
	readonly #validationGeneration = new Map<ResourceKey, number>()
	readonly #registrations = new Set<Registration>()

	// Creates the lifecycle bridge over the process-wide arbiter and coordinator.
	constructor(
		readonly arbiter: ResourceArbiter,
		readonly coordinator: OperationCoordinator,
	) {}

	// Observes existing and future devices from one manager and returns an idempotent disposer.
	observe<D extends Device>(manager: DeviceLifecycleManager<D>, verify: DeviceAvailabilityVerifier<D> = isDeviceQuiescent): VoidFunction {
		const handler: DeviceHandler<D> = {
			added: (device) => this.#added(device, verify),
			updated: (device, property) => this.#updated(device, property, verify),
			removed: (device) => this.#removed(device),
		}

		manager.addHandler(handler)

		for (const device of manager.list()) this.#added(device, verify)

		let disposed = false

		const dispose = () => {
			if (disposed) return
			disposed = true
			manager.removeHandler(handler)
			this.#registrations.delete(registration)
		}

		const registration: Registration = { dispose }
		this.#registrations.add(registration)
		return dispose
	}

	// Detaches every manager observer registered by this lifecycle instance.
	dispose() {
		for (const registration of this.#registrations) registration.dispose()
	}

	// Registers a new instance as unavailable until its quiescence check succeeds.
	#added<D extends Device>(device: D, verify: DeviceAvailabilityVerifier<D>) {
		const key = resourceKey(device)
		let devices = this.#devices.get(key)

		if (devices === undefined) {
			devices = new Map()
			this.#devices.set(key, devices)
		}

		devices.set(device, { device, verify: () => verify(device) })
		this.arbiter.markUnavailable({ key, device: resourceDevice(device) })
		this.#validate(key)
	}

	// Cancels on disconnect and revalidates every connected update so external activity gates acquisition.
	#updated<D extends Device>(device: D, property: keyof D & string, verify: DeviceAvailabilityVerifier<D>) {
		const key = resourceKey(device)
		const devices = this.#devices.get(key)

		if (!devices?.has(device)) return

		devices.set(device, { device, verify: () => verify(device) })

		if (property === 'connected' && !device.connected) {
			this.#invalidate(key, resourceDevice(device), 'disconnected')
		} else if (device.connected) {
			this.#validate(key)
		}
	}

	// Cancels on any removed view and releases the physical association only after the last view disappears.
	#removed(device: Device) {
		const key = resourceKey(device)
		const devices = this.#devices.get(key)

		if (!devices?.delete(device)) return

		const physicalDevice = resourceDevice(device)
		this.#invalidate(key, physicalDevice, 'removed')

		if (devices.size === 0) {
			this.#devices.delete(key)
			this.arbiter.disassociate(key, physicalDevice)
		} else {
			this.#validate(key)
		}
	}

	// Invalidates pending verification and starts cancellation without waiting inside manager callbacks.
	#invalidate(key: ResourceKey, device: Device, reason: OperationFailureReason) {
		this.#nextValidation(key)
		this.arbiter.markUnavailable({ key, device })
		void this.coordinator.cancelByResource(key, reason)
	}

	// Blocks acquisition while aggregating every live view under one generation guard.
	#validate(key: ResourceKey) {
		const devices = this.#devices.get(key)

		if (devices === undefined || devices.size === 0) return

		const generation = this.#nextValidation(key)
		const first = devices.values().next().value

		if (first === undefined) return

		const physicalDevice = resourceDevice(first.device)
		const pending: Promise<boolean>[] = []

		this.arbiter.markUnavailable({ key, device: physicalDevice })

		for (const view of devices.values()) {
			if (!view.device.connected) {
				this.#validated(key, generation, false)
				return
			}

			try {
				const available = view.verify()

				if (typeof available === 'boolean') {
					if (!available) {
						this.#validated(key, generation, false)
						return
					}
				} else {
					pending.push(Promise.resolve(available))
				}
			} catch (error) {
				// A verifier that cannot decide leaves the device blocked, never acquirable by mistake.
				console.error('device availability check failed:', key, error)
				this.#validated(key, generation, false)
				return
			}
		}

		if (pending.length === 0) {
			this.#validated(key, generation, true)
		} else {
			void Promise.all(pending).then(
				(results) => this.#validated(key, generation, results.every(Boolean)),
				(error) => {
					console.error('device availability check failed:', key, error)
					this.#validated(key, generation, false)
				},
			)
		}
	}

	// Applies the latest aggregate result only while the same resource generation remains registered.
	#validated(key: ResourceKey, generation: number, available: boolean) {
		const devices = this.#devices.get(key)

		if (devices === undefined || devices.size === 0 || this.#validationGeneration.get(key) !== generation) return

		const first = devices.values().next().value

		if (first === undefined) return

		const physicalDevice = resourceDevice(first.device)

		if (available) {
			this.arbiter.markAvailable({ key, device: physicalDevice })
		} else {
			this.arbiter.markUnavailable({ key, device: physicalDevice })
		}
	}

	// Advances the per-resource token used to discard stale asynchronous readiness results.
	#nextValidation(key: ResourceKey) {
		const generation = (this.#validationGeneration.get(key) ?? 0) + 1
		this.#validationGeneration.set(key, generation)
		return generation
	}
}

// Checks type-specific motion/exposure flags before a connected device can be acquired.
export function isDeviceQuiescent(device: Device) {
	if (!device.connected) return false

	switch (device.type) {
		case 'camera': {
			const camera = device as Camera
			return !camera.exposuring && camera.exposure.state !== 'Busy'
		}
		case 'mount': {
			const mount = device as Mount
			return !mount.slewing && !mount.homing && !mount.parking && !mount.pulsing
		}
		case 'focuser':
			return !(device as Focuser).moving
		case 'wheel':
			return !(device as Wheel).moving
		case 'rotator':
			return !(device as Rotator).moving
		case 'guideOutput':
			return !(device as GuideOutput).pulsing
		case 'cover':
			return !(device as Cover).parking
		default:
			return true
	}
}
