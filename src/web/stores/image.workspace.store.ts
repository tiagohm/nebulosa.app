import { initProxy } from '@shared/proxy'
import type { Image } from '@shared/types'
import type { DockviewReadyEvent } from 'dockview-react'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'

export type ImageWorkspaceStore = typeof imageWorkspaceStore

export type ImageWorkspaceEventType = 'add' | 'remove' | 'update'

export interface ImageWorkspaceState {
	readonly images: Image[]
	selected?: Image
	readonly picker: {
		show: boolean
		path: string
	}
}

const state = proxy<ImageWorkspaceState>({
	images: [],
	picker: {
		show: false,
		path: '',
	},
})

let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return

	console.info('galaxy mounted')

	mounted = true

	u[0] = initProxy(state.picker, 'workspace.picker', ['p:path'])

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('galaxy unmounted')
	unsubscribe(u)
	mounted = false
}

function handleReady(event: DockviewReadyEvent) {}

export const imageWorkspaceStore = {
	state,
	mount,
	unmount,
	handleReady,
} as const
