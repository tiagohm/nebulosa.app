import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'path'
import { AppDatabase } from './database'
import { createObservatoryCameraRoutes, type ObservatoryCameraEvent, ObservatoryCameraService, type ObservatoryCamerasSnapshot, sourceHost } from './observatorycameras'
import { CameraSecretKey, type CameraSecretStorage } from './observatorycameras.secret'
import { ObservatoryCameraStore } from './observatorycameras.store'

const FAKE = join(import.meta.dir, 'observatorycameras.fake.ts')
const SECRET = 'rtsp://admin:s3cr3t@192.0.2.10:554/cam/realmonitor?channel=1&subtype=0&token=t0k3n'
const BAD_AUTH = 'rtsp://admin:badauth@192.0.2.11:554/live'

type Routes = ReturnType<typeof createObservatoryCameraRoutes>
type Handler = (req: Request) => Response | Promise<Response>

function memoryStorage(): CameraSecretStorage {
	let value: string | null = null
	return {
		get: () => Promise.resolve(value),
		set: (next) => {
			value = next
			return Promise.resolve()
		},
	}
}

const running: ObservatoryCameraService[] = []
afterEach(async () => {
	await Promise.all(running.splice(0).map((service) => service.stop()))
})

function setup(options: { readonly storage?: CameraSecretStorage; readonly executable?: boolean } = {}) {
	const database = AppDatabase.memory()
	const events: ObservatoryCameraEvent[] = []
	const program = () => Promise.resolve(options.executable === false ? undefined : { executable: FAKE, timeout: 5000 })
	const service = new ObservatoryCameraService(new ObservatoryCameraStore(database), new CameraSecretKey(undefined, options.storage ?? memoryStorage()), program, (event) => events.push(event), {
		command: (_, args) => [process.execPath, FAKE, 'ok', ...args],
		pollInterval: 50,
		sweepInterval: 50,
	})
	running.push(service)
	return { service, routes: createObservatoryCameraRoutes(service), events, database }
}

