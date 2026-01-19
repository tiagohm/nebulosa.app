import { molecule, onMount, use } from 'bunshi'
import type { Camera } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import { type CameraUpdated, DEFAULT_FLAT_WIZARD_EVENT, DEFAULT_FLAT_WIZARD_START, type FlatWizardEvent, type FlatWizardStart } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { storageGet, storageSet } from '@/shared/storage'
import { updateCameraCaptureStartFromCamera, updateCameraCaptureStartFromCameraUpdated } from './indi/camera'
import { type EquipmentDevice, EquipmentMolecule } from './indi/equipment'

export interface FlatWizardState {
	show: boolean
	running: boolean
	readonly request: FlatWizardStart
	camera?: EquipmentDevice<Camera>
	event: FlatWizardEvent
}

const state = proxy<FlatWizardState>({
	request: structuredClone(DEFAULT_FLAT_WIZARD_START),
	show: false,
	running: false,
	event: structuredClone(DEFAULT_FLAT_WIZARD_EVENT),
})

initProxy(state, 'flatwizard', ['o:request', 'p:show'])

export const FlatWizardMolecule = molecule(() => {
	const equipment = use(EquipmentMolecule)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(4)

		unsubscribers[0] = subscribeKey(state, 'camera', (camera) => {
			storageSet('flatwizard.camera', camera?.name ?? undefined)
			camera && updateCameraCaptureStartFromCamera(state.request.capture, camera)
		})

		unsubscribers[1] = bus.subscribe<CameraUpdated>('camera:update', (event) => {
			if (event.device.id === state.camera?.id && !state.camera.exposuring) {
				updateCameraCaptureStartFromCameraUpdated(state.request.capture, event)
			}
		})

		unsubscribers[2] = bus.subscribe<FlatWizardEvent>('flatwizard', (event) => {
			if (state.camera?.id === event.camera) {
				state.running = event.state !== 'IDLE'
				Object.assign(state.event, event)
			}
		})

		unsubscribers[3] = subscribeKey(state, 'show', (show) => {
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
		state.camera = equipment.get('CAMERA', storageGet('flatwizard.camera', ''))

		state.camera && updateCameraCaptureStartFromCamera(state.request.capture, state.camera)
	}

	function update<K extends keyof FlatWizardStart>(key: K, value: FlatWizardStart[K]) {
		state.request[key] = value
	}

	function updateCapture<K extends keyof FlatWizardStart['capture']>(key: K, value: FlatWizardStart['capture'][K]) {
		state.request.capture[key] = value
	}

	function start() {
		return Api.FlatWizard.start(state.camera!, state.request)
	}

	function stop() {
		return Api.FlatWizard.stop(state.camera!)
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
