import type { Camera, Device, Focuser, GuideOutput, Mount, Rotator, Wheel } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler } from 'nebulosa/src/devices/indi/manager'
import type { OperationFailureReason } from './operation'
import { OperationCoordinator } from './operation'
import { resourceKey, ResourceArbiter } from './resource'
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

// Bridges manager add/update/remove events into availability and operation cancellation.
export class DeviceLifecycle {
	readonly #devices = new Map<ResourceKey, Device>()
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
		this.#devices.set(key, device)
		this.arbiter.markUnavailable({ key, device })
		this.#validate(device, verify)
	}

	// Cancels on disconnect and retries validation when a reconnecting device becomes quiescent.
	#updated<D extends Device>(device: D, property: keyof D & string, verify: DeviceAvailabilityVerifier<D>) {
		const key = resourceKey(device)

		if (this.#devices.get(key) !== device) return

		if (property === 'connected' && !device.connected) {
			this.#invalidate(key, device, 'disconnected')
		} else if (this.arbiter.availability(key) === 'unavailable' && device.connected) {
			this.#validate(device, verify)
		}
	}

	// Makes the resource unavailable and synchronously starts owner cancellation before forgetting it.
	#removed(device: Device) {
		const key = resourceKey(device)

		if (this.#devices.get(key) !== device) return

		this.#invalidate(key, device, 'removed')
		this.#devices.delete(key)
	}

	// Invalidates pending verification and starts cancellation without waiting inside manager callbacks.
	#invalidate(key: ResourceKey, device: Device, reason: OperationFailureReason) {
		this.#nextValidation(key)
		this.arbiter.markUnavailable({ key, device })
		void this.coordinator.cancelByResource(key, reason)
	}

	// Runs a synchronous or asynchronous readiness check guarded by device identity and generation.
	#validate<D extends Device>(device: D, verify: DeviceAvailabilityVerifier<D>) {
		const key = resourceKey(device)
		const generation = this.#nextValidation(key)
		let available: boolean | Promise<boolean>

		try {
			available = device.connected && verify(device)
		} catch {
			return
		}

		if (typeof available === 'boolean') {
			this.#validated(key, device, generation, available)
		} else {
			void Promise.resolve(available)
				.then((result) => this.#validated(key, device, generation, result))
				.catch((e) => console.error(e))
		}
	}

	// Marks only the latest connected instance available after successful verification.
	#validated(key: ResourceKey, device: Device, generation: number, available: boolean) {
		if (!available || !device.connected || this.#devices.get(key) !== device || this.#validationGeneration.get(key) !== generation) return
		this.arbiter.markAvailable({ key, device })
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
		default:
			return true
	}
}
