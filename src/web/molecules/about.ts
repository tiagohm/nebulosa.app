import { molecule } from 'bunshi'
import { proxy } from 'valtio'
import { HomeMolecule } from './home'

export interface AboutState {
	showModal: boolean
}

export const AboutMolecule = molecule((m) => {
	const home = m(HomeMolecule)

	const state = proxy<AboutState>({
		showModal: false,
	})

	function show() {
		home.toggleMenu(false)
		state.showModal = true
	}

	function close() {
		state.showModal = false
	}

	return { state, show, close } as const
})
