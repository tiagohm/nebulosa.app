import { describe, expect, test } from 'bun:test'
import { ResourceArbiter } from 'src/api/resource'
import type { ResourceKey, ResourceOwner } from 'src/api/resource'

const CAMERA: ResourceKey = 'client:camera:camera-1'
const MOUNT: ResourceKey = 'client:mount:mount-1'

function owner(id: string): ResourceOwner {
	return { id, kind: 'test' }
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
			conflicts: [{ key: CAMERA, ownerId: 'owner-1', ownerKind: 'test' }],
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
			conflicts: [{ key: CAMERA, ownerId: 'resource-arbiter', ownerKind: 'unavailable' }],
		})

		arbiter.markAvailable(CAMERA)
		expect(arbiter.availability(CAMERA)).toBe('available')
	})
})
