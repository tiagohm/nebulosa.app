import type { Camera, Focuser } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import { proxy } from 'valtio'
import type { DeviceState } from './equipment.store'

export type AutoFocusListStore = typeof autoFocusListStore

export interface AutoFocusItemState {
	show: boolean
	readonly camera: DeviceState<Camera>
	readonly focuser: DeviceState<Focuser>
}

export interface AutoFocusListState {
	readonly list: AutoFocusItemState[]
}

const state = proxy<AutoFocusListState>({
	list: [],
})

bus.subscribe('device:remove', (device) => {
	const index = state.list.findIndex((e) => e.camera === device || e.focuser === device)
	index >= 0 && state.list.splice(index, 1)
})

function show(camera: Camera, focuser: Focuser) {
	const autoFocus = state.list.find((e) => e.camera === camera && e.focuser === focuser)

	if (autoFocus === undefined) {
		state.list.push({ show: true, camera, focuser: focuser })
	} else {
		autoFocus.show = true
	}
}

function hide(camera: Camera, focuser: Focuser) {
	const index = state.list.findIndex((e) => e.camera === camera && e.focuser === focuser)
	index >= 0 && state.list.splice(index, 1)
}

export const autoFocusListStore = {
	state,
	show,
	hide,
}
