import type { DeviceType } from 'nebulosa/src/indi.device'
import { proxy } from 'valtio'
import type { PopoverMethods } from '../ui/components/Popover'

export type HomeMenuStore = typeof homeMenuStore

export interface HomeMenuState {
	selected: DeviceType
}

const state = proxy<HomeMenuState>({
	selected: 'camera',
})

let popoverMethods: PopoverMethods | null = null

function select(type: DeviceType) {
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
