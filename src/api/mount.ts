import Elysia from 'elysia'
import { type Angle, deg, formatHMS, hour, normalizeAngle, parseAngle, toDeg, toHour } from 'nebulosa/src/angle'
import { cirsToObserved, observedToCirs } from 'nebulosa/src/astrometry'
import { PI, TAU } from 'nebulosa/src/constants'
import { constellation } from 'nebulosa/src/constellation'
import { meter, toMeter } from 'nebulosa/src/distance'
import { eraC2s, eraS2c } from 'nebulosa/src/erfa'
import { fk5, precessFk5FromJ2000, precessFk5ToJ2000 } from 'nebulosa/src/fk5'
import type { DefNumberVector, DefSwitch, DefSwitchVector, DefTextVector, DelProperty, IndiClient, IndiClientHandler, PropertyState, SetNumberVector, SetSwitchVector, SetTextVector } from 'nebulosa/src/indi'
import { type GeographicPosition, localSiderealTime } from 'nebulosa/src/location'
import { type Lx200ProtocolHandler, Lx200ProtocolServer, type MoveDirection } from 'nebulosa/src/lx200'
import { type StellariumProtocolHandler, StellariumProtocolServer } from 'nebulosa/src/stellarium'
import { formatTemporal, parseTemporal, temporalUnix } from 'nebulosa/src/temporal'
import { timeNow } from 'nebulosa/src/time'
import bus from 'src/shared/bus'
// biome-ignore format: too long!
import { DEFAULT_MOUNT, type EquatorialCoordinate, expectedPierSide, type GeographicCoordinate, type GPS, type Mount, type MountAdded, type MountEquatorialCoordinatePosition, type MountRemoteControlProtocol, type MountRemoteControlStart, type MountRemoteControlStatus, type MountRemoved, type MountTargetCoordinate, type MountUpdated, type SlewRate, type TrackMode } from 'src/shared/types'
import type { CacheManager } from './cache'
import type { ConnectionManager } from './connection'
import type { GuideOutputManager } from './guideoutput'
import { ask, connectionFor, DeviceInterfaceType, isInterfaceType } from './indi'
import type { WebSocketMessageManager } from './message'

export function tracking(client: IndiClient, mount: Mount, enable: boolean) {
	client.sendSwitch({ device: mount.name, name: 'TELESCOPE_TRACK_STATE', elements: { [enable ? 'TRACK_ON' : 'TRACK_OFF']: true } })
}

export function park(client: IndiClient, mount: Mount) {
	if (mount.canPark) {
		client.sendSwitch({ device: mount.name, name: 'TELESCOPE_PARK', elements: { PARK: true } })
	}
}

export function unpark(client: IndiClient, mount: Mount) {
	if (mount.canPark) {
		client.sendSwitch({ device: mount.name, name: 'TELESCOPE_PARK', elements: { UNPARK: true } })
	}
}

export function stop(client: IndiClient, mount: Mount) {
	if (mount.canAbort) {
		client.sendSwitch({ device: mount.name, name: 'TELESCOPE_ABORT_MOTION', elements: { ABORT: true } })
	}
}

export function home(client: IndiClient, mount: Mount) {
	if (mount.canHome) {
		client.sendSwitch({ device: mount.name, name: 'TELESCOPE_HOME', elements: { GO: true } })
	}
}

export function equatorialCoordinate(client: IndiClient, mount: Mount, rightAscension: Angle, declination: Angle) {
	client.sendNumber({ device: mount.name, name: 'EQUATORIAL_EOD_COORD', elements: { RA: toHour(normalizeAngle(rightAscension)), DEC: toDeg(declination) } })
}

export function geographicCoordinate(client: IndiClient, mount: Mount, { latitude, longitude, elevation }: GeographicCoordinate) {
	longitude = longitude < 0 ? longitude + TAU : longitude
	client.sendNumber({ device: mount.name, name: 'GEOGRAPHIC_COORD', elements: { LAT: toDeg(latitude), LONG: toDeg(longitude), ELEV: toMeter(elevation) } })
}

export function time(client: IndiClient, mount: Mount, time: GPS['time']) {
	const UTC = formatTemporal(time.utc, 'YYYY-MM-DDTHH:mm:ss')
	const OFFSET = (time.offset / 60).toString()
	client.sendText({ device: mount.name, name: 'TIME_UTC', elements: { UTC, OFFSET } })
}

