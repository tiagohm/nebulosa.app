import { molecule, onMount } from 'bunshi'
import type { Camera, Device, DeviceType, GuideOutput, SubDeviceType, Thermometer } from 'src/api/types'
import { proxy } from 'valtio'
import { BusMolecule, type BusUnsubscriber } from '../bus'

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
		const unsubscribers: BusUnsubscriber[] = []

		// Subscribe to bus events to handle device updates
		unsubscribers.push(bus.subscribe('addCamera', (event) => register('CAMERA', event)))
		unsubscribers.push(bus.subscribe('removeCamera', (event) => unregister('CAMERA', event)))
		unsubscribers.push(bus.subscribe('updateCamera', (event) => update('CAMERA', event.device, event.property, event.value)))
		unsubscribers.push(bus.subscribe('addGuideOutput', (event) => register('GUIDE_OUTPUT', event)))
		unsubscribers.push(bus.subscribe('removeGuideOutput', (event) => unregister('GUIDE_OUTPUT', event)))
		unsubscribers.push(bus.subscribe('updateGuideOutput', (event) => update('GUIDE_OUTPUT', event.device, event.property, event.value)))
		unsubscribers.push(bus.subscribe('addThermometer', (event) => register('THERMOMETER', event)))
		unsubscribers.push(bus.subscribe('removeThermometer', (event) => unregister('THERMOMETER', event)))
		unsubscribers.push(bus.subscribe('updateThermometer', (event) => update('THERMOMETER', event.device, event.property, event.value)))

		return () => {
			// Unsubscribe from all bus events when the molecule is destroyed
			unsubscribers.forEach((unsubscriber) => unsubscriber())
		}
	})

	// Registers a new device of a specific type
	function register<T extends DeviceType | SubDeviceType>(type: T, device: EquipmentState[T][number]) {
		const devices = state[type]
		const index = devices.findIndex((e) => e.name === device.name)
		index < 0 && state[type].push(device as never)
	}

	// Updates a specific property of a device
	function update<T extends DeviceType | SubDeviceType, P extends keyof EquipmentState[T][number]>(type: T, name: string, property: P, value: EquipmentState[T][number][P]) {
		const device = state[type].find((e) => e.name === name)
		if (!device) return console.warn('device not found:', name)
		;(device as Record<keyof EquipmentState[T][number], unknown>)[property] = value
	}

	// Unregisters a device of a specific type
	function unregister<T extends DeviceType | SubDeviceType>(type: T, device: EquipmentState[T][number]) {
		const devices = state[type]
		const index = devices.findIndex((e) => e.name === device.name)
		index >= 0 && devices.splice(index, 1)
	}

	// Shows the modal for a specific device type
	function showModal(type: DeviceType | SubDeviceType, device: Device) {
		state[type].find((e) => e.name === device.name)!.show = true
		bus.emit('toggleHomeMenu', false)
	}

	// Closes the modal for a specific device type
	function closeModal(type: DeviceType | SubDeviceType, device: Device) {
		state[type].find((e) => e.name === device.name)!.show = false
	}

	return { state, register, update, unregister, showModal, closeModal }
})
