import { molecule } from 'bunshi'
import type { Device, DeviceType, SubDeviceType } from 'src/api/types'
import { proxy } from 'valtio'
import { EquipmentMolecule } from './indi/equipment'

export interface HomeState {
	readonly menu: {
		deviceType?: DeviceType | SubDeviceType
		devices: Device[]
	}
	readonly about: {
		showModal: boolean
	}
}

// Molecule that manages the home
export const HomeMolecule = molecule((m) => {
	const equipment = m(EquipmentMolecule)

	const state = proxy<HomeState>({
		menu: {
			deviceType: undefined,
			devices: [],
		},
		about: {
			showModal: false,
		},
	})

	function showModal(type: 'about') {
		state[type].showModal = true
	}

	function closeModal(type: 'about') {
		state[type].showModal = false
	}

	function showDevices(type: DeviceType | SubDeviceType) {
		const devices = type === 'CAMERA' ? equipment.state.cameras : type === 'GUIDE_OUTPUT' ? equipment.state.guideOutputs : type === 'THERMOMETER' ? equipment.state.thermometers : undefined

		if (!devices || state.menu.devices === devices) {
			state.menu.deviceType = undefined
			state.menu.devices = []
		} else {
			state.menu.deviceType = type
			state.menu.devices = devices
		}
	}

	return { state, showModal, closeModal, showDevices }
})
