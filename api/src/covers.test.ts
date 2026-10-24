import { afterEach, expect, test } from 'bun:test'
import { handleDefNumberVector, handleDefSwitchVector, handleDefTextVector, handleSetNumberVector, handleSetSwitchVector } from 'nebulosa/src/devices/indi/client'
import { type Client, DeviceInterfaceType } from 'nebulosa/src/devices/indi/device'
import { makeNumberVector, makeSwitchVector, makeTextVector, type NewNumberVector, type NewSwitchVector } from 'nebulosa/src/devices/indi/types'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import type { CommandAccepted } from './commands'
import { ConnectionManager } from './connection'
import { CoverCommands } from './covers'
import { DeviceRegistry } from './devices'
import { DewHeaterCommands } from './dewheaters'
import { FlatPanelCommands } from './flatpanels'
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

// Simulator connection with its dust cap and flat panel connected.
async function setup() {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const events: OperationEvent[] = []
	const operations = new OperationRegistry(manager.devices, (event) => events.push(event))
	disposables.push(operations)
	const covers = new CoverCommands(manager.devices, (connectionId) => manager.client(connectionId), operations)
	disposables.push(covers)
	const panels = new FlatPanelCommands(manager.devices, (connectionId) => manager.client(connectionId), operations)
	disposables.push(panels)
	const coverId = manager.devices.list(client).find((d) => d.type === 'cover')!.id
	const panelId = manager.devices.list(client).find((d) => d.type === 'flatPanel')!.id
	manager.devices.switch(client, coverId, true)
	manager.devices.switch(client, panelId, true)
	const cover = manager.devices.device(client, 'cover', coverId)!
	const panel = manager.devices.device(client, 'flatPanel', panelId)!
	await waitUntil(() => cover.connected && cover.canPark && panel.connected && panel.intensity.max > 0 && operations.available(cover))
	return { id, client, manager, covers, panels, operations, events, cover, coverId, panel, panelId }
}

test('opens and closes a cover as operations confirmed by its reported state', async () => {
	const { id, covers, events, cover, coverId } = await setup()
	const action = cover.parked ? 'open' : 'close'

	const first = (await covers[action](id, coverId, { token: 'a' }).json()) as CommandAccepted
	await waitUntil(() => events.some((event) => event.operation.operationId === first.operationId && event.operation.state !== 'running'))
	expect(events.at(-1)?.operation).toMatchObject({ kind: `cover.${action}`, state: 'succeeded' })
	expect(cover.parked).toBe(action === 'close')

	const back = (await covers[action === 'open' ? 'close' : 'open'](id, coverId, { token: 'b' }).json()) as CommandAccepted
	await waitUntil(() => cover.parking)
	expect(covers.open(id, coverId, { token: 'c' }).status).toBe(409)
	expect((await covers.stop(id, coverId)).status).toBe(204)
	await waitUntil(() => events.some((event) => event.operation.operationId === back.operationId && event.operation.state === 'failed'))
	expect(cover.parking).toBeFalse()
}, 30000)

test('switches the light and sets the brightness, refused while the panel is held', async () => {
	const { id, panels, operations, panel, panelId } = await setup()

	// Each command is answered only once the panel reports the commanded state.
	expect((await panels.setLight(id, panelId, { enabled: true })).status).toBe(204)
	expect(panel.enabled).toBeTrue()
	expect((await panels.setIntensity(id, panelId, { value: 100 })).status).toBe(204)
	expect(panel.intensity.value).toBe(100)
	expect((await panels.setLight(id, panelId, { enabled: false })).status).toBe(204)
	expect(panel.enabled).toBeFalse()
	// Turning the light off leaves the brightness as the panel reports it.
	expect(panel.intensity.value).toBe(100)

	const hold = operations.coordinator.start('test.hold', [{ key: resourceKey(panel), device: panel }], (context) => {
		const { promise, resolve } = Promise.withResolvers<{ readonly ok: true; readonly value: undefined }>()
		context.signal.addEventListener('abort', () => resolve({ ok: true, value: undefined }))
		return promise
	})
	expect((await panels.setIntensity(id, panelId, { value: 10 })).status).toBe(409)
	await hold.cancel()
})

