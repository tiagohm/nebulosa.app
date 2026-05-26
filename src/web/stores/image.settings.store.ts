import type { ImageFormat } from 'nebulosa/src/image.types'
import { DEFAULT_IMAGE_TRANSFORMATION, type ImageTransformation } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { initProxy } from '../shared/proxy'
import type { ImageViewerStore } from './image.viewer.store'

export type ImageSettingsStore = ReturnType<typeof imageSettingsStore>

export interface ImageSettingsState {
	show: boolean
	pixelated: boolean
	transformation: ImageTransformation
}

export function imageSettingsStore(viewer: ImageViewerStore) {
	const state = proxy<ImageSettingsState>({
		show: false,
		pixelated: false,
		transformation: viewer.state.transformation,
	})

	console.info('image settings created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image settings mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.settings`, ['p:show', 'p:pixelated'])

		update('pixelated', state.pixelated)
	}

	function unmount() {
		if (!mounted) return
		console.info('image settings unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function update<K extends keyof ImageSettingsState>(key: K, value: ImageSettingsState[K]) {
		state[key] = value

		if (key === 'pixelated') viewer.toggleClass('pixelated', value as boolean)
	}

	function updateTransformation<K extends keyof ImageTransformation>(key: K, value: ImageTransformation[K]) {
		state.transformation[key] = value
	}

	function updateFormatType(value: ImageFormat) {
		state.transformation.format.type = value
	}

	function updateFormat<F extends 'jpeg', K extends keyof ImageTransformation['format'][F]>(format: F, key: K, value: ImageTransformation['format'][F][K]) {
		state.transformation.format[format][key] = value
	}

	function reset() {
		state.pixelated = true
		state.transformation.cfaPattern = 'AUTO'
		state.transformation.format.type = DEFAULT_IMAGE_TRANSFORMATION.format.type
		Object.assign(state.transformation.format.jpeg, DEFAULT_IMAGE_TRANSFORMATION.format.jpeg)
		return apply()
	}

	function apply() {
		viewer.toggleClass('pixelated', state.pixelated)
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
		updateTransformation,
		updateFormatType,
		updateFormat,
		reset,
		apply,
		show,
		hide,
	} as const
}
