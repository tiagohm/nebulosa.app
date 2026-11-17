import { expect, test } from 'bun:test'
import type { CameraBinding } from 'api'
import { proxy } from 'valtio'
import { bindCamera, cameraBoundElsewhere, type CameraBindingsState, handleCameraBindingsEvent } from './catalog'

function binding(connectionId: string, deviceId: string, cameraId: string): CameraBinding {
	return { connectionId, deviceId, hardwareId: deviceId, deviceName: `Device ${deviceId}`, cameraId, boundAt: 0 }
}

test('a camera of the catalog is held elsewhere only by another device of the same connection', () => {
	const state = { bindings: { 'c1/d1': binding('c1', 'd1', 'a'), 'c2/d2': binding('c2', 'd2', 'b') } }

	expect(cameraBoundElsewhere(state, { connectionId: 'c1', id: 'd3' }, 'a')?.deviceName).toBe('Device d1')
	expect(cameraBoundElsewhere(state, { connectionId: 'c1', id: 'd1' }, 'a')).toBeUndefined()
	expect(cameraBoundElsewhere(state, { connectionId: 'c1', id: 'd3' }, 'b')).toBeUndefined()
})

test('the answer of a bind never replaces a binding another tab changed during the request', async () => {
	const state = proxy<CameraBindingsState>({ bindings: {}, loaded: true })
	const answer = Promise.withResolvers<Response>()
	const bound = bindCamera(state, { connectionId: 'c1', id: 'd1' }, 'x', () => answer.promise)

	handleCameraBindingsEvent(state, { type: 'catalogCamera:bindingChanged', connectionId: 'c1', deviceId: 'd1', binding: binding('c1', 'd1', 'x') })
	handleCameraBindingsEvent(state, { type: 'catalogCamera:bindingChanged', connectionId: 'c1', deviceId: 'd1', binding: binding('c1', 'd1', 'y') })
	answer.resolve(Response.json({ binding: binding('c1', 'd1', 'x') }))

	expect(await bound).toBeUndefined()
	expect(state.bindings['c1/d1'].cameraId).toBe('y')
})

test('the answer of a bind is applied when no event of the binding arrived yet', async () => {
	const state = proxy<CameraBindingsState>({ bindings: {}, loaded: true })
	expect(await bindCamera(state, { connectionId: 'c2', id: 'd2' }, 'z', () => Promise.resolve(Response.json({ binding: binding('c2', 'd2', 'z') })))).toBeUndefined()
	expect(state.bindings['c2/d2'].cameraId).toBe('z')
})
