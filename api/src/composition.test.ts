import { afterAll, afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Device } from 'nebulosa/src/devices/indi/device'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { type AutoFocusRequest, AutoFocusSessions } from './autofocus'
import { CaptureFrameRegistry } from './captureframes'
import { CameraCaptures, type CaptureStartRequest } from './captures'
import { ConnectionManager } from './connection'
import { AppDatabase } from './database'
import { ExternalToolsStore } from './externaltools'
import { FocuserBacklashStore } from './focuserbacklash'
import { FocuserCommands } from './focusers'
import { ImageStore } from './images'
import { OperationRegistry, type ToolInvocation } from './operations'
import { DEFAULT_BUILTIN_SETTINGS, DEFAULT_STAR_ACCEPTANCE, StarDetectionService } from './stars'
import { WheelCommands } from './wheels'

// Tools composed by direct calls of their services under one reservation, as a caller inside the process (a future
// sequencer) would compose them. Test-only composition: no step, plan, or run exists outside these tests.

const SKIP = process.env.RUN_ALL_TESTS !== 'true'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-composition-'))
const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

async function waitUntil(condition: () => boolean, timeout = 30000) {
	const start = Date.now()
	while (!condition()) {
		if (Date.now() - start > timeout) throw new Error('timeout')
		await Bun.sleep(10)
	}
}

let tokens = 0

// The simulator connection with its camera, focuser, and filter wheel connected, and the services of the tools over it.
async function setup() {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const operations = new OperationRegistry(manager.devices, () => {})
	disposables.push(operations)
	const images = new ImageStore()
	const frames = new CaptureFrameRegistry(images, () => {}, { database: AppDatabase.memory() })
	disposables.push(frames)
	const resolve = (connectionId: string) => manager.client(connectionId)
	const captures = new CameraCaptures(manager.devices, resolve, operations, images, frames, () => {}, mkdtempSync(join(root, 'captures-')))
	disposables.push(captures)
	const focusers = new FocuserCommands(manager.devices, resolve, operations, new FocuserBacklashStore(AppDatabase.memory()))
	disposables.push(focusers)
	const wheels = new WheelCommands(manager.devices, resolve, operations)
	disposables.push(wheels)
	const stars = new StarDetectionService(images, new ExternalToolsStore(AppDatabase.memory()), () => {})
	const autoFocus = new AutoFocusSessions(manager.devices, resolve, operations, captures.capturer, focusers.mover, images, frames, stars, () => {}, mkdtempSync(join(root, 'auxiliary-')))

	const devices = manager.devices.list(client)
	const cameraId = devices.find((device) => device.type === 'camera')!.id
	const focuserId = devices.find((device) => device.type === 'focuser')!.id
	const wheelId = devices.find((device) => device.type === 'wheel')!.id
	for (const deviceId of [cameraId, focuserId, wheelId]) manager.devices.switch(client, deviceId, true)
	const camera = manager.devices.camera(client, cameraId)!
	const focuser = manager.devices.device(client, 'focuser', focuserId)!
	const wheel = manager.devices.device(client, 'wheel', wheelId)!
	await waitUntil(() => camera.connected && camera.frame.width.max > 0 && focuser.connected && wheel.connected && wheel.count > 0 && [camera, focuser, wheel].every((device) => operations.available(device)))

	return { manager, client, id, operations, captures, focusers, wheels, autoFocus, camera, cameraId, focuser, focuserId, wheel, wheelId }
}

type Setup = Awaited<ReturnType<typeof setup>>

// Reserves devices for the caller composing the tools; returns the owner and the invocation the tools run under.
function reserve({ operations }: Setup, ...devices: readonly Device[]) {
	const owner = { id: `composition-${tokens++}`, kind: 'test' }
	const reserved = operations.arbiter.reserve(
		owner,
		devices.map((device) => ({ key: resourceKey(device), device })),
	)
	if (!reserved.ok) throw new Error('the devices could not be reserved')
	disposables.push({ [Symbol.dispose]: () => reserved.reservation.release() })
	return { owner, reservation: reserved.reservation, invocation: { reservation: reserved.reservation } satisfies ToolInvocation }
}

// A small saved capture request, its frames written into directory.
function captureRequest(directory: string, patch: Partial<CaptureStartRequest> = {}): CaptureStartRequest {
	return { token: `token-${tokens++}`, exposureMode: 'single', count: 1, delay: 0, exposureTime: 0.05, frameType: 'LIGHT', gain: 0, offset: 0, binX: 1, binY: 1, subframe: true, x: 0, y: 0, width: 32, height: 32, frameFormat: '', output: { mode: 'preview-save', directory, format: 'FITS' }, ...patch }
}

// Captures one saved frame under an invocation and resolves its final session.
async function capture({ id, cameraId, captures }: Setup, invocation: ToolInvocation, directory: string) {
	const admitted = captures.admit(id, cameraId, captureRequest(directory), { invocation })
	if (!admitted.ok) throw new Error(admitted.error)
	return await admitted.ended
}

// Moves the wheel to a slot under an invocation and resolves the final record of the move.
async function select({ id, wheelId, wheels }: Setup, invocation: ToolInvocation, slot: number) {
	const admitted = wheels.admitMove(id, wheelId, { token: `token-${tokens++}`, slot }, invocation)
	if (!admitted.ok) throw new Error(admitted.error)
	return await admitted.admission.finished
}

