import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { type PlateSolution, plateSolutionFrom } from 'nebulosa/src/astrometry/solvers/platesolver'
import { DEC_TAN, RA_TAN } from 'nebulosa/src/astrometry/wcs/fits.wcs'
import { MountCommander } from 'nebulosa/src/devices/commanders/mount'
import { isDeviceQuiescent } from 'nebulosa/src/devices/orchestration/device.lifecycle'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { arcsec, deg, hour, toDeg } from 'nebulosa/src/math/units/angle'
import { meter } from 'nebulosa/src/math/units/distance'
import { CaptureFrameRegistry } from './captureframes'
import { CameraCaptures } from './captures'
import { ConnectionManager } from './connection'
import { ImageStore } from './images'
import { type PointingModelEvent, PointingModels } from './mountpointing'
import type { PointingFitRequest, PointingFitResult } from './mountpointing.fit'
import { type MountPointingEvent, type MountPointingRequest, MountPointingSessions, type MountPointingSessionSummary, type MountPointingStartResponse } from './mountpointing.sessions'
import { PointingModelStore } from './mountpointing.store'
import { OperationRegistry } from './operations'
import type { PlateSolveOrigin, PlateSolvePreparation, PlateSolveRequest, PlateSolveResult } from './platesolving'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-pointing-test-'))
const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

async function waitUntil(condition: () => boolean, timeout = 60000) {
	const start = Date.now()

	while (!condition()) {
		if (Date.now() - start > timeout) throw new Error('timeout')
		await Bun.sleep(5)
	}
}

let tokens = 0

// A session over a few waypoints of tiny frames.
function request(mount: { connectionId: string; deviceId: string }, patch: Partial<MountPointingRequest> = {}): MountPointingRequest {
	return {
		token: `token-${tokens++}`,
		mount,
		capture: { exposureTime: 0.02, gain: 0, offset: 0, binX: 1, binY: 1, subframe: true, x: 0, y: 0, width: 64, height: 64, frameFormat: '' },
		solving: { provider: 'astap', strategy: 'assisted' },
		plan: { pattern: 'goldenSpiral', count: 6, minimumAltitude: deg(30), meridianAvoidance: 0 },
		settleDelay: 0,
		stopTracking: true,
		equatorialConfirmed: false,
		...patch,
	}
}

// Equatorial TAN solution of a 64×64 frame centered on (rightAscension, declination), radians.
function tanSolution(rightAscension: number, declination: number, scale = 1e-3): PlateSolution {
	const header: FitsHeader = { CTYPE1: RA_TAN, CTYPE2: DEC_TAN, RADESYS: 'ICRS', CRVAL1: toDeg(rightAscension), CRVAL2: toDeg(declination), CRPIX1: 32.5, CRPIX2: 32.5, CD1_1: -scale, CD1_2: 0, CD2_1: 0, CD2_2: scale, NAXIS1: 64, NAXIS2: 64 }
	return plateSolutionFrom(header)!
}

