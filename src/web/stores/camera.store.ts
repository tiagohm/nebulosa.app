import { Api } from '@shared/api'
import { cameraBus, imageBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import { storageGet, storageSet } from '@shared/storage'
import { clampInteger } from '@shared/util'
import { cameraCaptureStore } from '@stores/camera.capture.store'
import { equipmentStore } from '@stores/equipment.store'
import type { DeviceState } from '@stores/equipment.store'
import type { Camera, Focuser, MinMaxValueProperty, Mount, NameAndLabel, Rotator, Wheel } from 'nebulosa/src/devices/indi/device'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { DEFAULT_CAMERA_CAPTURE_EVENT, exposureTimeIn } from '#/camera'
import type { CameraCaptureEvent, CameraCaptureStart, CameraUpdated } from '#/camera'
import type { GuiderSessionInfo } from '#/guider'
import type { ComputeRoi, Roi } from '#/image.roi'

export type CameraStore = ReturnType<typeof cameraStore>

export interface CameraState {
	camera: DeviceState<Camera>
	readonly request: CameraCaptureStart
	readonly progress: CameraCaptureEvent
	capturing: boolean
	targetTemperature: number
	readonly equipment: {
		mount?: DeviceState<Mount>
		wheel?: DeviceState<Wheel>
		focuser?: DeviceState<Focuser>
		rotator?: DeviceState<Rotator>
	}
}

export function cameraStore(camera: Camera) {
	const capture = cameraCaptureStore()

	const state = proxy<CameraState>({
		camera,
		request: capture.state,
		progress: structuredClone(DEFAULT_CAMERA_CAPTURE_EVENT),
		capturing: false,
		targetTemperature: camera.temperature,
		equipment: {},
	})

	console.info('camera created:', camera.name)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return unmount

		console.info('camera mounted:', camera.name)

		mounted = true

		u[0] = cameraBus.subscribe('capture', (event) => {
			if (event.camera === camera.id) {
				Object.assign(state.progress, event)

				if (event.state === 'idle') {
					state.capturing = false
				} else if (event.state === 'exposureStarted') {
					state.capturing = true
				}
			}
		})

		u[1] = initProxy(state, `camera.${camera.name}`, ['o:request', 'p:targetTemperature'])
		u[2] = subscribeKey(camera, 'frameFormats', (formats) => updateCameraFrameFormat(state.request, formats))
		u[3] = subscribeKey(camera, 'exposure', (exposure) => updateCameraExposureTime(state.request, exposure))
		u[4] = subscribeKey(camera, 'frame', (frame) => updateCameraFrame(state.request, frame))
		u[5] = cameraBus.subscribe('roi', computeRoi)
		u[6] = subscribeKey(equipmentStore.state.mount, 'length', refreshEquipment)
		u[7] = subscribeKey(equipmentStore.state.wheel, 'length', refreshEquipment)
		u[8] = subscribeKey(equipmentStore.state.focuser, 'length', refreshEquipment)
		u[9] = subscribeKey(equipmentStore.state.rotator, 'length', refreshEquipment)

		refreshEquipment()
		updateCameraCaptureStartFromCamera(camera, state.request)

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('camera unmounted:', camera.name)
		unsubscribe(u)
		mounted = false
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

	function requestRoi() {
		applySubframe(imageBus.call('roi', { camera }))
	}

	function applySubframe(subframe: Roi) {
		return updateCameraSubframe(state.request, camera, subframe)
	}

	function computeRoi(options: ComputeRoi) {
		if (options.camera !== camera) return undefined
		return { x: state.request.x, y: state.request.y, width: state.request.width || camera.frame.width.max || 1, height: state.request.height || camera.frame.height.max || 1 }
	}

	function setDitherEnabled(value: boolean) {
		state.request.dither.enabled = value
	}

	function setDitherRaOnly(value: boolean) {
		state.request.dither.raOnly = value
	}

	function setDitherAmount(value: number) {
		state.request.dither.amount = value
	}

	function setDitherGuider(guider?: GuiderSessionInfo) {
		state.request.dither.guider = guider?.key
	}

	function removeDitherGuider(event?: React.MouseEvent) {
		event?.stopPropagation()
		state.request.dither.guider = undefined
	}

	function refreshEquipment() {
		const mountId = storageGet(`camera.${camera.id}.equipment.mount`, '')
		const wheelId = storageGet(`camera.${camera.id}.equipment.wheel`, '')
		const focuserId = storageGet(`camera.${camera.id}.equipment.focuser`, '')
		const rotatorId = storageGet(`camera.${camera.id}.equipment.rotator`, '')

		state.equipment.mount = equipmentStore.state.mount.find((e) => e.id === mountId)
		state.equipment.wheel = equipmentStore.state.wheel.find((e) => e.id === wheelId)
		state.equipment.focuser = equipmentStore.state.focuser.find((e) => e.id === focuserId)
		state.equipment.rotator = equipmentStore.state.rotator.find((e) => e.id === rotatorId)
	}

	function updateMount(mount?: Mount) {
		state.equipment.mount = mount
		storageSet(`camera.${camera.id}.equipment.mount`, mount?.id)
	}

	function updateWheel(wheel?: Wheel) {
		state.equipment.wheel = wheel
		storageSet(`camera.${camera.id}.equipment.wheel`, wheel?.id)
	}

	function updateFocuser(focuser?: Focuser) {
		state.equipment.focuser = focuser
		storageSet(`camera.${camera.id}.equipment.focuser`, focuser?.id)
	}

	function updateRotator(rotator?: Rotator) {
		state.equipment.rotator = rotator
		storageSet(`camera.${camera.id}.equipment.rotator`, rotator?.id)
	}

	async function start() {
		if (state.capturing) return

		state.capturing = true

		try {
			const dither = { ...state.request.dither, guider: state.request.dither.guider ? equipmentStore.state.guider.find((e) => e.id === state.request.dither.guider || e.key === state.request.dither.guider)?.id : undefined }
			const request: CameraCaptureStart = { ...state.request, mount: state.equipment.mount?.id, wheel: state.equipment.wheel?.id, focuser: state.equipment.focuser?.id, rotator: state.equipment.rotator?.id, dither }
			const response = await Api.Cameras.start(camera, request)
			if (!response?.started.ok) state.capturing = false
		} catch {
			state.capturing = false
		}
	}

	function stop() {
		return Api.Cameras.stop(camera)
	}

	return {
		state,
		capture,
		mount,
		unmount,
		connect,
		updateDither,
		cooler,
		temperature,
		fullscreen,
		requestRoi,
		updateMount,
		updateWheel,
		updateFocuser,
		updateRotator,
		setDitherEnabled,
		setDitherRaOnly,
		setDitherAmount,
		setDitherGuider,
		removeDitherGuider,
		start,
		stop,
	} as const
}

export function updateCameraSubframe(request: CameraCaptureStart, camera: Camera, subframe: Roi) {
	if (!camera.canSubFrame) return false

	const { frame } = camera
	const xMin = frame.x.min
	const yMin = frame.y.min
	const widthMin = Math.max(1, frame.width.min)
	const heightMin = Math.max(1, frame.height.min)
	const widthMax = Math.max(widthMin, frame.width.max || subframe.width)
	const heightMax = Math.max(heightMin, frame.height.max || subframe.height)
	const xMax = frame.x.max || Math.max(xMin, xMin + widthMax - widthMin)
	const yMax = frame.y.max || Math.max(yMin, yMin + heightMax - heightMin)
	const width = clampInteger(subframe.width, widthMin, widthMax)
	const height = clampInteger(subframe.height, heightMin, heightMax)
	const x = clampInteger(subframe.x, xMin, Math.min(xMax, xMin + widthMax - width))
	const y = clampInteger(subframe.y, yMin, Math.min(yMax, yMin + heightMax - height))
	const maxWidthFromX = Math.max(widthMin, widthMax - Math.max(0, x - xMin))
	const maxHeightFromY = Math.max(heightMin, heightMax - Math.max(0, y - yMin))

	request.subframe = true
	request.x = x
	request.y = y
	request.width = clampInteger(width, widthMin, maxWidthFromX)
	request.height = clampInteger(height, heightMin, maxHeightFromY)

	return true
}

export function updateCameraFrame(request: Pick<CameraCaptureStart, 'x' | 'y' | 'width' | 'height'>, frame: Camera['frame']) {
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

export function updateCameraFrameFormat(request: Pick<CameraCaptureStart, 'frameFormat'>, frameFormats?: readonly NameAndLabel[]) {
	if (!frameFormats?.length) return

	if (!request.frameFormat || !frameFormats.some((e) => e.name === request.frameFormat)) {
		request.frameFormat = frameFormats[0].name
	}
}

export function updateCameraExposureTime(request: Pick<CameraCaptureStart, 'exposureTime' | 'exposureTimeUnit'>, exposure: MinMaxValueProperty) {
	if (exposure.max > 0) {
		const min = Math.max(1, exposureTimeIn(exposure.min, 'second', request.exposureTimeUnit))
		const max = exposureTimeIn(exposure.max, 'second', request.exposureTimeUnit)
		request.exposureTime = Math.max(min, Math.min(request.exposureTime, max))
	}
}

export function updateCameraCaptureStartFromCamera(camera: Camera, capture: Pick<CameraCaptureStart, 'exposureTime' | 'exposureTimeUnit' | 'frameFormat' | 'x' | 'y' | 'width' | 'height'>) {
	if (!camera.connected) return
	updateCameraFrameFormat(capture, camera.frameFormats)
	updateCameraFrame(capture, camera.frame)
	!camera.exposuring && updateCameraExposureTime(capture, camera.exposure)
}

export function updateCameraCaptureStartFromCameraUpdated(capture: CameraCaptureStart, event: CameraUpdated) {
	if (event.state === 'Alert') return

	if (event.property === 'frame') {
		updateCameraFrame(capture, event.device.frame!)
	} else if (event.property === 'frameFormats' && event.device.frameFormats!.length > 0) {
		updateCameraFrameFormat(capture, event.device.frameFormats)
	} else if (event.property === 'exposure' && event.device.exposure!.max !== 0) {
		updateCameraExposureTime(capture, event.device.exposure!)
	}
}

export function subscribeToUpdateCameraCaptureStartFromCamera(camera: Camera, request: Parameters<typeof updateCameraCaptureStartFromCamera>[1]) {
	const u = new Array<VoidFunction>(3)
	u[0] = subscribeKey(camera, 'frameFormats', (formats) => updateCameraFrameFormat(request, formats))
	u[1] = subscribeKey(camera, 'exposure', (exposure) => updateCameraExposureTime(request, exposure))
	u[2] = subscribeKey(camera, 'frame', (frame) => updateCameraFrame(request, frame))
	return () => unsubscribe(u)
}
