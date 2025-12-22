import { molecule, onMount, use } from 'bunshi'
import type { ImageFormat } from 'nebulosa/src/image.types'
import { DEFAULT_IMAGE_TRANSFORMATION, type ImageTransformation } from 'src/shared/types'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'
import { imageStorageKey } from '@/shared/types'
import { ImageViewerMolecule } from './viewer'

export interface ImageSettingsState {
	show: boolean
	pixelated: boolean
	format: ImageTransformation['format']
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
		})

	stateMap.set(key, state)

	onMount(() => {
		const unsubscriber = initProxy(state, `image.${imageStorageKey(viewer.scope.image)}.settings`, ['p:show', 'p:pixelated'])

		state.format = viewer.state.transformation.format

		update('pixelated', state.pixelated)

		return () => {
			unsubscriber()
		}
	})

	function update<K extends keyof ImageSettingsState>(key: K, value: ImageSettingsState[K]) {
		state[key] = value

		if (key === 'pixelated') viewer.target?.classList.toggle('pixelated', value as never)
	}

	function updateFormatType(value: ImageFormat) {
		state.format.type = value
	}

	function updateFormat<F extends 'jpeg', K extends keyof ImageSettingsState['format'][F]>(format: F, key: K, value: ImageSettingsState['format'][F][K]) {
		state.format[format][key] = value
	}

	function reset() {
		state.pixelated = true
		state.format.type = DEFAULT_IMAGE_TRANSFORMATION.format.type
		Object.assign(state.format.jpeg, DEFAULT_IMAGE_TRANSFORMATION.format.jpeg)
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, scope: viewer.scope, viewer, update, updateFormatType, updateFormat, reset, show, hide } as const
})
