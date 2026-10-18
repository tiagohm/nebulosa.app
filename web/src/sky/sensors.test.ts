import { expect, test } from 'bun:test'
import type { CameraSensorState } from 'api'
import { proxy } from 'valtio'
import { handleSensorEvent, liveSensors, type SensorRuntime, watchSensors } from './sensors'

const SENSOR = { width: 6000, height: 4000, pixelSize: 3.76 }

// Fake fetch answering every sensor request with the camera's id and SENSOR.
const request = ((url: string) => {
	const id = decodeURIComponent(url.split('/')[5])
	return Promise.resolve(Response.json({ connectionId: 'a', id, sensor: id === 'main' ? SENSOR : undefined } satisfies CameraSensorState))
}) as typeof fetch

test('follows the sensors of the role cameras on their connection only', async () => {
	const runtime = proxy<SensorRuntime>({ cameras: {} })
	watchSensors(runtime, { MAIN_CAMERA: { connectionId: 'a', id: 'main' }, GUIDE_CAMERA: { connectionId: 'a', id: 'guide' } }, request)
	await Bun.sleep(0)
	expect(liveSensors(runtime)).toEqual({ MAIN_CAMERA: SENSOR })

	handleSensorEvent(runtime, { type: 'camera:sensor', state: { connectionId: 'b', id: 'guide', sensor: SENSOR } })
	expect(liveSensors(runtime).GUIDE_CAMERA).toBeUndefined()
	handleSensorEvent(runtime, { type: 'camera:sensor', state: { connectionId: 'a', id: 'guide', sensor: SENSOR } })
	expect(liveSensors(runtime).GUIDE_CAMERA).toEqual(SENSOR)

	handleSensorEvent(runtime, { type: 'connection:close', id: 'a' })
	expect(liveSensors(runtime)).toEqual({})
})

test('a role whose camera changes or goes away drops its sensor', async () => {
	const runtime = proxy<SensorRuntime>({ cameras: {} })
	watchSensors(runtime, { MAIN_CAMERA: { connectionId: 'a', id: 'main' } }, request)
	await Bun.sleep(0)
	watchSensors(runtime, { MAIN_CAMERA: { connectionId: 'a', id: 'other' } }, request)
	expect(liveSensors(runtime)).toEqual({})
	watchSensors(runtime, {}, request)
	expect(runtime.cameras).toEqual({})
})
