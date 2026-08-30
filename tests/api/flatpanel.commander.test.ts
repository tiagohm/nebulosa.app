import { afterAll, afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { FlatPanel } from 'nebulosa/src/devices/indi/device'
import { FlatPanelManager } from 'nebulosa/src/devices/indi/manager/flatpanel'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { FlatPanelSimulator } from 'nebulosa/src/devices/indi/simulator/flatpanel'
import { waitUntil } from 'root/tests/api/util'
import { DeviceLifecycle } from 'src/api/device.lifecycle'
import { FlatPanelCommander } from 'src/api/flatpanel.commander'
import { OperationCoordinator } from 'src/api/operation'
import { ResourceArbiter, resourceKey } from 'src/api/resource'
import { failedOperationResult } from '#/orchestration'

const flatPanelManager = new FlatPanelManager()
const resourceArbiter = new ResourceArbiter()
const operationCoordinator = new OperationCoordinator(resourceArbiter)
const flatPanelCommander = new FlatPanelCommander(flatPanelManager)
const deviceLifecycle = new DeviceLifecycle(resourceArbiter, operationCoordinator)
deviceLifecycle.observe(flatPanelManager)
const handler = new IndiClientHandlerSet([flatPanelManager])
const client = new ClientSimulator('Client Simulator', handler)
const simulator = new FlatPanelSimulator('Flat Panel Simulator', client)

afterAll(() => {
	deviceLifecycle.dispose()
	simulator.dispose()
})

beforeEach(() => {
	flatPanelManager.disconnect(getPanel())
})

afterEach(async () => {
	await operationCoordinator.cancelAll()
	flatPanelManager.disconnect(getPanel())
})

function getPanel() {
	const device = flatPanelManager.get(client, simulator.name)
	expect(device).toBeDefined()
	return device!
}

function isFree(panel: FlatPanel) {
	return resourceArbiter.availability(resourceKey(panel)) === 'available'
}

async function connected() {
	const panel = getPanel()
	flatPanelManager.connect(panel)
	await waitUntil(() => panel.connected)
	if (panel.enabled) {
		flatPanelManager.disable(panel)
		await waitUntil(() => !panel.enabled)
	}
	return panel
}

test('enables, disables, toggles, and clamps panel intensity', async () => {
	const panel = await connected()

	expect(await flatPanelCommander.enable(operationCoordinator, panel)).toMatchObject({ ok: true })
	await waitUntil(() => panel.enabled)

	expect(await flatPanelCommander.toggle(operationCoordinator, panel)).toMatchObject({ ok: true })
	await waitUntil(() => !panel.enabled)

	expect(await flatPanelCommander.toggle(operationCoordinator, panel)).toMatchObject({ ok: true })
	await waitUntil(() => panel.enabled)

	expect(await flatPanelCommander.intensity(operationCoordinator, panel, panel.intensity.max + 100)).toMatchObject({ ok: true })
	await waitUntil(() => panel.intensity.value === panel.intensity.max)

	expect(await flatPanelCommander.disable(operationCoordinator, panel)).toMatchObject({ ok: true })
	await waitUntil(() => !panel.enabled)
})

test('dispatches the clamped intensity value', async () => {
	const panel = await connected()
	const intensity = spyOn(flatPanelManager, 'intensity').mockImplementation(() => {})

	try {
		expect(await flatPanelCommander.intensity(operationCoordinator, panel, -1)).toMatchObject({ ok: true })
		expect(await flatPanelCommander.intensity(operationCoordinator, panel, 12.5)).toMatchObject({ ok: true })
		expect(intensity).toHaveBeenNthCalledWith(1, panel, panel.intensity.min)
		expect(intensity).toHaveBeenNthCalledWith(2, panel, 12.5)
	} finally {
		intensity.mockRestore()
	}
})

test('reports a disconnected panel before dispatching a mutation', async () => {
	const panel = getPanel()
	flatPanelManager.connect(panel)
	await waitUntil(() => panel.connected)
	flatPanelManager.disconnect(panel)
	await waitUntil(() => !panel.connected)
	const enable = spyOn(flatPanelManager, 'enable').mockImplementation(() => {})

	try {
		const isolatedArbiter = new ResourceArbiter()
		panel.connected = true
		isolatedArbiter.markAvailable({ key: resourceKey(panel), device: panel })
		panel.connected = false
		isolatedArbiter.markAvailable(resourceKey(panel))
		const isolatedCoordinator = new OperationCoordinator(isolatedArbiter)
		expect(await flatPanelCommander.enable(isolatedCoordinator, panel)).toMatchObject(failedOperationResult('disconnected'))
		expect(enable).not.toHaveBeenCalled()
	} finally {
		enable.mockRestore()
	}
})

test('refuses a panel mutation while another operation owns the panel', async () => {
	const panel = await connected()
	const held = operationCoordinator.start<void>(
		'hold',
		[{ key: resourceKey(panel), device: panel }],
		(context) =>
			new Promise((resolve) => {
				context.signal.addEventListener('abort', () => resolve(failedOperationResult('aborted')), { once: true })
			}),
	)

	expect(await flatPanelCommander.disable(operationCoordinator, panel)).toMatchObject(failedOperationResult('busy'))
	await held.cancel()
	expect(isFree(panel)).toBeTrue()
})
