import { Api } from '@shared/api'
import { flatWizardBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import { cameraCaptureStore } from '@stores/camera.capture.store'
import { subscribeToUpdateCameraCaptureStartFromCamera } from '@stores/camera.store'
import type { DeviceState } from '@stores/equipment.store'
import type { DockviewPanelApi } from 'dockview-react'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { DEFAULT_FLAT_WIZARD_START, DEFAULT_FLAT_WIZARD_EVENT } from '#/flatwizard'
import type { FlatWizardStart, FlatWizardEvent } from '#/flatwizard'

export type FlatWizardStore = ReturnType<typeof flatWizardStore>

export interface FlatWizardState {
	running: boolean
	readonly request: FlatWizardStart
	camera?: DeviceState<Camera>
	readonly event: FlatWizardEvent
}

export function flatWizardStore(id: string, api: DockviewPanelApi) {
	const capture = cameraCaptureStore()

	const state = proxy<FlatWizardState>({
		running: false,
		request: {
			...structuredClone(DEFAULT_FLAT_WIZARD_START),
			capture: capture.state,
		},
		event: structuredClone(DEFAULT_FLAT_WIZARD_EVENT),
	})

	const u: VoidFunction[] = []
	let mounted = false

	console.info('flat wizard created', id)

	function mount() {
		if (mounted) return unmount

		console.info('flat wizard mounted:', id)

		mounted = true

		u[0] = initProxy(state, `flatwizard.${id}`, ['o:request'])

		u[1] = flatWizardBus.subscribe('update', (event) => {
			if (state.camera?.id === event.camera) {
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

		updateTitle()

		state.request.id = id

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('flat wizard unmounted:', id)
		unsubscribe(u)
		mounted = false
	}

	function updateTitle() {
		api.setTitle(state.camera ? `FlatWizard - ${state.camera?.name || 'None'}` : 'Flat Wizard')
	}

	function reset() {
		state.running = false
		state.event.state = 'idle'
	}

	function setMinExposure(value: number) {
		state.request.minExposure = value
	}

	function setMaxExposure(value: number) {
		state.request.maxExposure = value
	}

	function setMeanTarget(value: number) {
		state.request.meanTarget = value
	}

	function setMeanTolerance(value: number) {
		state.request.meanTolerance = value
	}

	function setPath(path?: string) {
		state.request.path = path ?? ''
	}

	async function start() {
		if (state.running || !state.camera?.connected) return

		state.running = true

		const response = await Api.FlatWizard.start(state.camera, state.request)

		if (!response?.ok) {
			reset()
		}
	}

	async function stop() {
		if (!state.running) return

		const response = await Api.FlatWizard.stop(state.request.id)

		if (response?.ok) {
			reset()
		}
	}

	return {
		state,
		capture,
		mount,
		unmount,
		setMinExposure,
		setMaxExposure,
		setMeanTarget,
		setMeanTolerance,
		setPath,
		start,
		stop,
	} as const
}
