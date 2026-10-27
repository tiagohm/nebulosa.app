import { afterEach, expect, test } from 'bun:test'
import type { Socket } from 'bun'
import { equatorialToJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import { timeNow } from 'nebulosa/src/astronomy/time/time'
import type { Mount } from 'nebulosa/src/devices/indi/device'
import { isDeviceQuiescent } from 'nebulosa/src/devices/orchestration/device.lifecycle'
import { deg, hour, normalizeAngle } from 'nebulosa/src/math/units/angle'
import { ConnectionManager } from './connection'
import { DEFAULT_MOUNT_REMOTE_CONTROL_OPTIONS, type MountRemoteControlEvent, MountRemoteControlService, type MountRemoteControlOptions, type MountRemoteServer, type MountRemoteSnapshot } from './mountremotecontrol'
import { MountCommands } from './mounts'
import { type OperationEvent, OperationRegistry } from './operations'

const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

async function waitUntil(condition: () => boolean, timeout = 10000) {
	const start = Date.now()
	while (!condition()) {
		if (Date.now() - start > timeout) throw new Error('timeout')
		await Bun.sleep(10)
	}
}

// Returns a TCP port free on the loopback interface now.
function freePort() {
	const probe = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data: () => {} } })
	const { port } = probe
	probe.stop(true)
	return port
}

async function setup(options: Partial<MountRemoteControlOptions> = {}) {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const operationEvents: OperationEvent[] = []
	const operations = new OperationRegistry(manager.devices, (event) => operationEvents.push(event))
	disposables.push(operations)
	const resolve = (connectionId: string) => manager.client(connectionId)
	const mounts = new MountCommands(
		manager.devices,
		resolve,
		() => Promise.resolve(undefined),
		operations,
		() => {},
	)
	disposables.push(mounts)
	const events: MountRemoteControlEvent[] = []
	const service = new MountRemoteControlService(manager.devices, resolve, mounts, operations, (event) => events.push(event), { ...DEFAULT_MOUNT_REMOTE_CONTROL_OPTIONS, ...options })
	disposables.push(service)
	manager.listen((event) => service.deviceChanged(event))
	const mountId = manager.devices.list(client).find((d) => d.type === 'mount')!.id
	manager.devices.switch(client, mountId, true)
	const mount = manager.devices.mount(client, mountId)!
	await waitUntil(() => mount.connected && mount.canGoTo && mount.hasGeographicCoordinate)
	return { manager, id, client, mountId, mount, operations, operationEvents, mounts, service, events }
}

// TCP client collecting everything it receives as text and bytes.
async function connect(port: number) {
	const received: Buffer[] = []
	let closed = false
	const socket: Socket = await Bun.connect({
		hostname: '127.0.0.1',
		port,
		socket: {
			data: (_, data) => void received.push(Buffer.from(data)),
			close: () => {
				closed = true
			},
		},
	})
	disposables.push({ [Symbol.dispose]: () => socket.end() })
	return {
		socket,
		text: () => Buffer.concat(received).toString('ascii'),
		bytes: () => Buffer.concat(received).byteLength,
		closed: () => closed,
		// Sends LX200 commands and resolves with the text received until it satisfies done.
		async ask(command: string, done: (text: string) => boolean) {
			received.length = 0
			socket.write(command)
			await waitUntil(() => done(Buffer.concat(received).toString('ascii')))
			return Buffer.concat(received).toString('ascii')
		},
	}
}

// J2000 coordinate, in radians, of the zenith of the site the mount reports, now.
function zenith(mount: Mount) {
	const time = timeNow(true)
	const { latitude, longitude } = mount.geographicCoordinate
	return equatorialToJ2000(localSiderealTime(time, longitude), latitude, time)
}

// Status and parsed body of a response: a listener, or an error with its code.
async function json(response: Response): Promise<{ readonly status: number; readonly body: Partial<MountRemoteServer> & { readonly code?: string } }> {
	return { status: response.status, body: (await response.json()) as Partial<MountRemoteServer> & { readonly code?: string } }
}

// Formats whole seconds as two-digit sexagesimal fields separated by the given separators.
function sexagesimal(seconds: number, first: string) {
	const pad = (value: number) => value.toFixed(0).padStart(2, '0')
	return `${pad(Math.floor(seconds / 3600))}${first}${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`
}

