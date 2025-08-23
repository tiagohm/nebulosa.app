import { molecule } from 'bunshi'
import type { ImageTransformation } from 'src/shared/types'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

export const ImageStretchMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)

	function update<K extends keyof ImageTransformation['stretch']>(key: K, value: ImageTransformation['stretch'][K]) {
		viewer.state.transformation.stretch[key] = value
	}

	function auto() {
		viewer.state.transformation.stretch.auto = true
		return apply()
	}

	function reset() {
		return viewer.resetStretch()
	}

	function apply() {
		return viewer.load(true)
	}

	return { state: viewer.state.transformation.stretch, scope, viewer, update, auto, reset, apply }
})
