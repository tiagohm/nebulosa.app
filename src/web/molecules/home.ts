import { molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'

export interface HomeState {
	readonly menu: {
		show: boolean
	}
}

const state = proxy<HomeState>({
	menu: {
		show: false,
	},
})

initProxy(state.menu, 'home.menu', ['p:show'])

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
