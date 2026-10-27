import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { AlpacaServer } from 'nebulosa/src/devices/alpaca/server'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import { FocuserManager } from 'nebulosa/src/devices/indi/manager/focuser'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { FocuserSimulator } from 'nebulosa/src/devices/indi/simulator/focuser'
import type { OperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { ConnectionManager, connections } from './connection'
import { routes, websocket } from './index'
import { type IndiDeviceSummary, IndiPropertyService, type IndiPropertyServiceOptions, type IndiServerEvent, type IndiSnapshotEvent, type IndiStreamEvent, type IndiWriteRequest } from './indi'
import { type OperationRecord, OperationRegistry } from './operations'
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
	'<defNumberVector device="Relay" name="DELAY" group="Options" state="Idle" perm="rw" timeout="0"><defNumber name="SECONDS" format="%g" min="0" max="60" step="1">1</defNumber></defNumberVector>',
	'<defSwitchVector device="Relay" name="CHANNELS" group="Options" state="Idle" perm="rw" rule="AnyOfMany" timeout="0"><defSwitch name="A">On</defSwitch><defSwitch name="B">Off</defSwitch></defSwitchVector>',
	'<defSwitchVector device="Relay" name="ACTION" group="Options" state="Idle" perm="rw" rule="AtMostOne" timeout="0"><defSwitch name="PULSE">Off</defSwitch><defSwitch name="RESET">Off</defSwitch></defSwitchVector>',
	'<defTextVector device="Relay" name="SECRET" group="Options" state="Idle" perm="wo" timeout="0"><defText name="USER"></defText><defText name="PASSWORD"></defText></defTextVector>',
	'<defLightVector device="Relay" name="STATUS" group="Main Control" state="Ok"><defLight name="READY">Ok</defLight></defLightVector>',
].join('')

// Vector names of RELAY, in definition order.
const RELAY_VECTORS = ['CONNECTION', 'DRIVER_INFO', 'TEMPERATURE', 'DELAY', 'CHANNELS', 'ACTION', 'SECRET', 'STATUS']

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

// Fake indiserver writing the XML a test pushes to every client socket and recording the commands it receives.
function listenIndi() {
	const sockets = new Set<Bun.Socket>()
	const received: string[] = []
	const server = Bun.listen({
		hostname: '127.0.0.1',
		port: 0,
		socket: {
			open: (socket) => void sockets.add(socket),
			data: (_, data) => void received.push(data.toString()),
			close: (socket) => void sockets.delete(socket),
		},
	})
	disposables.push({ [Symbol.dispose]: () => server.stop(true) })

	return {
		port: server.port,
		sockets,
		// Commands received for a vector, without the getProperties of the connection.
		commands: (name: string) => received.join('').match(new RegExp(`<new\\w+Vector device="Relay" name="${name}">.*?</new\\w+Vector>`, 'g')) ?? [],
		push: (xml: string) => {
			for (const socket of sockets) socket.write(xml)
		},
	}
}

