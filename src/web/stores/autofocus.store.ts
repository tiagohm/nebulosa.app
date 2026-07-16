import { Api } from '@shared/api'
import { autoFocusBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import type { DeviceState } from '@stores/equipment.store'
import type { Camera, Focuser } from 'nebulosa/src/devices/indi/device'
import { type AutoFocusStart, type AutoFocusEvent, DEFAULT_AUTO_FOCUS_START, DEFAULT_AUTO_FOCUS_EVENT } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'

export type AutoFocusStore = ReturnType<typeof autoFocusStore>

export interface AutoFocusState {
	running: boolean
	readonly request: AutoFocusStart
	camera?: DeviceState<Camera>
	focuser?: DeviceState<Focuser>
	readonly event: AutoFocusEvent
}

export function autoFocusStore(id: string) {
	const state = proxy<AutoFocusState>({
		request: structuredClone(DEFAULT_AUTO_FOCUS_START),
		running: false,
		event: structuredClone(DEFAULT_AUTO_FOCUS_EVENT),
	})

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('autofocus mounted:', id)

		mounted = true

		u[0] = initProxy(state, `autofocus.${id}`, ['o:request'])

		u[1] = autoFocusBus.subscribe('update', (event) => {
			if (state.camera?.id === event.camera && state.focuser?.id === event.focuser) {
				state.running = event.state !== 'idle'
				Object.assign(state.event, event)
			}
		})

		// TODO: subscribeToUpdateCameraCaptureStartFromCamera(u, camera, state.request.capture)

		state.request.id = id
	}

	function unmount() {
		if (!mounted) return
		console.info('autofocus unmounted:', id)
		unsubscribe(u)
		mounted = false
	}

	function reset() {
		state.running = false
		state.event.state = 'idle'
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
		if (state.running || !state.camera?.connected || !state.focuser?.connected) return

		state.running = true

		const response = await Api.AutoFocus.start(state.camera, state.focuser, state.request)

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

	return {
		state,
		mount,
		unmount,
		update,
		updateCapture,
		updateStarDetection,
		start,
		stop,
	} as const
}