export function syncTo(client: IndiClient, mount: Mount, rightAscension: Angle, declination: Angle) {
	if (mount.canSync) {
		client.sendSwitch({ device: mount.name, name: 'ON_COORD_SET', elements: { SYNC: true } })
		equatorialCoordinate(client, mount, rightAscension, declination)
	}
}

export function goTo(client: IndiClient, mount: Mount, rightAscension: Angle, declination: Angle) {
	if (mount.canGoTo) {
		client.sendSwitch({ device: mount.name, name: 'ON_COORD_SET', elements: { TRACK: true } })
		equatorialCoordinate(client, mount, rightAscension, declination)
	}
}

export function slewTo(client: IndiClient, mount: Mount, rightAscension: Angle, declination: Angle) {
	if (mount.canSlew) {
		client.sendSwitch({ device: mount.name, name: 'ON_COORD_SET', elements: { SLEW: true } })
		equatorialCoordinate(client, mount, rightAscension, declination)
	}
}

export function trackMode(client: IndiClient, mount: Mount, mode: TrackMode) {
	client.sendSwitch({ device: mount.name, name: 'TELESCOPE_TRACK_MODE', elements: { [`TRACK_${mode}`]: true } })
}

export function slewRate(client: IndiClient, mount: Mount, rate: SlewRate | string) {
	client.sendSwitch({ device: mount.name, name: 'TELESCOPE_SLEW_RATE', elements: { [typeof rate === 'string' ? rate : rate.name]: true } })
}

export function moveNorth(client: IndiClient, mount: Mount, enable: boolean) {
	if (enable) client.sendSwitch({ device: mount.name, name: 'TELESCOPE_MOTION_NS', elements: { MOTION_NORTH: true, MOTION_SOUTH: false } })
	else client.sendSwitch({ device: mount.name, name: 'TELESCOPE_MOTION_NS', elements: { MOTION_NORTH: false } })
}

export function moveSouth(client: IndiClient, mount: Mount, enable: boolean) {
	if (enable) client.sendSwitch({ device: mount.name, name: 'TELESCOPE_MOTION_NS', elements: { MOTION_NORTH: false, MOTION_SOUTH: true } })
	else client.sendSwitch({ device: mount.name, name: 'TELESCOPE_MOTION_NS', elements: { MOTION_SOUTH: false } })
}

export function moveWest(client: IndiClient, mount: Mount, enable: boolean) {
	if (enable) client.sendSwitch({ device: mount.name, name: 'TELESCOPE_MOTION_WE', elements: { MOTION_WEST: true, MOTION_EAST: false } })
	else client.sendSwitch({ device: mount.name, name: 'TELESCOPE_MOTION_WE', elements: { MOTION_WEST: false } })
}

export function moveEast(client: IndiClient, mount: Mount, enable: boolean) {
	if (enable) client.sendSwitch({ device: mount.name, name: 'TELESCOPE_MOTION_WE', elements: { MOTION_WEST: false, MOTION_EAST: true } })
	else client.sendSwitch({ device: mount.name, name: 'TELESCOPE_MOTION_WE', elements: { MOTION_EAST: false } })
}

export class MountManager implements IndiClientHandler {
	private readonly mounts = new Map<string, Mount>()

	constructor(
		readonly wsm: WebSocketMessageManager,
		readonly guideOutput: GuideOutputManager,
		readonly cache: CacheManager,
	) {
		bus.subscribe('indi:close', (client: IndiClient) => {
			// Remove all mounts associated with the client
			this.mounts.forEach((device) => this.remove(device))
		})
	}

