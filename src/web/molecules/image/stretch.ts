import { molecule, use } from 'bunshi'
import type { ImageTransformation } from 'src/shared/types'
import { ImageViewerMolecule } from './viewer'

export const ImageStretchMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const state = viewer.state.transformation.stretch

	function update<K extends keyof ImageTransformation['stretch']>(key: K, value: ImageTransformation['stretch'][K]) {
		state[key] = value
	}

	function auto() {
		return apply(true)
	}

	function reset() {
		state.auto = false
		state.midtone = 32768
		state.shadow = 0
		state.highlight = 65536
		return viewer.load(true)
	}

	function toggle() {
		if (state.auto) {
			return reset()
		} else {
			state.auto = true
			return viewer.load(true)
		}
	}

	function apply(auto: boolean = false) {
		state.auto = auto
		return viewer.load(true)
	}

	function show() {
		viewer.show('stretch')
	}

	function hide() {
		viewer.hide('stretch')
	}

	return { state, scope: viewer.scope, viewer, update, auto, reset, toggle, apply, show, hide } as const
})
