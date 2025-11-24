import { molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import { proxy } from 'valtio'
import { populateProxy, subscribeProxy } from '@/shared/proxy'

export interface HomeState {
	readonly menu: {
		show: boolean
	}
}

const DEFAULT_HOME_STATE: HomeState = {
	menu: {
		show: false,
	},
}

const MENU_PROPERTIES = ['show'] as const

const state = proxy(structuredClone(DEFAULT_HOME_STATE))
populateProxy(state.menu, 'home.menu', MENU_PROPERTIES)
subscribeProxy(state.menu, 'home.menu', MENU_PROPERTIES)

export const HomeMolecule = molecule((m) => {
	onMount(() => {
		const unsubscriber = bus.subscribe<boolean>('homeMenu:toggle', (enabled) => {
			toggleMenu(enabled)
		})

		return () => unsubscriber()
	})

	function toggleMenu(force?: boolean) {
		state.menu.show = force !== undefined ? force : !state.menu.show
	}

	return { state, toggleMenu } as const
})
