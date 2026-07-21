import { initProxy } from '@shared/proxy'
import type { ImageViewerStore } from '@stores/image.viewer.store'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'

export type ImageCrosshairStore = ReturnType<typeof imageCrosshairStore>

export interface ImageCrosshairState {
	enabled: boolean
}

export function imageCrosshairStore(viewer: ImageViewerStore) {
	const state = proxy<ImageCrosshairState>({
		enabled: false,
	})

	console.info('image crosshair created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image crosshair mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.crosshair`, ['p:enabled'])

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('image crosshair unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function update<K extends keyof ImageCrosshairState>(key: K, value: ImageCrosshairState[K]) {
		state[key] = value
	}

	function toggle() {
		state.enabled = !state.enabled
	}

	return {
		state,
		viewer,
		mount,
		unmount,
		update,
		toggle,
	} as const
}
