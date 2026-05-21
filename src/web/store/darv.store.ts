import { nanoid } from 'nanoid'
import type { Camera, Mount } from 'nebulosa/src/indi.device'
import { estimateDarvExposure, type DarvExposureInput, type DarvExposurePreset } from 'nebulosa/src/polaralignment'
import bus from 'src/shared/bus'
import { DEFAULT_DARV_EVENT, DEFAULT_DARV_START, type DarvEvent, type DarvStart } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { subscribeToUpdateCameraCaptureStartFromCamera } from './camera.store'
import { equipmentStore, type DeviceState } from './equipment.store'

export type DarvStore = ReturnType<typeof darvStore>

export interface DarvState {
	running: boolean
	readonly request: DarvStart
	camera: DeviceState<Camera>
	mount: DeviceState<Mount>
	readonly event: DarvEvent
	readonly exposureEstimation: DarvExposureInput
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
			preset: 'coarse',
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
			if (state.request.id === event.id) {
				state.running = event.state !== 'IDLE'
				Object.assign(state.event, event)
			}
		})

		subscribeToUpdateCameraCaptureStartFromCamera(u, camera, state.request.capture)

		state.request.id = nanoid()

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('darv unmounted:', camera.name, mount.name)
		unsubscribe(u)
		mounted = false
	}

	function reset() {
		state.running = false
		state.event.state = 'IDLE'
	}

	function update<K extends keyof DarvStart>(key: K, value: DarvStart[K]) {
		state.request[key] = value
	}

	function updateCapture<K extends keyof DarvStart['capture']>(key: K, value: DarvStart['capture'][K]) {
		state.request.capture[key] = value
	}

	function updateExposureEstimation<K extends keyof DarvExposureInput>(key: K, value: DarvExposureInput[K]) {
		state.exposureEstimation[key] = value
	}

	function updateExposureEstimationPreset<K extends keyof DarvExposurePreset>(key: K, value: DarvExposurePreset[K]) {
		const { preset } = state.exposureEstimation
		if (typeof preset === 'object') preset[key] = value
	}

	function estimateExposure() {
		state.exposureEstimation.latitude = mount.geographicCoordinate.latitude
		state.exposureEstimation.declination = mount.equatorialCoordinate.declination
		const { recommendedExposure } = estimateDarvExposure(state.exposureEstimation)
		update('duration', Math.ceil(recommendedExposure))
	}

	async function start() {
		if (state.running || !state.camera?.connected || !state.mount?.connected) return

		state.running = true
		state.event.id = state.request.id
		state.event.state = 'WAITING'

		const response = await Api.DARV.start(state.camera, state.mount, state.request)

		if (!response?.ok) {
			reset()
		}
	}

	async function stop() {
		if (!state.running) return

		const response = await Api.DARV.stop(state.request)

		if (response?.ok) {
			reset()
		}
	}

	function show() {
		equipmentStore.showDarv(camera, mount)
	}

	function hide() {
		equipmentStore.hideDarv(camera, mount)
	}

	return {
		state,
		mount: _mount,
		update,
		updateCapture,
		updateExposureEstimation,
		updateExposureEstimationPreset,
		estimateExposure,
		start,
		stop,
		show,
		hide,
	} as const
}
