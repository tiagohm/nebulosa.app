import { molecule, onMount } from 'bunshi'
import bus, { unsubscribe } from 'src/shared/bus'
import type { Camera, CameraUpdated, Device, GuideOutput, GuideOutputUpdated, Mount, MountUpdated, Thermometer, ThermometerUpdated } from 'src/shared/types'
import { proxy } from 'valtio'

export type EquipmentDeviceType = keyof EquipmentState['devices']

export type EquipmentDevice<T extends Device> = T & {
	show?: boolean
}

export interface EquipmentState {
	selected?: EquipmentDeviceType
	readonly devices: {
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
}

// Molecule that manages all the connected devices
export const EquipmentMolecule = molecule((m) => {
	const state = proxy<EquipmentState>({
		devices: {
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
		},
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
			unsubscribe(unsubscribers)
		}
	})

	// Gets a device of a specific type by its name
	function get<T extends Device = Device>(type: EquipmentDeviceType, name: string) {
		return state.devices[type].find((e) => e.name === name) as T | undefined
	}

	// Lists all devices of a specific type
	function list<T extends Device = Device>(type: EquipmentDeviceType) {
		return state.devices[type] as T[]
	}

	// Registers a new device of a specific type
	function add<T extends EquipmentDeviceType>(type: T, device: EquipmentState['devices'][T][number]) {
		const devices = state.devices[type]
		const index = devices.findIndex((e) => e.name === device.name)
		index < 0 && devices.push(device as never)
	}

	// Updates a specific property of a device
	function update<T extends EquipmentDeviceType, P extends keyof EquipmentState['devices'][T][number]>(type: T, name: string, property: P, value: EquipmentState['devices'][T][number][P]) {
		const device = state.devices[type].find((e) => e.name === name)
		if (!device) return console.warn('device not found:', name)
		;(device as Record<keyof EquipmentState['devices'][T][number], unknown>)[property] = value
	}

	// Unregisters a device of a specific type
	function remove<T extends EquipmentDeviceType>(type: T, device: EquipmentState['devices'][T][number]) {
		const devices = state.devices[type]
		const index = devices.findIndex((e) => e.name === device.name)

		if (index >= 0) {
			devices.splice(index, 1)

			if (devices.length === 0 && state.selected === type) {
				state.selected = undefined
			}
		}
	}

	// Shows or hides the devices list
	function select(type: EquipmentDeviceType) {
		if (state.selected === type) {
			state.selected = undefined
		} else {
			state.selected = type
		}
	}

	// Shows the modal for a specific device type
	function show(type: EquipmentDeviceType, device: Device) {
		state.devices[type].find((e) => e.name === device.name)!.show = true
		bus.emit('homeMenu:toggle', false)
	}

	// Closes the modal for a specific device type
	function close(type: EquipmentDeviceType, device: Device) {
		state.devices[type].find((e) => e.name === device.name)!.show = false
	}

	return { state, get, list, add, update, remove, select, show, close } as const
})
