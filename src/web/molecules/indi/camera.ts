import { createScope, molecule, onMount } from 'bunshi'
import { BusMolecule } from 'src/shared/bus'
import { type Camera, type CameraCaptureStart, type CameraCaptureTaskEvent, type CameraUpdated, DEFAULT_CAMERA, DEFAULT_CAMERA_CAPTURE_START, DEFAULT_CAMERA_CAPTURE_TASK_EVENT } from 'src/shared/types'
import { proxy, ref, subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import type { Image } from '@/shared/types'
import { ImageWorkspaceMolecule } from '../image/workspace'
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
	image?: Image
}

export const CameraScope = createScope<CameraScopeValue>({ camera: DEFAULT_CAMERA })

const cameraStateMap = new Map<string, CameraState>()

// Molecule that manages the camera device
export const CameraMolecule = molecule((m, s) => {
	const scope = s(CameraScope)
	const bus = m(BusMolecule)
	const equipment = m(EquipmentMolecule)
	const workspace = m(ImageWorkspaceMolecule)

	const cameraCaptureStartRequest = simpleLocalStorage.get<CameraCaptureStart>(`camera.${scope.camera.name}.request`, () => structuredClone(DEFAULT_CAMERA_CAPTURE_START))

	const state =
		cameraStateMap.get(scope.camera.name) ??
		proxy<CameraState>({
			camera: equipment.get('camera', scope.camera.name) as Camera,
			request: cameraCaptureStartRequest,
			progress: structuredClone(DEFAULT_CAMERA_CAPTURE_TASK_EVENT),
			connecting: false,
			capturing: false,
			targetTemperature: scope.camera.temperature,
		})

	cameraStateMap.set(scope.camera.name, state)

	// Fetches the camera
	Api.Cameras.get(scope.camera.name).then((camera) => {
		if (!camera) return
		Object.assign(state.camera, camera)
		updateRequestFrame(camera.frame)
		updateFrameFormat(camera.frameFormats)
	})

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(5)

		unsubscribers[0] = bus.subscribe<CameraUpdated>('camera:update', (event) => {
			if (event.device.name === state.camera.name) {
				if (event.property === 'connected') {
					state.connecting = false
				} else if (event.property === 'frame') {
					updateRequestFrame(event.device.frame!)
				} else if (event.property === 'frameFormats' && event.device.frameFormats?.length) {
					updateFrameFormat(event.device.frameFormats)
				}
			}
		})

		unsubscribers[1] = bus.subscribe<Camera>('camera:remove', (camera) => {
			if (camera.name === state.camera.name) {
				cameraStateMap.delete(camera.name)
			}
		})

		unsubscribers[2] = bus.subscribe<CameraCaptureTaskEvent>('camera:capture', (event) => {
			if (event.device === state.camera.name) {
				if (event.savedPath && !state.image) {
					const image = workspace.add(event.savedPath, `camera-${event.device}`, scope.camera)
					state.image = ref(image)
				} else {
					Object.assign(state.progress, event)
				}

				if (event.state === 'IDLE') {
					state.capturing = false
				}
			}
		})

		unsubscribers[3] = bus.subscribe<Image>('image:remove', (image) => {
			if (image.key === state.image?.key) {
				state.image = undefined
			}
		})

		unsubscribers[4] = subscribe(state.request, () => simpleLocalStorage.set(`camera.${scope.camera.name}.request`, state.request))

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

	function updateFrameFormat(frameFormats?: string[]) {
		if (!frameFormats?.length) return

		if (!state.request.frameFormat || !frameFormats.includes(state.request.frameFormat)) {
			state.request.frameFormat = frameFormats[0]
		}
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

	function cooler(enabled: boolean) {
		return Api.Cameras.cooler(state.camera, enabled)
	}

	function temperature(value: number) {
		return Api.Cameras.temperature(state.camera, value)
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

	function close() {
		return equipment.closeModal('camera', scope.camera)
	}

	return { scope, state, connectOrDisconnect, update, cooler, temperature, fullscreen, start, stop, close } as const
})
