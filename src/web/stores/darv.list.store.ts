import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
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
	camera?: DeviceState<Camera>
	mount?: DeviceState<Mount>
	readonly list: DarvItemState[]
}

const state = proxy<DarvListState>({
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
	setCamera,
	setMount,
	show,
	hide,
}
