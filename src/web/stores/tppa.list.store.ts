import { deviceBus } from '@shared/bus'
import type { DeviceState } from '@stores/equipment.store'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import { proxy } from 'valtio'

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

deviceBus.subscribe('remove', (device) => {
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
