import { CLIENT } from 'nebulosa/src/devices/indi/device'
import type { Device, SubDevice } from 'nebulosa/src/devices/indi/device'

// Opaque stable identity of one physical or logical resource.
export type ResourceKey = string

// Observable arbitration state; unavailable takes precedence over an existing lease.
export type ResourceAvailability = 'available' | 'leased' | 'unavailable'

// Independent cause blocking acquisition. Each writer clears only its own cause, so a resource
// becomes acquirable again only after every cause has been resolved.
// - lifecycle: device connectivity and physical quiescence, owned by DeviceLifecycle.
// - quarantine: an outstanding driver payload that must be discarded before the device is safe.
export type ResourceUnavailableCause = 'lifecycle' | 'quarantine'

// One resource requested atomically by an operation.
export interface ResourceRequest {
	// Canonical identity used for ordering, conflict checks, and ownership.
	readonly key: ResourceKey
	// Physical device used to index the resource by client and seed its availability.
	readonly device?: Device
}

// Context identity that owns leases; object identity, not just id equality, defines reentrancy.
export interface ResourceOwner {
	// Stable operation identifier exposed to transports and diagnostics.
	readonly id: string
	// Human-readable operation category used in conflict details.
	readonly kind: string
}

// Existing owner that prevented one requested resource from being acquired.
export interface ResourceConflict {
	// Conflicting resource identity.
	readonly key: ResourceKey
	// Identifier of the current owner, or the arbiter sentinel for unavailable resources.
	readonly ownerId: string
	// Category of the current owner, or unavailable for resources blocked by lifecycle.
	readonly ownerKind: string
	// Active causes when the resource is unavailable; empty when another owner holds it.
	readonly causes: readonly ResourceUnavailableCause[]
}

// Atomic acquisition outcome containing either the complete lease or every detected conflict.
export type AcquireResult = { readonly ok: true; readonly lease: ResourceLease } | { readonly ok: false; readonly conflicts: readonly ResourceConflict[] }

// Idempotently releasable ownership acquired by one context.
export interface ResourceLease {
	// Identifier of the context that acquired the lease.
	readonly ownerId: string
	// Canonically sorted and deduplicated resource identities held by this lease.
	readonly resources: readonly ResourceKey[]
	// Releases only this acquisition depth; repeated calls have no effect.
	readonly release: VoidFunction
}

// Mutable arbitration record retained across disconnect and reconnect transitions.
interface ResourceRecord {
	// Active causes blocking new acquisitions; empty means no writer is blocking the resource.
	readonly causes: Set<ResourceUnavailableCause>
	// Client index used to cancel every affected owner on client shutdown.
	clientId?: string
	// Latest physical device instance associated with the key.
	device?: Device
	// Context currently holding the resource, when leased.
	owner?: ResourceOwner
	// Number of active reentrant lease levels held by the same context.
	depth: number
}

// Synthetic conflict owner used because ResourceConflict always carries owner details.
const UNAVAILABLE_OWNER: ResourceOwner = {
	id: 'resource-arbiter',
	kind: 'unavailable',
}

// Builds the canonical resource key from the physical parent id or the device's globally unique id.
export function resourceKey(device: Device): ResourceKey {
	return device.parentId ?? device.id
}

// Returns the live physical parent behind a subdevice proxy, or the original device otherwise.
export function resourceDevice(device: Device): Device {
	return device.parentId === undefined ? device : ((device as Partial<SubDevice<Device, Device>>).parent ?? device)
}

// Arbitrates physical and logical resources atomically without waiting or preemption.
export class ResourceArbiter {
	readonly #resources = new Map<ResourceKey, ResourceRecord>()
	readonly #ownerResources = new Map<ResourceOwner, Map<ResourceKey, number>>()
	readonly #unavailableClients = new Set<string>()

