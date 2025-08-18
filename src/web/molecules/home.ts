import { molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import { proxy } from 'valtio'

export interface HomeState {
	readonly menu: {
		show: boolean
	}
}

// Molecule that manages the home
export const HomeMolecule = molecule((m) => {
	const state = proxy<HomeState>({
		menu: {
			show: false,
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

	return { state, toggleMenu } as const
})
