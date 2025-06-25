import { molecule } from 'bunshi'
import { proxy } from 'valtio'

export interface AboutState {
	showModal: boolean
}

// Molecule that manages the About modal
export const AboutMolecule = molecule(() => {
	const state = proxy<AboutState>({
		showModal: false,
	})

	// Shows the modal
	function show() {
		state.showModal = true
	}

	// Closes the modal
	function close() {
		state.showModal = false
	}

	return { state, show, close }
})
