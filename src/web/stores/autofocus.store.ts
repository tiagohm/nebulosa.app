import { Api } from '@shared/api'
import { autoFocusBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import { cameraCaptureStore } from '@stores/camera.capture.store'
import { subscribeToUpdateCameraCaptureStartFromCamera } from '@stores/camera.store'
import type { DeviceState } from '@stores/equipment.store'
import type { DockviewPanelApi } from 'dockview-react'
import type { Camera, Focuser } from 'nebulosa/src/devices/indi/device'
import type { AutoFocusFittingMode } from 'nebulosa/src/observation/focus/autofocus'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { DEFAULT_AUTO_FOCUS_START, DEFAULT_AUTO_FOCUS_EVENT } from '#/autofocus'
import type { AutoFocusStart, AutoFocusEvent } from '#/autofocus'
import type { StarDetectionType } from '#/stardetection'

export type AutoFocusStore = ReturnType<typeof autoFocusStore>

export interface AutoFocusState {
	running: boolean
	readonly request: AutoFocusStart
	camera?: DeviceState<Camera>
	focuser?: DeviceState<Focuser>
	readonly event: AutoFocusEvent
}

export function autoFocusStore(api: DockviewPanelApi) {
	const { id } = api
	const capture = cameraCaptureStore()

	const state = proxy<AutoFocusState>({
		request: {
			...structuredClone(DEFAULT_AUTO_FOCUS_START),
			capture: capture.state,
		},
		running: false,
		event: structuredClone(DEFAULT_AUTO_FOCUS_EVENT),
	})

	const u: VoidFunction[] = []
	let mounted = false
	let operationId: string | undefined

	function mount() {
		if (mounted) return unmount

		console.info('autofocus mounted:', id)

		mounted = true

		u[0] = initProxy(state, id, ['o:request'])

		u[1] = autoFocusBus.subscribe('update', (event) => {
			if (state.camera?.id === event.camera && state.focuser?.id === event.focuser) {
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

		u[4] = subscribeKey(state, 'focuser', updateTitle)

		updateTitle()

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('autofocus unmounted:', id)
		unsubscribe(u)
		mounted = false
	}

	function updateTitle() {
		api.setTitle(state.camera || state.focuser ? `Auto Focus - ${state.camera?.name || 'None'} · ${state.focuser?.name || 'None'}` : 'Auto Focus')
	}

	function reset() {
		state.running = false
		state.event.state = 'idle'
	}

	function setInitialOffsetSteps(value: number) {
		state.request.initialOffsetSteps = value
	}

	function setStepSize(value: number) {
		state.request.stepSize = value
	}

	function setFittingMode(value: AutoFocusFittingMode) {
		state.request.fittingMode = value
	}

	function setRmsdThreshold(value: number | undefined) {
		state.request.rmsdThreshold = value
	}

	function setReversed(value: boolean) {
		state.request.reversed = value
	}

	function setStarDetectionType(value: StarDetectionType) {
		state.request.starDetection.type = value
	}

	function setStarDetectionExecutable(value: string) {
		state.request.starDetection.executable = value
	}

	function setStarDetectionMinSNR(value: number) {
		state.request.starDetection.minSNR = value
	}

	function setStarDetectionMaxStars(value: number) {
		state.request.starDetection.maxStars = value
	}

	async function start() {
		if (state.running || !state.camera?.connected || !state.focuser?.connected) return

		state.running = true

		operationId = await Api.AutoFocus.start(state.camera, state.focuser, state.request)

		if (!operationId) {
			reset()
		}
	}

	async function stop() {
		if (!state.running || !operationId) return

		const response = await Api.AutoFocus.stop(operationId)

		if (response?.ok) {
			reset()
		}
	}

	return {
		state,
		capture,
		mount,
		unmount,
		setInitialOffsetSteps,
		setStepSize,
		setFittingMode,
		setRmsdThreshold,
		setReversed,
		setStarDetectionType,
		setStarDetectionExecutable,
		setStarDetectionMinSNR,
		setStarDetectionMaxStars,
		start,
		stop,
	} as const
}
