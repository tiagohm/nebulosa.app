import { molecule } from 'bunshi'
import type { ImageTransformation } from 'src/api/types'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

// Molecule that apply SCNR (Subtractive Color Noise Reduction) to the image
export const ImageScnrMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)

	// Updates the SCNR transformation for a specific key
	function update<K extends keyof ImageTransformation['scnr']>(key: K, value: ImageTransformation['scnr'][K]) {
		viewer.state.transformation.scnr[key] = value
	}

	// Applies the SCNR transformation to the image
	function apply() {
		return viewer.load(true)
	}

	return { state: viewer.state.transformation.scnr, scope, viewer, update, apply }
})
