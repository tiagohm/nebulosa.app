import { createScope, molecule, onMount, use } from 'bunshi'
import { type Camera, DEFAULT_CAMERA, type Focuser, type Mount, type Wheel } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import { type CameraCaptureEvent, type CameraCaptureStart, type CameraUpdated, DEFAULT_CAMERA_CAPTURE_EVENT, DEFAULT_CAMERA_CAPTURE_START } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref, subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import type { Image } from '@/shared/types'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface CameraScopeValue {
	readonly camera: Camera
}

export interface CameraState {
	minimized: boolean
	readonly camera: EquipmentDevice<Camera>
	readonly request: CameraCaptureStart
	readonly progress: CameraCaptureEvent
	capturing: boolean
	targetTemperature: number
	image?: Image
	readonly equipment: {
		mount?: EquipmentDevice<Mount>
		wheel?: EquipmentDevice<Wheel>
		focuser?: EquipmentDevice<Focuser>
	}
}

export const CameraScope = createScope<CameraScopeValue>({ camera: DEFAULT_CAMERA })

const stateMap = new Map<string, CameraState>()

export const CameraMolecule = molecule(() => {
	const scope = use(CameraScope)
	const equipment = use(EquipmentMolecule)

	const camera = equipment.get('CAMERA', scope.camera.name)!

	const state =
		stateMap.get(camera.name) ??
		proxy<CameraState>({
			minimized: false,
			camera,
			request: structuredClone(DEFAULT_CAMERA_CAPTURE_START),
			progress: structuredClone(DEFAULT_CAMERA_CAPTURE_EVENT),
			capturing: false,
			targetTemperature: camera.temperature,
			equipment: {},
		})

	stateMap.set(camera.name, state)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(7)

		unsubscribers[0] = bus.subscribe<CameraUpdated>('camera:update', (event) => {
			if (event.device.name === camera.name) {
				if (event.property === 'frame') {
					updateRequestFrame(state.request, event.device.frame!)
				} else if (event.property === 'frameFormats' && event.device.frameFormats?.length) {
					updateFrameFormat(state.request, event.device.frameFormats)
				}
			}
		})

		unsubscribers[1] = bus.subscribe<Camera>('camera:remove', (event) => {
			if (event.name === camera.name) {
				stateMap.delete(event.name)
			}
		})

		unsubscribers[2] = bus.subscribe<CameraCaptureEvent>('camera:capture', (event) => {
			if (event.device === camera.name) {
				Object.assign(state.progress, event)

				if (event.state === 'IDLE') {
					state.capturing = false
				} else if (event.state === 'EXPOSURE_STARTED') {
					state.capturing = true
				}
			}
		})

		unsubscribers[3] = bus.subscribe<Image>('image:add', (image) => {
			if (image.camera === camera && !state.image) {
				state.image = ref(image)
			}
		})

		unsubscribers[4] = bus.subscribe<Image>('image:remove', (image) => {
			if (image.key === state.image?.key) {
				state.image = undefined
			}
		})

		unsubscribers[5] = initProxy(state, `camera.${camera.name}`, ['o:request', 'p:minimized', 'p:targetTemperature'])

		state.equipment.mount = equipment.get('MOUNT', state.request.mount ?? '')
		state.equipment.wheel = equipment.get('WHEEL', state.request.wheel ?? '')
		state.equipment.focuser = equipment.get('FOCUSER', state.request.focuser ?? '')

		unsubscribers[6] = subscribe(state.equipment, () => {
			state.request.mount = state.equipment.mount?.name
			state.request.wheel = state.equipment.wheel?.name
			state.request.focuser = state.equipment.focuser?.name
		})

		updateRequestFrame(state.request, camera.frame)
		updateFrameFormat(state.request, camera.frameFormats)

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update<K extends keyof CameraState['request']>(key: K, value: CameraState['request'][K]) {
		state.request[key] = value
	}

	function connect() {
		return equipment.connect(camera)
	}

	function cooler(enabled: boolean) {
		return Api.Cameras.cooler(camera, enabled)
	}

	function temperature(value: number) {
		return Api.Cameras.temperature(camera, value)
	}

	function fullscreen() {
		state.request.x = camera.frame.minX
		state.request.y = camera.frame.minY
		state.request.width = camera.frame.maxWidth
		state.request.height = camera.frame.maxHeight
	}

	function updateMount(mount?: EquipmentDevice<Mount>) {
		state.equipment.mount = mount
	}

	function updateWheel(wheel?: EquipmentDevice<Wheel>) {
		state.equipment.wheel = wheel
	}

	function updateFocuser(focuser?: EquipmentDevice<Focuser>) {
		state.equipment.focuser = focuser
	}

	function start() {
		state.capturing = true
		return Api.Cameras.start(camera, state.request)
	}

	function stop() {
		return Api.Cameras.stop(camera)
	}

	function hide() {
		return equipment.hide('CAMERA', camera)
	}

	function minimize() {
		state.minimized = !state.minimized
	}

	return { scope, state, connect, update, cooler, temperature, fullscreen, updateMount, updateWheel, updateFocuser, start, stop, hide, minimize } as const
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
