import { DEFAULT_IMAGE_ADJUSTMENT, type ImageAdjustment } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { initProxy } from '../shared/proxy'
import type { ImageViewerStore } from './image.viewer.store'

export type ImageAdjustmentStore = ReturnType<typeof imageAdjustmentStore>

export interface ImageAdjustmentState {
	show: boolean
	readonly adjustment: ImageAdjustment
}

export function imageAdjustmentStore(viewer: ImageViewerStore) {
	const state = proxy<ImageAdjustmentState>({
		show: false,
		adjustment: viewer.state.transformation.adjustment,
	})

	console.info('image adjustment created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image adjustment mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.adjustment`, ['p:show'])
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
		update,
		reset,
		apply,
		show,
		hide,
	} as const
}
