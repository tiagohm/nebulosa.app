import type { Cover } from 'nebulosa/src/devices/indi/device'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { equipmentStore, type DeviceState } from './equipment.store'

export type CoverStore = ReturnType<typeof coverStore>

export interface CoverState {
	cover: DeviceState<Cover>
}

export function coverStore(cover: Cover) {
	const state = proxy<CoverState>({
		cover,
	})

	console.info('cover created:', cover.name)

	function mount() {
		console.info('cover mounted:', cover.name)
	}

	function unmount() {
		console.info('cover unmounted:', cover.name)
	}

	function connect() {
		return equipmentStore.connect(cover)
	}

	function park() {
		return Api.Covers.park(cover)
	}

	function unpark() {
		return Api.Covers.unpark(cover)
	}

	function stop() {
		return Api.Covers.stop(cover)
	}

	function show() {
		return equipmentStore.show(cover)
	}

	function hide() {
		return equipmentStore.hide(cover)
	}

	return {
		state,
		mount,
		unmount,
		connect,
		park,
		unpark,
		stop,
		show,
		hide,
	} as const
}
