import { molecule, onMount } from 'bunshi'
import type { PHD2Settle } from 'nebulosa/src/phd2'
import bus from 'src/shared/bus'
import { DEFAULT_PHD2_CONNECT, DEFAULT_PHD2_EVENT, type PHD2Connect, type PHD2Event } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'

export interface PHD2State {
	show: boolean
	connected: boolean
	running: boolean
	readonly connection: PHD2Connect
	readonly event: PHD2Event
}

const state = proxy<PHD2State>({
	show: false,
	connected: false,
	running: false,
	connection: structuredClone(DEFAULT_PHD2_CONNECT),
	event: structuredClone(DEFAULT_PHD2_EVENT),
})

initProxy(state, 'phd2', ['p:show', 'o:connection'])

export const PHD2Molecule = molecule(() => {
	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(1)

		unsubscribers[0] = bus.subscribe<PHD2Event>('phd2', (event) => {
			Object.assign(state.event, event)
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function updateConnection<K extends keyof PHD2Connect>(key: K, value: PHD2Connect[K]) {
		state.connection[key] = value
	}

	function updateSettle<K extends keyof PHD2Settle>(key: K, value: PHD2Settle[K]) {
		state.connection.dither.settle[key] = value
	}

	async function connect() {
		if (!state.connected) {
			state.connected = (await Api.PHD2.connect(state.connection)) ?? false
		} else {
			await Api.PHD2.disconnect()
			state.connected = false
		}
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
		show,
		hide,
	} as const
})
