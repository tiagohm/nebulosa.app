import { afterAll, afterEach, expect, spyOn, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { CameraCaptures, type CaptureEvent, type CaptureFrame, type CaptureRequest, type CaptureSession, frameName, sanitizeFileName } from './captures'
import { ConnectionManager } from './connection'
import type { CameraCapabilities } from './devices'
import { ExternalToolsStore } from './externaltools'
import { ImageStore } from './images'
import { type OperationEvent, OperationRegistry } from './operations'
import { type PlateSolvingEvent, PlateSolvingService } from './platesolving'
import { DEFAULT_ASTAP_SETTINGS, DEFAULT_BUILTIN_SETTINGS, DEFAULT_STAR_ACCEPTANCE, type StarDetectionEvent, StarDetectionService } from './stars'

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
	const tools = new ExternalToolsStore(join(mkdtempSync(join(root, 'settings-')), 'settings.json'))
	const starEvents: StarDetectionEvent[] = []
	const stars = new StarDetectionService(images, tools, (event) => starEvents.push(event))
	const solveEvents: PlateSolvingEvent[] = []
	const plateSolving = new PlateSolvingService(images, tools, (event) => solveEvents.push(event))
	const events: CaptureEvent[] = []
	const captures = new CameraCaptures(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		images,
		stars,
		plateSolving,
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

	return { manager, id, client, operations, operationEvents, images, tools, stars, starEvents, plateSolving, solveEvents, captures, events, camera, cameraId, session, frames, ended }
}

test('a single capture saves one frame, previews it, and releases the camera', async () => {
	const { id, cameraId, captures, operations, operationEvents, images, camera, session, frames, ended } = await setup()
	const capture = request()

	const response = await captures.start(id, cameraId, capture)
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

	await captures.start(id, cameraId, capture)
	await waitUntil(ended)
	await waitUntil(() => frames().some((frame) => frame.generation === 3 && frame.file === 'saved'))

	expect(session()).toMatchObject({ phase: 'completed', captured: 3, saved: 3, count: 3 })
	expect(readdirSync(capture.output.directory!).toSorted()).toEqual(['m42_0001.fit', 'm42_0002.fit', 'm42_0003.fit'])

	const previewed = [...new Set(frames().map((frame) => frame.imageId))]
	expect(images.name(previewed.at(-1)!)).toBe('m42_0003.fit')
	for (const imageId of previewed.slice(0, -1)) expect(images.name(imageId)).toBeUndefined()
	expect(captures.snapshot().frames.map((frame) => frame.imageId)).toEqual([previewed.at(-1)!])
})

test('stopping a loop during its delay ends it at once with the frames taken', async () => {
	const { id, cameraId, captures, session, ended } = await setup()

	await captures.start(id, cameraId, request({ exposureMode: 'loop', delay: 30 }))
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

	await captures.start(id, cameraId, capture)
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

	expect((await captures.start(id, cameraId, request({ output: { mode: 'preview-only', format: 'FITS' }, snoop: { mount: ids('mount'), focuser: ids('focuser'), wheel: ids('wheel'), rotator: ids('rotator') } }))).status).toBe(202)
	await waitUntil(ended)
	expect(snoop).toHaveBeenLastCalledWith(camera, device('mount'), device('focuser'), device('wheel'), device('rotator'))

	expect((await captures.start(id, cameraId, request({ output: { mode: 'preview-only', format: 'FITS' }, snoop: { mount: 'unknown' } }))).status).toBe(202)
	await waitUntil(() => snoop.mock.calls.length === 2)
	expect(snoop).toHaveBeenLastCalledWith(camera, undefined, undefined, undefined, undefined)
	snoop.mockRestore()
})

test('a failed write fails the capture, marks the frame file as failed, and leaves no file', async () => {
	const { id, cameraId, captures, session, frames, ended } = await setup()
	const blocker = join(mkdtempSync(join(root, 'blocked-')), 'not-a-directory')
	writeFileSync(blocker, 'a file')

	await captures.start(id, cameraId, request({ exposureMode: 'loop', output: { mode: 'preview-save', directory: join(blocker, 'frames'), format: 'FITS' } }))
	await waitUntil(ended)

	expect(session()).toMatchObject({ phase: 'failed', reason: 'commandFailed', captured: 1, saved: 0 })
	await waitUntil(() => frames().some((frame) => frame.file === 'failed'))
	expect(frames().at(-1)).toMatchObject({ generation: 1, path: expect.stringContaining(join(blocker, 'frames')), file: 'failed' })
	expect(readdirSync(join(blocker, '..'))).toEqual(['not-a-directory'])
})

test('a busy camera refuses a second capture, and abort ends the first', async () => {
	const { id, cameraId, captures, session, ended } = await setup()

	expect((await captures.start(id, cameraId, request({ exposureTime: 30 }))).status).toBe(202)
	await waitUntil(() => session()?.phase === 'exposing')

	const second = await captures.start(id, cameraId, request())
	expect(second.status).toBe(409)
	expect(await second.json()).toEqual({ error: 'The camera is busy' })

	expect((await captures.abort(id, cameraId)).status).toBe(204)
	await waitUntil(ended)
	expect(session()).toMatchObject({ phase: 'aborted', reason: 'aborted', captured: 0 })
})

test('disconnecting the camera during the delay fails the capture', async () => {
	const { id, cameraId, client, manager, captures, session, ended } = await setup()

	await captures.start(id, cameraId, request({ exposureMode: 'loop', delay: 30 }))
	await waitUntil(() => session()?.phase === 'waiting')
	manager.devices.switch(client, cameraId, false)

	await waitUntil(ended, 3000)
	expect(session()).toMatchObject({ phase: 'failed', reason: 'disconnected', captured: 1 })
})

test('an unknown camera is not found', async () => {
	const { id, captures } = await setup()

	expect((await captures.start(id, 'missing', request())).status).toBe(404)
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

	await captures.start(id, cameraId, request())
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

// Writes an executable standing in for ASTAP's -extract that sleeps, then writes an empty star list next to
// the input (its second argument) and exits 0, or exits with exitCode without writing anything.
function fakeAstap(sleep: number, exitCode = 0) {
	const directory = mkdtempSync(join(root, 'astap-'))
	mkdirSync(directory, { recursive: true })

	if (process.platform === 'win32') {
		const path = join(directory, 'astap.cmd')
		writeFileSync(path, ['@echo off', ...(sleep > 0 ? [`ping -n ${sleep + 1} 127.0.0.1 >nul`] : []), ...(exitCode === 0 ? ['echo x,y,hfd,snr,flux> "%~dpn2.csv"'] : []), `exit /b ${exitCode}`].join('\r\n'))
		return path
	}

	const path = join(directory, 'astap')
	writeFileSync(path, ['#!/bin/sh', ...(sleep > 0 ? [`sleep ${sleep}`] : []), ...(exitCode === 0 ? ['echo x,y,hfd,snr,flux > "${2%.*}.csv"'] : []), `exit ${exitCode}`].join('\n'))
	chmodSync(path, 0o755)
	return path
}

// Saves the ASTAP settings of a store.
async function configureAstap(tools: ExternalToolsStore, executable: string) {
	const { revision } = await tools.get('astap')
	await tools.save('astap', { executable, timeout: 60000 }, revision)
}

const BUILTIN_ANALYSIS = { policy: 'everyFrame', request: { detector: DEFAULT_BUILTIN_SETTINGS, acceptance: DEFAULT_STAR_ACCEPTANCE } } as const
const ASTAP_REQUEST = { detector: DEFAULT_ASTAP_SETTINGS, acceptance: DEFAULT_STAR_ACCEPTANCE } as const

// Whether every frame of a session was accounted for by its analysis and none is pending.
function settled(session: CaptureSession | undefined) {
	const analysis = session?.analysis
	return !!analysis && analysis.pending === 0 && analysis.analyzed + analysis.failed + analysis.skipped === session.captured
}

test('a capture without analysis publishes no analysis state', async () => {
	const { id, cameraId, captures, ended, session, starEvents } = await setup()
	await captures.start(id, cameraId, request())
	await waitUntil(ended)

	expect(session()?.analysis).toBeUndefined()
	expect(starEvents).toEqual([])
})

test('Every Frame analyzes each frame of a fixed capture in its own document', async () => {
	const { id, cameraId, captures, ended, session, frames, starEvents } = await setup()
	await captures.start(id, cameraId, request({ exposureMode: 'fixed', count: 3, output: { mode: 'preview-only', format: 'FITS' }, analysis: BUILTIN_ANALYSIS }))
	await waitUntil(() => ended() && settled(session()))

	expect(session()).toMatchObject({ phase: 'completed', captured: 3, analysis: { policy: 'everyFrame', provider: 'builtin', analyzed: 3, pending: 0, failed: 0, skipped: 0, waiting: false } })
	const analyzed = new Set(starEvents.filter((event) => event.job.state === 'completed').map((event) => event.job.imageId))
	expect(analyzed.size).toBe(3)
	expect(new Set(frames().map((frame) => frame.imageId))).toEqual(analyzed)
	expect(starEvents.filter((event) => event.job.state === 'completed').map((event) => (event.job.origin.kind === 'capture' ? event.job.origin.generation : 0))).toEqual([1, 2, 3])
})

test('Every Frame holds the next exposure while the analysis lags, without dropping or failing a frame', async () => {
	const { id, cameraId, captures, ended, session, events, tools } = await setup()
	await configureAstap(tools, fakeAstap(1))
	await captures.start(id, cameraId, request({ exposureMode: 'fixed', count: 4, analysis: { policy: 'everyFrame', request: ASTAP_REQUEST } }))
	await waitUntil(() => ended() && settled(session()), 30000)

	const phases = events.flatMap((event) => (event.type === 'capture:updated' ? [event.session.phase] : []))
	expect(phases).toContain('analysisWait')
	expect(session()).toMatchObject({ phase: 'completed', captured: 4, saved: 4, request: { delay: 0 }, analysis: { analyzed: 4, failed: 0, skipped: 0, waiting: false } })
}, 40000)

test('Latest Frame Only skips the frames still waiting and never holds the capture', async () => {
	const { id, cameraId, captures, ended, session, events, tools } = await setup()
	await configureAstap(tools, fakeAstap(1))
	await captures.start(id, cameraId, request({ exposureMode: 'fixed', count: 6, output: { mode: 'preview-only', format: 'FITS' }, analysis: { policy: 'latestFrame', request: ASTAP_REQUEST } }))
	await waitUntil(ended, 30000)

	expect(events.some((event) => event.type === 'capture:updated' && event.session.phase === 'analysisWait')).toBeFalse()
	await waitUntil(() => settled(session()), 30000)
	const analysis = session()!.analysis!
	expect(analysis.skipped).toBeGreaterThan(0)
	expect(analysis.failed).toBe(0)
	expect(analysis.analyzed).toBeGreaterThan(0)
}, 40000)

test('a capture analyzed with ASTAP refuses to start while ASTAP is not configured', async () => {
	const { id, cameraId, captures, operations } = await setup()
	const response = await captures.start(id, cameraId, request({ analysis: { policy: 'everyFrame', request: ASTAP_REQUEST } }))

	expect(response.status).toBe(422)
	expect(operations.running()).toEqual([])
})

test('failing analyses halt the analysis, never the capture', async () => {
	const { id, cameraId, captures, ended, session, tools } = await setup()
	await configureAstap(tools, fakeAstap(0, 1))
	await captures.start(id, cameraId, request({ exposureMode: 'fixed', count: 5, analysis: { policy: 'everyFrame', request: ASTAP_REQUEST } }))
	await waitUntil(() => ended() && session()?.analysis?.pending === 0, 30000)

	expect(session()).toMatchObject({ phase: 'completed', captured: 5, saved: 5, analysis: { analyzed: 0, failed: 3 } })
	expect(session()!.analysis!.halted).toContain('3 frames in a row')
}, 40000)

test('a stop while waiting for analysis capacity ends the capture and lets the accepted analyses finish', async () => {
	const { id, cameraId, captures, ended, session, tools } = await setup()
	await configureAstap(tools, fakeAstap(1))
	await captures.start(id, cameraId, request({ exposureMode: 'loop', analysis: { policy: 'everyFrame', request: ASTAP_REQUEST } }))
	await waitUntil(() => session()?.phase === 'analysisWait', 30000)

	expect(captures.stop(id, cameraId).status).toBe(204)
	await waitUntil(ended, 30000)
	expect(session()?.phase).toBe('stopped')
	await waitUntil(() => settled(session()), 30000)
	expect(session()!.analysis).toMatchObject({ failed: 0, skipped: 0, waiting: false })
	expect(session()!.analysis!.analyzed).toBe(session()!.captured)
}, 40000)

// Environment variable that makes a fake program exit at once, so settleProgram can probe it.
const PROBE = 'NEBULOSA_FAKE_PROBE'

// Waits until a freshly written fake program can be started: on Windows a scanner may still hold the new file.
async function settleProgram(path: string) {
	const deadline = performance.now() + 5000

	while (true) {
		try {
			await Bun.spawn([path], { env: { ...process.env, [PROBE]: '1' }, stdout: 'ignore', stderr: 'ignore' }).exited
			return
		} catch (error) {
			if (performance.now() >= deadline) throw error
			await Bun.sleep(20)
		}
	}
}

// Writes an executable standing in for an ASTAP solve of the 32×32 frames of request(): after sleep seconds it writes
// a solved .ini and a TAN WCS for the -o base (its second argument) and exits 0, or exits with exitCode without
// writing anything.
async function fakeAstapSolve(sleep: number, exitCode = 0) {
	const directory = mkdtempSync(join(root, 'astap-solve-'))
	const cards = ["CTYPE1  = 'RA---TAN'", "CTYPE2  = 'DEC--TAN'", 'CRPIX1  = 16.5', 'CRPIX2  = 16.5', 'CRVAL1  = 42', 'CRVAL2  = -17', 'CD1_1   = -0.0005', 'CD1_2   = 0', 'CD2_1   = 0', 'CD2_2   = 0.0005']
	const text = ['SIMPLE  = T', 'BITPIX  = 8', 'NAXIS   = 0', ...cards, 'END'].map((card) => card.padEnd(80)).join('')
	writeFileSync(join(directory, 'out.wcs'), text.padEnd(Math.ceil(text.length / 2880) * 2880))
	writeFileSync(join(directory, 'out.ini'), 'PLTSOLVD=T\n')

	if (process.platform === 'win32') {
		const path = join(directory, 'astap.cmd')
		const copies = exitCode === 0 ? [`copy /y "${join(directory, 'out.ini')}" "%~dpn2.ini" >nul`, `copy /y "${join(directory, 'out.wcs')}" "%~dpn2.wcs" >nul`] : []
		writeFileSync(path, ['@echo off', `if defined ${PROBE} exit /b 0`, ...(sleep > 0 ? [`ping -n ${sleep + 1} 127.0.0.1 >nul`] : []), ...copies, `exit /b ${exitCode}`].join('\r\n'))
		await settleProgram(path)
		return path
	}

	const path = join(directory, 'astap')
	const copies = exitCode === 0 ? [`cp '${join(directory, 'out.ini')}' "\${2%.*}.ini"`, `cp '${join(directory, 'out.wcs')}' "\${2%.*}.wcs"`] : []
	writeFileSync(path, ['#!/bin/sh', `[ -n "$${PROBE}" ] && exit 0`, ...(sleep > 0 ? [`sleep ${sleep}`] : []), ...copies, `exit ${exitCode}`].join('\n'))
	chmodSync(path, 0o755)
	await settleProgram(path)
	return path
}

// Whether a session ended, its last frame was decoded (so every frame it solves was submitted), and every plate solve
// it submitted ended.
function solvesSettled(session: CaptureSession | undefined, frames: readonly CaptureFrame[]) {
	const state = session?.plateSolving
	const ended = ['completed', 'stopped', 'aborted', 'failed'].includes(session?.phase ?? '')
	return !!state && ended && frames.some((frame) => frame.sessionId === session.sessionId && frame.generation === session.captured) && state.pending === 0 && !state.waiting
}

test('First Frame solves only the first frame, with its WCS bound to that frame', async () => {
	const { id, cameraId, captures, session, frames, tools, solveEvents } = await setup()
	await configureAstap(tools, await fakeAstapSolve(0))
	await captures.start(id, cameraId, request({ exposureMode: 'fixed', count: 3, output: { mode: 'preview-only', format: 'FITS' }, plateSolving: { policy: 'firstFrame', request: { provider: 'astap', strategy: 'blind' } } }))
	await waitUntil(() => solvesSettled(session(), frames()), 30000)

	expect(session()).toMatchObject({ phase: 'completed', captured: 3, plateSolving: { policy: 'firstFrame', provider: 'astap', requested: 1, solved: 1, noSolution: 0, failed: 0, pending: 0 } })
	const solved = solveEvents.filter((event) => event.job.state === 'completed').map((event) => event.job)
	expect(solved.map((job) => (job.origin.kind === 'capture' ? job.origin.generation : 0))).toEqual([1])
	expect(frames().find((frame) => frame.generation === 1)?.imageId).toBe(solved[0].imageId)
}, 40000)

test('Every N Frames solves frames 1, N + 1… holding the eligible exposures, never the delay', async () => {
	const { id, cameraId, captures, session, events, frames, tools, solveEvents } = await setup()
	await configureAstap(tools, await fakeAstapSolve(1))
	await captures.start(id, cameraId, request({ exposureMode: 'fixed', count: 5, plateSolving: { policy: 'everyNth', interval: 2, request: { provider: 'astap', strategy: 'blind' } } }))
	await waitUntil(() => solvesSettled(session(), frames()), 40000)

	expect(session()).toMatchObject({ phase: 'completed', captured: 5, saved: 5, request: { delay: 0 }, plateSolving: { interval: 2, requested: 3, solved: 3, failed: 0, skipped: 0 } })
	const generations = solveEvents.filter((event) => event.job.state === 'completed').map((event) => (event.job.origin.kind === 'capture' ? event.job.origin.generation : 0))
	expect(generations.toSorted((a, b) => a - b)).toEqual([1, 3, 5])
	expect(events.some((event) => event.type === 'capture:updated' && event.session.phase === 'analysisWait')).toBeTrue()
}, 50000)

test('Latest Frame Only never holds the capture and skips the frames still waiting', async () => {
	const { id, cameraId, captures, ended, session, events, frames, tools } = await setup()
	await configureAstap(tools, await fakeAstapSolve(1))
	await captures.start(id, cameraId, request({ exposureMode: 'fixed', count: 6, output: { mode: 'preview-only', format: 'FITS' }, plateSolving: { policy: 'latestFrame', request: { provider: 'astap', strategy: 'blind' } } }))
	await waitUntil(ended, 30000)

	expect(events.some((event) => event.type === 'capture:updated' && event.session.phase === 'analysisWait')).toBeFalse()
	await waitUntil(() => solvesSettled(session(), frames()), 30000)
	const state = session()!.plateSolving!
	expect(state.solved).toBeGreaterThan(0)
	expect(state.skipped).toBeGreaterThan(0)
	expect(state.failed).toBe(0)
}, 40000)

test('a plate solved capture refuses to start without its solver, or with nova on every Nth frame', async () => {
	const { id, cameraId, captures, operations } = await setup()

	expect((await captures.start(id, cameraId, request({ plateSolving: { policy: 'firstFrame', request: { provider: 'astap', strategy: 'blind' } } }))).status).toBe(422)
	expect((await captures.start(id, cameraId, request({ plateSolving: { policy: 'everyNth', interval: 5, request: { provider: 'nova', strategy: 'blind' } } }))).status).toBe(422)
	expect(operations.running()).toEqual([])
})

test('failing plate solves halt the plate solving, never the capture', async () => {
	const { id, cameraId, captures, session, frames, tools } = await setup()
	await configureAstap(tools, await fakeAstapSolve(0, 16))
	await captures.start(id, cameraId, request({ exposureMode: 'fixed', count: 5, plateSolving: { policy: 'everyNth', interval: 1, request: { provider: 'astap', strategy: 'blind' } } }))
	await waitUntil(() => solvesSettled(session(), frames()), 30000)

	expect(session()).toMatchObject({ phase: 'completed', captured: 5, saved: 5, plateSolving: { solved: 0, failed: 3 } })
	expect(session()!.plateSolving!.halted).toContain('3 frames in a row')
}, 40000)
