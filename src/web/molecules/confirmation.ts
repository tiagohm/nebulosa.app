import { molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import type { Confirmation } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'

type ConfirmationPendingAction = 'accept' | 'reject'

export interface ConfirmationState {
	show: boolean
	key: string
	message: string
	pending?: ConfirmationPendingAction
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
		state.pending = undefined
		state.show = true
	}

	function hide() {
		state.show = false
		state.pending = undefined
		state.key = ''
		state.message = ''
	}

	async function answer(accepted: boolean) {
		if (state.pending || !state.key) return

		const key = state.key
		state.pending = accepted ? 'accept' : 'reject'
		if (!accepted) hide()

		try {
			await Api.Confirmation.confirm({ key, accepted })
		} catch {
			// Confirmation requests time out server-side if this best-effort response fails.
		} finally {
			if (accepted && state.key === key) hide()
		}
	}

	function accept() {
		return answer(true)
	}

	function reject() {
		return answer(false)
	}

	return { state, show, hide, accept, reject } as const
})
