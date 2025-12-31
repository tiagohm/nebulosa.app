import { molecule, onMount } from 'bunshi'
import type { AlpacaConfiguredDevice } from 'nebulosa/src/alpaca.types'
import type { Device } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'

export interface AlpacaState {
	show: boolean
	configuredDevices: AlpacaConfiguredDevice[]
}

const state = proxy<AlpacaState>({
	show: false,
	configuredDevices: [],
})

initProxy(state, 'alpaca', ['p:show'])

export const AlpacaMolecule = molecule(() => {
	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(2)

		let timer: NodeJS.Timeout | undefined

		unsubscribers[0] = bus.subscribe<Device>('device:add', (event) => {
			clearTimeout(timer)
			timer = setTimeout(list, 2000)
		})

		unsubscribers[1] = bus.subscribe<Device>('device:remove', (event) => {
			clearTimeout(timer)
			timer = setTimeout(list, 2000)
		})

		void list()

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	async function list() {
		const configuredDevices = await Api.Alpaca.list()
		if (configuredDevices) state.configuredDevices = configuredDevices
	}

	function show() {
		bus.emit('homeMenu:toggle', false)
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, show, hide } as const
})
