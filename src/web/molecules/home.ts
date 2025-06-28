import { molecule, onMount } from 'bunshi'
import type { DeviceType, SubDeviceType } from 'src/api/types'
import { proxy } from 'valtio'
import { BusMolecule } from './bus'

export interface HomeState {
	readonly menu: {
		show: boolean
		activeDevice?: DeviceType | SubDeviceType
	}
}

// Molecule that manages the home
export const HomeMolecule = molecule((m) => {
	const bus = m(BusMolecule)

	const state = proxy<HomeState>({
		menu: {
			show: false,
			activeDevice: undefined,
		},
	})

	onMount(() => {
		const unsubscribe = bus.subscribe('toggleHomeMenu', (enabled) => toggleMenu(enabled))

		return () => unsubscribe()
	})

	function toggleMenu(force?: boolean) {
		state.menu.show = force !== undefined ? force : !state.menu.show
	}

	function toggleActiveDevice(type: HomeState['menu']['activeDevice']) {
		if (state.menu.activeDevice === type) {
			state.menu.activeDevice = undefined
		} else {
			state.menu.activeDevice = type
		}
	}

	return { state, toggleMenu, toggleActiveDevice }
})
