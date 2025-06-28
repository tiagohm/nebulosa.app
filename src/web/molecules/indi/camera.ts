import { createScope, molecule, onMount } from 'bunshi'
import { type Camera, DEFAULT_CAMERA, type ExposureMode, type ExposureTimeUnit, type FrameType } from 'src/api/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { BusMolecule } from '../bus'

export interface CameraScopeValue {
	readonly camera: Camera
}

export interface CameraState {
	camera: Camera
	connecting: boolean
	capturing: boolean
	targetTemperature: number
	exposureTime: number
	exposureTimeUnit: ExposureTimeUnit
	frameType: FrameType
	exposureMode: ExposureMode
	delay: number
	count: number
	x: number
	y: number
	width: number
	height: number
	subframe: boolean
	binX: number
	binY: number
	frameFormat: string
	gain: number
	offset: number
}

export const CameraScope = createScope<CameraScopeValue>({ camera: DEFAULT_CAMERA })

// Molecule that manages the camera device
export const CameraMolecule = molecule((m, s) => {
	const scope = s(CameraScope)
	const bus = m(BusMolecule)

	const state = proxy<CameraState>({
		camera: scope.camera,
		connecting: false,
		capturing: false,
		targetTemperature: scope.camera.temperature,
		exposureTime: scope.camera.exposure.min,
		exposureTimeUnit: 'MICROSECONDS',
		frameType: 'LIGHT',
		exposureMode: 'SINGLE',
		delay: 0,
		count: 0,
		x: 0,
		y: 0,
		width: 0,
		height: 0,
		subframe: false,
		binX: 1,
		binY: 1,
		frameFormat: '',
		gain: 0,
		offset: 0,
	})

	Api.Cameras.get(scope.camera.name).then((camera) => (state.camera = camera))

	onMount(() => {
		console.info('camera mounted', scope.camera.name)

		const unsubscriber = bus.subscribe('updateCamera', (event) => {
			if (event.device === state.camera.name) {
				state.camera[event.property] = event.value as never
			}
		})

		return () => {
			console.info('camera unmounted', scope.camera.name)
			unsubscriber()
		}
	})

	function update<K extends keyof CameraState>(key: K, value: CameraState[K]) {
		state[key] = value
	}

	function connectOrDisconnect() {
		state.connecting = true
		state.camera.connected = true
		console.info(state.camera)
		state.connecting = false
	}

	function start() {}

	function stop() {}

	return { scope, state, connectOrDisconnect, update, start, stop }
})
