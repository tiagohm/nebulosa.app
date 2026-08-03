import { Api } from '@shared/api'
import { darvBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import { toast } from '@shared/toast'
import { cameraCaptureStore } from '@stores/camera.capture.store'
import { subscribeToUpdateCameraCaptureStartFromCamera } from '@stores/camera.store'
import type { DeviceState } from '@stores/equipment.store'
import type { DockviewPanelApi } from 'dockview-react'
import type { Writable } from 'nebulosa/src/core/types'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import { COARSE_DARV_EXPOSURE_PRESET, DARV_EXPOSURE_PRESETS, estimateDarvExposure } from 'nebulosa/src/observation/alignment/polaralignment'
import type { DarvExposureInput, DarvExposurePreset, DarvExposurePresetMode } from 'nebulosa/src/observation/alignment/polaralignment'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { DEFAULT_DARV_EVENT, DEFAULT_DARV_START } from '#/darv'
import type { DarvEvent, DarvHemisphere, DarvStart } from '#/darv'

export type DarvStore = ReturnType<typeof darvStore>

export interface DarvState {
	running: boolean
	readonly request: Writable<DarvStart>
	camera?: DeviceState<Camera>
	mount?: DeviceState<Mount>
	readonly event: DarvEvent
	readonly exposureEstimation: DarvExposureInput & { presetMode: DarvExposurePresetMode | 'custom' }
}

export function darvStore(api: DockviewPanelApi) {
	const { id } = api
	const capture = cameraCaptureStore()

	const state = proxy<DarvState>({
		request: {
			...structuredClone(DEFAULT_DARV_START),
			capture: capture.state,
		},
		running: false,
		event: structuredClone(DEFAULT_DARV_EVENT),
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

	console.info('darv created:', id)

	const u: VoidFunction[] = []
	let mounted = false
	let operationId: string | undefined

	function _mount() {
		if (mounted) return unmount

		console.info('darv mounted:', id)

		mounted = true

		u[0] = initProxy(state, id, ['o:request', 'o:exposureEstimation'])

		u[1] = darvBus.subscribe('update', (event) => {
			if (state.camera?.id === event.camera && state.mount?.id === event.mount) {
				state.running = event.state !== 'idle'
				Object.assign(state.event, event)
			}
		})

		u[2] = subscribeKey(state, 'camera', (camera) => {
			updateTitle()

			if (camera !== undefined) {
				u[3]?.()
				u[3] = subscribeToUpdateCameraCaptureStartFromCamera(camera, state.request.capture)
			}
		})

		u[4] = subscribeKey(state, 'mount', updateTitle)

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('darv unmounted:', id)
		unsubscribe(u)
		mounted = false
	}

	function updateTitle() {
		api.setTitle(state.camera || state.mount ? `DARV - ${state.camera?.name || 'None'} · ${state.mount?.name || 'None'}` : 'DARV')
	}

	function reset() {
		state.running = false
		state.event.state = 'idle'
	}

	function setInitialPause(value: number) {
		state.request.initialPause = value
	}

	function setDuration(value: number) {
		state.request.duration = value
	}

	function setHemisphere(value: DarvHemisphere) {
		state.request.hemisphere = value
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
		const { mount } = state
		if (!mount) return
		state.exposureEstimation.latitude = mount.geographicCoordinate.latitude
		state.exposureEstimation.declination = mount.equatorialCoordinate.declination
		if (mount.hasGuideRate) state.exposureEstimation.preset.guideRateSidereal = mount.guideRate.rightAscension
		else state.exposureEstimation.preset.guideRateSidereal = 1

		try {
			const { recommendedExposure } = estimateDarvExposure(state.exposureEstimation)
			setDuration(Math.ceil(recommendedExposure))
		} catch (e) {
			if (Error.isError(e)) {
				toast({ title: 'DARV EXPOSURE ESTIMATOR', description: e.message, color: 'danger' })
			}
		}
	}

	async function start() {
		if (state.running || !state.camera?.connected || !state.mount?.connected) return

		state.running = true

		operationId = await Api.DARV.start(state.camera, state.mount, state.request)

		if (!operationId) {
			reset()
		}
	}

	async function stop() {
		if (!state.running || !operationId) return

		const response = await Api.DARV.stop(operationId)

		if (response?.ok) {
			reset()
		}
	}

	return {
		state,
		capture,
		mount: _mount,
		unmount,
		setInitialPause,
		setDuration,
		setHemisphere,
		updateExposureEstimation,
		updateExposureEstimationPreset,
		estimateExposure,
		start,
		stop,
	} as const
}
