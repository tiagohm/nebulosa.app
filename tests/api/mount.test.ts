import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { cirsToObserved } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { equatorialToEcliptic, equatorialToGalatic, equatorialToJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import { timeNow } from 'nebulosa/src/astronomy/time/time'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Mount, MountTargetCoordinate } from 'nebulosa/src/devices/indi/device'
import { MountManager } from 'nebulosa/src/devices/indi/manager'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { MountSimulator } from 'nebulosa/src/devices/indi/simulator/mount'
import { deg, hour, normalizeAngle } from 'nebulosa/src/math/units/angle'
import { meter } from 'nebulosa/src/math/units/distance'
import { ConfirmationHandler } from 'src/api/confirmation'
import { DeviceLifecycle } from 'src/api/device.lifecycle'
import { WebSocketMessageHandler } from 'src/api/message'
import { mountBus, mount as mountEndpoints, MountHandler, MountRemoteControlHandler } from 'src/api/mount'
import { MountCommander } from 'src/api/mount.commander'
import { OperationCoordinator } from 'src/api/operation'
import type { OperationResult } from 'src/api/operation'
import { resourceKey, ResourceArbiter } from 'src/api/resource'
import { coordinateInfo } from '#/mount'
import type { CoordinateInfo, MountAdded, MountRemoteControlStatus, MountRemoved, MountUpdated } from '#/mount'
import { SocketMessager } from './util'

mountBus.forceSync = true

const wsm = new WebSocketMessageHandler()
const mountManager = new MountManager()
const confirmation = new ConfirmationHandler(wsm)
const resourceArbiter = new ResourceArbiter()
const operationCoordinator = new OperationCoordinator(resourceArbiter)
const mountCommander = new MountCommander(mountManager)
const mountHandler = new MountHandler(wsm, mountManager, confirmation, mountCommander, operationCoordinator)
const mountRemoteControlHandler = new MountRemoteControlHandler(mountManager, mountCommander, operationCoordinator)
const deviceLifecycle = new DeviceLifecycle(resourceArbiter, operationCoordinator)
deviceLifecycle.observe(mountManager)
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

async function succeeded(response: Response) {
	expect(response.status).toBe(200)
	expect(await response.json()).toEqual({ ok: true })
}

