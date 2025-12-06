import { molecule, use } from 'bunshi'
import { DEFAULT_IMAGE_TRANSFORMATION, type ImageTransformation } from 'src/shared/types'
import { type ImageState, ImageViewerMolecule, ImageViewerScope } from './viewer'

export const ImageSettingsMolecule = molecule(() => {
	const scope = use(ImageViewerScope)
	const viewer = use(ImageViewerMolecule)
	const { settings, transformation } = viewer.state

	function update<K extends keyof ImageState['settings']>(key: K, value: ImageState['settings'][K]) {
		settings[key] = value
		viewer.apply()
	}

	function updateFormat(format: ImageTransformation['format']) {
		transformation.format = format
		return viewer.load(true)
	}

	function reset() {
		const reload = transformation.format !== DEFAULT_IMAGE_TRANSFORMATION.format
		transformation.format = DEFAULT_IMAGE_TRANSFORMATION.format
		settings.pixelated = true
		viewer.apply()
		if (reload) void viewer.load(true)
	}

	function show() {
		viewer.show('settings')
	}

	function hide() {
		viewer.hide('settings')
	}

	return { state: settings, scope, viewer, update, updateFormat, reset, show, hide } as const
})
