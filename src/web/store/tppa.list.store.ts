import type { Camera, Mount } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import { proxy } from 'valtio'
import type { DeviceState } from './equipment.store'

export type TppaListStore = typeof tppaListStore

export interface TppaItemState {
	show: boolean
	readonly camera: DeviceState<Camera>
	readonly mount: DeviceState<Mount>
}

export interface TppaListState {
	readonly list: TppaItemState[]
}

const state = proxy<TppaListState>({
	list: [],
})

bus.subscribe('device:remove', (device) => {
	const index = state.list.findIndex((e) => e.camera === device || e.mount === device)
	index >= 0 && state.list.splice(index, 1)
})

function show(camera: Camera, mount: Mount) {
	const tppa = state.list.find((e) => e.camera === camera && e.mount === mount)

	if (tppa === undefined) {
		state.list.push({ show: true, camera, mount })
	} else {
		tppa.show = true
	}
}

function hide(camera: Camera, mount: Mount) {
	const index = state.list.findIndex((e) => e.camera === camera && e.mount === mount)
	index >= 0 && state.list.splice(index, 1)
}

export const tppaListStore = {
	state,
	show,
	hide,
}