// LX200 target setters for a J2000 coordinate in radians.
function lx200Target(rightAscension: number, declination: number) {
	const ra = Math.round((((rightAscension % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / hour(1 / 3600)) % 86400
	const dec = Math.round(Math.abs(declination) / deg(1 / 3600))
	return `:Sr${sexagesimal(ra, ':')}#:Sd${declination < 0 ? '-' : '+'}${sexagesimal(dec, '*')}#`
}

test('starts both protocols of a mount, answers a repeated start, refuses another binding, and stops', async () => {
	const { id, mountId, service, events } = await setup()
	const lx200Port = freePort()
	const stellariumPort = freePort()

	const lx200 = await json(service.start(id, mountId, 'lx200', { host: '127.0.0.1', port: lx200Port }))
	const stellarium = await json(service.start(id, mountId, 'stellarium', { host: '127.0.0.1', port: stellariumPort }))

	expect(lx200.status).toBe(200)
	expect(lx200.body).toMatchObject({ connectionId: id, deviceId: mountId, protocol: 'lx200', host: '127.0.0.1', port: lx200Port, clients: [] })
	expect(stellarium.body).toMatchObject({ protocol: 'stellarium', port: stellariumPort })

	const repeated = await json(service.start(id, mountId, 'lx200', { host: '127.0.0.1', port: lx200Port }))
	expect(repeated.body.revision).toBe(lx200.body.revision)

	const conflict = await json(service.start(id, mountId, 'lx200', { host: '127.0.0.1', port: freePort() }))
	expect(conflict.status).toBe(409)
	expect(conflict.body.code).toBe('conflict')

	const snapshot: MountRemoteSnapshot = service.snapshot()
	expect(snapshot.servers.map((server) => server.protocol)).toEqual(['lx200', 'stellarium'])
	expect(snapshot.revision).toBe(events.at(-1)!.revision)

	expect((await service.stop(id, mountId, 'lx200')).status).toBe(204)
	expect((await service.stop(id, mountId, 'lx200')).status).toBe(204)
	expect(service.snapshot().servers.map((server) => server.protocol)).toEqual(['stellarium'])
	expect(events.at(-1)).toMatchObject({ type: 'mountRemoteControl:updated', key: { connectionId: id, deviceId: mountId, protocol: 'lx200' }, server: undefined })
	expect(events.map((event) => event.revision)).toEqual(events.map((_, index) => index + 1))

	const client = await connect(stellariumPort)
	await waitUntil(() => service.snapshot().servers[0].clients.length === 1)
	expect(client.closed()).toBe(false)
	expect(service.start(id, mountId, 'lx200', { host: '127.0.0.1', port: freePort() }).status).toBe(200)
})

test('refuses an address in use without disturbing the listener that holds it', async () => {
	const { id, mountId, service } = await setup()
	const port = freePort()

	expect(service.start(id, mountId, 'lx200', { host: '127.0.0.1', port }).status).toBe(200)

	const refused = await json(service.start(id, mountId, 'stellarium', { host: '127.0.0.1', port }))
	expect(refused.status).toBe(409)
	expect(refused.body.code).toBe('addressInUse')
	expect(service.snapshot().servers.map((server) => server.protocol)).toEqual(['lx200'])

	const client = await connect(port)
	expect(await client.ask(':GVP#', (text) => text.endsWith('#'))).toBe('Nebulosa#')
})

test('refuses an unknown mount, a disconnected one, and an unknown protocol', async () => {
	const { id, client, manager, mountId, mount, service } = await setup()

	expect(service.start(id, 'nope', 'lx200', { host: '127.0.0.1', port: freePort() }).status).toBe(404)
	expect(service.start(id, mountId, 'meade', { host: '127.0.0.1', port: freePort() }).status).toBe(404)
	expect(service.disconnectClient(id, mountId, 'lx200', 'nope').status).toBe(404)

	manager.devices.switch(client, mountId, false)
	await waitUntil(() => !mount.connected)

	const refused = await json(service.start(id, mountId, 'lx200', { host: '127.0.0.1', port: freePort() }))
	expect(refused.status).toBe(409)
	expect(refused.body.code).toBe('disconnected')
})

test('lists clients and disconnects one of them, leaving the listener and the other client', async () => {
	const { id, mountId, service, events } = await setup()
	const port = freePort()
	service.start(id, mountId, 'lx200', { host: '127.0.0.1', port })

	const first = await connect(port)
	const second = await connect(port)
	await waitUntil(() => service.snapshot().servers[0].clients.length === 2)

	const [firstClient, secondClient] = service.snapshot().servers[0].clients
	expect(firstClient.id).not.toBe(secondClient.id)
	expect([firstClient.ip, secondClient.ip]).toEqual(['127.0.0.1', '127.0.0.1'])
	expect([firstClient.port, secondClient.port]).toEqual([first.socket.localPort, second.socket.localPort])

	expect(service.disconnectClient(id, mountId, 'lx200', firstClient.id).status).toBe(204)
	expect(service.disconnectClient(id, mountId, 'lx200', firstClient.id).status).toBe(204)
	await waitUntil(() => first.closed())

	expect(service.snapshot().servers[0].clients).toEqual([secondClient])
	expect(events.at(-1)!.server!.clients).toEqual([secondClient])
	expect(await second.ask(':GW#', (text) => text.endsWith('#'))).toMatch(/^G[TN][PH]#$/)
})

test('reads the J2000 position of the mount and starts a goto that outlives its client', async () => {
	const { id, mountId, mount, mounts, service, operationEvents } = await setup()
	const port = freePort()
	service.start(id, mountId, 'lx200', { host: '127.0.0.1', port })

	const client = await connect(port)
	const [ra, dec] = equatorialToJ2000(mount.equatorialCoordinate.rightAscension, mount.equatorialCoordinate.declination, timeNow(true))
	const position = await client.ask(':GR#:GD#', (text) => text.split('#').length === 3)
	const [h, m, s] = position.split('#')[0].split(':').map(Number)
	expect(Math.abs(hour(h + m / 60 + s / 3600) - normalizeAngle(ra))).toBeLessThan(hour(2 / 3600))
	expect(position.split('#')[1]).toMatch(/^[+-]\d\d\*\d\d:\d\d$/)

	const [zenithRa, zenithDec] = zenith(mount)
	const reply = await client.ask(`${lx200Target(zenithRa, zenithDec)}:MS#`, (text) => text.length === 3)
	expect(reply).toBe('110')

	await waitUntil(() => operationEvents.some((event) => event.operation.kind === 'mount.goto'))
	client.socket.end()
	await waitUntil(() => service.snapshot().servers[0].clients.length === 0)

	// The goto belongs to the mount, not to the client that asked for it.
	await Bun.sleep(200)
	expect(operationEvents.filter((event) => event.operation.kind === 'mount.goto').map((event) => event.operation.state)).toEqual(['running'])
	expect((await mounts.stop(id, mountId)).status).toBe(204)
})

test('refuses a goto, a sync, and a site change while another operation holds the mount, and refuses clock setters', async () => {
	const { id, mountId, mount, mounts, operations, service } = await setup()
	const port = freePort()
	service.start(id, mountId, 'lx200', { host: '127.0.0.1', port })

	const held = await mounts.commander.startManualMove(operations.coordinator, mount, 'NORTH')
	expect(held.ok).toBe(true)

	try {
		const client = await connect(port)
		expect(await client.ask(':MS#', (text) => text.endsWith('#'))).toBe('1Slew not possible#')
		expect(await client.ask(':CM#', (text) => text.endsWith('#'))).toBe('Sync failed#')
		expect(await client.ask(':St+10*00#:Sg010*00#:SG+03.0#', (text) => text.length === 3)).toBe('000')
	} finally {
		if (held.ok) await held.value.stop()
	}
})

test('runs a start and a stop of one packet in order and leaves the mount stopped', async () => {
	const { id, mountId, mount, service, operationEvents } = await setup()
	const port = freePort()
	service.start(id, mountId, 'lx200', { host: '127.0.0.1', port })

	const client = await connect(port)
	client.socket.write(':Mn#:Qn#')

	await waitUntil(() => operationEvents.some((event) => event.operation.kind === 'mount.remoteMove' && event.operation.state !== 'running'))
	expect(operationEvents.at(-1)!.operation).toMatchObject({ kind: 'mount.remoteMove', state: 'succeeded' })
	expect(isDeviceQuiescent(mount)).toBe(true)
})

test('keeps a motion to its client: another client cannot join or stop it, and its disconnection stops it', async () => {
	const { id, mountId, mount, mounts, service, operationEvents } = await setup()
	const port = freePort()
	service.start(id, mountId, 'lx200', { host: '127.0.0.1', port })

	const owner = await connect(port)
	const other = await connect(port)
	owner.socket.write(':Mn#')
	await waitUntil(() => mounts.commander.manualMoveOf(mount) !== undefined)
	const handle = mounts.commander.manualMoveOf(mount)!

	other.socket.write(':Me#:Qn#')
	await Bun.sleep(100)
	expect(handle.directions()).toEqual(['NORTH'])

	owner.socket.end()
	await waitUntil(() => operationEvents.some((event) => event.operation.kind === 'mount.remoteMove' && event.operation.state !== 'running'))
	expect(mounts.commander.manualMoveOf(mount)).toBeUndefined()
	expect(isDeviceQuiescent(mount)).toBe(true)
	expect(service.snapshot().servers[0].clients).toHaveLength(1)
})

test('stops a motion that is never released after the watchdog', async () => {
	const { id, mountId, mount, mounts, service, operationEvents } = await setup({ motionWatchdog: 200 })
	const port = freePort()
	service.start(id, mountId, 'lx200', { host: '127.0.0.1', port })

	const client = await connect(port)
	client.socket.write(':Me#')
	await waitUntil(() => mounts.commander.manualMoveOf(mount) !== undefined)
	await waitUntil(() => operationEvents.some((event) => event.operation.kind === 'mount.remoteMove' && event.operation.state !== 'running'))

	expect(isDeviceQuiescent(mount)).toBe(true)
	expect(client.closed()).toBe(false)
})

test('sends positions to Stellarium clients and starts their gotos', async () => {
	const { id, mountId, mount, service, operationEvents } = await setup({ positionInterval: 50 })
	const port = freePort()
	service.start(id, mountId, 'stellarium', { host: '127.0.0.1', port })

	const client = await connect(port)
	await waitUntil(() => client.bytes() >= 48)
	expect(client.bytes() % 24).toBe(0)

	const [ra, dec] = zenith(mount)
	const message = Buffer.alloc(20)
	message.writeUInt16LE(20, 0)
	message.writeUInt32LE(Math.round(normalizeAngle(ra) * (0x80000000 / Math.PI)) >>> 0, 12)
	message.writeInt32LE(Math.round(dec * (0x80000000 / Math.PI)), 16)
	client.socket.write(message)

	await waitUntil(() => operationEvents.some((event) => event.operation.kind === 'mount.goto'))
})

test('stops the listeners of a mount that disconnects, and of a connection that closes', async () => {
	const { manager, id, client, mountId, service, events } = await setup()
	service.start(id, mountId, 'lx200', { host: '127.0.0.1', port: freePort() })
	service.start(id, mountId, 'stellarium', { host: '127.0.0.1', port: freePort() })

	manager.devices.switch(client, mountId, false)
	await waitUntil(() => service.snapshot().servers.length === 0)
	expect(events.slice(-2).every((event) => event.server === undefined)).toBe(true)

	manager.devices.switch(client, mountId, true)
	await waitUntil(() => manager.devices.mount(client, mountId)!.connected)
	expect(service.snapshot().servers).toHaveLength(0)

	service.start(id, mountId, 'lx200', { host: '127.0.0.1', port: freePort() })
	manager.disconnect(id)
	expect(service.snapshot().servers).toHaveLength(0)
})

test('writes the site a client sends to the mount, latitude and longitude together', async () => {
	const { id, mountId, mount, service } = await setup()
	const port = freePort()
	service.start(id, mountId, 'lx200', { host: '127.0.0.1', port })
	const elevation = mount.geographicCoordinate.elevation

	const client = await connect(port)
	expect(await client.ask(':St-23*30#:Sg046*38#', (text) => text.length === 2)).toBe('11')

	await waitUntil(() => Math.abs(mount.geographicCoordinate.latitude - deg(-23.5)) < deg(1e-6))
	expect(mount.geographicCoordinate.longitude).toBeCloseTo(deg(-(46 + 38 / 60)), 8)
	expect(mount.geographicCoordinate.elevation).toBe(elevation)
	expect(await client.ask(':Gt#:Gg#', (text) => text.split('#').length === 3)).toBe('-23*30#+046*38#')
})
