import { initProxy } from '@shared/proxy'
import type { ImageViewerStore } from '@stores/image.viewer.store'
import type { ImageTransformation } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'

export type ImageDebayerStore = ReturnType<typeof imageDebayerStore>

export interface ImageDebayerState {
	enabled: boolean
	transformation: ImageTransformation
}

export function imageDebayerStore(viewer: ImageViewerStore) {
	const state = proxy<ImageDebayerState>({
		enabled: false,
		transformation: viewer.state.transformation,
	})

	console.info('image debayer created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image debayer mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.debayer`, ['p:enabled'])

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('image debayer unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function update<K extends keyof ImageDebayerState>(key: K, value: ImageDebayerState[K]) {
		state[key] = value
	}

	function updateTransformation<K extends keyof ImageTransformation>(key: K, value: ImageTransformation[K]) {
		state.transformation[key] = value
	}

	return {
		state,
		viewer,
		mount,
		unmount,
		update,
		updateTransformation,
	} as const
}
