import { getDefaultInjector, molecule } from 'bunshi'
import Elysia from 'elysia'
import { type Angle, deg, hour, toDeg, toHour } from 'nebulosa/src/angle'
import { meter } from 'nebulosa/src/distance'
import type { DefNumberVector, DefSwitch, DefSwitchVector, DefTextVector, IndiClient, PropertyState, SetNumberVector, SetSwitchVector, SetTextVector } from 'nebulosa/src/indi'
import { BusMolecule } from 'src/shared/bus'
import { DEFAULT_MOUNT, type Mount, type MountAdded, type MountRemoved, type MountUpdated, type SlewRate, type TrackMode } from 'src/shared/types'
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
				const longitude = deg(message.elements.LONG!.value)
				const latitude = deg(message.elements.LAT!.value)
				const elevation = meter(message.elements.ELEV!.value)
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
	}

	// Removes a mount device
	function remove(device: Mount) {
		if (mounts.has(device.name)) {
			mounts.delete(device.name)

			// TODO: Call it on deleteProperty
			guideOutput.remove(device)

			wsm.send<MountRemoved>({ type: 'mount:remove', device })
			bus.emit('mount:remove', device)
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

	// The endpoints for managing mounts.
	const app = new Elysia({ prefix: '/mounts' })

	app.get('', () => {
		return list()
	})

	app.get('/:id', ({ params }) => {
		return get(decodeURIComponent(params.id))
	})

	app.post('/:id/park', ({ params }) => {
		const device = get(decodeURIComponent(params.id))!
		const connection = injector.get(ConnectionMolecule)
		park(connection.get(), device)
	})

	app.post('/:id/unpark', ({ params }) => {
		const device = get(decodeURIComponent(params.id))!
		const connection = injector.get(ConnectionMolecule)
		unpark(connection.get(), device)
	})

	app.post('/:id/home', ({ params }) => {
		const device = get(decodeURIComponent(params.id))!
		const connection = injector.get(ConnectionMolecule)
		home(connection.get(), device)
	})

	app.post('/:id/tracking', ({ params, body }) => {
		const device = get(decodeURIComponent(params.id))!
		const connection = injector.get(ConnectionMolecule)
		tracking(connection.get(), device, body as never)
	})

	app.post('/:id/trackMode', ({ params, body }) => {
		const device = get(decodeURIComponent(params.id))!
		const connection = injector.get(ConnectionMolecule)
		trackMode(connection.get(), device, body as never)
	})

	app.post('/:id/slewRate', ({ params, body }) => {
		const device = get(decodeURIComponent(params.id))!
		const connection = injector.get(ConnectionMolecule)
		slewRate(connection.get(), device, body as never)
	})

	return { switchVector, numberVector, textVector, add, remove, list, get, app }
})
