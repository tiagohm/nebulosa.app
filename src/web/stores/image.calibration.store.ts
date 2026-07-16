import type { ImageViewerStore } from '@stores/image.viewer.store'
import type { ImageCalibration, ImageCalibrationFileType } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'

export type ImageCalibrationStore = ReturnType<typeof imageCalibrationStore>

export interface ImageCalibrationState {
	readonly calibration: ImageCalibration
}

export function imageCalibrationStore(viewer: ImageViewerStore) {
	const state = proxy<ImageCalibrationState>({
		calibration: viewer.state.transformation.calibration,
	})

	console.info('image calibration created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image calibration mounted:', viewer.state.path)

		mounted = true

		return unmount
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

	return {
		state,
		viewer,
		mount,
		unmount,
		update,
		apply,
	} as const
}
