import { molecule, onMount } from 'bunshi'
import type { Camera, Device, DeviceType, GuideOutput, Thermometer } from 'src/api/types'
import { proxy } from 'valtio'
import { BusMolecule } from '../bus'

export type EquipmentDevice<T extends Device> = T & {
	show?: boolean
}

export interface EquipmentState {
	readonly CAMERA: EquipmentDevice<Camera>[]
	readonly MOUNT: EquipmentDevice<Device>[]
	readonly WHEEL: EquipmentDevice<Device>[]
	readonly FOCUSER: EquipmentDevice<Device>[]
	readonly ROTATOR: EquipmentDevice<Device>[]
	readonly GPS: EquipmentDevice<Device>[]
	readonly DOME: EquipmentDevice<Device>[]
	readonly GUIDE_OUTPUT: EquipmentDevice<GuideOutput>[]
	readonly LIGHT_BOX: EquipmentDevice<Device>[]
	readonly DUST_CAP: EquipmentDevice<Device>[]
	readonly THERMOMETER: EquipmentDevice<Thermometer>[]
	readonly DEW_HEATER: EquipmentDevice<Device>[]
}

// Molecule that manages all the connected devices
export const EquipmentMolecule = molecule((m) => {
	const bus = m(BusMolecule)

	const state = proxy<EquipmentState>({
		CAMERA: [],
		MOUNT: [],
		WHEEL: [],
		FOCUSER: [],
		ROTATOR: [],
		GPS: [],
		DOME: [],
		GUIDE_OUTPUT: [],
		LIGHT_BOX: [],
		DUST_CAP: [],
		THERMOMETER: [],
		DEW_HEATER: [],
	})

	onMount(() => {
		const unsubscribers: VoidFunction[] = []

		unsubscribers.push(bus.subscribe('CAMERA_ADD', (event) => register('CAMERA', event)))
		unsubscribers.push(bus.subscribe('CAMERA_REMOVE', (event) => unregister('CAMERA', event)))
		unsubscribers.push(bus.subscribe('CAMERA_UPDATE', (event) => update('CAMERA', event.device.name, event.property, event.device[event.property]!)))
		unsubscribers.push(bus.subscribe('GUIDE_OUTPUT_ADD', (event) => register('GUIDE_OUTPUT', event)))
		unsubscribers.push(bus.subscribe('GUIDE_OUTPUT_REMOVE', (event) => unregister('GUIDE_OUTPUT', event)))
		unsubscribers.push(bus.subscribe('GUIDE_OUTPUT_UPDATE', (event) => update('GUIDE_OUTPUT', event.device.name, event.property, event.device[event.property]!)))
		unsubscribers.push(bus.subscribe('THERMOMETER_ADD', (event) => register('THERMOMETER', event)))
		unsubscribers.push(bus.subscribe('THERMOMETER_REMOVE', (event) => unregister('THERMOMETER', event)))
		unsubscribers.push(bus.subscribe('THERMOMETER_UPDATE', (event) => update('THERMOMETER', event.device.name, event.property, event.device[event.property]!)))

		return () => {
			unsubscribers.forEach((unsubscriber) => unsubscriber())
		}
	})

	// Registers a new device of a specific type
	function register<T extends DeviceType>(type: T, device: EquipmentState[T][number]) {
		const devices = state[type]
		const index = devices.findIndex((e) => e.name === device.name)
		index < 0 && state[type].push(device as never)
	}

	// Updates a specific property of a device
	function update<T extends DeviceType, P extends keyof EquipmentState[T][number]>(type: T, name: string, property: P, value: EquipmentState[T][number][P]) {
		const device = state[type].find((e) => e.name === name)
		if (!device) return console.warn('device not found:', name)
		;(device as Record<keyof EquipmentState[T][number], unknown>)[property] = value
	}

	// Unregisters a device of a specific type
	function unregister<T extends DeviceType>(type: T, device: EquipmentState[T][number]) {
		const devices = state[type]
		const index = devices.findIndex((e) => e.name === device.name)
		index >= 0 && devices.splice(index, 1)
	}

	// Shows the modal for a specific device type
	function showModal(type: DeviceType, device: Device) {
		state[type].find((e) => e.name === device.name)!.show = true
		bus.emit('TOGGLE_HOME_MENU', false)
	}

	// Closes the modal for a specific device type
	function closeModal(type: DeviceType, device: Device) {
		state[type].find((e) => e.name === device.name)!.show = false
	}

	return { state, register, update, unregister, showModal, closeModal }
})
