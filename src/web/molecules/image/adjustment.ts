import { molecule, use } from 'bunshi'
import type { ImageTransformation } from 'src/shared/types'
import { ImageViewerMolecule } from './viewer'

export const ImageAdjustmentMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const state = viewer.state.transformation.adjustment

	function update<K extends keyof ImageTransformation['adjustment']>(key: K, value: ImageTransformation['adjustment'][K]) {
		state[key] = value
	}

	function reset() {
		state.brightness = 1
		state.contrast = 1
		state.gamma = 1
		state.saturation = 1
		state.normalize = false
		return apply()
	}

	function apply() {
		return viewer.load(true)
	}

	function show() {
		viewer.show('adjustment')
	}

	function hide() {
		viewer.hide('adjustment')
	}

	return { state, scope: viewer.scope, viewer, update, reset, apply, show, hide } as const
})
