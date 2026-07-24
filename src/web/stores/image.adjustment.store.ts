import type { ImageViewerStore } from '@stores/image.viewer.store'
import type { ImageChannelOrGray } from 'nebulosa/src/imaging/model/types'
import { DEFAULT_IMAGE_ADJUSTMENT } from 'src/shared/types'
import type { ImageAdjustment } from 'src/shared/types'
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
		if (mounted) return unmount

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

	function setBrightness(value: number) {
		state.adjustment.brightness.value = value
	}

	function setContrast(value: number) {
		state.adjustment.contrast.value = value
	}

	function setGamma(value: number) {
		state.adjustment.gamma.value = value
	}

	function setSaturationLevel(value: number) {
		state.adjustment.saturation.value = value
	}

	function setSaturationChannel(value: ImageChannelOrGray) {
		state.adjustment.saturation.channel = value
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
		setBrightness,
		setContrast,
		setGamma,
		setSaturationLevel,
		setSaturationChannel,
		reset,
		apply,
	} as const
}
