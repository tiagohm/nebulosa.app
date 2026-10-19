import { afterEach, expect, spyOn, test } from 'bun:test'
import { failedOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { deg } from 'nebulosa/src/math/units/angle'
import { ConnectionManager } from './connection'
import { DEFAULT_MOUNT_NUDGE_OPTIONS, MountCommands, type MountNudgeDirection, type MountNudgeEvent, type MountNudgeOptions, type MountNudgeSession, type MountNudgeStartResponse, type MountSlewRequest, type MountSlewResponse } from './mounts'
import { type OperationEvent, type OperationRecord, OperationRegistry } from './operations'
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

async function setup(offset = deg(2), altitude = deg(30), nudge: MountNudgeOptions = DEFAULT_MOUNT_NUDGE_OPTIONS) {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const events: OperationEvent[] = []
	const fake = locator(offset, altitude)
	const operations = new OperationRegistry(manager.devices, (event) => events.push(event))
	disposables.push(operations)
	const nudgeEvents: MountNudgeEvent[] = []
	const commands = new MountCommands(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		fake.locate,
		operations,
		(event) => nudgeEvents.push(event),
		nudge,
	)
	disposables.push(commands)
	const summary = manager.devices.list(client).find((d) => d.type === 'mount')!
	return { manager, id, client, commands, operations, events, nudgeEvents, fake, mountId: summary.id }
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
	const { manager, id, client, commands, operations, events, fake, mountId } = await setup()
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
	const running: OperationRecord = { operationId: body.operationId, kind: 'mount.slew', devices: [{ connectionId: id, deviceId: mountId }], state: 'running', startedAt: expect.any(Number) as number }
	expect(events).toEqual([{ type: 'operation:updated', operation: running }])
	expect(operations.running()).toEqual([running])

	await waitUntil(() => events.length === 2, 30000)
	expect(events[1].operation).toEqual({ ...running, state: 'succeeded' })
	expect(operations.running()).toBeEmpty()
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

// Short lease used where expiry is under test, in milliseconds.
const SHORT_LEASE: MountNudgeOptions = { heartbeatInterval: 50, leaseTimeout: 300 }

// Latest published state of a press.
function nudgeSession(events: readonly MountNudgeEvent[], token: string) {
	return events.findLast((event) => event.session.token === token)?.session
}

// Whether a press has ended.
function nudgeEnded(events: readonly MountNudgeEvent[], token: string) {
	const phase = nudgeSession(events, token)?.phase
	return phase === 'stopped' || phase === 'failed'
}

// Starts a press and returns its status and body.
async function nudge(commands: MountCommands, id: string, mountId: string, token: string, direction: MountNudgeDirection) {
	const response = await commands.startNudge(id, mountId, { token, direction })
	return { status: response.status, body: (await response.json()) as Partial<MountNudgeStartResponse> & { readonly error?: string; readonly session?: MountNudgeSession } }
}

test('commands the axes of every direction and releases them on stop', async () => {
	const { manager, id, client, commands, nudgeEvents, operations, mountId } = await setup()
	const mount = await connectMount(manager, client, mountId)
	const mounts = manager.devices.mounts
	const calls: string[] = []
	spyOn(mounts, 'moveNorth').mockImplementation((_, enabled) => void calls.push(`N${enabled}`))
	spyOn(mounts, 'moveSouth').mockImplementation((_, enabled) => void calls.push(`S${enabled}`))
	spyOn(mounts, 'moveEast').mockImplementation((_, enabled) => void calls.push(`E${enabled}`))
	spyOn(mounts, 'moveWest').mockImplementation((_, enabled) => void calls.push(`W${enabled}`))

	const expected: Record<MountNudgeDirection, readonly string[]> = {
		N: ['Ntrue', 'Nfalse'],
		S: ['Strue', 'Sfalse'],
		E: ['Etrue', 'Efalse'],
		W: ['Wtrue', 'Wfalse'],
		NE: ['Ntrue', 'Etrue', 'Nfalse', 'Efalse'],
		NW: ['Ntrue', 'Wtrue', 'Nfalse', 'Wfalse'],
		SE: ['Strue', 'Etrue', 'Sfalse', 'Efalse'],
		SW: ['Strue', 'Wtrue', 'Sfalse', 'Wfalse'],
	}

	for (const [direction, commanded] of Object.entries(expected) as [MountNudgeDirection, readonly string[]][]) {
		calls.length = 0
		const token = `press-${direction}`
		const { status, body } = await nudge(commands, id, mountId, token, direction)
		expect(status).toBe(202)
		expect(body).toMatchObject({ session: { token, direction, phase: 'moving', connectionId: id, deviceId: mountId, slewRate: 'SPEED_7' }, heartbeatInterval: 500, leaseTimeout: 2000 })
		expect(commands.nudges()).toEqual([body.session!])
		expect(operations.running()).toMatchObject([{ operationId: body.session!.operationId, kind: 'mount.nudge', devices: [{ connectionId: id, deviceId: mountId }] }])

		expect((await commands.stopNudge(token)).status).toBe(204)
		expect(calls).toEqual([...commanded])
		expect(nudgeSession(nudgeEvents, token)).toMatchObject({ phase: 'stopped', stopConfirmed: true })
		expect(commands.nudges()).toBeEmpty()
		expect(operations.arbiter.availability(resourceKey(mount))).toBe('available')
	}
})

test('moves the simulator while held and stops it on release', async () => {
	const { manager, id, client, commands, nudgeEvents, mountId } = await setup()
	const mount = await connectMount(manager, client, mountId)
	const declination = mount.equatorialCoordinate.declination

	expect((await nudge(commands, id, mountId, 'held', 'NE')).status).toBe(202)
	// The simulator reports manual axis motion as a slew of its coordinate.
	await waitUntil(() => mount.slewing || mount.moving)
	await Bun.sleep(200)
	expect((await commands.stopNudge('held')).status).toBe(204)

	expect(mount.slewing || mount.moving).toBeFalse()
	expect(mount.equatorialCoordinate.declination).toBeGreaterThan(declination)
	expect(nudgeEvents.map((event) => event.session.phase)).toEqual(['starting', 'moving', 'stopping', 'stopped'])
})

test('a stop delivered before its start keeps the press from ever moving', async () => {
	const { manager, id, client, commands, operations, mountId } = await setup()
	const mount = await connectMount(manager, client, mountId)

	expect((await commands.stopNudge('late')).status).toBe(204)
	expect((await nudge(commands, id, mountId, 'late', 'N')).status).toBe(409)
	expect(mount.moving).toBeFalse()
	expect(operations.running()).toBeEmpty()
})

test('a stop sent while the start is in flight ends the press without leaving the mount moving', async () => {
	const { manager, id, client, commands, nudgeEvents, mountId } = await setup()
	const mount = await connectMount(manager, client, mountId)

	const [started, stopped] = await Promise.all([commands.startNudge(id, mountId, { token: 'quick', direction: 'SW' }), commands.stopNudge('quick')])

	expect(started.status).toBe(202)
	expect(((await started.json()) as MountNudgeStartResponse).session.phase).toBe('stopped')
	expect(stopped.status).toBe(204)
	expect(nudgeEvents.map((event) => event.session.phase)).not.toContain('moving')
	expect(mount.moving).toBeFalse()
	expect((await commands.stopNudge('quick')).status).toBe(204)
	expect((await nudge(commands, id, mountId, 'quick', 'SW')).status).toBe(409)
})

test('repeating a running start answers the same press', async () => {
	const { manager, id, client, commands, mountId } = await setup()
	await connectMount(manager, client, mountId)

	const first = await nudge(commands, id, mountId, 'twice', 'E')
	const second = await nudge(commands, id, mountId, 'twice', 'E')
	expect(second.status).toBe(202)
	expect(second.body.session?.operationId).toBe(first.body.session!.operationId)
	expect((await commands.stopNudge('twice')).status).toBe(204)
})

test('heartbeats keep a press moving and an expired lease stops it', async () => {
	const { manager, id, client, commands, nudgeEvents, operations, mountId } = await setup(deg(2), deg(30), SHORT_LEASE)
	const mount = await connectMount(manager, client, mountId)

	expect((await nudge(commands, id, mountId, 'kept', 'W')).body.leaseTimeout).toBe(300)

	for (let i = 0; i < 10; i++) {
		await Bun.sleep(SHORT_LEASE.heartbeatInterval)
		expect(commands.heartbeatNudge('kept').status).toBe(204)
	}

	expect(nudgeSession(nudgeEvents, 'kept')?.phase).toBe('moving')
	await waitUntil(() => nudgeEnded(nudgeEvents, 'kept'))

	expect(nudgeSession(nudgeEvents, 'kept')).toMatchObject({ phase: 'failed', reason: 'timeout', stopConfirmed: true })
	expect(mount.moving).toBeFalse()
	expect(operations.arbiter.availability(resourceKey(mount))).toBe('available')
	expect(commands.heartbeatNudge('kept').status).toBe(404)
	expect((await commands.stopNudge('kept')).status).toBe(204)
})

test('rolls a diagonal back when its second axis cannot start', async () => {
	const { manager, id, client, commands, operations, mountId } = await setup()
	const mount = await connectMount(manager, client, mountId)
	const mounts = manager.devices.mounts
	const moveEast = mounts.moveEast.bind(mounts)
	spyOn(mounts, 'moveEast').mockImplementation((device, enabled) => {
		if (enabled) throw new Error('transport closed')
		moveEast(device, enabled)
	})

	const { status, body } = await nudge(commands, id, mountId, 'partial', 'NE')
	expect(status).toBe(502)
	expect(body.session).toMatchObject({ phase: 'failed', reason: 'commandFailed', stopConfirmed: true })
	expect(mount.moving).toBeFalse()
	expect(operations.arbiter.availability(resourceKey(mount))).toBe('available')
})

test('refuses a direction along an axis the driver does not define', async () => {
	const { manager, id, client, commands, mountId } = await setup()
	const mount = await connectMount(manager, client, mountId)
	manager.devices.mounts.delProperty(client, { device: mount.name, name: 'TELESCOPE_MOTION_WE' })

	expect((await nudge(commands, id, mountId, 'diagonal', 'NW')).status).toBe(422)
	expect((await nudge(commands, id, mountId, 'cardinal', 'W')).status).toBe(422)
	expect((await nudge(commands, id, mountId, 'north', 'N')).status).toBe(202)
	expect((await commands.stopNudge('north')).status).toBe(204)
})

test('refuses a nudge of an unknown or disconnected mount', async () => {
	const { id, commands, mountId } = await setup()

	expect((await nudge(commands, id, 'unknown', 'a', 'N')).status).toBe(404)
	expect((await nudge(commands, 'other', mountId, 'b', 'N')).status).toBe(404)
	expect((await nudge(commands, id, mountId, 'c', 'N')).status).toBe(409)
})

test('arbitrates nudges against slews, other presses, and slew rate changes', async () => {
	const { manager, id, client, commands, events, fake, mountId } = await setup(deg(60))
	const mount = await connectMount(manager, client, mountId)
	manager.devices.mounts.slewRate(mount, 'SPEED_1')
	fake.setBase({ ...mount.equatorialCoordinate })

	expect((await commands.slew(id, mountId, request)).status).toBe(202)
	expect((await nudge(commands, id, mountId, 'during-slew', 'N')).status).toBe(409)
	expect((await commands.stop(id, mountId)).status).toBe(204)
	await waitUntil(() => events.length === 2)

	expect((await nudge(commands, id, mountId, 'first-tab', 'S')).status).toBe(202)
	expect((await nudge(commands, id, mountId, 'second-tab', 'N')).status).toBe(409)
	expect((await commands.slew(id, mountId, request)).status).toBe(409)
	expect((await commands.setSlewRate(id, mountId, { name: 'SPEED_3' })).status).toBe(409)
	expect((await commands.stopNudge('first-tab')).status).toBe(204)
}, 30000)

test('selects only a slew rate the mount reports', async () => {
	const { manager, id, client, commands, mountId } = await setup()
	const mount = await connectMount(manager, client, mountId)

	expect((await commands.setSlewRate(id, mountId, { name: 'WARP' })).status).toBe(422)
	expect((await commands.setSlewRate(id, mountId, { name: 'SPEED_3' })).status).toBe(204)
	await waitUntil(() => mount.slewRate === 'SPEED_3')
	expect(manager.devices.mountState(client, mountId)).toMatchObject({ canMove: true, canMoveNS: true, canMoveWE: true, moving: false, slewRate: 'SPEED_3' })
	expect(manager.devices.mountState(client, mountId)?.slewRates.map((rate) => rate.name)).toContain('SPEED_3')
})

test('a mount disconnecting under a press ends it without confirming the stop', async () => {
	const { manager, id, client, commands, nudgeEvents, mountId } = await setup()
	await connectMount(manager, client, mountId)

	expect((await nudge(commands, id, mountId, 'cut', 'E')).status).toBe(202)
	manager.devices.switch(client, mountId, false)
	await waitUntil(() => nudgeEnded(nudgeEvents, 'cut'))

	expect(nudgeSession(nudgeEvents, 'cut')).toMatchObject({ phase: 'failed', reason: 'disconnected', stopConfirmed: false })
})

test('an operation holding the camera does not block a nudge', async () => {
	const { manager, id, client, commands, operations, mountId } = await setup()
	await connectMount(manager, client, mountId)
	const cameraId = manager.devices.list(client).find((device) => device.type === 'camera')!.id
	manager.devices.switch(client, cameraId, true)
	const camera = manager.devices.camera(client, cameraId)!
	await waitUntil(() => camera.connected && operations.arbiter.availability(resourceKey(camera)) === 'available')
	const capture = operations.coordinator.start<void>('cameraCapture', [{ key: resourceKey(camera), device: camera }], async (context) => {
		const aborted = Promise.withResolvers<void>()
		context.signal.addEventListener('abort', () => aborted.resolve(), { once: true })
		await aborted.promise
		return failedOperationResult('aborted')
	})

	expect((await nudge(commands, id, mountId, 'while-capturing', 'N')).status).toBe(202)
	expect((await commands.stopNudge('while-capturing')).status).toBe(204)
	expect(operations.arbiter.availability(resourceKey(camera))).not.toBe('available')
	await capture.cancel()
})
