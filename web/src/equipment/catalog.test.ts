import { expect, test } from 'bun:test'
import type { CameraBinding } from 'api'
import { proxy } from 'valtio'
import { bindCamera, boundCameraId, cameraBoundElsewhere, type CameraBindingsState, handleCameraBindingsEvent, sensorMismatch } from './catalog'

function binding(connectionId: string, deviceId: string, cameraId: string): CameraBinding {
	return { hardwareId: `h${deviceId}`, connectionId, deviceId, deviceName: `Device ${deviceId}`, cameraId, boundAt: 0 }
}

function device(connectionId: string, deviceId: string) {
	return { connectionId, id: deviceId, hardwareId: `h${deviceId}` }
}

test('a camera of the catalog is held elsewhere only by another device of the same connection', () => {
	const state = { bindings: { hd1: binding('c1', 'd1', 'a'), hd2: binding('c2', 'd2', 'b') } }

	expect(cameraBoundElsewhere(state, device('c1', 'd3'), 'a')?.deviceName).toBe('Device d1')
	expect(cameraBoundElsewhere(state, device('c1', 'd1'), 'a')).toBeUndefined()
	expect(cameraBoundElsewhere(state, device('c1', 'd3'), 'b')).toBeUndefined()
})

test('the device id finds the binding of its hardware, whatever connection it was bound through', () => {
	const state = { bindings: { hd1: binding('c2', 'd1', 'a') } }

	expect(boundCameraId(state, 'd1')).toBe('a')
	expect(boundCameraId(state, 'd2')).toBeUndefined()
	expect(boundCameraId(state, undefined)).toBeUndefined()
})

test('the answer of a bind never replaces a binding another tab changed during the request', async () => {
	const state = proxy<CameraBindingsState>({ bindings: {}, loaded: true })
	const answer = Promise.withResolvers<Response>()
	const bound = bindCamera(state, device('c1', 'd1'), 'x', () => answer.promise)

	handleCameraBindingsEvent(state, { type: 'catalogCamera:bindingChanged', hardwareId: 'hd1', binding: binding('c1', 'd1', 'x') })
	handleCameraBindingsEvent(state, { type: 'catalogCamera:bindingChanged', hardwareId: 'hd1', binding: binding('c1', 'd1', 'y') })
	answer.resolve(Response.json({ binding: binding('c1', 'd1', 'x') }))

	expect(await bound).toBeUndefined()
	expect(state.bindings.hd1.cameraId).toBe('y')
})

test('the answer of a bind is applied when no event of the binding arrived yet', async () => {
	const state = proxy<CameraBindingsState>({ bindings: {}, loaded: true })
	expect(await bindCamera(state, device('c2', 'd2'), 'z', () => Promise.resolve(Response.json({ binding: binding('c2', 'd2', 'z') })))).toBeUndefined()
	expect(state.bindings.hd2.cameraId).toBe('z')
})

test('a sensor mismatch names the pixel sizes as data sheets give them, never the float noise of a driver', () => {
	const camera = { sensor: { width: 6248, height: 4176, pixelSize: 3.76 } }
	expect(sensorMismatch(camera, { width: 6248, height: 4176, pixelSize: 3.759999990463257 })).toBeUndefined()
	expect(sensorMismatch(camera, { width: 6248, height: 4176, pixelSize: 4.630000114440918 })).toBe('The camera of the catalog declares 3.76 µm pixels, and the device reports 4.63 µm')
	expect(sensorMismatch(camera, { width: 3000, height: 2000, pixelSize: 3.76 })).toBe('The camera of the catalog declares a 6248 × 4176 sensor, and the device reports 3000 × 2000')
})
