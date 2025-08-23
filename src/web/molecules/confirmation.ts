import { molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import type { Confirmation } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'

export interface ConfirmationState {
	show: boolean
	key: string
	message: string
}

export const ConfirmationMolecule = molecule((m) => {
	const state = proxy<ConfirmationState>({
		show: false,
		key: '',
		message: '',
	})

	onMount(() => {
		const unsubscriber = bus.subscribe('confirmation', show)

		return () => unsubscriber()
	})

	function show(confirmation: Confirmation) {
		state.key = confirmation.key
		state.message = confirmation.message
		state.show = true
	}

	function close() {
		state.show = false
	}

	function accept() {
		return Api.Confirmation.confirm({ key: state.key, accepted: true })
	}

	function reject() {
		return Api.Confirmation.confirm({ key: state.key, accepted: false })
	}

	return { state, show, close, accept, reject } as const
})
