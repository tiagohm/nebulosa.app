import Elysia from 'elysia'
import { type Angle, deg, formatHMS, hour, parseAngle, toDeg, toHour } from 'nebulosa/src/angle'
import { altaz } from 'nebulosa/src/astrometry'
import { constellation } from 'nebulosa/src/constellation'
import { dateFrom } from 'nebulosa/src/datetime'
import { meter } from 'nebulosa/src/distance'
import { eraC2s, eraS2c } from 'nebulosa/src/erfa'
import { precessFk5ToJ2000 } from 'nebulosa/src/fk5'
import type { DefNumberVector, DefSwitch, DefSwitchVector, DefTextVector, DelProperty, IndiClient, IndiClientHandler, PropertyState, SetNumberVector, SetSwitchVector, SetTextVector } from 'nebulosa/src/indi'
import { type GeographicPosition, geodeticLocation, localSiderealTime } from 'nebulosa/src/location'
import { timeNow } from 'nebulosa/src/time'
import { earth } from 'nebulosa/src/vsop87e'
import bus from 'src/shared/bus'
import { DEFAULT_MOUNT, DEFAULT_MOUNT_EQUATORIAL_COORDINATE_POSITION, type EquatorialCoordinate, expectedPierSide, type GeographicCoordinate, type GPS, type Mount, type MountAdded, type MountEquatorialCoordinatePosition, type MountRemoved, type MountUpdated, type SlewRate, type TrackMode } from 'src/shared/types'
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
	client.sendNumber({ device: mount.name, name: 'EQUATORIAL_EOD_COORD', elements: { RA: toHour(rightAscension), DEC: toDeg(declination) } })
}

export function geographicCoordinate(client: IndiClient, mount: Mount, { latitude, longitude, elevation }: GeographicCoordinate) {
	longitude = longitude < 0 ? longitude + 360 : longitude
	client.sendNumber({ device: mount.name, name: 'GEOGRAPHIC_COORD', elements: { LAT: latitude, LONG: longitude, ELEV: elevation } })
}

export function time(client: IndiClient, mount: Mount, time: GPS['time']) {
	const UTC = dateFrom(time.utc, true).format('YYYY-MM-DD[T]HH:mm:ss')
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
	client.sendSwitch({ device: mount.name, name: 'ON_COORD_SET', elements: { SLEW: true } })
	equatorialCoordinate(client, mount, rightAscension, declination)
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
	private readonly geographicPositions = new Map<Mount, GeographicPosition>()

	constructor(
		readonly wsm: WebSocketMessageManager,
		readonly guideOutput: GuideOutputManager,
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
					const canSync = message.elements.SYNC?.value === true

					if (device.canSync !== canSync) {
						device.canSync = canSync
						this.update(device, 'canSync', message.state)
					}

					const canGoTo = message.elements.TRACK?.value === true

					if (device.canGoTo !== canGoTo) {
						device.canGoTo = canGoTo
						this.update(device, 'canGoTo', message.state)
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
				const longitude = message.elements.LONG!.value
				const latitude = message.elements.LAT!.value
				const elevation = message.elements.ELEV!.value
				let updated = false

				if (device.geographicCoordinate.longitude !== longitude) {
					device.geographicCoordinate.longitude = longitude >= 180 ? longitude - 360 : longitude
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
					this.geographicPositions.set(device, geodeticLocation(deg(longitude), deg(latitude), meter(elevation)))
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
				const executable = message.elements.DRIVER_EXEC!.value
				const version = message.elements.DRIVER_VERSION!.value

				if (!this.mounts.has(message.device)) {
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
				const utc = parseTimeUTC(message.elements.UTC!.value.replace('/', '-'))
				const offset = parseTimeOffset(message.elements.OFFSET!.value)

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
		this.wsm.send<MountUpdated>({ type: 'mount:update', device: value, property, state })
		bus.emit('mount:update', value)
	}

	add(device: Mount) {
		this.mounts.set(device.name, device)
		this.wsm.send<MountAdded>({ type: 'mount:add', device })
		bus.emit('mount:add', device)
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

			this.wsm.send<MountRemoved>({ type: 'mount:remove', device })
			bus.emit('mount:remove', device)
			console.info('mount removed:', device.name)
		}
	}

	list() {
		return Array.from(this.mounts.values())
	}

	get(id: string) {
		return this.mounts.get(id)
	}

	coordinatePosition(device: Mount) {
		const { rightAscension, declination } = device.equatorialCoordinate

		const location = this.geographicPositions.get(device)
		if (!location) return { ...DEFAULT_MOUNT_EQUATORIAL_COORDINATE_POSITION, rightAscension, declination }

		const now = timeNow()
		now.location = location

		const ebpv = earth(now)
		const fk5 = eraS2c(rightAscension, declination)
		const [rightAscensionJ2000, declinationJ2000] = eraC2s(...precessFk5ToJ2000(fk5, now))
		const [azimuth, altitude] = altaz(fk5, now, ebpv)!
		const lst = localSiderealTime(now)

		return {
			rightAscension,
			declination,
			rightAscensionJ2000,
			declinationJ2000,
			azimuth,
			altitude,
			constellation: constellation(rightAscension, declination, now),
			lst: formatHMS(lst),
			meridianAt: '00:00 (-12:00)',
			pierSide: expectedPierSide(rightAscension, declination, lst),
		} satisfies MountEquatorialCoordinatePosition
	}

	moveTo(client: IndiClient, mount: Mount, mode: 'goto' | 'slew' | 'sync', req: EquatorialCoordinate<string | number>) {
		const rightAscension = parseAngle(req.rightAscension, { isHour: true })!
		const declination = parseAngle(req.declination)!

		if (mode === 'goto') goTo(client, mount, rightAscension, declination)
		else if (mode === 'slew') slewTo(client, mount, rightAscension, declination)
		else if (mode === 'sync') syncTo(client, mount, rightAscension, declination)
	}
}

export function mount(mount: MountManager, connection: ConnectionManager) {
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
		.get('/:id/position', ({ params }) => mount.coordinatePosition(mountFromParams(params)))
		.post('/:id/movenorth', ({ params, body }) => moveNorth(connection.get(), mountFromParams(params), body as never))
		.post('/:id/movesouth', ({ params, body }) => moveSouth(connection.get(), mountFromParams(params), body as never))
		.post('/:id/moveeast', ({ params, body }) => moveEast(connection.get(), mountFromParams(params), body as never))
		.post('/:id/movewest', ({ params, body }) => moveWest(connection.get(), mountFromParams(params), body as never))
		.post('/:id/location', ({ params, body }) => geographicCoordinate(connection.get(), mountFromParams(params), body as never))
		.post('/:id/time', ({ params, body }) => time(connection.get(), mountFromParams(params), body as never))
		.post('/:id/stop', ({ params }) => stop(connection.get(), mountFromParams(params)))

	return app
}

function parseTimeUTC(text: string) {
	return dateFrom(text, true).unix() * 1000 // ms
}

function parseTimeOffset(text: string) {
	const parts = text.split(':')

	if (parts.length === 1) return +parts[0] * 60
	else return +parts[0] * 60 + +parts[1]
}
