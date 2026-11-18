import { expect, test } from 'bun:test'
import type { CameraCapabilities } from 'api'
import { proxy } from 'valtio'
import { newControlRuntime } from '../equipment-control/control'
import { liveSensors, roleSensors, type SensorRuntime, watchSensors } from './sensors'

const SENSOR = { width: 6000, height: 4000, pixelSize: 3.76 }

function camera(id: string, sensor = SENSOR): CameraCapabilities {
	return { connectionId: 'a', id, name: id, connected: true, sensor, canAbort: true, exposing: false, frameFormats: [], frameFormat: '', transferFormats: [], canSetTemperature: false }
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

test('a role takes what its device does not report from the sensor its catalog camera declares', () => {
	const runtime = proxy<SensorRuntime>({ cameras: {} })
	const control = newControlRuntime()
	control.watched = 'a'
	control.states.camera = { main: { ...camera('main'), sensor: undefined }, guide: camera('guide', { width: 1280, height: 960, pixelSize: 0 }) }
	watchSensors(runtime, { MAIN_CAMERA: { connectionId: 'a', id: 'main' }, GUIDE_CAMERA: { connectionId: 'a', id: 'guide' } })
	const bindings = { bindings: { hmain: { deviceId: 'main', cameraId: 'c1' }, hguide: { deviceId: 'guide', cameraId: 'c2' } } } as unknown as Parameters<typeof roleSensors>[3]
	const catalog = {
		cameras: [
			{ id: 'c1', name: 'ASI2600MC', sensor: { width: 6248, height: 4176, pixelSize: 3.76 } },
			{ id: 'c2', name: 'ASI120MM', sensor: { width: 1280, height: 960, pixelSize: 3.75 } },
		],
	}

	expect(roleSensors(runtime, control, {}, bindings, catalog)).toEqual({
		MAIN_CAMERA: { width: 6248, height: 4176, pixelSize: 3.76, origin: 'catalog', catalogCamera: 'ASI2600MC' },
		GUIDE_CAMERA: { width: 1280, height: 960, pixelSize: 3.75, origin: 'completed', catalogCamera: 'ASI120MM' },
	})

	control.states.camera.main = camera('main')
	expect(roleSensors(runtime, control, {}, bindings, catalog).MAIN_CAMERA).toEqual({ ...SENSOR, origin: 'reported', catalogCamera: undefined })
})

test('a role whose camera reports nothing and is bound to no declared sensor has none', () => {
	const runtime = proxy<SensorRuntime>({ cameras: {} })
	const control = newControlRuntime()
	control.watched = 'a'
	control.states.camera = { main: { ...camera('main'), sensor: undefined } }
	watchSensors(runtime, { MAIN_CAMERA: { connectionId: 'a', id: 'main' } })
	const bindings = { bindings: { hmain: { deviceId: 'main', cameraId: 'c1' } } } as unknown as Parameters<typeof roleSensors>[3]

	expect(roleSensors(runtime, control, {}, { bindings: {} }, { cameras: [] })).toEqual({})
	expect(roleSensors(runtime, control, {}, bindings, { cameras: [{ id: 'c1', name: 'Unknown sensor' }] })).toEqual({})
	// A declared sensor without a pixel size gives its pixels, and the field of view lists the pixel size as missing.
	expect(roleSensors(runtime, control, {}, bindings, { cameras: [{ id: 'c1', name: 'No pixel', sensor: { width: 100, height: 50 } }] }).MAIN_CAMERA).toEqual({ width: 100, height: 50, pixelSize: 0, origin: 'catalog', catalogCamera: 'No pixel' })
})

test('with the connection closed, a role finds its catalog camera by the device id of the setup', () => {
	const runtime = proxy<SensorRuntime>({ cameras: {} })
	const control = newControlRuntime()
	const declared = { id: 'c1', name: 'ASI294MM', sensor: { width: 8240, height: 5628, pixelSize: 2.32 } }
	const bindings = { bindings: { hsim: { hardwareId: 'hsim', connectionId: 'x', deviceId: 'sim', cameraId: 'c1' } } } as unknown as Parameters<typeof roleSensors>[3]

	expect(roleSensors(runtime, control, { MAIN_CAMERA: 'sim' }, bindings, { cameras: [declared] })).toEqual({ MAIN_CAMERA: { width: 8240, height: 5628, pixelSize: 2.32, origin: 'catalog', catalogCamera: 'ASI294MM' } })
	expect(roleSensors(runtime, control, { MAIN_CAMERA: 'other' }, bindings, { cameras: [declared] })).toEqual({})
})
