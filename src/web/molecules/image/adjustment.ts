import { molecule, onMount, use } from 'bunshi'
import { DEFAULT_IMAGE_ADJUSTMENT, type ImageAdjustment } from 'src/shared/types'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'
import { imageStorageKey } from '@/shared/types'
import { ImageViewerMolecule } from './viewer'

export interface ImageAdjustmentState {
	show: boolean
	adjustment: ImageAdjustment
}

const stateMap = new Map<string, ImageAdjustmentState>()

export const ImageAdjustmentMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const { key } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageAdjustmentState>({
			show: false,
			adjustment: viewer.state.transformation.adjustment,
		})

	stateMap.set(key, state)

	onMount(() => {
		const unsubscriber = initProxy(state, `image.${imageStorageKey(viewer.scope.image)}.adjustment`, ['p:show'])

		state.adjustment = viewer.state.transformation.adjustment

		return () => {
			unsubscriber()
		}
	})

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
		return viewer.load(true)
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, scope: viewer.scope, viewer, update, reset, apply, show, hide } as const
})