	switchVector(client: IndiClient, message: DefSwitchVector | SetSwitchVector, tag: string) {
		const device = this.mounts.get(message.device)

		if (!device) return

		switch (message.name) {
			case 'CONNECTION':
				if (connectionFor(client, device, message)) {
					if (this.guideOutput.has(device)) {
						this.guideOutput.update(device, 'connected', message.state)
					} else {
						this.update(device, 'connected', message.state)
					}

					if (!device.connected) {
						this.guideOutput.remove(device)
					}
				}

				return
			case 'TELESCOPE_SLEW_RATE':
				if (tag[0] === 'd') {
					const rates: SlewRate[] = []

					for (const key in message.elements) {
						const element = message.elements[key] as DefSwitch
						rates.push({ name: element.name, label: element.label! })
					}

					if (rates.length) {
						device.slewRates = rates
						this.update(device, 'slewRates', message.state)
					}
				}

				for (const key in message.elements) {
					const element = message.elements[key]!

					if (element.value) {
						if (device.slewRate !== element.name) {
							device.slewRate = element.name
							this.update(device, 'slewRate', message.state)
						}

						break
					}
				}

				return
			case 'TELESCOPE_TRACK_MODE':
				if (tag[0] === 'd') {
					const modes: TrackMode[] = []

					for (const key in message.elements) {
						const element = message.elements[key] as DefSwitch
						modes.push(element.name.replace('TRACK_', '') as TrackMode)
					}

					if (modes.length) {
						device.trackModes = modes
						this.update(device, 'trackModes', message.state)
					}
				}

				for (const key in message.elements) {
					const element = message.elements[key]!

					if (element.value) {
						const trackMode = element.name.replace('TRACK_', '') as TrackMode

						if (device.trackMode !== trackMode) {
							device.trackMode = trackMode
							this.update(device, 'trackMode', message.state)
						}

						break
					}
				}

				return
			case 'TELESCOPE_TRACK_STATE': {
				const tracking = message.elements.TRACK_ON?.value === true

				if (device.tracking !== tracking) {
					device.tracking = tracking
					this.update(device, 'tracking', message.state)
				}

				return
			}
			case 'TELESCOPE_PIER_SIDE': {
				const pierSide = message.elements.PIER_WEST?.value === true ? 'WEST' : message.elements.PIER_EAST?.value === true ? 'EAST' : 'NEITHER'

				if (device.pierSide !== pierSide) {
					device.pierSide = pierSide
					this.update(device, 'pierSide', message.state)
				}

				return
			}
			case 'TELESCOPE_PARK': {
				if (tag[0] === 'd') {
					const canPark = (message as DefSwitchVector).permission !== 'ro'

					if (device.canPark !== canPark) {
						device.canPark = canPark
						this.update(device, 'canPark', message.state)
					}
				}

				if (message.state) {
					const parking = message.state === 'Busy'

					if (device.parking !== parking) {
						device.parking = parking
						this.update(device, 'parking', message.state)
					}
				}

				const parked = message.elements.PARK?.value === true

				if (device.parked !== parked) {
					device.parked = parked
					this.update(device, 'parked', message.state)
				}

				return
			}
			case 'TELESCOPE_ABORT_MOTION':
				if (!device.canAbort) {
					device.canAbort = true
					this.update(device, 'canAbort', message.state)
				}

				return
			case 'TELESCOPE_HOME':
				if (!device.canHome) {
					device.canHome = true
					this.update(device, 'canHome', message.state)
				}

				return
			case 'ON_COORD_SET':
				if (tag[0] === 'd') {
					const canSync = 'SYNC' in message.elements

					if (device.canSync !== canSync) {
						device.canSync = canSync
						this.update(device, 'canSync', message.state)
					}

					const canGoTo = 'TRACK' in message.elements

					if (device.canGoTo !== canGoTo) {
						device.canGoTo = canGoTo
						this.update(device, 'canGoTo', message.state)
					}

					const canSlew = 'SLEW' in message.elements

					if (device.canSlew !== canSlew) {
						device.canSlew = canSlew
						this.update(device, 'canSlew', message.state)
					}
				}

				return
		}
	}

	numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		const device = this.mounts.get(message.device)

		if (!device) return

