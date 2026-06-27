import { formatTemporal } from 'nebulosa/src/astronomy/time/temporal'
import type { ImageFormat } from 'nebulosa/src/imaging/model/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { saveAs } from '../shared/util'
import type { ImageViewerStore } from './image.viewer.store'

export type ImageSaveStore = ReturnType<typeof imageSaveStore>

export interface ImageSaveState {
	show: boolean
	loading: boolean
	path: string
	format: ImageFormat
	transformed: boolean
}

export function imageSaveStore(viewer: ImageViewerStore) {
	const state = proxy<ImageSaveState>({
		show: false,
		loading: false,
		path: '',
		format: 'fits',
		transformed: false,
	})

	console.info('image save created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image save mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.save`, ['p:show', 'p:format', 'p:path', 'p:transformed'])
	}

	function unmount() {
		if (!mounted) return
		console.info('image save unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function update<K extends keyof ImageSaveState>(key: K, value: ImageSaveState[K]) {
		state[key] = value
	}

	function setPath(path?: string) {
		state.path = path ?? ''
	}

	async function download() {
		try {
			state.loading = true

			const format = { ...viewer.state.transformation.format, type: state.format }
			const transformation = { ...viewer.state.transformation, enabled: state.transformed, format }
			const response = await Api.Image.open({ path: viewer.state.path, transformation })

			if (response) {
				saveAs(response.blob, `${formatTemporal(Date.now(), 'YYYYMMDD.HHmmssSSS')}.${state.format}`)
			}
		} finally {
			state.loading = false
		}
	}

	async function save() {
		try {
			state.loading = true

			const format = { ...viewer.state.transformation.format, type: state.format }
			const transformation = { ...viewer.state.transformation, enabled: state.transformed, format }
			await Api.Image.save({ path: viewer.state.path, transformation, saveAt: state.path })
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

	return {
		state,
		viewer,
		mount,
		unmount,
		update,
		setPath,
		download,
		save,
		show,
		hide,
	} as const
}
