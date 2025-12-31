import { molecule, onMount } from 'bunshi'
import type { Device } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import type { AlpacaServerStatus } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'

export interface AlpacaState {
	show: boolean
	readonly status: AlpacaServerStatus
}

const state = proxy<AlpacaState>({
	show: false,
	status: {
		running: false,
		port: 0,
		devices: [],
	},
})

initProxy(state, 'alpaca', ['p:show'])

export const AlpacaMolecule = molecule(() => {
	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(4)

		let timer: NodeJS.Timeout | undefined

		unsubscribers[0] = bus.subscribe<Device>('device:add', () => {
			clearTimeout(timer)
			timer = setTimeout(status, 2000)
		})

		unsubscribers[1] = bus.subscribe<Device>('device:remove', () => {
			clearTimeout(timer)
			timer = setTimeout(status, 2000)
		})

		unsubscribers[2] = bus.subscribe('alpaca:start', () => {
			void status()
		})

		unsubscribers[3] = bus.subscribe('alpaca:stop', () => {
			void status()
		})

		void status()

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	async function status() {
		const status = await Api.Alpaca.status()
		status && Object.assign(state.status, status)
	}

	function start() {
		return Api.Alpaca.start()
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
