import { molecule } from 'bunshi'
import bus from 'src/shared/bus'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'

export interface AboutState {
	show: boolean
	year: number
}

const state = proxy<AboutState>({
	show: false,
	year: new Date().getFullYear(),
})

initProxy(state, 'about', ['p:show'])

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
