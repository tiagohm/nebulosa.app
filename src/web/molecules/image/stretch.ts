import { molecule, onMount, use } from 'bunshi'
import { DEFAULT_IMAGE_STRETCH, type ImageStretch } from 'src/shared/types'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'
import { ImageViewerMolecule } from './viewer'

export interface ImageStretchState {
	show: boolean
	stretch: ImageStretch
}

const stateMap = new Map<string, ImageStretchState>()

export const ImageStretchMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const { key } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageStretchState>({
			show: false,
			stretch: viewer.state.transformation.stretch,
		})

	stateMap.set(key, state)

	onMount(() => {
		const unsubscriber = initProxy(state, `image.${viewer.storageKey}.stretch`, ['p:show'])

		state.stretch = viewer.state.transformation.stretch

		return () => {
			unsubscriber()
		}
	})

	function update<K extends keyof ImageStretch>(key: K, value: ImageStretch[K]) {
		state.stretch[key] = value
	}

	function auto() {
		return apply(true)
	}

	function reset() {
		Object.assign(state.stretch, DEFAULT_IMAGE_STRETCH)
		state.stretch.auto = false
		return viewer.load(true)
	}

	function toggle() {
		if (state.stretch.auto) {
			return reset()
		} else {
			state.stretch.auto = true
			return viewer.load(true)
		}
	}

	function apply(auto: boolean = false) {
		state.stretch.auto = auto
		return viewer.load(true)
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, scope: viewer.scope, viewer, update, auto, reset, toggle, apply, show, hide } as const
})
