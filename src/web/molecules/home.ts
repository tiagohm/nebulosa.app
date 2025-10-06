import { molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import { persistProxy } from '@/shared/persist'

export interface HomeState {
	readonly menu: {
		show: boolean
	}
}

const { state } = persistProxy<HomeState>('home', () => ({
	menu: {
		show: false,
	},
}))

export const HomeMolecule = molecule((m) => {
	onMount(() => {
		const unsubscriber = bus.subscribe<boolean>('homeMenu:toggle', (enabled) => toggleMenu(enabled))

		return () => unsubscriber()
	})

	function toggleMenu(force?: boolean) {
		state.menu.show = force !== undefined ? force : !state.menu.show
	}

	return { state, toggleMenu } as const
})
