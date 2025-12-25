import { molecule, onMount, use } from 'bunshi'
import { DEFAULT_IMAGE_SCNR, type ImageScnr } from 'src/shared/types'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'
import { ImageViewerMolecule } from './viewer'

export interface ImageScnrState {
	show: boolean
	scnr: ImageScnr
}

const stateMap = new Map<string, ImageScnrState>()

export const ImageScnrMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const { key } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageScnrState>({
			show: false,
			scnr: viewer.state.transformation.scnr,
		})

	stateMap.set(key, state)

	onMount(() => {
		const unsubscriber = initProxy(state, `image.${viewer.storageKey}.scnr`, ['p:show'])

		state.scnr = viewer.state.transformation.scnr

		return () => {
			unsubscriber()
		}
	})

	function update<K extends keyof ImageScnr>(key: K, value: ImageScnr[K]) {
		state.scnr[key] = value
	}

	function reset() {
		state.scnr.method = DEFAULT_IMAGE_SCNR.method
		state.scnr.amount = DEFAULT_IMAGE_SCNR.amount
		state.scnr.channel = DEFAULT_IMAGE_SCNR.channel
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
