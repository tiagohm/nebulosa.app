import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { type PlateSolution, plateSolutionFrom } from 'nebulosa/src/astrometry/solvers/platesolver'
import { DEC_TAN, RA_TAN } from 'nebulosa/src/astrometry/wcs/fits.wcs'
import { MountCommander } from 'nebulosa/src/devices/commanders/mount'
import { isDeviceQuiescent } from 'nebulosa/src/devices/orchestration/device.lifecycle'
import { failedOperationResult, type OperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { deg, hour, toDeg } from 'nebulosa/src/math/units/angle'
import { meter } from 'nebulosa/src/math/units/distance'
import { CaptureFrameRegistry } from './captureframes'
import { CameraCaptures, type CaptureRequest } from './captures'
import { ConnectionManager } from './connection'
import { ImageStore } from './images'
import { OperationRegistry } from './operations'
import type { PlateSolveOrigin, PlateSolvePreparation, PlateSolveRequest, PlateSolveResult } from './platesolving'
import { type TppaEvent, type TppaRequest, type TppaSession, TppaSessions } from './tppa'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-tppa-test-'))
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

// A TPPA request rotating west at 4°/s (SPEED_4 of the simulator) with tiny frames, with fields replaced.
function request(mount: { connectionId: string; deviceId: string }, patch: Partial<TppaRequest> = {}): TppaRequest {
	return {
		token: `token-${tokens++}`,
		mount,
		capture: { exposureTime: 0.05, gain: 0, offset: 0, binX: 1, binY: 1, subframe: true, x: 0, y: 0, width: 64, height: 64, frameFormat: '' },
		solving: { provider: 'astap', strategy: 'assisted' },
		direction: 'WEST',
		slewRate: 'SPEED_4',
		rotation: deg(8),
		settleDelay: 0,
		refinementDelay: 0.2,
		...patch,
	}
}

// Equatorial TAN solution of a 64×64 frame centered on (rightAscension, declination), radians.
function tanSolution(rightAscension: number, declination: number): PlateSolution {
	const header: FitsHeader = { CTYPE1: RA_TAN, CTYPE2: DEC_TAN, RADESYS: 'ICRS', CRVAL1: toDeg(rightAscension), CRVAL2: toDeg(declination), CRPIX1: 32.5, CRPIX2: 32.5, CD1_1: -1e-3, CD1_2: 0, CD2_1: 0, CD2_2: 1e-3, NAXIS1: 64, NAXIS2: 64 }
	return plateSolutionFrom(header)!
}

// Plate solver standing for ASTAP: solves a frame at the J2000 center the camera simulator stamps from the mount it
// snoops (RA/DEC keywords, degrees); configured unless told otherwise.
function fakeSolver(images: ImageStore) {
	const origins: PlateSolveOrigin[] = []
	let configured = true

	const solver = {
		prepare: (solving: PlateSolveRequest) => Promise.resolve(configured ? { request: solving, tool: { executable: 'astap', timeout: 60000 } } : undefined),
		solve: (imageId: string, _preparation: PlateSolvePreparation, _signal?: AbortSignal, origin?: PlateSolveOrigin) => {
			if (origin) origins.push(origin)
			const { header } = images.metadata(imageId)!
			const solution = tanSolution(deg(header.RA as number), deg(header.DEC as number))
			return Promise.resolve({ outcome: 'solved', solution } as PlateSolveResult)
		},
	}

	return { solver, origins, unconfigure: () => (configured = false) }
}

// A small preview-only capture request.
function captureRequest(): CaptureRequest {
	return { exposureMode: 'single', count: 1, delay: 0, exposureTime: 0.05, frameType: 'LIGHT', gain: 0, offset: 0, binX: 1, binY: 1, subframe: true, x: 0, y: 0, width: 32, height: 32, frameFormat: '', output: { mode: 'preview-only', format: 'FITS' } }
}

async function setup() {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const operations = new OperationRegistry(manager.devices, () => {})
	disposables.push(operations)
	const images = new ImageStore()
	const frames = new CaptureFrameRegistry(images, () => {}, { file: join(mkdtempSync(join(root, 'frames-')), 'capture-frames.json') })
	disposables.push(frames)
	const captures = new CameraCaptures(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		images,
		frames,
		() => {},
		mkdtempSync(join(root, 'captures-')),
	)
	disposables.push(captures)
	const commander = new MountCommander(manager.devices.mounts)
	disposables.push(commander)
	const solving = fakeSolver(images)
	const events: TppaEvent[] = []
	const auxiliaryDir = mkdtempSync(join(root, 'auxiliary-'))
	const tppa = new TppaSessions(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		commander,
		captures.capturer,
		images,
		frames,
		solving.solver,
		(event) => events.push(event),
		auxiliaryDir,
	)

	const devices = manager.devices.list(client)
	const cameraId = devices.find((device) => device.type === 'camera')!.id
	const mountId = devices.find((device) => device.type === 'mount')!.id
	manager.devices.switch(client, cameraId, true)
	manager.devices.switch(client, mountId, true)
	const camera = manager.devices.camera(client, cameraId)!
	const mount = manager.devices.mount(client, mountId)!
	await waitUntil(() => camera.connected && camera.frame.width.max > 0 && mount.connected && mount.canMoveWE && operations.available(camera) && operations.available(mount))

	expect(await commander.setGeographicCoordinate(operations.coordinator, mount, { latitude: deg(-22), longitude: deg(-45), elevation: meter(800) })).toMatchObject({ ok: true })
	expect(await commander.setTracking(operations.coordinator, mount, true)).toMatchObject({ ok: true })
	expect(await commander.setSlewRate(operations.coordinator, mount, 'SPEED_2')).toMatchObject({ ok: true })
	// The simulator starts at the pole, where the alignment is refused; the poses are taken near the equator.
	expect(await commander.sync(operations.coordinator, mount, { type: 'JNOW', JNOW: { x: hour(5), y: deg(5) } })).toMatchObject({ ok: true })
	await waitUntil(() => mount.geographicCoordinate.latitude !== 0 && Math.abs(mount.equatorialCoordinate.declination - deg(5)) < deg(0.1) && operations.available(mount))

	// Latest published summary.
	const summary = () => events.at(-1)?.session
	const ended = () => summary()?.endedAt !== undefined
	// Complete record of a session.
	const session = async (sessionId: string) => (await tppa.session(sessionId).json()) as TppaSession
	// Whether the camera and the mount are free for a new operation.
	const released = () => operations.available(camera) && operations.available(mount)

	return { id, operations, images, frames, captures, commander, solving, tppa, events, auxiliaryDir, camera, cameraId, mount, mountDevice: { connectionId: id, deviceId: mountId }, summary, ended, session, released }
}

// Starts a session and returns its ids.
async function start(tppa: TppaSessions, connectionId: string, cameraId: string, body: TppaRequest) {
	const response = await tppa.start(connectionId, cameraId, body)
	expect(response.status).toBe(202)
	return (await response.json()) as { sessionId: string; operationId: string }
}

describe('TPPA sessions', () => {
	test('acquires three poses, refines, pauses, and restores the slew rate when stopped', async () => {
		const { id, cameraId, tppa, mountDevice, mount, frames, solving, summary, ended, session, released, auxiliaryDir } = await setup()
		const { sessionId } = await start(tppa, id, cameraId, request(mountDevice))

		await waitUntil(() => summary()?.state === 'readyToRefine' || ended(), 60000)
		expect(summary()).toMatchObject({ state: 'readyToRefine', pointCount: 3, previousSlewRate: 'SPEED_2', geometry: { acceptable: true } })
		expect(mount.slewRate).toBe('SPEED_4')
		expect(isDeviceQuiescent(mount)).toBeTrue()

		const record = await session(sessionId)
		expect(record.points.map((point) => point.point)).toEqual([1, 2, 3])
		expect(record.initialAlignment).toMatchObject({ stage: 'acquisition' })
		expect(record.overlay?.geometry).toBeDefined()
		expect(Math.abs(toDeg(record.geometry!.rotation13))).toBeGreaterThanOrEqual(12)
		expect(solving.origins.every((origin) => origin.kind === 'tppa' && origin.sessionId === sessionId)).toBeTrue()
		expect(frames.snapshot().sources[0].latestFrameId).toBe(`${sessionId}:${record.frameCount}`)

		// A refinement updates the estimate without commanding the mount.
		const slewRate = mount.slewRate
		expect(tppa.startRefinement(sessionId).status).toBe(204)
		await waitUntil(() => (summary()?.refinementCount ?? 0) >= 2, 30000)
		expect(summary()!.alignment!.stage).toBe('refinement')
		expect((await tppa.stopRefinement(sessionId)).status).toBe(204)
		await waitUntil(() => summary()?.state === 'refinementPaused')
		expect(released()).toBeFalse()
		expect(mount.slewRate).toBe(slewRate)

		expect((await tppa.stop(sessionId)).status).toBe(204)
		await waitUntil(() => summary()?.slewRateRestored !== undefined)
		expect(summary()).toMatchObject({ state: 'completed', slewRateRestored: true })
		expect(mount.slewRate).toBe('SPEED_2')
		expect(released()).toBeTrue()
		expect(readdirSync(auxiliaryDir)).toEqual([])
	}, 120000)

	test('a stop while moving cancels the session, stops the mount, and restores the slew rate', async () => {
		const { id, cameraId, tppa, mountDevice, mount, summary, released } = await setup()
		const { sessionId } = await start(tppa, id, cameraId, request(mountDevice, { slewRate: 'SPEED_1' }))

		await waitUntil(() => summary()?.state === 'moving', 30000)
		expect((await tppa.stop(sessionId)).status).toBe(204)
		await waitUntil(() => summary()?.slewRateRestored !== undefined)

		expect(summary()).toMatchObject({ state: 'cancelled', slewRateRestored: true })
		expect(isDeviceQuiescent(mount)).toBeTrue()
		expect(mount.slewRate).toBe('SPEED_2')
		expect(released()).toBeTrue()
		expect(tppa.startRefinement(sessionId).status).toBe(404)
	}, 60000)

	test('the camera and the mount are held for the whole session', async () => {
		const { id, cameraId, tppa, mountDevice, captures, summary, ended } = await setup()
		const { sessionId } = await start(tppa, id, cameraId, request(mountDevice))
		await waitUntil(() => summary()?.state === 'readyToRefine' || ended(), 60000)

		expect(captures.start(id, cameraId, captureRequest()).status).toBe(409)
		expect((await tppa.start(id, cameraId, request(mountDevice))).status).toBe(409)
		expect(tppa.startRefinement('unknown').status).toBe(404)
		expect((await tppa.stopRefinement(sessionId)).status).toBe(409)

		await tppa.stop(sessionId)
		await waitUntil(ended)
	}, 90000)

	test('a session cannot start on a mount another operation holds', async () => {
		const { id, cameraId, tppa, mountDevice, mount, operations, events } = await setup()
		const hold = operations.coordinator.start(
			'hold',
			[{ key: resourceKey(mount), device: mount }],
			(context) =>
				new Promise<OperationResult<void>>((resolve) => {
					context.signal.addEventListener('abort', () => resolve(failedOperationResult('aborted')), { once: true })
				}),
		)

		expect((await tppa.start(id, cameraId, request(mountDevice))).status).toBe(409)
		expect(events).toEqual([])
		await hold.cancel()
	}, 60000)

	test('a session starts the tracking of a mount that is not tracking, publishes the frame progress, and stops the tracking when it ends', async () => {
		const { id, cameraId, tppa, mountDevice, mount, commander, operations, events, summary, ended, released } = await setup()
		expect(await commander.setTracking(operations.coordinator, mount, false)).toMatchObject({ ok: true })
		const body = request(mountDevice)
		const { sessionId } = await start(tppa, id, cameraId, { ...body, capture: { ...body.capture, exposureTime: 1 } })

		await waitUntil(() => summary()?.state === 'readyToRefine' || ended(), 90000)
		expect(summary()).toMatchObject({ state: 'readyToRefine', trackingStarted: true })
		expect(summary()!.trackingStopped).toBeUndefined()
		expect(mount.tracking).toBeTrue()

		const reported = events.flatMap((event) => (event.session.exposure ? [{ state: event.session.state, ...event.session.exposure }] : []))
		expect(reported.length).toBeGreaterThan(0)
		expect(reported.every((progress) => progress.state === 'capturing' && progress.progress >= 0 && progress.progress <= 100)).toBeTrue()
		expect(events.filter((event) => event.session.state === 'solving').every((event) => event.session.exposure === undefined)).toBeTrue()

		expect((await tppa.stop(sessionId)).status).toBe(204)
		await waitUntil(() => summary()?.trackingStopped !== undefined)
		expect(summary()).toMatchObject({ state: 'completed', trackingStopped: true })
		expect(summary()!.exposure).toBeUndefined()
		expect(mount.tracking).toBeFalse()
		expect(released()).toBeTrue()
	}, 120000)

	test('a mount without the slew rate or a solver not configured is refused before anything starts', async () => {
		const { id, cameraId, tppa, mountDevice, solving, events } = await setup()

		expect((await tppa.start(id, cameraId, request(mountDevice, { slewRate: 'WARP' }))).status).toBe(422)
		solving.unconfigure()
		expect((await tppa.start(id, cameraId, request(mountDevice))).status).toBe(422)
		expect(events).toEqual([])
	}, 60000)

	test('a repeated token answers the session it started, and the snapshot has no poses', async () => {
		const { id, cameraId, tppa, mountDevice, ended, summary } = await setup()
		const body = request(mountDevice)
		const first = await start(tppa, id, cameraId, body)
		const second = await start(tppa, id, cameraId, body)

		expect(second).toEqual(first)
		expect(tppa.snapshot().sessions).toHaveLength(1)
		expect('points' in tppa.snapshot().sessions[0]).toBeFalse()
		expect(tppa.session('unknown').status).toBe(404)
		await tppa.stop(first.sessionId)
		await waitUntil(ended)
		expect(summary()!.revision).toBeGreaterThan(1)
	}, 60000)
})
