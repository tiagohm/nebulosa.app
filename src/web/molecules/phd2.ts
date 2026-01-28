import { molecule } from 'bunshi'
import bus from 'src/shared/bus'
import type { PHD2Connect, PHD2Start } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'

export interface PHD2State {
	show: boolean
	connected: boolean
	running: boolean
	readonly connection: PHD2Connect
	readonly request: Required<PHD2Start>
}

const state = proxy<PHD2State>({
	show: false,
	connected: false,
	running: false,
	connection: {
		host: 'localhost',
		port: 4400,
	},
	request: {
		settle: {
			pixels: 1.5, // px
			time: 10, // s
			timeout: 30, // s
		},
	},
})

initProxy(state, 'phd2', ['p:show', 'o:connection', 'o:request'])

export const PHD2Molecule = molecule(() => {
	function updateConnection<K extends keyof PHD2Connect>(key: K, value: PHD2Connect[K]) {
		state.connection[key] = value
	}

	function updateSettle<K extends keyof PHD2State['request']['settle']>(key: K, value: PHD2State['request']['settle'][K]) {
		state.request.settle[key] = value
	}

	async function connect() {
		if (!state.connected) {
			state.connected = (await Api.PHD2.connect(state.connection)) ?? false
		} else {
			await Api.PHD2.disconnect()
			state.connected = false
		}
	}

	function start() {
		return Api.PHD2.start(state.request)
	}

	function stop() {
		return Api.PHD2.stop()
	}

	function show() {
		bus.emit('homeMenu:toggle', false)
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return {
		state,
		updateConnection,
		updateSettle,
		connect,
		start,
		stop,
		show,
		hide,
	} as const
})
