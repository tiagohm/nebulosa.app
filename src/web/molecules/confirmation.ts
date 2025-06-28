import { molecule, onMount } from 'bunshi'
import type { Confirmation } from 'src/api/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { BusMolecule } from './bus'

export interface ConfirmationState {
	show: boolean
	key: string
	message: string
}

// Molecule that manages confirmation dialog
export const ConfirmationMolecule = molecule((m) => {
	const bus = m(BusMolecule)

	const state = proxy<ConfirmationState>({
		show: false,
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
		state.show = true
	}

	// Closes the confirmation dialog
	function close() {
		state.show = false
	}

	// Accepts the confirmation, sending the accepted value to the API
	function accept() {
		return Api.Confirmation.confirm({ key: state.key, accepted: true })
	}

	// Rejects the confirmation, sending the accepted value to the API
	function reject() {
		return Api.Confirmation.confirm({ key: state.key, accepted: false })
	}

	return { state, show, close, accept, reject }
})
