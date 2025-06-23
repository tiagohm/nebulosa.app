import { molecule } from 'bunshi'
import type { ImageTransformation } from 'src/api/types'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

// Molecule that applies the adjustment transformation to the image
export const ImageAdjustmentMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)

	// Updates the adjustment transformation for a specific key
	function update<K extends keyof ImageTransformation['adjustment']>(key: K, value: ImageTransformation['adjustment'][K]) {
		viewer.state.transformation.adjustment[key] = value
	}

	// Resets the adjustment transformation to default values
	function reset() {
		viewer.state.transformation.adjustment.brightness = 1
		viewer.state.transformation.adjustment.gamma = 1
		viewer.state.transformation.adjustment.saturation = 1
		viewer.state.transformation.adjustment.normalize = false
		return apply()
	}

	// Applies the adjustment transformation to the image
	function apply() {
		return viewer.load(true)
	}

	return { state: viewer.state.transformation.adjustment, scope, viewer, update, reset, apply }
})
