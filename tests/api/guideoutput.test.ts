import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { GuideOutput } from 'nebulosa/src/devices/indi/device'
import { GuideOutputManager, MountManager } from 'nebulosa/src/devices/indi/manager'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { MountSimulator } from 'nebulosa/src/devices/indi/simulator/mount'
import { ConfirmationHandler } from 'src/api/confirmation'
import { guideOutputBus, guideOutput as guideOutputEndpoints, GuideOutputHandler } from 'src/api/guideoutput'
import { GuideOutputCommander } from 'src/api/guideoutput.commander'
import { WebSocketMessageHandler } from 'src/api/message'
import { MountHandler } from 'src/api/mount'
import { MountCommander } from 'src/api/mount.commander'
import { NotificationHandler } from 'src/api/notification'
import { OperationCoordinator } from 'src/api/operation'
import { resourceKey, ResourceArbiter } from 'src/api/resource'
import type { GuideOutputAdded, GuideOutputRemoved, GuideOutputUpdated, GuidePulse } from '#/guideoutput'
import { json, noContent, SocketMessager, waitUntil } from './util'

guideOutputBus.forceSync = true

const wsm = new WebSocketMessageHandler()
const mountManager = new MountManager()
const guideOutputManager = new GuideOutputManager(mountManager)
const guideOutputCommander = new GuideOutputCommander(guideOutputManager)
const resourceArbiter = new ResourceArbiter()
const operationCoordinator = new OperationCoordinator(resourceArbiter)
const guideOutputHandler = new GuideOutputHandler(wsm, guideOutputManager, new NotificationHandler(wsm), guideOutputCommander, operationCoordinator)
const endpoints = guideOutputEndpoints(guideOutputHandler)
const handler = new IndiClientHandlerSet([mountManager, guideOutputManager])
const client = new ClientSimulator('Client Simulator', handler)
const simulator = new MountSimulator('Mount Simulator', client)
const socket = new SocketMessager()

afterAll(() => {
	simulator.dispose()
	wsm.close(socket, 1000, 'done')
})

beforeEach(() => {
	wsm.close(socket, 1000, 'reset')
	socket.clear()
	mountManager.disconnect(getMount())
})

afterEach(async () => {
	await operationCoordinator.cancelAll('aborted')
	mountManager.disconnect(getMount())
})

function getMount() {
	const device = mountManager.get(client, 'Mount Simulator')!
	expect(device).toBeDefined()
	return device
}

function getGuideOutput() {
	const device = guideOutputManager.get(client, 'Mount Simulator')!
	expect(device).toBeDefined()
	return device
}

function connectAndGetGuideOutput() {
	mountManager.connect(getMount())
	return getGuideOutput()
}

function request(id = 'Mount Simulator', body?: unknown, search = '') {
	return {
		url: `http://localhost/guideoutputs/${encodeURIComponent(id)}${search}`,
		params: { id },
		json: () => body,
	} as unknown as Bun.BunRequest
}

function guideOutputUpdates(property: keyof GuideOutput & string) {
	return socket.filter<GuideOutputUpdated>((message) => message.type === 'guideOutput:update' && message.body.property === property)
}

