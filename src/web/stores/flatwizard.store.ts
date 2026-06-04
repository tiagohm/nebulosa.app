import { nanoid } from 'nanoid'
import type { Camera } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import { type FlatWizardStart, type FlatWizardEvent, DEFAULT_FLAT_WIZARD_START, DEFAULT_FLAT_WIZARD_EVENT } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { subscribeToUpdateCameraCaptureStartFromCamera } from './camera.store'
import type { DeviceState } from './equipment.store'

export type FlatWizardStore = ReturnType<typeof flatWizardStore>

export interface FlatWizardState {
	running: boolean
	readonly request: FlatWizardStart
	readonly camera: DeviceState<Camera>
	readonly event: FlatWizardEvent
}

export function flatWizardStore(camera: Camera) {
	const state = proxy<FlatWizardState>({
		running: false,
		request: structuredClone(DEFAULT_FLAT_WIZARD_START),
		event: structuredClone(DEFAULT_FLAT_WIZARD_EVENT),
		camera,
	})

	const u: VoidFunction[] = []
	let mounted = false

	console.info('flat wizard created', camera.name)

	function mount() {
		if (mounted) return

		console.info('flat wizard mounted:', camera.name)

		mounted = true

		u[0] = initProxy(state, `flatwizard.${camera.id}`, ['o:request'])

		u[1] = bus.subscribe<FlatWizardEvent>('flatwizard', (event) => {
			if (state.camera.id === event.camera) {
				state.running = event.state !== 'idle'
				Object.assign(state.event, event)
			}
		})

		subscribeToUpdateCameraCaptureStartFromCamera(u, camera, state.request.capture)

		state.request.id ||= nanoid()
	}

	function unmount() {
		if (!mounted) return
		console.info('flat wizard unmounted:', camera.name)
		unsubscribe(u)
		mounted = false
	}

	function reset() {
		state.running = false
		state.event.state = 'idle'
	}

	function update<K extends keyof FlatWizardStart>(key: K, value: FlatWizardStart[K]) {
		state.request[key] = value
	}

	function updateCapture<K extends keyof FlatWizardStart['capture']>(key: K, value: FlatWizardStart['capture'][K]) {
		state.request.capture[key] = value
	}

	function setPath(path?: string) {
		state.request.path = path ?? ''
	}

	async function start() {
		if (state.running || !camera.connected) return

		state.running = true

		const response = await Api.FlatWizard.start(camera, state.request)

		if (!response?.ok) {
			reset()
		}
	}

	async function stop() {
		if (!state.running) return

		const response = await Api.FlatWizard.stop(state.request.id)

		if (response?.ok) {
			reset()
		}
	}

	function hide() {}

	return {
		state,
		mount,
		unmount,
		update,
		updateCapture,
		setPath,
		start,
		stop,
		hide,
	} as const
}
