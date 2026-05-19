import { molecule, onMount } from 'bunshi'
import type { Camera, Mount } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import { type CameraUpdated, type DarvEvent, type DarvStart, DEFAULT_DARV_EVENT, DEFAULT_DARV_START } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { storageGet, storageSet } from '@/shared/storage'
import { updateCameraCaptureStartFromCamera, updateCameraCaptureStartFromCameraUpdated } from '../store/camera.store'
import { equipmentStore, type DeviceState } from '../store/equipment.store'

export interface DarvState {
	show: boolean
	running: boolean
	readonly request: DarvStart
	camera?: DeviceState<Camera>
	mount?: DeviceState<Mount>
	event: DarvEvent
}

const state = proxy<DarvState>({
	request: structuredClone(DEFAULT_DARV_START),
	show: false,
	running: false,
	event: structuredClone(DEFAULT_DARV_EVENT),
})

initProxy(state, 'darv', ['o:request', 'p:show'])

function nextDarvRequestId() {
	return Date.now().toFixed(0)
}

function resetDarvEvent() {
	state.running = false
	state.event.id = state.request.id
	state.event.state = 'IDLE'
}

export const DarvMolecule = molecule(() => {
	onMount(() => {
		state.request.id ||= nextDarvRequestId()

		const unsubscribers = new Array<VoidFunction>(5)

		unsubscribers[0] = subscribeKey(state, 'camera', (camera) => {
			storageSet('darv.camera', camera?.name ?? undefined)
			camera && updateCameraCaptureStartFromCamera(state.request.capture, camera)
		})

		unsubscribers[1] = subscribeKey(state, 'mount', (mount) => {
			storageSet('darv.mount', mount?.name ?? undefined)
		})

		unsubscribers[2] = bus.subscribe<CameraUpdated>('camera:update', (event) => {
			if (event.device.id === state.camera?.id && !state.camera.exposuring) {
				updateCameraCaptureStartFromCameraUpdated(state.request.capture, event)
			}
		})

		unsubscribers[3] = bus.subscribe<DarvEvent>('darv', (event) => {
			if (state.request.id === event.id) {
				state.running = event.state !== 'IDLE'
				Object.assign(state.event, event)
			}
		})

		unsubscribers[4] = subscribeKey(state, 'show', (show) => {
			show && load()
		})

		if (state.show) {
			load()
		}

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function load() {
		state.camera = equipmentStore.get('camera', storageGet('darv.camera', ''))
		state.mount = equipmentStore.get('mount', storageGet('darv.mount', ''))

		state.camera && updateCameraCaptureStartFromCamera(state.request.capture, state.camera)
	}

	function update<K extends keyof DarvStart>(key: K, value: DarvStart[K]) {
		state.request[key] = value
	}

	function updateCapture<K extends keyof DarvStart['capture']>(key: K, value: DarvStart['capture'][K]) {
		state.request.capture[key] = value
	}

	async function start() {
		if (state.running || !state.camera?.connected || !state.mount?.connected) return

		state.request.id = nextDarvRequestId()
		state.running = true
		state.event.id = state.request.id
		state.event.state = 'WAITING'

		const response = await Api.DARV.start(state.camera, state.mount, state.request).catch(() => undefined)

		if (!response?.ok) {
			resetDarvEvent()
		}
	}

	async function stop() {
		if (!state.running) return

		const response = await Api.DARV.stop(state.request).catch(() => undefined)

		if (response?.ok) {
			resetDarvEvent()
		}
	}

	function show() {
		bus.emit('homeMenu:toggle', false)
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, update, updateCapture, start, stop, show, hide } as const
})
