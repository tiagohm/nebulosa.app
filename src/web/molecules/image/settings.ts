import { molecule, onMount, use } from 'bunshi'
import type { ImageFormat } from 'nebulosa/src/image'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'
import { ImageViewerMolecule } from './viewer'

export interface ImageSettingsState {
	show: boolean
	pixelated: boolean
	format: ImageFormat
}

const stateMap = new Map<string, ImageSettingsState>()

export const ImageSettingsMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const { key, camera } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageSettingsState>({
			show: false,
			pixelated: false,
			format: viewer.state.transformation.format,
		})

	stateMap.set(key, state)

	onMount(() => {
		const storageKey = camera?.name || 'default'
		const unsubscriber = initProxy(state, `image.${storageKey}.settings`, ['p:show', 'p:pixelated'])

		update('pixelated', state.pixelated)

		return () => {
			unsubscriber()
		}
	})

	function update<K extends keyof ImageSettingsState>(key: K, value: ImageSettingsState[K]) {
		state[key] = value

		if (key === 'format') viewer.state.transformation.format = value as never
		else if (key === 'pixelated') viewer.target?.classList.toggle('pixelated', value as never)
	}

	function reset() {
		state.pixelated = true
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, scope: viewer.scope, viewer, update, reset, show, hide } as const
})
