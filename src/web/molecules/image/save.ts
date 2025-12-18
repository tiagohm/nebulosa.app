import { molecule, onMount, use } from 'bunshi'
import type { ImageFormat } from 'nebulosa/src/image'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { ImageViewerMolecule } from './viewer'

export interface ImageSaveState {
	show: boolean
	loading: boolean
	path: string
	format: ImageFormat
	transformed: boolean
}

const stateMap = new Map<string, ImageSaveState>()

export const ImageSaveMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const { key, camera } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageSaveState>({
			show: false,
			loading: false,
			path: '',
			format: 'fits',
			transformed: false,
		})

	stateMap.set(key, state)

	onMount(() => {
		const storageKey = camera?.name || 'default'
		const unsubscriber = initProxy(state, `image.${storageKey}.save`, ['p:show', 'p:format', 'p:path', 'p:transformed'])

		return () => {
			unsubscriber()
		}
	})

	function update<K extends keyof ImageSaveState>(key: K, value: ImageSaveState[K]) {
		state[key] = value
	}

	async function save() {
		try {
			state.loading = true

			const transformation = { ...viewer.state.transformation, format: state.format }
			await Api.Image.save({ path: viewer.path, transformation, saveAt: state.path, transformed: state.transformed })
		} finally {
			state.loading = false
		}
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, scope: viewer.scope, viewer, update, save, show, hide } as const
})
