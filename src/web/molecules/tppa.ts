import { molecule, onMount } from 'bunshi'
import type { Camera, Mount } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import { type CameraUpdated, DEFAULT_TPPA_EVENT, DEFAULT_TPPA_START, type TppaEvent, type TppaStart } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { storageGet, storageSet } from '@/shared/storage'
import { equipmentStore, type DeviceState } from '../store/equipment.store'
import { updateCameraCaptureStartFromCamera, updateCameraCaptureStartFromCameraUpdated } from './indi/camera'

export interface TppaState {
	show: boolean
	running: boolean
	readonly request: TppaStart
	camera?: DeviceState<Camera>
	mount?: DeviceState<Mount>
	event: TppaEvent
}

const state = proxy<TppaState>({
	request: structuredClone(DEFAULT_TPPA_START),
	show: false,
	running: false,
	event: structuredClone(DEFAULT_TPPA_EVENT),
})

initProxy(state, 'tppa', ['o:request', 'p:show'])

function nextTppaRequestId() {
	return Date.now().toFixed(0)
}

function resetTppaEvent() {
	state.running = false
	Object.assign(state.event, DEFAULT_TPPA_EVENT)
	state.event.id = state.request.id
}

export const TppaMolecule = molecule(() => {
	onMount(() => {
		state.request.id ||= nextTppaRequestId()

		const unsubscribers = new Array<VoidFunction>(5)

		unsubscribers[0] = subscribeKey(state, 'camera', (camera) => {
			storageSet('tppa.camera', camera?.name ?? undefined)
			camera && updateCameraCaptureStartFromCamera(state.request.capture, camera)
		})

		unsubscribers[1] = subscribeKey(state, 'mount', (mount) => {
			storageSet('tppa.mount', mount?.name ?? undefined)
		})

		unsubscribers[2] = bus.subscribe<CameraUpdated>('camera:update', (event) => {
			if (event.device.id === state.camera?.id && !state.camera.exposuring) {
				updateCameraCaptureStartFromCameraUpdated(state.request.capture, event)
			}
		})

		unsubscribers[3] = bus.subscribe<TppaEvent>('tppa', (event) => {
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
		state.camera = equipmentStore.get('camera', storageGet('tppa.camera', ''))
		state.mount = equipmentStore.get('mount', storageGet('tppa.mount', ''))

		state.camera && updateCameraCaptureStartFromCamera(state.request.capture, state.camera)
	}

	function update<K extends keyof TppaStart>(key: K, value: TppaStart[K]) {
		state.request[key] = value
	}

	function updateSolver<K extends keyof TppaStart['solver']>(key: K, value: TppaStart['solver'][K]) {
		state.request.solver[key] = value
	}

	function updateCapture<K extends keyof TppaStart['capture']>(key: K, value: TppaStart['capture'][K]) {
		state.request.capture[key] = value
	}

	function updateRefraction<K extends keyof TppaStart['refraction']>(key: K, value: TppaStart['refraction'][K]) {
		state.request.refraction[key] = value
	}

	async function start() {
		if (state.running || !state.camera?.connected || !state.mount?.connected) return

		state.running = true
		state.request.id = nextTppaRequestId()

		const response = await Api.TPPA.start(state.camera, state.mount, state.request).catch(() => undefined)

		if (!response?.ok) {
			resetTppaEvent()
		}
	}

	async function stop() {
		if (!state.running) return

		const response = await Api.TPPA.stop(state.request).catch(() => undefined)

		if (response?.ok) {
			resetTppaEvent()
		}
	}

	function show() {
		bus.emit('homeMenu:toggle', false)
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, update, updateSolver, updateCapture, updateRefraction, start, stop, show, hide } as const
})
