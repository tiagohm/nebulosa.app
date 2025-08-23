import { molecule } from 'bunshi'
import type { ImageTransformation } from 'src/shared/types'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

export const ImageFilterMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)

	function update<K extends keyof ImageTransformation['filter']>(key: K, value: ImageTransformation['filter'][K]) {
		viewer.state.transformation.filter[key] = value
	}

	function reset() {
		viewer.state.transformation.filter.sharpen = false
		viewer.state.transformation.filter.blur = false
		viewer.state.transformation.filter.median = false
		return apply()
	}

	function apply() {
		return viewer.load(true)
	}

	return { state: viewer.state.transformation.filter, scope, viewer, update, reset, apply }
})
