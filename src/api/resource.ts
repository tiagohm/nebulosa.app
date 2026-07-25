import { CLIENT } from 'nebulosa/src/devices/indi/device'
import type { Device } from 'nebulosa/src/devices/indi/device'

// Stable identity of one physical or logical resource, scoped by client, device type, and device id.
export type ResourceKey = `${string}:${string}:${string}`

// Observable arbitration state; unavailable takes precedence over an existing lease.
export type ResourceAvailability = 'available' | 'leased' | 'unavailable'

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
	// Whether lifecycle currently permits new acquisitions.
	available: boolean
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

// Builds the canonical resource key for a device; the hidden live client id wins over serialized info.
export function resourceKey(device: Device): ResourceKey {
	const clientId = device[CLIENT]?.id ?? device.client.id
	return `${clientId}:${device.type}:${device.id}`
}

// Arbitrates physical and logical resources atomically without waiting or preemption.
export class ResourceArbiter {
	readonly #resources = new Map<ResourceKey, ResourceRecord>()
	readonly #ownerResources = new Map<ResourceOwner, Map<ResourceKey, number>>()

	// Returns the effective state for a key; unknown logical resources start available.
	availability(key: ResourceKey): ResourceAvailability {
		const resource = this.#resources.get(key)

		if (resource === undefined) return 'available'
		if (!resource.available) return 'unavailable'
		return resource.owner === undefined ? 'available' : 'leased'
	}

	// Allows new acquisitions while retaining any existing owner until its lease is released.
	markAvailable(request: ResourceRequest | ResourceKey) {
		const resource = this.#resource(request)
		resource.available = true
	}

	// Blocks new acquisitions without releasing or replacing an existing owner.
	markUnavailable(request: ResourceRequest | ResourceKey) {
		const resource = this.#resource(request)
		resource.available = false
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

			if (!resource.available) {
				conflicts.push(conflict(request.key, UNAVAILABLE_OWNER))
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

	// Finds or creates the persistent record, seeding availability only on its first physical association.
	#resource(request: ResourceRequest | ResourceKey) {
		const key = typeof request === 'string' ? request : request.key
		let resource = this.#resources.get(key)

		if (resource === undefined) {
			const device = typeof request === 'string' ? undefined : request.device
			resource = {
				available: device?.connected ?? true,
				clientId: device?.[CLIENT]?.id ?? device?.client.id,
				device,
				depth: 0,
			}
			this.#resources.set(key, resource)
		} else if (typeof request !== 'string' && request.device !== undefined) {
			if (resource.device === undefined) resource.available = request.device.connected
			resource.device = request.device
			resource.clientId = request.device[CLIENT]?.id ?? request.device.client.id
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
function conflict(key: ResourceKey, owner: ResourceOwner): ResourceConflict {
	return { key, ownerId: owner.id, ownerKind: owner.kind }
}
