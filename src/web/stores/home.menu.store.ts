import type { DeviceType } from 'nebulosa/src/indi.device'
import { proxy } from 'valtio'
import { initProxy } from '../shared/proxy'
import type { PopoverMethods } from '../ui/components/Popover'

export type HomeMenuStore = typeof homeMenuStore

export type HomeMenuSelectionType = DeviceType | 'tppa' | 'darv' | 'autoFocus' | 'flatWizard'

export interface HomeMenuState {
	selected: HomeMenuSelectionType
}

const state = proxy<HomeMenuState>({
	selected: 'camera',
})

initProxy(state, 'home.menu', ['p:selected'])

export function isDevice(type: HomeMenuSelectionType): type is DeviceType {
	return type !== 'tppa' && type !== 'darv' && type !== 'autoFocus' && type !== 'flatWizard'
}

let popoverMethods: PopoverMethods | null = null

function select(type: HomeMenuSelectionType) {
	state.selected = type
}

function toggle(force?: boolean) {
	if (force === true) show()
	else if (force === false) hide()
	else popoverMethods?.toggle()
}

function show() {
	popoverMethods?.show()
}

function hide() {
	popoverMethods?.hide()
}

function popover(ref: PopoverMethods | null) {
	popoverMethods = ref
}

export const homeMenuStore = {
	state,
	select,
	toggle,
	popover,
	show,
	hide,
} as const
