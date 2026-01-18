import { molecule, onMount, use } from 'bunshi'
import bus from 'src/shared/bus'
import { DEFAULT_IMAGE_STRETCH, type ImageStretch } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'
import type { ImageLoaded } from '@/shared/types'
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
		const unsubscribers = new Array<VoidFunction>(2)

		unsubscribers[0] = initProxy(state, `image.${viewer.storageKey}.stretch`, ['p:show'])

		unsubscribers[1] = bus.subscribe<ImageLoaded>('image:load', ({ image, info }) => {
			if (image.key === key) {
				state.stretch.auto = info.transformation.stretch.auto
				state.stretch.shadow = info.transformation.stretch.shadow
				state.stretch.highlight = info.transformation.stretch.highlight
				state.stretch.midtone = info.transformation.stretch.midtone
			}
		})

		state.stretch = viewer.state.transformation.stretch

		return () => {
			unsubscribe(unsubscribers)
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
