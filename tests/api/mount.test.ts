import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Mount, MountTargetCoordinate } from 'nebulosa/src/devices/indi/device'
import { MountManager } from 'nebulosa/src/devices/indi/manager'
import { ClientSimulator, MountSimulator } from 'nebulosa/src/devices/indi/simulator'
import { deg, hour } from 'nebulosa/src/math/units/angle'
import { meter } from 'nebulosa/src/math/units/distance'
import { CacheManager } from 'src/api/cache'
import { ConfirmationHandler } from 'src/api/confirmation'
import { WebSocketMessageHandler } from 'src/api/message'
import { mount as mountEndpoints, MountHandler, MountRemoteControlHandler } from 'src/api/mount'
import type { CoordinateInfo, MountAdded, MountRemoved, MountUpdated } from 'src/shared/types'
import { SocketMessager } from './util'

const wsm = new WebSocketMessageHandler()
const mountManager = new MountManager()
const confirmation = new ConfirmationHandler(wsm)
const cache = new CacheManager()
const mountHandler = new MountHandler(wsm, mountManager, confirmation, cache)
const mountRemoteControlHandler = new MountRemoteControlHandler(mountManager)
const endpoints = mountEndpoints(mountHandler, mountRemoteControlHandler)
const handler = new IndiClientHandlerSet([mountManager])
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

afterEach(() => {
	mountManager.disconnect(getMount())
})

function getMount() {
	const device = mountManager.get(client, 'Mount Simulator')!
	expect(device).toBeDefined()
	return device
}

