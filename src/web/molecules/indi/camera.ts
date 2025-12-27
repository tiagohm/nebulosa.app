import { addToast } from '@heroui/react'
import { createScope, molecule, onMount, use } from 'bunshi'
import { type Camera, DEFAULT_CAMERA, type Focuser, type MinMaxValueProperty, type Mount, type Rotator, type Wheel } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import { type CameraCaptureEvent, type CameraCaptureStart, type CameraUpdated, DEFAULT_CAMERA_CAPTURE_EVENT, DEFAULT_CAMERA_CAPTURE_START } from 'src/shared/types'
import { exposureTimeIn, unsubscribe } from 'src/shared/util'
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
	camera: EquipmentDevice<Camera>
	readonly request: CameraCaptureStart
	readonly progress: CameraCaptureEvent
	capturing: boolean
	targetTemperature: number
	image?: Image
	readonly equipment: {
		mount?: EquipmentDevice<Mount>
		wheel?: EquipmentDevice<Wheel>
		focuser?: EquipmentDevice<Focuser>
		rotator?: EquipmentDevice<Rotator>
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
		state.camera = equipment.get('CAMERA', state.camera.name)!

		const unsubscribers = new Array<VoidFunction>(7)

		unsubscribers[0] = bus.subscribe<CameraUpdated>('camera:update', (event) => {
			if (event.device.name === camera.name) {
				if (event.property === 'frame') {
					updateRequestFrame(state.request, event.device.frame!)
				} else if (event.property === 'frameFormats' && event.device.frameFormats?.length) {
					updateFrameFormat(state.request, event.device.frameFormats)
				} else if (event.property === 'exposure' && !camera.exposuring && event.device.exposure?.max) {
					updateExposureTime(state.request, event.device.exposure)
				} else if (event.property === 'connected') {
					if (!event.device.connected && event.state === 'Alert') {
						addToast({ title: 'CAMERA', description: `Failed to connect to camera ${camera.name}`, color: 'danger' })
					}

					state.camera.connecting = false
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

		const timer = setTimeout(() => {
			state.equipment.mount = equipment.get('MOUNT', state.request.mount ?? '')
			state.equipment.wheel = equipment.get('WHEEL', state.request.wheel ?? '')
			state.equipment.focuser = equipment.get('FOCUSER', state.request.focuser ?? '')
			state.equipment.rotator = equipment.get('ROTATOR', state.request.rotator ?? '')
		}, 2000)

		unsubscribers[6] = subscribe(state.equipment, () => {
			state.request.mount = state.equipment.mount?.name
			state.request.wheel = state.equipment.wheel?.name
			state.request.focuser = state.equipment.focuser?.name
			state.request.rotator = state.equipment.rotator?.name
		})

		updateRequestFrame(state.request, camera.frame)
		updateFrameFormat(state.request, camera.frameFormats)
		updateExposureTime(state.request, camera.exposure)

		return () => {
			unsubscribe(unsubscribers)
			clearTimeout(timer)
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
		state.request.x = camera.frame.x.min
		state.request.y = camera.frame.y.min
		state.request.width = camera.frame.width.max
		state.request.height = camera.frame.height.max
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

	function updateRotator(rotator?: EquipmentDevice<Rotator>) {
		state.equipment.rotator = rotator
	}

	function start() {
		state.capturing = true
		return Api.Cameras.start(camera, state.request)
	}

	function stop() {
		return Api.Cameras.stop(camera)
	}

	function hide() {
		equipment.hide('CAMERA', camera)
	}

	function minimize() {
		state.minimized = !state.minimized
	}

	return { scope, state, connect, update, cooler, temperature, fullscreen, updateMount, updateWheel, updateFocuser, updateRotator, start, stop, hide, minimize } as const
})

export function updateRequestFrame(request: CameraCaptureStart, frame: Camera['frame']) {
	request.x = Math.max(frame.x.min, Math.min(request.x, frame.x.max))
	request.y = Math.max(frame.y.min, Math.min(request.y, frame.y.max))

	if (!request.width) request.width = frame.width.max
	else request.width = Math.min(request.width, frame.width.max)

	if (!request.height) request.height = frame.height.max
	else request.height = Math.min(request.height, frame.height.max)
}

export function updateFrameFormat(request: CameraCaptureStart, frameFormats?: string[]) {
	if (!frameFormats?.length) return

	if (!request.frameFormat || !frameFormats.includes(request.frameFormat)) {
		request.frameFormat = frameFormats[0]
	}
}

export function updateExposureTime(request: CameraCaptureStart, exposure: MinMaxValueProperty) {
	const min = Math.max(1, exposureTimeIn(exposure.min, 'SECOND', request.exposureTimeUnit))
	const max = exposureTimeIn(exposure.max, 'SECOND', request.exposureTimeUnit)
	request.exposureTime = Math.max(min, Math.min(request.exposureTime, max))
}
