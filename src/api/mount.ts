import { type Angle, normalizePI } from 'nebulosa/src/angle'
import { eraC2s } from 'nebulosa/src/erfa'
import { fk5 } from 'nebulosa/src/fk5'
import { precessionMatrixCapitaine } from 'nebulosa/src/frame'
import type { IndiClient } from 'nebulosa/src/indi.client'
import type { Mount, MountTargetCoordinate } from 'nebulosa/src/indi.device'
import type { DeviceHandler, MountManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import { type Lx200ProtocolHandler, Lx200ProtocolServer, type MoveDirection } from 'nebulosa/src/lx200'
import { matMulVec, matTranspose } from 'nebulosa/src/mat3'
import { type StellariumProtocolHandler, StellariumProtocolServer } from 'nebulosa/src/stellarium'
import { TIMEZONE, temporalAdd } from 'nebulosa/src/temporal'
import { Timescale, timeJulianYear, timeNow } from 'nebulosa/src/time'
// biome-ignore format: too long!
import { DEFAULT_COORDINATE_INFO, type MountAdded, type MountRemoteControlProtocol, type MountRemoteControlStart, type MountRemoteControlStatus, type MountRemoved, type MountUpdated } from 'src/shared/types'
import { coordinateInfo } from 'src/shared/util'
import type { CacheManager } from './cache'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'

const J2000 = timeJulianYear(2000, Timescale.UTC)
const JNOW = timeNow(true)
const NOW_TO_J2000 = precessionMatrixCapitaine(JNOW, J2000)
const J2000_TO_NOW = matTranspose(NOW_TO_J2000)

function precessToJ2000(rightAscension: Angle, declination: Angle) {
	return eraC2s(...matMulVec(NOW_TO_J2000, fk5(rightAscension, declination)))
}

function precessToJNow(rightAscension: Angle, declination: Angle) {
	return eraC2s(...matMulVec(J2000_TO_NOW, fk5(rightAscension, declination)))
}

export class MountHandler implements DeviceHandler<Mount> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly mountManager: MountManager,
		readonly cache: CacheManager,
	) {
		mountManager.addHandler(this)
	}

	added(device: Mount) {
		this.wsm.send<MountAdded>('mount:add', { device })
		console.info('mount added:', device.name)
	}

	updated(device: Mount, property: keyof Mount & string, state?: PropertyState) {
		this.wsm.send<MountUpdated>('mount:update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	removed(device: Mount) {
		this.wsm.send<MountRemoved>('mount:remove', { device })
		console.info('mount removed:', device.name)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.mountManager.list(client))
	}

	currentPosition(mount: Mount) {
		if (!mount) return DEFAULT_COORDINATE_INFO
		return coordinateInfo(this.cache.time('now', this.cache.geographicCoordinate(mount.geographicCoordinate), 'm'), mount.geographicCoordinate.longitude, mount.equatorialCoordinate)
	}

	targetPosition(mount: Mount, coordinate: MountTargetCoordinate<string | Angle>) {
		if (!mount) return DEFAULT_COORDINATE_INFO
		return coordinateInfo(this.cache.time('now', this.cache.geographicCoordinate(mount.geographicCoordinate), 'm'), mount.geographicCoordinate.longitude, coordinate)
	}
}

export class MountRemoteControlHandler {
	private readonly stellarium = new Map<Mount, StellariumProtocolServer>()
	private readonly lx200 = new Map<Mount, Lx200ProtocolServer>()

	constructor(readonly mountManager: MountManager) {}

	private readonly disconnectHandler = (server: Lx200ProtocolServer | StellariumProtocolServer) => {
		const mount = this.get(server)

		if (server instanceof Lx200ProtocolServer) {
			this.lx200.delete(mount)
		} else if (server instanceof StellariumProtocolServer) {
			this.stellarium.delete(mount)
		}
	}