function request(id = 'Mount Simulator', body?: unknown, search = '') {
	return {
		url: `http://localhost/mounts/${encodeURIComponent(id)}${search}`,
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

function mountUpdates(property: keyof Mount & string) {
	return socket.filter<MountUpdated>((message) => message.type === 'mount:update' && message.body.property === property)
}

function targetCoordinate(): MountTargetCoordinate {
	return { type: 'JNOW', JNOW: { x: '05:00:00', y: '-30:00:00' } }
}

describe('mount handler', () => {
	test('lists and returns mounts through endpoints', async () => {
		const device = getMount()
		const list = await json<Mount[]>(endpoints['/mounts'].GET(request()))
		const withId = await json<Mount>(endpoints['/mounts/:id'].GET(request(device.id)))
		const listWithClient = await json<Mount[]>(endpoints['/mounts'].GET(request('Mount Simulator', undefined, `?client=${encodeURIComponent(client.id)}`)))

		expect(list).toHaveLength(1)
		expect(list[0].id).toBe(device.id)
		expect(withId.id).toBe(device.id)
		expect(listWithClient).toHaveLength(1)
		expect(listWithClient[0].id).toBe(device.id)
	})

	test('sends add event to a socket opened after discovery', async () => {
		const device = getMount()

		wsm.open(socket)

		expect(await waitUntil(() => socket.some<MountAdded>((message) => message.type === 'mount:add'))).toBeTrue()

		const message = socket.find<MountAdded>((message) => message.type === 'mount:add')

		expect(message).toBeDefined()
		expect(message!.body.device.id).toBe(device.id)
		expect(message!.body.device.name).toBe(device.name)
		expect(message!.body.device.type).toBe('mount')
	})

	test('emits connection, capability, and metadata updates', () => {
		const device = getMount()

		wsm.open(socket)
		socket.clear()

		mountManager.connect(device)

		expect(device.connected).toBeTrue()
		expect(device.canAbort).toBeTrue()
		expect(device.canGoTo).toBeTrue()
		expect(device.canSync).toBeTrue()
		expect(device.canHome).toBeTrue()
		expect(device.canSetHome).toBeTrue()
		expect(device.canPark).toBeTrue()
		expect(device.canSetPark).toBeTrue()
		expect(device.canTracking).toBeTrue()
		expect(device.canMove).toBeTrue()
		expect(device.hasPierSide).toBeTrue()
		expect(device.slewRates.length).toBeGreaterThan(0)
		expect(device.trackModes.length).toBeGreaterThan(0)
		expect(mountUpdates('connected').at(-1)?.body.device.connected).toBeTrue()
		expect(mountUpdates('canAbort').at(-1)?.body.device.canAbort).toBeTrue()
		expect(mountUpdates('canGoTo').at(-1)?.body.device.canGoTo).toBeTrue()
		expect(mountUpdates('canSync').at(-1)?.body.device.canSync).toBeTrue()
		expect(mountUpdates('canHome').at(-1)?.body.device.canHome).toBeTrue()
		expect(mountUpdates('canSetHome').at(-1)?.body.device.canSetHome).toBeTrue()
		expect(mountUpdates('canPark').at(-1)?.body.device.canPark).toBeTrue()
		expect(mountUpdates('canSetPark').at(-1)?.body.device.canSetPark).toBeTrue()
		expect(mountUpdates('canTracking').at(-1)?.body.device.canTracking).toBeTrue()
		expect(mountUpdates('canMove').at(-1)?.body.device.canMove).toBeTrue()
		expect(mountUpdates('hasPierSide').at(-1)?.body.device.hasPierSide).toBeTrue()
		expect(mountUpdates('slewRates').at(-1)?.body.device.slewRates).toEqual(device.slewRates)
		expect(mountUpdates('trackModes').at(-1)?.body.device.trackModes).toEqual(device.trackModes)

		mountManager.disconnect(device)

		expect(mountUpdates('connected').at(-1)?.body.device.connected).toBeFalse()
	})

	test('updates tracking, mode, slew rate, location, and time through endpoints', async () => {
		const device = getMount()
		const location = { latitude: deg(-22), longitude: deg(-45), elevation: meter(890) }
		const time = { utc: Date.UTC(2026, 4, 31, 3, 0, 0), offset: -180 }

		wsm.open(socket)
		mountManager.connect(device)
		socket.clear()

		await noContent(await endpoints['/mounts/:id/tracking'].POST(request(device.id, true)))
		await noContent(await endpoints['/mounts/:id/trackmode'].POST(request(device.id, 'SOLAR')))
		await noContent(await endpoints['/mounts/:id/slewrate'].POST(request(device.id, device.slewRates.at(-1)!.name)))
		await noContent(await endpoints['/mounts/:id/location'].POST(request(device.id, location)))
		await noContent(await endpoints['/mounts/:id/time'].POST(request(device.id, time)))

		expect(device.tracking).toBeTrue()
		expect(device.trackMode).toBe('SOLAR')
		expect(device.slewRate).toBe(device.slewRates.at(-1)!.name)
		expect(device.geographicCoordinate.latitude).toBeCloseTo(location.latitude, 6)
		expect(device.geographicCoordinate.longitude).toBeCloseTo(location.longitude, 6)
		expect(device.geographicCoordinate.elevation).toBe(location.elevation)
		expect(device.time.utc).toBe(time.utc)
		expect(device.time.offset).toBe(time.offset)
		expect(mountUpdates('tracking').at(-1)?.body.device.tracking).toBeTrue()
		expect(mountUpdates('trackMode').at(-1)?.body.device.trackMode).toBe('SOLAR')
		expect(mountUpdates('slewRate').at(-1)?.body.device.slewRate).toBe(device.slewRate)
		expect(mountUpdates('geographicCoordinate').at(-1)?.body.device.geographicCoordinate).toEqual(device.geographicCoordinate)
		expect(mountUpdates('time').at(-1)?.body.device.time).toEqual(device.time)
	})

	test('moves manually, stops, parks, unparks, and homes through endpoints', async () => {
		const device = getMount()

		wsm.open(socket)
		mountManager.connect(device)
		socket.clear()

		await noContent(await endpoints['/mounts/:id/movenorth'].POST(request(device.id, true)))

		expect(await waitUntil(() => device.slewing)).toBeTrue()
		expect(mountUpdates('slewing').at(-1)?.body.device.slewing).toBeTrue()

		await noContent(endpoints['/mounts/:id/stop'].POST(request(device.id)))

		expect(device.slewing).toBeFalse()
		expect(mountUpdates('slewing').at(-1)?.body.device.slewing).toBeFalse()

		await noContent(endpoints['/mounts/:id/park'].POST(request(device.id)))

		expect(await waitUntil(() => device.parking)).toBeTrue()
		expect(mountUpdates('parking').at(-1)?.body.device.parking).toBeTrue()
		expect(await waitUntil(() => device.parked && !device.parking, 3000)).toBeTrue()
		expect(mountUpdates('parked').at(-1)?.body.device.parked).toBeTrue()

		await noContent(endpoints['/mounts/:id/unpark'].POST(request(device.id)))

		expect(device.parked).toBeFalse()
		expect(mountUpdates('parked').at(-1)?.body.device.parked).toBeFalse()

		socket.clear()

		await noContent(endpoints['/mounts/:id/home'].POST(request(device.id)))

		expect(await waitUntil(() => device.homing)).toBeTrue()
		expect(mountUpdates('homing').at(-1)?.body.device.homing).toBeTrue()
	})

	test('computes current and target coordinate information', async () => {
		const device = getMount()

		mountManager.connect(device)
		mountManager.geographicCoordinate(device, { latitude: deg(-22), longitude: deg(-45), elevation: meter(890) })
		mountManager.syncTo(device, hour(5), deg(-30))

		const current = await json<CoordinateInfo>(endpoints['/mounts/:id/position/current'].POST(request(device.id)))
		const target = await json<CoordinateInfo>(await endpoints['/mounts/:id/position/target'].POST(request(device.id, targetCoordinate())))

		expect(current.equatorial).toHaveLength(2)
		expect(current.horizontal).toHaveLength(2)
		expect(current.constellation).toBeDefined()
		expect(target.equatorial).toHaveLength(2)
		expect(target.equatorial[0]).toBeCloseTo(hour(5), 6)
		expect(target.equatorial[1]).toBeCloseTo(deg(-30), 6)
	})

	test('confirms goto before delegating to the mount manager', async () => {
		const device = getMount()
		const moveTo = spyOn(mountManager, 'moveTo')
		const target = targetCoordinate()

		try {
			wsm.open(socket)
			mountManager.connect(device)

			await noContent(await endpoints['/mounts/:id/goto'].POST(request(device.id, target)))

			const message = socket.find((message) => message.type === 'confirmation')

			expect(message).toBeDefined()
			expect(message!.body).toEqual({ key: `mount.${device.id}.move`, message: `Are you sure you want to slew the mount '${device.name}'?` })
			expect(moveTo).not.toHaveBeenCalled()

			expect(confirmation.confirm({ key: `mount.${device.id}.move`, accepted: true })).toBeTrue()
			expect(await waitUntil(() => moveTo.mock.calls.length > 0)).toBeTrue()
			expect(moveTo).toHaveBeenCalledWith(device, 'goto', target)
		} finally {
			moveTo.mockRestore()
		}
	})

	test('delegates direct endpoints to the mount manager and remote control handler', async () => {
		const device = getMount()
		const park = spyOn(mountManager, 'park')
		const unpark = spyOn(mountManager, 'unpark')
		const home = spyOn(mountManager, 'home')
		const findHome = spyOn(mountManager, 'findHome')
		const tracking = spyOn(mountManager, 'tracking')
		const trackMode = spyOn(mountManager, 'trackMode')
		const slewRate = spyOn(mountManager, 'slewRate')
		const moveNorth = spyOn(mountManager, 'moveNorth')
		const moveSouth = spyOn(mountManager, 'moveSouth')
		const moveEast = spyOn(mountManager, 'moveEast')
		const moveWest = spyOn(mountManager, 'moveWest')
		const geographicCoordinate = spyOn(mountManager, 'geographicCoordinate')
		const time = spyOn(mountManager, 'time')
		const stop = spyOn(mountManager, 'stop')
		const status = spyOn(mountRemoteControlHandler, 'status')
		const location = { latitude: deg(1), longitude: deg(2), elevation: meter(3) }
		const utc = { utc: Date.UTC(2026, 0, 1), offset: -180 }

		try {
			await noContent(endpoints['/mounts/:id/park'].POST(request(device.id)))
			await noContent(endpoints['/mounts/:id/unpark'].POST(request(device.id)))
			await noContent(endpoints['/mounts/:id/home'].POST(request(device.id)))
			await noContent(endpoints['/mounts/:id/findhome'].POST(request(device.id)))
			await noContent(await endpoints['/mounts/:id/tracking'].POST(request(device.id, true)))
			await noContent(await endpoints['/mounts/:id/trackmode'].POST(request(device.id, 'LUNAR')))
			await noContent(await endpoints['/mounts/:id/slewrate'].POST(request(device.id, 'SPEED_1')))
			await noContent(await endpoints['/mounts/:id/movenorth'].POST(request(device.id, true)))
			await noContent(await endpoints['/mounts/:id/movesouth'].POST(request(device.id, false)))
			await noContent(await endpoints['/mounts/:id/moveeast'].POST(request(device.id, true)))
			await noContent(await endpoints['/mounts/:id/movewest'].POST(request(device.id, false)))
			await noContent(await endpoints['/mounts/:id/location'].POST(request(device.id, location)))
			await noContent(await endpoints['/mounts/:id/time'].POST(request(device.id, utc)))
			await noContent(endpoints['/mounts/:id/stop'].POST(request(device.id)))
			await json(endpoints['/mounts/:id/remotecontrol'].GET(request(device.id)))

			expect(park).toHaveBeenCalledWith(device)
			expect(unpark).toHaveBeenCalledWith(device)
			expect(home).toHaveBeenCalledWith(device)
			expect(findHome).toHaveBeenCalledWith(device)
			expect(tracking).toHaveBeenCalledWith(device, true)
			expect(trackMode).toHaveBeenCalledWith(device, 'LUNAR')
			expect(slewRate).toHaveBeenCalledWith(device, 'SPEED_1')
			expect(moveNorth).toHaveBeenCalledWith(device, true)
			expect(moveSouth).toHaveBeenCalledWith(device, false)
			expect(moveEast).toHaveBeenCalledWith(device, true)
			expect(moveWest).toHaveBeenCalledWith(device, false)
			expect(geographicCoordinate).toHaveBeenCalledWith(device, location)
			expect(time).toHaveBeenCalledWith(device, utc)
			expect(stop).toHaveBeenCalledWith(device)
			expect(status).toHaveBeenCalledWith(device)
		} finally {
			status.mockRestore()
			stop.mockRestore()
			time.mockRestore()
			geographicCoordinate.mockRestore()
			moveWest.mockRestore()
			moveEast.mockRestore()
			moveSouth.mockRestore()
			moveNorth.mockRestore()
			slewRate.mockRestore()
			trackMode.mockRestore()
			tracking.mockRestore()
			findHome.mockRestore()
			home.mockRestore()
			unpark.mockRestore()
			park.mockRestore()
		}
	})

	test('emits remove event when the simulator is disposed', () => {
		const wsm = new WebSocketMessageHandler()
		const mountManager = new MountManager()
		const mountHandler = new MountHandler(wsm, mountManager, new ConfirmationHandler(wsm), new CacheManager())
		const handler = new IndiClientHandlerSet([mountManager])
		const client = new ClientSimulator('Client Simulator', handler)
		const mountSimulator = new MountSimulator('Mount Simulator', client)
		const socket = new SocketMessager()

		wsm.open(socket)
		socket.clear()
		mountSimulator.dispose()

		const message = socket.find<MountRemoved>((message) => message.type === 'mount:remove')

		expect(message).toBeDefined()
		expect(message!.body.device.name).toBe('Mount Simulator')

		wsm.close(socket, 1000, 'done')
	})
})
