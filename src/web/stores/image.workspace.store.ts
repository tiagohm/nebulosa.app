import { initProxy } from '@shared/proxy'
import type { Image } from '@shared/types'
import type { DockviewReadyEvent } from 'dockview-react'
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

initProxy(state.picker, 'workspace.picker', ['p:path'])

function handleReady(event: DockviewReadyEvent) {}

export const imageWorkspaceStore = {
	state,
	handleReady,
} as const
