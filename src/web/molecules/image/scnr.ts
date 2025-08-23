import { molecule } from 'bunshi'
import { DEFAULT_IMAGE_SCNR, type ImageTransformation } from 'src/shared/types'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

export const ImageScnrMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)

	function update<K extends keyof ImageTransformation['scnr']>(key: K, value: ImageTransformation['scnr'][K]) {
		viewer.state.transformation.scnr[key] = value
	}

	function reset() {
		viewer.state.transformation.scnr.method = DEFAULT_IMAGE_SCNR.method
		viewer.state.transformation.scnr.amount = DEFAULT_IMAGE_SCNR.amount
		viewer.state.transformation.scnr.channel = DEFAULT_IMAGE_SCNR.channel
		return apply()
	}

	function apply() {
		return viewer.load(true)
	}

	return { state: viewer.state.transformation.scnr, scope, viewer, update, reset, apply }
})
