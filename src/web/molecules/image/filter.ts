import { molecule, onMount, use } from 'bunshi'
import type { ImageFilter } from 'src/shared/types'
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
	const { key, camera } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageFilterState>({
			show: false,
			filter: viewer.state.transformation.filter,
		})

	stateMap.set(key, state)

	onMount(() => {
		const storageKey = camera?.name || 'default'
		const unsubscriber = initProxy(state, `image.${storageKey}.filter`, ['p:show'])

		state.filter = viewer.state.transformation.filter

		return () => {
			unsubscriber()
		}
	})

	function update<K extends keyof ImageFilter>(key: K, value: ImageFilter[K]) {
		state.filter[key] = value
	}

	function reset() {
		state.filter.sharpen = false
		state.filter.blur = false
		state.filter.median = false
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

	return { state, scope: viewer.scope, viewer, update, reset, apply, show, hide } as const
})
