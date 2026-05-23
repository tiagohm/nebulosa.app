import type { Camera, Mount } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import { proxy } from 'valtio'
import type { DeviceState } from './equipment.store'

export type DarvListStore = typeof darvListStore

export interface DarvItemState {
	show: boolean
	readonly camera: DeviceState<Camera>
	readonly mount: DeviceState<Mount>
}

export interface DarvListState {
	readonly list: DarvItemState[]
}

const state = proxy<DarvListState>({
	list: [],
})

bus.subscribe('device:remove', (device) => {
	const index = state.list.findIndex((e) => e.camera === device || e.mount === device)
	index >= 0 && state.list.splice(index, 1)
})

function show(camera: Camera, mount: Mount) {
	const darv = state.list.find((e) => e.camera === camera && e.mount === mount)

	if (darv === undefined) {
		state.list.push({ show: true, camera, mount })
	} else {
		darv.show = true
	}
}

function hide(camera: Camera, mount: Mount) {
	const index = state.list.findIndex((e) => e.camera === camera && e.mount === mount)
	index >= 0 && state.list.splice(index, 1)
}

export const darvListStore = {
	state,
	show,
	hide,
}
