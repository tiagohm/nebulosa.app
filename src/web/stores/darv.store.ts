import { nanoid } from 'nanoid'
import type { Camera, Mount } from 'nebulosa/src/indi.device'
import { COARSE_DARV_EXPOSURE_PRESET, DARV_EXPOSURE_PRESETS, estimateDarvExposure, type DarvExposureInput, type DarvExposurePreset, type DarvExposurePresetMode } from 'nebulosa/src/polaralignment'
import bus from 'src/shared/bus'
import { DEFAULT_DARV_EVENT, DEFAULT_DARV_START, type DarvEvent, type DarvStart } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { toast } from '../shared/toast'
import { subscribeToUpdateCameraCaptureStartFromCamera } from './camera.store'
import { darvListStore } from './darv.list.store'
import type { DeviceState } from './equipment.store'

export type DarvStore = ReturnType<typeof darvStore>

export interface DarvState {
	running: boolean
	readonly request: DarvStart
	readonly camera: DeviceState<Camera>
	readonly mount: DeviceState<Mount>
	readonly event: DarvEvent
	readonly exposureEstimation: DarvExposureInput & { presetMode: DarvExposurePresetMode | 'custom' }
}

export function darvStore(camera: Camera, mount: Mount) {
	const state = proxy<DarvState>({
		request: structuredClone(DEFAULT_DARV_START),
		running: false,
		event: structuredClone(DEFAULT_DARV_EVENT),
		camera,
		mount,
		exposureEstimation: {
			focalLength: 400,
			pixelSize: 2.8,
			declination: 0,
			latitude: 0,
			mode: 'azimuth',
			preset: structuredClone(COARSE_DARV_EXPOSURE_PRESET),
			presetMode: 'coarse',
		},
	})

	console.info('darv created:', camera.name, mount.name)

	const u: VoidFunction[] = []
	let mounted = false

	function _mount() {
		if (mounted) return

		console.info('darv mounted:', camera.name, mount.name)

		mounted = true

		u[0] = initProxy(state, `darv.${camera.id}.${mount.id}`, ['o:request', 'o:exposureEstimation'])

		u[1] = bus.subscribe<DarvEvent>('darv', (event) => {
			if (state.camera.id === event.camera && state.mount.id === event.mount) {
				state.running = event.state !== 'idle'
				Object.assign(state.event, event)
			}
		})

		subscribeToUpdateCameraCaptureStartFromCamera(u, camera, state.request.capture)

		state.request.id ||= nanoid()
	}

	function unmount() {
		if (!mounted) return
		console.info('darv unmounted:', camera.name, mount.name)
		unsubscribe(u)
		mounted = false
	}

	function reset() {
		state.running = false
		state.event.state = 'idle'
	}

	function update<K extends keyof DarvStart>(key: K, value: DarvStart[K]) {
		state.request[key] = value
	}

	function updateCapture<K extends keyof DarvStart['capture']>(key: K, value: DarvStart['capture'][K]) {
		state.request.capture[key] = value
	}

	function updateExposureEstimation<K extends keyof DarvState['exposureEstimation']>(key: K, value: DarvState['exposureEstimation'][K]) {
		state.exposureEstimation[key] = value

		if (key === 'presetMode') {
			if (value !== 'custom') {
				const preset = DARV_EXPOSURE_PRESETS[value as DarvExposurePresetMode]
				Object.assign(state.exposureEstimation.preset, preset)
			}
		}
	}

	function updateExposureEstimationPreset<K extends keyof DarvExposurePreset>(key: K, value: DarvExposurePreset[K]) {
		const { preset } = state.exposureEstimation
		if (typeof preset === 'object') preset[key] = value
	}

	function estimateExposure() {
		state.exposureEstimation.latitude = mount.geographicCoordinate.latitude
		state.exposureEstimation.declination = mount.equatorialCoordinate.declination
		if (mount.hasGuideRate) state.exposureEstimation.preset.guideRateSidereal = mount.guideRate.rightAscension
		else state.exposureEstimation.preset.guideRateSidereal = 1

		try {
			const { recommendedExposure } = estimateDarvExposure(state.exposureEstimation)
			update('duration', Math.ceil(recommendedExposure))
		} catch (e) {
			if (Error.isError(e)) {
				toast({ title: 'DARV EXPOSURE ESTIMATOR', description: e.message, color: 'danger' })
			}
		}
	}

	async function start() {
		if (state.running || !camera.connected || !mount.connected) return

		state.running = true

		const response = await Api.DARV.start(camera, mount, state.request)

		if (!response?.ok) {
			reset()
		}
	}

	async function stop() {
		if (!state.running) return

		const response = await Api.DARV.stop(state.request.id)

		if (response?.ok) {
			reset()
		}
	}

	function hide() {
		darvListStore.hide(camera, mount)
	}

	return {
		state,
		mount: _mount,
		unmount,
		update,
		updateCapture,
		updateExposureEstimation,
		updateExposureEstimationPreset,
		estimateExposure,
		start,
		stop,
		hide,
	} as const
}
