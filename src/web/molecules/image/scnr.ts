import { molecule } from 'bunshi'
import { DEFAULT_IMAGE_SCNR, type ImageTransformation } from 'src/shared/types'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

export const ImageScnrMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)
	const state = viewer.state.transformation.scnr

	function update<K extends keyof ImageTransformation['scnr']>(key: K, value: ImageTransformation['scnr'][K]) {
		state[key] = value
	}

	function reset() {
		state.method = DEFAULT_IMAGE_SCNR.method
		state.amount = DEFAULT_IMAGE_SCNR.amount
		state.channel = DEFAULT_IMAGE_SCNR.channel
		return apply()
	}

	function apply() {
		return viewer.load(true)
	}

	function show() {
		viewer.show('scnr')
	}

	function hide() {
		viewer.hide('scnr')
	}

	return { state, scope, viewer, update, reset, apply, show, hide } as const
})
