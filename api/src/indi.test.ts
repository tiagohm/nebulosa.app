import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { ConnectionManager } from './connection'
import { routes, websocket } from './index'
import { IndiPropertyService, type IndiPropertyServiceOptions, type IndiServerEvent, type IndiSnapshotEvent, type IndiStreamEvent } from './indi'
import type { EventSocket, ServerEvent } from './websocket'

const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

// Definitions of an auxiliary relay box no manager supports, and of a second device of the same server.
const RELAY = [
	'<defSwitchVector device="Relay" name="CONNECTION" label="Connection" group="Main Control" state="Ok" perm="rw" rule="OneOfMany" timeout="60"><defSwitch name="CONNECT" label="Connect">On</defSwitch><defSwitch name="DISCONNECT" label="Disconnect">Off</defSwitch></defSwitchVector>',
	'<defTextVector device="Relay" name="DRIVER_INFO" group="General Info" state="Idle" perm="ro"><defText name="DRIVER_NAME">Relay</defText><defText name="DRIVER_EXEC">indi_relay</defText><defText name="DRIVER_VERSION">1.0</defText><defText name="DRIVER_INTERFACE">32768</defText></defTextVector>',
	'<defNumberVector device="Relay" name="TEMPERATURE" group="Sensors" state="Idle" perm="rw" timeout="10"><defNumber name="TEMP" format="%6.2f" min="-50" max="50" step="0.1">10</defNumber><defNumber name="HUMIDITY" format="%3.0f" min="0" max="100" step="1">40</defNumber></defNumberVector>',
].join('')

const OTHER = '<defNumberVector device="Other" name="LEVEL" group="Main" state="Idle" perm="rw"><defNumber name="VALUE" format="%g" min="0" max="10" step="1">1</defNumber></defNumberVector>'

function temperature(value: number, state = 'Idle') {
	return `<setNumberVector device="Relay" name="TEMPERATURE" state="${state}"><oneNumber name="TEMP">${value}</oneNumber></setNumberVector>`
}

async function until(condition: () => boolean, timeout = 2000) {
	const end = Date.now() + timeout
	while (!condition()) {
		if (Date.now() > end) throw new Error('condition not reached')
		await Bun.sleep(5)
	}
}

// Fake indiserver writing the XML a test pushes to every client socket.
function listenIndi() {
	const sockets = new Set<Bun.Socket>()
	const server = Bun.listen({
		hostname: '127.0.0.1',
		port: 0,
		socket: {
			open: (socket) => void sockets.add(socket),
			data: () => {},
			close: (socket) => void sockets.delete(socket),
		},
	})
	disposables.push({ [Symbol.dispose]: () => server.stop(true) })

	return {
		port: server.port,
		sockets,
		push: (xml: string) => {
			for (const socket of sockets) socket.write(xml)
		},
	}
}

function fakeSocket() {
	const events: IndiServerEvent[] = []
	let buffered = 0
	const socket: EventSocket = {
		send: (data) => {
			events.push(JSON.parse(data) as IndiServerEvent)
			return data.length
		},
		getBufferedAmount: () => buffered,
	}

	return { socket, events, congest: (amount: number) => (buffered = amount) }
}

async function setup(options?: IndiPropertyServiceOptions) {
	const indi = listenIndi()
	const manager = new ConnectionManager()
	disposables.push(manager)
	const broadcasts: ServerEvent[] = []
	const service = new IndiPropertyService(
		manager.devices,
		(id) => manager.client(id),
		(event) => broadcasts.push(event),
		options,
	)
	disposables.push(service)

	const { id } = await manager.connect({ type: 'INDI', host: '127.0.0.1', port: indi.port })
	await until(() => indi.sockets.size === 1)
	const client = manager.client(id)!

	indi.push(RELAY + OTHER)
	await until(() => manager.devices.properties.device(client, 'Other') !== undefined)

	const relay = manager.devices.properties.device(client, 'Relay')!
	const value = () => (relay.properties.TEMPERATURE?.elements.TEMP as { value: number } | undefined)?.value

	return { indi, manager, service, broadcasts, id, client, relay, value }
}

function stream(events: readonly IndiServerEvent[]) {
	return events.filter((event): event is IndiStreamEvent => event.type !== 'indi:subscriptionError' && !event.type.startsWith('indi:device'))
}

