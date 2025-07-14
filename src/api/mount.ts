import { getDefaultInjector, molecule } from 'bunshi'
import Elysia from 'elysia'
import { type Angle, deg, formatHMS, hour, parseAngle, toDeg, toHour } from 'nebulosa/src/angle'
import { altaz } from 'nebulosa/src/astrometry'
import { constellation } from 'nebulosa/src/constellation'
import { meter } from 'nebulosa/src/distance'
import { eraC2s, eraS2c } from 'nebulosa/src/erfa'
import { precessFk5ToJ2000 } from 'nebulosa/src/fk5'
import type { DefNumberVector, DefSwitch, DefSwitchVector, DefTextVector, IndiClient, PropertyState, SetNumberVector, SetSwitchVector, SetTextVector } from 'nebulosa/src/indi'
import { type GeographicPosition, geodeticLocation, lst } from 'nebulosa/src/location'
import { timeNow } from 'nebulosa/src/time'
import { earth } from 'nebulosa/src/vsop87e'
import { BusMolecule } from 'src/shared/bus'
import { DEFAULT_MOUNT, DEFAULT_MOUNT_EQUATORIAL_COORDINATE_POSITION, type EquatorialCoordinate, expectedPierSide, type GeographicCoordinate, type Mount, type MountAdded, type MountEquatorialCoordinatePosition, type MountRemoved, type MountUpdated, type SlewRate, type TrackMode } from 'src/shared/types'
import { ConnectionMolecule } from './connection'
import { GuideOutputMolecule } from './guideoutput'
import { addProperty, ask, DeviceInterfaceType, handleConnection, isInterfaceType } from './indi'
import { WebSocketMessageMolecule } from './message'

export function tracking(client: IndiClient, mount: Mount, enable: boolean) {
	client.sendSwitch({ device: mount.name, name: 'TELESCOPE_TRACK_STATE', elements: { [enable ? 'TRACK_ON' : 'TRACK_OFF']: true } })
}

export function park(client: IndiClient, mount: Mount) {
	if (mount.canPark) {
		client.sendSwitch({ device: mount.name, name: 'TELESCOPE_PARK', elements: { PARK: true } })
	}
}

export function unpark(client: IndiClient, mount: Mount) {
	client.sendSwitch({ device: mount.name, name: 'TELESCOPE_PARK', elements: { UNPARK: true } })
}

export function stopMotion(client: IndiClient, mount: Mount) {
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
	client.sendNumber({ device: mount.name, name: 'GEOGRAPHIC_COORD', elements: { LAT: latitude, LONG: longitude, ELEV: elevation } })
}