// Plate solver standing for ASTAP: solves a frame at the J2000 center the camera simulator stamps from the mount it snoops,
// plus a constant north offset that stands for the pointing error of the mount. Can leave frames without a solution,
// stall until it is aborted, or hand out another scale.
function fakeSolver(images: ImageStore) {
	const origins: PlateSolveOrigin[] = []
	const hints: PlateSolveRequest['hints'][] = []
	const control = { unsolved: 0, stall: false, scale: 1e-3 }

	const solver = {
		prepare: (solving: PlateSolveRequest) => Promise.resolve({ request: solving, tool: { executable: 'astap', timeout: 60000 } } as PlateSolvePreparation),
		solve: async (imageId: string, preparation: PlateSolvePreparation, signal?: AbortSignal, origin?: PlateSolveOrigin) => {
			if (origin) origins.push(origin)
			hints.push(preparation.request.hints)

			if (control.stall) {
				const { promise, reject } = Promise.withResolvers<PlateSolveResult>()
				signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
				return await promise
			}

			if (control.unsolved > 0) {
				control.unsolved--
				return { outcome: 'noSolution' } as PlateSolveResult
			}

			const { header } = images.metadata(imageId)!
			return { outcome: 'solved', solution: tanSolution(deg(header.RA as number), deg(header.DEC as number) + arcsec(90), control.scale) } as PlateSolveResult
		},
	}

	return { solver, origins, hints, control }
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
	const fits: PointingFitRequest[] = []
	const store = new PointingModelStore(mkdtempSync(join(root, 'models-')))
	const modelEvents: PointingModelEvent[] = []
	const fitter = {
		fit: (fit: PointingFitRequest) => {
			fits.push(fit)
			return Promise.resolve({ fitted: { strategy: 'hybrid', usable: true }, residuals: [], offline: { heldOutCount: 0, perSide: { EAST: 0, WEST: 0, NEITHER: 0 } }, gate: 'failed' } as unknown as PointingFitResult)
		},
	}
	const models = new PointingModels(store, fitter, (event) => modelEvents.push(event))
	const events: MountPointingEvent[] = []
	const auxiliaryDir = mkdtempSync(join(root, 'auxiliary-'))
	const sessions = new MountPointingSessions(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		commander,
		captures.capturer,
		images,
		frames,
		solving.solver,
		models,
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
	await waitUntil(() => camera.connected && camera.frame.width.max > 0 && mount.connected && mount.canGoTo && operations.available(camera) && operations.available(mount))

	expect(await commander.setGeographicCoordinate(operations.coordinator, mount, { latitude: deg(-22), longitude: deg(-45), elevation: meter(800) })).toMatchObject({ ok: true })
	expect(await commander.setTracking(operations.coordinator, mount, true)).toMatchObject({ ok: true })
	expect(await commander.setSlewRate(operations.coordinator, mount, mount.slewRates.at(-1)!.name)).toMatchObject({ ok: true })
	expect(await commander.sync(operations.coordinator, mount, { type: 'JNOW', JNOW: { x: hour(5), y: deg(-20) } })).toMatchObject({ ok: true })
	await waitUntil(() => mount.geographicCoordinate.latitude !== 0 && Math.abs(mount.equatorialCoordinate.declination - deg(-20)) < deg(0.1) && operations.available(mount))

	// Latest published summary.
	const summary = (): MountPointingSessionSummary | undefined => events.at(-1)?.session
	const released = () => operations.available(camera) && operations.available(mount)

	return { id, client, manager, operations, frames, commander, solving, sessions, store, models, modelEvents, fits, events, auxiliaryDir, camera, cameraId, mount, mountDevice: { connectionId: id, deviceId: mountId }, summary, released }
}

// Starts a session and returns its ids.
async function start(sessions: MountPointingSessions, connectionId: string, cameraId: string, body: MountPointingRequest) {
	const response = await sessions.start(connectionId, cameraId, body)
	expect(response.status).toBe(202)
	return (await response.json()) as MountPointingStartResponse
}

describe('mount pointing sessions', () => {
	test('visits every waypoint, saves commanded and solved positions, never syncs, and leaves nothing behind', async () => {
		const { id, cameraId, sessions, mountDevice, summary, store, solving, frames, released, auxiliaryDir, mount, events, commander } = await setup()
		const sync = spyOn(commander, 'sync')
		const { sessionId, modelId } = await start(sessions, id, cameraId, request(mountDevice))

		await waitUntil(() => summary()?.endedAt !== undefined)
		expect(summary()).toMatchObject({ state: 'completed', plannedCount: 6, acceptedCount: 6, rejectedCount: 0 })
		expect(sync).not.toHaveBeenCalled()

		const model = (await store.get(modelId))!
		expect(model.acquisition).toEqual({ sessionId, state: 'completed' })
		expect(model.plan.waypoints).toHaveLength(6)
		expect(model.samples).toHaveLength(6)
		expect(model.samples.filter((sample) => sample.role === 'heldOut').length).toBe(2)

		for (const sample of model.samples) {
			expect(sample.status).toBe('accepted')
			expect(sample.time).toBeGreaterThanOrEqual(sample.commandedAt)
			expect(sample.solved).toBeDefined()
			// The solved position is the mount plus 90″ north, in the frame of the model.
			expect(sample.solved!.declination - sample.command.declination).toBeGreaterThan(arcsec(60))
			expect(sample.solved!.declination - sample.command.declination).toBeLessThan(arcsec(120))
			expect(sample.pierSide).not.toBe('NEITHER')
		}

		expect(model.optics.scale).toBeCloseTo(deg(1e-3), 9)
		expect(solving.origins.every((origin) => origin.kind === 'mountPointing' && origin.sessionId === sessionId)).toBeTrue()
		expect(solving.hints.every((hints) => hints?.rightAscension !== undefined && hints.declination !== undefined)).toBeTrue()
		expect(frames.snapshot().sources[0].latestFrameId).toBe(`${sessionId}:6`)
		expect(released()).toBeTrue()
		expect(isDeviceQuiescent(mount)).toBeTrue()
		expect(readdirSync(auxiliaryDir)).toEqual([])
		expect(events.some(({ session }) => session.step === 'slewing')).toBeTrue()
		expect(events.some(({ session }) => session.step === 'solving')).toBeTrue()
	}, 120000)

	test('a run with enough samples is fitted by itself, keeping the withheld ones apart', async () => {
		const { id, cameraId, sessions, mountDevice, summary, fits } = await setup()
		await start(sessions, id, cameraId, request(mountDevice, { plan: { pattern: 'altAzGrid', count: 20, minimumAltitude: deg(30), meridianAvoidance: 0 } }))

		await waitUntil(() => summary()?.endedAt !== undefined, 120000)
		await waitUntil(() => fits.length === 1)
		expect(fits[0].strategy).toBe('auto')
		expect(fits[0].training.length + fits[0].heldOut.length).toBe(20)
		expect(fits[0].heldOut.length).toBeGreaterThanOrEqual(5)
	}, 180000)

	test('a repeated token answers the same session', async () => {
		const { id, cameraId, sessions, mountDevice, summary } = await setup()
		const body = request(mountDevice)
		const first = await start(sessions, id, cameraId, body)
		const second = await start(sessions, id, cameraId, body)
		expect(second).toEqual(first)
		await waitUntil(() => summary()?.endedAt !== undefined)
	}, 120000)

	test('a pause releases the devices, a resume is a new operation that finishes only what is missing', async () => {
		const { id, cameraId, sessions, mountDevice, summary, released, store, events, operations, camera } = await setup()
		const { sessionId, modelId, operationId } = await start(sessions, id, cameraId, request(mountDevice))

		await waitUntil(() => (summary()?.acceptedCount ?? 0) >= 2)
		expect(released()).toBeFalse()
		expect(operations.available(camera)).toBeFalse()

		expect(sessions.pause(sessionId).status).toBe(202)
		await waitUntil(() => summary()?.state === 'paused')
		await waitUntil(released)

		const accepted = summary()!.acceptedCount
		const samples = (await store.get(modelId))!.samples
		expect((await store.get(modelId))!.acquisition.state).toBe('paused')
		expect(samples).toHaveLength(accepted)

		const resumed = await sessions.resume(sessionId, { token: `token-${tokens++}` })
		expect(resumed.status).toBe(202)
		expect(((await resumed.json()) as MountPointingStartResponse).operationId).not.toBe(operationId)

		await waitUntil(() => summary()?.endedAt !== undefined)
		expect(summary()).toMatchObject({ state: 'completed', acceptedCount: 6 })

		const model = (await store.get(modelId))!
		expect(model.samples).toHaveLength(6)
		expect(new Set(model.samples.map((sample) => sample.waypoint)).size).toBe(6)
		expect(new Set(model.samples.map((sample) => sample.id)).size).toBe(6)
		expect(events.some(({ session }) => session.state === 'pausing')).toBeTrue()
	}, 120000)

	test('a stop ends the session where it stands and keeps its samples', async () => {
		const { id, cameraId, sessions, mountDevice, summary, store, released, mount } = await setup()
		const { sessionId, modelId } = await start(sessions, id, cameraId, request(mountDevice))

		await waitUntil(() => (summary()?.acceptedCount ?? 0) >= 1)
		expect(sessions.stop(sessionId).status).toBe(202)
		await waitUntil(() => summary()?.endedAt !== undefined)

		expect(summary()?.state).toBe('stopped')
		await waitUntil(released)
		expect(isDeviceQuiescent(mount)).toBeTrue()

		const model = (await store.get(modelId))!
		expect(model.acquisition.state).toBe('stopped')
		expect(model.samples.length).toBe(summary()!.acceptedCount)
		expect(sessions.resume(sessionId, { token: `token-${tokens++}` })).resolves.toMatchObject({ status: 404 })
	}, 120000)

	test('a stop during a stalled solve ends at once, and a paused session stops without an operation', async () => {
		const { id, cameraId, sessions, mountDevice, summary, solving } = await setup()
		solving.control.stall = true
		const { sessionId } = await start(sessions, id, cameraId, request(mountDevice))

		await waitUntil(() => summary()?.step === 'solving')
		expect(sessions.pause(sessionId).status).toBe(202)
		await waitUntil(() => summary()?.state === 'paused')

		expect(sessions.pause(sessionId).status).toBe(409)
		expect(sessions.stop(sessionId).status).toBe(202)
		await waitUntil(() => summary()?.endedAt !== undefined)
		expect(summary()?.state).toBe('stopped')
	}, 120000)

	test('a mount that cannot be confirmed stopped blocks the session, and a resume is refused', async () => {
		const { id, cameraId, sessions, mountDevice, summary, solving, mount, store } = await setup()
		solving.control.stall = true
		const { sessionId, modelId } = await start(sessions, id, cameraId, request(mountDevice))

		await waitUntil(() => summary()?.step === 'solving')
		mount.slewing = true
		expect(sessions.pause(sessionId).status).toBe(202)
		await waitUntil(() => summary()?.state === 'blocked')

		expect(summary()?.error).toContain('confirmed stopped')
		expect((await store.get(modelId))?.acquisition.state).toBe('paused')

		const refused = await sessions.resume(sessionId, { token: `token-${tokens++}` })
		expect(refused.status).toBe(409)
		expect(((await refused.json()) as { code: string }).code).toBe('blocked')

		mount.slewing = false
		expect(sessions.stop(sessionId).status).toBe(202)
		await waitUntil(() => summary()?.endedAt !== undefined)
		expect(summary()?.state).toBe('stopped')
	}, 120000)

	test('a frame without a solution is exposed again without another slew', async () => {
		const { id, cameraId, sessions, mountDevice, summary, solving, store } = await setup()
		solving.control.unsolved = 1
		const { modelId } = await start(sessions, id, cameraId, request(mountDevice))

		await waitUntil(() => summary()?.endedAt !== undefined)
		expect(summary()).toMatchObject({ state: 'completed', acceptedCount: 6, skippedCount: 0, frameCount: 7 })
		expect((await store.get(modelId))!.samples).toHaveLength(6)
	}, 120000)

	test('a waypoint that never solves is skipped with its reason, and too many in a row pause the session', async () => {
		const { id, cameraId, sessions, mountDevice, summary, solving, store, released } = await setup()
		solving.control.unsolved = 1000
		const { modelId } = await start(sessions, id, cameraId, request(mountDevice))

		await waitUntil(() => summary()?.state === 'paused')
		expect(summary()).toMatchObject({ reason: 'commandFailed', skippedCount: 5, acceptedCount: 0 })
		await waitUntil(released)

		const model = (await store.get(modelId))!
		expect(model.samples).toHaveLength(5)
		expect(model.samples.every((sample) => sample.status === 'rejected' && sample.reason === 'No plate solution' && sample.solved === undefined)).toBeTrue()
	}, 120000)

	test('a solution with another scale is kept as rejected and stays out of the fit', async () => {
		const { id, cameraId, sessions, mountDevice, summary, solving, store } = await setup()
		const { modelId } = await start(sessions, id, cameraId, request(mountDevice))

		await waitUntil(() => (summary()?.acceptedCount ?? 0) >= 3)
		solving.control.scale = 2e-3
		await waitUntil(() => summary()?.endedAt !== undefined || summary()?.state === 'paused')

		const rejected = (await store.get(modelId))!.samples.filter((sample) => sample.status === 'rejected')
		expect(rejected.length).toBeGreaterThan(0)
		expect(rejected[0].reason).toBe('The image scale differs from the session')
		expect(rejected[0].solved).toBeDefined()
	}, 120000)

	test('an Equipment Control stop pauses the session with a warning instead of failing it', async () => {
		const { id, cameraId, sessions, mountDevice, summary, operations, mount, released } = await setup()
		await start(sessions, id, cameraId, request(mountDevice))

		await waitUntil(() => (summary()?.acceptedCount ?? 0) >= 1)
		const { operationId } = summary()!
		expect(operations.running().some((operation) => operation.operationId === operationId)).toBeTrue()
		await operations.coordinator.cancelByDevice(resourceKey(mount))

		await waitUntil(() => summary()?.state === 'paused')
		await waitUntil(released)
		expect(summary()?.warnings.at(-1)).toContain('from outside')
	}, 120000)

	test('a session is refused while the camera has one that did not end, and a model it holds cannot be removed', async () => {
		const { id, cameraId, sessions, mountDevice, summary, models } = await setup()
		const { sessionId, modelId } = await start(sessions, id, cameraId, request(mountDevice))
		await waitUntil(() => (summary()?.acceptedCount ?? 0) >= 1)

		sessions.pause(sessionId)
		await waitUntil(() => summary()?.state === 'paused')

		expect((await sessions.start(id, cameraId, request(mountDevice))).status).toBe(409)
		expect((await models.remove(modelId)).status).toBe(409)

		sessions.stop(sessionId)
		await waitUntil(() => summary()?.endedAt !== undefined)
		expect((await models.remove(modelId)).status).toBe(204)
	}, 120000)

	test('a new session continues a model that was interrupted, with what it misses only', async () => {
		const { id, cameraId, sessions, mountDevice, summary, store } = await setup()
		const first = await start(sessions, id, cameraId, request(mountDevice))
		await waitUntil(() => (summary()?.acceptedCount ?? 0) >= 2)

		sessions.stop(first.sessionId)
		await waitUntil(() => summary()?.endedAt !== undefined)
		const taken = (await store.get(first.modelId))!.samples.length

		const second = await start(sessions, id, cameraId, request(mountDevice, { modelId: first.modelId }))
		expect(second.modelId).toBe(first.modelId)
		await waitUntil(() => summary()?.sessionId === second.sessionId && summary()?.endedAt !== undefined)

		const model = (await store.get(first.modelId))!
		expect(summary()).toMatchObject({ acceptedCount: 6 })
		expect(model.samples).toHaveLength(6)
		expect(model.samples.filter((sample) => sample.sessionId === second.sessionId)).toHaveLength(6 - taken)
	}, 120000)

	test('a model of another mount cannot be continued, and an unknown one is 404', async () => {
		const { id, cameraId, sessions, mountDevice, store, summary } = await setup()
		const { modelId } = await start(sessions, id, cameraId, request(mountDevice))
		await waitUntil(() => summary()?.endedAt !== undefined)

		await store.update(modelId, (model) => ({ ...model, mount: { ...model.mount, hardwareId: 'other' } }))
		expect((await sessions.start(id, cameraId, request(mountDevice, { modelId }))).status).toBe(409)
		expect((await sessions.start(id, cameraId, request(mountDevice, { modelId: 'nothing' }))).status).toBe(404)
	}, 120000)

	test('a mount that does not report its type needs the confirmation of the operator, and an alt-az one is refused', async () => {
		const { id, cameraId, sessions, mountDevice, mount, summary } = await setup()
		expect(mount.mountType).toBe('EQ_GEM')

		mount.mountType = 'UNKNOWN'
		const refused = await sessions.start(id, cameraId, request(mountDevice))
		expect(refused.status).toBe(422)
		expect(((await refused.json()) as { error: string }).error).toContain('confirm')

		mount.mountType = 'ALTAZ'
		expect((await sessions.start(id, cameraId, request(mountDevice, { equatorialConfirmed: true }))).status).toBe(422)

		mount.mountType = 'UNKNOWN'
		await start(sessions, id, cameraId, request(mountDevice, { equatorialConfirmed: true }))
		await waitUntil(() => summary()?.endedAt !== undefined)
	}, 120000)

	test('a parked mount and a mount without a site are refused', async () => {
		const { id, cameraId, sessions, mountDevice, mount } = await setup()

		mount.parked = true
		expect((await sessions.start(id, cameraId, request(mountDevice))).status).toBe(422)
		mount.parked = false

		mount.geographicCoordinate.latitude = 0
		mount.geographicCoordinate.longitude = 0
		expect((await sessions.start(id, cameraId, request(mountDevice))).status).toBe(422)
	}, 60000)

	test('a preview commands nothing and answers the plan of the site of the mount', async () => {
		const { sessions, mountDevice, mount, released, events } = await setup()
		const before = { ...mount.equatorialCoordinate }

		const response = sessions.preview({ mount: mountDevice, plan: { pattern: 'altAzGrid', count: 12, minimumAltitude: deg(30), meridianAvoidance: deg(5) } })
		expect(response.status).toBe(200)

		const plan = (await response.json()) as { waypoints: unknown[]; heldOutCount: number }
		expect(plan.waypoints).toHaveLength(12)
		expect(plan.heldOutCount).toBe(4)
		expect(mount.equatorialCoordinate).toEqual(before)
		expect(released()).toBeTrue()
		expect(events).toEqual([])
	}, 60000)
})
