import { expect, test } from 'bun:test'
import type { DeviceSummary, OperationRecord } from 'api'
import { availabilityFix, deviceAvailability, roleAvailability } from './availability'

const MOUNT: DeviceSummary = { id: 'm1', type: 'mount', name: 'Mount', connected: true, connectionId: 'a', hardwareId: 'h1', interfaces: ['mount'], driver: { executable: '', version: '' } }

function running(connectionId: string, deviceId: string, state: OperationRecord['state'] = 'running'): Record<string, OperationRecord> {
	return { x: { operationId: 'x', kind: 'mount.slew', devices: [{ connectionId, deviceId }], state, startedAt: 1 } }
}

test('a role must be connected, not only selected', () => {
	expect(roleAvailability('MOUNT', { status: 'notSelected' }, { operations: {} })).toEqual({ status: 'notSelected', message: 'No Mount selected in Equipment Setup.' })
	expect(roleAvailability('MOUNT', { device: MOUNT, status: 'disconnected' }, { operations: {} })).toEqual({ status: 'disconnected', message: 'The Mount is not connected.' })
	expect(roleAvailability('GUIDE_CAMERA', { status: 'unavailable' }, { operations: {} }).status).toBe('unavailable')
	expect(roleAvailability('MOUNT', { device: MOUNT, status: 'connected' }, { operations: {} })).toEqual({ status: 'ready' })
})

test('a connected device held by a running operation on the exact ids is busy', () => {
	expect(roleAvailability('MOUNT', { device: MOUNT, status: 'connected' }, { operations: running('a', 'm1') })).toMatchObject({ status: 'busy', message: 'The Mount is busy.' })
	expect(roleAvailability('MOUNT', { device: MOUNT, status: 'connected' }, { operations: running('b', 'm1') }).status).toBe('ready')
	expect(roleAvailability('MOUNT', { device: MOUNT, status: 'connected' }, { operations: running('a', 'm1', 'succeeded') }).status).toBe('ready')
})

test('points to the flow that resolves the problem', () => {
	expect(availabilityFix({ status: 'unavailable', message: '' })).toBe('connections')
	expect(availabilityFix({ status: 'notSelected', message: '' })).toBe('equipment')
	expect(availabilityFix({ status: 'error', message: '' })).toBe('equipment')
	expect(availabilityFix({ status: 'connecting', message: '' })).toBeUndefined()
	expect(availabilityFix({ status: 'busy', operations: [], message: '' })).toBeUndefined()
	expect(availabilityFix({ status: 'ready' })).toBeUndefined()
})

test('a device used for itself is named by its label', () => {
	expect(deviceAvailability('camera', { device: MOUNT, status: 'disconnecting' }, { operations: {} })).toEqual({ status: 'disconnecting', message: 'The camera is disconnecting.' })
	expect(deviceAvailability('camera', { device: MOUNT, status: 'connected' }, { operations: running('a', 'm1') })).toMatchObject({ status: 'busy', message: 'The camera is busy.' })
	expect(deviceAvailability('camera', { device: MOUNT, status: 'connected' }, { operations: {} })).toEqual({ status: 'ready' })
})

test('an operation can declare a connected device unsupported, before it is busy', () => {
	const unsupported = 'The Mount is not equatorial.'
	expect(roleAvailability('MOUNT', { device: MOUNT, status: 'connected' }, { operations: running('a', 'm1') }, unsupported)).toEqual({ status: 'unsupported', message: unsupported })
	expect(roleAvailability('MOUNT', { device: MOUNT, status: 'disconnected' }, { operations: {} }, unsupported).status).toBe('disconnected')
	expect(availabilityFix({ status: 'unsupported', message: unsupported })).toBe('equipment')
})
