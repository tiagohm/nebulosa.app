import { describe, expect, test } from 'bun:test'
import type { MountRemoteControlEvent, MountRemoteServer, MountRemoteSnapshot } from 'api'
import { proxy } from 'valtio'
import { applyMountRemoteSnapshot, clientKey, disconnectRemoteClient, formatEndpoint, handleMountRemoteControlEvent, isLoopback, type MountRemoteControlState, refreshMountRemoteControl, remoteKey, startRemoteServer, stopRemoteServer } from './listeners'

function newState() {
	return proxy<MountRemoteControlState>({ revision: 0, servers: {}, pending: {}, disconnecting: {}, errors: {} })
}

function server(revision: number, overrides: Partial<MountRemoteServer> = {}): MountRemoteServer {
	return { connectionId: 'c', deviceId: 'm', protocol: 'lx200', host: '0.0.0.0', port: 10002, clients: [], revision, ...overrides }
}

function event(epoch: string, revision: number, value?: MountRemoteServer): MountRemoteControlEvent {
	return { type: 'mountRemoteControl:updated', epoch, revision, key: { connectionId: 'c', deviceId: 'm', protocol: 'lx200' }, server: value }
}

const KEY = remoteKey('c', 'm', 'lx200')

describe('mirror', () => {
	test('applies events in revision order and ignores older ones', () => {
		const state = newState()

		handleMountRemoteControlEvent(state, event('e', 1, server(1)))
		handleMountRemoteControlEvent(state, event('e', 2))
		handleMountRemoteControlEvent(state, event('e', 1, server(1)))

		expect(state.servers).toEqual({})
		expect(state.revision).toBe(2)
	})

	test('drops a snapshot older than the events already applied, and starts over in a new epoch', () => {
		const state = newState()
		const stale: MountRemoteSnapshot = { epoch: 'e', revision: 1, servers: [server(1)] }

		handleMountRemoteControlEvent(state, event('e', 2))
		applyMountRemoteSnapshot(state, stale)
		expect(state.servers).toEqual({})

		applyMountRemoteSnapshot(state, { epoch: 'f', revision: 1, servers: [server(1, { protocol: 'stellarium' })] })
		expect(Object.keys(state.servers)).toEqual([remoteKey('c', 'm', 'stellarium')])

		handleMountRemoteControlEvent(state, event('g', 1, server(1)))
		expect(Object.keys(state.servers)).toEqual([KEY])
		expect(state.epoch).toBe('g')
	})

	test('refresh keeps listeners of every connection and drops a response superseded by another refresh', async () => {
		const state = newState()
		const servers = [server(3), server(4, { connectionId: 'other' })]
		let resolveFirst: (response: Response) => void = () => {}
		const first = new Promise<Response>((resolve) => {
			resolveFirst = resolve
		})
		const requests = [() => first, () => Promise.resolve(Response.json({ epoch: 'e', revision: 4, servers } satisfies MountRemoteSnapshot))]
		const request = (() => requests.shift()!()) as unknown as typeof fetch

		const older = refreshMountRemoteControl(state, request)
		await refreshMountRemoteControl(state, request)
		resolveFirst(Response.json({ epoch: 'e', revision: 1, servers: [] } satisfies MountRemoteSnapshot))
		await older

		expect(Object.keys(state.servers).toSorted()).toEqual([KEY, remoteKey('other', 'm', 'lx200')].toSorted())
	})
})

describe('requests', () => {
	test('start posts the binding and keeps the server unless a later event stopped it', async () => {
		const state = newState()
		const calls: [string, RequestInit | undefined][] = []
		const request = ((url: string, init?: RequestInit) => {
			calls.push([url, init])
			return Promise.resolve(Response.json(server(1)))
		}) as unknown as typeof fetch

		expect(await startRemoteServer(state, 'c', 'm', 'lx200', { host: '0.0.0.0', port: 10002 }, request)).toBe(true)
		expect(calls[0][0]).toBe('/api/connections/c/mounts/m/remote-control/lx200/start')
		expect(JSON.parse(calls[0][1]!.body as string)).toEqual({ host: '0.0.0.0', port: 10002 })
		expect(state.servers[KEY]).toEqual(server(1))
		expect(state.pending).toEqual({})

		const late = newState()
		handleMountRemoteControlEvent(late, event('e', 2))
		await startRemoteServer(late, 'c', 'm', 'lx200', { host: '0.0.0.0', port: 10002 }, request)
		expect(late.servers).toEqual({})
	})

	test('a refused start or stop keeps the error of the server', async () => {
		const state = newState()
		const refused = (() => Promise.resolve(Response.json({ error: '0.0.0.0:10002 is already in use', code: 'addressInUse' }, { status: 409 }))) as unknown as typeof fetch

		expect(await startRemoteServer(state, 'c', 'm', 'lx200', { host: '0.0.0.0', port: 10002 }, refused)).toBe(false)
		expect(state.errors[KEY]).toBe('0.0.0.0:10002 is already in use')

		const ok = (() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof fetch
		expect(await stopRemoteServer(state, 'c', 'm', 'lx200', ok)).toBe(true)
		expect(state.errors[KEY]).toBeUndefined()
	})

	test('a disconnection stays pending until the client leaves', async () => {
		const state = newState()
		const client = { id: 'x', ip: '::1', port: 5000 }
		handleMountRemoteControlEvent(state, event('e', 1, server(1, { clients: [client] })))

		const ok = (() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof fetch
		await disconnectRemoteClient(state, server(1), 'x', ok)
		expect(state.disconnecting[clientKey(KEY, 'x')]).toBe(true)

		handleMountRemoteControlEvent(state, event('e', 2, server(2)))
		expect(state.disconnecting).toEqual({})
	})
})

test('formats endpoints and recognizes loopback hosts', () => {
	expect(formatEndpoint('192.168.0.5', 51000)).toBe('192.168.0.5:51000')
	expect(formatEndpoint('fe80::1', 51000)).toBe('[fe80::1]:51000')
	expect(['127.0.0.1', 'localhost', '::1'].map(isLoopback)).toEqual([true, true, true])
	expect(['0.0.0.0', '192.168.0.5', '::'].map(isLoopback)).toEqual([false, false, false])
})
