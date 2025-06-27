import { createScope, molecule, onMount } from 'bunshi'
import { type Camera, DEFAULT_CAMERA } from 'src/api/types'
import { proxy } from 'valtio'

export interface CameraScopeValue {
	readonly camera: Camera
}

export interface CameraState {
	readonly camera: Camera
	connecting: boolean
	capturing: boolean
}

export const CameraScope = createScope<CameraScopeValue>({ camera: DEFAULT_CAMERA })

// Molecule that manages the camera device
export const CameraMolecule = molecule((m, s) => {
	const scope = s(CameraScope)

	const state = proxy<CameraState>({
		camera: scope.camera,
		connecting: false,
		capturing: false,
	})

	onMount(() => {
		console.info('camera mounted', scope.camera.name)

		return () => {
			console.info('camera unmounted', scope.camera.name)
		}
	})

	function update<K extends keyof CameraState>(key: K, value: CameraState[K]) {
		state[key] = value
	}

	function connectOrDisconnect() {
		state.connecting = true
	}

	function start() {}

	function stop() {}

	return { scope, state, connectOrDisconnect, update, start, stop }
})
