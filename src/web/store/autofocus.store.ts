import { nanoid } from 'nanoid'
import type { Camera, Focuser } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import { type AutoFocusStart, type AutoFocusEvent, DEFAULT_AUTO_FOCUS_START, DEFAULT_AUTO_FOCUS_EVENT } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { autoFocusListStore } from './autofocus.list.store'
import { subscribeToUpdateCameraCaptureStartFromCamera } from './camera.store'
import type { DeviceState } from './equipment.store'

export type AutoFocusStore = ReturnType<typeof autoFocusStore>

export interface AutoFocusState {
	running: boolean
	readonly request: AutoFocusStart
	readonly camera: DeviceState<Camera>
	readonly focuser: DeviceState<Focuser>
	readonly event: AutoFocusEvent
}

export function autoFocusStore(camera: Camera, focuser: Focuser) {
	const state = proxy<AutoFocusState>({
		request: structuredClone(DEFAULT_AUTO_FOCUS_START),
		running: false,
		event: structuredClone(DEFAULT_AUTO_FOCUS_EVENT),
		camera,
		focuser,
	})

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('autofocus mounted:', camera.name, focuser.name)

		mounted = true

		u[0] = initProxy(state, `autofocus.${camera.id}.${focuser.id}`, ['o:request'])

		u[1] = bus.subscribe<AutoFocusEvent>('autofocus', (event) => {
			if (state.camera.id === event.camera && state.focuser.id === event.focuser) {
				state.running = event.state !== 'IDLE'
				Object.assign(state.event, event)
			}
		})

		subscribeToUpdateCameraCaptureStartFromCamera(u, camera, state.request.capture)

		state.request.id ||= nanoid()
	}

	function unmount() {
		if (!mounted) return
		console.info('autofocus unmounted:', camera.name, focuser.name)
		unsubscribe(u)
		mounted = false
	}

	function reset() {
		state.running = false
		state.event.state = 'IDLE'
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

	async function start() {
		if (state.running || !camera.connected || !focuser.connected) return

		state.running = true

		const response = await Api.AutoFocus.start(camera, focuser, state.request)

		if (!response?.ok) {
			reset()
		}
	}

	async function stop() {
		if (!state.running) return

		const response = await Api.AutoFocus.stop(state.request.id)

		if (response?.ok) {
			reset()
		}
	}

	function hide() {
		autoFocusListStore.hide(camera, focuser)
	}

	return {
		state,
		mount,
		unmount,
		update,
		updateCapture,
		updateStarDetection,
		start,
		stop,
		hide,
	} as const
}