// Client delivering the properties of a flip-flat cover with a heater channel, as a WandererCover driver
// does, and recording what the registry sends to it.
function heatedCover(registry: DeviceRegistry) {
	const sent: (NewNumberVector | NewSwitchVector)[] = []
	const client: Client = {
		type: 'INDI',
		id: 'wanderer',
		description: 'Wanderer',
		getProperties: () => {},
		enableBlob: () => {},
		sendText: () => {},
		sendNumber: (vector) => void sent.push(vector),
		sendSwitch: (vector) => void sent.push(vector),
		[Symbol.dispose]: () => {},
	}
	registry.attach(client, 'w')
	const name = 'WandererCover'
	const handler = registry.handler
	handleDefTextVector(
		client,
		handler,
		makeTextVector(name, 'DRIVER_INFO', 'Driver', 'General', 'ro', ['DRIVER_INTERFACE', 'Interface', String(DeviceInterfaceType.DUSTCAP | DeviceInterfaceType.LIGHTBOX)], ['DRIVER_EXEC', 'Exec', 'indi_wanderer_cover'], ['DRIVER_VERSION', 'Version', '1.2'], ['DRIVER_NAME', 'Name', name]),
	)
	handleDefSwitchVector(client, handler, makeSwitchVector(name, 'CONNECTION', 'Connection', 'Main', 'OneOfMany', 'rw', ['CONNECT', 'Connect', true], ['DISCONNECT', 'Disconnect', false]))
	handleDefSwitchVector(client, handler, makeSwitchVector(name, 'CAP_PARK', 'Park', 'Main', 'OneOfMany', 'rw', ['PARK', 'Park', true], ['UNPARK', 'Unpark', false]))
	const heater = makeNumberVector(name, 'Heater', 'Heater', 'Main', 'rw', ['Heater', 'Heater', 0, 0, 255, 1, '%.0f'])
	handleDefNumberVector(client, handler, heater)
	return {
		client,
		sent,
		heater,
		set: (value: number) => handleSetNumberVector(client, handler, { ...heater, elements: { Heater: { ...heater.elements.Heater, value } } }),
		park: (parked: boolean, busy = false) => handleSetSwitchVector(client, handler, { ...makeSwitchVector(name, 'CAP_PARK', 'Park', 'Main', 'OneOfMany', 'rw', ['PARK', 'Park', parked], ['UNPARK', 'Unpark', !parked]), state: busy ? 'Busy' : 'Idle' }),
	}
}

test('a dew heater is an interface of its cover, arbitrated with it', async () => {
	const registry = new DeviceRegistry(() => {})
	const operations = new OperationRegistry(registry, () => {})
	disposables.push(operations)
	const heaters = new DewHeaterCommands(registry, (connectionId) => (connectionId === 'w' ? fake.client : undefined), operations)
	const fake = heatedCover(registry)

	const devices = registry.list(fake.client)
	const cover = devices.find((d) => d.type === 'cover')!
	const heater = devices.find((d) => d.type === 'dewHeater')!
	expect(heater.hardwareId).toBe(cover.hardwareId)
	expect(devices.some((d) => d.type === 'flatPanel' && d.hardwareId === cover.hardwareId)).toBeTrue()
	expect(registry.state(fake.client, 'dewHeater', heater.id)).toMatchObject({ hasDewHeater: true, dutyCycle: { value: 0, min: 0, max: 255 } })

	expect((await heaters.setDutyCycle('w', heater.id, { value: 300 })).status).toBe(204)
	expect(fake.sent.at(-1)).toMatchObject({ device: 'WandererCover', name: 'Heater', elements: { Heater: 255 } })
	fake.set(255)
	expect(registry.state(fake.client, 'dewHeater', heater.id)?.dutyCycle.value).toBe(255)

	// While the cover moves the physical device is not at rest, so the heater cannot be changed under it.
	fake.park(false, true)
	await waitUntil(() => !operations.available(registry.device(fake.client, 'cover', cover.id)!))
	expect((await heaters.setDutyCycle('w', heater.id, { value: 10 })).status).toBe(409)
	expect(heaters.state('w', heater.id).status).toBe(200)
	expect(heaters.state('other', heater.id).status).toBe(404)
})
