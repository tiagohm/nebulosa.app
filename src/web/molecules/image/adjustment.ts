import { molecule, use } from 'bunshi'
import type { ImageTransformation } from 'src/shared/types'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

export const ImageAdjustmentMolecule = molecule(() => {
	const scope = use(ImageViewerScope)
	const viewer = use(ImageViewerMolecule)
	const { adjustment } = viewer.state.transformation

	function update<K extends keyof ImageTransformation['adjustment']>(key: K, value: ImageTransformation['adjustment'][K]) {
		adjustment[key] = value
	}

	function reset() {
		adjustment.brightness = 1
		adjustment.contrast = 1
		adjustment.gamma = 1
		adjustment.saturation = 1
		adjustment.normalize = false
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

	return { state: adjustment, scope, viewer, update, reset, apply, show, hide } as const
})
