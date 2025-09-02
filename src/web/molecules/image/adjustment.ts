import { molecule } from 'bunshi'
import type { ImageTransformation } from 'src/shared/types'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

export const ImageAdjustmentMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)

	function update<K extends keyof ImageTransformation['adjustment']>(key: K, value: ImageTransformation['adjustment'][K]) {
		viewer.state.transformation.adjustment[key] = value
	}

	function reset() {
		viewer.state.transformation.adjustment.brightness = 1
		viewer.state.transformation.adjustment.contrast = 1
		viewer.state.transformation.adjustment.gamma = 1
		viewer.state.transformation.adjustment.saturation = 1
		viewer.state.transformation.adjustment.normalize = false
		return apply()
	}

	function apply() {
		return viewer.load(true)
	}

	return { state: viewer.state.transformation.adjustment, scope, viewer, update, reset, apply }
})
