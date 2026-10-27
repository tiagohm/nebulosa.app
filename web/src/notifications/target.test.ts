import { expect, test } from 'bun:test'
import type { NotificationTarget } from 'api'
import { proxy } from 'valtio'
import { cameraTabKey } from '../images/cameratabs'
import type { ImagesState } from '../images/images'
import type { RouteState } from '../shell/route'
import { openNotificationTarget, targetAvailable } from './target'

const tab = cameraTabKey('c', 'cam')

function newContext() {
	const images = proxy({ documents: [{ key: 'file:a' }, { key: tab }], views: {}, tools: { [tab]: { tool: 'inspector' } }, activeKey: 'file:a' } as unknown as ImagesState)
	const route = proxy<RouteState>({ route: { workspace: 'sky' } })
	const paths: string[] = []
	const history = { pushState: (_: unknown, __: string, path?: string | URL | null) => void paths.push(String(path)) }
	return { images, route, devices: [{ id: 'mnt', connectionId: 'c' }], history, paths }
}

test('opens the tool of the camera tab of a session', () => {
	const context = newContext()
	const target: NotificationTarget = { kind: 'cameraTool', connectionId: 'c', deviceId: 'cam', tool: 'guiding' }

	expect(openNotificationTarget(target, context)).toBeTrue()
	expect(context.images.activeKey).toBe(tab)
	expect(context.images.tools[tab]?.tool).toBe('guiding')
	expect(context.route.route).toEqual({ workspace: 'images' })
	expect(context.paths).toEqual(['/images'])
})

test('opens a device of the watched connection in Equipment Control', () => {
	const context = newContext()
	expect(openNotificationTarget({ kind: 'equipment', connectionId: 'c', deviceId: 'mnt' }, context)).toBeTrue()
	expect(context.route.route).toEqual({ workspace: 'equipment', device: 'mnt' })
})

test('an unavailable context changes nothing', () => {
	const context = newContext()
	const targets: (NotificationTarget | undefined)[] = [
		undefined,
		// Same camera on another connection, a camera without a tab, and a device of another connection.
		{ kind: 'cameraTool', connectionId: 'd', deviceId: 'cam', tool: 'guiding' },
		{ kind: 'cameraTool', connectionId: 'c', deviceId: 'gone', tool: 'darv' },
		{ kind: 'equipment', connectionId: 'd', deviceId: 'mnt' },
	]

	for (const target of targets) {
		expect(targetAvailable(target, { documents: context.images.documents, devices: context.devices })).toBeFalse()
		expect(openNotificationTarget(target, context)).toBeFalse()
	}

	expect(context.images.activeKey).toBe('file:a')
	expect(context.route.route).toEqual({ workspace: 'sky' })
	expect(context.paths).toEqual([])
})
