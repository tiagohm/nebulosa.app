import Elysia from 'elysia'
import { type Angle, normalizePI, PARSE_HOUR_ANGLE, parseAngle } from 'nebulosa/src/angle'
import { cirsToObserved, observedToCirs } from 'nebulosa/src/astrometry'
import { constellation } from 'nebulosa/src/constellation'
import type { EquatorialCoordinate } from 'nebulosa/src/coordinate'
import { eraC2s, eraS2c } from 'nebulosa/src/erfa'
import { fk5, precessFk5FromJ2000, precessFk5ToJ2000 } from 'nebulosa/src/fk5'
import { precessionMatrixCapitaine } from 'nebulosa/src/frame'
import { expectedPierSide, type Mount, meridianTimeIn } from 'nebulosa/src/indi.device'
import type { DeviceHandler, MountManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import { type GeographicPosition, localSiderealTime } from 'nebulosa/src/location'
import { type Lx200ProtocolHandler, Lx200ProtocolServer, type MoveDirection } from 'nebulosa/src/lx200'
import { matMulVec } from 'nebulosa/src/mat3'
import { type StellariumProtocolHandler, StellariumProtocolServer } from 'nebulosa/src/stellarium'
import { TIMEZONE, temporalAdd } from 'nebulosa/src/temporal'
import { Timescale, timeJulianYear, timeNow } from 'nebulosa/src/time'
// biome-ignore format: too long!
import type { MountAdded, MountEquatorialCoordinatePosition, MountRemoteControlProtocol, MountRemoteControlStart, MountRemoteControlStatus, MountRemoved, MountTargetCoordinate, MountUpdated } from 'src/shared/types'
import type { WebSocketMessageHandler } from './message'

export function targetCoordinatePosition(device: Mount, target: EquatorialCoordinate | MountTargetCoordinate<string | Angle> = device.equatorialCoordinate) {
	const location: GeographicPosition = { ...device.geographicCoordinate, ellipsoid: 3 }

	let rightAscension = 0
	let declination = 0
	let rightAscensionJ2000 = 0
	let declinationJ2000 = 0
	let azimuth = 0
	let altitude = 0

	const time = timeNow(true)
	time.location = location
	const lst = localSiderealTime(time, location, true)

	// JNOW equatorial coordinate
	if (!('type' in target) || target.type === 'JNOW') {
		rightAscension = typeof target.rightAscension === 'number' ? target.rightAscension : parseAngle(target.rightAscension, PARSE_HOUR_ANGLE)!
		declination = typeof target.declination === 'number' ? target.declination : parseAngle(target.declination)!

		;({ azimuth, altitude } = cirsToObserved([rightAscension, declination], time))
		;[rightAscensionJ2000, declinationJ2000] = eraC2s(...precessFk5ToJ2000(eraS2c(rightAscension, declination), time))
	}
	// J2000 equatorial coordinate
	else if (target.type === 'J2000') {
		rightAscensionJ2000 = typeof target.rightAscension === 'number' ? target.rightAscension : parseAngle(target.rightAscension, PARSE_HOUR_ANGLE)!
		declinationJ2000 = typeof target.declination === 'number' ? target.declination : parseAngle(target.declination)!

		;[rightAscension, declination] = eraC2s(...precessFk5FromJ2000(eraS2c(rightAscensionJ2000, declinationJ2000), time))
		;({ azimuth, altitude } = cirsToObserved([rightAscension, declination], time))
	}
	// Local horizontal coordinate
	else if (target.type === 'ALTAZ') {
		azimuth = typeof target.azimuth === 'number' ? target.azimuth : parseAngle(target.azimuth)!
		altitude = typeof target.altitude === 'number' ? target.altitude : parseAngle(target.altitude)!

		;[rightAscension, declination] = observedToCirs(azimuth, altitude, time)
		;[rightAscensionJ2000, declinationJ2000] = eraC2s(...precessFk5ToJ2000(eraS2c(rightAscension, declination), time))
	}

	return {
		rightAscension,
		declination,
		rightAscensionJ2000,
		declinationJ2000,
		azimuth,
		altitude,
		constellation: constellation(rightAscension, declination, time),
		lst,
		meridianIn: meridianTimeIn(rightAscension, lst),
		pierSide: expectedPierSide(rightAscension, declination, lst),
	} as MountEquatorialCoordinatePosition
}

export function mount(wsm: WebSocketMessageHandler, mountManager: MountManager) {
	function mountFromParams(clientId: string, id: string) {
		return mountManager.get(clientId, decodeURIComponent(id))!
	}

	const handler: DeviceHandler<Mount> = {
		added: (device: Mount) => {
			wsm.send<MountAdded>('mount:add', { device })
			console.info('mount added:', device.name)
		},
		updated: (device: Mount, property: keyof Mount & string, state?: PropertyState) => {
			wsm.send<MountUpdated>('mount:update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
		},
		removed: (device: Mount) => {
			wsm.send<MountRemoved>('mount:remove', { device })
			console.info('mount removed:', device.name)
		},
	}

	mountManager.addHandler(handler)

	const stellarium = new Map<Mount, StellariumProtocolServer>()
	const lx200 = new Map<Mount, Lx200ProtocolServer>()

	const J2000 = timeJulianYear(2000, Timescale.UTC)

	// TODO: needs to be updated daily?
	const now = timeNow(true)
	const nowToJ2000 = precessionMatrixCapitaine(now, J2000)
	const j2000ToNow = precessionMatrixCapitaine(J2000, now)

	function precessToJ2000(rightAscension: Angle, declination: Angle): readonly [Angle, Angle] {
		return eraC2s(...matMulVec(nowToJ2000, fk5(rightAscension, declination)))
	}

	function precessToJNow(rightAscension: Angle, declination: Angle): readonly [Angle, Angle] {
		return eraC2s(...matMulVec(j2000ToNow, fk5(rightAscension, declination)))
	}

	const disconnectHandler = (server: Lx200ProtocolServer | StellariumProtocolServer) => {
		const mount = get(server)

		if (server instanceof Lx200ProtocolServer) {
			lx200.delete(mount)
		} else if (server instanceof StellariumProtocolServer) {
			stellarium.delete(mount)
		}
	}

	const stellariumHandler: StellariumProtocolHandler = {
		disconnect: disconnectHandler,
		goto: (server, rightAscension, declination) => {
			;[rightAscension, declination] = precessToJNow(rightAscension, declination)
			mountManager.goTo(get(server), rightAscension, declination)
		},
	}

	const lx200Handler: Lx200ProtocolHandler = {
		disconnect: disconnectHandler,
		goto: (server, rightAscension, declination) => {
			;[rightAscension, declination] = precessToJNow(rightAscension, declination)
			mountManager.goTo(get(server), rightAscension, declination)
		},
		sync: (server: Lx200ProtocolServer, rightAscension: Angle, declination: Angle) => {
			;[rightAscension, declination] = precessToJNow(rightAscension, declination)
			return mountManager.syncTo(get(server), rightAscension, declination)
		},
		rightAscension: (server: Lx200ProtocolServer) => {
			const mount = get(server)
			const { rightAscension, declination } = mount.equatorialCoordinate
			return precessToJ2000(rightAscension, declination)[0]
		},
		declination: (server: Lx200ProtocolServer) => {
			const mount = get(server)
			const { rightAscension, declination } = mount.equatorialCoordinate
			return precessToJ2000(rightAscension, declination)[1]
		},
		longitude: (server: Lx200ProtocolServer, longitude?: Angle) => {
			const device = get(server)
			if (longitude !== undefined) mountManager.geographicCoordinate(device, { ...device.geographicCoordinate, longitude })
			return normalizePI(device.geographicCoordinate.longitude)
		},
		latitude: (server: Lx200ProtocolServer, latitude?: Angle) => {
			const device = get(server)
			if (latitude !== undefined) mountManager.geographicCoordinate(device, { ...device.geographicCoordinate, latitude })
			return normalizePI(device.geographicCoordinate.latitude)
		},
		dateTime: (server: Lx200ProtocolServer) => {
			return [temporalAdd(Date.now(), TIMEZONE, 'm'), TIMEZONE] as const
		},
		tracking: (server: Lx200ProtocolServer) => {
			return get(server).tracking
		},
		parked: (server: Lx200ProtocolServer) => {
			return get(server).parked
		},
		slewing: (server: Lx200ProtocolServer) => {
			return get(server).slewing
		},
		slewRate: (server: Lx200ProtocolServer, rate: 'CENTER' | 'GUIDE' | 'FIND' | 'MAX') => {
			const rates = get(server).slewRates

			if (rates.length) {
				const index = rates.length === 1 ? 0 : rate === 'GUIDE' ? 0 : rate === 'MAX' ? rates.length - 1 : rate === 'CENTER' ? 1 : Math.max(1, rates.length - 2)
				mountManager.slewRate(get(server), rates[Math.max(index, 0)])
			}
		},
		move: (server: Lx200ProtocolServer, direction: MoveDirection, enabled: boolean) => {
			if (direction === 'NORTH') mountManager.moveNorth(get(server), enabled)
			else if (direction === 'SOUTH') mountManager.moveSouth(get(server), enabled)
			else if (direction === 'EAST') mountManager.moveEast(get(server), enabled)
			else if (direction === 'WEST') mountManager.moveWest(get(server), enabled)
		},
		abort: (server: Lx200ProtocolServer) => {
			mountManager.stop(get(server))
		},
	}

	function startRemoteControl(mount: Mount, req: MountRemoteControlStart) {
		if (req.protocol === 'STELLARIUM') {
			if (!stellarium.has(mount)) {
				const server = new StellariumProtocolServer(req.host, req.port, { handler: stellariumHandler })

				if (server.start()) {
					stellarium.set(mount, server)
				}
			}
		} else if (req.protocol === 'LX200') {
			if (!lx200.has(mount)) {
				const server = new Lx200ProtocolServer(req.host, req.port, { handler: lx200Handler, name: 'Nebulosa', version: '0.2.0' })

				if (server.start()) {
					lx200.set(mount, server)
				}
			}
		}
	}

	function stopRemoteControl(mount: Mount, protocol: MountRemoteControlProtocol) {
		if (protocol === 'STELLARIUM') {
			const server = stellarium.get(mount)

			if (server) {
				server.stop()
				stellarium.delete(mount)
			}
		} else if (protocol === 'LX200') {
			const server = lx200.get(mount)

			if (server) {
				server.stop()
				lx200.delete(mount)
			}
		}
	}

	function remoteControlStatus(mount: Mount): MountRemoteControlStatus {
		const a = lx200.get(mount)
		const b = stellarium.get(mount)
		return { LX200: !!a && { host: a.host, port: a.port }, STELLARIUM: !!b && { host: b.host, port: b.port } }
	}

	function get(server: Lx200ProtocolServer | StellariumProtocolServer) {
		if (server instanceof Lx200ProtocolServer) {
			for (const [m, s] of lx200) if (s === server) return m
		} else {
			for (const [m, s] of stellarium) if (s === server) return m
		}

		throw new Error('mount not found!')
	}

	const app = new Elysia({ prefix: '/mounts' })
		// Endpoints!
		.get('', ({ query }) => Array.from(mountManager.list(query.clientId)))
		.get('/:id', ({ params, query }) => mountFromParams(query.clientId, params.id))
		.post('/:id/goto', ({ params, query, body }) => mountManager.moveTo(mountFromParams(query.clientId, params.id), 'goto', body as never))
		.post('/:id/flip', ({ params, query, body }) => mountManager.moveTo(mountFromParams(query.clientId, params.id), 'flip', body as never))
		.post('/:id/sync', ({ params, query, body }) => mountManager.moveTo(mountFromParams(query.clientId, params.id), 'sync', body as never))
		.post('/:id/park', ({ params, query }) => mountManager.park(mountFromParams(query.clientId, params.id)))
		.post('/:id/unpark', ({ params, query }) => mountManager.unpark(mountFromParams(query.clientId, params.id)))
		.post('/:id/home', ({ params, query }) => mountManager.home(mountFromParams(query.clientId, params.id)))
		.post('/:id/findhome', ({ params, query }) => mountManager.findHome(mountFromParams(query.clientId, params.id)))
		.post('/:id/tracking', ({ params, query, body }) => mountManager.tracking(mountFromParams(query.clientId, params.id), body as never))
		.post('/:id/trackmode', ({ params, query, body }) => mountManager.trackMode(mountFromParams(query.clientId, params.id), body as never))
		.post('/:id/slewrate', ({ params, query, body }) => mountManager.slewRate(mountFromParams(query.clientId, params.id), body as never))
		.post('/:id/position/current', ({ params, query }) => targetCoordinatePosition(mountFromParams(query.clientId, params.id)))
		.post('/:id/position/target', ({ params, query, body }) => targetCoordinatePosition(mountFromParams(query.clientId, params.id), body as never))
		.post('/:id/movenorth', ({ params, query, body }) => mountManager.moveNorth(mountFromParams(query.clientId, params.id), body as never))
		.post('/:id/movesouth', ({ params, query, body }) => mountManager.moveSouth(mountFromParams(query.clientId, params.id), body as never))
		.post('/:id/moveeast', ({ params, query, body }) => mountManager.moveEast(mountFromParams(query.clientId, params.id), body as never))
		.post('/:id/movewest', ({ params, query, body }) => mountManager.moveWest(mountFromParams(query.clientId, params.id), body as never))
		.post('/:id/location', ({ params, query, body }) => mountManager.geographicCoordinate(mountFromParams(query.clientId, params.id), body as never))
		.post('/:id/time', ({ params, query, body }) => mountManager.time(mountFromParams(query.clientId, params.id), body as never))
		.post('/:id/stop', ({ params, query }) => mountManager.stop(mountFromParams(query.clientId, params.id)))
		.post('/:id/remotecontrol/start', ({ params, query, body }) => startRemoteControl(mountFromParams(query.clientId, params.id), body as never))
		.post('/:id/remotecontrol/stop', ({ params, query, body }) => stopRemoteControl(mountFromParams(query.clientId, params.id), body as never))
		.get('/:id/remotecontrol', ({ params, query }) => remoteControlStatus(mountFromParams(query.clientId, params.id)))

	return app
}