test('capture, filter change, and capture compose under one reservation while manual commands stay refused', async () => {
	const context = await setup()
	const { id, cameraId, focuserId, wheelId, captures, focusers, wheels, operations, camera, focuser, wheel } = context
	const { owner, reservation, invocation } = reserve(context, camera, focuser, wheel)
	const directory = mkdtempSync(join(root, 'frames-'))
	const slot = (wheel.position + 1) % wheel.count

	expect(captures.start(id, cameraId, captureRequest(directory)).status).toBe(409)
	expect(wheels.move(id, wheelId, { token: `token-${tokens++}`, slot }).status).toBe(409)
	expect(focusers.moveTo(id, focuserId, { token: `token-${tokens++}`, position: 1000 }).status).toBe(409)

	expect(await capture(context, invocation, directory)).toMatchObject({ phase: 'completed', captured: 1, saved: 1 })
	expect(await select(context, invocation, slot)).toMatchObject({ kind: 'wheel.move', state: 'succeeded' })
	expect(wheel.position).toBe(slot)
	expect(await capture(context, invocation, directory)).toMatchObject({ phase: 'completed', captured: 1, saved: 1 })
	expect(readdirSync(directory)).toHaveLength(2)

	// Nothing of the work is left once the reservation is cancelled, and only then are the devices given up.
	await operations.coordinator.cancelByReservationOwner(owner)
	expect([camera, focuser, wheel].map((device) => operations.arbiter.availability(resourceKey(device)))).toEqual(['reserved', 'reserved', 'reserved'])
	reservation.release()
	expect([camera, focuser, wheel].every((device) => operations.available(device))).toBeTrue()
})

test('a device the reservation does not hold is refused to its tools', async () => {
	const context = await setup()
	const { id, cameraId, wheelId, captures, wheels, camera } = context
	const { invocation } = reserve(context, camera)

	expect(wheels.admitMove(id, wheelId, { token: `token-${tokens++}`, slot: 0 }, invocation)).toMatchObject({ ok: false, status: 409, code: 'busy' })
	const other = reserve(context)
	expect(captures.admit(id, cameraId, captureRequest(mkdtempSync(join(root, 'frames-'))), { invocation: other.invocation })).toMatchObject({ ok: false, status: 409, code: 'busy' })
	expect(captures.admit(id, cameraId, captureRequest(mkdtempSync(join(root, 'frames-'))), { invocation })).toMatchObject({ ok: true })
})

test('a disconnection during reserved work fails it, and nothing more is commanded', async () => {
	const context = await setup()
	const { id, cameraId, client, manager, captures, camera, operations } = context
	const { invocation } = reserve(context, camera)

	const admitted = captures.admit(id, cameraId, captureRequest(mkdtempSync(join(root, 'frames-')), { exposureMode: 'loop', exposureTime: 1 }), { invocation })
	if (!admitted.ok) throw new Error(admitted.error)
	await waitUntil(() => operations.arbiter.availability(resourceKey(camera)) === 'leased')
	manager.devices.switch(client, cameraId, false)

	expect(await admitted.ended).toMatchObject({ phase: 'failed', reason: 'disconnected' })
	expect(captures.admit(id, cameraId, captureRequest(mkdtempSync(join(root, 'frames-'))), { invocation })).toMatchObject({ ok: false, code: 'disconnected' })
})

test('stopping the server cancels the work of a reservation and resumes nothing', async () => {
	const context = await setup()
	const { id, cameraId, captures, camera, operations } = context
	const { invocation } = reserve(context, camera)

	const admitted = captures.admit(id, cameraId, captureRequest(mkdtempSync(join(root, 'frames-')), { exposureMode: 'loop', exposureTime: 1 }), { invocation })
	if (!admitted.ok) throw new Error(admitted.error)
	await waitUntil(() => operations.arbiter.availability(resourceKey(camera)) === 'leased')

	await operations.stop(10000)
	expect(await admitted.ended).toMatchObject({ phase: 'aborted', reason: 'aborted' })
	expect(operations.running()).toBeEmpty()
})

test.skipIf(SKIP)('capture, Auto Focus, filter change, and capture compose under one reservation', async () => {
	const context = await setup()
	const { id, cameraId, focuserId, autoFocus, operations, camera, focuser, wheel } = context
	const { owner, reservation, invocation } = reserve(context, camera, focuser, wheel)
	const directory = mkdtempSync(join(root, 'frames-'))
	const focus: AutoFocusRequest = {
		token: `token-${tokens++}`,
		focuser: { connectionId: id, deviceId: focuserId },
		capture: { exposureTime: 0.2, gain: 0, offset: 0, binX: 1, binY: 1, subframe: true, x: 0, y: 0, width: 512, height: 512, frameFormat: '' },
		detection: { detector: { ...DEFAULT_BUILTIN_SETTINGS, maxStars: 20, maximumRadius: 32 }, acceptance: DEFAULT_STAR_ACCEPTANCE },
		fittingMode: 'HYPERBOLIC',
		initialOffsetSteps: 4,
		stepSize: 3000,
		reversed: false,
		rmsdThreshold: 0,
		settleDelay: 0,
		measureTimeout: 30,
		restoreOnStop: false,
	}

	expect(await capture(context, invocation, directory)).toMatchObject({ phase: 'completed', saved: 1 })
	const focused = await autoFocus.admit(id, cameraId, focus, invocation)
	if (!focused.ok) throw new Error(focused.error)
	expect(await focused.ended).toMatchObject({ state: 'completed', verification: 'measured' })
	expect(await select(context, invocation, (wheel.position + 1) % wheel.count)).toMatchObject({ state: 'succeeded' })
	expect(await capture(context, invocation, directory)).toMatchObject({ phase: 'completed', saved: 1 })

	await operations.coordinator.cancelByReservationOwner(owner)
	reservation.release()
	expect([camera, focuser, wheel].every((device) => operations.available(device))).toBeTrue()
})
