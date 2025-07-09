import { molecule, onMount } from 'bunshi'
import { BusMolecule } from 'src/shared/bus'
import type { Camera, CameraUpdated, Device, GuideOutput, GuideOutputUpdated, Mount, MountUpdated, Thermometer, ThermometerUpdated } from 'src/shared/types'
import { proxy } from 'valtio'

export type EquipmentDevice<T extends Device> = T & {
	show?: boolean
}

export interface EquipmentState {
	readonly camera: EquipmentDevice<Camera>[]
	readonly mount: EquipmentDevice<Mount>[]
	readonly wheel: EquipmentDevice<Device>[]
	readonly focuser: EquipmentDevice<Device>[]
	readonly rotator: EquipmentDevice<Device>[]
	readonly gps: EquipmentDevice<Device>[]
	readonly dome: EquipmentDevice<Device>[]
	readonly guideOutput: EquipmentDevice<GuideOutput>[]
	readonly lightBox: EquipmentDevice<Device>[]
	readonly dustCap: EquipmentDevice<Device>[]
	readonly thermometer: EquipmentDevice<Thermometer>[]
	readonly dewHeater: EquipmentDevice<Device>[]
}

// Molecule that manages all the connected devices
export const EquipmentMolecule = molecule((m) => {
	const bus = m(BusMolecule)

	const state = proxy<EquipmentState>({
		camera: [],
		mount: [],
		wheel: [],
		focuser: [],
		rotator: [],
		gps: [],
		dome: [],
		guideOutput: [],
		lightBox: [],
		dustCap: [],
		thermometer: [],
		dewHeater: [],
	})

	onMount(() => {
		const unsubscribers: VoidFunction[] = []

		unsubscribers.push(bus.subscribe<Camera>('camera:add', (event) => add('camera', event)))
		unsubscribers.push(bus.subscribe<Camera>('camera:remove', (event) => remove('camera', event)))
		unsubscribers.push(bus.subscribe<CameraUpdated>('camera:update', (event) => update('camera', event.device.name, event.property, event.device[event.property]!)))
		unsubscribers.push(bus.subscribe<Mount>('mount:add', (event) => add('mount', event)))
		unsubscribers.push(bus.subscribe<Mount>('mount:remove', (event) => remove('mount', event)))
		unsubscribers.push(bus.subscribe<MountUpdated>('mount:update', (event) => update('mount', event.device.name, event.property, event.device[event.property]!)))
		unsubscribers.push(bus.subscribe<GuideOutput>('guideOutput:add', (event) => add('guideOutput', event)))
		unsubscribers.push(bus.subscribe<GuideOutput>('guideOutput:remove', (event) => remove('guideOutput', event)))
		unsubscribers.push(bus.subscribe<GuideOutputUpdated>('guideOutput:update', (event) => update('guideOutput', event.device.name, event.property, event.device[event.property]!)))
		unsubscribers.push(bus.subscribe<Thermometer>('thermometer:add', (event) => add('thermometer', event)))
		unsubscribers.push(bus.subscribe<Thermometer>('thermometer:remove', (event) => remove('thermometer', event)))
		unsubscribers.push(bus.subscribe<ThermometerUpdated>('thermometer:update', (event) => update('thermometer', event.device.name, event.property, event.device[event.property]!)))

		return () => {
			unsubscribers.forEach((unsubscriber) => unsubscriber())
		}
	})

	function get(type: keyof EquipmentState, name: string): Device | undefined {
		return state[type].find((e) => e.name === name)
	}

	// Registers a new device of a specific type
	function add<T extends keyof EquipmentState>(type: T, device: EquipmentState[T][number]) {
		const devices = state[type]
		const index = devices.findIndex((e) => e.name === device.name)
		index < 0 && state[type].push(device as never)
	}

	// Updates a specific property of a device
	function update<T extends keyof EquipmentState, P extends keyof EquipmentState[T][number]>(type: T, name: string, property: P, value: EquipmentState[T][number][P]) {
		const device = state[type].find((e) => e.name === name)
		if (!device) return console.warn('device not found:', name)
		;(device as Record<keyof EquipmentState[T][number], unknown>)[property] = value
	}

	// Unregisters a device of a specific type
	function remove<T extends keyof EquipmentState>(type: T, device: EquipmentState[T][number]) {
		const devices = state[type]
		const index = devices.findIndex((e) => e.name === device.name)
		index >= 0 && devices.splice(index, 1)
	}

	// Shows the modal for a specific device type
	function showModal(type: keyof EquipmentState, device: Device) {
		state[type].find((e) => e.name === device.name)!.show = true
		bus.emit('homeMenu:toggle', false)
	}

	// Closes the modal for a specific device type
	function closeModal(type: keyof EquipmentState, device: Device) {
		state[type].find((e) => e.name === device.name)!.show = false
	}

	return { state, get, add, update, remove, showModal, closeModal }
})
