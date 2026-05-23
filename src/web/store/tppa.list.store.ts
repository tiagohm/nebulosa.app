import type { Camera, Mount } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import { proxy } from 'valtio'
import { equipmentStore, type DeviceState } from './equipment.store'

export type TppaListStore = typeof tppaListStore

export interface TppaItemState {
	show: boolean
	readonly camera: DeviceState<Camera>
	readonly mount: DeviceState<Mount>
}

export interface TppaListState {
	camera?: DeviceState<Camera>
	mount?: DeviceState<Mount>
	readonly list: TppaItemState[]
}

const state = proxy<TppaListState>({
	camera: undefined,
	mount: undefined,
	list: [],
})

bus.subscribe('device:remove', (device) => {
	const index = state.list.findIndex((e) => e.camera === device || e.mount === device)
	index >= 0 && state.list.splice(index, 1)
})

function setCamera(camera?: Camera) {
	state.camera = camera
}

function setMount(mount?: Mount) {
	state.mount = mount
}

function show() {
	const { camera, mount } = state

	if (camera === undefined || mount === undefined) return

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
	setCamera,
	setMount,
	show,
	hide,
}
