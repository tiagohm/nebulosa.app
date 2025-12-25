import { molecule, onMount, use } from 'bunshi'
import { DEFAULT_IMAGE_FILTER, type ImageFilter } from 'src/shared/types'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'
import { ImageViewerMolecule } from './viewer'

export interface ImageFilterState {
	show: boolean
	filter: ImageFilter
}

const stateMap = new Map<string, ImageFilterState>()

export const ImageFilterMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const { key } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageFilterState>({
			show: false,
			filter: viewer.state.transformation.filter,
		})

	stateMap.set(key, state)

	onMount(() => {
		const unsubscriber = initProxy(state, `image.${viewer.storageKey}.filter`, ['p:show'])

		state.filter = viewer.state.transformation.filter

		return () => {
			unsubscriber()
		}
	})

	function updateType(type: string) {
		state.filter.type = type as never
	}

	function update<T extends Exclude<ImageFilter['type'], 'sharpen'>, K extends keyof ImageFilter[T]>(type: T, key: K, value: ImageFilter[T][K]) {
		state.filter[type][key] = value
	}

	function reset() {
		Object.assign(state.filter.blur, DEFAULT_IMAGE_FILTER.blur)
		Object.assign(state.filter.mean, DEFAULT_IMAGE_FILTER.mean)
		Object.assign(state.filter.gaussianBlur, DEFAULT_IMAGE_FILTER.gaussianBlur)
		return apply()
	}

	function apply() {
		return viewer.load(true)
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, scope: viewer.scope, viewer, updateType, update, reset, apply, show, hide } as const
})
