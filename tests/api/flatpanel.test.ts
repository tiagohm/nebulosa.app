import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/indi.client'
import type { FlatPanel } from 'nebulosa/src/indi.device'
import { FlatPanelManager } from 'nebulosa/src/indi.manager'
import { ClientSimulator, FlatPanelSimulator } from 'nebulosa/src/indi.simulator'
import { FlatPanelHandler, flatPanel as flatPanelEndpoints } from 'src/api/flatpanel'
import { WebSocketMessageHandler, type Messager } from 'src/api/message'
import type { FlatPanelAdded, FlatPanelRemoved, FlatPanelUpdated } from 'src/shared/types'

type SocketMessage<T = unknown> = {
	readonly type: string
	readonly body: T
}

const wsm = new WebSocketMessageHandler()
const flatPanelManager = new FlatPanelManager()
const flatPanelHandler = new FlatPanelHandler(wsm, flatPanelManager)
const endpoints = flatPanelEndpoints(flatPanelHandler)
const handler = new IndiClientHandlerSet([flatPanelManager])
const client = new ClientSimulator('Client Simulator', handler)
const simulator = new FlatPanelSimulator('Flat Panel Simulator', client)

const socketMessages: SocketMessage[] = []
const socket: Messager = {
	sendText(data) {
		const separator = data.indexOf('@')
		const type = data.slice(0, separator)
		const payload = data.slice(separator + 1)

		socketMessages.push({ type, body: payload ? JSON.parse(payload) : undefined })
	},
}

afterAll(() => {
	simulator.dispose()
	wsm.close(socket, 1000, 'done')
})

beforeEach(() => {
	wsm.close(socket, 1000, 'reset')
	socketMessages.length = 0
	flatPanelManager.disconnect(getFlatPanel())
})

afterEach(() => {
	flatPanelManager.disconnect(getFlatPanel())
})

function getFlatPanel() {
	const device = flatPanelManager.get(client, 'Flat Panel Simulator')!
	expect(device).toBeDefined()
	return device
}

function request(id = 'Flat Panel Simulator', body?: unknown, search = '') {
	return {
		url: `http://localhost/flatpanels/${encodeURIComponent(id)}${search}`,
		params: { id },
		json: () => body,
	} as unknown as Bun.BunRequest
}

async function json<T>(response: Response) {
	expect(response.status).toBe(200)
	return (await response.json()) as T
}

async function noContent(response: Response) {
	expect(response.status).toBe(200)
	expect(await response.text()).toBe('')
}

async function waitUntil(condition: () => boolean, timeout = 1500) {
	const start = performance.now()

	while (!condition()) {
		if (performance.now() - start >= timeout) return false
		await Bun.sleep(10)
	}

	return true
}

function flatPanelUpdates(property: keyof FlatPanel & string) {
	return socketMessages.filter((message): message is SocketMessage<FlatPanelUpdated> => message.type === 'flatPanel:update' && (message.body as FlatPanelUpdated).property === property)
}