function call(routes: Routes, path: keyof Routes, method: string, params: Record<string, string> = {}, body?: unknown, headers?: HeadersInit) {
	const handler = (routes[path] as unknown as Record<string, Handler>)[method]
	let url = `http://localhost${path}`
	for (const [key, value] of Object.entries(params)) url = url.replace(`:${key}`, value)
	const req = new Request(url, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
	return handler(Object.assign(req, { params }))
}

function save(routes: Routes, id: string, body: Record<string, unknown>) {
	return call(routes, '/api/observatory-cameras/:id', 'PUT', { id }, { name: 'Roof', enabled: true, rtspTransport: 'tcp', revision: 0, ...body })
}

async function snapshot(routes: Routes) {
	return (await (await call(routes, '/api/observatory-cameras', 'GET')).json()) as ObservatoryCamerasSnapshot
}

async function until(condition: () => boolean | Promise<boolean>, timeout = 5000) {
	const deadline = Date.now() + timeout
	while (!(await condition())) {
		if (Date.now() > deadline) throw new Error('timed out')
		await Bun.sleep(20)
	}
}

test('source host', () => {
	expect(sourceHost(SECRET)).toBe('192.0.2.10')
	expect(sourceHost('rtsps://cam.local/x')).toBe('cam.local')
	expect(sourceHost('http://192.0.2.10/x')).toBeUndefined()
	expect(sourceHost('file:///etc/passwd')).toBeUndefined()
	expect(sourceHost('not a url')).toBeUndefined()
})

describe('definitions', () => {
	test('saves a camera without ever giving its address back', async () => {
		const { routes, events, database } = setup({ executable: false })

		const created = await save(routes, 'c1', { source: SECRET })
		expect(created.status).toBe(200)
		expect(await created.json()).toEqual({ id: 'c1', name: 'Roof', enabled: true, sortOrder: 0, sourceConfigured: true, sourceHost: '192.0.2.10', rtspTransport: 'tcp', revision: 1 })

		const renamed = await save(routes, 'c1', { name: 'Dome', revision: 1, source: '' })
		expect(renamed.status).toBe(200)

		const state = await snapshot(routes)
		expect(state.cameras).toMatchObject([{ id: 'c1', name: 'Dome', revision: 2 }])
		expect(state.streams).toEqual([{ cameraId: 'c1', state: 'idle', readers: 0 }])
		expect(state.secretKey).toEqual({ status: 'available' })

		const exposed = JSON.stringify([state, events, database.db.query('SELECT * FROM observatory_cameras').all()])
		for (const secret of ['admin', 's3cr3t', 'realmonitor', 't0k3n', 'subtype']) expect(exposed).not.toContain(secret)
	})

	test('refuses an address that is not rtsp, a new camera without one, and a stale revision', async () => {
		const { routes } = setup({ executable: false })
		expect(await (await save(routes, 'c1', { source: 'http://192.0.2.10/' })).json()).toMatchObject({ code: 'invalidSource' })
		expect((await save(routes, 'c1', {})).status).toBe(422)

		await save(routes, 'c1', { source: SECRET })
		const conflict = await save(routes, 'c1', { name: 'Again' })
		expect(conflict.status).toBe(409)
		expect(await conflict.json()).toMatchObject({ code: 'conflict', camera: { id: 'c1', revision: 1 } })
	})

	test('without a usable key nothing is saved', async () => {
		const broken: CameraSecretStorage = { get: () => Promise.reject(new Error('none')), set: () => Promise.reject(new Error('none')) }
		const { routes } = setup({ storage: broken, executable: false })
		const response = await save(routes, 'c1', { source: SECRET })
		expect(response.status).toBe(503)
		expect(await response.json()).toMatchObject({ code: 'secretKeyUnavailable' })
		expect((await snapshot(routes)).cameras).toEqual([])
	})

	test('without MediaMTX the cameras are kept and the gateway is not installed', async () => {
		const { service, routes } = setup({ executable: false })
		await save(routes, 'c1', { source: SECRET })
		await service.start()
		expect((await snapshot(routes)).gateway).toMatchObject({ status: 'notInstalled', code: 'notConfigured' })

		const offer = await call(routes, '/api/observatory-cameras/:id/whep', 'POST', { id: 'c1' }, 'offer', { 'content-type': 'application/sdp' })
		expect(offer.status).toBe(503)
		expect(await offer.json()).toMatchObject({ code: 'gatewayUnavailable' })
	})

	test('events carry the epoch and increasing revisions', async () => {
		const { routes, events } = setup({ executable: false })
		await save(routes, 'c1', { source: SECRET })
		await call(routes, '/api/observatory-cameras/:id', 'DELETE', { id: 'c1' })
		expect(events.some((event) => event.type === 'observatoryCamera:updated')).toBeTrue()
		expect(events.at(-1)).toMatchObject({ type: 'observatoryCamera:removed', cameraId: 'c1' })
		const revisions = events.map((event) => event.revision)
		expect(revisions).toEqual([...revisions].sort((a, b) => a - b))
		expect(new Set(events.map((event) => event.epoch)).size).toBe(1)
	})
})

describe('whep', () => {
	test('brokers a session through server URLs only', async () => {
		const { service, routes } = setup()
		await save(routes, 'c1', { source: SECRET })
		await service.start()
		await until(async () => (await snapshot(routes)).gateway.status === 'ready')

		const offer = await call(routes, '/api/observatory-cameras/:id/whep', 'POST', { id: 'c1' }, 'v=0 offer', { 'content-type': 'application/sdp' })
		expect(offer.status).toBe(201)
		expect(offer.headers.get('content-type')).toBe('application/sdp')
		expect(offer.headers.get('etag')).toBe('*')
		const location = offer.headers.get('location')!
		expect(location).toMatch(/^\/api\/observatory-cameras\/c1\/whep\/sessions\/[0-9a-f-]{36}$/)
		expect(await offer.text()).toBe('answer to v=0 offer')

		const token = location.split('/').at(-1)!
		await until(async () => (await snapshot(routes)).streams[0].readers === 1)
		await until(async () => (await snapshot(routes)).streams[0].state === 'ready')

		const patch = await call(routes, '/api/observatory-cameras/:id/whep/sessions/:token', 'PATCH', { id: 'c1', token }, 'a=candidate', { 'content-type': 'application/trickle-ice-sdpfrag', 'if-match': '*' })
		expect(patch.status).toBe(204)

		expect((await call(routes, '/api/observatory-cameras/:id/whep/sessions/:token', 'PATCH', { id: 'c2', token }, 'a=candidate')).status).toBe(404)

		expect((await call(routes, '/api/observatory-cameras/:id/whep/sessions/:token', 'DELETE', { id: 'c1', token })).status).toBe(204)
		expect((await call(routes, '/api/observatory-cameras/:id/whep/sessions/:token', 'DELETE', { id: 'c1', token })).status).toBe(204)
		const expired = await call(routes, '/api/observatory-cameras/:id/whep/sessions/:token', 'PATCH', { id: 'c1', token }, 'a=candidate')
		expect(await expired.json()).toMatchObject({ code: 'sessionExpired' })
		await until(async () => (await snapshot(routes)).streams[0].state === 'idle')
	})

	test('a refused camera is unavailable with the reason', async () => {
		const { service, routes } = setup()
		await save(routes, 'c1', { source: BAD_AUTH })
		await service.start()

		const offer = await call(routes, '/api/observatory-cameras/:id/whep', 'POST', { id: 'c1' }, 'offer', { 'content-type': 'application/sdp' })
		expect(offer.status).toBe(502)
		expect(await offer.json()).toMatchObject({ code: 'sourceAuthFailed' })
		expect((await snapshot(routes)).streams[0]).toMatchObject({ state: 'unavailable', code: 'sourceAuthFailed' })
	})

	test('a disabled or unknown camera cannot be watched', async () => {
		const { service, routes } = setup()
		await save(routes, 'c1', { source: SECRET, enabled: false })
		await service.start()
		expect((await call(routes, '/api/observatory-cameras/:id/whep', 'POST', { id: 'c1' }, 'offer')).status).toBe(409)
		expect((await call(routes, '/api/observatory-cameras/:id/whep', 'POST', { id: 'nope' }, 'offer')).status).toBe(404)
		expect((await snapshot(routes)).gateway.status).toBe('stopped')
	})

	test('a new address or a removal ends the sessions of the camera', async () => {
		const { service, routes } = setup()
		await save(routes, 'c1', { source: SECRET })
		await service.start()

		const first = await call(routes, '/api/observatory-cameras/:id/whep', 'POST', { id: 'c1' }, 'offer')
		const token = first.headers.get('location')!.split('/').at(-1)!
		await save(routes, 'c1', { source: 'rtsp://192.0.2.12/other', revision: 1 })
		expect((await call(routes, '/api/observatory-cameras/:id/whep/sessions/:token', 'PATCH', { id: 'c1', token }, 'a=candidate')).status).toBe(404)

		const second = await call(routes, '/api/observatory-cameras/:id/whep', 'POST', { id: 'c1' }, 'offer')
		expect(second.status).toBe(201)
		await call(routes, '/api/observatory-cameras/:id', 'DELETE', { id: 'c1' })
		const other = second.headers.get('location')!.split('/').at(-1)!
		expect((await call(routes, '/api/observatory-cameras/:id/whep/sessions/:token', 'PATCH', { id: 'c1', token: other }, 'a=candidate')).status).toBe(404)
		await until(async () => (await snapshot(routes)).gateway.status === 'stopped')
	})
})
