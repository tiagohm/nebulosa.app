import { molecule, use } from 'bunshi'
import type { ImageFormat } from 'nebulosa/src/image'
import { DEFAULT_IMAGE_TRANSFORMATION } from 'src/shared/types'
import { type ImageState, ImageViewerMolecule } from './viewer'

export const ImageSettingsMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const { settings: state, transformation } = viewer.state

	function update<K extends keyof ImageState['settings']>(key: K, value: ImageState['settings'][K]) {
		state[key] = value
		viewer.apply()
	}

	function updateFormat(format: ImageFormat) {
		transformation.format = format
		return viewer.load(true)
	}

	function reset() {
		const reload = transformation.format !== DEFAULT_IMAGE_TRANSFORMATION.format
		transformation.format = DEFAULT_IMAGE_TRANSFORMATION.format
		state.pixelated = true
		viewer.apply()
		if (reload) void viewer.load(true)
	}

	function show() {
		viewer.show('settings')
	}

	function hide() {
		viewer.hide('settings')
	}

	return { state, scope: viewer.scope, viewer, update, updateFormat, reset, show, hide } as const
})