		switch (message.name) {
			case 'EQUATORIAL_EOD_COORD': {
				const slewing = message.state === 'Busy'

				if (device.slewing !== slewing) {
					device.slewing = slewing
					this.update(device, 'slewing', message.state)
				}

				const rightAscension = hour(message.elements.RA!.value)
				const declination = deg(message.elements.DEC!.value)
				let updated = false

				if (device.equatorialCoordinate.rightAscension !== rightAscension) {
					device.equatorialCoordinate.rightAscension = rightAscension
					updated = true
				}

				if (device.equatorialCoordinate.declination !== declination) {
					device.equatorialCoordinate.declination = declination
					updated = true
				}

				if (updated) {
					this.update(device, 'equatorialCoordinate', message.state)
				}

				return
			}
			case 'GEOGRAPHIC_COORD': {
				const longitude = deg(message.elements.LONG!.value)
				const latitude = deg(message.elements.LAT!.value)
				const elevation = meter(message.elements.ELEV!.value)
				let updated = false

				if (device.geographicCoordinate.longitude !== longitude) {
					device.geographicCoordinate.longitude = longitude >= PI ? longitude - TAU : longitude
					updated = true
				}

				if (device.geographicCoordinate.latitude !== latitude) {
					device.geographicCoordinate.latitude = latitude
					updated = true
				}

				if (device.geographicCoordinate.elevation !== elevation) {
					device.geographicCoordinate.elevation = elevation
					updated = true
				}

				if (updated) {
					this.update(device, 'geographicCoordinate', message.state)
				}

				return
			}
			case 'TELESCOPE_TIMED_GUIDE_NS':
			case 'TELESCOPE_TIMED_GUIDE_WE':
				if (tag[0] === 'd' && !device.canPulseGuide) {
					device.canPulseGuide = true
					this.update(device, 'canPulseGuide', message.state)
					this.guideOutput.add(device)
				}

				return
		}
	}

	textVector(client: IndiClient, message: DefTextVector | SetTextVector, tag: string) {
		if (message.name === 'DRIVER_INFO') {
			const type = +message.elements.DRIVER_INTERFACE!.value

			if (isInterfaceType(type, DeviceInterfaceType.TELESCOPE)) {
				if (!this.mounts.has(message.device)) {
					const executable = message.elements.DRIVER_EXEC!.value
					const version = message.elements.DRIVER_VERSION!.value

					const mount: Mount = { ...structuredClone(DEFAULT_MOUNT), id: message.device, name: message.device, driver: { executable, version } }
					this.add(mount)
					ask(client, mount)
				}
			} else if (this.mounts.has(message.device)) {
				this.remove(this.mounts.get(message.device)!)
			}

			return
		}

		const device = this.mounts.get(message.device)

		if (!device) return

		switch (message.name) {
			case 'TIME_UTC': {
				const utc = parseTemporal(message.elements.UTC!.value, 'YYYY-MM-DDTHH:mm:ss')
				const offset = parseUTCOffset(message.elements.OFFSET!.value)

				if (device.time.utc !== utc || device.time.offset !== offset) {
					device.time.utc = utc
					device.time.offset = offset
					this.update(device, 'time', message.state)
				}

				return
			}
		}
	}

	delProperty(client: IndiClient, message: DelProperty) {
		if (!message.name) {
			const device = this.mounts.get(message.device)
			device && this.remove(device)
		}
	}

	update(device: Mount, property: keyof Mount, state?: PropertyState) {
		const value = { name: device.name, [property]: device[property] }
		this.wsm.send<MountUpdated>('mount:update', { device: value, property, state })
	}

	add(device: Mount) {
		this.mounts.set(device.name, device)
		this.wsm.send<MountAdded>('mount:add', { device })
		console.info('mount added:', device.name)
	}

	has(device: Mount) {
		return this.mounts.has(device.name)
	}

	remove(device: Mount) {
		if (this.mounts.has(device.name)) {
			this.mounts.delete(device.name)

			// TODO: Call it on deleteProperty
			this.guideOutput.remove(device)

			this.wsm.send<MountRemoved>('mount:remove', { device })
			console.info('mount removed:', device.name)
		}
	}

	list() {
		return Array.from(this.mounts.values())
	}

	get(id: string) {
		return this.mounts.get(id)
	}

	currentCoordinatePosition(device: Mount) {
		return this.targetCoordinatePosition(device)
	}

	targetCoordinatePosition(device: Mount, target: EquatorialCoordinate | MountTargetCoordinate<string | Angle> = device.equatorialCoordinate) {
		const location: GeographicPosition = { ...device.geographicCoordinate, ellipsoid: 3 }

		let rightAscension = 0
		let declination = 0
		let rightAscensionJ2000 = 0
		let declinationJ2000 = 0
		let azimuth = 0
		let altitude = 0

		const time = this.cache.time('now', location)
		const lst = localSiderealTime(time)

		// JNOW equatorial coordinate
		if (!('type' in target) || target.type === 'JNOW') {
			rightAscension = typeof target.rightAscension === 'number' ? target.rightAscension : parseAngle(target.rightAscension, { isHour: true })!
			declination = typeof target.declination === 'number' ? target.declination : parseAngle(target.declination)!

			;({ azimuth, altitude } = cirsToObserved([rightAscension, declination], time))
			;[rightAscensionJ2000, declinationJ2000] = eraC2s(...precessFk5ToJ2000(eraS2c(rightAscension, declination), time))
		}
		// J2000 equatorial coordinate
		else if (target.type === 'J2000') {
			rightAscensionJ2000 = typeof target.rightAscension === 'number' ? target.rightAscension : parseAngle(target.rightAscension, { isHour: true })!
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
			lst: formatHMS(lst),
			meridianAt: '00:00',
			pierSide: expectedPierSide(rightAscension, declination, lst),
		} as MountEquatorialCoordinatePosition
	}

	moveTo(client: IndiClient, mount: Mount, mode: 'goto' | 'slew' | 'sync', req: MountTargetCoordinate<string | Angle>) {
		let rightAscension = 0
		let declination = 0

		if (!('type' in req) || req.type === 'JNOW') {
			rightAscension = typeof req.rightAscension === 'number' ? req.rightAscension : parseAngle(req.rightAscension, { isHour: true })!
			declination = typeof req.declination === 'number' ? req.declination : parseAngle(req.declination)!
		} else if (req.type === 'J2000') {
			const rightAscensionJ2000 = typeof req.rightAscension === 'number' ? req.rightAscension : parseAngle(req.rightAscension, { isHour: true })!
			const declinationJ2000 = typeof req.declination === 'number' ? req.declination : parseAngle(req.declination)!

			const time = this.cache.time('now')
			const fk5 = eraS2c(rightAscensionJ2000, declinationJ2000)
			;[rightAscension, declination] = eraC2s(...precessFk5FromJ2000(fk5, time))
		} else if (req.type === 'ALTAZ') {
			const azimuth = typeof req.azimuth === 'number' ? req.azimuth : parseAngle(req.azimuth)!
			const altitude = typeof req.altitude === 'number' ? req.altitude : parseAngle(req.altitude)!

			const time = this.cache.time('now')
			;[rightAscension, declination] = observedToCirs(azimuth, altitude, time)
		}

		if (mode === 'goto') goTo(client, mount, rightAscension, declination)
		else if (mode === 'slew') slewTo(client, mount, rightAscension, declination)
		else if (mode === 'sync') syncTo(client, mount, rightAscension, declination)
	}
}

