import { afterEach, expect, test } from 'bun:test'
import { deg } from 'nebulosa/src/math/units/angle'
import { ConnectionManager } from './connection'
import { type MountEvent, MountCommands, type MountSlewRequest, type MountSlewResponse } from './mounts'
import type { PositionRequest, SkyPosition } from './sky/ephemeris'
import type { SkyObjectRef } from './sky/types'

const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

const OBSERVER = { latitude: -23.5, longitude: -46.6, elevation: 760 }
const TARGET: SkyObjectRef = { kind: 'catalog', id: 32263 }

async function waitUntil(condition: () => boolean, timeout = 10000) {
	const start = Date.now()
	while (!condition()) {
		if (Date.now() - start > timeout) throw new Error('timeout')
		await Bun.sleep(20)
	}
}

// Fake locator answering a fixed equatorial point with the given altitude, recording its requests.
function locator(offset: number, altitude: number) {
	const requests: PositionRequest[] = []
	let base: { rightAscension: number; declination: number } | undefined
	const locate = (_: SkyObjectRef, request: PositionRequest) => {
		requests.push(request)
		const rightAscension = (base?.rightAscension ?? 0) + offset
		const declination = base?.declination ?? 0
		return Promise.resolve({ time: request.time, source: 'local', center: 'topocentric', rightAscension, declination, rightAscensionJ2000: rightAscension, declinationJ2000: declination, azimuth: 1, altitude, constellation: 'ORI' } satisfies SkyPosition)
	}
	return { requests, locate, setBase: (value: typeof base) => (base = value) }
}

async function setup(offset = deg(2), altitude = deg(30)) {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const events: MountEvent[] = []
	const fake = locator(offset, altitude)
	const commands = new MountCommands(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		fake.locate,
		(event) => events.push(event),
	)
	disposables.push(commands)
	const summary = manager.devices.list(client).find((d) => d.type === 'mount')!
	return { manager, id, client, commands, events, fake, mountId: summary.id }
}

async function connectMount(manager: ConnectionManager, client: NonNullable<ReturnType<ConnectionManager['client']>>, mountId: string) {
	manager.devices.switch(client, mountId, true)
	const mount = manager.devices.mount(client, mountId)!
	await waitUntil(() => mount.connected && mount.canGoTo)
	manager.devices.mounts.slewRate(mount, 'SPEED_7')
	return mount
}

const request: MountSlewRequest = { target: TARGET, observer: OBSERVER }

test('slews to an object resolved at the real current time and reports the real outcome', async () => {
	const { manager, id, client, commands, events, fake, mountId } = await setup()
	const mount = await connectMount(manager, client, mountId)
	fake.setBase({ ...mount.equatorialCoordinate })

	const before = Date.now()
	const response = await commands.slew(id, mountId, request)
	expect(response.status).toBe(202)
	const body = (await response.json()) as MountSlewResponse

	expect(fake.requests).toHaveLength(1)
	expect(fake.requests[0].time).toBeGreaterThanOrEqual(before)
	expect(fake.requests[0].time).toBeLessThanOrEqual(Date.now())
	expect(fake.requests[0].observer).toEqual(OBSERVER)
	expect(body.time).toBe(fake.requests[0].time)
	expect(events).toEqual([{ type: 'mount:operation', operation: { connectionId: id, id: mountId, operationId: body.operationId, kind: 'slew', state: 'running' } }])

	await waitUntil(() => events.length === 2, 30000)
	expect(events[1].operation).toEqual({ connectionId: id, id: mountId, operationId: body.operationId, kind: 'slew', state: 'succeeded' })
	expect(mount.equatorialCoordinate.rightAscension).toBeCloseTo(body.rightAscension, 2)
}, 40000)

test('refuses a target below the horizon', async () => {
	const { manager, id, client, commands, events, mountId } = await setup(deg(2), deg(-5))
	await connectMount(manager, client, mountId)

	const response = await commands.slew(id, mountId, request)
	expect(response.status).toBe(422)
	expect(events).toBeEmpty()
})

test('refuses an unknown mount, another connection, and a disconnected mount', async () => {
	const { id, commands, mountId } = await setup()

	expect((await commands.slew(id, 'unknown', request)).status).toBe(404)
	expect((await commands.slew('other', mountId, request)).status).toBe(404)
	expect((await commands.slew(id, mountId, request)).status).toBe(409)
	expect(commands.state(id, mountId).status).toBe(200)
	expect(commands.state('other', mountId).status).toBe(404)
})

test('refuses a second slew while the first holds the mount, and stop aborts it', async () => {
	const { manager, id, client, commands, events, fake, mountId } = await setup(deg(60))
	const mount = await connectMount(manager, client, mountId)
	manager.devices.mounts.slewRate(mount, 'SPEED_1')
	fake.setBase({ ...mount.equatorialCoordinate })

	expect((await commands.slew(id, mountId, request)).status).toBe(202)
	expect((await commands.slew(id, mountId, request)).status).toBe(409)

	await waitUntil(() => mount.slewing)
	expect((await commands.stop(id, mountId)).status).toBe(204)
	await waitUntil(() => events.length === 2)
	expect(events[1].operation).toMatchObject({ state: 'failed', reason: 'aborted' })
	expect(mount.slewing).toBeFalse()
}, 30000)
