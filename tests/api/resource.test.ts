import { describe, expect, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Camera, Focuser, GuideOutput, Rotator, SubDevice } from 'nebulosa/src/devices/indi/device'
import { DEFAULT_CAMERA, DEFAULT_FOCUSER, DEFAULT_GUIDE_OUTPUT, DEFAULT_ROTATOR } from 'nebulosa/src/devices/indi/device'
import { GuideOutputManager, MountManager } from 'nebulosa/src/devices/indi/manager'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { MountSimulator } from 'nebulosa/src/devices/indi/simulator/mount'
import { ResourceArbiter, resourceDevice, resourceKey } from 'src/api/resource'
import type { ResourceKey, ResourceOwner } from 'src/api/resource'

const CAMERA: ResourceKey = 'camera-1'
const MOUNT: ResourceKey = 'mount-1'

function owner(id: string): ResourceOwner {
	return { id, kind: 'test' }
}

function camera(connected: boolean): Camera {
	return {
		...structuredClone(DEFAULT_CAMERA),
		id: 'camera-1',
		hardwareId: 'hardware-1',
		name: 'camera-1',
		connected,
		client: { type: 'SIMULATOR', id: 'client' },
	}
}

function focuser(): Focuser {
	return {
		...structuredClone(DEFAULT_FOCUSER),
		id: 'focuser-1',
		hardwareId: 'hardware-2',
		name: 'combo-1',
		interfaces: ['focuser', 'rotator'],
		connected: true,
		client: { type: 'SIMULATOR', id: 'client' },
	}
}

function rotator(): Rotator {
	return {
		...structuredClone(DEFAULT_ROTATOR),
		id: 'rotator-1',
		hardwareId: 'hardware-2',
		name: 'combo-1',
		interfaces: ['focuser', 'rotator'],
		connected: true,
		client: { type: 'SIMULATOR', id: 'client' },
	}
}

function guideOutputProxy(parent: Camera): SubDevice<GuideOutput, Camera> {
	return {
		...structuredClone(DEFAULT_GUIDE_OUTPUT),
		id: 'guide-output-1',
		hardwareId: parent.hardwareId,
		parentId: parent.id,
		parent,
		name: parent.name,
		connected: parent.connected,
		client: parent.client,
	}
}

