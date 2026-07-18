import { Api } from '@shared/api'
import { equipmentStore, type DeviceState } from '@stores/equipment.store'
import type { Cover } from 'nebulosa/src/devices/indi/device'
import { proxy } from 'valtio'

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
		return unmount
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

	return {
		state,
		mount,
		unmount,
		connect,
		park,
		unpark,
		stop,
	} as const
}