export class MountRemoteControlManager implements StellariumProtocolHandler, Lx200ProtocolHandler {
	private readonly stellarium = new Map<Mount, StellariumProtocolServer>()
	private readonly lx200 = new Map<Mount, Lx200ProtocolServer>()
	private readonly equatorialCoordinateJ2000 = new Map<Mount, readonly [Angle, Angle]>()

	constructor(readonly connection: ConnectionManager) {}

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
		goTo(this.connection.get(), this.mount(server)!, rightAscension, declination)
	}

	sync(server: Lx200ProtocolServer, rightAscension: Angle, declination: Angle) {
		;[rightAscension, declination] = eraC2s(...precessFk5FromJ2000(fk5(rightAscension, declination), timeNow(true)))
		return syncTo(this.connection.get(), this.mount(server)!, rightAscension, declination)
	}

	disconnect(server: Lx200ProtocolServer | StellariumProtocolServer) {
		const mount = this.mount(server)!

		if (server instanceof Lx200ProtocolServer) {
			this.lx200.delete(mount)
		} else if (server instanceof StellariumProtocolServer) {
			this.stellarium.delete(mount)
		}
	}

	// LX200

	// is RA called first?
	rightAscension(server: Lx200ProtocolServer) {
		const mount = this.mount(server)!
		const { rightAscension, declination } = mount.equatorialCoordinate
		const coordinate = eraC2s(...precessFk5ToJ2000(fk5(rightAscension, declination), timeNow(true)))
		this.equatorialCoordinateJ2000.set(mount, coordinate)
		return coordinate[0]
	}

	declination(server: Lx200ProtocolServer) {
		const mount = this.mount(server)!
		return this.equatorialCoordinateJ2000.get(mount)?.[1] ?? 0
	}

	longitude(server: Lx200ProtocolServer, longitude?: Angle) {
		const mount = this.mount(server)!
		if (longitude) geographicCoordinate(this.connection.get(), mount, { ...mount.geographicCoordinate, longitude })
		return deg(mount.geographicCoordinate.longitude)
	}

	latitude(server: Lx200ProtocolServer, latitude?: Angle) {
		const mount = this.mount(server)!
		if (latitude) geographicCoordinate(this.connection.get(), mount, { ...mount.geographicCoordinate, latitude })
		return deg(mount.geographicCoordinate.latitude)
	}

	dateTime(server: Lx200ProtocolServer) {
		const date = new Date()
		return [temporalUnix(date.getDate()), date.getTimezoneOffset()] as const
	}

	tracking(server: Lx200ProtocolServer) {
		return this.mount(server)!.tracking
	}

	parked(server: Lx200ProtocolServer) {
		return this.mount(server)!.parked
	}

	slewing(server: Lx200ProtocolServer) {
		return this.mount(server)!.slewing
	}

	slewRate(server: Lx200ProtocolServer, rate: 'CENTER' | 'GUIDE' | 'FIND' | 'MAX') {
		const rates = this.mount(server)!.slewRates

		if (rates.length) {
			const index = rates.length === 1 ? 0 : rate === 'GUIDE' ? 0 : rate === 'MAX' ? rates.length - 1 : rate === 'CENTER' ? 1 : Math.max(1, rates.length - 2)
			slewRate(this.connection.get(), this.mount(server)!, rates[Math.max(index, 0)])
		}
	}

	move(server: Lx200ProtocolServer, direction: MoveDirection, enabled: boolean) {
		if (direction === 'NORTH') moveNorth(this.connection.get(), this.mount(server)!, enabled)
		else if (direction === 'SOUTH') moveSouth(this.connection.get(), this.mount(server)!, enabled)
		else if (direction === 'EAST') moveEast(this.connection.get(), this.mount(server)!, enabled)
		else if (direction === 'WEST') moveWest(this.connection.get(), this.mount(server)!, enabled)
	}

	abort(server: Lx200ProtocolServer) {
		stop(this.connection.get(), this.mount(server)!)
	}

	private mount(server: Lx200ProtocolServer | StellariumProtocolServer) {
		for (const [m, s] of this.lx200) if (s === server) return m
		for (const [m, s] of this.stellarium) if (s === server) return m
		return undefined
	}
}