describe('resource arbiter', () => {
	test('acquires sorted deduplicated resources and releases once', () => {
		const arbiter = new ResourceArbiter()
		const context = owner('owner-1')
		const acquired = arbiter.acquire(context, [{ key: MOUNT }, { key: CAMERA }, { key: MOUNT }])

		expect(acquired.ok).toBeTrue()

		if (!acquired.ok) return

		expect(acquired.lease.resources).toEqual([CAMERA, MOUNT])
		expect(arbiter.availability(CAMERA)).toBe('leased')
		expect(arbiter.availability(MOUNT)).toBe('leased')

		acquired.lease.release()
		acquired.lease.release()

		expect(arbiter.availability(CAMERA)).toBe('available')
		expect(arbiter.availability(MOUNT)).toBe('available')
	})

	test('does not retain a partial lease after a multi-resource conflict', () => {
		const arbiter = new ResourceArbiter()
		const first = arbiter.acquire(owner('owner-1'), [{ key: CAMERA }])
		const secondOwner = owner('owner-2')
		const conflicted = arbiter.acquire(secondOwner, [{ key: MOUNT }, { key: CAMERA }])

		expect(first.ok).toBeTrue()
		expect(conflicted).toEqual({
			ok: false,
			conflicts: [{ key: CAMERA, ownerId: 'owner-1', ownerKind: 'test', causes: [] }],
		})
		expect(arbiter.owns(secondOwner, MOUNT)).toBeFalse()

		const mount = arbiter.acquire(owner('owner-3'), [{ key: MOUNT }])
		expect(mount.ok).toBeTrue()
	})

	test('allows reentrancy only for the same context identity', () => {
		const arbiter = new ResourceArbiter()
		const context = owner('same-id')
		const otherContext = owner('same-id')
		const outer = arbiter.acquire(context, [{ key: CAMERA }])
		const inner = arbiter.acquire(context, [{ key: CAMERA }])
		const conflict = arbiter.acquire(otherContext, [{ key: CAMERA }])

		expect(outer.ok).toBeTrue()
		expect(inner.ok).toBeTrue()
		expect(conflict.ok).toBeFalse()

		if (!outer.ok || !inner.ok) return

		inner.lease.release()
		expect(arbiter.owns(context, CAMERA)).toBeTrue()
		expect(arbiter.acquire(otherContext, [{ key: CAMERA }]).ok).toBeFalse()

		outer.lease.release()
		expect(arbiter.acquire(otherContext, [{ key: CAMERA }]).ok).toBeTrue()
	})

	test('keeps an unavailable resource unavailable after its lease is released', () => {
		const arbiter = new ResourceArbiter()
		const acquired = arbiter.acquire(owner('owner-1'), [{ key: CAMERA }])

		expect(acquired.ok).toBeTrue()
		arbiter.markUnavailable(CAMERA)
		expect(arbiter.availability(CAMERA)).toBe('unavailable')

		if (!acquired.ok) return

		acquired.lease.release()
		expect(arbiter.availability(CAMERA)).toBe('unavailable')
		expect(arbiter.acquire(owner('owner-2'), [{ key: CAMERA }])).toEqual({
			ok: false,
			conflicts: [{ key: CAMERA, ownerId: 'resource-arbiter', ownerKind: 'unavailable', causes: ['lifecycle'] }],
		})

		arbiter.markAvailable(CAMERA)
		expect(arbiter.availability(CAMERA)).toBe('available')
	})

	test('keeps a resource unavailable until every cause is cleared', () => {
		const arbiter = new ResourceArbiter()

		arbiter.markUnavailable(CAMERA, 'lifecycle')
		arbiter.markUnavailable(CAMERA, 'quarantine')
		expect(arbiter.availability(CAMERA)).toBe('unavailable')

		arbiter.markAvailable(CAMERA, 'quarantine')
		expect(arbiter.availability(CAMERA)).toBe('unavailable')

		arbiter.markAvailable(CAMERA, 'lifecycle')
		expect(arbiter.availability(CAMERA)).toBe('available')
	})

	test('lists the sorted resources held by a context across reentrant leases', () => {
		const arbiter = new ResourceArbiter()
		const context = owner('owner-1')
		const outer = arbiter.acquire(context, [{ key: MOUNT }, { key: CAMERA }])
		const inner = arbiter.acquire(context, [{ key: CAMERA }])

		expect(outer.ok).toBeTrue()
		expect(inner.ok).toBeTrue()
		expect(arbiter.resourcesOf(context)).toEqual([CAMERA, MOUNT])
		expect(arbiter.resourcesOf(owner('owner-2'))).toEqual([])

		if (!outer.ok || !inner.ok) return

		inner.lease.release()
		expect(arbiter.resourcesOf(context)).toEqual([CAMERA, MOUNT])

		outer.lease.release()
		expect(arbiter.resourcesOf(context)).toEqual([])
	})

	test('keeps an active cause after the physical device is disassociated', () => {
		const arbiter = new ResourceArbiter()
		const device = camera(true)

		arbiter.markUnavailable({ key: CAMERA, device }, 'quarantine')

		expect(arbiter.disassociate(CAMERA, device)).toBeTrue()
		expect(arbiter.availability(CAMERA)).toBe('unavailable')

		arbiter.markAvailable(CAMERA, 'quarantine')
		expect(arbiter.availability(CAMERA)).toBe('available')
	})

	test('reports every active cause on a conflict', () => {
		const arbiter = new ResourceArbiter()
		const device = camera(true)

		arbiter.markUnavailable({ key: CAMERA, device }, 'quarantine')
		arbiter.markClientUnavailable(device.client.id)

		const conflicted = arbiter.acquire(owner('owner-1'), [{ key: CAMERA, device }])

		expect(conflicted).toEqual({
			ok: false,
			conflicts: [{ key: CAMERA, ownerId: 'resource-arbiter', ownerKind: 'unavailable', causes: ['lifecycle', 'quarantine'] }],
		})
	})

	test('seeds availability when a device is associated after logical use', () => {
		const arbiter = new ResourceArbiter()
		const logical = arbiter.acquire(owner('owner-1'), [{ key: CAMERA }])

		expect(logical.ok).toBeTrue()

		if (!logical.ok) return

		logical.lease.release()
		const disconnected = camera(false)

		expect(arbiter.acquire(owner('owner-2'), [{ key: CAMERA, device: disconnected }])).toEqual({
			ok: false,
			conflicts: [{ key: CAMERA, ownerId: 'resource-arbiter', ownerKind: 'unavailable', causes: ['lifecycle'] }],
		})

		arbiter.markAvailable(CAMERA)
		expect(arbiter.acquire(owner('owner-3'), [{ key: CAMERA, device: disconnected }]).ok).toBeTrue()
	})

	test('disassociates only the matching physical device', () => {
		const arbiter = new ResourceArbiter()
		const device = camera(true)
		const replacement = camera(true)
		const context = owner('owner-1')
		const acquired = arbiter.acquire(context, [{ key: CAMERA, device }])

		expect(acquired.ok).toBeTrue()
		arbiter.markUnavailable({ key: CAMERA, device })
		expect(arbiter.disassociate(CAMERA, replacement)).toBeFalse()
		expect(arbiter.ownersOfClient('client')).toEqual([context])

		expect(arbiter.disassociate(CAMERA, device)).toBeTrue()
		expect(arbiter.ownersOfClient('client')).toEqual([])
		expect(arbiter.availability(CAMERA)).toBe('unavailable')
	})

	test('blocks existing and future resources until a client reconnects', () => {
		const arbiter = new ResourceArbiter()
		const first = camera(true)

		arbiter.markAvailable({ key: CAMERA, device: first })
		arbiter.markClientUnavailable(first.client.id)

		expect(arbiter.availability(CAMERA)).toBe('unavailable')

		const second = camera(true)
		second.id = 'camera-2'
		const secondKey = resourceKey(second)
		arbiter.markAvailable({ key: secondKey, device: second })

		expect(arbiter.availability(secondKey)).toBe('unavailable')

		arbiter.markClientAvailable(first.client.id)
		arbiter.markAvailable({ key: CAMERA, device: first })
		arbiter.markAvailable({ key: secondKey, device: second })

		expect(arbiter.availability(CAMERA)).toBe('available')
		expect(arbiter.availability(secondKey)).toBe('available')
	})

	test('associates a subdevice lease with its physical parent identity', () => {
		const arbiter = new ResourceArbiter()
		const parent = camera(true)
		const proxy = guideOutputProxy(parent)
		const key = resourceKey(proxy)
		const context = owner('owner-1')

		expect(key).toBe(parent.hardwareId)
		expect(resourceDevice(proxy)).toBe(parent)
		expect(arbiter.acquire(context, [{ key, device: proxy }]).ok).toBeTrue()
		expect(arbiter.ownersOfClient(parent.client.id)).toEqual([context])
		expect(arbiter.disassociate(key, parent)).toBeTrue()
		expect(arbiter.ownersOfClient(parent.client.id)).toEqual([])
	})

	test('arbitrates two top-level interfaces of one physical device as a single resource', () => {
		const arbiter = new ResourceArbiter()
		const focusing = focuser()
		const rotating = rotator()
		const key = resourceKey(focusing)
		const first = owner('owner-1')
		const second = owner('owner-2')

		expect(focusing.id).not.toBe(rotating.id)
		expect(focusing.parentId).toBeUndefined()
		expect(rotating.parentId).toBeUndefined()
		expect(resourceKey(rotating)).toBe(key)

		expect(arbiter.acquire(first, [{ key, device: focusing }]).ok).toBeTrue()

		const contended = arbiter.acquire(second, [{ key: resourceKey(rotating), device: rotating }])

		expect(contended.ok).toBeFalse()
		expect(!contended.ok && contended.conflicts).toEqual([{ key, ownerId: 'owner-1', ownerKind: 'test', causes: [] }])
	})

	test('resolves the physical parent from a real manager proxy', () => {
		const mountManager = new MountManager()
		const guideOutputManager = new GuideOutputManager(mountManager)
		const handler = new IndiClientHandlerSet([mountManager, guideOutputManager])
		using client = new ClientSimulator('client', handler)
		using simulator = new MountSimulator('Mount Simulator', client)
		const parent = mountManager.get(client, simulator.name)!

		mountManager.connect(parent)

		const proxy = guideOutputManager.get(client, simulator.name)!

		expect(proxy.parentId).toBe(parent.id)
		expect(resourceKey(proxy)).toBe(resourceKey(parent))
		expect(resourceDevice(proxy)).toBe(parent)
	})
})