describe('directory', () => {
	test('lists every physical device of an INDI connection without values', async () => {
		const { service, broadcasts, id, relay } = await setup()

		const devices = (await service.list(id).json()) as unknown[]

		expect(devices).toEqual([
			{ connectionId: id, hardwareId: relay.hardwareId, name: 'Relay', driver: { name: 'Relay', executable: 'indi_relay', version: '1.0', interface: 32768 }, connected: true },
			{ connectionId: id, hardwareId: expect.any(String), name: 'Other' },
		])
		expect(broadcasts).toContainEqual({ type: 'indi:deviceAdded', device: { connectionId: id, hardwareId: relay.hardwareId, name: 'Relay' } })
		expect(broadcasts).toContainEqual({ type: 'indi:deviceUpdated', device: expect.objectContaining({ hardwareId: relay.hardwareId, connected: true }) })
		expect(broadcasts.some((event) => JSON.stringify(event).includes('TEMPERATURE'))).toBeFalse()
	})

	test('refuses an unknown connection and a connection that is not INDI', async () => {
		const { service, manager } = await setup()
		const simulator = await manager.connect({ type: 'SIMULATOR' })

		expect(service.list('unknown').status).toBe(404)
		const refused = service.list(simulator.id)
		expect(refused.status).toBe(422)
		expect(await refused.json()).toMatchObject({ code: 'unsupported' })
	})

	test('publishes the removal of a device', async () => {
		const { indi, broadcasts, id, relay, manager, client } = await setup()

		indi.push('<delProperty device="Relay"/>')
		await until(() => manager.devices.properties.device(client, 'Relay') === undefined)

		expect(broadcasts.at(-1)).toEqual({ type: 'indi:deviceRemoved', connectionId: id, hardwareId: relay.hardwareId })
	})
})

