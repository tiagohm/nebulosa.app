import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { type PlateSolution, plateSolutionFrom } from 'nebulosa/src/astrometry/solvers/platesolver'
import { eraS2c } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { geodeticLocation } from 'nebulosa/src/astronomy/observer/location'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { MountCommander } from 'nebulosa/src/devices/commanders/mount'
import { isDeviceQuiescent } from 'nebulosa/src/devices/orchestration/device.lifecycle'
import { failedOperationResult, type OperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { matMulVec, matRodriguesRotation } from 'nebulosa/src/math/linear-algebra/mat3'
import { type Vec3, vecCross, vecDot, vecNormalize } from 'nebulosa/src/math/linear-algebra/vec3'
import { arcmin, arcsec, deg, hour, normalizePI, toDeg } from 'nebulosa/src/math/units/angle'
import { meter } from 'nebulosa/src/math/units/distance'
import { ipolarFrameContext, ipolarItrsToIcrs } from 'nebulosa/src/observation/alignment/ipolar.geometry'
import { CaptureFrameRegistry } from './captureframes'
import { CameraCaptures, type CaptureStartRequest } from './captures'
import { ConnectionManager } from './connection'
import { AppDatabase } from './database'
import { ImageStore } from './images'
import { type IPolarEvent, type IPolarRequest, type IPolarSession, IPolarSessions } from './ipolar'
import { OperationRegistry } from './operations'
import type { PlateSolveOrigin, PlateSolvePreparation, PlateSolveRequest, PlateSolveResult } from './platesolving'

const SKIP = process.env.RUN_ALL_TESTS !== 'true'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-ipolar-test-'))
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

const LATITUDE = deg(-22)
const LONGITUDE = deg(-45)
const SITE = { name: 'Home', latitude: LATITUDE, longitude: LONGITUDE, elevation: 800 }
const OBSERVER = { location: geodeticLocation(LONGITUDE, LATITUDE, meter(800)), refraction: false } as const
const EAST: Vec3 = [-Math.sin(LONGITUDE), Math.cos(LONGITUDE), 0]
const UP_TANGENT = vecCross([0, 0, -1], EAST)

let tokens = 0

// An iPolar request with tiny frames, with fields replaced.
function request(patch: Partial<IPolarRequest> = {}): IPolarRequest {
	return {
		token: `token-${tokens++}`,
		mode: 'manual',
		site: SITE,
		refraction: false,
		capture: { exposureTime: 0.05, gain: 0, offset: 0, binX: 1, binY: 1, subframe: true, x: 0, y: 0, width: 64, height: 64, frameFormat: '' },
		solving: { provider: 'astap', strategy: 'blind' },
		direction: 'WEST',
		rotation: deg(25),
		settleDelay: 0,
		refinementDelay: 0.1,
		completionThreshold: arcsec(30),
		...patch,
	}
}

// Camera rigid with a mechanical axis 10′ east of and 5′ above the south pole (ITRS −z); `rotation` turns it about the
// axis. Its plate solution is built from its attitude at the instant of the solve, so the toolkit sees a rigid rotation.
class Rig {
	readonly axis = vecNormalize([arcmin(10) * EAST[0] + arcmin(5) * UP_TANGENT[0], arcmin(10) * EAST[1] + arcmin(5) * UP_TANGENT[1], -1 + arcmin(10) * EAST[2] + arcmin(5) * UP_TANGENT[2]])
	readonly forward = matMulVec(matRodriguesRotation(EAST, deg(1)), this.axis)
	rotation = 0

	solution(): PlateSolution {
		const context = ipolarFrameContext(timeUnix(Date.now() / 1000), OBSERVER)
		const turn = matRodriguesRotation(this.axis, this.rotation)
		const f = matMulVec(turn, this.forward)
		const r = vecNormalize(matMulVec(turn, vecCross(this.forward, [0, 0, 1])))
		const d = vecCross(f, r)
		const step = arcsec(30)
		const sky = (u: number, v: number) => eraS2c(...ipolarItrsToIcrs(vecNormalize([f[0] + u * r[0] + v * d[0], f[1] + u * r[1] + v * d[1], f[2] + u * r[2] + v * d[2]]), context))
		const center = sky(0, 0)
		const e = vecNormalize(vecCross([0, 0, 1], center))
		const n = vecCross(center, e)
		const [x, y] = [sky(step, 0), sky(0, step)]
		const [ra, dec] = ipolarItrsToIcrs(f, context)
		return plateSolutionFrom({
			NAXIS1: 64,
			NAXIS2: 64,
			CTYPE1: 'RA---TAN',
			CTYPE2: 'DEC--TAN',
			RADESYS: 'ICRS',
			CRPIX1: 32.5,
			CRPIX2: 32.5,
			CRVAL1: toDeg(ra),
			CRVAL2: toDeg(dec),
			CD1_1: toDeg(vecDot(x, e) / vecDot(x, center)),
			CD1_2: toDeg(vecDot(y, e) / vecDot(y, center)),
			CD2_1: toDeg(vecDot(x, n) / vecDot(x, center)),
			CD2_2: toDeg(vecDot(y, n) / vecDot(y, center)),
		})!
	}
}

// Plate solver standing for ASTAP over the rig; configured unless told otherwise.
function fakeSolver(rig: Rig) {
	const origins: PlateSolveOrigin[] = []
	let configured = true

	const solver = {
		prepare: (solving: PlateSolveRequest) => Promise.resolve(configured ? { request: solving, tool: { executable: 'astap', timeout: 60000 } } : undefined),
		solve: (_imageId: string, _preparation: PlateSolvePreparation, _signal?: AbortSignal, origin?: PlateSolveOrigin) => {
			if (origin) origins.push(origin)
			return Promise.resolve({ outcome: 'solved', solution: rig.solution() } as PlateSolveResult)
		},
	}

	return { solver, origins, unconfigure: () => (configured = false) }
}

// A small preview-only capture request.
function captureRequest(): CaptureStartRequest {
	return { token: Bun.randomUUIDv7(), exposureMode: 'single', count: 1, delay: 0, exposureTime: 0.05, frameType: 'LIGHT', gain: 0, offset: 0, binX: 1, binY: 1, subframe: true, x: 0, y: 0, width: 32, height: 32, frameFormat: '', output: { mode: 'preview-only', format: 'FITS' } }
}

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
	const rig = new Rig()
	const solving = fakeSolver(rig)
	const events: IPolarEvent[] = []
	const auxiliaryDir = mkdtempSync(join(root, 'auxiliary-'))
	const ipolar = new IPolarSessions(
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
	expect(await commander.setGeographicCoordinate(operations.coordinator, mount, { latitude: LATITUDE, longitude: LONGITUDE, elevation: meter(800) })).toMatchObject({ ok: true })
	expect(await commander.setSlewRate(operations.coordinator, mount, 'SPEED_2')).toMatchObject({ ok: true })
	// The simulator moves to the pole of the new site; a fixed pointing near the south pole keeps the declination still.
	expect(await commander.sync(operations.coordinator, mount, { type: 'JNOW', JNOW: { x: hour(5), y: deg(-85) } })).toMatchObject({ ok: true })
	await waitUntil(() => mount.geographicCoordinate.latitude !== 0 && Math.abs(mount.equatorialCoordinate.declination - deg(-85)) < deg(0.1) && operations.available(mount))

	// Latest published summary.
	const summary = () => events.at(-1)?.session
	const ended = () => summary()?.endedAt !== undefined
	// Complete record of a session.
	const session = async (sessionId: string) => (await ipolar.session(sessionId).json()) as IPolarSession

	return { id, operations, frames, captures, commander, rig, solving, ipolar, events, auxiliaryDir, camera, cameraId, mount, mountDevice: { connectionId: id, deviceId: mountId }, summary, ended, session }
}

// Starts a session and returns its ids.
async function start(ipolar: IPolarSessions, connectionId: string, cameraId: string, body: IPolarRequest) {
	const response = await ipolar.start(connectionId, cameraId, body)
	expect(response.status).toBe(202)
	return (await response.json()) as { sessionId: string; operationId: string }
}

describe('iPolar sessions', () => {
	test('calibrates a camera alone by hand, refines, pauses, and finishes', async () => {
		const { id, cameraId, ipolar, rig, mount, operations, frames, solving, summary, session, auxiliaryDir, camera } = await setup()
		const slewRate = mount.slewRate
		const { sessionId } = await start(ipolar, id, cameraId, request())

		await waitUntil(() => summary()?.state === 'waitingForRotation')
		expect(summary()).toMatchObject({ frameCount: 1, current: false })
		expect(summary()!.mount).toBeUndefined()
		// Only the camera is held: the mount stays free for anything else.
		expect(operations.available(camera)).toBeFalse()
		expect(operations.available(mount)).toBeTrue()
		expect(ipolar.startRefinement(sessionId).status).toBe(409)
		expect((await ipolar.finish(sessionId)).status).toBe(409)

		rig.rotation = deg(30)
		expect(ipolar.confirmRotation(sessionId).status).toBe(204)
		await waitUntil(() => summary()?.state === 'readyToRefine' || summary()?.endedAt !== undefined)
		expect(summary()).toMatchObject({ state: 'readyToRefine', frameCount: 2, attemptCount: 1, current: true, calibration: { verified: false, preferred: true } })
		expect(toDeg(summary()!.calibration!.rotation)).toBeCloseTo(30, 0)
		expect(Math.abs(summary()!.measurement!.azimuthError - arcmin(10))).toBeLessThan(arcsec(5))
		expect(Math.abs(summary()!.measurement!.altitudeError - arcmin(5))).toBeLessThan(arcsec(5))
		expect(ipolar.confirmRotation(sessionId).status).toBe(409)

		const record = await session(sessionId)
		expect(record.poses.map((pose) => pose.pose)).toEqual([1, 2])
		expect(record.overlay).toMatchObject({ frame: 2, imageId: record.poses[1].imageId })
		expect(solving.origins.map((origin) => origin.kind === 'ipolar' && origin.step)).toEqual(['reference', 'second'])
		expect(frames.snapshot().sources[0].latestFrameId).toBe(`${sessionId}:2`)

		expect(ipolar.startRefinement(sessionId).status).toBe(204)
		await waitUntil(() => (summary()?.refinementCount ?? 0) >= 2, 30000)
		expect(summary()).toMatchObject({ state: 'refining', current: true })
		expect((await ipolar.stopRefinement(sessionId)).status).toBe(204)
		await waitUntil(() => summary()?.state === 'refinementPaused')
		expect(operations.available(camera)).toBeFalse()

		expect((await ipolar.finish(sessionId)).status).toBe(204)
		await waitUntil(() => summary()?.endedAt !== undefined)
		expect(summary()).toMatchObject({ state: 'completed' })
		expect(summary()!.slewRateRestored).toBeUndefined()
		expect(mount.slewRate).toBe(slewRate)
		expect(operations.available(camera)).toBeTrue()
		expect(readdirSync(auxiliaryDir)).toEqual([])
		expect(ipolar.confirmRotation(sessionId).status).toBe(404)
	})

	test('a manual session with the mount of the setup holds and watches it without commanding it', async () => {
		const { id, cameraId, ipolar, rig, mount, mountDevice, operations, captures, summary, ended } = await setup()
		const slewRate = mount.slewRate
		const { sessionId } = await start(ipolar, id, cameraId, request({ mount: mountDevice }))
		await waitUntil(() => summary()?.state === 'waitingForRotation')

		expect(summary()).toMatchObject({ mount: mountDevice, mountName: mount.name })
		expect(operations.available(mount)).toBeFalse()
		expect(captures.start(id, cameraId, captureRequest()).status).toBe(409)
		expect((await ipolar.start(id, cameraId, request())).status).toBe(409)

		rig.rotation = deg(-25)
		ipolar.confirmRotation(sessionId)
		await waitUntil(() => summary()?.state === 'readyToRefine' || ended())
		expect(summary()).toMatchObject({ state: 'readyToRefine', calibration: { verified: true } })
		expect(mount.slewRate).toBe(slewRate)
		expect(isDeviceQuiescent(mount)).toBeTrue()

		expect((await ipolar.stop(sessionId)).status).toBe(204)
		await waitUntil(ended)
		expect(summary()).toMatchObject({ state: 'cancelled' })
		expect(operations.available(mount)).toBeTrue()
	})

	test('too little rotation keeps the first frame and asks again', async () => {
		const { id, cameraId, ipolar, rig, summary, session, ended } = await setup()
		const { sessionId } = await start(ipolar, id, cameraId, request())
		await waitUntil(() => summary()?.state === 'waitingForRotation')

		rig.rotation = deg(3)
		ipolar.confirmRotation(sessionId)
		await waitUntil(() => summary()?.attemptCount === 1 && summary()?.state === 'waitingForRotation')
		expect((await session(sessionId)).attempts).toMatchObject([{ frame: 2, reason: 'insufficientRotation', retry: true }])

		rig.rotation = deg(28)
		ipolar.confirmRotation(sessionId)
		await waitUntil(() => summary()?.state === 'readyToRefine' || ended())
		expect(summary()).toMatchObject({ state: 'readyToRefine', attemptCount: 2, frameCount: 3 })
		expect((await session(sessionId)).poses.map((pose) => pose.frame)).toEqual([1, 3])
		await ipolar.stop(sessionId)
		await waitUntil(ended)
	})

	test('a stop while waiting for the operator cancels the session', async () => {
		const { id, cameraId, ipolar, summary, ended, operations, camera } = await setup()
		const { sessionId } = await start(ipolar, id, cameraId, request())
		await waitUntil(() => summary()?.state === 'waitingForRotation')

		expect((await ipolar.stop(sessionId)).status).toBe(204)
		await waitUntil(ended)
		expect(summary()).toMatchObject({ state: 'cancelled', frameCount: 1 })
		expect(operations.available(camera)).toBeTrue()
		expect((await ipolar.stop(sessionId)).status).toBe(404)
	})

	test('an automatic rotation is refused without the mount or its preset, and without a solver', async () => {
		const { id, cameraId, ipolar, mountDevice, solving, events } = await setup()

		expect((await ipolar.start(id, cameraId, request({ mode: 'automatic', slewRate: 'SPEED_4' }))).status).toBe(422)
		expect((await ipolar.start(id, cameraId, request({ mode: 'automatic', mount: mountDevice, slewRate: 'WARP' }))).status).toBe(422)
		expect((await ipolar.start(id, cameraId, request({ mount: { connectionId: id, deviceId: 'unknown' } }))).status).toBe(404)
		solving.unconfigure()
		expect((await ipolar.start(id, cameraId, request())).status).toBe(422)
		expect(events).toEqual([])
	})

	test('a session cannot start on a mount another operation holds', async () => {
		const { id, cameraId, ipolar, mountDevice, mount, operations, events } = await setup()
		const hold = operations.coordinator.start(
			'hold',
			[{ key: resourceKey(mount), device: mount }],
			(context) =>
				new Promise<OperationResult<void>>((resolve) => {
					context.signal.addEventListener('abort', () => resolve(failedOperationResult('aborted')), { once: true })
				}),
		)

		expect((await ipolar.start(id, cameraId, request({ mount: mountDevice }))).status).toBe(409)
		expect(events).toEqual([])
		await hold.cancel()
	})

	test('a repeated token answers the session it started, even while the first request is prepared', async () => {
		const { id, cameraId, ipolar, ended } = await setup()
		const body = request()
		const [first, second] = await Promise.all([ipolar.start(id, cameraId, body), ipolar.start(id, cameraId, body)])

		expect([first.status, second.status]).toEqual([202, 202])
		const started = (await first.json()) as { sessionId: string }
		expect(await second.json()).toEqual(started as never)
		expect(ipolar.snapshot().sessions).toHaveLength(1)
		expect('poses' in ipolar.snapshot().sessions[0]).toBeFalse()
		expect(ipolar.session('unknown').status).toBe(404)
		await ipolar.stop(started.sessionId)
		await waitUntil(ended)
	})

	test.skipIf(SKIP)('an automatic rotation turns the mount until the measured rotation is enough and restores its slew rate', async () => {
		const { id, cameraId, ipolar, rig, mount, mountDevice, summary, ended } = await setup()
		// The camera turns with the mount: the rig follows the change of the reported right ascension.
		const start0 = mount.equatorialCoordinate.rightAscension
		const follow = setInterval(() => (rig.rotation = -normalizePI(mount.equatorialCoordinate.rightAscension - start0)), 5)
		try {
			const { sessionId } = await start(ipolar, id, cameraId, request({ mode: 'automatic', mount: mountDevice, slewRate: 'SPEED_4', rotation: deg(20) }))
			await waitUntil(() => summary()?.state === 'readyToRefine' || ended(), 90000)
			expect(summary()).toMatchObject({ state: 'readyToRefine', previousSlewRate: 'SPEED_2' })
			expect(toDeg(summary()!.calibration!.rotation)).toBeGreaterThanOrEqual(10)
			expect(isDeviceQuiescent(mount)).toBeTrue()
			expect((await ipolar.stop(sessionId)).status).toBe(204)
			await waitUntil(() => summary()?.slewRateRestored !== undefined)
			expect(summary()).toMatchObject({ state: 'cancelled', slewRateRestored: true })
			expect(mount.slewRate).toBe('SPEED_2')
		} finally {
			clearInterval(follow)
		}
	})
})
