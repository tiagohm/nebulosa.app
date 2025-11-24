import { molecule } from 'bunshi'
import bus from 'src/shared/bus'
import { proxy } from 'valtio'
import { populateProxy, subscribeProxy } from '@/shared/proxy'

export interface AboutState {
	show: boolean
}

const DEFAULT_ABOUT_STATE: AboutState = {
	show: false,
}

const PROPERTIES = ['show'] as const

const state = proxy(structuredClone(DEFAULT_ABOUT_STATE))
populateProxy(state, 'about', PROPERTIES)
subscribeProxy(state, 'about', PROPERTIES)

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
