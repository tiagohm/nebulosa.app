import { afterEach, expect, test } from 'bun:test'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { MountSimulator } from 'nebulosa/src/devices/indi/simulator/mount'
import { deg } from 'nebulosa/src/math/units/angle'
import { type DeviceEvent, DeviceRegistry, type MountState } from './devices'

const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0)) disposable[Symbol.dispose]()
})

async function waitUntil(condition: () => boolean, timeout = 10000) {
	const start = Date.now()
	while (!condition()) {
		if (Date.now() - start > timeout) throw new Error('timeout')
		await Bun.sleep(20)
	}
}

// Registry with one simulator client per connection id, each providing a mount and a camera of the same names.
function setup(...connectionIds: string[]) {
	const events: DeviceEvent[] = []
	const registry = new DeviceRegistry((event) => events.push(event))
	const clients = connectionIds.map((connectionId) => {
		const client = new ClientSimulator(connectionId, registry.handler)
		registry.attach(client, connectionId)
		// The client disposes the simulators registered with it.
		void [new MountSimulator('Mount Simulator', client), new CameraSimulator('Camera Simulator', client)]
		disposables.push(client)
		return client
	})
	return { registry, events, clients }
}

function mountStates(events: readonly DeviceEvent[]): MountState[] {
	return events.flatMap((event) => (event.type === 'mount:updated' ? [event.state] : []))
}

test('mount state is published at once on motion changes and coalesced while moving', async () => {
	const { registry, events, clients } = setup('a')
	const mount = registry.list(clients[0]).find((d) => d.type === 'mount')!
	registry.switch(clients[0], mount.id, true)
	const device = registry.mount(clients[0], mount.id)!
	await waitUntil(() => device.connected && device.canGoTo)

	expect(mountStates(events).at(-1)).toMatchObject({ connectionId: 'a', id: mount.id, connected: true })

	registry.mounts.slewRate(device, 'SPEED_1')
	const start = events.length
	registry.mounts.goTo(device, device.equatorialCoordinate.rightAscension + deg(20), device.equatorialCoordinate.declination)
	await waitUntil(() => device.slewing)
	// The slew start is published without waiting for the coalescing interval.
	expect(mountStates(events.slice(start)).some((state) => state.slewing)).toBeTrue()

	const during = events.length
	await Bun.sleep(2500)
	const moving = mountStates(events.slice(during)).filter((state) => state.slewing)
	expect(moving.length).toBeGreaterThanOrEqual(2)
	expect(moving.length).toBeLessThanOrEqual(4)

	registry.mounts.stop(device)
	await waitUntil(() => !device.slewing)
	await Bun.sleep(1100)
	// The trailing publication delivers the final position.
	expect(mountStates(events).at(-1)).toMatchObject({ slewing: false, rightAscension: device.equatorialCoordinate.rightAscension })
}, 20000)

test('camera sensor is published when reported and looked up by exact connection', async () => {
	const { registry, events, clients } = setup('a', 'b')
	const camera = registry.list(clients[0]).find((d) => d.type === 'camera')!
	const other = registry.list(clients[1]).find((d) => d.type === 'camera')!
	expect(other.id).not.toBe(camera.id)

	registry.switch(clients[0], camera.id, true)
	await waitUntil(() => events.some((event) => event.type === 'camera:sensor' && event.state.sensor !== undefined))

	const published = events.find((event) => event.type === 'camera:sensor' && event.state.sensor !== undefined)
	expect(published).toMatchObject({ state: { connectionId: 'a', id: camera.id } })
	expect(registry.cameraSensor(clients[0], camera.id)?.sensor).toEqual(published?.type === 'camera:sensor' ? published.state.sensor : undefined)
	expect(registry.cameraSensor(clients[1], camera.id)).toBeUndefined()
	expect(registry.cameraSensor(clients[1], other.id)?.sensor).toBeUndefined()
	expect(registry.mount(clients[1], registry.list(clients[0]).find((d) => d.type === 'mount')!.id)).toBeUndefined()
})

test('camera capabilities are published when they change, not on exposure progress', async () => {
	const { registry, events, clients } = setup('a')
	const camera = registry.list(clients[0]).find((d) => d.type === 'camera')!
	registry.switch(clients[0], camera.id, true)
	const device = registry.camera(clients[0], camera.id)!
	await waitUntil(() => events.some((event) => event.type === 'camera:capabilities' && event.capabilities.transferFormats.length > 0 && event.capabilities.exposure !== undefined))

	const capabilities = registry.cameraCapabilities(clients[0], camera.id)!
	expect(capabilities).toMatchObject({ connectionId: 'a', id: camera.id, connected: true, transferFormats: ['FITS', 'XISF'] })
	expect(registry.camera(clients[0], 'missing')).toBeUndefined()

	await Bun.sleep(200)
	const before = events.filter((event) => event.type === 'camera:capabilities').length
	registry.cameras.startExposure(device, 0.5)
	await waitUntil(() => device.exposuring)
	await waitUntil(() => !device.exposuring)
	expect(events.filter((event) => event.type === 'camera:capabilities').length).toBe(before)
})
