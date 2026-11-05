import { afterAll, afterEach, expect, spyOn, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import { failedOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { type CaptureFrameEvent, CaptureFrameRegistry } from './captureframes'
import { CameraCaptures, type CaptureEvent, type CaptureFrame, type CaptureFrameSink, type CaptureAdmissionOptions, type CaptureSession, type CaptureStartRequest, frameName, sanitizeFileName } from './captures'
import { ConnectionManager } from './connection'
import { AppDatabase } from './database'
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
function request(patch: Partial<CaptureStartRequest> = {}): CaptureStartRequest {
	return {
		token: crypto.randomUUID(),
		exposureMode: 'single',
		count: 1,
		delay: 0,
		exposureTime: 0.05,
		frameType: 'LIGHT',
		gain: 0,
		offset: 0,
		binX: 1,
		binY: 1,
		subframe: true,
		x: 0,
		y: 0,
		width: 32,
		height: 32,
		frameFormat: '',
		output: { mode: 'preview-save', directory: mkdtempSync(join(root, 'frames-')), format: 'FITS' },
		...patch,
	}
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
	const frameEvents: CaptureFrameEvent[] = []
	const frameRegistry = new CaptureFrameRegistry(images, (event) => frameEvents.push(event), { database: AppDatabase.memory(), connected: () => true })
	disposables.push(frameRegistry)
	const events: CaptureEvent[] = []
	const captures = new CameraCaptures(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		images,
		frameRegistry,
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

	return { manager, id, client, operations, operationEvents, images, frameRegistry, frameEvents, captures, events, camera, cameraId, session, frames, ended }
}

test('a single capture saves one frame, previews it, and releases the camera', async () => {
	const { id, cameraId, captures, operations, operationEvents, images, camera, session, frames, ended } = await setup()
	const capture = request()

	const response = captures.start(id, cameraId, capture)
	expect(response.status).toBe(202)
	const { sessionId, operationId } = (await response.json()) as { sessionId: string; operationId: string }

	await waitUntil(ended)
	await waitUntil(() => frames().some((frame) => frame.file === 'saved'))

	expect(session()).toMatchObject({ sessionId, operationId, connectionId: id, deviceId: cameraId, phase: 'completed', captured: 1, saved: 1, count: 1, stopping: false })
	const files = readdirSync(capture.output.directory!)
	expect(files).toHaveLength(1)
	expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}_Camera Simulator_LIGHT_0001\.fit$/)

	const frame = frames().at(-1)!
	expect(frame).toMatchObject({ sessionId, connectionId: id, deviceId: cameraId, generation: 1, path: join(capture.output.directory!, files[0]), file: 'saved', frameType: 'LIGHT', width: 32, height: 32, channels: 1 })
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
	await waitUntil(() => frames().some((frame) => frame.generation === 3 && frame.file === 'saved'))

	expect(session()).toMatchObject({ phase: 'completed', captured: 3, saved: 3, count: 3 })
	expect(readdirSync(capture.output.directory!).toSorted()).toEqual(['m42_0001.fit', 'm42_0002.fit', 'm42_0003.fit'])

	const previewed = [...new Set(frames().map((frame) => frame.imageId))]
	expect(images.name(previewed.at(-1)!)).toBe('m42_0003.fit')
	for (const imageId of previewed.slice(0, -1)) expect(images.name(imageId)).toBeUndefined()
	expect(captures.snapshot().frames.map((frame) => frame.imageId)).toEqual([previewed.at(-1)!])
})

test('every saved frame is recorded in the frame registry, the latest one in memory', async () => {
	const { id, cameraId, captures, frameRegistry, session, frames, ended } = await setup()
	const capture = request({ exposureMode: 'fixed', count: 3, delay: 0.05, output: { mode: 'preview-save', directory: mkdtempSync(join(root, 'registry-')), filenameTemplate: 'frame_{seq}', format: 'FITS' } })

	captures.start(id, cameraId, capture)
	await waitUntil(ended)
	await waitUntil(() => frames().some((frame) => frame.generation === 3 && frame.file === 'saved'))

	const { sessionId } = session()!
	const recorded = (await frameRegistry.recent(id, cameraId)).frames
	expect(recorded.map((frame) => [frame.frameId, frame.availability, frame.fileName])).toEqual([
		[`${sessionId}:3`, 'memory', 'frame_0003.fit'],
		[`${sessionId}:2`, 'file', 'frame_0002.fit'],
		[`${sessionId}:1`, 'file', 'frame_0001.fit'],
	])
	expect(recorded[0].imageId).toBe(captures.snapshot().frames[0].imageId)
})

test('stopping a loop during its delay ends it at once with the frames taken', async () => {
	const { id, cameraId, captures, session, ended } = await setup()

	captures.start(id, cameraId, request({ exposureMode: 'loop', delay: 30 }))
	await waitUntil(() => session()?.phase === 'waiting' && session()!.saved === 1)

	const stoppedAt = performance.now()
	expect(captures.stop(id, cameraId, { sessionId: session()!.sessionId }).status).toBe(204)
	await waitUntil(ended, 3000)

	expect(performance.now() - stoppedAt).toBeLessThan(3000)
	expect(session()).toMatchObject({ phase: 'stopped', stopping: true, captured: 1, saved: 1 })
	expect(session()!.count).toBeUndefined()
	expect(captures.stop(id, cameraId, { sessionId: session()!.sessionId }).status).toBe(404)
})

test('preview only writes no file', async () => {
	const { id, cameraId, captures, session, frames, ended } = await setup()
	const capture = request({ exposureMode: 'fixed', count: 2, output: { mode: 'preview-only', directory: mkdtempSync(join(root, 'preview-')), format: 'FITS' } })

	captures.start(id, cameraId, capture)
	await waitUntil(ended)
	await waitUntil(() => frames().length > 0)

	expect(session()).toMatchObject({ phase: 'completed', captured: 2, saved: 0 })
	expect(readdirSync(capture.output.directory!)).toEqual([])
	expect(frames().every((frame: CaptureFrame) => frame.path === undefined && frame.file === undefined)).toBeTrue()
})

test('snoops the mount, focuser, filter wheel and rotator a request names by id, and none it does not resolve', async () => {
	const { manager, client, id, cameraId, captures, camera, ended } = await setup()
	const snoop = spyOn(manager.devices.cameras, 'snoop')
	const devices = manager.devices.list(client)
	const ids = (type: string) => devices.find((device) => device.type === type)!.id
	const device = (type: string) => manager.devices.get(client, ids(type))

	expect(captures.start(id, cameraId, request({ output: { mode: 'preview-only', format: 'FITS' }, snoop: { mount: ids('mount'), focuser: ids('focuser'), wheel: ids('wheel'), rotator: ids('rotator') } })).status).toBe(202)
	await waitUntil(ended)
	expect(snoop).toHaveBeenLastCalledWith(camera, device('mount'), device('focuser'), device('wheel'), device('rotator'))

	expect(captures.start(id, cameraId, request({ output: { mode: 'preview-only', format: 'FITS' }, snoop: { mount: 'unknown' } })).status).toBe(202)
	await waitUntil(() => snoop.mock.calls.length === 2)
	expect(snoop).toHaveBeenLastCalledWith(camera, undefined, undefined, undefined, undefined)
	snoop.mockRestore()
})

test('a failed write fails the capture, marks the frame file as failed, and leaves no file', async () => {
	const { id, cameraId, captures, session, frames, ended } = await setup()
	const blocker = join(mkdtempSync(join(root, 'blocked-')), 'not-a-directory')
	writeFileSync(blocker, 'a file')

	captures.start(id, cameraId, request({ exposureMode: 'loop', output: { mode: 'preview-save', directory: join(blocker, 'frames'), format: 'FITS' } }))
	await waitUntil(ended)

	expect(session()).toMatchObject({ phase: 'failed', reason: 'commandFailed', captured: 1, saved: 0 })
	await waitUntil(() => frames().some((frame) => frame.file === 'failed'))
	expect(frames().at(-1)).toMatchObject({ generation: 1, path: expect.stringContaining(join(blocker, 'frames')), file: 'failed' })
	expect(readdirSync(join(blocker, '..'))).toEqual(['not-a-directory'])
})

test('a busy camera refuses a second capture, and abort ends the first', async () => {
	const { id, cameraId, captures, session, ended } = await setup()

	expect(captures.start(id, cameraId, request({ exposureTime: 30 })).status).toBe(202)
	await waitUntil(() => session()?.phase === 'exposing')

	const second = captures.start(id, cameraId, request())
	expect(second.status).toBe(409)
	expect(await second.json()).toEqual({ error: 'The camera is busy', code: 'busy' })

	expect((await captures.abort(id, cameraId, { sessionId: session()!.sessionId })).status).toBe(204)
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
	expect(captures.stop(id, 'missing', { sessionId: 'none' }).status).toBe(404)
	expect((await captures.abort(id, 'missing', { sessionId: 'none' })).status).toBe(404)
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
	const call = (route: keyof typeof routes, method: 'GET' | 'POST', body?: unknown) =>
		Promise.resolve((routes[route] as Record<string, Handler>)[method](Object.assign(new Request('http://localhost/', { method, body: body === undefined ? undefined : JSON.stringify(body) }), { params: { id: 'closed', deviceId: 'camera' } })))

	expect(await (await call('/api/captures', 'GET')).json()).toEqual({ sessions: [], frames: [] })
	expect((await call('/api/connections/:id/cameras/:deviceId', 'GET')).status).toBe(404)
	expect((await call('/api/connections/:id/cameras/:deviceId/capture/stop', 'POST', { sessionId: 'none' })).status).toBe(404)
	expect((await call('/api/connections/:id/cameras/:deviceId/capture/abort', 'POST', { sessionId: 'none' })).status).toBe(404)
})

// A frame sink that records every call, whose gate holds every frame from hold on until released.
function recordingSink(hold = Number.POSITIVE_INFINITY) {
	const calls: (readonly [string, ...unknown[]])[] = []
	const bytes = new Map<string, Uint8Array>()
	let gates = 0
	let release: (() => void) | undefined

	const sink: CaptureFrameSink = {
		wants: () => true,
		captured: (frame, data) => {
			calls.push(['captured', frame.frameId, frame.generation, data !== undefined])
			if (data) bytes.set(frame.frameId, data)
		},
		saved: (frameId, path) => calls.push(['saved', frameId, path]),
		saveFailed: (frameId) => calls.push(['saveFailed', frameId]),
		gate: (_connectionId, _deviceId, signal) => {
			if (++gates < hold) return undefined
			calls.push(['held', gates])
			return new Promise<void>((resolve) => {
				release = resolve
				signal.addEventListener('abort', () => resolve(), { once: true })
			})
		},
		captureEnded: (sessionId) => calls.push(['ended', sessionId]),
	}

	return { sink, calls, bytes, release: () => release?.() }
}

test('a frame sink receives every light frame of a preview-only capture with an owned copy of its bytes', async () => {
	const { id, cameraId, captures, session, frames, ended } = await setup()
	const { sink, calls, bytes } = recordingSink()
	captures.listenFrames(sink)

	captures.start(id, cameraId, request({ exposureMode: 'fixed', count: 4, output: { mode: 'preview-only', format: 'FITS' } }))
	await waitUntil(ended)
	await waitUntil(() => calls.some(([kind]) => kind === 'ended'))

	const { sessionId } = session()!
	expect(calls).toEqual([...[1, 2, 3, 4].map((generation) => ['captured', `${sessionId}:${generation}`, generation, true] as const), ['ended', sessionId]])
	expect(new Set([...bytes.values()].map((data) => data.buffer)).size).toBe(4)
	expect([...bytes.values()].every((data) => data.byteLength > 2880)).toBeTrue()
	expect(frames().length).toBeLessThanOrEqual(4)
})

test('a frame sink learns a saved light frame at its decoding and its file once written', async () => {
	const { id, cameraId, captures, session, ended } = await setup()
	const { sink, calls } = recordingSink()
	const capture = request({ exposureMode: 'fixed', count: 2, output: { mode: 'preview-save', directory: mkdtempSync(join(root, 'sink-')), filenameTemplate: 'sink_{seq}', format: 'FITS' } })
	captures.listenFrames(sink)

	captures.start(id, cameraId, capture)
	await waitUntil(ended)
	await waitUntil(() => calls.some(([kind]) => kind === 'ended'))

	const { sessionId } = session()!
	expect(calls).toEqual([
		['captured', `${sessionId}:1`, 1, false],
		['saved', `${sessionId}:1`, join(capture.output.directory!, 'sink_0001.fit')],
		['captured', `${sessionId}:2`, 2, false],
		['saved', `${sessionId}:2`, join(capture.output.directory!, 'sink_0002.fit')],
		['ended', sessionId],
	])
})

test('a frame sink learns a failed write, and receives no frame of other frame types', async () => {
	const { id, cameraId, captures, session, ended } = await setup()
	const { sink, calls } = recordingSink()
	const blocker = join(mkdtempSync(join(root, 'sink-blocked-')), 'not-a-directory')
	writeFileSync(blocker, 'a file')
	captures.listenFrames(sink)

	captures.start(id, cameraId, request({ output: { mode: 'preview-save', directory: join(blocker, 'frames'), format: 'FITS' } }))
	await waitUntil(ended)
	await waitUntil(() => calls.some(([kind]) => kind === 'ended'))
	const failed = session()!.sessionId
	expect(calls.map(([kind]) => kind)).toEqual(['captured', 'saveFailed', 'ended'])
	expect(calls[1]).toEqual(['saveFailed', `${failed}:1`])

	calls.length = 0
	captures.start(id, cameraId, request({ frameType: 'DARK', output: { mode: 'preview-only', format: 'FITS' } }))
	await waitUntil(() => session()?.sessionId !== failed && ended())
	await waitUntil(() => calls.length > 0)
	expect(calls).toEqual([['ended', session()!.sessionId]])
})

test('the gate of a frame sink holds the next exposure until released, and a stop releases it', async () => {
	const { id, cameraId, captures, session, ended } = await setup()
	const { sink, calls, release } = recordingSink(2)
	captures.listenFrames(sink)

	captures.start(id, cameraId, request({ exposureMode: 'loop', output: { mode: 'preview-only', format: 'FITS' } }))
	await waitUntil(() => calls.some(([kind]) => kind === 'held'))
	await Bun.sleep(300)
	expect(session()).toMatchObject({ captured: 1 })

	release()
	await waitUntil(() => session()!.captured === 2)
	await waitUntil(() => calls.filter(([kind]) => kind === 'held').length === 2)

	expect(captures.stop(id, cameraId, { sessionId: session()!.sessionId }).status).toBe(204)
	await waitUntil(ended, 3000)
	expect(session()).toMatchObject({ phase: 'stopped', captured: 2 })
})

test('an abort releases the gate of a frame sink', async () => {
	const { id, cameraId, captures, session, ended } = await setup()
	const { sink, calls } = recordingSink(2)
	captures.listenFrames(sink)

	captures.start(id, cameraId, request({ exposureMode: 'loop', output: { mode: 'preview-only', format: 'FITS' } }))
	await waitUntil(() => calls.some(([kind]) => kind === 'held'))

	expect((await captures.abort(id, cameraId, { sessionId: session()!.sessionId })).status).toBe(204)
	await waitUntil(ended, 3000)
	expect(session()).toMatchObject({ phase: 'aborted', captured: 1 })
})

test('a failing frame sink never fails the capture, and a detached one receives nothing', async () => {
	const { id, cameraId, captures, session, frames, ended } = await setup()
	const fail = () => {
		throw new Error('sink failure')
	}
	const error = spyOn(console, 'error').mockImplementation(() => undefined)
	const detach = captures.listenFrames({ wants: () => true, captured: fail, saved: fail, saveFailed: fail, gate: () => Promise.reject(new Error('gate failure')), captureEnded: fail })

	captures.start(id, cameraId, request({ exposureMode: 'fixed', count: 2, output: { mode: 'preview-save', directory: mkdtempSync(join(root, 'sink-failing-')), format: 'FITS' } }))
	await waitUntil(ended)
	await waitUntil(() => frames().some((frame) => frame.generation === 2 && frame.file === 'saved'))
	expect(session()).toMatchObject({ phase: 'completed', captured: 2, saved: 2 })
	expect(error).toHaveBeenCalled()
	error.mockRestore()

	const { sink, calls } = recordingSink()
	captures.listenFrames(sink)()
	detach()
	captures.start(id, cameraId, request({ output: { mode: 'preview-only', format: 'FITS' } }))
	await waitUntil(() => session()?.captured === 1 && ended())
	expect(calls).toEqual([])
})

// Reserves the camera for a caller composing tools, released after the test.
function reserve(operations: OperationRegistry, camera: Camera) {
	const reserved = operations.arbiter.reserve({ id: 'composition', kind: 'test' }, [{ key: resourceKey(camera), device: camera }])
	if (!reserved.ok) throw new Error('the camera could not be reserved')
	disposables.push({ [Symbol.dispose]: () => reserved.reservation.release() })
	return { reservation: reserved.reservation }
}

// Admits a capture and fails the test when it is refused.
function admitted(captures: CameraCaptures, id: string, cameraId: string, capture: CaptureStartRequest, options?: CaptureAdmissionOptions) {
	const admission = captures.admit(id, cameraId, capture, options)
	if (!admission.ok) throw new Error(admission.error)
	return admission
}

test('a capture admitted under a reservation runs while a manual capture is refused', async () => {
	const { id, cameraId, captures, operations, camera } = await setup()
	const invocation = reserve(operations, camera)

	expect(captures.start(id, cameraId, request()).status).toBe(409)
	const admission = admitted(captures, id, cameraId, request(), { invocation })
	expect(await admission.started).toMatchObject({ ok: true })
	expect(await admission.ended).toMatchObject({ sessionId: admission.sessionId, phase: 'completed', captured: 1, saved: 1 })
	expect(operations.arbiter.availability(resourceKey(camera))).toBe('reserved')
	expect(captures.start(id, cameraId, request()).status).toBe(409)
})

test('a repeated token answers the capture it started, and another token is refused while it runs', async () => {
	const { id, cameraId, captures, operationEvents } = await setup()
	const capture = request({ exposureTime: 1 })

	const first = admitted(captures, id, cameraId, capture)
	const repeated = captures.start(id, cameraId, capture)
	expect(repeated.status).toBe(202)
	expect(await repeated.json()).toEqual({ sessionId: first.sessionId, operationId: first.operationId })
	expect(captures.admit(id, cameraId, capture)).toMatchObject({ ok: true, sessionId: first.sessionId, repeated: true })
	expect(captures.admit(id, cameraId, request())).toMatchObject({ ok: false, status: 409, code: 'busy' })

	expect(await first.ended).toMatchObject({ phase: 'completed', captured: 1 })
	expect(operationEvents.filter((event) => event.operation.kind === 'camera.capture' && event.operation.state === 'running')).toHaveLength(1)
})

test('a late stop of an ended session never reaches the session that replaced it, which keeps the end of the first', async () => {
	const { id, cameraId, captures, session } = await setup()
	const capture = request()

	const first = admitted(captures, id, cameraId, capture)
	const ended = await first.ended
	const second = admitted(captures, id, cameraId, request({ exposureMode: 'loop', output: { mode: 'preview-only', format: 'FITS' } }))
	await waitUntil(() => session()?.sessionId === second.sessionId && session()!.captured >= 1)

	expect(captures.stopSession(first.sessionId)).toBeFalse()
	expect(captures.stop(id, cameraId, { sessionId: first.sessionId }).status).toBe(404)
	expect(await captures.abortSession(first.sessionId)).toBe('notRunning')
	expect(session()).toMatchObject({ sessionId: second.sessionId, stopping: false })

	expect(await first.ended).toBe(ended)
	expect(captures.admit(id, cameraId, capture)).toMatchObject({ ok: true, sessionId: first.sessionId, repeated: true })
	expect(await captures.abortSession(second.sessionId)).toBe('aborted')
	expect(await second.ended).toMatchObject({ phase: 'aborted' })
})

test('a stop during an exposure keeps its frame, and a failed write ends the capture as failed', async () => {
	const { id, cameraId, captures, session } = await setup()

	const stopped = admitted(captures, id, cameraId, request({ exposureMode: 'loop', exposureTime: 1 }))
	await waitUntil(() => session()?.phase === 'exposing')
	expect(captures.stopSession(stopped.sessionId)).toBeTrue()
	expect(await stopped.ended).toMatchObject({ phase: 'stopped', captured: 1, saved: 1 })

	const blocker = join(mkdtempSync(join(root, 'admit-blocked-')), 'not-a-directory')
	writeFileSync(blocker, 'a file')
	const failed = admitted(captures, id, cameraId, request({ output: { mode: 'preview-save', directory: join(blocker, 'frames'), format: 'FITS' } }))
	expect(await failed.ended).toMatchObject({ phase: 'failed', reason: 'commandFailed', captured: 1, saved: 0 })
})

test('the gate of the caller holds each next frame, and its failure ends the capture', async () => {
	const { id, cameraId, captures, session } = await setup()
	const generations: number[] = []
	let release: VoidFunction | undefined

	const held = admitted(captures, id, cameraId, request({ exposureMode: 'loop', output: { mode: 'preview-only', format: 'FITS' } }), {
		beforeFrame: ({ generation }, signal) => {
			generations.push(generation)
			if (generation < 2) return Promise.resolve(undefined)
			const { promise, resolve } = Promise.withResolvers<undefined>()
			release = () => resolve(undefined)
			signal.addEventListener('abort', () => resolve(undefined), { once: true })
			return promise
		},
	})

	await waitUntil(() => release !== undefined)
	await Bun.sleep(300)
	expect(session()).toMatchObject({ sessionId: held.sessionId, captured: 1 })

	release!()
	await waitUntil(() => generations.length === 3)
	expect(session()!.captured).toBe(2)
	expect(captures.stopSession(held.sessionId)).toBeTrue()
	expect(await held.ended).toMatchObject({ phase: 'stopped', captured: 2 })

	const refused = admitted(captures, id, cameraId, request({ exposureMode: 'fixed', count: 3, output: { mode: 'preview-only', format: 'FITS' } }), {
		beforeFrame: ({ generation }) => Promise.resolve(generation === 2 ? failedOperationResult('unexpectedState', 'not now') : undefined),
	})
	expect(await refused.ended).toMatchObject({ phase: 'failed', reason: 'unexpectedState', error: 'not now', captured: 1 })
})
