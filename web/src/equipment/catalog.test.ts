import { expect, test } from 'bun:test'
import type { CameraBinding } from 'api'
import { cameraBoundElsewhere } from './catalog'

function binding(connectionId: string, deviceId: string, cameraId: string): CameraBinding {
	return { connectionId, deviceId, hardwareId: deviceId, deviceName: `Device ${deviceId}`, cameraId, boundAt: 0 }
}

test('a camera of the catalog is held elsewhere only by another device of the same connection', () => {
	const state = { bindings: { 'c1/d1': binding('c1', 'd1', 'a'), 'c2/d2': binding('c2', 'd2', 'b') } }

	expect(cameraBoundElsewhere(state, { connectionId: 'c1', id: 'd3' }, 'a')?.deviceName).toBe('Device d1')
	expect(cameraBoundElsewhere(state, { connectionId: 'c1', id: 'd1' }, 'a')).toBeUndefined()
	expect(cameraBoundElsewhere(state, { connectionId: 'c1', id: 'd3' }, 'b')).toBeUndefined()
})
