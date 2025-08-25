import { molecule } from 'bunshi'
import bus from 'src/shared/bus'
import { proxy } from 'valtio'

export interface AboutState {
	show: boolean
}

export const AboutMolecule = molecule((m) => {
	const state = proxy<AboutState>({
		show: false,
	})

	function show() {
		bus.emit('homeMenu:toggle', false)
		state.show = true
	}

	function close() {
		state.show = false
	}

	return { state, show, close } as const
})
