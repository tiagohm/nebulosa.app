import { createScope, molecule, onMount } from 'bunshi'
import { type Camera, type CameraCaptureStart, type CameraCaptureTaskEvent, DEFAULT_CAMERA, DEFAULT_CAMERA_CAPTURE_START, DEFAULT_CAMERA_CAPTURE_TASK_EVENT } from 'src/api/types'
import { proxy, subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import { BusMolecule } from '../bus'
import { EquipmentMolecule } from './equipment'

export interface CameraScopeValue {
	readonly camera: Camera
}

export interface CameraState {
	readonly camera: Camera
	readonly request: CameraCaptureStart
	readonly progress: CameraCaptureTaskEvent
	connecting: boolean
	capturing: boolean
	targetTemperature: number
}

export const CameraScope = createScope<CameraScopeValue>({ camera: DEFAULT_CAMERA })

const cameraStateMap = new Map<string, CameraState>()

// Molecule that manages the camera device
export const CameraMolecule = molecule((m, s) => {
	const scope = s(CameraScope)
	const bus = m(BusMolecule)
	const equipment = m(EquipmentMolecule)

	const cameraCaptureStartRequest = simpleLocalStorage.get<CameraCaptureStart>(`camera.${scope.camera.name}.request`, () => structuredClone(DEFAULT_CAMERA_CAPTURE_START))

	const state =
		cameraStateMap.get(scope.camera.name) ??
		proxy<CameraState>({
			camera: equipment.get('CAMERA', scope.camera.name) as Camera,
			request: cameraCaptureStartRequest,
			progress: structuredClone(DEFAULT_CAMERA_CAPTURE_TASK_EVENT),
			connecting: false,
			capturing: false,
			targetTemperature: scope.camera.temperature,
		})

	cameraStateMap.set(scope.camera.name, state)

	// Fetches the camera
	Api.Cameras.get(scope.camera.name).then((camera) => {
		Object.assign(state.camera, camera)
		updateRequestFrame(camera.frame)
	})

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(4)

		unsubscribers[0] = bus.subscribe('CAMERA_UPDATE', (event) => {
			if (event.device.name === state.camera.name) {
				if (event.property === 'connected') {
					state.connecting = false
				} else if (event.property === 'frame') {
					updateRequestFrame(event.device[event.property]!)
				} else if (event.property === 'exposure') {
					if (event.state === 'Ok') {
						state.capturing = false
					}
				}
			}
		})

		unsubscribers[1] = bus.subscribe('CAMERA_REMOVE', (camera) => {
			if (camera.name === state.camera.name) {
				cameraStateMap.delete(camera.name)
			}
		})

		unsubscribers[2] = bus.subscribe('CAMERA_CAPTURE', (event) => {
			if (event.device === state.camera.name) {
				Object.assign(state.progress, event)
			}
		})

		unsubscribers[3] = subscribe(state.request, () => simpleLocalStorage.set(`camera.${scope.camera.name}.request`, state.request))

		return () => {
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

	function start() {
		state.capturing = true
		return Api.Cameras.start(state.camera, state.request)
	}

	function stop() {
		return Api.Cameras.stop(state.camera)
	}

	return { scope, state, connectOrDisconnect, update, fullscreen, start, stop }
})
