import { describe, expect, test } from 'bun:test'
import type { ObservatoryCamera, ObservatoryCameraEvent, ObservatoryCamerasSnapshot } from 'api'
import { proxy } from 'valtio'
import { applyObservatoryCamerasSnapshot, filterCameras, handleObservatoryCameraEvent, moveCamera, type ObservatoryCamerasState, saveCamera, sortedCameras } from './observatorycameras'
import { cameraStatus } from './status'
import { parseOffer, sdpFragment } from './whep'

function camera(patch: Partial<ObservatoryCamera> = {}): ObservatoryCamera {
	return { id: 'c1', name: 'Roof', enabled: true, sortOrder: 0, sourceConfigured: true, sourceHost: '192.0.2.10', rtspTransport: 'tcp', revision: 1, ...patch }
}

function state(): ObservatoryCamerasState {
	return proxy<ObservatoryCamerasState>({ revision: 0, cameras: {}, streams: {}, loaded: false })
}

function snapshot(patch: Partial<ObservatoryCamerasSnapshot> = {}): ObservatoryCamerasSnapshot {
	return { epoch: 'e1', revision: 5, secretKey: { status: 'available' }, gateway: { status: 'ready' }, icePort: 8189, cameras: [camera()], streams: [{ cameraId: 'c1', state: 'idle', readers: 0 }], ...patch }
}

function fetcher(responses: Response[]) {
	const requests: { url: string; init?: RequestInit }[] = []
	const request = ((url: string, init?: RequestInit) => {
		requests.push({ url, init })
		return Promise.resolve(responses.shift()!)
	}) as typeof fetch
	return { request, requests }
}

describe('mirror', () => {
	test('a snapshot older than the events applied is dropped', () => {
		const s = state()
		applyObservatoryCamerasSnapshot(s, snapshot())
		handleObservatoryCameraEvent(s, { type: 'observatoryCamera:removed', epoch: 'e1', revision: 6, cameraId: 'c1' })
		applyObservatoryCamerasSnapshot(s, snapshot({ revision: 5 }))
		expect(s.cameras).toEqual({})
		expect(s.loaded).toBeTrue()
	})

	test('events in order, stale ones dropped', () => {
		const s = state()
		applyObservatoryCamerasSnapshot(s, snapshot())
		const events: ObservatoryCameraEvent[] = [
			{ type: 'observatoryCamera:updated', epoch: 'e1', revision: 6, camera: camera({ name: 'Dome', revision: 2 }) },
			{ type: 'observatoryCamera:updated', epoch: 'e1', revision: 6, camera: camera({ name: 'Stale', revision: 2 }) },
			{ type: 'observatoryCamera:streamUpdated', epoch: 'e1', revision: 7, stream: { cameraId: 'c1', state: 'unavailable', code: 'sourceAuthFailed', readers: 0 } },
			{ type: 'observatoryCamera:gatewayUpdated', epoch: 'e1', revision: 8, gateway: { status: 'restarting', code: 'exited' }, secretKey: { status: 'available' } },
		]
		for (const event of events) handleObservatoryCameraEvent(s, event)
		expect(s.cameras.c1.name).toBe('Dome')
		expect(s.streams.c1).toMatchObject({ state: 'unavailable', code: 'sourceAuthFailed' })
		expect(s.gateway).toEqual({ status: 'restarting', code: 'exited' })
		expect(s.revision).toBe(8)
	})

	test('other events are ignored', () => {
		const s = state()
		handleObservatoryCameraEvent(s, { type: 'externalTool:updated' } as never)
		expect(s.revision).toBe(0)
	})
})

describe('lists', () => {
	const cameras = [camera({ id: 'b', sortOrder: 2 }), camera({ id: 'a', sortOrder: 1, observingSiteId: 's1' }), camera({ id: 'c', sortOrder: 1, observingSiteId: 's2' })]

	test('sorted by position then id', () => {
		expect(sortedCameras(Object.fromEntries(cameras.map((c) => [c.id, c]))).map((c) => c.id)).toEqual(['a', 'c', 'b'])
	})

	test('the active site shows its cameras and the shared ones', () => {
		expect(filterCameras(cameras, 'site', 's1').map((c) => c.id)).toEqual(['b', 'a'])
		expect(filterCameras(cameras, 'site', undefined)).toHaveLength(3)
		expect(filterCameras(cameras, 'all', 's1')).toHaveLength(3)
		expect(filterCameras(cameras, 's2', 's1').map((c) => c.id)).toEqual(['b', 'c'])
	})
})

