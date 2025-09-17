import { molecule, onMount } from 'bunshi'
import bus, { unsubscribe } from 'src/shared/bus'
import { type Camera, type DarvEvent, type DarvStart, DEFAULT_DARV_EVENT, DEFAULT_DARV_START, type Mount } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { storage } from '@/shared/storage'
import { updateFrameFormat } from './indi/camera'
import { type EquipmentDevice, EquipmentMolecule } from './indi/equipment'

export interface DarvState {
	show: boolean
	running: boolean
	readonly request: DarvStart
	camera?: EquipmentDevice<Camera>
	mount?: EquipmentDevice<Mount>
	event: DarvEvent
}

let darvState: DarvState | undefined

export const DarvMolecule = molecule((m) => {
	const equipment = m(EquipmentMolecule)

	const request = storage.get('darv.request', () => structuredClone(DEFAULT_DARV_START))

	request.id = Date.now().toFixed(0)

	const state =
		darvState ??
		proxy<DarvState>({
			request,
			show: false,
			running: false,
			camera: undefined,
			mount: undefined,
			event: structuredClone(DEFAULT_DARV_EVENT),
		})

	darvState = state

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(6)

		unsubscribers[0] = subscribe(state.request, () => {
			storage.set('darv.request', state.request)
		})

		unsubscribers[1] = subscribeKey(state, 'camera', (camera) => {
			storage.set('darv.camera', camera?.name ?? undefined)
		})

		unsubscribers[2] = subscribeKey(state, 'mount', (mount) => {
			storage.set('darv.mount', mount?.name ?? undefined)
		})

		unsubscribers[3] = bus.subscribe<DarvEvent>('darv', (event) => {
			if (request.id === event.id) {
				state.running = event.state !== 'IDLE'
				Object.assign(state.event, event)
			}
		})

		unsubscribers[4] = subscribeKey(state, 'show', (show) => {
			if (!show) return

			state.camera = equipment.get('CAMERA', storage.get('darv.camera', ''))
			state.mount = equipment.get('MOUNT', storage.get('darv.mount', ''))

			if (state.camera) {
				updateFrameFormat(state.request.capture, state.camera.frameFormats)
			}
		})

		unsubscribers[5] = subscribeKey(state, 'camera', (camera) => {
			if (camera) {
				updateFrameFormat(state.request.capture, camera.frameFormats)
			}
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

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
