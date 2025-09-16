import { molecule } from 'bunshi'
import type { ImageTransformation } from 'src/shared/types'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

export const ImageFilterMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)
	const { filter } = viewer.state.transformation

	function update<K extends keyof ImageTransformation['filter']>(key: K, value: ImageTransformation['filter'][K]) {
		filter[key] = value
	}

	function reset() {
		filter.sharpen = false
		filter.blur = false
		filter.median = false
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

	return { state: filter, scope, viewer, update, reset, apply, show, hide } as const
})
