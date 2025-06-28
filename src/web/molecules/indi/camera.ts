import { createScope, molecule, onMount } from 'bunshi'
import { type Camera, type CameraCaptureStart, DEFAULT_CAMERA, DEFAULT_CAMERA_CAPTURE_START } from 'src/api/types'
import { proxy, subscribe } from 'valtio'
import { deepClone } from 'valtio/utils'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import { BusMolecule } from '../bus'

export interface CameraScopeValue {
	readonly camera: Camera
}

export interface CameraState {
	camera: Camera
	connecting: boolean
	capturing: boolean
	targetTemperature: number
	readonly request: CameraCaptureStart
}

export const CameraScope = createScope<CameraScopeValue>({ camera: DEFAULT_CAMERA })

const cameraStateMap = new Map<string, CameraState>()

// Molecule that manages the camera device
export const CameraMolecule = molecule((m, s) => {
	const scope = s(CameraScope)
	const bus = m(BusMolecule)

	const cameraCaptureStartRequest = simpleLocalStorage.get<CameraCaptureStart>(`camera.${scope.camera.name}.request`, () => structuredClone(DEFAULT_CAMERA_CAPTURE_START))

	const state =
		cameraStateMap.get(scope.camera.name) ??
		proxy<CameraState>({
			camera: deepClone(scope.camera),
			connecting: false,
			capturing: false,
			targetTemperature: scope.camera.temperature,
			request: cameraCaptureStartRequest,
		})

	cameraStateMap.set(scope.camera.name, state)

	// Fetches the camera
	Api.Cameras.get(scope.camera.name).then((camera) => {
		Object.assign(state.camera, camera)
		updateRequestFrame(camera.frame)
	})

	onMount(() => {
		console.info('camera mounted', scope.camera.name)

		const unsubscribers = new Array<VoidFunction>(3)

		unsubscribers[0] = bus.subscribe('updateCamera', (event) => {
			if (event.device === state.camera.name) {
				state.camera[event.property] = event.value as never

				if (event.property === 'connected') {
					state.connecting = false
				} else if (event.property === 'frame') {
					updateRequestFrame(event.value as never)
				}
			}
		})

		unsubscribers[1] = bus.subscribe('removeCamera', (event) => {
			if (event.name === state.camera.name) {
				cameraStateMap.delete(event.name)
			}
		})

		unsubscribers[2] = subscribe(state.request, () => simpleLocalStorage.set(`camera.${scope.camera.name}.request`, state.request))

		return () => {
			console.info('camera unmounted', scope.camera.name)
			unsubscribers.forEach((unsubscriber) => unsubscriber())
		}
	})

	function updateRequestFrame(frame: Camera['frame']) {
		state.request.x = Math.max(frame.minX, Math.min(state.request.x, frame.maxX))
		state.request.y = Math.max(frame.minY, Math.min(state.request.y, frame.maxY))

		if (!state.request.width) state.request.width = frame.maxWidth
		else state.request.width = Math.min(state.request.width, frame.maxWidth)

		if (!state.request.height) state.request.height = frame.maxHeight
		else state.request.height = Math.min(state.request.height, frame.maxHeight)
	}

	// Updates the camera state with the given key and value
	function update<K extends keyof CameraState['request']>(key: K, value: CameraState['request'][K]) {
		state.request[key] = value
	}

	// Connects or disconnects the camera based on its current state
	async function connectOrDisconnect() {
		state.connecting = true

		if (state.camera.connected) {
			await Api.Indi.disconnect(state.camera)
		} else {
			await Api.Indi.connect(state.camera)
		}
	}

	function fullscreen() {
		state.request.x = state.camera.frame.minX
		state.request.y = state.camera.frame.minY
		state.request.width = state.camera.frame.maxWidth
		state.request.height = state.camera.frame.maxHeight
	}

	function start() {}

	function stop() {}

	return { scope, state, connectOrDisconnect, update, fullscreen, start, stop }
})
