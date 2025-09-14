import { molecule, onMount } from 'bunshi'
import bus, { unsubscribe } from 'src/shared/bus'
import { type Camera, DEFAULT_TPPA_EVENT, DEFAULT_TPPA_START, type Mount, type TppaEvent, type TppaStart } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import { type EquipmentDevice, EquipmentMolecule } from './indi/equipment'

export interface TppaState {
	show: boolean
	running: boolean
	readonly request: TppaStart
	camera?: EquipmentDevice<Camera>
	mount?: EquipmentDevice<Mount>
	event: TppaEvent
}

let tppaState: TppaState | undefined

export const TppaMolecule = molecule((m) => {
	const equipment = m(EquipmentMolecule)

	const request = simpleLocalStorage.get('tppa.request', () => structuredClone(DEFAULT_TPPA_START))

	request.id = Date.now().toFixed(0)

	const state =
		tppaState ??
		proxy<TppaState>({
			request,
			show: false,
			running: false,
			camera: undefined,
			mount: undefined,
			event: structuredClone(DEFAULT_TPPA_EVENT),
		})

	tppaState = state

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(5)

		unsubscribers[0] = subscribe(state.request, () => {
			simpleLocalStorage.set('tppa.request', state.request)
		})

		unsubscribers[1] = subscribeKey(state, 'camera', (camera) => {
			simpleLocalStorage.set('tppa.camera', camera?.name ?? undefined)
		})

		unsubscribers[2] = subscribeKey(state, 'mount', (mount) => {
			simpleLocalStorage.set('tppa.mount', mount?.name ?? undefined)
		})

		unsubscribers[3] = bus.subscribe<TppaEvent>('tppa', (event) => {
			if (request.id === event.id) {
				Object.assign(state.event, event)
			}
		})

		unsubscribers[4] = subscribeKey(state, 'show', (show) => {
			if (!show) return

			state.camera = equipment.get('CAMERA', simpleLocalStorage.get('tppa.camera', ''))
			state.mount = equipment.get('MOUNT', simpleLocalStorage.get('tppa.mount', ''))
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

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
