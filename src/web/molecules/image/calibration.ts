import { molecule, onMount, use } from 'bunshi'
import type { ImageCalibration, ImageCalibrationFileType } from 'src/shared/types'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'
import { ImageViewerMolecule } from './viewer'

export interface ImageCalibrationState {
	show: boolean
	calibration: ImageCalibration
}

const stateMap = new Map<string, ImageCalibrationState>()

export const ImageCalibrationMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const { key } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageCalibrationState>({
			show: false,
			calibration: viewer.state.transformation.calibration,
		})

	stateMap.set(key, state)

	onMount(() => {
		const unsubscriber = initProxy(state, `image.${viewer.storageKey}.calibration`, ['p:show'])

		state.calibration = viewer.state.transformation.calibration

		return () => {
			unsubscriber()
		}
	})

	function update<T extends ImageCalibrationFileType, K extends keyof ImageCalibration[T]>(type: T, key: K, value: ImageCalibration[T][K]) {
		state.calibration[type][key] = value
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

	return { state, scope: viewer.scope, viewer, update, apply, show, hide } as const
})
