import { molecule } from 'bunshi'
import type { ImageTransformation } from 'src/api/types'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

// Molecule that stretches the image
export const ImageStretchMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)

	// Updates the stretch transformation for a specific key
	function update<K extends keyof ImageTransformation['stretch']>(key: K, value: ImageTransformation['stretch'][K]) {
		viewer.state.transformation.stretch[key] = value
	}

	// Apply the auto-stretch transformation to the image
	function auto() {
		return apply(true)
	}

	// Resets the stretch transformation to default values
	function reset() {
		viewer.state.transformation.stretch.midtone = 32768
		viewer.state.transformation.stretch.shadow = 0
		viewer.state.transformation.stretch.highlight = 65536
		return apply()
	}

	// Applies the stretch transformation to the image
	function apply(auto: boolean = false) {
		viewer.state.transformation.stretch.auto = auto
		return viewer.load(true)
	}

	return { state: viewer.state.transformation.stretch, scope, viewer, update, auto, reset, apply }
})