describe('stream', () => {
	test('builds nothing while a device has no subscriber', async () => {
		const { indi, broadcasts, value } = await setup()
		const before = broadcasts.length
		const stringify = spyOn(JSON, 'stringify')

		try {
			for (let i = 1; i <= 20; i++) indi.push(temperature(10 + i))
			await until(() => value() === 30)
			await Bun.sleep(80)

			expect(stringify).not.toHaveBeenCalled()
			expect(broadcasts.length).toBe(before)
		} finally {
			stringify.mockRestore()
		}
	})

	test('sends a snapshot, then only the changes of that device, to the subscribed socket only', async () => {
		const { indi, service, id, relay, value } = await setup()
		const a = fakeSocket()
		const b = fakeSocket()

		service.subscribe(a.socket, { type: 'indi:subscribe', connectionId: id, hardwareId: relay.hardwareId })

		const snapshot = a.events[0] as IndiSnapshotEvent
		expect(snapshot).toMatchObject({ type: 'indi:snapshot', connectionId: id, hardwareId: relay.hardwareId, epoch: expect.any(String), device: { name: 'Relay', connected: true }, messages: [] })
		expect(snapshot.vectors.map((vector) => vector.name)).toEqual(['CONNECTION', 'DRIVER_INFO', 'TEMPERATURE'])
		expect(snapshot.vectors[2]).toMatchObject({ type: 'NUMBER', permission: 'rw', timeout: 10, elementNames: ['TEMP', 'HUMIDITY'], elements: { TEMP: { format: '%6.2f', min: -50, max: 50, step: 0.1, value: 10 } } })

		indi.push('<setNumberVector device="Other" name="LEVEL"><oneNumber name="VALUE">5</oneNumber></setNumberVector>')
		indi.push(temperature(12))
		await until(() => a.events.length === 2)

		expect(a.events[1]).toMatchObject({ type: 'indi:propertyUpdated', kind: 'values', epoch: snapshot.epoch, vector: { name: 'TEMPERATURE', state: 'Idle', elements: { TEMP: { value: 12 } } } })
		expect((a.events[1] as { revision: number }).revision).toBeGreaterThan(snapshot.revision)
		expect(value()).toBe(12)
		expect(b.events).toBeEmpty()
		await Bun.sleep(80)
		expect(a.events).toHaveLength(2)
	})

	test('coalesces value changes per vector to the latest values', async () => {
		const { indi, service, id, relay, value } = await setup({ valueInterval: 150 })
		const a = fakeSocket()
		service.subscribe(a.socket, { type: 'indi:subscribe', connectionId: id, hardwareId: relay.hardwareId })

		for (let i = 1; i <= 5; i++) indi.push(temperature(20 + i))
		indi.push('<setNumberVector device="Relay" name="TEMPERATURE"><oneNumber name="HUMIDITY">55</oneNumber></setNumberVector>')
		await until(() => value() === 25)
		expect(a.events).toHaveLength(1)

		await until(() => a.events.length === 2)
		await Bun.sleep(200)

		expect(a.events).toHaveLength(2)
		expect(a.events[1]).toMatchObject({ type: 'indi:propertyUpdated', kind: 'values', vector: { elements: { TEMP: { value: 25 }, HUMIDITY: { value: 55 } } } })
	})

	test('sends a state change at once with the values still pending', async () => {
		const { indi, service, id, relay } = await setup({ valueInterval: 300 })
		const a = fakeSocket()
		service.subscribe(a.socket, { type: 'indi:subscribe', connectionId: id, hardwareId: relay.hardwareId })

		indi.push(temperature(30))
		indi.push('<setNumberVector device="Relay" name="TEMPERATURE" state="Alert" message="sensor lost"><oneNumber name="HUMIDITY">40</oneNumber></setNumberVector>')
		await until(() => a.events.length === 2, 200)

		expect(a.events[1]).toMatchObject({ type: 'indi:propertyUpdated', kind: 'feedback', vector: { state: 'Alert', message: 'sensor lost', elements: { TEMP: { value: 30 } } } })

		await Bun.sleep(400)
		expect(a.events).toHaveLength(2)
	})

	test('sends definitions, removals, and messages at once', async () => {
		const { indi, service, id, relay } = await setup({ valueInterval: 1000 })
		const a = fakeSocket()
		service.subscribe(a.socket, { type: 'indi:subscribe', connectionId: id, hardwareId: relay.hardwareId })

		indi.push('<defLightVector device="Relay" name="STATUS" group="Main Control" state="Ok"><defLight name="READY" label="Ready">Busy</defLight></defLightVector>')
		indi.push('<message device="Relay" timestamp="2026-10-26T12:00:00" message="relay armed"/>')
		indi.push('<delProperty device="Relay" name="STATUS"/>')
		await until(() => a.events.length === 4, 500)

		expect(a.events.slice(1)).toMatchObject([
			{ type: 'indi:propertyDefined', vector: { type: 'LIGHT', name: 'STATUS', elements: { READY: { value: 'Busy' } } } },
			{ type: 'indi:message', message: { message: 'relay armed', timestamp: '2026-10-26T12:00:00' } },
			{ type: 'indi:propertyRemoved', name: 'STATUS' },
		])

		const revisions = a.events.map((event) => (event as { revision: number }).revision)
		expect(revisions).toEqual([...revisions].sort((x, y) => x - y))

		const later = fakeSocket()
		service.subscribe(later.socket, { type: 'indi:subscribe', connectionId: id, hardwareId: relay.hardwareId })
		expect((later.events[0] as IndiSnapshotEvent).messages).toMatchObject([{ message: 'relay armed' }])
	})

	test('keeps every subscriber apart and stops with the last one', async () => {
		const { indi, service, id, relay, value } = await setup()
		const a = fakeSocket()
		const b = fakeSocket()
		const subscription = { type: 'indi:subscribe', connectionId: id, hardwareId: relay.hardwareId } as const

		service.subscribe(a.socket, subscription)
		service.subscribe(b.socket, subscription)
		service.subscribe(b.socket, subscription)
		expect(service.subscribers(id, relay.hardwareId)).toBe(2)
		expect(b.events.map((event) => event.type)).toEqual(['indi:snapshot', 'indi:snapshot'])

		service.closed(a.socket)
		indi.push(temperature(40))
		await until(() => b.events.length === 3)
		expect(a.events).toHaveLength(1)

		service.unsubscribe(b.socket, { ...subscription, type: 'indi:unsubscribe' })
		service.unsubscribe(b.socket, { ...subscription, type: 'indi:unsubscribe' })
		expect(service.subscribers(id, relay.hardwareId)).toBe(0)

		const stringify = spyOn(JSON, 'stringify')

		try {
			indi.push(temperature(41))
			await until(() => value() === 41)
			await Bun.sleep(80)
			expect(stringify).not.toHaveBeenCalled()
		} finally {
			stringify.mockRestore()
		}
	})

	test('refuses an unknown connection, device, or a connection that is not INDI', async () => {
		const { service, manager, id } = await setup()
		const simulator = await manager.connect({ type: 'SIMULATOR' })
		const a = fakeSocket()

		service.subscribe(a.socket, { type: 'indi:subscribe', connectionId: 'unknown', hardwareId: 'x' })
		service.subscribe(a.socket, { type: 'indi:subscribe', connectionId: id, hardwareId: 'x' })
		service.subscribe(a.socket, { type: 'indi:subscribe', connectionId: simulator.id, hardwareId: 'x' })

		expect(a.events).toMatchObject([
			{ type: 'indi:subscriptionError', connectionId: 'unknown', code: 'notFound' },
			{ type: 'indi:subscriptionError', connectionId: id, code: 'notFound' },
			{ type: 'indi:subscriptionError', connectionId: simulator.id, code: 'unsupported' },
		])
	})

	test('ends the stream when its device goes away and starts a new epoch on reconnection', async () => {
		const { indi, service, manager, id, relay, broadcasts } = await setup()
		const a = fakeSocket()
		service.subscribe(a.socket, { type: 'indi:subscribe', connectionId: id, hardwareId: relay.hardwareId })
		const { epoch } = a.events[0] as IndiSnapshotEvent

		manager.disconnect(id)

		expect(service.subscribers(id, relay.hardwareId)).toBe(0)
		expect(broadcasts).toContainEqual({ type: 'indi:deviceRemoved', connectionId: id, hardwareId: relay.hardwareId })

		await manager.connect({ type: 'INDI', host: '127.0.0.1', port: indi.port })
		await until(() => indi.sockets.size === 1)
		const client = manager.client(id)!
		indi.push(RELAY)
		await until(() => manager.devices.properties.property(client, 'Relay', 'TEMPERATURE') !== undefined)

		service.subscribe(a.socket, { type: 'indi:subscribe', connectionId: id, hardwareId: relay.hardwareId })

		expect(a.events.at(-1)).toMatchObject({ type: 'indi:snapshot', hardwareId: relay.hardwareId })
		expect((a.events.at(-1) as IndiSnapshotEvent).epoch).not.toBe(epoch)
	})

	test('a congested socket skips the changes and resynchronizes once drained', async () => {
		const { indi, service, id, relay, value } = await setup()
		const a = fakeSocket()
		service.subscribe(a.socket, { type: 'indi:subscribe', connectionId: id, hardwareId: relay.hardwareId })

		a.congest(2 * 1024 * 1024)
		indi.push(temperature(50))
		indi.push(temperature(51, 'Busy'))
		await until(() => value() === 51)
		await Bun.sleep(80)
		expect(a.events).toHaveLength(1)

		a.congest(0)
		service.drained(a.socket)

		expect(stream(a.events).map((event) => event.type)).toEqual(['indi:snapshot', 'indi:snapshot'])
		expect((a.events[1] as IndiSnapshotEvent).vectors[2]).toMatchObject({ state: 'Busy', elements: { TEMP: { value: 51 } } })

		indi.push(temperature(52, 'Ok'))
		await until(() => a.events.length === 3)
	})
})

