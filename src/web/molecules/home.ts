import { molecule, onMount } from 'bunshi'
import { BusMolecule } from 'src/shared/bus'
import { proxy } from 'valtio'
import type { EquipmentState } from './indi/equipment'

export interface HomeState {
	readonly menu: {
		show: boolean
		selected?: keyof EquipmentState
	}
}

// Molecule that manages the home
export const HomeMolecule = molecule((m) => {
	const bus = m(BusMolecule)

	const state = proxy<HomeState>({
		menu: {
			show: false,
			selected: undefined,
		},
	})

	onMount(() => {
		const unsubscriber = bus.subscribe<boolean>('homeMenu:toggle', (enabled) => toggleMenu(enabled))

		return () => unsubscriber()
	})

	// Toggles the home menu
	function toggleMenu(force?: boolean) {
		state.menu.show = force !== undefined ? force : !state.menu.show
	}

	// Shows or hides the devices list
	function select(type: HomeState['menu']['selected']) {
		if (state.menu.selected === type) {
			state.menu.selected = undefined
		} else {
			state.menu.selected = type
		}
	}

	return { state, toggleMenu, select }
})
