import Elysia from 'elysia'
import { type Angle, deg, PARSE_HOUR_ANGLE, parseAngle } from 'nebulosa/src/angle'
import { cirsToObserved, observedToCirs } from 'nebulosa/src/astrometry'
import { constellation } from 'nebulosa/src/constellation'
import type { EquatorialCoordinate } from 'nebulosa/src/coordinate'
import { eraC2s, eraS2c } from 'nebulosa/src/erfa'
import { fk5, precessFk5FromJ2000, precessFk5ToJ2000 } from 'nebulosa/src/fk5'
import type { IndiClient, PropertyState } from 'nebulosa/src/indi'
import type { Mount } from 'nebulosa/src/indi.device'
import type { DeviceHandler, MountManager } from 'nebulosa/src/indi.manager'
import { type GeographicPosition, localSiderealTime } from 'nebulosa/src/location'
import { type Lx200ProtocolHandler, Lx200ProtocolServer, type MoveDirection } from 'nebulosa/src/lx200'
import { type StellariumProtocolHandler, StellariumProtocolServer } from 'nebulosa/src/stellarium'
import { TIMEZONE } from 'nebulosa/src/temporal'
import { timeNow } from 'nebulosa/src/time'
// biome-ignore format: too long!
import { computeMeridianTime, expectedPierSide, type MountAdded, type MountEquatorialCoordinatePosition, type MountRemoteControlProtocol, type MountRemoteControlStart, type MountRemoteControlStatus, type MountRemoved, type MountTargetCoordinate, type MountUpdated } from 'src/shared/types'
import type { ConnectionHandler } from './connection'
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
	const lst = localSiderealTime(time)

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
		meridianIn: computeMeridianTime(rightAscension, lst),
		pierSide: expectedPierSide(rightAscension, declination, lst),
	} as MountEquatorialCoordinatePosition
}

export class MountHandler implements DeviceHandler<Mount> {
	constructor(readonly wsm: WebSocketMessageHandler) {}

	added(client: IndiClient, device: Mount) {
		this.wsm.send<MountAdded>('mount:add', { device })
		console.info('mount added:', device.name)
	}

	updated(client: IndiClient, device: Mount, property: keyof Mount, state?: PropertyState) {
		this.wsm.send<MountUpdated>('mount:update', { device: { name: device.name, [property]: device[property] }, property, state })
	}

	removed(client: IndiClient, device: Mount) {
		this.wsm.send<MountRemoved>('mount:remove', { device })
		console.info('mount removed:', device.name)
	}
}

export class MountRemoteControlHandler implements StellariumProtocolHandler, Lx200ProtocolHandler {
	private readonly stellarium = new Map<Mount, StellariumProtocolServer>()
	private readonly lx200 = new Map<Mount, Lx200ProtocolServer>()
	private readonly equatorialCoordinateJ2000 = new Map<Mount, readonly [Angle, Angle]>()

	constructor(
		readonly mount: MountManager,
		readonly connection: ConnectionHandler,
	) {}

	start(mount: Mount, req: MountRemoteControlStart) {
		if (req.protocol === 'STELLARIUM') {
			if (!this.stellarium.has(mount)) {
				const server = new StellariumProtocolServer(req.host, req.port, { handler: this })

				if (server.start()) {
					this.stellarium.set(mount, server)
				}
			}
		} else if (req.protocol === 'LX200') {
			if (!this.lx200.has(mount)) {
				const server = new Lx200ProtocolServer(req.host, req.port, { handler: this, name: 'Nebulosa', version: '0.2.0' })

				if (server.start()) {
					this.lx200.set(mount, server)
				}
			}
		}
	}

	stop(mount: Mount, protocol: MountRemoteControlProtocol) {
		if (protocol === 'STELLARIUM') {
			const server = this.stellarium.get(mount)

			if (server) {
				server.stop()
				this.stellarium.delete(mount)
			}
		} else if (protocol === 'LX200') {
			const server = this.lx200.get(mount)

			if (server) {
				server.stop()
				this.lx200.delete(mount)
			}
		}
	}

	status(mount: Mount): MountRemoteControlStatus {
		const a = this.lx200.get(mount)
		const b = this.stellarium.get(mount)
		return { LX200: !!a && { host: a.host, port: a.port }, STELLARIUM: !!b && { host: b.host, port: b.port } }
	}

	// STELLARIUM & LX200

	connect(server: Lx200ProtocolServer | StellariumProtocolServer) {}

	goto(server: Lx200ProtocolServer | StellariumProtocolServer, rightAscension: Angle, declination: Angle) {
		;[rightAscension, declination] = eraC2s(...precessFk5FromJ2000(fk5(rightAscension, declination), timeNow(true)))
		this.mount.goTo(this.connection.get(), this.get(server)!, rightAscension, declination)
	}

	sync(server: Lx200ProtocolServer, rightAscension: Angle, declination: Angle) {
		;[rightAscension, declination] = eraC2s(...precessFk5FromJ2000(fk5(rightAscension, declination), timeNow(true)))
		return this.mount.syncTo(this.connection.get(), this.get(server)!, rightAscension, declination)
	}

	disconnect(server: Lx200ProtocolServer | StellariumProtocolServer) {
		const mount = this.get(server)!

		if (server instanceof Lx200ProtocolServer) {
			this.lx200.delete(mount)
		} else if (server instanceof StellariumProtocolServer) {
			this.stellarium.delete(mount)
		}
	}

	// LX200

	// is RA called first?
	rightAscension(server: Lx200ProtocolServer) {
		const mount = this.get(server)!
		const { rightAscension, declination } = mount.equatorialCoordinate
		const coordinate = eraC2s(...precessFk5ToJ2000(fk5(rightAscension, declination), timeNow(true)))
		this.equatorialCoordinateJ2000.set(mount, coordinate)
		return coordinate[0]
	}

