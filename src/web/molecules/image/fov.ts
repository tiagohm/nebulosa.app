import { molecule, onMount, use } from 'bunshi'
import { unsubscribe } from 'src/shared/bus'
import { type ComputedFov, DEFAULT_COMPUTED_FOV, DEFAULT_FOV_ITEM, type FovItem } from 'src/shared/types'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'
import { ImageViewerMolecule } from './viewer'

export interface ImageFovState {
	show: boolean
	selected: number
	readonly items: FovItem[]
	readonly computed: ComputedFov[]
}

const stateMap = new Map<string, ImageFovState>()

export const ImageFovMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const { key, camera } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageFovState>({
			show: false,
			selected: 0,
			items: [structuredClone(DEFAULT_FOV_ITEM)],
			computed: [structuredClone(DEFAULT_COMPUTED_FOV)],
		})

	stateMap.set(key, state)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(1)

		const storageKey = camera?.name || 'default'
		unsubscribers[0] = initProxy(state, `image.${storageKey}.fov`, ['p:show', 'o:items'])

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update<K extends keyof FovItem>(key: K, value: FovItem[K]) {
		state.items[state.selected][key] = value
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, scope: viewer.scope, viewer, update, show, hide } as const
})