describe('flat panel handler', () => {
	test('lists and returns flat panels through endpoints', async () => {
		const device = getFlatPanel()
		const list = await json<FlatPanel[]>(endpoints['/flatpanels'].GET(request()))
		const withId = await json<FlatPanel>(endpoints['/flatpanels/:id'].GET(request(device.id)))
		const listWithClient = await json<FlatPanel[]>(endpoints['/flatpanels'].GET(request('Flat Panel Simulator', undefined, `?client=${encodeURIComponent(client.id)}`)))

		expect(list).toHaveLength(1)
		expect(list[0].id).toBe(device.id)
		expect(withId.id).toBe(device.id)
		expect(listWithClient).toHaveLength(1)
		expect(listWithClient[0].id).toBe(device.id)
	})

	test('sends add event to a socket opened after discovery', async () => {
		const device = getFlatPanel()

		wsm.open(socket)

		expect(await waitUntil(() => socketMessages.some((message) => message.type === 'flatPanel:add'))).toBeTrue()

		const message = socketMessages.find((message): message is SocketMessage<FlatPanelAdded> => message.type === 'flatPanel:add')

		expect(message).toBeDefined()
		expect(message!.body.device.id).toBe(device.id)
		expect(message!.body.device.name).toBe(device.name)
		expect(message!.body.device.type).toBe('flatPanel')
	})

	test('emits connection and intensity metadata updates', () => {
		const device = getFlatPanel()

		wsm.open(socket)
		socketMessages.length = 0

		flatPanelManager.connect(device)

		expect(device.connected).toBeTrue()
		expect(device.intensity.min).toBe(0)
		expect(device.intensity.max).toBeGreaterThan(0)
		expect(flatPanelUpdates('connected').at(-1)?.body.device.connected).toBeTrue()
		expect(flatPanelUpdates('intensity').at(-1)?.body.device.intensity!.max).toBe(device.intensity.max)

		flatPanelManager.disconnect(device)

		expect(flatPanelUpdates('connected').at(-1)?.body.device.connected).toBeFalse()
	})

	test('enables, disables, toggles, and changes intensity through endpoints', async () => {
		const device = getFlatPanel()

		wsm.open(socket)
		flatPanelManager.connect(device)
		socketMessages.length = 0

		await noContent(endpoints['/flatpanels/:id/enable'].POST(request(device.id)))

		expect(await waitUntil(() => device.enabled)).toBeTrue()
		expect(flatPanelUpdates('enabled').at(-1)?.body.device.enabled).toBeTrue()

		await noContent(await endpoints['/flatpanels/:id/intensity'].POST(request(device.id, 42)))

		expect(device.intensity.value).toBe(42)
		expect(flatPanelUpdates('intensity').at(-1)?.body.device.intensity!.value).toBe(42)

		await noContent(endpoints['/flatpanels/:id/disable'].POST(request(device.id)))

		expect(device.enabled).toBeFalse()
		expect(flatPanelUpdates('enabled').at(-1)?.body.device.enabled).toBeFalse()

		await noContent(endpoints['/flatpanels/:id/toggle'].POST(request(device.id)))

		expect(device.enabled).toBeTrue()
		expect(flatPanelUpdates('enabled').at(-1)?.body.device.enabled).toBeTrue()
	})

	test('delegates endpoint actions to the flat panel manager', async () => {
		const device = getFlatPanel()
		const enable = spyOn(flatPanelManager, 'enable')
		const disable = spyOn(flatPanelManager, 'disable')
		const toggle = spyOn(flatPanelManager, 'toggle')
		const intensity = spyOn(flatPanelManager, 'intensity')

		try {
			await noContent(endpoints['/flatpanels/:id/enable'].POST(request(device.id)))
			await noContent(endpoints['/flatpanels/:id/disable'].POST(request(device.id)))
			await noContent(endpoints['/flatpanels/:id/toggle'].POST(request(device.id)))
			await noContent(await endpoints['/flatpanels/:id/intensity'].POST(request(device.id, 128)))

			expect(enable).toHaveBeenCalledWith(device)
			expect(disable).toHaveBeenCalledWith(device)
			expect(toggle).toHaveBeenCalledWith(device)
			expect(intensity).toHaveBeenCalledWith(device, 128)
		} finally {
			intensity.mockRestore()
			toggle.mockRestore()
			disable.mockRestore()
			enable.mockRestore()
		}
	})

	test('emits remove event when the simulator is disposed', () => {
		const wsm = new WebSocketMessageHandler()
		const flatPanelManager = new FlatPanelManager()
		const flatPanelHandler = new FlatPanelHandler(wsm, flatPanelManager)
		const handler = new IndiClientHandlerSet([flatPanelManager])
		const client = new ClientSimulator('Client Simulator', handler)
		const flatPanelSimulator = new FlatPanelSimulator('Flat Panel Simulator', client)
		const messages: SocketMessage[] = []
		const socket: Messager = {
			sendText(data) {
				const separator = data.indexOf('@')
				const type = data.slice(0, separator)
				const payload = data.slice(separator + 1)

				messages.push({ type, body: payload ? JSON.parse(payload) : undefined })
			},
		}

		wsm.open(socket)
		messages.length = 0
		flatPanelSimulator.dispose()

		const message = messages.find((message): message is SocketMessage<FlatPanelRemoved> => message.type === 'flatPanel:remove')

		expect(message).toBeDefined()
		expect(message!.body.device.name).toBe('Flat Panel Simulator')

		wsm.close(socket, 1000, 'done')
	})
})