	declination(server: Lx200ProtocolServer) {
		const mount = this.get(server)!
		return this.equatorialCoordinateJ2000.get(mount)?.[1] ?? 0
	}

	longitude(server: Lx200ProtocolServer, longitude?: Angle) {
		const mount = this.get(server)!
		if (longitude) this.mount.geographicCoordinate(this.connection.get(), mount, { ...mount.geographicCoordinate, longitude })
		return deg(mount.geographicCoordinate.longitude)
	}

	latitude(server: Lx200ProtocolServer, latitude?: Angle) {
		const mount = this.get(server)!
		if (latitude) this.mount.geographicCoordinate(this.connection.get(), mount, { ...mount.geographicCoordinate, latitude })
		return deg(mount.geographicCoordinate.latitude)
	}

	dateTime(server: Lx200ProtocolServer) {
		return [Date.now(), TIMEZONE] as const
	}

	tracking(server: Lx200ProtocolServer) {
		return this.get(server)!.tracking
	}

	parked(server: Lx200ProtocolServer) {
		return this.get(server)!.parked
	}

	slewing(server: Lx200ProtocolServer) {
		return this.get(server)!.slewing
	}

	slewRate(server: Lx200ProtocolServer, rate: 'CENTER' | 'GUIDE' | 'FIND' | 'MAX') {
		const rates = this.get(server)!.slewRates

		if (rates.length) {
			const index = rates.length === 1 ? 0 : rate === 'GUIDE' ? 0 : rate === 'MAX' ? rates.length - 1 : rate === 'CENTER' ? 1 : Math.max(1, rates.length - 2)
			this.mount.slewRate(this.connection.get(), this.get(server)!, rates[Math.max(index, 0)])
		}
	}

	move(server: Lx200ProtocolServer, direction: MoveDirection, enabled: boolean) {
		if (direction === 'NORTH') this.mount.moveNorth(this.connection.get(), this.get(server)!, enabled)
		else if (direction === 'SOUTH') this.mount.moveSouth(this.connection.get(), this.get(server)!, enabled)
		else if (direction === 'EAST') this.mount.moveEast(this.connection.get(), this.get(server)!, enabled)
		else if (direction === 'WEST') this.mount.moveWest(this.connection.get(), this.get(server)!, enabled)
	}

	abort(server: Lx200ProtocolServer) {
		this.mount.stop(this.connection.get(), this.get(server)!)
	}

	get(server: Lx200ProtocolServer | StellariumProtocolServer) {
		if (server instanceof Lx200ProtocolServer) {
			for (const [m, s] of this.lx200) if (s === server) return m
		} else {
			for (const [m, s] of this.stellarium) if (s === server) return m
		}

		return undefined
	}
}

export function mount(mount: MountManager, remoteControl: MountRemoteControlHandler, connection: ConnectionHandler) {
	function mountFromParams(params: { id: string }) {
		return mount.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/mounts' })
		// Endpoints!
		.get('', () => mount.list())
		.get('/:id', ({ params }) => mountFromParams(params))
		.post('/:id/goto', ({ params, body }) => mount.moveTo(connection.get(), mountFromParams(params), 'goto', body as never))
		.post('/:id/flip', ({ params, body }) => mount.moveTo(connection.get(), mountFromParams(params), 'flip', body as never))
		.post('/:id/sync', ({ params, body }) => mount.moveTo(connection.get(), mountFromParams(params), 'sync', body as never))
		.post('/:id/park', ({ params }) => mount.park(connection.get(), mountFromParams(params)))
		.post('/:id/unpark', ({ params }) => mount.unpark(connection.get(), mountFromParams(params)))
		.post('/:id/home', ({ params }) => mount.home(connection.get(), mountFromParams(params)))
		.post('/:id/tracking', ({ params, body }) => mount.tracking(connection.get(), mountFromParams(params), body as never))
		.post('/:id/trackmode', ({ params, body }) => mount.trackMode(connection.get(), mountFromParams(params), body as never))
		.post('/:id/slewrate', ({ params, body }) => mount.slewRate(connection.get(), mountFromParams(params), body as never))
		.post('/:id/position/current', ({ params }) => targetCoordinatePosition(mountFromParams(params)))
		.post('/:id/position/target', ({ params, body }) => targetCoordinatePosition(mountFromParams(params), body as never))
		.post('/:id/movenorth', ({ params, body }) => mount.moveNorth(connection.get(), mountFromParams(params), body as never))
		.post('/:id/movesouth', ({ params, body }) => mount.moveSouth(connection.get(), mountFromParams(params), body as never))
		.post('/:id/moveeast', ({ params, body }) => mount.moveEast(connection.get(), mountFromParams(params), body as never))
		.post('/:id/movewest', ({ params, body }) => mount.moveWest(connection.get(), mountFromParams(params), body as never))
		.post('/:id/location', ({ params, body }) => mount.geographicCoordinate(connection.get(), mountFromParams(params), body as never))
		.post('/:id/time', ({ params, body }) => mount.time(connection.get(), mountFromParams(params), body as never))
		.post('/:id/stop', ({ params }) => mount.stop(connection.get(), mountFromParams(params)))
		.post('/:id/remotecontrol/start', ({ params, body }) => remoteControl.start(mountFromParams(params), body as never))
		.post('/:id/remotecontrol/stop', ({ params, body }) => remoteControl.stop(mountFromParams(params), body as never))
		.get('/:id/remotecontrol', ({ params }) => remoteControl.status(mountFromParams(params)))

	return app
}

function parseUTCOffset(text: string) {
	const parts = text.split(':')

	if (parts.length === 1) return +parts[0] * 60
	else return +parts[0] * 60 + +parts[1]
}