	private readonly stellariumHandler: StellariumProtocolHandler = {
		disconnect: this.disconnectHandler,
		goto: (server, rightAscension, declination) => {
			;[rightAscension, declination] = precessToJNow(rightAscension, declination)
			this.mountManager.goTo(this.get(server), rightAscension, declination)
		},
	}

	private readonly lx200Handler: Lx200ProtocolHandler = {
		disconnect: this.disconnectHandler,
		goto: (server, rightAscension, declination) => {
			;[rightAscension, declination] = precessToJNow(rightAscension, declination)
			this.mountManager.goTo(this.get(server), rightAscension, declination)
		},
		sync: (server: Lx200ProtocolServer, rightAscension: Angle, declination: Angle) => {
			;[rightAscension, declination] = precessToJNow(rightAscension, declination)
			return this.mountManager.syncTo(this.get(server), rightAscension, declination)
		},
		rightAscension: (server: Lx200ProtocolServer) => {
			const mount = this.get(server)
			const { rightAscension, declination } = mount.equatorialCoordinate
			return precessToJ2000(rightAscension, declination)[0]
		},
		declination: (server: Lx200ProtocolServer) => {
			const mount = this.get(server)
			const { rightAscension, declination } = mount.equatorialCoordinate
			return precessToJ2000(rightAscension, declination)[1]
		},
		longitude: (server: Lx200ProtocolServer, longitude?: Angle) => {
			const device = this.get(server)
			if (longitude !== undefined) this.mountManager.geographicCoordinate(device, { ...device.geographicCoordinate, longitude })
			return normalizePI(device.geographicCoordinate.longitude)
		},
		latitude: (server: Lx200ProtocolServer, latitude?: Angle) => {
			const device = this.get(server)
			if (latitude !== undefined) this.mountManager.geographicCoordinate(device, { ...device.geographicCoordinate, latitude })
			return normalizePI(device.geographicCoordinate.latitude)
		},
		dateTime: (server: Lx200ProtocolServer) => {
			return [temporalAdd(Date.now(), TIMEZONE, 'm'), TIMEZONE] as const
		},
		tracking: (server: Lx200ProtocolServer) => {
			return this.get(server).tracking
		},
		parked: (server: Lx200ProtocolServer) => {
			return this.get(server).parked
		},
		slewing: (server: Lx200ProtocolServer) => {
			return this.get(server).slewing
		},
		slewRate: (server: Lx200ProtocolServer, rate: 'CENTER' | 'GUIDE' | 'FIND' | 'MAX') => {
			const rates = this.get(server).slewRates

			if (rates.length) {
				const index = rates.length === 1 ? 0 : rate === 'GUIDE' ? 0 : rate === 'MAX' ? rates.length - 1 : rate === 'CENTER' ? 1 : Math.max(1, rates.length - 2)
				this.mountManager.slewRate(this.get(server), rates[Math.max(index, 0)])
			}
		},
		move: (server: Lx200ProtocolServer, direction: MoveDirection, enabled: boolean) => {
			if (direction === 'NORTH') this.mountManager.moveNorth(this.get(server), enabled)
			else if (direction === 'SOUTH') this.mountManager.moveSouth(this.get(server), enabled)
			else if (direction === 'EAST') this.mountManager.moveEast(this.get(server), enabled)
			else if (direction === 'WEST') this.mountManager.moveWest(this.get(server), enabled)
		},
		abort: (server: Lx200ProtocolServer) => {
			this.mountManager.stop(this.get(server))
		},
	}

