import { molecule, use } from 'bunshi'
import type { ImageTransformation } from 'src/shared/types'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

export const ImageStretchMolecule = molecule(() => {
	const scope = use(ImageViewerScope)
	const viewer = use(ImageViewerMolecule)
	const { stretch } = viewer.state.transformation

	function update<K extends keyof ImageTransformation['stretch']>(key: K, value: ImageTransformation['stretch'][K]) {
		stretch[key] = value
	}

	function auto() {
		return apply(true)
	}

	function reset() {
		return viewer.resetStretch()
	}

	function apply(auto: boolean = false) {
		stretch.auto = auto
		return viewer.load(true)
	}

	function show() {
		viewer.show('stretch')
	}

	function hide() {
		viewer.hide('stretch')
	}

	return { state: stretch, scope, viewer, update, auto, reset, apply, show, hide } as const
})
