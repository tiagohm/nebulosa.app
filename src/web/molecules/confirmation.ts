import { molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import type { Confirmation } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'

export interface ConfirmationState {
	showModal: boolean
	key: string
	message: string
}

// Molecule that manages confirmation dialog
export const ConfirmationMolecule = molecule((m) => {
	const state = proxy<ConfirmationState>({
		showModal: false,
		key: '',
		message: '',
	})

	onMount(() => {
		const unsubscriber = bus.subscribe('confirmation', show)

		return () => unsubscriber()
	})

	// Shows the confirmation dialog with the provided confirmation data
	function show(confirmation: Confirmation) {
		state.key = confirmation.key
		state.message = confirmation.message
		state.showModal = true
	}

	// Closes the confirmation dialog
	function close() {
		state.showModal = false
	}

	// Accepts the confirmation, sending the accepted value to the API
	function accept() {
		return Api.Confirmation.confirm({ key: state.key, accepted: true })
	}

	// Rejects the confirmation, sending the accepted value to the API
	function reject() {
		return Api.Confirmation.confirm({ key: state.key, accepted: false })
	}

	return { state, show, close, accept, reject } as const
})
