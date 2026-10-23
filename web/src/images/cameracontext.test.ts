import { describe, expect, test } from 'bun:test'
import type { DeviceSummary } from 'api'
import type { EquipmentSetup } from '../equipment/roles'
import { cameraOperationContext } from './cameracontext'

// Returns a connected device of the watched connection.
function device(id: string, type: DeviceSummary['type']): DeviceSummary {
	return { id, type, name: id, connected: true, connectionId: 'conn', hardwareId: id, interfaces: [], driver: { executable: '', version: '' } }
}

const RUNTIME = { watched: 'conn', devices: [device('main', 'camera'), device('guide', 'camera'), device('spare', 'camera'), device('focuser', 'focuser'), device('mount', 'mount'), device('wheel', 'wheel')], pending: {}, errors: {} }

const SETUP: EquipmentSetup = { MAIN_CAMERA: { id: 'main', name: 'main' }, GUIDE_CAMERA: { id: 'guide', name: 'guide' }, FOCUSER: { id: 'focuser', name: 'focuser' }, MOUNT: { id: 'mount', name: 'mount' }, FILTER_WHEEL: { id: 'wheel', name: 'wheel' } }

// Active profile working with the saved connection the watched server connection opened.
const PROFILE = { connectionId: 'saved', equipment: { saved: SETUP } }

// Returns the camera tab of a camera.
function tab(deviceId: string, connectionId = 'conn') {
	return { source: { kind: 'camera', connectionId, deviceId } } as const
}

describe('camera operation context', () => {
	test('a document that is not a camera tab has none', () => {
		expect(cameraOperationContext({ source: { kind: 'file', path: '/m42.fits' } }, PROFILE, RUNTIME)).toBeUndefined()
		expect(cameraOperationContext(undefined, PROFILE, RUNTIME)).toBeUndefined()
	})

	test('the Main Camera gets the focuser and the mount of the setup and snoops its devices', () => {
		const context = cameraOperationContext(tab('main'), PROFILE, RUNTIME)!
		expect(context.camera).toEqual({ connectionId: 'conn', deviceId: 'main' })
		expect(context.device).toMatchObject({ device: { id: 'main' }, serverId: 'conn', status: 'connected' })
		expect(context.settings).toEqual({ connectionId: 'saved', deviceId: 'main' })
		expect(context.role).toBe('MAIN_CAMERA')
		expect(context.focuser).toMatchObject({ device: { id: 'focuser' }, serverId: 'conn', status: 'connected' })
		expect(context.mount).toMatchObject({ device: { id: 'mount' }, status: 'connected' })
		expect(context.snoop).toEqual({ mount: 'mount', focuser: 'focuser', wheel: 'wheel', rotator: undefined })
	})

	test('the Guide Camera shares the mount but has no focuser', () => {
		const context = cameraOperationContext(tab('guide'), PROFILE, RUNTIME)!
		expect(context.role).toBe('GUIDE_CAMERA')
		expect(context.focuser).toBeUndefined()
		expect(context.mount.status).toBe('connected')
		expect(context.snoop.mount).toBe('mount')
	})

	test('a camera without a role has no focuser, snoops nothing, and still reaches the mount of its connection', () => {
		const context = cameraOperationContext(tab('spare'), PROFILE, RUNTIME)!
		expect(context.settings).toEqual({ connectionId: 'saved', deviceId: 'spare' })
		expect(context.role).toBeUndefined()
		expect(context.focuser).toBeUndefined()
		expect(context.snoop).toEqual({})
		expect(context.mount).toMatchObject({ device: { id: 'mount' }, status: 'connected' })
	})

	test('a missing mount assignment is reported, never replaced by another connected mount', () => {
		const { MOUNT: _, ...setup } = SETUP
		expect(cameraOperationContext(tab('main'), { connectionId: 'saved', equipment: { saved: setup } }, RUNTIME)!.mount).toEqual({ device: undefined, serverId: 'conn', status: 'notSelected' })
	})

	test('a camera of another connection than the watched one has no role and no reachable mount', () => {
		const context = cameraOperationContext(tab('main', 'other'), PROFILE, RUNTIME)!
		expect(context.role).toBeUndefined()
		expect(context.focuser).toBeUndefined()
		expect(context.settings).toBeUndefined()
		expect(context.device).toEqual({ status: 'unavailable' })
		expect(context.mount).toEqual({ status: 'unavailable' })
	})

	test('the camera reports its own state, such as a disconnection in progress', () => {
		const context = cameraOperationContext(tab('guide'), PROFILE, { ...RUNTIME, pending: { guide: 'disconnect' } })!
		expect(context.device).toMatchObject({ device: { id: 'guide' }, status: 'disconnecting' })
	})
})
