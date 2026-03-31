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

const state = proxy<ConfirmationState>({
	show: false,
	key: '',
	message: '',
})

export const ConfirmationMolecule = molecule(() => {
	onMount(() => {
		const unsubscriber = bus.subscribe<Confirmation>('confirmation', show)

		return () => {
			unsubscriber()
		}
	})

	function show(confirmation: Confirmation) {
		state.key = confirmation.key
		state.message = confirmation.message
		state.show = true
	}

	function hide() {
		state.show = false
	}

	async function accept() {
		await Api.Confirmation.confirm({ key: state.key, accepted: true })
		hide()
	}

	async function reject() {
		await Api.Confirmation.confirm({ key: state.key, accepted: false })
		hide()
	}

	return { state, show, hide, accept, reject } as const
})
