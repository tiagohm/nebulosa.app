import { cameraBus } from '@shared/bus'
import type { DeviceState } from '@stores/equipment.store'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import { proxy } from 'valtio'

export type FlatWizardListStore = typeof flatWizardListStore

export interface FlatWizardItemState {
	show: boolean
	readonly camera: DeviceState<Camera>
}

export interface FlatWizardListState {
	camera?: DeviceState<Camera>
	readonly list: FlatWizardItemState[]
}

const state = proxy<FlatWizardListState>({
	camera: undefined,
	list: [],
})

cameraBus.subscribe('remove', (device) => {
	const index = state.list.findIndex((e) => e.camera === device)
	index >= 0 && state.list.splice(index, 1)
})

function setCamera(camera?: Camera) {
	state.camera = camera
}

function show() {
	const { camera } = state

	if (camera === undefined) return

	const flatWizard = state.list.find((e) => e.camera === camera)

	if (flatWizard === undefined) {
		state.list.push({ show: true, camera })
	} else {
		flatWizard.show = true
	}
}

function hide(camera: Camera) {
	const index = state.list.findIndex((e) => e.camera === camera)
	index >= 0 && state.list.splice(index, 1)
}

export const flatWizardListStore = {
	state,
	setCamera,
	show,
	hide,
}
