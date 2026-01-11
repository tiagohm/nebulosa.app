import { molecule, onMount } from 'bunshi'
import type { Device } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import type { AlpacaServerStatus } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'

export interface AlpacaState {
	show: boolean
	port: number
	readonly status: AlpacaServerStatus
}

const state = proxy<AlpacaState>({
	show: false,
	port: 2222,
	status: {
		running: false,
		port: 0,
		devices: [],
	},
})

initProxy(state, 'alpaca', ['p:show', 'p:port'])

export const AlpacaMolecule = molecule(() => {
	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(5)

		let timer: NodeJS.Timeout | undefined

		const updateStatus = (delayed: boolean) => {
			clearTimeout(timer)

			if (state.show) {
				if (delayed) timer = setTimeout(status, 2000)
				else void status()
			}
		}

		unsubscribers[0] = bus.subscribe<Device>('device:add', updateStatus.bind(undefined, true))
		unsubscribers[1] = bus.subscribe<Device>('device:remove', updateStatus.bind(undefined, true))
		unsubscribers[2] = bus.subscribe('alpaca:start', updateStatus.bind(undefined, false))
		unsubscribers[3] = bus.subscribe('alpaca:stop', updateStatus.bind(undefined, false))
		unsubscribers[4] = subscribeKey(state, 'show', updateStatus.bind(undefined, false))

		if (state.show) {
			void status()
		}

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	async function status() {
		const status = await Api.Alpaca.status()
		status && Object.assign(state.status, status)
	}

	function start() {
		return Api.Alpaca.start(state.port)
	}

	function stop() {
		return Api.Alpaca.stop()
	}

	function show() {
		bus.emit('homeMenu:toggle', false)
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, start, stop, show, hide } as const
})
