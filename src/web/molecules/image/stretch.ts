import { molecule, onMount, use } from 'bunshi'
import type { ImageStretch } from 'src/shared/types'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'
import { imageStorageKey } from '@/shared/types'
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
		const unsubscriber = initProxy(state, `image.${imageStorageKey(viewer.scope.image)}.stretch`, ['p:show'])

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
		state.stretch.auto = false
		state.stretch.midtone = 32768
		state.stretch.shadow = 0
		state.stretch.highlight = 65536
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
