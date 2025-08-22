import { molecule, onMount } from 'bunshi'
import bus, { unsubscribe } from 'src/shared/bus'
import { DEFAULT_INDI_SERVER_START, type IndiServerStart } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'

export interface IndiServerState {
	running: boolean
	showModal: boolean
	request: IndiServerStart
}

// Molecule that manages the INDI server
export const IndiServerMolecule = molecule(() => {
	const request = simpleLocalStorage.get('indi.server', DEFAULT_INDI_SERVER_START)

	const state = proxy<IndiServerState>({
		running: false,
		showModal: false,
		request,
	})

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(3)

		unsubscribers[0] = bus.subscribe('indi:server:start', () => {
			state.running = true
		})

		unsubscribers[1] = bus.subscribe('indi:server:stop', () => {
			state.running = false
		})

		unsubscribers[2] = subscribe(state.request, () => simpleLocalStorage.set('indi.server', state.request))

		return () => unsubscribe(unsubscribers)
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
		state.showModal = true
	}

	function close() {
		state.showModal = false
	}

	return { state, update, start, stop, show, close }
})