function free(mount: Mount) {
	return resourceArbiter.availability(resourceKey(mount)) === 'available'
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

		await succeeded(await endpoints['/mounts/:id/tracking'].POST(request(device.id, true)))
		await succeeded(await endpoints['/mounts/:id/trackmode'].POST(request(device.id, 'SOLAR')))
		await succeeded(await endpoints['/mounts/:id/slewrate'].POST(request(device.id, device.slewRates.at(-1)!.name)))
		await succeeded(await endpoints['/mounts/:id/location'].POST(request(device.id, location)))
		await succeeded(await endpoints['/mounts/:id/time'].POST(request(device.id, time)))

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

		await succeeded(await endpoints['/mounts/:id/movenorth'].POST(request(device.id, true)))

		expect(await waitUntil(() => device.slewing)).toBeTrue()
		expect(mountUpdates('slewing').at(-1)?.body.device.slewing).toBeTrue()

		await succeeded(await endpoints['/mounts/:id/stop'].POST(request(device.id)))

		expect(device.slewing).toBeFalse()
		expect(mountUpdates('slewing').at(-1)?.body.device.slewing).toBeFalse()
		expect(await waitUntil(() => free(device))).toBeTrue()

		await noContent(endpoints['/mounts/:id/park'].POST(request(device.id)))

		expect(await waitUntil(() => device.parking)).toBeTrue()
		expect(mountUpdates('parking').at(-1)?.body.device.parking).toBeTrue()
		expect(await waitUntil(() => device.parked && !device.parking, 3000)).toBeTrue()
		expect(mountUpdates('parked').at(-1)?.body.device.parked).toBeTrue()
		expect(await waitUntil(() => free(device))).toBeTrue()

		await noContent(endpoints['/mounts/:id/unpark'].POST(request(device.id)))

		expect(await waitUntil(() => !device.parked)).toBeTrue()
		expect(mountUpdates('parked').at(-1)?.body.device.parked).toBeFalse()
		expect(await waitUntil(() => free(device))).toBeTrue()

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

	test('confirms goto before commanding the mount', async () => {
		const device = getMount()
		const goTo = spyOn(mountManager, 'goTo')
		const target = targetCoordinate()

		try {
			wsm.open(socket)
			mountManager.connect(device)

			await noContent(await endpoints['/mounts/:id/goto'].POST(request(device.id, target)))

			const message = socket.find((message) => message.type === 'confirmation')

			expect(message).toBeDefined()
			expect(message!.body).toEqual({ key: `mount.${device.id}.move`, message: `Are you sure you want to slew the mount '${device.name}'?` })
			expect(goTo).not.toHaveBeenCalled()

			confirmation.confirm({ key: `mount.${device.id}.move`, accepted: true })
			expect(await waitUntil(() => goTo.mock.calls.length > 0)).toBeTrue()
			expect(goTo).toHaveBeenCalledWith(device, hour(5), deg(-30))

			await endpoints['/mounts/:id/stop'].POST(request(device.id))
		} finally {
			goTo.mockRestore()
		}
	})

	test('refuses coordinated commands while the mount is disconnected', async () => {
		const device = getMount()
		const tracking = spyOn(mountManager, 'tracking')
		const moveNorth = spyOn(mountManager, 'moveNorth')

		try {
			const trackingResult = await json<OperationResult<void>>(await endpoints['/mounts/:id/tracking'].POST(request(device.id, true)))
			const moveResult = await json<OperationResult<void>>(await endpoints['/mounts/:id/movenorth'].POST(request(device.id, true)))
			const stopResult = await json<OperationResult<void>>(await endpoints['/mounts/:id/stop'].POST(request(device.id)))

			expect(trackingResult).toMatchObject({ ok: false, reason: 'busy' })
			expect(moveResult).toMatchObject({ ok: false, reason: 'disconnected' })
			expect(stopResult).toMatchObject({ ok: false, reason: 'disconnected' })
			expect(tracking).not.toHaveBeenCalled()
			expect(moveNorth).not.toHaveBeenCalled()
		} finally {
			moveNorth.mockRestore()
			tracking.mockRestore()
		}
	})

	test('reports remote control status through endpoints', async () => {
		const device = getMount()
		const status = await json<MountRemoteControlStatus>(endpoints['/mounts/:id/remotecontrol'].GET(request(device.id)))

		expect(status).toEqual({ lx200: false, stellarium: false })
	})

	test('treats Stellarium goto coordinates as JNOW', async () => {
		const device = getMount()
		const rightAscension = hour(5)
		const declination = deg(-30)
		const goTo = spyOn(mountCommander, 'goTo').mockResolvedValue({ ok: true, value: { rightAscension, declination, pierSide: 'NEITHER' } })
		const message = Buffer.alloc(20)
		message.writeUInt32LE(Math.trunc((rightAscension / Math.PI) * 0x80000000), 12)
		message.writeInt32LE(Math.trunc((declination / Math.PI) * 0x80000000), 16)

		try {
			mountRemoteControlHandler.start(device, { protocol: 'stellarium', host: '127.0.0.1', port: 0 })
			const status = mountRemoteControlHandler.status(device)
			expect(status.stellarium).not.toBeFalse()

			const client = await Bun.connect({
				hostname: '127.0.0.1',
				port: status.stellarium ? status.stellarium.port : 0,
				socket: { data() {} },
			})
			client.write(message)
			client.flush()

			expect(await waitUntil(() => goTo.mock.calls.length > 0)).toBeTrue()
			const target = goTo.mock.calls[0][2]
			expect(target.type).toBe('JNOW')
			expect(target.JNOW?.x).toBeCloseTo(rightAscension, 8)
			expect(target.JNOW?.y).toBeCloseTo(declination, 8)
			client.end()
		} finally {
			mountRemoteControlHandler.stop(device, 'stellarium')
			goTo.mockRestore()
		}
	})

	test('emits remove event when the simulator is disposed', () => {
		const wsm = new WebSocketMessageHandler()
		const mountManager = new MountManager()
		const coordinator = new OperationCoordinator(new ResourceArbiter())
		const mountHandler = new MountHandler(wsm, mountManager, new ConfirmationHandler(wsm), new MountCommander(mountManager), coordinator)
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

describe('mount commander', () => {
	function connected() {
		const device = getMount()
		mountManager.connect(device)
		expect(device.connected).toBeTrue()
		mountManager.syncTo(device, hour(5), deg(-30))
		return device
	}

	test('slews to a target and reports where the mount stopped', async () => {
		const device = connected()
		const result = await mountCommander.goTo(operationCoordinator, device, { type: 'JNOW', JNOW: { x: '05:00:00', y: '-28:00:00' } })

		expect(result.ok).toBeTrue()

		if (result.ok) {
			expect(result.value.rightAscension).toBeCloseTo(hour(5), 3)
			expect(result.value.declination).toBeCloseTo(deg(-28), 3)
		}

		expect(device.slewing).toBeFalse()
		expect(await waitUntil(() => free(device))).toBeTrue()
	}, 10000)

	test('completes immediately when the mount already points at the target', async () => {
		const device = connected()
		const goTo = spyOn(mountManager, 'goTo')

		try {
			const result = await mountCommander.goTo(operationCoordinator, device, { type: 'JNOW', JNOW: { x: '05:00:00', y: '-30:00:00' } })

			expect(result.ok).toBeTrue()
			expect(goTo).toHaveBeenCalledTimes(1)
			expect(device.slewing).toBeFalse()
		} finally {
			goTo.mockRestore()
		}
	}, 10000)

	test('stopping by device cancels the slew and leaves the mount stopped', async () => {
		const device = connected()
		const slewing = mountCommander.goTo(operationCoordinator, device, { type: 'JNOW', JNOW: { x: '05:00:00', y: '30:00:00' } })

		expect(await waitUntil(() => device.slewing)).toBeTrue()

		const stopped = await mountHandler.stop(device)

		expect(stopped).toMatchObject({ ok: true })
		expect(await slewing).toMatchObject({ ok: false, reason: 'aborted' })
		expect(device.slewing).toBeFalse()
		expect(await waitUntil(() => free(device))).toBeTrue()
	}, 10000)

	test('refuses a second command while another operation owns the mount', async () => {
		const device = connected()
		const slewing = mountCommander.goTo(operationCoordinator, device, { type: 'JNOW', JNOW: { x: '05:00:00', y: '30:00:00' } })

		expect(await waitUntil(() => device.slewing)).toBeTrue()
		expect(await mountCommander.setTracking(operationCoordinator, device, true)).toMatchObject({ ok: false, reason: 'busy' })

		await mountHandler.stop(device)
		await slewing
	}, 10000)

	test('holds the mount through a manual move until every axis is stopped', async () => {
		const device = connected()
		const started = await mountCommander.startManualMove(operationCoordinator, device, 'NORTH')

		expect(started.ok).toBeTrue()

		if (!started.ok) return

		const handle = started.value

		expect(await waitUntil(() => device.slewing)).toBeTrue()
		expect(handle.directions()).toEqual(['NORTH'])
		expect(await mountCommander.goTo(operationCoordinator, device, targetCoordinate())).toMatchObject({ ok: false, reason: 'busy' })

		const joined = await mountCommander.startManualMove(operationCoordinator, device, 'WEST')

		expect(joined).toMatchObject({ ok: true })
		expect(handle.directions()).toEqual(['NORTH', 'WEST'])
		expect(await handle.move('NORTH', false)).toMatchObject({ ok: true })
		expect(handle.directions()).toEqual(['WEST'])
		expect(device.slewing).toBeTrue()
		expect(await handle.stop()).toMatchObject({ ok: true })
		expect(device.slewing).toBeFalse()
		expect(mountCommander.manualMoveOf(device)).toBeUndefined()
		expect(await waitUntil(() => free(device))).toBeTrue()
	}, 10000)

	test('waits for tracking to be observed before completing', async () => {
		const device = connected()

		expect(device.tracking).toBeFalse()
		expect(await mountCommander.setTracking(operationCoordinator, device, true)).toMatchObject({ ok: true })
		expect(device.tracking).toBeTrue()
	}, 10000)

	test('reports a flip the driver cannot perform', async () => {
		const device = connected()

		expect(device.canFlip).toBeFalse()
		expect(await mountCommander.flip(operationCoordinator, device, targetCoordinate())).toMatchObject({ ok: false, reason: 'unexpectedState' })
	}, 10000)
})

test('coordinateInfo computes correctly all the coordinates passing the flag', () => {
	const time = timeNow(true)
	time.location = { latitude: 0, longitude: 0, elevation: 0, ellipsoid: 3 }
	const lst = localSiderealTime(time, undefined, true)
	const equatorial = [lst, deg(-30)] as const
	const equatorialJ2000 = equatorialToJ2000(...equatorial, time)
	const galactic = equatorialToGalatic(...equatorialJ2000)
	const ecliptic = equatorialToEcliptic(...equatorial, time)
	const observed = cirsToObserved(equatorial, time)
	const horizontal = [observed.azimuth, observed.altitude] as const

	equatorialJ2000[0] = normalizeAngle(equatorialJ2000[0])

	const flags = [
		[{ equatorial: true }, equatorial, 'JNOW'],
		[{ equatorialJ2000: true }, equatorialJ2000, 'J2000'],
		[{ horizontal: true }, horizontal, 'ALTAZ'],
		[{ ecliptic: true }, ecliptic, 'ECLIPTIC'],
		[{ galactic: true }, galactic, 'GALACTIC'],
	] as const

	for (const [, coordinate, type] of flags) {
		const target = { type, [type]: { x: coordinate[0], y: coordinate[1] } } as const

		for (const [flag] of flags) {
			const info = coordinateInfo(time, 0, target, flag)

			if ('equatorial' in flag) {
				expect(info.equatorial[0]).toBeCloseTo(equatorial[0], 11)
				expect(info.equatorial[1]).toBeCloseTo(equatorial[1], 11)
			} else if ('equatorialJ2000' in flag) {
				expect(info.equatorialJ2000[0]).toBeCloseTo(equatorialJ2000[0], 11)
				expect(info.equatorialJ2000[1]).toBeCloseTo(equatorialJ2000[1], 11)
			} else if ('horizontal' in flag) {
				expect(info.horizontal[0]).toBeCloseTo(horizontal[0], 11)
				expect(info.horizontal[1]).toBeCloseTo(horizontal[1], 11)
			} else if ('ecliptic' in flag) {
				expect(info.ecliptic[0]).toBeCloseTo(ecliptic[0], 11)
				expect(info.ecliptic[1]).toBeCloseTo(ecliptic[1], 11)
			} else if ('galactic' in flag) {
				expect(info.galactic[0]).toBeCloseTo(galactic[0], 11)
				expect(info.galactic[1]).toBeCloseTo(galactic[1], 11)
			}
		}
	}
})
