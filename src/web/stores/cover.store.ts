import { Api } from '@shared/api'
import { equipmentStore } from '@stores/equipment.store'
import type { DeviceState } from '@stores/equipment.store'
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

	let mounted = false

	function mount() {
		if (mounted) return unmount
		console.info('cover mounted:', cover.name)
		mounted = true
		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('cover unmounted:', cover.name)
		mounted = false
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
