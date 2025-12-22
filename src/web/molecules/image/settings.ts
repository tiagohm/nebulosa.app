import { molecule, onMount, use } from 'bunshi'
import type { ImageFormat } from 'nebulosa/src/image'
import { DEFAULT_IMAGE_TRANSFORMATION, type ImageTransformation } from 'src/shared/types'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'
import { imageStorageKey } from '@/shared/types'
import { ImageViewerMolecule } from './viewer'

export interface ImageSettingsState {
	show: boolean
	pixelated: boolean
	format: ImageFormat
	formatOptions: ImageTransformation['formatOptions']
}

const stateMap = new Map<string, ImageSettingsState>()

export const ImageSettingsMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const { key } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageSettingsState>({
			show: false,
			pixelated: false,
			format: viewer.state.transformation.format,
			formatOptions: viewer.state.transformation.formatOptions,
		})

	stateMap.set(key, state)

	onMount(() => {
		const unsubscriber = initProxy(state, `image.${imageStorageKey(viewer.scope.image)}.settings`, ['p:show', 'p:pixelated'])

		state.formatOptions = viewer.state.transformation.formatOptions

		update('pixelated', state.pixelated)

		return () => {
			unsubscriber()
		}
	})

	function update<K extends keyof ImageSettingsState>(key: K, value: ImageSettingsState[K]) {
		state[key] = value

		if (key === 'format') viewer.state.transformation.format = value as never
		else if (key === 'pixelated') viewer.target?.classList.toggle('pixelated', value as never)
	}

	function updateFormatOptions<F extends 'jpeg', K extends keyof ImageSettingsState['formatOptions'][F]>(format: F, key: K, value: ImageSettingsState['formatOptions'][F][K]) {
		state.formatOptions[format][key] = value
	}

	function reset() {
		state.pixelated = true
		update('format', 'jpeg')
		Object.assign(state.formatOptions.jpeg, DEFAULT_IMAGE_TRANSFORMATION.formatOptions.jpeg)
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, scope: viewer.scope, viewer, update, updateFormatOptions, reset, show, hide } as const
})
