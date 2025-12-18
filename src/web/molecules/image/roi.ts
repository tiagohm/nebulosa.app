import { molecule, onMount, use } from 'bunshi'
import type { Point, Size } from 'src/shared/types'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'
import { ImageViewerMolecule } from './viewer'

export interface ImageRoiState extends Size, Point {
	visible: boolean
	rotation: number
}

const stateMap = new Map<string, ImageRoiState>()

export const ImageRoiMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const { key, camera } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageRoiState>({
			visible: false,
			x: 0,
			y: 0,
			width: 0,
			height: 0,
			rotation: 0,
		})

	stateMap.set(key, state)

	onMount(() => {
		const storageKey = camera?.name || 'default'
		const unsubscriber = initProxy(state, `image.${storageKey}.roi`, ['p:x', 'p:y', 'p:width', 'p:height', 'p:rotation'])

		return () => {
			unsubscriber()
		}
	})

	function toggle() {
		state.visible = !state.visible
	}

	return { state, scope: viewer.scope, viewer, toggle } as const
})
