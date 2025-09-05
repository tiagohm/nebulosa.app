import { molecule } from 'bunshi'
import { DEFAULT_IMAGE_SCNR, type ImageTransformation } from 'src/shared/types'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

export const ImageScnrMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)
	const { scnr } = viewer.state.transformation

	function update<K extends keyof ImageTransformation['scnr']>(key: K, value: ImageTransformation['scnr'][K]) {
		scnr[key] = value
	}

	function reset() {
		scnr.method = DEFAULT_IMAGE_SCNR.method
		scnr.amount = DEFAULT_IMAGE_SCNR.amount
		scnr.channel = DEFAULT_IMAGE_SCNR.channel
		return apply()
	}

	function apply() {
		return viewer.load(true)
	}

	function hide() {
		viewer.hide('scnr')
	}

	return { state: scnr, scope, viewer, update, reset, apply, hide } as const
})
