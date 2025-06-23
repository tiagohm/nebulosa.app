import { molecule } from 'bunshi'
import type { ImageTransformation } from 'src/api/types'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

// Molecule that applies the filter transformation to the image
export const ImageFilterMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)

	// Updates the filter transformation for a specific key
	function update<K extends keyof ImageTransformation['filter']>(key: K, value: ImageTransformation['filter'][K]) {
		viewer.state.transformation.filter[key] = value
	}

	// Resets the filter transformation to default values
	function reset() {
		viewer.state.transformation.filter.sharpen = false
		viewer.state.transformation.filter.blur = false
		viewer.state.transformation.filter.median = false
		return apply()
	}

	// Applies the filter transformation to the image
	function apply() {
		return viewer.load(true)
	}

	return { state: viewer.state.transformation.filter, scope, viewer, update, reset, apply }
})
