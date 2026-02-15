import { molecule, onMount, use } from 'bunshi'
import type { ImageFormat } from 'nebulosa/src/image.types'
import { DEFAULT_IMAGE_TRANSFORMATION, type ImageTransformation } from 'src/shared/types'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'
import { ImageViewerMolecule } from './viewer'

export interface ImageSettingsState {
	show: boolean
	pixelated: boolean
	transformation: ImageTransformation
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
			transformation: viewer.state.transformation,
		})

	stateMap.set(key, state)

	onMount(() => {
		const unsubscriber = initProxy(state, `image.${viewer.storageKey}.settings`, ['p:show', 'p:pixelated'])

		state.transformation = viewer.state.transformation

		update('pixelated', state.pixelated)

		return () => {
			unsubscriber()
		}
	})

	function update<K extends keyof ImageSettingsState>(key: K, value: ImageSettingsState[K]) {
		state[key] = value

		if (key === 'pixelated') viewer.target?.classList.toggle('pixelated', value as never)
	}

	function updateTransformation<K extends keyof ImageTransformation>(key: K, value: ImageTransformation[K]) {
		state.transformation[key] = value
	}

	function updateFormatType(value: ImageFormat) {
		state.transformation.format.type = value
	}

	function updateFormat<F extends 'jpeg', K extends keyof ImageTransformation['format'][F]>(format: F, key: K, value: ImageTransformation['format'][F][K]) {
		state.transformation.format[format][key] = value
	}

	function reset() {
		state.pixelated = true
		state.transformation.cfaPattern = 'AUTO'
		state.transformation.format.type = DEFAULT_IMAGE_TRANSFORMATION.format.type
		Object.assign(state.transformation.format.jpeg, DEFAULT_IMAGE_TRANSFORMATION.format.jpeg)
		return apply()
	}

	function apply() {
		viewer.target?.classList.toggle('pixelated', state.pixelated)
		return viewer.load(true)
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, scope: viewer.scope, viewer, update, updateTransformation, updateFormatType, updateFormat, reset, apply, show, hide } as const
})
