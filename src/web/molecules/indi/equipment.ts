import { molecule } from 'bunshi'
import type { Camera, GuideOutput, Thermometer } from 'src/api/types'
import { proxy } from 'valtio'

export interface EquipmentState {
	readonly cameras: Camera[]
	readonly guideOutputs: GuideOutput[]
	readonly thermometers: Thermometer[]
}

// Molecule that manages all the connected devices
export const EquipmentMolecule = molecule(() => {
	const state = proxy<EquipmentState>({
		cameras: [],
		guideOutputs: [],
		thermometers: [],
	})

	// Register a new device of a specific type
	function register<T extends keyof EquipmentState>(type: T, device: EquipmentState[T][number]) {
		state[type].push(device as never)
	}

	// Update a specific property of a device
	function update<T extends keyof EquipmentState>(type: T, name: string, property: keyof EquipmentState[T][number], value: EquipmentState[T][number][keyof EquipmentState[T][number]]) {
		const device = state[type].find((e) => e.name === name)
		if (!device) return console.warn('device not found:', name)
		;(device as Record<keyof EquipmentState[T][number], unknown>)[property] = value
	}

	// Unregister a device of a specific type
	function unregister<T extends keyof EquipmentState>(type: T, device: EquipmentState[T][number]) {
		const devices = state[type]
		const index = devices.findIndex((e) => e.name === device.name)
		index >= 0 && devices.splice(index, 1)
	}

	return { state, register, update, unregister }
})