// Holds a physical device under an operation of its own until the test ends.
function hold(operations: OperationRegistry, key: string) {
	const handle = operations.coordinator.start('test.hold', [{ key }], ({ signal }) => {
		const { promise, resolve } = Promise.withResolvers<OperationResult<undefined>>()
		signal.addEventListener('abort', () => resolve({ ok: true, value: undefined }))
		return promise
	})
	disposables.push({ [Symbol.dispose]: () => void handle.cancel() })
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
	const records: OperationRecord[] = []
	const operations = new OperationRegistry(manager.devices, (event) => records.push(event.operation))
	disposables.push(operations)
	const service = new IndiPropertyService(
		manager.devices,
		(id) => manager.client(id),
		operations,
		(event) => broadcasts.push(event),
		{ valueInterval: 40, writeGrace: 100, ...options },
	)
	disposables.push(service)
	// The final record of an operation, once it finished.
	const outcome = async (operationId: string) => {
		await until(() => records.some((record) => record.operationId === operationId && record.state !== 'running'))
		return records.findLast((record) => record.operationId === operationId)!
	}

	const { id } = await manager.connect({ type: 'INDI', host: '127.0.0.1', port: indi.port })
	await until(() => indi.sockets.size === 1)
	const client = manager.client(id)!

	indi.push(RELAY + OTHER)
	await until(() => manager.devices.properties.device(client, 'Other') !== undefined)

	const relay = manager.devices.properties.device(client, 'Relay')!
	const value = () => (relay.properties.TEMPERATURE?.elements.TEMP as { value: number } | undefined)?.value

	return { indi, manager, operations, service, broadcasts, records, outcome, id, client, relay, value }
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

	test('refuses a connection that is not open', async () => {
		const { service } = await setup()
		const refused = service.list('unknown')

		expect(refused.status).toBe(404)
		expect(await refused.json()).toMatchObject({ code: 'notFound' })
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
		expect(snapshot.vectors.map((vector) => vector.name)).toEqual(RELAY_VECTORS)
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

	test('refuses an unknown connection or device', async () => {
		const { service, id } = await setup()
		const a = fakeSocket()

		service.subscribe(a.socket, { type: 'indi:subscribe', connectionId: 'unknown', hardwareId: 'x' })
		service.subscribe(a.socket, { type: 'indi:subscribe', connectionId: id, hardwareId: 'x' })

		expect(a.events).toMatchObject([
			{ type: 'indi:subscriptionError', connectionId: 'unknown', code: 'notFound' },
			{ type: 'indi:subscriptionError', connectionId: id, code: 'notFound' },
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

describe('write', () => {
	type Write = Omit<IndiWriteRequest, 'token'> & { readonly token?: string }

	async function write(service: IndiPropertyService, id: string, hardwareId: string, name: string, request: Write) {
		const response = service.write(id, hardwareId, name, { token: Bun.randomUUIDv7(), ...request })
		return { status: response.status, body: (await response.json()) as { operationId?: string; code?: string; vector?: { revision: number } } }
	}

	test('sends the complete vector and succeeds once the driver leaves Busy', async () => {
		const { indi, service, outcome, id, relay } = await setup()
		const { revision } = relay.properties.TEMPERATURE

		const { status, body } = await write(service, id, relay.hardwareId, 'TEMPERATURE', { baseRevision: revision, elements: { TEMP: 15 } })

		expect(status).toBe(202)
		await until(() => indi.commands('TEMPERATURE').length === 1)
		expect(indi.commands('TEMPERATURE')[0]).toBe('<newNumberVector device="Relay" name="TEMPERATURE"><oneNumber name="TEMP">15</oneNumber><oneNumber name="HUMIDITY">40</oneNumber></newNumberVector>')

		indi.push(temperature(12, 'Busy'))
		await Bun.sleep(50)
		indi.push(temperature(15, 'Ok'))

		expect(await outcome(body.operationId!)).toMatchObject({ kind: 'indi.propertyWrite', state: 'succeeded', devices: [{ connectionId: id, deviceId: relay.hardwareId }] })
	})

	test('fails with the driver message on Alert', async () => {
		const { indi, service, outcome, id, relay } = await setup()

		const { body } = await write(service, id, relay.hardwareId, 'TEMPERATURE', { baseRevision: relay.properties.TEMPERATURE.revision, elements: { TEMP: 99, HUMIDITY: 50 } })
		await until(() => indi.commands('TEMPERATURE').length === 1)
		indi.push('<setNumberVector device="Relay" name="TEMPERATURE" state="Alert" message="setpoint out of range"><oneNumber name="TEMP">10</oneNumber></setNumberVector>')

		expect(await outcome(body.operationId!)).toMatchObject({ state: 'failed', reason: 'alert', error: 'setpoint out of range' })
	})

	test('a driver that answers with no change still ends the write', async () => {
		const { indi, service, outcome, id, relay } = await setup()

		const { body } = await write(service, id, relay.hardwareId, 'DELAY', { baseRevision: relay.properties.DELAY.revision, elements: { SECONDS: 1 } })
		await until(() => indi.commands('DELAY').length === 1)
		indi.push('<setNumberVector device="Relay" name="DELAY" state="Idle"><oneNumber name="SECONDS">1</oneNumber></setNumberVector>')

		expect(await outcome(body.operationId!)).toMatchObject({ state: 'succeeded' })
	})

	test('times out when the driver never answers, saying the device may still work', async () => {
		const { service, outcome, id, relay } = await setup()

		const { body } = await write(service, id, relay.hardwareId, 'DELAY', { baseRevision: relay.properties.DELAY.revision, elements: { SECONDS: 5 } })

		expect(await outcome(body.operationId!)).toMatchObject({ state: 'failed', reason: 'timeout', error: expect.stringContaining('may still be working') })
	})

	test('refuses a stale revision with the current vector', async () => {
		const { indi, service, id, relay } = await setup()
		const base = relay.properties.TEMPERATURE.revision
		indi.push(temperature(11))
		await until(() => relay.properties.TEMPERATURE.revision !== base)

		const { status, body } = await write(service, id, relay.hardwareId, 'TEMPERATURE', { baseRevision: base, elements: { TEMP: 15 } })

		expect(status).toBe(409)
		expect(body).toMatchObject({ code: 'conflict', vector: { revision: relay.properties.TEMPERATURE.revision } })
		expect(indi.commands('TEMPERATURE')).toBeEmpty()
	})

	test('refuses what the vector cannot take', async () => {
		const { service, id, relay } = await setup()
		const revision = (name: string) => relay.properties[name].revision

		const refusals = await Promise.all([
			write(service, 'unknown', relay.hardwareId, 'TEMPERATURE', { baseRevision: 0, elements: {} }),
			write(service, id, 'unknown', 'TEMPERATURE', { baseRevision: 0, elements: {} }),
			write(service, id, relay.hardwareId, 'UNKNOWN', { baseRevision: 0, elements: {} }),
			write(service, id, relay.hardwareId, 'DRIVER_INFO', { baseRevision: revision('DRIVER_INFO'), elements: { DRIVER_NAME: 'x' } }),
			write(service, id, relay.hardwareId, 'STATUS', { baseRevision: revision('STATUS'), elements: {} }),
			write(service, id, relay.hardwareId, 'TEMPERATURE', { baseRevision: revision('TEMPERATURE'), elements: { PRESSURE: 1 } }),
			write(service, id, relay.hardwareId, 'CONNECTION', { baseRevision: revision('CONNECTION'), elements: { CONNECT: true, DISCONNECT: true } }),
			write(service, id, relay.hardwareId, 'CONNECTION', { baseRevision: revision('CONNECTION'), elements: {} }),
			write(service, id, relay.hardwareId, 'ACTION', { baseRevision: revision('ACTION'), elements: { PULSE: true, RESET: true } }),
			write(service, id, relay.hardwareId, 'SECRET', { baseRevision: revision('SECRET'), elements: { USER: 'observer' } }),
		])

		expect(refusals.map(({ status, body }) => [status, body.code])).toEqual([
			[404, 'notFound'],
			[404, 'notFound'],
			[404, 'notFound'],
			[422, 'unsupported'],
			[422, 'unsupported'],
			[422, 'invalidParameter'],
			[422, 'invalidParameter'],
			[422, 'invalidParameter'],
			[422, 'invalidParameter'],
			[422, 'invalidParameter'],
		])
	})

	test('sends switches as the complete selection their rule allows', async () => {
		const { indi, service, outcome, id, relay } = await setup()
		const revision = (name: string) => relay.properties[name].revision

		// Writes of one connected device hold it in turn, so each waits for the previous one to end (here, by timeout).
		await outcome((await write(service, id, relay.hardwareId, 'ACTION', { baseRevision: revision('ACTION'), elements: { PULSE: true } })).body.operationId!)
		await outcome((await write(service, id, relay.hardwareId, 'CHANNELS', { baseRevision: revision('CHANNELS'), elements: { B: true } })).body.operationId!)
		await outcome((await write(service, id, relay.hardwareId, 'SECRET', { baseRevision: revision('SECRET'), elements: { USER: 'observer', PASSWORD: 'x<y' } })).body.operationId!)

		expect(indi.commands('ACTION')).toEqual(['<newSwitchVector device="Relay" name="ACTION"><oneSwitch name="PULSE">On</oneSwitch><oneSwitch name="RESET">Off</oneSwitch></newSwitchVector>'])
		expect(indi.commands('CHANNELS')).toEqual(['<newSwitchVector device="Relay" name="CHANNELS"><oneSwitch name="A">On</oneSwitch><oneSwitch name="B">On</oneSwitch></newSwitchVector>'])
		expect(indi.commands('SECRET')).toEqual(['<newTextVector device="Relay" name="SECRET"><oneText name="USER">observer</oneText><oneText name="PASSWORD">x&lt;y</oneText></newTextVector>'])
	})

	test('a repeated token answers the first operation without writing again', async () => {
		const { indi, service, id, relay } = await setup()
		const request = { token: 'once', baseRevision: relay.properties.DELAY.revision, elements: { SECONDS: 3 } }

		const first = await write(service, id, relay.hardwareId, 'DELAY', request)
		const second = await write(service, id, relay.hardwareId, 'DELAY', request)
		await until(() => indi.commands('DELAY').length === 1)
		await Bun.sleep(50)

		expect(second.body.operationId).toBe(first.body.operationId)
		expect(indi.commands('DELAY')).toHaveLength(1)
	})

	test('a connected device held by another operation is refused as busy', async () => {
		const { indi, service, operations, id, relay } = await setup()
		hold(operations, relay.hardwareId)

		const { status, body } = await write(service, id, relay.hardwareId, 'DELAY', { baseRevision: relay.properties.DELAY.revision, elements: { SECONDS: 2 } })
		await Bun.sleep(50)

		expect([status, body.code]).toEqual([409, 'busy'])
		expect(indi.commands('DELAY')).toBeEmpty()
	})

	test('a device that is not connected is written without holding it', async () => {
		const { indi, service, operations, outcome, id, relay } = await setup()
		indi.push('<setSwitchVector device="Relay" name="CONNECTION" state="Idle"><oneSwitch name="CONNECT">Off</oneSwitch><oneSwitch name="DISCONNECT">On</oneSwitch></setSwitchVector>')
		await until(() => relay.connected === false)
		hold(operations, relay.hardwareId)

		const { status, body } = await write(service, id, relay.hardwareId, 'CONNECTION', { baseRevision: relay.properties.CONNECTION.revision, elements: { CONNECT: true } })

		expect(status).toBe(202)
		await until(() => indi.commands('CONNECTION').length === 1)
		expect(indi.commands('CONNECTION')[0]).toBe('<newSwitchVector device="Relay" name="CONNECTION"><oneSwitch name="CONNECT">On</oneSwitch><oneSwitch name="DISCONNECT">Off</oneSwitch></newSwitchVector>')

		indi.push('<setSwitchVector device="Relay" name="CONNECTION" state="Ok"><oneSwitch name="CONNECT">On</oneSwitch><oneSwitch name="DISCONNECT">Off</oneSwitch></setSwitchVector>')
		expect(await outcome(body.operationId!)).toMatchObject({ state: 'succeeded' })
	})

	test('ends a write whose device or vector goes away', async () => {
		const { indi, service, manager, outcome, id, relay } = await setup({ writeGrace: 5000 })

		const deleted = await write(service, id, relay.hardwareId, 'DELAY', { baseRevision: relay.properties.DELAY.revision, elements: { SECONDS: 4 } })
		await until(() => indi.commands('DELAY').length === 1)
		indi.push('<delProperty device="Relay" name="DELAY"/>')
		expect(await outcome(deleted.body.operationId!)).toMatchObject({ state: 'failed', reason: 'commandFailed' })

		const removed = await write(service, id, relay.hardwareId, 'TEMPERATURE', { baseRevision: relay.properties.TEMPERATURE.revision, elements: { TEMP: 1 } })
		await until(() => indi.commands('TEMPERATURE').length === 1)
		manager.disconnect(id)
		expect(await outcome(removed.body.operationId!)).toMatchObject({ state: 'failed' })
		expect(['removed', 'disconnected']).toContain((await outcome(removed.body.operationId!)).reason!)
	})
})

describe('other connections', () => {
	test('lists, streams, and writes the vectors of the simulated devices', async () => {
		const { manager, service, outcome } = await setup()
		const simulator = await manager.connect({ type: 'SIMULATOR' })
		const client = manager.client(simulator.id)!

		const devices = (await service.list(simulator.id).json()) as IndiDeviceSummary[]
		const device = devices.find((candidate) => candidate.connected === false)!
		expect(devices.length).toBeGreaterThan(1)
		expect(device).toMatchObject({ connectionId: simulator.id, driver: { executable: expect.any(String) } })

		const a = fakeSocket()
		service.subscribe(a.socket, { type: 'indi:subscribe', connectionId: simulator.id, hardwareId: device.hardwareId })
		expect((a.events[0] as IndiSnapshotEvent).vectors.map((vector) => vector.name)).toContain('CONNECTION')

		const connection = manager.devices.properties.property(client, device.name, 'CONNECTION')!
		const response = service.write(simulator.id, device.hardwareId, 'CONNECTION', { token: Bun.randomUUIDv7(), baseRevision: connection.revision, elements: { CONNECT: true } })
		expect(response.status).toBe(202)
		const { operationId } = (await response.json()) as { operationId: string }

		expect(await outcome(operationId)).toMatchObject({ state: 'succeeded' })
		await until(() => manager.devices.properties.device(client, device.name)?.connected === true)
		await until(() => a.events.some((event) => event.type === 'indi:propertyUpdated' && event.vector.name === 'CONNECTION'))
	})

	test('lists and streams the vectors of the devices of an Alpaca server', async () => {
		// An Alpaca server of the toolkit serving a simulated focuser.
		const focusers = new FocuserManager()
		const source = new ClientSimulator('alpaca-source', new IndiClientHandlerSet([focusers]))
		const simulated = new FocuserSimulator('Alpaca Focuser', source)
		const focuser = focusers.get(source, simulated.name)!
		focusers.connect(focuser)
		await until(() => focuser.connected)
		const server = new AlpacaServer({ focuser: focusers, deviceNumberProvider: () => 0 })
		server.start('127.0.0.1', 0)
		disposables.push({ [Symbol.dispose]: () => server.stop() }, source)

		const { manager, service } = await setup()
		const alpaca = await manager.connect({ type: 'ALPACA', host: '127.0.0.1', port: server.port })
		const client = manager.client(alpaca.id)!
		await until(() => manager.devices.properties.devices(client).some((device) => device.properties.ABS_FOCUS_POSITION !== undefined), 10000)

		const devices = (await service.list(alpaca.id).json()) as IndiDeviceSummary[]
		const device = devices.find((candidate) => manager.devices.properties.property(client, candidate.name, 'ABS_FOCUS_POSITION'))!
		expect(device.connectionId).toBe(alpaca.id)

		const a = fakeSocket()
		service.subscribe(a.socket, { type: 'indi:subscribe', connectionId: alpaca.id, hardwareId: device.hardwareId })
		expect((a.events[0] as IndiSnapshotEvent).vectors.map((vector) => vector.name)).toContain('ABS_FOCUS_POSITION')
	}, 20000)
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
		disposables.push({ [Symbol.dispose]: () => connections.disconnect(id) })
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

		// The write route answers the command contract over HTTP.
		const snapshot = viewer.events.find((event): event is IndiSnapshotEvent => event.type === 'indi:snapshot')!
		const delay = snapshot.vectors.find((vector) => vector.name === 'DELAY')!
		const written = await fetch(`${server.url}api/connections/${id}/indi/devices/${hardwareId}/properties/DELAY`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: Bun.randomUUIDv7(), baseRevision: delay.revision, elements: { SECONDS: 2 } }) })
		expect(written.status).toBe(202)
		expect(await written.json()).toEqual({ operationId: expect.any(String) })
		await until(() => indi.commands('DELAY').length === 1)
	})
})