describe('guide output handler', () => {
	test('lists and returns guide outputs through endpoints', async () => {
		const device = connectAndGetGuideOutput()
		const list = await json<GuideOutput[]>(endpoints['/guideoutputs'].GET(request()))
		const withId = await json<GuideOutput>(endpoints['/guideoutputs/:id'].GET(request(device.id)))
		const listWithClient = await json<GuideOutput[]>(endpoints['/guideoutputs'].GET(request('Mount Simulator', undefined, `?client=${encodeURIComponent(client.id)}`)))

		expect(list).toHaveLength(1)
		expect(list[0].id).toBe(device.id)
		expect(list[0].parentId).toBe(getMount().id)
		expect(withId.id).toBe(device.id)
		expect(withId.parentId).toBe(getMount().id)
		expect(listWithClient).toHaveLength(1)
		expect(listWithClient[0].id).toBe(device.id)
	})

	test('sends add event to a socket opened after discovery', async () => {
		const device = connectAndGetGuideOutput()

		wsm.open(socket)

		expect(await waitUntil(() => socket.some((message) => message.type === 'guideOutput:add'))).toBeTrue()

		const message = socket.find<GuideOutputAdded>((message) => message.type === 'guideOutput:add')

		expect(message).toBeDefined()
		expect(message!.body.device.id).toBe(device.id)
		expect(message!.body.device.parentId).toBe(getMount().id)
		expect(message!.body.device.name).toBe(device.name)
		expect(message!.body.device.type).toBe('guideOutput')
	})

	test('emits add, capability, and guide rate updates when parent mount connects', () => {
		wsm.open(socket)

		const mount = getMount()
		mountManager.connect(mount)
		const device = getGuideOutput()

		expect(guideOutputHandler.list(client)).toHaveLength(1)
		expect(device.connected).toBeTrue()
		expect(device.canPulseGuide).toBeTrue()
		expect(device.hasGuideRate).toBeTrue()
		expect(device.canSetGuideRate).toBeTrue()
		expect(device.guideRate.rightAscension).toBe(0.5)
		expect(device.guideRate.declination).toBe(0.5)

		const add = socket.find<GuideOutputAdded>((message) => message.type === 'guideOutput:add')
		const updates = socket.filter<GuideOutputUpdated>((message) => message.type === 'guideOutput:update')

		expect(add).toBeDefined()
		expect(add!.body.device.id).toBe(device.id)
		expect(add!.body.device.parentId).toBe(mount.id)
		expect(updates.find((message) => message.body.property === 'canPulseGuide')?.body.device.canPulseGuide).toBeTrue()
		expect(updates.find((message) => message.body.property === 'hasGuideRate')?.body.device.hasGuideRate).toBeTrue()
		expect(updates.find((message) => message.body.property === 'canSetGuideRate')?.body.device.canSetGuideRate).toBeTrue()
		expect(updates.find((message) => message.body.property === 'guideRate')?.body.device.guideRate).toEqual(device.guideRate)
	})

	test('updates guide rate and pulse state through endpoints', async () => {
		const device = connectAndGetGuideOutput()
		const rate = { rightAscension: 0.75, declination: 0.25 }
		const pulse = { direction: 'NORTH', duration: 100 } satisfies GuidePulse

		wsm.open(socket)
		socket.clear()

		await noContent(await endpoints['/guideoutputs/:id/pulse'].POST(request(device.id, [pulse])))

		expect(await waitUntil(() => device.pulsing)).toBeTrue()
		expect(guideOutputUpdates('pulsing').at(-1)?.body.device.pulsing).toBeTrue()
		expect(await waitUntil(() => !device.pulsing, 3000)).toBeTrue()
		expect(guideOutputUpdates('pulsing').at(-1)?.body.device.pulsing).toBeFalse()

		const response = await endpoints['/guideoutputs/:id/guiderate'].POST(request(device.id, rate))

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ ok: true })
		expect(device.guideRate.rightAscension).toBe(rate.rightAscension)
		expect(device.guideRate.declination).toBe(rate.declination)
		expect(guideOutputUpdates('guideRate').at(-1)?.body.device.guideRate).toEqual(device.guideRate)
	})

	test('pulses both axes of a diagonal nudge in one operation', async () => {
		const device = connectAndGetGuideOutput()
		const pulse = spyOn(guideOutputManager, 'pulse')
		const pulses = [
			{ direction: 'NORTH', duration: 100 },
			{ direction: 'WEST', duration: 100 },
		] satisfies GuidePulse[]

		try {
			await noContent(await endpoints['/guideoutputs/:id/pulse'].POST(request(device.id, pulses)))

			expect(await waitUntil(() => pulse.mock.calls.some((call) => call[1] === 'NORTH' && call[2] === 100))).toBeTrue()
			expect(pulse.mock.calls.some((call) => call[1] === 'WEST' && call[2] === 100)).toBeTrue()
			expect(await waitUntil(() => device.pulsing)).toBeTrue()
			expect(await waitUntil(() => !device.pulsing && resourceArbiter.availability(resourceKey(device)) === 'available', 3000)).toBeTrue()
		} finally {
			pulse.mockRestore()
		}
	})

	test('zeroes both guide vectors and releases the device when stopped', async () => {
		const device = connectAndGetGuideOutput()
		const pulse = spyOn(guideOutputManager, 'pulse')
		const pulses = [{ direction: 'NORTH', duration: 400 }] satisfies GuidePulse[]

		try {
			await noContent(await endpoints['/guideoutputs/:id/pulse'].POST(request(device.id, pulses)))

			expect(await waitUntil(() => device.pulsing)).toBeTrue()

			const response = await endpoints['/guideoutputs/:id/stop'].POST(request(device.id))

			expect(response.status).toBe(200)
			expect(await response.json()).toEqual({ ok: true })
			expect(pulse).toHaveBeenCalledWith(device, 'SOUTH', 0)
			expect(pulse).toHaveBeenCalledWith(device, 'WEST', 0)
			expect(pulse).toHaveBeenCalledWith(device, 'EAST', 0)
			expect(device.pulsing).toBeFalse()
			expect(resourceArbiter.availability(resourceKey(device))).toBe('available')
		} finally {
			pulse.mockRestore()
		}
	})

	test('emits add and temperature updates when parent focuser connects', () => {
		const wsm = new WebSocketMessageHandler()
		const socket = new SocketMessager()
		wsm.open(socket)

		const mountManager = new MountManager()
		const guideOutputManager = new GuideOutputManager(mountManager)
		const guideOutputHandler = new GuideOutputHandler(wsm, guideOutputManager, new NotificationHandler(wsm), new GuideOutputCommander(guideOutputManager), new OperationCoordinator(new ResourceArbiter()))
		const mountHandler = new MountHandler(wsm, mountManager, new ConfirmationHandler(), new NotificationHandler(wsm), new MountCommander(mountManager), new OperationCoordinator(new ResourceArbiter()))
		const handler = new IndiClientHandlerSet([mountManager, guideOutputManager])
		const client = new ClientSimulator('Client Simulator', handler)
		const mountSimulator = new MountSimulator('Mount Simulator', client)

		const mount = mountManager.get(client, 'Mount Simulator')!
		mountManager.connect(mount)
		const guideOutput = guideOutputManager.get(client, 'Mount Simulator')!

		expect(guideOutput.connected).toBeTrue()
		expect(guideOutput.hasGuideRate).toBeTrue()
		expect(guideOutput.canPulseGuide).toBeTrue()
		expect(guideOutput.canSetGuideRate).toBeTrue()
		expect(guideOutput.guideRate.rightAscension).toBeGreaterThan(0)
		expect(guideOutput.guideRate.declination).toBeGreaterThan(0)

		expect(mount.connected).toBeTrue()
		expect(mount.hasGuideRate).toBeTrue()
		expect(mount.canPulseGuide).toBeTrue()
		expect(mount.canSetGuideRate).toBeTrue()
		expect(mount.guideRate.rightAscension).toBeGreaterThan(0)
		expect(mount.guideRate.declination).toBeGreaterThan(0)

		let add = socket.find<GuideOutputAdded>((message) => message.type === 'guideOutput:add')
		let updates = socket.filter<GuideOutputUpdated>((message) => message.type === 'guideOutput:update')

		expect(add).toBeDefined()
		expect(add!.body.device.id).toBe(guideOutput.id)
		expect(updates.find((message) => message.body.property === 'hasGuideRate')?.body.device.hasGuideRate).toBeTrue()
		expect(updates.find((message) => message.body.property === 'canPulseGuide')?.body.device.canPulseGuide).toBeTrue()
		expect(updates.find((message) => message.body.property === 'canSetGuideRate')?.body.device.canSetGuideRate).toBeTrue()
		expect(updates.find((message) => message.body.property === 'guideRate')?.body.device.guideRate).toEqual(guideOutput.guideRate)

		add = socket.find<GuideOutputAdded>((message) => message.type === 'mount:add')
		updates = socket.filter<GuideOutputUpdated>((message) => message.type === 'mount:update')

		// expect(add).toBeDefined()
		// expect(add!.body.device.id).toBe(mount.id)
		// expect(updates.find((message) => message.body.property === 'hasGuideRate')?.body.device.hasGuideRate).toBeTrue()
		// expect(updates.find((message) => message.body.property === 'canPulseGuide')?.body.device.canPulseGuide).toBeTrue()
		// expect(updates.find((message) => message.body.property === 'canSetGuideRate')?.body.device.canSetGuideRate).toBeTrue()
		// expect(updates.find((message) => message.body.property === 'guideRate')?.body.device.guideRate).toEqual(mount.guideRate)

		mountSimulator.dispose()
		wsm.close(socket, 1000, 'done')
	})

	test('emits reset updates when parent mount disconnects', async () => {
		const mount = getMount()
		const pulse = { direction: 'NORTH', duration: 500 } satisfies GuidePulse

		mountManager.connect(mount)
		const device = getGuideOutput()
		wsm.open(socket)
		await noContent(await endpoints['/guideoutputs/:id/pulse'].POST(request(device.id, [pulse])))
		expect(await waitUntil(() => device.pulsing)).toBeTrue()
		socket.clear()

		mountManager.disconnect(mount)

		expect(device.connected).toBeFalse()
		expect(device.canPulseGuide).toBeFalse()
		expect(device.pulsing).toBeFalse()
		expect(device.hasGuideRate).toBeFalse()
		expect(device.canSetGuideRate).toBeFalse()
		expect(device.guideRate.rightAscension).toBe(0)
		expect(device.guideRate.declination).toBe(0)
		expect(guideOutputUpdates('canPulseGuide').at(-1)?.body.device.canPulseGuide).toBeFalse()
		expect(guideOutputUpdates('pulsing').at(-1)?.body.device.pulsing).toBeFalse()
		expect(guideOutputUpdates('hasGuideRate').at(-1)?.body.device.hasGuideRate).toBeFalse()
		expect(guideOutputUpdates('canSetGuideRate').at(-1)?.body.device.canSetGuideRate).toBeFalse()
		expect(guideOutputUpdates('guideRate').at(-1)?.body.device.guideRate).toEqual(device.guideRate)
		expect(socket.find<GuideOutputRemoved>((message) => message.type === 'guideOutput:remove')?.body.device.id).toBe(device.id)
	})

	test('restores pulse and guide rate capabilities after reconnect', () => {
		const mount = getMount()
		mountManager.connect(mount)
		const firstDevice = getGuideOutput()
		mountManager.disconnect(mount)
		mountManager.connect(mount)
		const device = getGuideOutput()

		expect(device.id).toBe(firstDevice.id)
		expect(device.connected).toBeTrue()
		expect(device.hasGuideRate).toBeTrue()
		expect(device.canSetGuideRate).toBeTrue()
		expect(device.canPulseGuide).toBeTrue()
		expect(device.guideRate).toEqual(mount.guideRate)
	})

	test('delegates endpoint actions to the guide output manager', async () => {
		const device = connectAndGetGuideOutput()
		const guideRate = spyOn(guideOutputManager, 'guideRate')
		const pulse = spyOn(guideOutputManager, 'pulse')
		const rate = { rightAscension: 0.6, declination: 0.4 }
		const guidePulse = { direction: 'WEST', duration: 75 } satisfies GuidePulse

		try {
			await endpoints['/guideoutputs/:id/guiderate'].POST(request(device.id, rate))
			await noContent(await endpoints['/guideoutputs/:id/pulse'].POST(request(device.id, [guidePulse])))

			expect(await waitUntil(() => pulse.mock.calls.some((call) => call[1] === guidePulse.direction))).toBeTrue()
			expect(guideRate).toHaveBeenCalledWith(device, rate.rightAscension, rate.declination)
			expect(pulse).toHaveBeenCalledWith(device, guidePulse.direction, guidePulse.duration)
		} finally {
			pulse.mockRestore()
			guideRate.mockRestore()
		}
	})

	test('fails the pulse when the driver reports an alert on the guide vector', async () => {
		const device = connectAndGetGuideOutput()

		resourceArbiter.markAvailable({ key: resourceKey(device), device })

		const pulse = guideOutputCommander.pulse(operationCoordinator, device, 'NORTH', 300)

		expect(await waitUntil(() => device.pulsing)).toBeTrue()

		guideOutputCommander.updated(device, 'pulsing', 'Alert')

		const result = await pulse

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('alert')
	})

	test('lets a cancel interrupt a pulse the device has not confirmed stopping', async () => {
		const device = connectAndGetGuideOutput()

		resourceArbiter.markAvailable({ key: resourceKey(device), device })

		const pulse = spyOn(guideOutputManager, 'pulse').mockImplementation(() => {})

		device.pulsing = true

		const handle = operationCoordinator.start('darv', [{ key: resourceKey(device), device }], (context) => guideOutputCommander.pulse(context, device, 'NORTH', 50))

		try {
			await Bun.sleep(150)

			const canceled = handle.cancel()

			setTimeout(() => {
				device.pulsing = false
				guideOutputCommander.updated(device, 'pulsing', 'Idle')
			}, 20)

			await canceled

			const result = await handle.result

			expect(result.ok).toBeFalse()
			expect(result.ok || result.reason).toBe('aborted')
		} finally {
			device.pulsing = false
			pulse.mockRestore()
		}
	})

	test('zeroes every axis of a canceled nudge before waiting for the standstill', async () => {
		const device = connectAndGetGuideOutput()

		resourceArbiter.markAvailable({ key: resourceKey(device), device })

		const zeroed = new Set<string>()
		let canceling = false

		const pulse = spyOn(guideOutputManager, 'pulse').mockImplementation((_, direction, duration) => {
			if (!canceling || duration !== 0) return

			zeroed.add(direction)

			if (zeroed.size < 4) return

			device.pulsing = false
			guideOutputCommander.updated(device, 'pulsing', 'Idle')
		})

		const pulses = [
			{ direction: 'NORTH', duration: 5000 },
			{ direction: 'WEST', duration: 5000 },
		] satisfies GuidePulse[]

		device.pulsing = true

		const handle = operationCoordinator.start('darv', [{ key: resourceKey(device), device }], (context) => guideOutputCommander.pulseAxes(context, device, pulses))

		try {
			expect(await waitUntil(() => pulse.mock.calls.filter((call) => call[2] === 5000).length === 2)).toBeTrue()

			canceling = true

			await handle.cancel()

			const result = await handle.result

			expect(result.ok).toBeFalse()
			expect(Array.from(zeroed).sort()).toEqual(['EAST', 'NORTH', 'SOUTH', 'WEST'])
			expect(device.pulsing).toBeFalse()
		} finally {
			device.pulsing = false
			pulse.mockRestore()
		}
	})

	test('emits remove event when the parent simulator is disposed', () => {
		const wsm = new WebSocketMessageHandler()
		const mountManager = new MountManager()
		const guideOutputManager = new GuideOutputManager(mountManager)
		const guideOutputHandler = new GuideOutputHandler(wsm, guideOutputManager, new NotificationHandler(wsm), new GuideOutputCommander(guideOutputManager), new OperationCoordinator(new ResourceArbiter()))
		const handler = new IndiClientHandlerSet([mountManager, guideOutputManager])
		const client = new ClientSimulator('Client Simulator', handler)
		const focuserSimulator = new MountSimulator('Mount Simulator', client)
		const socket = new SocketMessager()

		mountManager.connect(mountManager.get(client, 'Mount Simulator')!)
		wsm.open(socket)
		socket.clear()
		focuserSimulator.dispose()

		const message = socket.find<GuideOutputRemoved>((message) => message.type === 'guideOutput:remove')

		expect(message).toBeDefined()
		expect(message!.body.device.name).toBe('Mount Simulator')

		wsm.close(socket, 1000, 'done')
	})
})
