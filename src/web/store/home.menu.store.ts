import type { DeviceType } from 'nebulosa/src/indi.device'
import { proxy } from 'valtio'

export interface HomeMenuState {
	selected: DeviceType
}

const state = proxy<HomeMenuState>({
	selected: 'CAMERA',
})

function select(type: DeviceType) {
	state.selected = type
}

export const homeMenu = {
	state,
	select,
} as const
