import type { ImageViewerStore } from '@stores/image.viewer.store'
import { DEFAULT_IMAGE_ADJUSTMENT, type ImageAdjustment } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'

export type ImageAdjustmentStore = ReturnType<typeof imageAdjustmentStore>

export interface ImageAdjustmentState {
	readonly adjustment: ImageAdjustment
}

export function imageAdjustmentStore(viewer: ImageViewerStore) {
	const state = proxy<ImageAdjustmentState>({
		adjustment: viewer.state.transformation.adjustment,
	})

	console.info('image adjustment created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image adjustment mounted:', viewer.state.path)

		mounted = true

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('image adjustment unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function update<T extends keyof Exclude<ImageAdjustment, 'enabled'>, K extends keyof ImageAdjustment[T]>(type: T, key: K, value: ImageAdjustment[T][K]) {
		state.adjustment[type][key] = value
	}

	function reset() {
		Object.assign(state.adjustment.brightness, DEFAULT_IMAGE_ADJUSTMENT.brightness)
		Object.assign(state.adjustment.contrast, DEFAULT_IMAGE_ADJUSTMENT.contrast)
		Object.assign(state.adjustment.gamma, DEFAULT_IMAGE_ADJUSTMENT.gamma)
		Object.assign(state.adjustment.saturation, DEFAULT_IMAGE_ADJUSTMENT.saturation)
		return apply()
	}

	function apply() {
		return viewer.reload()
	}

	return {
		state,
		viewer,
		mount,
		unmount,
		update,
		reset,
		apply,
	} as const
}