describe('requests', () => {
	test('a save sends no empty address and keeps the answer', async () => {
		const s = state()
		const { request, requests } = fetcher([Response.json(camera({ revision: 2 }))])
		const result = await saveCamera(s, 'c1', { name: 'Roof', enabled: true, rtspTransport: 'tcp', source: '  ' }, 1, undefined, request)
		expect(result.status).toBe('saved')
		expect(JSON.parse(requests[0].init?.body as string)).toEqual({ name: 'Roof', enabled: true, rtspTransport: 'tcp', revision: 1 })
		expect(s.cameras.c1.revision).toBe(2)
	})

	test('a conflict keeps the newer camera', async () => {
		const s = state()
		const { request } = fetcher([Response.json({ error: 'changed', code: 'conflict', camera: camera({ name: 'Other', revision: 3 }) }, { status: 409 })])
		expect(await saveCamera(s, 'c1', { name: 'Roof', enabled: true, rtspTransport: 'tcp' }, 1, undefined, request)).toEqual({ status: 'conflict' })
		expect(s.cameras.c1.name).toBe('Other')
	})

	test('moving swaps the positions of two neighbors', async () => {
		const s = state()
		const list = [camera({ id: 'a', sortOrder: 0 }), camera({ id: 'b', sortOrder: 1 })]
		const { request, requests } = fetcher([Response.json(camera({ id: 'b', sortOrder: 0, revision: 2 })), Response.json(camera({ id: 'a', sortOrder: 1, revision: 2 }))])
		expect(await moveCamera(s, list, 'b', -1, request)).toBeUndefined()
		expect(requests.map((r) => [r.url, (JSON.parse(r.init?.body as string) as { sortOrder: number }).sortOrder])).toEqual([
			['/api/observatory-cameras/b', 0],
			['/api/observatory-cameras/a', 1],
		])
	})
})

describe('status', () => {
	test('the player of the tab wins over the stream of the server', () => {
		expect(cameraStatus(camera({ enabled: false }), undefined, undefined, undefined).label).toBe('Disabled')
		expect(cameraStatus(camera(), { cameraId: 'c1', state: 'ready', readers: 1 }, undefined, { status: 'ready' }).label).toBe('Live elsewhere')
		expect(cameraStatus(camera(), { cameraId: 'c1', state: 'unavailable', code: 'sourceAuthFailed', readers: 0 }, undefined, { status: 'ready' }).label).toBe('Authentication failed')
		expect(cameraStatus(camera(), undefined, { status: 'playing', docked: true }, { status: 'ready' }).label).toBe('Live in mini-player')
		expect(cameraStatus(camera(), undefined, { status: 'failed', docked: false, error: 'No video' }, { status: 'ready' })).toEqual({ tone: 'danger', label: 'Failed', detail: 'No video' })
		expect(cameraStatus(camera(), undefined, undefined, { status: 'notInstalled' }).label).toBe('Gateway not installed')
	})
})

describe('whep', () => {
	test('trickled candidates are described for their media line', () => {
		const offer = parseOffer('v=0\r\na=ice-ufrag:uf\r\na=ice-pwd:pw\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\n')
		expect(offer).toEqual({ iceUfrag: 'uf', icePwd: 'pw', medias: ['video 9 UDP/TLS/RTP/SAVPF 96'] })
		const candidate = { candidate: 'candidate:1 1 udp 1 192.0.2.5 5000 typ host', sdpMLineIndex: 0 } as RTCIceCandidate
		expect(sdpFragment(offer, [candidate])).toBe('a=ice-ufrag:uf\r\na=ice-pwd:pw\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\na=candidate:1 1 udp 1 192.0.2.5 5000 typ host\r\n')
	})
})
