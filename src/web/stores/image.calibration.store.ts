import type { ImageViewerStore } from '@stores/image.viewer.store'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import type { ImageCalibration } from '#/image.calibration'

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
		if (mounted) return unmount

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

	function setDarkEnabled(value: boolean) {
		state.calibration.dark.enabled = value
	}

	function setDarkPath(value: string | undefined) {
		state.calibration.dark.path = value
	}

	function setFlatEnabled(value: boolean) {
		state.calibration.flat.enabled = value
	}

	function setFlatPath(value: string | undefined) {
		state.calibration.flat.path = value
	}

	function setBiasEnabled(value: boolean) {
		state.calibration.bias.enabled = value
	}

	function setBiasPath(value: string | undefined) {
		state.calibration.bias.path = value
	}

	function setDarkFlatEnabled(value: boolean) {
		state.calibration.darkFlat.enabled = value
	}

	function setDarkFlatPath(value: string | undefined) {
		state.calibration.darkFlat.path = value
	}

	function apply() {
		return viewer.reload()
	}

	return {
		state,
		viewer,
		mount,
		unmount,
		apply,
		setDarkEnabled,
		setDarkPath,
		setFlatEnabled,
		setFlatPath,
		setBiasEnabled,
		setBiasPath,
		setDarkFlatEnabled,
		setDarkFlatPath,
	} as const
}
