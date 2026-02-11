import { molecule, onMount } from 'bunshi'
import type { PHD2Settle } from 'nebulosa/src/phd2'
import bus from 'src/shared/bus'
import { DEFAULT_PHD2_CONNECT, DEFAULT_PHD2_EVENT, type PHD2Connect, type PHD2Dither, type PHD2Event, type PHD2Status } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'

export interface PHD2State extends PHD2Status {
	show: boolean
	readonly connection: PHD2Connect
	readonly event: PHD2Event
	index: number
}

const state = proxy<PHD2State>({
	show: false,
	connected: false,
	running: false,
	connection: structuredClone(DEFAULT_PHD2_CONNECT),
	event: structuredClone(DEFAULT_PHD2_EVENT),
	index: 0,
})

initProxy(state, 'phd2', ['p:show', 'o:connection'])

export const PHD2Molecule = molecule(() => {
	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(3)

		unsubscribers[0] = bus.subscribe<PHD2Event>('phd2', (event) => {
			if (!state.connected) return

			Object.assign(state.event, event)

			state.running = state.event.state === 'GUIDING'
		})

		unsubscribers[1] = bus.subscribe('phd2:close', () => {
			state.connected = false
			state.running = false
			state.profile = undefined
		})

		unsubscribers[2] = subscribeKey(state, 'show', (show) => {
			if (show) {
				void load()
			}
		})

		if (state.show) {
			void load()
		}

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	async function load() {
		const status = await Api.PHD2.status()
		status && Object.assign(state, status)

		const event = await Api.PHD2.event()
		event && Object.assign(state.event, event)
	}

	function updateConnection<K extends keyof PHD2Connect>(key: K, value: PHD2Connect[K]) {
		state.connection[key] = value
	}

	function updateDither<K extends keyof PHD2Dither>(key: K, value: PHD2Dither[K]) {
		state.connection.dither[key] = value
	}

	function updateSettle<K extends keyof PHD2Settle>(key: K, value: PHD2Settle[K]) {
		state.connection.dither.settle[key] = value
	}

	async function connect() {
		if (!state.connected) {
			await Api.PHD2.connect(state.connection)
			await load()
		} else {
			await Api.PHD2.disconnect()
		}
	}

	function clear() {
		state.event.rmsRA = 0
		state.event.rmsDEC = 0
		state.index = 0
		return Api.PHD2.clear()
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
		updateDither,
		updateSettle,
		connect,
		clear,
		show,
		hide,
	} as const
})
