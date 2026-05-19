import type { Camera, Focuser, MinMaxValueProperty, Mount, NameAndLabel, Rotator, Wheel } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import { type CameraCaptureStart, type CameraCaptureEvent, DEFAULT_CAMERA_CAPTURE_START, DEFAULT_CAMERA_CAPTURE_EVENT, type CameraUpdated } from 'src/shared/types'
import { exposureTimeIn, unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { type DeviceState, equipmentStore } from './equipment.store'

export type CameraStore = ReturnType<typeof cameraStore>

export interface CameraState {
	camera: DeviceState<Camera>
	minimized: boolean
	readonly request: CameraCaptureStart
	readonly progress: CameraCaptureEvent
	capturing: boolean
	targetTemperature: number
	// image?: Image
	readonly equipment: {
		mount?: DeviceState<Mount>
		wheel?: DeviceState<Wheel>
		focuser?: DeviceState<Focuser>
		rotator?: DeviceState<Rotator>
	}
}

export function cameraStore(camera: Camera) {
	const state = proxy<CameraState>({
		camera,
		minimized: false,
		request: structuredClone(DEFAULT_CAMERA_CAPTURE_START),
		progress: structuredClone(DEFAULT_CAMERA_CAPTURE_EVENT),
		capturing: false,
		targetTemperature: camera.temperature,
		equipment: {},
	})

	console.info('camera created:', camera.name)

	function mount() {
		console.info('camera mounted:', camera.name)

		const u: VoidFunction[] = []

		u[0] = bus.subscribe<CameraCaptureEvent>('camera:capture', (event) => {
			if (event.camera === camera.id) {
				Object.assign(state.progress, event)

				if (event.state === 'IDLE') {
					state.capturing = false
				} else if (event.state === 'EXPOSURE_STARTED') {
					state.capturing = true
				}
			}
		})

		u[1] = initProxy(state, `camera.${camera.name}`, ['o:request', 'p:minimized', 'p:targetTemperature'])
		u[2] = subscribeKey(camera, 'frameFormats', (formats) => updateCameraFrameFormat(state.request, formats))
		u[3] = subscribeKey(camera, 'exposure', (exposure) => updateCameraExposureTime(state.request, exposure))
		u[4] = subscribeKey(camera, 'frame', (frame) => updateCameraFrame(state.request, frame))

		updateCameraCaptureStartFromCamera(state.request, camera)

		return () => {
			unsubscribe(u)
			unmount()
		}
	}

	function unmount() {
		console.info('camera unmounted:', camera.name)
	}

	function update<K extends keyof CameraState['request']>(key: K, value: CameraState['request'][K]) {
		state.request[key] = value
	}

	function updateSavePath(path?: string) {
		return update('savePath', path)
	}

	function updateDither<K extends keyof CameraState['request']['dither']>(key: K, value: CameraState['request']['dither'][K]) {
		state.request.dither[key] = value
	}

	function connect() {
		return equipmentStore.connect(camera)
	}

	function cooler(enabled: boolean) {
		return Api.Cameras.cooler(camera, enabled)
	}

	function temperature() {
		return Api.Cameras.temperature(camera, state.targetTemperature)
	}

	function fullscreen() {
		state.request.x = camera.frame.x.min
		state.request.y = camera.frame.y.min
		state.request.width = camera.frame.width.max
		state.request.height = camera.frame.height.max
	}

	function updateMount(mount?: DeviceState<Mount>) {
		state.equipment.mount = mount
	}

	function updateWheel(wheel?: DeviceState<Wheel>) {
		state.equipment.wheel = wheel
	}

	function updateFocuser(focuser?: DeviceState<Focuser>) {
		state.equipment.focuser = focuser
	}

	function updateRotator(rotator?: DeviceState<Rotator>) {
		state.equipment.rotator = rotator
	}

	async function start() {
		if (state.capturing) return

		state.capturing = true

		try {
			const response = await Api.Cameras.start(camera, state.request)
			if (!response.ok) state.capturing = false
		} catch {
			state.capturing = false
		}
	}

	function stop() {
		return Api.Cameras.stop(camera)
	}

	function show() {
		equipmentStore.show(camera)
	}

	function hide() {
		equipmentStore.hide(camera)
	}

	function minimize() {
		state.minimized = !state.minimized
	}

	return {
		state,
		mount,
		connect,
		update,
		updateSavePath,
		updateDither,
		cooler,
		temperature,
		fullscreen,
		updateMount,
		updateWheel,
		updateFocuser,
		updateRotator,
		start,
		stop,
		show,
		hide,
		minimize,
	} as const
}

export function updateCameraFrame(request: CameraCaptureStart, frame: Camera['frame']) {
	if (frame.x.max) request.x = Math.max(frame.x.min, Math.min(request.x, frame.x.max))
	if (frame.y.max) request.y = Math.max(frame.y.min, Math.min(request.y, frame.y.max))

	if (frame.width.max) {
		if (!request.width) request.width = frame.width.max
		else request.width = Math.min(request.width, frame.width.max)
	}

	if (frame.height.max) {
		if (!request.height) request.height = frame.height.max
		else request.height = Math.min(request.height, frame.height.max)
	}
}

export function updateCameraFrameFormat(request: CameraCaptureStart, frameFormats?: readonly NameAndLabel[]) {
	if (!frameFormats?.length) return

	if (!request.frameFormat || !frameFormats.some((e) => e.name === request.frameFormat)) {
		request.frameFormat = frameFormats[0].name
	}
}

export function updateCameraExposureTime(request: CameraCaptureStart, exposure: MinMaxValueProperty) {
	if (exposure.max > 0) {
		const min = Math.max(1, exposureTimeIn(exposure.min, 'SECOND', request.exposureTimeUnit))
		const max = exposureTimeIn(exposure.max, 'SECOND', request.exposureTimeUnit)
		request.exposureTime = Math.max(min, Math.min(request.exposureTime, max))
	}
}

export function updateCameraCaptureStartFromCamera(capture: CameraCaptureStart, camera: Camera) {
	updateCameraFrameFormat(capture, camera.frameFormats)
	updateCameraFrame(capture, camera.frame)
	!camera.exposuring && updateCameraExposureTime(capture, camera.exposure)
}

export function updateCameraCaptureStartFromCameraUpdated(capture: CameraCaptureStart, event: CameraUpdated) {
	if (event.state === 'Alert' || event.state === 'Busy') return

	if (event.property === 'frame') {
		updateCameraFrame(capture, event.device.frame!)
	} else if (event.property === 'frameFormats' && event.device.frameFormats?.length) {
		updateCameraFrameFormat(capture, event.device.frameFormats)
	} else if (event.property === 'exposure' && event.device.exposure?.max) {
		updateCameraExposureTime(capture, event.device.exposure)
	}
}
