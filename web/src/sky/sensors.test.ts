import { expect, test } from 'bun:test'
import type { CameraCapabilities } from 'api'
import { proxy } from 'valtio'
import { newControlRuntime } from '../equipment-control/control'
import { liveSensors, type SensorRuntime, watchSensors } from './sensors'

const SENSOR = { width: 6000, height: 4000, pixelSize: 3.76 }

function camera(id: string, sensor = SENSOR): CameraCapabilities {
	return { connectionId: 'a', id, name: id, connected: true, sensor, canAbort: true, frameFormats: [], frameFormat: '', transferFormats: [], canSetTemperature: false }
}

test('reads the sensors of the role cameras on the watched connection only', () => {
	const runtime = proxy<SensorRuntime>({ cameras: {} })
	const control = newControlRuntime()
	control.states.camera = { main: camera('main'), guide: { ...camera('guide'), sensor: undefined } }

	watchSensors(runtime, { MAIN_CAMERA: { connectionId: 'a', id: 'main' }, GUIDE_CAMERA: { connectionId: 'a', id: 'guide' } })
	expect(liveSensors(runtime, control)).toEqual({})

	control.watched = 'a'
	expect(liveSensors(runtime, control)).toEqual({ MAIN_CAMERA: SENSOR })

	control.states.camera.guide = camera('guide')
	expect(liveSensors(runtime, control).GUIDE_CAMERA).toEqual(SENSOR)
})

test('a role whose camera changes or goes away drops its sensor', () => {
	const runtime = proxy<SensorRuntime>({ cameras: {} })
	const control = newControlRuntime()
	control.watched = 'a'
	control.states.camera = { main: camera('main') }

	watchSensors(runtime, { MAIN_CAMERA: { connectionId: 'a', id: 'main' } })
	expect(liveSensors(runtime, control)).toEqual({ MAIN_CAMERA: SENSOR })
	watchSensors(runtime, { MAIN_CAMERA: { connectionId: 'a', id: 'other' } })
	expect(liveSensors(runtime, control)).toEqual({})
	watchSensors(runtime, {})
	expect(runtime.cameras).toEqual({})
})
