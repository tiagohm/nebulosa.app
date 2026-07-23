import { initProxy } from '@shared/proxy'
import type { ImageViewerStore } from '@stores/image.viewer.store'
import type { ChrominanceSubsampling } from 'nebulosa/src/bindings/imaging/libturbojpeg'
import type { ImageFormat } from 'nebulosa/src/imaging/model/types'
import { DEFAULT_IMAGE_TRANSFORMATION, type ImageTransformation } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'

export type ImageSettingsStore = ReturnType<typeof imageSettingsStore>

export interface ImageSettingsState {
	pixelated: boolean
	transformation: ImageTransformation
}

export function imageSettingsStore(viewer: ImageViewerStore) {
	const state = proxy<ImageSettingsState>({
		pixelated: false,
		transformation: viewer.state.transformation,
	})

	console.info('image settings created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return unmount

		console.info('image settings mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.settings`, ['p:pixelated'])

		setPixelated(state.pixelated)

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('image settings unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function setPixelated(value: boolean) {
		state.pixelated = value
		viewer.toggleClass('pixelated', value)
	}

	function setFormatType(value: ImageFormat) {
		state.transformation.format.type = value
	}

	function setJpegQuality(value: number) {
		state.transformation.format.jpeg.quality = value
	}

	function setJpegChrominanceSubsampling(value: ChrominanceSubsampling) {
		state.transformation.format.jpeg.chrominanceSubsampling = value
	}

	function reset() {
		state.pixelated = true
		state.transformation.format.type = DEFAULT_IMAGE_TRANSFORMATION.format.type
		Object.assign(state.transformation.format.jpeg, DEFAULT_IMAGE_TRANSFORMATION.format.jpeg)
		return apply()
	}

	function apply() {
		viewer.toggleClass('pixelated', state.pixelated)
		return viewer.reload()
	}

	return {
		state,
		viewer,
		mount,
		unmount,
		setPixelated,
		setFormatType,
		setJpegQuality,
		setJpegChrominanceSubsampling,
		reset,
		apply,
	} as const
}
