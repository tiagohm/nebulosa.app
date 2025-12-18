import { molecule, onMount, use } from 'bunshi'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'
import { ImageViewerMolecule } from './viewer'

export interface ImageHeaderState {
	show: boolean
}

const stateMap = new Map<string, ImageHeaderState>()

export const ImageHeaderMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const { key, camera } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageHeaderState>({
			show: false,
		})

	stateMap.set(key, state)

	onMount(() => {
		const storageKey = camera?.name || 'default'
		const unsubscriber = initProxy(state, `image.${storageKey}.header`, ['p:show'])

		return () => {
			unsubscriber()
		}
	})

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, scope: viewer.scope, viewer, show, hide } as const
})
