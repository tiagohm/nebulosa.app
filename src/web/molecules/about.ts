import { molecule } from 'bunshi'
import { proxy } from 'valtio'
import { HomeMolecule } from './home'

export interface AboutState {
	showModal: boolean
}

// Molecule that manages the About modal
export const AboutMolecule = molecule((m) => {
	const home = m(HomeMolecule)

	const state = proxy<AboutState>({
		showModal: false,
	})

	// Shows the modal
	function show() {
		home.toggleMenu(false)
		state.showModal = true
	}

	// Closes the modal
	function close() {
		state.showModal = false
	}

	return { state, show, close }
})
