import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Device } from 'nebulosa/src/devices/indi/device'
import { CameraManager, CoverManager, FlatPanelManager, FocuserManager, GuideOutputManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/devices/indi/manager'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { CoverSimulator } from 'nebulosa/src/devices/indi/simulator/cover'
import { coordinatedAlpacaManagers } from 'src/api/alpaca.adapter'
import { CameraCommander } from 'src/api/camera.commander'
import { CoverCommander } from 'src/api/cover.commander'
import { DeviceLifecycle } from 'src/api/device.lifecycle'
import { FlatPanelCommander } from 'src/api/flatpanel.commander'
import { FocuserCommander } from 'src/api/focuser.commander'
import { GuideOutputCommander } from 'src/api/guideoutput.commander'
import { MountCommander } from 'src/api/mount.commander'
import { OperationCoordinator } from 'src/api/operation'
import { resourceKey, ResourceArbiter } from 'src/api/resource'
import { WheelCommander } from 'src/api/wheel.commander'
import { waitUntil } from './util'

const cameraManager = new CameraManager()
const coverManager = new CoverManager()
const mountManager = new MountManager()
const focuserManager = new FocuserManager()
const wheelManager = new WheelManager()
const flatPanelManager = new FlatPanelManager()
const rotatorManager = new RotatorManager()
const guideOutputManager = new GuideOutputManager(mountManager)
const resourceArbiter = new ResourceArbiter()
const operationCoordinator = new OperationCoordinator(resourceArbiter)
const deviceLifecycle = new DeviceLifecycle(resourceArbiter, operationCoordinator)

deviceLifecycle.observe(cameraManager)
deviceLifecycle.observe(coverManager)

const alpaca = coordinatedAlpacaManagers(
	{ camera: cameraManager, mount: mountManager, focuser: focuserManager, wheel: wheelManager, cover: coverManager, flatPanel: flatPanelManager, rotator: rotatorManager, guideOutput: guideOutputManager },
	{
		camera: new CameraCommander(cameraManager),
		mount: new MountCommander(mountManager),
		focuser: new FocuserCommander(focuserManager),
		wheel: new WheelCommander(wheelManager),
		cover: new CoverCommander(coverManager),
		flatPanel: new FlatPanelCommander(flatPanelManager),
		guideOutput: new GuideOutputCommander(guideOutputManager),
	},
	operationCoordinator,
)

const handler = new IndiClientHandlerSet([cameraManager, coverManager])
const client = new ClientSimulator('Client Simulator', handler)
const cameraSimulator = new CameraSimulator('Camera Simulator', client)
const coverSimulator = new CoverSimulator('Cover Simulator', client)

afterAll(() => {
	cameraSimulator.dispose()
	coverSimulator.dispose()
})

beforeEach(() => {
	cameraManager.disconnect(getCamera())
	coverManager.disconnect(getCover())
})

afterEach(async () => {
	await operationCoordinator.cancelAll('aborted')
	cameraManager.disconnect(getCamera())
	coverManager.disconnect(getCover())
})

function getCamera() {
	const device = cameraManager.get(client, 'Camera Simulator')!
	expect(device).toBeDefined()
	return device
}

function getCover() {
	const device = coverManager.get(client, 'Cover Simulator')!
	expect(device).toBeDefined()
	return device
}

function free(device: Device) {
	return resourceArbiter.availability(resourceKey(device)) === 'available'
}

async function connectedCamera() {
	const device = getCamera()
	cameraManager.connect(device)
	await waitUntil(() => free(device))
	return device
}

async function connectedCover() {
	const device = getCover()
	coverManager.connect(device)
	await waitUntil(() => free(device))
	return device
}

describe('coordinated alpaca managers', () => {
	test('reads through to the real manager', () => {
		const device = getCover()

		expect(Array.from(alpaca.cover.list())).toHaveLength(1)
		expect(alpaca.cover.get(client, 'Cover Simulator')).toBe(device)
		expect(alpaca.rotator).toBe(rotatorManager)
	})

	test('routes a cover command through the commander', async () => {
		const device = await connectedCover()

		alpaca.cover.park(device)

		await waitUntil(() => device.parking)
		await waitUntil(() => device.parked && !device.parking, 3000)
		await waitUntil(() => free(device))

		alpaca.cover.unpark(device)

		await waitUntil(() => !device.parked && !device.parking, 3000)
	})

	test('refuses a cover command competing with another ingress holding it', async () => {
		const device = await connectedCover()
		const coverCommander = new CoverCommander(coverManager)
		const unpark = spyOn(coverManager, 'unpark')

		try {
			void coverCommander.park(operationCoordinator, device)

			await waitUntil(() => !free(device))

			alpaca.cover.unpark(device)

			expect(await waitUntil(() => unpark.mock.calls.length > 0, 500, true)).toBeFalse()
		} finally {
			unpark.mockRestore()
		}
	})

	test('applies settings issued back to back by one alpaca request', async () => {
		const device = await connectedCamera()
		const gain = spyOn(cameraManager, 'gain')
		const offset = spyOn(cameraManager, 'offset')

		try {
			alpaca.camera.gain(device, 10)
			alpaca.camera.offset(device, 5)

			await waitUntil(() => gain.mock.calls.length > 0)
			await waitUntil(() => offset.mock.calls.length > 0)
		} finally {
			gain.mockRestore()
			offset.mockRestore()
		}
	})

	test('holds the camera for the exposure window', async () => {
		const device = await connectedCamera()

		alpaca.camera.startExposure(device, 1)

		await waitUntil(() => !free(device))
		await waitUntil(() => free(device), 5000)
	})

	test('stops an alpaca exposure and releases the camera', async () => {
		const device = await connectedCamera()
		const stopExposure = spyOn(cameraManager, 'stopExposure')

		try {
			alpaca.camera.startExposure(device, 30)

			await waitUntil(() => !free(device))

			alpaca.camera.stopExposure(device)

			await waitUntil(() => stopExposure.mock.calls.length > 0)
			await waitUntil(() => free(device), 5000)
		} finally {
			stopExposure.mockRestore()
		}
	})

	test('does not apply a camera setting while the sensor is integrating', async () => {
		const device = await connectedCamera()
		const gain = spyOn(cameraManager, 'gain')

		try {
			alpaca.camera.startExposure(device, 30)

			await waitUntil(() => !free(device))

			alpaca.camera.gain(device, 10)

			expect(await waitUntil(() => gain.mock.calls.length > 0, 500, true)).toBeFalse()
		} finally {
			gain.mockRestore()
		}
	})
})