	// Returns the effective state for a key; unknown logical resources start available.
	availability(key: ResourceKey): ResourceAvailability {
		const resource = this.#resources.get(key)

		if (resource === undefined) return 'available'
		if (!this.#available(resource)) return 'unavailable'
		return resource.owner === undefined ? 'available' : 'leased'
	}

	// Clears one cause while retaining any other cause and any existing owner.
	markAvailable(request: ResourceRequest | ResourceKey, cause: ResourceUnavailableCause = 'lifecycle') {
		this.#resource(request).causes.delete(cause)
	}

	// Records one cause blocking acquisition without releasing or replacing an existing owner.
	markUnavailable(request: ResourceRequest | ResourceKey, cause: ResourceUnavailableCause = 'lifecycle') {
		this.#resource(request).causes.add(cause)
	}

	// Blocks existing and future physical resources for a client without disturbing retained owners.
	markClientUnavailable(clientId: string) {
		this.#unavailableClients.add(clientId)
	}

	// Allows lifecycle validation to make resources from a newly connected client available.
	markClientAvailable(clientId: string) {
		this.#unavailableClients.delete(clientId)
	}

	// Clears an exact physical device/client association while retaining availability and ownership; returns whether it matched.
	disassociate(key: ResourceKey, device: Device): boolean {
		const resource = this.#resources.get(key)

		if (resource?.device !== device) return false

		resource.device = undefined
		resource.clientId = undefined
		return true
	}

	// Acquires every sorted unique request or returns conflicts without retaining a partial lease.
	acquire(owner: ResourceOwner, requests: readonly ResourceRequest[]): AcquireResult {
		const normalized = normalizeRequests(requests)
		const conflicts: ResourceConflict[] = []

		for (const request of normalized) {
			const resource = this.#resource(request)

			if (!this.#available(resource)) {
				conflicts.push(conflict(request.key, UNAVAILABLE_OWNER, this.#causesOf(resource)))
			} else if (resource.owner !== undefined && resource.owner !== owner) {
				conflicts.push(conflict(request.key, resource.owner))
			}
		}

		if (conflicts.length > 0) return { ok: false, conflicts }

		let owned = this.#ownerResources.get(owner)

		if (owned === undefined) {
			owned = new Map()
			this.#ownerResources.set(owner, owned)
		}

		for (const request of normalized) {
			const resource = this.#resource(request)
			resource.owner = owner
			resource.depth++
			owned.set(request.key, (owned.get(request.key) ?? 0) + 1)
		}

		let released = false
		const resources = normalized.map((request) => request.key)

		return {
			ok: true,
			lease: {
				ownerId: owner.id,
				resources,
				release: () => {
					if (released) return
					released = true
					this.#release(owner, resources)
				},
			},
		}
	}

	// Tests ownership by exact context object identity.
	owns(owner: ResourceOwner, key: ResourceKey) {
		return this.#resources.get(key)?.owner === owner
	}

	// Returns the current owner of one resource, when present.
	ownersOf(key: ResourceKey): readonly ResourceOwner[] {
		const owner = this.#resources.get(key)?.owner
		return owner === undefined ? [] : [owner]
	}

	// Returns each distinct owner holding any physical resource associated with the client id.
	ownersOfClient(clientId: string): readonly ResourceOwner[] {
		const owners = new Set<ResourceOwner>()

		for (const resource of this.#resources.values()) {
			if (resource.clientId === clientId && resource.owner !== undefined) {
				owners.add(resource.owner)
			}
		}

		return [...owners]
	}

	// Lists the canonically sorted resources currently held by a context across reentrant leases.
	resourcesOf(owner: ResourceOwner): readonly ResourceKey[] {
		return this.#ownerResources.get(owner)?.keys().toArray().sort() ?? []
	}

	// Reports whether every cause has been cleared and the owning client still accepts acquisitions.
	#available(resource: ResourceRecord) {
		return resource.causes.size === 0 && (resource.clientId === undefined || !this.#unavailableClients.has(resource.clientId))
	}

	// Lists why a resource is blocked, reporting a disconnected client as a lifecycle cause of its own.
	#causesOf(resource: ResourceRecord): readonly ResourceUnavailableCause[] {
		const causes = [...resource.causes]
		if (resource.clientId !== undefined && this.#unavailableClients.has(resource.clientId) && !resource.causes.has('lifecycle')) causes.push('lifecycle')
		return causes.sort()
	}

	// Finds or creates the persistent record, seeding availability only on its first physical association.
	#resource(request: ResourceRequest | ResourceKey) {
		const key = typeof request === 'string' ? request : request.key
		let resource = this.#resources.get(key)

		if (resource === undefined) {
			const requestedDevice = typeof request === 'string' ? undefined : request.device
			const device = requestedDevice === undefined ? undefined : resourceDevice(requestedDevice)
			resource = {
				causes: new Set(device !== undefined && !device.connected ? (['lifecycle'] as const) : undefined),
				clientId: device?.[CLIENT]?.id ?? device?.client.id,
				device,
				depth: 0,
			}
			this.#resources.set(key, resource)
		} else if (typeof request !== 'string' && request.device !== undefined) {
			const device = resourceDevice(request.device)

			// A first physical association seeds connectivity; later ones keep the causes already recorded.
			if (resource.device === undefined && !device.connected) resource.causes.add('lifecycle')
			resource.device = device
			resource.clientId = device[CLIENT]?.id ?? device.client.id
		}

		return resource
	}

	// Decrements this lease's reentrant depths and clears ownership only at depth zero.
	#release(owner: ResourceOwner, keys: readonly ResourceKey[]) {
		const owned = this.#ownerResources.get(owner)

		if (owned === undefined) return

		for (const key of keys) {
			const resource = this.#resources.get(key)
			const depth = owned.get(key)

			if (resource?.owner !== owner || depth === undefined) continue

			if (depth <= 1) {
				owned.delete(key)
			} else {
				owned.set(key, depth - 1)
			}

			resource.depth--

			if (resource.depth <= 0) {
				resource.depth = 0
				resource.owner = undefined
			}
		}

		if (owned.size === 0) this.#ownerResources.delete(owner)
	}
}

// Sorts and deduplicates an acquisition batch, retaining a provided device association.
function normalizeRequests(requests: readonly ResourceRequest[]) {
	const normalized = new Map<ResourceKey, ResourceRequest>()

	for (const request of requests) {
		const previous = normalized.get(request.key)
		normalized.set(request.key, previous?.device === undefined && request.device !== undefined ? request : (previous ?? request))
	}

	return normalized
		.values()
		.toArray()
		.sort((a, b) => a.key.localeCompare(b.key))
}

// Projects an owner into the transport-safe conflict contract.
function conflict(key: ResourceKey, owner: ResourceOwner, causes: readonly ResourceUnavailableCause[] = []): ResourceConflict {
	return { key, ownerId: owner.id, ownerKind: owner.kind, causes }
}