	start(mount: Mount, req: MountRemoteControlStart) {
		if (req.protocol === 'STELLARIUM') {
			if (!this.stellarium.has(mount)) {
				const server = new StellariumProtocolServer(req.host, req.port, { handler: this.stellariumHandler })

				if (server.start()) {
					this.stellarium.set(mount, server)
				}
			}
		} else if (req.protocol === 'LX200') {
			if (!this.lx200.has(mount)) {
				const server = new Lx200ProtocolServer(req.host, req.port, { handler: this.lx200Handler, name: 'Nebulosa', version: '0.2.0' })

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

	private get(server: Lx200ProtocolServer | StellariumProtocolServer) {
		if (server instanceof Lx200ProtocolServer) {
			for (const [m, s] of this.lx200) if (s === server) return m
		} else {
			for (const [m, s] of this.stellarium) if (s === server) return m
		}

		throw new Error('mount not found!')
	}
}

export function mount(mountHandler: MountHandler, mountRemoteControlHandler: MountRemoteControlHandler): Endpoints {
	const { mountManager } = mountHandler

	function mountFromParams(req: Bun.BunRequest<string>) {
		return mountManager.get(query(req).get('client'), req.params.id)!
	}

	return {
		'/mounts': { GET: (req) => response(mountHandler.list(query(req).get('client'))) },
		'/mounts/:id': { GET: (req) => response(mountFromParams(req)) },
		'/mounts/:id/goto': { POST: async (req) => response(mountManager.moveTo(mountFromParams(req), 'goto', await req.json())) },
		'/mounts/:id/flip': { POST: async (req) => response(mountManager.moveTo(mountFromParams(req), 'flip', await req.json())) },
		'/mounts/:id/sync': { POST: async (req) => response(mountManager.moveTo(mountFromParams(req), 'sync', await req.json())) },
		'/mounts/:id/park': { POST: (req) => response(mountManager.park(mountFromParams(req))) },
		'/mounts/:id/unpark': { POST: (req) => response(mountManager.unpark(mountFromParams(req))) },
		'/mounts/:id/home': { POST: (req) => response(mountManager.home(mountFromParams(req))) },
		'/mounts/:id/findhome': { POST: (req) => response(mountManager.findHome(mountFromParams(req))) },
		'/mounts/:id/tracking': { POST: async (req) => response(mountManager.tracking(mountFromParams(req), await req.json())) },
		'/mounts/:id/trackmode': { POST: async (req) => response(mountManager.trackMode(mountFromParams(req), await req.json())) },
		'/mounts/:id/slewrate': { POST: async (req) => response(mountManager.slewRate(mountFromParams(req), await req.json())) },
		'/mounts/:id/position/current': { POST: (req) => response(mountHandler.currentPosition(mountFromParams(req))) },
		'/mounts/:id/position/target': { POST: async (req) => response(mountHandler.targetPosition(mountFromParams(req), await req.json())) },
		'/mounts/:id/movenorth': { POST: async (req) => response(mountManager.moveNorth(mountFromParams(req), await req.json())) },
		'/mounts/:id/movesouth': { POST: async (req) => response(mountManager.moveSouth(mountFromParams(req), await req.json())) },
		'/mounts/:id/moveeast': { POST: async (req) => response(mountManager.moveEast(mountFromParams(req), await req.json())) },
		'/mounts/:id/movewest': { POST: async (req) => response(mountManager.moveWest(mountFromParams(req), await req.json())) },
		'/mounts/:id/location': { POST: async (req) => response(mountManager.geographicCoordinate(mountFromParams(req), await req.json())) },
		'/mounts/:id/time': { POST: async (req) => response(mountManager.time(mountFromParams(req), await req.json())) },
		'/mounts/:id/stop': { POST: (req) => response(mountManager.stop(mountFromParams(req))) },
		'/mounts/:id/remotecontrol/start': { POST: async (req) => response(mountRemoteControlHandler.start(mountFromParams(req), await req.json())) },
		'/mounts/:id/remotecontrol/stop': { POST: async (req) => response(mountRemoteControlHandler.stop(mountFromParams(req), await req.json())) },
		'/mounts/:id/remotecontrol': { GET: (req) => response(mountRemoteControlHandler.status(mountFromParams(req))) },
	}
}
