import { molecule, onMount, use } from 'bunshi'
import type { ImageFormat } from 'nebulosa/src/image.types'
import { formatTemporal } from 'nebulosa/src/temporal'
import type { ImageTransformation } from 'src/shared/types'
import { proxy, snapshot } from 'valtio'
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
	const { key } = viewer.scope.image

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
		const unsubscriber = initProxy(state, `image.${viewer.storageKey}.save`, ['p:show', 'p:format', 'p:path', 'p:transformed'])

		return () => {
			unsubscriber()
		}
	})

	function update<K extends keyof ImageSaveState>(key: K, value: ImageSaveState[K]) {
		state[key] = value
	}

	async function download() {
		try {
			state.loading = true

			const transformation = structuredClone(snapshot(viewer.state.transformation)) as ImageTransformation
			transformation.format.type = state.format
			transformation.enabled = state.transformed
			const response = await Api.Image.open({ path: viewer.path, transformation })

			if (response) {
				const url = URL.createObjectURL(response.blob)

				const a = document.createElement('a')
				a.href = url
				a.download = `${formatTemporal(Date.now(), 'YYYYMMDD.HHmmssSSS')}.${state.format}`

				try {
					document.body.appendChild(a)
					a.click()
				} finally {
					URL.revokeObjectURL(url)
					document.body.removeChild(a)
				}
			}
		} finally {
			state.loading = false
		}
	}

	async function save() {
		try {
			state.loading = true

			const transformation = structuredClone(snapshot(viewer.state.transformation)) as ImageTransformation
			transformation.format.type = state.format
			transformation.enabled = state.transformed
			await Api.Image.save({ path: viewer.path, transformation, saveAt: state.path })
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

	return { state, scope: viewer.scope, viewer, update, download, save, show, hide } as const
})
