import { afterAll, afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { CameraCaptures, type CaptureEvent, type CaptureFrame, type CaptureRequest, type CaptureSession, frameName, sanitizeFileName } from './captures'
import { ConnectionManager } from './connection'
import type { CameraCapabilities } from './devices'
import { ImageStore } from './images'
import { type OperationEvent, OperationRegistry } from './operations'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-captures-'))
const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

async function waitUntil(condition: () => boolean, timeout = 10000) {
	const start = Date.now()
	while (!condition()) {
		if (Date.now() - start > timeout) throw new Error('timeout')
		await Bun.sleep(10)
	}
}

// A capture request of small, short subframes, with fields replaced.
function request(patch: Partial<CaptureRequest> = {}): CaptureRequest {
	return { exposureMode: 'single', count: 1, delay: 0, exposureTime: 0.05, frameType: 'LIGHT', gain: 0, offset: 0, binX: 1, binY: 1, subframe: true, x: 0, y: 0, width: 32, height: 32, frameFormat: '', output: { mode: 'preview-save', directory: mkdtempSync(join(root, 'frames-')), format: 'FITS' }, ...patch }
}

async function setup() {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const operationEvents: OperationEvent[] = []
	const operations = new OperationRegistry(manager.devices, (event) => operationEvents.push(event))
	disposables.push(operations)
	const images = new ImageStore()
	const events: CaptureEvent[] = []
	const captures = new CameraCaptures(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		images,
		(event) => events.push(event),
		mkdtempSync(join(root, 'default-')),
	)
	disposables.push(captures)
	const cameraId = manager.devices.list(client).find((device) => device.type === 'camera')!.id
	manager.devices.switch(client, cameraId, true)
	const camera = manager.devices.camera(client, cameraId)!
	await waitUntil(() => camera.connected && camera.frame.width.max > 0 && operations.arbiter.availability(resourceKey(camera)) === 'available')

	// Latest published state of the camera's session.
	const session = () => events.findLast((event): event is Extract<CaptureEvent, { type: 'capture:updated' }> => event.type === 'capture:updated')?.session
	// Every previewed or saved frame event.
	const frames = () => events.filter((event): event is Extract<CaptureEvent, { type: 'capture:frame' }> => event.type === 'capture:frame').map((event) => event.frame)
	const ended = () => ['completed', 'stopped', 'aborted', 'failed'].includes(session()?.phase ?? '')

	return { manager, id, client, operations, operationEvents, images, captures, events, camera, cameraId, session, frames, ended }
}

test('a single capture saves one frame, previews it, and releases the camera', async () => {
	const { id, cameraId, captures, operations, operationEvents, images, camera, session, frames, ended } = await setup()
	const capture = request()

	const response = captures.start(id, cameraId, capture)
	expect(response.status).toBe(202)
	const { sessionId, operationId } = (await response.json()) as { sessionId: string; operationId: string }

	await waitUntil(ended)
	await waitUntil(() => frames().some((frame) => frame.saved))

	expect(session()).toMatchObject({ sessionId, operationId, connectionId: id, deviceId: cameraId, phase: 'completed', captured: 1, saved: 1, count: 1, stopping: false })
	const files = readdirSync(capture.output.directory!)
	expect(files).toHaveLength(1)
	expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}_Camera Simulator_LIGHT_0001\.fit$/)

	const frame = frames().at(-1)!
	expect(frame).toMatchObject({ sessionId, connectionId: id, deviceId: cameraId, generation: 1, path: join(capture.output.directory!, files[0]), saved: true, frameType: 'LIGHT', width: 32, height: 32, channels: 1 })
	expect(frame.acquisition.exposure).toBeCloseTo(0.05, 6)
	expect(images.name(frame.imageId)).toBe(files[0])
	expect(captures.snapshot().frames).toEqual([frame])

	expect(operationEvents.map((event) => [event.operation.kind, event.operation.state])).toEqual([
		['camera.capture', 'running'],
		['camera.capture', 'succeeded'],
	])
	expect(operations.arbiter.availability(resourceKey(camera))).toBe('available')
})

test('a fixed capture takes exactly its frames, under unique names, and keeps only the latest preview', async () => {
	const { id, cameraId, captures, images, session, frames, ended } = await setup()
	const capture = request({ exposureMode: 'fixed', count: 3, delay: 0.05, output: { mode: 'preview-save', directory: mkdtempSync(join(root, 'fixed-')), filenameTemplate: 'm42_{seq}', format: 'FITS' } })

	captures.start(id, cameraId, capture)
	await waitUntil(ended)
	await waitUntil(() => frames().some((frame) => frame.generation === 3 && frame.saved))

	expect(session()).toMatchObject({ phase: 'completed', captured: 3, saved: 3, count: 3 })
	expect(readdirSync(capture.output.directory!).toSorted()).toEqual(['m42_0001.fit', 'm42_0002.fit', 'm42_0003.fit'])

	const previewed = [...new Set(frames().map((frame) => frame.imageId))]
	expect(images.name(previewed.at(-1)!)).toBe('m42_0003.fit')
	for (const imageId of previewed.slice(0, -1)) expect(images.name(imageId)).toBeUndefined()
	expect(captures.snapshot().frames.map((frame) => frame.imageId)).toEqual([previewed.at(-1)!])
})

test('stopping a loop during its delay ends it at once with the frames taken', async () => {
	const { id, cameraId, captures, session, ended } = await setup()

	captures.start(id, cameraId, request({ exposureMode: 'loop', delay: 30 }))
	await waitUntil(() => session()?.phase === 'waiting' && session()!.saved === 1)

	const stoppedAt = performance.now()
	expect(captures.stop(id, cameraId).status).toBe(204)
	await waitUntil(ended, 3000)

	expect(performance.now() - stoppedAt).toBeLessThan(3000)
	expect(session()).toMatchObject({ phase: 'stopped', stopping: true, captured: 1, saved: 1 })
	expect(session()!.count).toBeUndefined()
	expect(captures.stop(id, cameraId).status).toBe(404)
})

