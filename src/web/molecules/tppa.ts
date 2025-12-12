import { molecule, onMount, use } from 'bunshi'
import type { Camera, Mount } from 'nebulosa/src/indi.device'
import bus, { unsubscribe } from 'src/shared/bus'
import { DEFAULT_TPPA_EVENT, DEFAULT_TPPA_START, type TppaEvent, type TppaStart } from 'src/shared/types'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { storageGet, storageSet } from '@/shared/storage'
import { updateFrameFormat } from './indi/camera'
import { type EquipmentDevice, EquipmentMolecule } from './indi/equipment'

export interface TppaState {
	show: boolean
	running: boolean
	readonly request: TppaStart
	camera?: EquipmentDevice<Camera>
	mount?: EquipmentDevice<Mount>
	event: TppaEvent
}

const state = proxy<TppaState>({
	request: structuredClone(DEFAULT_TPPA_START),
	show: false,
	running: false,
	event: structuredClone(DEFAULT_TPPA_EVENT),
})

initProxy(state, 'tppa', ['o:request', 'p:show'])

export const TppaMolecule = molecule(() => {
	const equipment = use(EquipmentMolecule)

	onMount(() => {
		state.request.id = Date.now().toFixed(0)

		const unsubscribers = new Array<VoidFunction>(4)

		unsubscribers[0] = subscribeKey(state, 'camera', (camera) => {
			storageSet('tppa.camera', camera?.name ?? undefined)
			camera && updateFrameFormat(state.request.capture, camera.frameFormats)
		})

		unsubscribers[1] = subscribeKey(state, 'mount', (mount) => {
			storageSet('tppa.mount', mount?.name ?? undefined)
		})

		unsubscribers[2] = bus.subscribe<TppaEvent>('tppa', (event) => {
			if (state.request.id === event.id) {
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
		state.camera = equipment.get('CAMERA', storageGet('tppa.camera', ''))
		state.mount = equipment.get('MOUNT', storageGet('tppa.mount', ''))

		if (state.camera) {
			updateFrameFormat(state.request.capture, state.camera.frameFormats)
		}
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

	function start() {
		return Api.TPPA.start(state.camera!, state.mount!, state.request)
	}

	function stop() {
		return Api.TPPA.stop(state.request)
	}

	function show() {
		bus.emit('homeMenu:toggle', false)
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, update, updateSolver, updateCapture, updateRefraction, start, stop, show, hide }
})