export function mount(mount: MountManager, remoteControl: MountRemoteControlManager, connection: ConnectionManager) {
	function mountFromParams(params: { id: string }) {
		return mount.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/mounts' })
		// Endpoints!
		.get('', () => mount.list())
		.get('/:id', ({ params }) => mountFromParams(params))
		.post('/:id/goto', ({ params, body }) => mount.moveTo(connection.get(), mountFromParams(params), 'goto', body as never))
		.post('/:id/slew', ({ params, body }) => mount.moveTo(connection.get(), mountFromParams(params), 'slew', body as never))
		.post('/:id/sync', ({ params, body }) => mount.moveTo(connection.get(), mountFromParams(params), 'sync', body as never))
		.post('/:id/park', ({ params }) => park(connection.get(), mountFromParams(params)))
		.post('/:id/unpark', ({ params }) => unpark(connection.get(), mountFromParams(params)))
		.post('/:id/home', ({ params }) => home(connection.get(), mountFromParams(params)))
		.post('/:id/tracking', ({ params, body }) => tracking(connection.get(), mountFromParams(params), body as never))
		.post('/:id/trackmode', ({ params, body }) => trackMode(connection.get(), mountFromParams(params), body as never))
		.post('/:id/slewrate', ({ params, body }) => slewRate(connection.get(), mountFromParams(params), body as never))
		.post('/:id/position/current', ({ params }) => mount.currentCoordinatePosition(mountFromParams(params)))
		.post('/:id/position/target', ({ params, body }) => mount.targetCoordinatePosition(mountFromParams(params), body as never))
		.post('/:id/movenorth', ({ params, body }) => moveNorth(connection.get(), mountFromParams(params), body as never))
		.post('/:id/movesouth', ({ params, body }) => moveSouth(connection.get(), mountFromParams(params), body as never))
		.post('/:id/moveeast', ({ params, body }) => moveEast(connection.get(), mountFromParams(params), body as never))
		.post('/:id/movewest', ({ params, body }) => moveWest(connection.get(), mountFromParams(params), body as never))
		.post('/:id/location', ({ params, body }) => geographicCoordinate(connection.get(), mountFromParams(params), body as never))
		.post('/:id/time', ({ params, body }) => time(connection.get(), mountFromParams(params), body as never))
		.post('/:id/stop', ({ params }) => stop(connection.get(), mountFromParams(params)))
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
