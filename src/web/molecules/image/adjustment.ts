import { molecule, onMount, use } from 'bunshi'
import type { ImageAdjustment } from 'src/shared/types'
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

	function update<K extends keyof ImageAdjustment>(key: K, value: ImageAdjustment[K]) {
		state.adjustment[key] = value
	}

	function reset() {
		state.adjustment.brightness = 1
		state.adjustment.contrast = 1
		state.adjustment.gamma = 1
		state.adjustment.saturation = 1
		state.adjustment.normalize = false
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
