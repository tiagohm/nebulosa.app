import { molecule, use } from 'bunshi'
import type { ImageTransformation } from 'src/shared/types'
import { ImageViewerMolecule } from './viewer'

export const ImageFilterMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const state = viewer.state.transformation.filter

	function update<K extends keyof ImageTransformation['filter']>(key: K, value: ImageTransformation['filter'][K]) {
		state[key] = value
	}

	function reset() {
		state.sharpen = false
		state.blur = false
		state.median = false
		return apply()
	}

	function apply() {
		return viewer.load(true)
	}

	function show() {
		viewer.show('filter')
	}

	function hide() {
		viewer.hide('filter')
	}

	return { state, scope: viewer.scope, viewer, update, reset, apply, show, hide } as const
})
