import { createScope, molecule, onMount } from 'bunshi'
import bus, { unsubscribe } from 'src/shared/bus'
import { type Camera, type CameraCaptureEvent, type CameraCaptureStart, type CameraUpdated, DEFAULT_CAMERA, DEFAULT_CAMERA_CAPTURE_EVENT, DEFAULT_CAMERA_CAPTURE_START, type Mount } from 'src/shared/types'
import { proxy, ref, subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import type { Image } from '@/shared/types'
import { ImageWorkspaceMolecule } from '../image/workspace'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface CameraScopeValue {
	readonly camera: Camera
}

export interface CameraState {
	readonly camera: EquipmentDevice<Camera>
	readonly request: CameraCaptureStart
	readonly progress: CameraCaptureEvent
	capturing: boolean
	targetTemperature: number
	image?: Image
	readonly equipment: {
		mount?: EquipmentDevice<Mount>
	}
}

export const CameraScope = createScope<CameraScopeValue>({ camera: DEFAULT_CAMERA })

const cameraStateMap = new Map<string, CameraState>()

export const CameraMolecule = molecule((m, s) => {
	const scope = s(CameraScope)
	const equipment = m(EquipmentMolecule)
	const workspace = m(ImageWorkspaceMolecule)

	const cameraCaptureStartRequest = simpleLocalStorage.get<CameraCaptureStart>(`camera.${scope.camera.name}.request`, () => structuredClone(DEFAULT_CAMERA_CAPTURE_START))

	const state =
		cameraStateMap.get(scope.camera.name) ??
		proxy<CameraState>({
			camera: equipment.get('CAMERA', scope.camera.name)!,
			request: cameraCaptureStartRequest,
			progress: structuredClone(DEFAULT_CAMERA_CAPTURE_EVENT),
			capturing: false,
			targetTemperature: scope.camera.temperature,
			equipment: {
				mount: equipment.get('MOUNT', cameraCaptureStartRequest.mount ?? ''),
			},
		})

	cameraStateMap.set(scope.camera.name, state)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(6)

		unsubscribers[0] = bus.subscribe<CameraUpdated>('camera:update', (event) => {
			if (event.device.name === state.camera.name) {
				if (event.property === 'frame') {
					updateRequestFrame(state.request, event.device.frame!)
				} else if (event.property === 'frameFormats' && event.device.frameFormats?.length) {
					updateFrameFormat(state.request, event.device.frameFormats)
				}
			}
		})

		unsubscribers[1] = bus.subscribe<Camera>('camera:remove', (camera) => {
			if (camera.name === state.camera.name) {
				cameraStateMap.delete(camera.name)
			}
		})

		unsubscribers[2] = bus.subscribe<CameraCaptureEvent>('camera:capture', (event) => {
			if (event.device === state.camera.name) {
				Object.assign(state.progress, event)

				if (event.state === 'IDLE') {
					state.capturing = false
				} else {
					state.capturing = true
				}
			}
		})

		unsubscribers[3] = bus.subscribe<Image>('image:add', (image) => {
			if (image.camera === state.camera && !state.image) {
				state.image = ref(image)
			}
		})

		unsubscribers[4] = bus.subscribe<Image>('image:remove', (image) => {
			if (image.key === state.image?.key) {
				state.image = undefined
			}
		})

		unsubscribers[5] = subscribe(state.request, () => simpleLocalStorage.set(`camera.${scope.camera.name}.request`, state.request))

		updateRequestFrame(state.request, state.camera.frame)
		updateFrameFormat(state.request, state.camera.frameFormats)

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update<K extends keyof CameraState['request']>(key: K, value: CameraState['request'][K]) {
		state.request[key] = value
	}

	function connect() {
		return equipment.connect(state.camera)
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
		state.request.mount = state.equipment.mount?.name
		return Api.Cameras.start(state.camera, state.request)
	}

	function stop() {
		return Api.Cameras.stop(state.camera)
	}

	function hide() {
		return equipment.hide('CAMERA', scope.camera)
	}

	return { scope, state, connect, update, cooler, temperature, fullscreen, start, stop, hide } as const
})

export function updateRequestFrame(request: CameraCaptureStart, frame: Camera['frame']) {
	request.x = Math.max(frame.minX, Math.min(request.x, frame.maxX))
	request.y = Math.max(frame.minY, Math.min(request.y, frame.maxY))

	if (!request.width) request.width = frame.maxWidth
	else request.width = Math.min(request.width, frame.maxWidth)

	if (!request.height) request.height = frame.maxHeight
	else request.height = Math.min(request.height, frame.maxHeight)
}

export function updateFrameFormat(request: CameraCaptureStart, frameFormats?: string[]) {
	if (!frameFormats?.length) return

	if (!request.frameFormat || !frameFormats.includes(request.frameFormat)) {
		request.frameFormat = frameFormats[0]
	}
}
