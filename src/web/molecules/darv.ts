import { molecule, onMount, use } from 'bunshi'
import type { Camera, Mount } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import { type CameraUpdated, type DarvEvent, type DarvStart, DEFAULT_DARV_EVENT, DEFAULT_DARV_START } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { storageGet, storageSet } from '@/shared/storage'
import { updateExposureTime, updateFrameFormat, updateRequestFrame } from './indi/camera'
import { type EquipmentDevice, EquipmentMolecule } from './indi/equipment'

export interface DarvState {
	show: boolean
	running: boolean
	readonly request: DarvStart
	camera?: EquipmentDevice<Camera>
	mount?: EquipmentDevice<Mount>
	event: DarvEvent
}

const state = proxy<DarvState>({
	request: structuredClone(DEFAULT_DARV_START),
	show: false,
	running: false,
	event: structuredClone(DEFAULT_DARV_EVENT),
})

initProxy(state, 'darv', ['o:request', 'p:show'])

export const DarvMolecule = molecule(() => {
	const equipment = use(EquipmentMolecule)

	onMount(() => {
		state.request.id = Date.now().toFixed(0)

		const unsubscribers = new Array<VoidFunction>(5)

		unsubscribers[0] = subscribeKey(state, 'camera', (camera) => {
			storageSet('darv.camera', camera?.name ?? undefined)
			camera && updateFrameFormat(state.request.capture, camera.frameFormats)
		})

		unsubscribers[1] = subscribeKey(state, 'mount', (mount) => {
			storageSet('darv.mount', mount?.name ?? undefined)
		})

		unsubscribers[2] = bus.subscribe<CameraUpdated>('camera:update', (event) => {
			if (event.device.id === state.camera?.id) {
				if (event.property === 'frame') {
					updateRequestFrame(state.request.capture, event.device.frame!)
				} else if (event.property === 'frameFormats' && event.device.frameFormats?.length) {
					updateFrameFormat(state.request.capture, event.device.frameFormats)
				} else if (event.property === 'exposure' && !state.camera.exposuring && event.device.exposure?.max) {
					updateExposureTime(state.request.capture, event.device.exposure)
				}
			}
		})

		unsubscribers[3] = bus.subscribe<DarvEvent>('darv', (event) => {
			if (state.request.id === event.id) {
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
		state.camera = equipment.get('CAMERA', storageGet('darv.camera', ''))
		state.mount = equipment.get('MOUNT', storageGet('darv.mount', ''))

		if (state.camera) {
			updateFrameFormat(state.request.capture, state.camera.frameFormats)
			updateRequestFrame(state.request.capture, state.camera.frame)
			updateExposureTime(state.request.capture, state.camera.exposure)
		}
	}

	function update<K extends keyof DarvStart>(key: K, value: DarvStart[K]) {
		state.request[key] = value
	}

	function updateCapture<K extends keyof DarvStart['capture']>(key: K, value: DarvStart['capture'][K]) {
		state.request.capture[key] = value
	}

	function start() {
		return Api.DARV.start(state.camera!, state.mount!, state.request)
	}

	function stop() {
		return Api.DARV.stop(state.request)
	}

	function show() {
		bus.emit('homeMenu:toggle', false)
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, update, updateCapture, start, stop, show, hide }
})