describe('websocket', () => {
	test('subscribes over /api/ws and leaves the other sockets out', async () => {
		const indi = listenIndi()
		const server = Bun.serve({ hostname: '127.0.0.1', port: 0, routes, websocket })
		disposables.push({ [Symbol.dispose]: () => void server.stop(true) })

		const open = async () => {
			const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/ws`)
			const events: ServerEvent[] = []
			ws.addEventListener('message', (message: MessageEvent<string>) => events.push(JSON.parse(message.data) as ServerEvent))
			await new Promise((resolve) => {
				ws.addEventListener('open', resolve)
			})
			disposables.push({ [Symbol.dispose]: () => ws.close() })
			return { ws, events }
		}

		const viewer = await open()
		const other = await open()

		const response = await fetch(`${server.url}api/connections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'INDI', host: '127.0.0.1', port: indi.port }) })
		const { id } = (await response.json()) as { id: string }
		disposables.push({ [Symbol.dispose]: () => void fetch(`${server.url}api/connections/${id}`, { method: 'DELETE' }) })
		await until(() => indi.sockets.size === 1)
		indi.push(RELAY)

		await until(() => viewer.events.some((event) => event.type === 'indi:deviceUpdated'))
		const devices = (await (await fetch(`${server.url}api/connections/${id}/indi/devices`)).json()) as { hardwareId: string }[]
		const hardwareId = devices[0].hardwareId

		viewer.ws.send(JSON.stringify({ type: 'indi:subscribe', connectionId: id, hardwareId }))
		await until(() => viewer.events.some((event) => event.type === 'indi:snapshot'))
		indi.push(temperature(60, 'Busy'))
		await until(() => viewer.events.some((event) => event.type === 'indi:propertyUpdated'))

		viewer.ws.send(JSON.stringify({ type: 'indi:unsubscribe', connectionId: id, hardwareId }))
		await Bun.sleep(50)
		const count = viewer.events.length
		indi.push(temperature(61, 'Ok'))
		await Bun.sleep(100)

		expect(viewer.events).toHaveLength(count)
		expect(other.events.some((event) => event.type === 'indi:snapshot' || event.type === 'indi:propertyUpdated')).toBeFalse()
		expect(other.events.some((event) => event.type === 'indi:deviceAdded')).toBeTrue()
	})
})
