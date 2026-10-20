import { afterEach, expect, test } from 'bun:test'
import { deg, toDeg } from 'nebulosa/src/math/units/angle'
import type { CommandAccepted } from './commands'
import { ConnectionManager } from './connection'
import { DomeCommands, type DomeMotionEvent, type DomeMotionStartResponse } from './domes'
import type { LeaseOptions } from './leases'
import { type OperationEvent, OperationRegistry } from './operations'

const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

async function waitUntil(condition: () => boolean, timeout = 10000) {
	const start = Date.now()
	while (!condition()) {
		if (Date.now() - start > timeout) throw new Error('timeout')
		await Bun.sleep(20)
	}
}

// Short lease used where expiry is under test, in milliseconds.
const SHORT_LEASE: LeaseOptions = { heartbeatInterval: 50, leaseTimeout: 300 }

// Simulator connection with its dome connected.
async function setup(lease?: LeaseOptions) {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const events: OperationEvent[] = []
	const motions: DomeMotionEvent[] = []
	const operations = new OperationRegistry(manager.devices, (event) => events.push(event))
	disposables.push(operations)
	const commands = new DomeCommands(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		(event) => motions.push(event),
		lease,
	)
	disposables.push(commands)
	const domeId = manager.devices.list(client).find((d) => d.type === 'dome')!.id
	manager.devices.switch(client, domeId, true)
	const dome = manager.devices.device(client, 'dome', domeId)!
	await waitUntil(() => dome.connected && dome.canSetAzimuth && dome.hasShutter && operations.available(dome))
	return { id, client, manager, commands, operations, events, motions, dome, domeId }
}

// Resolves once the operation reported its outcome and returns its final record.
async function outcome(events: readonly OperationEvent[], operationId: string) {
	await waitUntil(() => events.some((event) => event.operation.operationId === operationId && event.operation.state !== 'running'), 30000)
	return events.findLast((event) => event.operation.operationId === operationId)!.operation
}

// Latest published state of a manual rotation.
function motionSession(events: readonly DomeMotionEvent[], token: string) {
	return events.findLast((event) => event.session.token === token)?.session
}

test('slews to an azimuth in degrees and opens and closes the shutter as operations', async () => {
	const { id, commands, events, dome, domeId } = await setup()
	const target = (toDeg(dome.azimuth.value) + 30) % 360

	const slew = (await commands.slew(id, domeId, { token: 's', azimuth: target }).json()) as CommandAccepted
	expect(commands.slew(id, domeId, { token: 'other', azimuth: 0 }).status).toBe(409)
	expect(await outcome(events, slew.operationId)).toMatchObject({ kind: 'dome.slew', state: 'succeeded' })
	expect(Math.abs(toDeg(dome.azimuth.value) - target)).toBeLessThan(2)

	const open = (await commands.shutter(id, domeId, { token: 'o', open: true }).json()) as CommandAccepted
	expect(await outcome(events, open.operationId)).toMatchObject({ kind: 'dome.shutter', state: 'succeeded' })
	expect(dome.shutterState).toBe('OPEN')
	const close = (await commands.shutter(id, domeId, { token: 'c', open: false }).json()) as CommandAccepted
	await outcome(events, close.operationId)
	expect(dome.shutterState).toBe('CLOSED')
}, 40000)

test('slaving to the mount refuses motions until it is switched off', async () => {
	const { id, commands, dome, domeId } = await setup()
	expect(dome.canSlave).toBeTrue()

	expect((await commands.setSlaving(id, domeId, { enabled: true })).status).toBe(204)
	expect(dome.slaved).toBeTrue()
	expect(commands.slew(id, domeId, { token: 's', azimuth: 10 }).status).toBe(409)
	expect((await commands.startMotion(id, domeId, { token: 'm', direction: 'CLOCKWISE' })).status).toBe(409)
	expect((await commands.setSlaving(id, domeId, { enabled: false })).status).toBe(204)
	expect(dome.slaved).toBeFalse()
})

test('parks and unparks, refusing motions while parked', async () => {
	const { id, commands, events, dome, domeId } = await setup()

	const park = (await commands.park(id, domeId, { token: 'p' }).json()) as CommandAccepted
	expect(await outcome(events, park.operationId)).toMatchObject({ kind: 'dome.park', state: 'succeeded' })
	expect(dome.parked).toBeTrue()
	expect(commands.slew(id, domeId, { token: 's', azimuth: 10 }).status).toBe(409)

	const unpark = (await commands.unpark(id, domeId, { token: 'u' }).json()) as CommandAccepted
	expect(await outcome(events, unpark.operationId)).toMatchObject({ state: 'succeeded' })
	expect(dome.parked).toBeFalse()
}, 60000)

test('stop aborts a slew, and sync and speed follow the capabilities', async () => {
	const { id, commands, events, dome, domeId } = await setup()

	const slew = (await commands.slew(id, domeId, { token: 'far', azimuth: (toDeg(dome.azimuth.value) + 170) % 360 }).json()) as CommandAccepted
	await waitUntil(() => dome.slewing)
	expect((await commands.stop(id, domeId)).status).toBe(204)
	expect(await outcome(events, slew.operationId)).toMatchObject({ state: 'failed', reason: 'aborted' })

	expect((await commands.sync(id, domeId, { azimuth: 45 })).status).toBe(dome.canSync ? 204 : 422)
	if (dome.canSync) await waitUntil(() => Math.abs(dome.azimuth.value - deg(45)) < deg(0.5))
	expect((await commands.setSpeed(id, domeId, { value: 3 })).status).toBe(dome.canSetSpeed ? 204 : 422)
}, 40000)

test('a manual rotation runs while renewed and stops on release or when its lease expires', async () => {
	const { id, commands, motions, dome, domeId } = await setup(SHORT_LEASE)

	const response = await commands.startMotion(id, domeId, { token: 'held', direction: 'CLOCKWISE' })
	expect(response.status).toBe(202)
	expect(((await response.json()) as DomeMotionStartResponse).session).toMatchObject({ phase: 'moving', direction: 'CLOCKWISE', deviceId: domeId })
	expect(commands.slew(id, domeId, { token: 's', azimuth: 0 }).status).toBe(409)
	expect(commands.heartbeatMotion('held').status).toBe(204)
	expect((await commands.stopMotion('held')).status).toBe(204)
	expect(motionSession(motions, 'held')).toMatchObject({ phase: 'stopped', stopConfirmed: true })
	expect(dome.moving).toBeFalse()
	expect((await commands.startMotion(id, domeId, { token: 'held', direction: 'CLOCKWISE' })).status).toBe(409)

	expect((await commands.startMotion(id, domeId, { token: 'lost', direction: 'COUNTER_CLOCKWISE' })).status).toBe(202)
	await waitUntil(() => motionSession(motions, 'lost')?.phase === 'failed', 5000)
	expect(motionSession(motions, 'lost')).toMatchObject({ reason: 'timeout' })
	expect(commands.motions()).toBeEmpty()
}, 30000)
