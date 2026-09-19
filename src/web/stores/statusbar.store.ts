import type { Icon } from '@ui/Icon'
import { proxy } from 'valtio'

export interface StatusBarItem {
	readonly id: string
	startContent?: Icon | string
	startContentClassName?: string
	endContent?: Icon | string
	endContentClassName?: string
	label?: string
	labelClassName?: string
	visible?: boolean
	items: StatusBarItem[]
}

export interface StatusBarState {
	readonly groups: StatusBarItem[]
}

const state = proxy<StatusBarState>({
	groups: [],
})

function mount() {}

function unmount() {}

function add(item: StatusBarItem, at?: number) {
	if (at !== undefined) {
		const index = Math.max(0, Math.min(at, state.groups.length))
		state.groups.splice(index, 0, item)
	} else {
		state.groups.push(item)
	}
}

export const statusBarStore = {
	state,
	mount,
	unmount,
	add,
} as const
