import { molecule, onMount } from 'bunshi'
import bus, { unsubscribe } from 'src/shared/bus'
import { DEFAULT_INDI_SERVER_START, type IndiServerStart } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { populateProxy, subscribeProxy } from '@/shared/proxy'

export interface IndiServerState {
	enabled: boolean
	running: boolean
	showAll: boolean
	show: boolean
	request: IndiServerStart
}

const DEFAULT_INDI_SERVER_STATE: IndiServerState = {
	enabled: true,
	running: false,
	showAll: false,
	show: false,
	request: DEFAULT_INDI_SERVER_START,
}

const PROPERTIES = ['show', 'showAll', 'request'] as const

const state = proxy(structuredClone(DEFAULT_INDI_SERVER_STATE))
populateProxy(state, 'indi.server', PROPERTIES)
subscribeProxy(state, 'indi.server', PROPERTIES)

export const IndiServerMolecule = molecule(() => {
	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(2)

		unsubscribers[0] = bus.subscribe('indi:server:start', () => {
			state.running = true
		})

		unsubscribers[1] = bus.subscribe('indi:server:stop', () => {
			state.running = false
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	void Api.Indi.Server.status().then((status) => {
		status && Object.assign(state, status)
	})

	function update<K extends keyof IndiServerStart>(key: K, value: IndiServerStart[K]) {
		state.request[key] = value
	}

	function start() {
		return Api.Indi.Server.start(state.request)
	}

	function stop() {
		return Api.Indi.Server.stop()
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, update, start, stop, show, hide }
})
