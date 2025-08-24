import { molecule } from 'bunshi'
import { proxy } from 'valtio'
import { HomeMolecule } from './home'

export interface AboutState {
	show: boolean
}

export const AboutMolecule = molecule((m) => {
	const home = m(HomeMolecule)

	const state = proxy<AboutState>({
		show: false,
	})

	function show() {
		home.toggleMenu(false)
		state.show = true
	}

	function close() {
		state.show = false
	}

	return { state, show, close } as const
})
