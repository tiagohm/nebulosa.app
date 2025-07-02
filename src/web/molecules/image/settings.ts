import { molecule, onMount } from 'bunshi'
import { DEFAULT_IMAGE_TRANSFORMATION, type ImageTransformation } from 'src/shared/types'
import { subscribe } from 'valtio'
import { simpleLocalStorage } from '@/shared/storage'
import { type ImageState, ImageViewerMolecule, ImageViewerScope } from './viewer'

// Molecule that manages the image settings
export const ImageSettingsMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)

	onMount(() => {
		const unsubscribe = subscribe(viewer.state.settings, () => simpleLocalStorage.set('image.settings', viewer.state.settings))

		return () => unsubscribe()
	})

	// Updates the image settings for a specific key
	function update<K extends keyof ImageState['settings']>(key: K, value: ImageState['settings'][K]) {
		viewer.state.settings[key] = value
		viewer.apply()
	}

	// Updates the image format
	function updateFormat(format: ImageTransformation['format']) {
		viewer.state.transformation.format = format
		return viewer.load(true)
	}

	// Resets the image settings to default values
	function reset() {
		const reload = viewer.state.transformation.format !== DEFAULT_IMAGE_TRANSFORMATION.format
		viewer.state.transformation.format = DEFAULT_IMAGE_TRANSFORMATION.format
		viewer.state.settings.pixelated = true
		viewer.apply()
		if (reload) void viewer.load(true)
	}

	return { state: viewer.state.settings, scope, viewer, update, updateFormat, reset }
})