export function sync(client: IndiClient, mount: Mount, rightAscension: Angle, declination: Angle) {
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

const injector = getDefaultInjector()

export const MountMolecule = molecule((m) => {
	const bus = m(BusMolecule)
	const wsm = m(WebSocketMessageMolecule)
	const guideOutput = m(GuideOutputMolecule)

	const mounts = new Map<string, Mount>()
	const geographicPositions = new Map<Mount, GeographicPosition>()

	bus.subscribe('indi:close', (client: IndiClient) => {
		// Remove all mounts associated with the client
		mounts.forEach((device) => remove(device))
	})

	// Handles incoming switch vector messages.
	function switchVector(client: IndiClient, message: DefSwitchVector | SetSwitchVector, tag: string) {
		const device = mounts.get(message.device)

		if (!device) return

		// Add the property to the device
		addProperty(device, message, tag)

		switch (message.name) {
			case 'CONNECTION':
				if (handleConnection(client, device, message)) {
					sendUpdate(device, 'connected', message.state)
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
						sendUpdate(device, 'slewRates', message.state)
					}
				}

				for (const key in message.elements) {
					const element = message.elements[key]!

					if (element.value) {
						if (device.slewRate !== element.name) {
							device.slewRate = element.name
							sendUpdate(device, 'slewRate', message.state)
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
						sendUpdate(device, 'trackModes', message.state)
					}
				}

				for (const key in message.elements) {
					const element = message.elements[key]!

					if (element.value) {
						const trackMode = element.name.replace('TRACK_', '') as TrackMode

						if (device.trackMode !== trackMode) {
							device.trackMode = trackMode
							sendUpdate(device, 'trackMode', message.state)
						}

						break
					}
				}

				return
			case 'TELESCOPE_TRACK_STATE': {
				const tracking = message.elements.TRACK_ON?.value === true

				if (device.tracking !== tracking) {
					device.tracking = tracking
					sendUpdate(device, 'tracking', message.state)
				}

				return
			}
			case 'TELESCOPE_PIER_SIDE': {
				const pierSide = message.elements.PIER_WEST?.value === true ? 'WEST' : message.elements.PIER_EAST?.value === true ? 'EAST' : 'NEITHER'

				if (device.pierSide !== pierSide) {
					device.pierSide = pierSide
					sendUpdate(device, 'pierSide', message.state)
				}

				return
			}
			case 'TELESCOPE_PARK': {
				if (tag[0] === 'd') {
					const canPark = (message as DefSwitchVector).permission !== 'ro'

					if (device.canPark !== canPark) {
						device.canPark = canPark
						sendUpdate(device, 'canPark', message.state)
					}
				}

				if (message.state) {
					const parking = message.state === 'Busy'

					if (device.parking !== parking) {
						device.parking = parking
						sendUpdate(device, 'parking', message.state)
					}
				}

				const parked = message.elements.PARK?.value === true

				if (device.parked !== parked) {
					device.parked = parked
					sendUpdate(device, 'parked', message.state)
				}

				return
			}
			case 'TELESCOPE_ABORT_MOTION':
				if (!device.canAbort) {
					device.canAbort = true
					sendUpdate(device, 'canAbort', message.state)
				}

				return
			case 'TELESCOPE_HOME':
				if (!device.canHome) {
					device.canHome = true
					sendUpdate(device, 'canHome', message.state)
				}

				return
			case 'ON_COORD_SET':
				if (tag[0] === 'd') {
					const canSync = message.elements.SYNC?.value === true

					if (device.canSync !== canSync) {
						device.canSync = canSync
						sendUpdate(device, 'canSync', message.state)
					}

					const canGoTo = message.elements.TRACK?.value === true

					if (device.canGoTo !== canGoTo) {
						device.canGoTo = canGoTo
						sendUpdate(device, 'canGoTo', message.state)
					}
				}

				return
		}
	}

	// Handles incoming number vector messages.
	function numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		const device = mounts.get(message.device)

		if (!device) return

		// Add the property to the device
		addProperty(device, message, tag)

		switch (message.name) {
			case 'EQUATORIAL_EOD_COORD': {
				const slewing = message.state === 'Busy'

				if (device.slewing !== slewing) {
					device.slewing = slewing
					sendUpdate(device, 'slewing', message.state)
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
					sendUpdate(device, 'equatorialCoordinate', message.state)
				}

				return
			}
			case 'GEOGRAPHIC_COORD': {
				const longitude = message.elements.LONG!.value
				const latitude = message.elements.LAT!.value
				const elevation = message.elements.ELEV!.value
				let updated = false

				if (device.geographicCoordinate.longitude !== longitude) {
					device.geographicCoordinate.longitude = longitude
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
					geographicPositions.set(device, geodeticLocation(deg(longitude), deg(latitude), meter(elevation)))
					sendUpdate(device, 'geographicCoordinate', message.state)
				}

				return
			}
			case 'TELESCOPE_TIMED_GUIDE_NS':
			case 'TELESCOPE_TIMED_GUIDE_WE':
				if (tag[0] === 'd') {
					if (!device.canPulseGuide) {
						device.canPulseGuide = true
						sendUpdate(device, 'canPulseGuide', message.state)
						guideOutput.add(device)
					}
				}

				return
		}
	}

	// Handles incoming text vector messages.
	function textVector(client: IndiClient, message: DefTextVector | SetTextVector, tag: string) {
		if (message.name === 'DRIVER_INFO') {
			const type = parseInt(message.elements.DRIVER_INTERFACE!.value)

			if (isInterfaceType(type, DeviceInterfaceType.TELESCOPE)) {
				const executable = message.elements.DRIVER_EXEC!.value
				const version = message.elements.DRIVER_VERSION!.value

				if (!mounts.has(message.device)) {
					const mount: Mount = { ...structuredClone(DEFAULT_MOUNT), id: message.device, name: message.device, driver: { executable, version } }
					add(mount)
					addProperty(mount, message, tag)
					ask(client, mount)
				}
			} else if (mounts.has(message.device)) {
				remove(mounts.get(message.device)!)
			}

			return
		}

		const device = mounts.get(message.device)

		if (!device) return

		// Add the property to the device
		addProperty(device, message, tag)

		switch (message.name) {
		}
	}

	// Sends an update for a mount device
	function sendUpdate(device: Mount, property: keyof Mount, state?: PropertyState) {
		const value = { name: device.name, [property]: device[property] }
		wsm.send<MountUpdated>({ type: 'mount:update', device: value, property, state })
		bus.emit('mount:update', value)
	}

	// Adds a mount device
	function add(device: Mount) {
		mounts.set(device.name, device)
		wsm.send<MountAdded>({ type: 'mount:add', device })
		bus.emit('mount:add', device)
		console.info('mount added:', device.name)
	}

	// Removes a mount device
	function remove(device: Mount) {
		if (mounts.has(device.name)) {
			mounts.delete(device.name)

			// TODO: Call it on deleteProperty
			guideOutput.remove(device)

			wsm.send<MountRemoved>({ type: 'mount:remove', device })
			bus.emit('mount:remove', device)
			console.info('mount removed:', device.name)
		}
	}

	// Lists all mount devices
	function list() {
		return Array.from(mounts.values())
	}

	// Gets a mount device by its id
	function get(id: string) {
		return mounts.get(id)
	}

	function deviceAndConnection(deviceId: string) {
		const connection = injector.get(ConnectionMolecule)
		return [get(decodeURIComponent(deviceId))!, connection.get()] as const
	}

	// The endpoints for managing mounts.
	const app = new Elysia({ prefix: '/mounts' })

	app.get('', () => {
		return list()
	})

	app.get('/:id', ({ params }) => {
		return get(decodeURIComponent(params.id))
	})

	app.post('/:id/goto', ({ params, body }) => {
		const [device, connection] = deviceAndConnection(params.id)
		const { rightAscension, declination } = body as EquatorialCoordinate<string | Angle>
		goTo(connection, device, parseAngle(rightAscension, { isHour: true })!, parseAngle(declination)!)
	})

	app.post('/:id/slew', ({ params, body }) => {
		const [device, connection] = deviceAndConnection(params.id)
		const { rightAscension, declination } = body as EquatorialCoordinate<string | Angle>
		slewTo(connection, device, parseAngle(rightAscension, { isHour: true })!, parseAngle(declination)!)
	})

	app.post('/:id/sync', ({ params, body }) => {
		const [device, connection] = deviceAndConnection(params.id)
		const { rightAscension, declination } = body as EquatorialCoordinate<string | Angle>
		sync(connection, device, parseAngle(rightAscension, { isHour: true })!, parseAngle(declination)!)
	})

	app.post('/:id/park', ({ params }) => {
		const [device, connection] = deviceAndConnection(params.id)
		park(connection, device)
	})

	app.post('/:id/unpark', ({ params }) => {
		const [device, connection] = deviceAndConnection(params.id)
		unpark(connection, device)
	})

	app.post('/:id/home', ({ params }) => {
		const [device, connection] = deviceAndConnection(params.id)
		home(connection, device)
	})

	app.post('/:id/tracking', ({ params, body }) => {
		const [device, connection] = deviceAndConnection(params.id)
		tracking(connection, device, body as never)
	})

	app.post('/:id/trackmode', ({ params, body }) => {
		const [device, connection] = deviceAndConnection(params.id)
		trackMode(connection, device, body as never)
	})

	app.post('/:id/slewrate', ({ params, body }) => {
		const [device, connection] = deviceAndConnection(params.id)
		slewRate(connection, device, body as never)
	})

	app.get('/:id/position', ({ params }) => {
		const device = get(decodeURIComponent(params.id))!
		const { rightAscension, declination } = device.equatorialCoordinate

		const location = geographicPositions.get(device)
		if (!location) return { ...DEFAULT_MOUNT_EQUATORIAL_COORDINATE_POSITION, rightAscension, declination }

		const now = timeNow()
		now.location = location

		const ebpv = earth(now)
		const fk5 = eraS2c(rightAscension, declination)
		const fk5J2000 = precessFk5ToJ2000(fk5, now)
		const [rightAscensionJ2000, declinationJ2000] = eraC2s(...fk5J2000)
		const [azimuth, altitude] = altaz(fk5J2000, now, ebpv)!
		const lstTime = lst(now)

		return {
			rightAscension,
			declination,
			rightAscensionJ2000,
			declinationJ2000,
			azimuth,
			altitude,
			constellation: constellation(rightAscension, declination, now),
			lst: formatHMS(lstTime),
			meridianAt: '00:00 (-12:00)',
			pierSide: expectedPierSide(rightAscension, declination, lstTime),
		} satisfies MountEquatorialCoordinatePosition
	})

	app.post('/:id/movenorth', ({ params, body }) => {
		const [device, connection] = deviceAndConnection(params.id)
		moveNorth(connection, device, body as never)
	})

	app.post('/:id/movesouth', ({ params, body }) => {
		const [device, connection] = deviceAndConnection(params.id)
		moveSouth(connection, device, body as never)
	})

	app.post('/:id/moveeast', ({ params, body }) => {
		const [device, connection] = deviceAndConnection(params.id)
		moveEast(connection, device, body as never)
	})

	app.post('/:id/movewest', ({ params, body }) => {
		const [device, connection] = deviceAndConnection(params.id)
		moveWest(connection, device, body as never)
	})

	app.post('/:id/location', ({ params, body }) => {
		const [device, connection] = deviceAndConnection(params.id)
		geographicCoordinate(connection, device, body as never)
	})

	app.post('/:id/stop', ({ params }) => {
		const [device, connection] = deviceAndConnection(params.id)
		stopMotion(connection, device)
	})

	return { switchVector, numberVector, textVector, add, remove, list, get, app }
})
