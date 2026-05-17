import { proxy } from 'valtio'
import { initProxy } from '../shared/proxy'

export type AboutStore = typeof aboutStore

export interface AboutState {
	show: boolean
	year: number
}

const state = proxy<AboutState>({
	show: false,
	year: Temporal.Now.plainDateISO().year,
})

initProxy(state, 'about', ['p:show'])

function show() {
	state.show = true
}

function hide() {
	state.show = false
}

export const aboutStore = {
	state,
	show,
	hide,
} as const
