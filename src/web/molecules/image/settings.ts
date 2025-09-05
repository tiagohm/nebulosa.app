import { molecule, onMount } from 'bunshi'
import { DEFAULT_IMAGE_TRANSFORMATION, type ImageTransformation } from 'src/shared/types'
import { subscribe } from 'valtio'
import { simpleLocalStorage } from '@/shared/storage'
import { type ImageState, ImageViewerMolecule, ImageViewerScope } from './viewer'

export const ImageSettingsMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)
	const { settings, transformation } = viewer.state

	onMount(() => {
		const unsubscribe = subscribe(settings, () => {
			simpleLocalStorage.set('image.settings', settings)
		})

		return () => {
			unsubscribe()
		}
	})

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

	function hide() {
		viewer.hide('settings')
	}

	return { state: settings, scope, viewer, update, updateFormat, reset, hide } as const
})