test('preview only writes no file', async () => {
	const { id, cameraId, captures, session, frames, ended } = await setup()
	const capture = request({ exposureMode: 'fixed', count: 2, output: { mode: 'preview-only', directory: mkdtempSync(join(root, 'preview-')), format: 'FITS' } })

	captures.start(id, cameraId, capture)
	await waitUntil(ended)
	await waitUntil(() => frames().length > 0)

	expect(session()).toMatchObject({ phase: 'completed', captured: 2, saved: 0 })
	expect(readdirSync(capture.output.directory!)).toEqual([])
	expect(frames().every((frame: CaptureFrame) => frame.path === undefined && !frame.saved)).toBeTrue()
})

test('a failed write fails the capture, counts the frame as captured but not saved, and leaves no file', async () => {
	const { id, cameraId, captures, session, ended } = await setup()
	const blocker = join(mkdtempSync(join(root, 'blocked-')), 'not-a-directory')
	writeFileSync(blocker, 'a file')

	captures.start(id, cameraId, request({ exposureMode: 'loop', output: { mode: 'preview-save', directory: join(blocker, 'frames'), format: 'FITS' } }))
	await waitUntil(ended)

	expect(session()).toMatchObject({ phase: 'failed', reason: 'commandFailed', captured: 1, saved: 0 })
	expect(readdirSync(join(blocker, '..'))).toEqual(['not-a-directory'])
})

test('a busy camera refuses a second capture, and abort ends the first', async () => {
	const { id, cameraId, captures, session, ended } = await setup()

	expect(captures.start(id, cameraId, request({ exposureTime: 30 })).status).toBe(202)
	await waitUntil(() => session()?.phase === 'exposing')

	const second = captures.start(id, cameraId, request())
	expect(second.status).toBe(409)
	expect(await second.json()).toEqual({ error: 'The camera is busy' })

	expect((await captures.abort(id, cameraId)).status).toBe(204)
	await waitUntil(ended)
	expect(session()).toMatchObject({ phase: 'aborted', reason: 'aborted', captured: 0 })
})

test('disconnecting the camera during the delay fails the capture', async () => {
	const { id, cameraId, client, manager, captures, session, ended } = await setup()

	captures.start(id, cameraId, request({ exposureMode: 'loop', delay: 30 }))
	await waitUntil(() => session()?.phase === 'waiting')
	manager.devices.switch(client, cameraId, false)

	await waitUntil(ended, 3000)
	expect(session()).toMatchObject({ phase: 'failed', reason: 'disconnected', captured: 1 })
})

test('an unknown camera is not found', async () => {
	const { id, captures } = await setup()

	expect(captures.start(id, 'missing', request()).status).toBe(404)
	expect(captures.stop(id, 'missing').status).toBe(404)
	expect((await captures.abort(id, 'missing')).status).toBe(404)
	expect(captures.capabilities(id, 'missing').status).toBe(404)
})

test('reports the capabilities of a camera', async () => {
	const { id, cameraId, captures } = await setup()

	const capabilities = (await captures.capabilities(id, cameraId).json()) as CameraCapabilities
	expect(capabilities).toMatchObject({ connectionId: id, id: cameraId, name: 'Camera Simulator', connected: true, canAbort: true, transferFormats: ['FITS', 'XISF'] })
	expect(capabilities.exposure!.max).toBeGreaterThan(capabilities.exposure!.min)
	expect(capabilities.bin!.x).toBeGreaterThanOrEqual(1)
	expect(capabilities.subframe!.width).toBeGreaterThan(0)
})

test('the snapshot keeps the ended session of each camera', async () => {
	const { id, cameraId, captures, ended } = await setup()

	captures.start(id, cameraId, request())
	await waitUntil(ended)

	const sessions: readonly CaptureSession[] = captures.snapshot().sessions
	expect(sessions.map((session) => [session.deviceId, session.phase])).toEqual([[cameraId, 'completed']])
})

test('fills a filename template with the frame fields', () => {
	const time = Date.UTC(2026, 9, 19, 21, 5, 7, 89)
	const fields = { camera: 'ZWO ASI2600MM', type: 'DARK', time, generation: 12, timezoneOffset: -180 }

	expect(frameName('{date}_{time}_{camera}_{type}_{seq}', fields)).toBe('2026-10-19_18-05-07-089_ZWO ASI2600MM_DARK_0012')
	expect(frameName('{camera}/{unknown}', fields)).toBe('ZWO ASI2600MM_{unknown}')
	expect(frameName('...', fields)).toBe('frame')
})

test('sanitizes a file name for every platform', () => {
	expect(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j\u0001k. ')).toBe('a_b_c_d_e_f_g_h_i_j_k')
})

test('mounts the capture routes', async () => {
	const { routes } = await import('./index')
	type Handler = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>
	const call = (route: keyof typeof routes, method: 'GET' | 'POST') => Promise.resolve((routes[route] as Record<string, Handler>)[method](Object.assign(new Request('http://localhost/', { method }), { params: { id: 'closed', deviceId: 'camera' } })))

	expect(await (await call('/api/captures', 'GET')).json()).toEqual({ sessions: [], frames: [] })
	expect((await call('/api/connections/:id/cameras/:deviceId', 'GET')).status).toBe(404)
	expect((await call('/api/connections/:id/cameras/:deviceId/capture/stop', 'POST')).status).toBe(404)
	expect((await call('/api/connections/:id/cameras/:deviceId/capture/abort', 'POST')).status).toBe(404)
})
