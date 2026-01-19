import { molecule, onMount, use } from 'bunshi'
import type { Camera, Focuser } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import { type AutoFocusEvent, type AutoFocusStart, type CameraUpdated, DEFAULT_AUTO_FOCUS_EVENT, DEFAULT_AUTO_FOCUS_START } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { storageGet, storageSet } from '@/shared/storage'
import { updateCameraCaptureStartFromCamera, updateCameraCaptureStartFromCameraUpdated } from './indi/camera'
import { type EquipmentDevice, EquipmentMolecule } from './indi/equipment'

export interface AutoFocusState {
	show: boolean
	running: boolean
	readonly request: AutoFocusStart
	camera?: EquipmentDevice<Camera>
	focuser?: EquipmentDevice<Focuser>
	event: AutoFocusEvent
}

const state = proxy<AutoFocusState>({
	request: structuredClone(DEFAULT_AUTO_FOCUS_START),
	show: false,
	running: false,
	event: structuredClone(DEFAULT_AUTO_FOCUS_EVENT),
})

initProxy(state, 'autofocus', ['o:request', 'p:show'])

export const AutoFocusMolecule = molecule(() => {
	const equipment = use(EquipmentMolecule)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(5)

		unsubscribers[0] = subscribeKey(state, 'camera', (camera) => {
			storageSet('autofocus.camera', camera?.name ?? undefined)
			camera && updateCameraCaptureStartFromCamera(state.request.capture, camera)
		})

		unsubscribers[1] = subscribeKey(state, 'focuser', (focuser) => {
			storageSet('autofocus.focuser', focuser?.name ?? undefined)
		})

		unsubscribers[2] = bus.subscribe<CameraUpdated>('camera:update', (event) => {
			if (event.device.id === state.camera?.id && !state.camera.exposuring) {
				updateCameraCaptureStartFromCameraUpdated(state.request.capture, event)
			}
		})

		unsubscribers[3] = bus.subscribe<AutoFocusEvent>('autofocus', (event) => {
			if (state.camera?.id === event.camera && state.focuser?.id === event.focuser) {
				state.running = event.state !== 'IDLE'
				Object.assign(state.event, event)
			}
		})

		unsubscribers[4] = subscribeKey(state, 'show', (show) => {
			if (!show) return

			load()
		})

		if (state.show) {
			load()
		}

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function load() {
		state.camera = equipment.get('CAMERA', storageGet('autofocus.camera', ''))
		state.focuser = equipment.get('FOCUSER', storageGet('autofocus.focuser', ''))

		state.camera && updateCameraCaptureStartFromCamera(state.request.capture, state.camera)
	}

	function update<K extends keyof AutoFocusStart>(key: K, value: AutoFocusStart[K]) {
		state.request[key] = value
	}

	function updateCapture<K extends keyof AutoFocusStart['capture']>(key: K, value: AutoFocusStart['capture'][K]) {
		state.request.capture[key] = value
	}

	function updateStarDetection<K extends keyof AutoFocusStart['starDetection']>(key: K, value: AutoFocusStart['starDetection'][K]) {
		state.request.starDetection[key] = value
	}

	function start() {
		return Api.AutoFocus.start(state.camera!, state.focuser!, state.request)
	}

	function stop() {
		return Api.AutoFocus.stop(state.camera!, state.focuser!)
	}

	function show() {
		bus.emit('homeMenu:toggle', false)
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, update, updateCapture, updateStarDetection, start, stop, show, hide }
})
