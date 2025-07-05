import { getDefaultInjector, molecule } from 'bunshi'
import { Elysia } from 'elysia'
// biome-ignore format: too many
import type { DefBlobVector, DefNumberVector, DefSwitchVector, DefTextVector, DefVector, IndiClient, SetBlobVector, SetNumberVector, SetSwitchVector, SetTextVector, SetVector } from 'nebulosa/src/indi'
import { BusMolecule } from '../shared/bus'
import type { Device, DeviceProperty } from '../shared/types'
import { CameraMolecule } from './camera'
import { ConnectionMolecule } from './connection'
import { GuideOutputMolecule } from './guideoutput'
import { ThermometerMolecule } from './thermometer'

export enum DeviceInterfaceType {
	TELESCOPE = 0x0001, // Telescope interface, must subclass INDI::Telescope.
	CCD = 0x0002, // CCD interface, must subclass INDI::CCD.
	GUIDER = 0x0004, // Guider interface, must subclass INDI::GuiderInterface.
	FOCUSER = 0x0008, // Focuser interface, must subclass INDI::FocuserInterface.
	FILTER = 0x0010, // Filter interface, must subclass INDI::FilterInterface.
	DOME = 0x0020, // Dome interface, must subclass INDI::Dome.
	GPS = 0x0040, // GPS interface, must subclass INDI::GPS.
	WEATHER = 0x0080, // Weather interface, must subclass INDI::Weather.
	AO = 0x0100, // Adaptive Optics Interface.
	DUSTCAP = 0x0200, // Dust Cap Interface.
	LIGHTBOX = 0x0400, // Light Box Interface.
	DETECTOR = 0x0800, // Detector interface, must subclass INDI::Detector.
	ROTATOR = 0x1000, // Rotator interface, must subclass INDI::RotatorInterface.
	SPECTROGRAPH = 0x2000, // Spectrograph interface.
	CORRELATOR = 0x4000, // Correlators (interferometers) interface.
	AUXILIARY = 0x8000, // Auxiliary interface.
	OUTPUT = 0x10000, // Digital Output (e.g. Relay) interface.
	INPUT = 0x20000, // Digital/Analog Input (e.g. GPIO) interface.
	POWER = 0x40000, // Auxiliary interface.
	SENSOR_INTERFACE = SPECTROGRAPH | DETECTOR | CORRELATOR,
}

// Checks if a value contains a specific interface type.
export function isInterfaceType(value: number, type: DeviceInterfaceType) {
	return (value & type) !== 0
}

// Asks the IndiClient for properties of a specific device.
export function ask(client: IndiClient, device: Device) {
	client.getProperties({ device: device.name })
}

// Enables the blob transfer for a specific device.
export function enableBlob(client: IndiClient, device: Device) {
	client.enableBlob({ device: device.name, value: 'Also' })
}

// Disables the blob transfer for a specific device.
export function disableBlob(client: IndiClient, device: Device) {
	client.enableBlob({ device: device.name, value: 'Never' })
}

// Connects to a specific device.
export function connect(client: IndiClient, device: Device) {
	if (!device.connected) {
		client.sendSwitch({ device: device.name, name: 'CONNECTION', elements: { CONNECT: true } })
	}
}

// Disconnects from a specific device.
export function disconnect(client: IndiClient, device: Device) {
	if (device.connected) {
		client.sendSwitch({ device: device.name, name: 'CONNECTION', elements: { DISCONNECT: true } })
	}
}

const injector = getDefaultInjector()

// Molecule that handles the INDI devices.
export const IndiMolecule = molecule((m) => {
	const bus = m(BusMolecule)
	const camera = m(CameraMolecule)
	const guideOutput = m(GuideOutputMolecule)
	const thermometer = m(ThermometerMolecule)

	// Handles the connection close event
	function close(client: IndiClient, server: boolean) {
		bus.emit('indi:close', client)
	}

	// Handles incoming switch vector messages.
	function switchVector(client: IndiClient, message: DefSwitchVector | SetSwitchVector, tag: string) {
		camera.switchVector(client, message, tag)
	}

	// Handles incoming number vector messages.
	function numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		camera.numberVector(client, message, tag)
		guideOutput.numberVector(client, message, tag)
		thermometer.numberVector(client, message, tag)
	}

	// Handles incoming text vector messages.
	function textVector(client: IndiClient, message: DefTextVector | SetTextVector, tag: string) {
		camera.textVector(client, message, tag)
	}

	// Handles incoming blob vector messages.
	function blobVector(client: IndiClient, message: DefBlobVector | SetBlobVector, tag: string) {
		camera.blobVector(client, message, tag)
	}

	// Gets a device by its id.
	function get(id: string): Device | undefined {
		return camera.get(id) || guideOutput.get(id) || thermometer.get(id)
	}

	// The endpoints for managing INDI devices.
	const app = new Elysia({ prefix: '/indi' })

	app.get('/:id', ({ params }) => {
		return get(decodeURIComponent(params.id))
	})

	app.post('/:id/connect', ({ params }) => {
		const connection = injector.get(ConnectionMolecule)
		const device = get(decodeURIComponent(params.id))!
		const client = connection.get()
		connect(client, device)
	})

	app.post('/:id/disconnect', ({ params }) => {
		const connection = injector.get(ConnectionMolecule)
		const device = get(decodeURIComponent(params.id))!
		const client = connection.get()
		disconnect(client, device)
	})

	app.get('/:id/properties', ({ params }) => {
		return get(decodeURIComponent(params.id))!.properties
	})

	return { switchVector, numberVector, textVector, blobVector, close, app } as const
})

// Adds or updates a device's property.
export function addProperty(device: Device, message: DefVector | SetVector, tag: string) {
	if (tag[0] === 'd') {
		const property = message as DeviceProperty
		property.type = tag.includes('Switch') ? 'Switch' : tag.includes('Number') ? 'Number' : tag.includes('Text') ? 'Text' : tag.includes('BLOB') ? 'BLOB' : 'Light'
		device.properties[message.name] = property
	} else {
		const vector = device.properties[message.name]

		if (vector) {
			if (message.state) vector.state = message.state

			for (const key in message.elements) {
				if (key in vector.elements) {
					const value = message.elements[key]!.value
					vector.elements[key]!.value = value
				}
			}
		}
	}
}

// Handles the connection state of a device based on the received message.
export function handleConnection(client: IndiClient, device: Device, message: DefSwitchVector | SetSwitchVector) {
	const connected = message.elements.CONNECT?.value === true

	if (connected !== device.connected) {
		device.connected = connected
		if (connected) ask(client, device)
		return true
	}

	return false
}
