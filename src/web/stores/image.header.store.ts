import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { initProxy } from '../shared/proxy'
import type { ImageViewerStore } from './image.viewer.store'

export type ImageHeaderStore = ReturnType<typeof imageHeaderStore>

export interface ImageHeaderState {
	show: boolean
}

export function imageHeaderStore(viewer: ImageViewerStore) {
	const state = proxy<ImageHeaderState>({
		show: false,
	})

	console.info('image header created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image header mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.header`, ['p:show'])
	}

	function unmount() {
		if (!mounted) return
		console.info('image header unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return {
		state,
		viewer,
		mount,
		unmount,
		show,
		hide,
	} as const
}
