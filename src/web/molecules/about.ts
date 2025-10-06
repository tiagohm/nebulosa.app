import { molecule } from 'bunshi'
import bus from 'src/shared/bus'
import { persistProxy } from '@/shared/persist'

export interface AboutState {
	show: boolean
}

const { state } = persistProxy<AboutState>('about', () => ({
	show: false,
}))

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
