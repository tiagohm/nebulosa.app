import { molecule } from 'bunshi'
import bus from 'src/shared/bus'
import { proxy } from 'valtio'

export interface AboutState {
	show: boolean
}

const state = proxy<AboutState>({
	show: false,
})

export const AboutMolecule = molecule(() => {
	function show() {
		bus.emit('homeMenu:toggle', false)
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, show, hide } as const
})
