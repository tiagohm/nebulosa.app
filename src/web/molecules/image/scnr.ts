import { molecule } from 'bunshi'
import { DEFAULT_IMAGE_SCNR, type ImageTransformation } from 'src/api/types'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

// Molecule that apply SCNR (Subtractive Color Noise Reduction) to the image
export const ImageScnrMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)

	// Updates the SCNR transformation for a specific key
	function update<K extends keyof ImageTransformation['scnr']>(key: K, value: ImageTransformation['scnr'][K]) {
		viewer.state.transformation.scnr[key] = value
	}

	function reset() {
		viewer.state.transformation.scnr.method = DEFAULT_IMAGE_SCNR.method
		viewer.state.transformation.scnr.amount = DEFAULT_IMAGE_SCNR.amount
		viewer.state.transformation.scnr.channel = DEFAULT_IMAGE_SCNR.channel
		return apply()
	}

	// Applies the SCNR transformation to the image
	function apply() {
		return viewer.load(true)
	}

	return { state: viewer.state.transformation.scnr, scope, viewer, update, reset, apply }
})
