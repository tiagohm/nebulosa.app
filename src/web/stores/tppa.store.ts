import { nanoid } from 'nanoid'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import bus from 'src/shared/bus'
import { DEFAULT_TPPA_EVENT, DEFAULT_TPPA_START, type TppaEvent, type TppaStart } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { subscribeToUpdateCameraCaptureStartFromCamera } from './camera.store'
import type { DeviceState } from './equipment.store'
import { tppaListStore } from './tppa.list.store'

export type TppaStore = ReturnType<typeof tppaStore>

export interface TppaState {
	running: boolean
	readonly request: TppaStart
	readonly camera: DeviceState<Camera>
	readonly mount: DeviceState<Mount>
	readonly event: TppaEvent
}

export function tppaStore(camera: Camera, mount: Mount) {
	const state = proxy<TppaState>({
		request: structuredClone(DEFAULT_TPPA_START),
		running: false,
		event: structuredClone(DEFAULT_TPPA_EVENT),
		camera,
		mount,
	})

	console.info('tppa created:', camera.name, mount.name)

	const u: VoidFunction[] = []
	let mounted = false

	function _mount() {
		if (mounted) return

		console.info('tppa mounted:', camera.name, mount.name)

		mounted = true

		u[0] = initProxy(state, `tppa.${camera.id}.${mount.id}`, ['o:request'])

		u[1] = bus.subscribe<TppaEvent>('tppa', (event) => {
			if (state.camera.id === event.camera && state.mount.id === event.mount) {
				state.running = event.state !== 'idle'
				Object.assign(state.event, event)
			}
		})

		subscribeToUpdateCameraCaptureStartFromCamera(u, camera, state.request.capture)

		state.request.id ||= nanoid()
	}

	function unmount() {
		if (!mounted) return
		console.info('tppa unmounted:', camera.name, mount.name)
		unsubscribe(u)
		mounted = false
	}

	function reset() {
		state.running = false
		Object.assign(state.event, DEFAULT_TPPA_EVENT)
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
		if (state.running || !camera.connected || !mount.connected) return

		state.running = true

		const response = await Api.TPPA.start(camera, mount, state.request)

		if (!response?.ok) {
			reset()
		}
	}

	async function stop() {
		if (!state.running) return

		const response = await Api.TPPA.stop(state.request.id)

		if (response?.ok) {
			reset()
		}
	}

	function hide() {
		tppaListStore.hide(camera, mount)
	}

	return {
		state,
		mount: _mount,
		unmount,
		update,
		updateSolver,
		updateCapture,
		updateRefraction,
		start,
		stop,
		hide,
	} as const
}
