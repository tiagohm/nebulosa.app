import type { ImageCalibration, ImageCalibrationFileType } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { initProxy } from '../shared/proxy'
import type { ImageViewerStore } from './image.viewer.store'

export type ImageCalibrationStore = ReturnType<typeof imageCalibrationStore>

export interface ImageCalibrationState {
	show: boolean
	readonly calibration: ImageCalibration
}

export function imageCalibrationStore(viewer: ImageViewerStore) {
	const state = proxy<ImageCalibrationState>({
		show: false,
		calibration: viewer.state.transformation.calibration,
	})

	console.info('image calibration created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image calibration mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.calibration`, ['p:show'])
	}

	function unmount() {
		if (!mounted) return
		console.info('image calibration unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function update<T extends ImageCalibrationFileType, K extends keyof ImageCalibration[T]>(type: T, key: K, value: ImageCalibration[T][K]) {
		state.calibration[type][key] = value
	}

	function apply() {
		return viewer.reload()
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
		apply,
		show,
		hide,
	} as const
}
