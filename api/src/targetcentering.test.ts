import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { type PlateSolution, plateSolutionFrom } from 'nebulosa/src/astrometry/solvers/platesolver'
import { DEC_TAN, RA_TAN } from 'nebulosa/src/astrometry/wcs/fits.wcs'
import { equatorialToJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { geodeticLocation, localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { isDeviceQuiescent } from 'nebulosa/src/devices/orchestration/device.lifecycle'
import { failedOperationResult, type OperationResult, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { arcmin, arcsec, deg, hour, normalizeAngle, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { meter } from 'nebulosa/src/math/units/distance'
import { applyPointingOffset } from 'nebulosa/src/observation/mount/pointing'
import { CaptureFrameRegistry } from './captureframes'
import { CameraCaptures } from './captures'
import { ConnectionManager } from './connection'
import type { GuidingRestoration, GuidingSessionSummary, GuidingSuspension } from './guiding'
import { ImageStore } from './images'
import type { MountCorrectionPlan, MountCorrections } from './mountpointing.corrections'
import { MountCommands } from './mounts'
import { OperationRegistry } from './operations'
import { type PlateSolveOrigin, type PlateSolvePreparation, type PlateSolveRequest, type PlateSolveResult, PlateSolvingError } from './platesolving'
import { type TargetCenteringEvent, type TargetCenteringRequest, type TargetCenteringSession, TargetCenteringSessions, type TargetCenteringSessionSummary, type TargetCenteringStartResponse } from './targetcentering'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-centering-test-'))
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

// Equatorial TAN solution of a 64×64 frame centered on (rightAscension, declination), radians.
function tanSolution(rightAscension: number, declination: number): PlateSolution {
	const header: FitsHeader = { CTYPE1: RA_TAN, CTYPE2: DEC_TAN, RADESYS: 'ICRS', CRVAL1: toDeg(normalizeAngle(rightAscension)), CRVAL2: toDeg(declination), CRPIX1: 32.5, CRPIX2: 32.5, CD1_1: -1e-3, CD1_2: 0, CD2_1: 0, CD2_2: 1e-3, NAXIS1: 64, NAXIS2: 64 }
	return plateSolutionFrom(header)!
}

// Plate solver standing for ASTAP: solves a frame at the J2000 center the camera simulator stamps from the mount it snoops,
// plus an east and north offset that stands for the pointing error of the mount. Can leave frames without a solution, throw,
// or stall until it is aborted.
function fakeSolver(images: ImageStore) {
	const origins: PlateSolveOrigin[] = []
	const requests: PlateSolveRequest[] = []
	const control = { unsolved: 0, stall: false, error: undefined as Error | undefined, dx: arcmin(5), dy: arcmin(-3), configured: true, onSolve: undefined as VoidFunction | undefined }

	const solver = {
		prepare: (solving: PlateSolveRequest) => Promise.resolve(control.configured ? { request: solving, tool: { executable: 'astap', timeout: 60000 } } : undefined),
		solve: async (imageId: string, preparation: PlateSolvePreparation, signal?: AbortSignal, origin?: PlateSolveOrigin) => {
			if (origin) origins.push(origin)
			requests.push(preparation.request)
			control.onSolve?.()

			if (control.stall) {
				const { promise, reject } = Promise.withResolvers<PlateSolveResult>()
				signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
				return await promise
			}

			if (control.error) throw control.error

			if (control.unsolved > 0) {
				control.unsolved--
				return { outcome: 'noSolution' } as PlateSolveResult
			}

			const { header } = images.metadata(imageId)!
			const { rightAscension, declination } = applyPointingOffset(deg(header.RA as number), deg(header.DEC as number), control.dx, control.dy)
			return { outcome: 'solved', solution: tanSolution(rightAscension, declination) } as PlateSolveResult
		},
	}

	return { solver, origins, requests, control }
}

async function setup(corrections?: Pick<MountCorrections, 'plan' | 'suspend' | 'observed'>) {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const devices = manager.devices.list(client)
	const cameraId = devices.find((device) => device.type === 'camera')!.id
	const mountId = devices.find((device) => device.type === 'mount')!.id
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
	const mounts = new MountCommands(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		() => Promise.reject(new Error('no locator')),
		operations,
		() => {},
		undefined,
		corrections,
	)
	disposables.push(mounts)
	const { commander } = mounts
	const solving = fakeSolver(images)
	const calls: string[] = []
	const guiding = {
		runs: [] as GuidingSessionSummary[],
		holds: 0,
		released: 0,
		suspend: successfulOperationResult({ sessionId: 'g1', commandId: 'stop', settle: { pixels: 1, time: 1, timeout: 1 } }) as OperationResult<GuidingSuspension>,
		restoration: 'restored' as GuidingRestoration,
		restoring: undefined as Promise<void> | undefined,
		signal: undefined as AbortSignal | undefined,
		calls,
		runsOn: () => guiding.runs,
		hold: () => {
			guiding.holds++
			return { [Symbol.dispose]: () => void guiding.released++ }
		},
		suspendForMotion: () => {
			calls.push(`suspend:${manager.devices.mount(client, mountId)!.slewing}`)
			return Promise.resolve(guiding.suspend)
		},
		restoreAfterMotion: async (_: GuidingSuspension, signal: AbortSignal) => {
			calls.push(`restore:${operations.available(manager.devices.mount(client, mountId)!)}:${guiding.released === guiding.holds}`)
			guiding.signal = signal
			await guiding.restoring
			return guiding.restoration
		},
	}
	const events: TargetCenteringEvent[] = []
	const auxiliaryDir = mkdtempSync(join(root, 'auxiliary-'))
	const sessions = new TargetCenteringSessions(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		mounts,
		commander,
		captures.capturer,
		images,
		frames,
		solving.solver,
		guiding,
		(event) => events.push(event),
		auxiliaryDir,
	)

	manager.devices.switch(client, cameraId, true)
	manager.devices.switch(client, mountId, true)
	const camera = manager.devices.camera(client, cameraId)!
	const mount = manager.devices.mount(client, mountId)!
	await waitUntil(() => camera.connected && camera.frame.width.max > 0 && mount.connected && mount.canGoTo && operations.available(camera) && operations.available(mount))

	expect(await commander.setGeographicCoordinate(operations.coordinator, mount, { latitude: deg(-22), longitude: deg(-45), elevation: meter(800) })).toMatchObject({ ok: true })
	expect(await commander.setTracking(operations.coordinator, mount, true)).toMatchObject({ ok: true })
	expect(await commander.setSlewRate(operations.coordinator, mount, mount.slewRates.at(-1)!.name)).toMatchObject({ ok: true })

	// Points the mount high in the sky of its site now, so every target near it is above the horizon.
	await zenith(commander, operations, mount)
	await waitUntil(() => mount.geographicCoordinate.latitude !== 0 && Math.abs(mount.equatorialCoordinate.declination - deg(-20)) < deg(0.1) && operations.available(mount))

	// J2000 position the mount reports, offset by a sky distance east, in radians.
	const offsetTarget = (east: number) => {
		const [rightAscension, declination] = equatorialToJ2000(mount.equatorialCoordinate.rightAscension, mount.equatorialCoordinate.declination, timeUnix(Date.now() / 1000))
		const target = applyPointingOffset(rightAscension, declination, east, 0)
		return { frame: 'J2000' as const, ...target }
	}

	// A session over tiny frames.
	const request = (patch: Partial<TargetCenteringRequest> = {}): TargetCenteringRequest => ({
		token: `token-${tokens++}`,
		mount: { connectionId: id, deviceId: mountId },
		mode: 'center',
		target: offsetTarget(deg(1)),
		capture: { exposureTime: 0.02, gain: 0, offset: 0, binX: 1, binY: 1, subframe: true, x: 0, y: 0, width: 64, height: 64, frameFormat: '' },
		solving: { provider: 'astap', strategy: 'assisted' },
		tolerance: arcsec(30),
		maximumCorrections: 4,
		noSolutionRetries: 1,
		maximumFrames: 10,
		settleDelay: 0,
		maximumCorrection: deg(1),
		blindRetry: false,
		guiding: 'coordinate',
		...patch,
	})

	const start = async (body: TargetCenteringRequest) => {
		const response = await sessions.start(id, cameraId, body)
		expect(response.status).toBe(202)
		return (await response.json()) as TargetCenteringStartResponse
	}

	// Latest published summary.
	const summary = (): TargetCenteringSessionSummary => events.at(-1)!.session
	const ended = () => waitUntil(() => events.at(-1)?.session.endedAt !== undefined)
	const released = () => operations.available(camera) && operations.available(mount)

	return { id, operations, frames, commander, mounts, solving, guiding, sessions, events, auxiliaryDir, camera, cameraId, mount, mountId, offsetTarget, request, start, summary, ended, released }
}

// Sends a mount to declination -20° at the sidereal meridian of its site.
async function zenith(commander: MountCommands['commander'], operations: OperationRegistry, mount: Parameters<MountCommands['commander']['sync']>[1]) {
	const lst = localSiderealTime(timeUnix(Date.now() / 1000, true), geodeticLocation(deg(-45), deg(-22), 0))
	expect(await commander.sync(operations.coordinator, mount, { type: 'JNOW', JNOW: { x: normalizeAngle(lst + hour(0.5)), y: deg(-20) } })).toMatchObject({ ok: true })
}

describe('target centering sessions', () => {
	test('center slews once, corrects from what it measured, and verifies with a frame after the last motion', async () => {
		const { start, request, ended, summary, solving, released, frames, auxiliaryDir, mount, commander, guiding, events } = await setup()
		const sync = spyOn(commander, 'sync')
		const goTo = spyOn(commander, 'goTo')
		const { sessionId } = await start(request())

		await ended()
		const session = summary()
		expect(session).toMatchObject({ state: 'completed', positionVerified: true, readyForImaging: true })
		expect(session.finalSeparation).toBeLessThan(arcsec(30))
		expect(session.attempts.at(-1)?.outcome).toBe('solved')
		expect(session.attempts.at(-1)?.correction).toBeUndefined()
		expect(session.attempts[0].correction).toBeDefined()
		expect(session.attempts[0].separation).toBeGreaterThan(arcmin(4))
		expect(goTo).toHaveBeenCalledTimes(session.attempts.length)
		expect(sync).not.toHaveBeenCalled()
		expect(solving.origins.every((origin) => origin.kind === 'targetCentering' && origin.sessionId === sessionId)).toBeTrue()
		expect(solving.requests.every(({ hints }) => hints?.rightAscension !== undefined)).toBeTrue()
		expect(frames.snapshot().sources[0].latestFrameId).toBe(`${sessionId}:${session.attempts.length}`)
		expect(released()).toBeTrue()
		expect(isDeviceQuiescent(mount)).toBeTrue()
		expect(readdirSync(auxiliaryDir)).toEqual([])
		expect(events.some((event) => event.session.step === 'slewing')).toBeTrue()
		expect(events.some((event) => event.session.step === 'correcting')).toBeTrue()
		expect(guiding.released).toBe(guiding.holds)
	})

	test('the complete record carries the solutions the events leave out', async () => {
		const { start, request, ended, sessions, summary } = await setup()
		const { sessionId } = await start(request())
		await ended()

		expect(JSON.stringify(summary())).not.toContain('CRVAL1')
		const record = (await sessions.session(sessionId).json()) as TargetCenteringSession
		expect(Object.keys(record.solutions)).toHaveLength(summary().attempts.length)
		expect(sessions.session('unknown').status).toBe(404)
	})

	test('verify only never commands the mount, however far it finds the target', async () => {
		const { start, request, ended, summary, commander, offsetTarget, released, mounts } = await setup()
		const goTo = spyOn(commander, 'goTo')
		const sync = spyOn(commander, 'sync')
		const tracking = spyOn(commander, 'setTracking')
		const within = spyOn(mounts, 'goToWithin')
		await start(request({ mode: 'verifyOnly', target: offsetTarget(deg(5)) }))

		await ended()
		expect(summary()).toMatchObject({ state: 'completed', positionVerified: false, readyForImaging: false })
		expect(summary().finalSeparation).toBeGreaterThan(deg(4))
		expect(summary().attempts).toHaveLength(1)
		for (const command of [goTo, sync, tracking, within]) expect(command).not.toHaveBeenCalled()
		expect(released()).toBeTrue()
	})

	test('verify only inside the tolerance verifies the position without moving', async () => {
		const { start, request, ended, summary, solving, offsetTarget, commander } = await setup()
		const goTo = spyOn(commander, 'goTo')
		solving.control.dx = 0
		solving.control.dy = 0
		await start(request({ mode: 'verifyOnly', target: offsetTarget(arcsec(5)), tolerance: arcmin(5) }))

		await ended()
		expect(summary()).toMatchObject({ state: 'completed', positionVerified: true, readyForImaging: true })
		expect(goTo).not.toHaveBeenCalled()
	})

	test('recenter near its target measures first and only corrects', async () => {
		const { start, request, ended, summary, offsetTarget, mounts, solving } = await setup()
		const within = spyOn(mounts, 'goToWithin')
		await start(request({ mode: 'recenter', target: offsetTarget(arcmin(10)) }))

		await ended()
		expect(within).not.toHaveBeenCalled()
		expect(summary()).toMatchObject({ state: 'completed', positionVerified: true })
		expect(solving.requests[0].hints).toBeUndefined()
	})

	test('recenter far from its target slews like center', async () => {
		const { start, request, ended, summary, offsetTarget, mounts } = await setup()
		const within = spyOn(mounts, 'goToWithin')
		await start(request({ mode: 'recenter', target: offsetTarget(deg(2)) }))

		await ended()
		expect(within).toHaveBeenCalledTimes(1)
		expect(summary()).toMatchObject({ state: 'completed', positionVerified: true })
	})

	test('a repeated token answers its session and another one is refused while it runs', async () => {
		const { sessions, id, cameraId, request, solving, ended, summary } = await setup()
		solving.control.stall = true
		const body = request()
		const first = (await (await sessions.start(id, cameraId, body)).json()) as TargetCenteringStartResponse
		const repeated = (await (await sessions.start(id, cameraId, body)).json()) as TargetCenteringStartResponse
		expect(repeated).toEqual(first)

		const other = await sessions.start(id, cameraId, request())
		expect(other.status).toBe(409)

		await waitUntil(() => summary().step === 'solving')
		expect(sessions.stop(first.sessionId).status).toBe(202)
		await ended()
		expect(summary().state).toBe('cancelled')
	})

	test('stop during an exposure cancels and leaves the devices free, and repeating it is harmless', async () => {
		const { start, request, sessions, ended, summary, released, commander, mount } = await setup()
		const stopTracking = spyOn(commander, 'setTracking')
		const { sessionId } = await start(request({ capture: { ...request().capture, exposureTime: 30 } }))

		await waitUntil(() => summary().step === 'exposing')
		expect(sessions.stop(sessionId).status).toBe(202)
		expect(sessions.stop(sessionId).status).toBe(202)
		await ended()
		expect(summary()).toMatchObject({ state: 'cancelled', positionVerified: false, readyForImaging: false })
		expect(sessions.stop(sessionId).status).toBe(202)
		expect(released()).toBeTrue()
		expect(mount.tracking).toBeTrue()
		expect(stopTracking).not.toHaveBeenCalled()
	})

	test('a frame without a solution is exposed again without a motion, and the retries are bounded', async () => {
		const { start, request, ended, summary, solving, commander } = await setup()
		solving.control.unsolved = 2
		const goTo = spyOn(commander, 'goTo')
		await start(request())

		await ended()
		expect(summary()).toMatchObject({ state: 'failed', reason: 'commandFailed', positionVerified: false })
		expect(summary().attempts.map(({ outcome }) => outcome)).toEqual(['noSolution', 'noSolution'])
		expect(goTo).toHaveBeenCalledTimes(1)
	})

	test('a blind retry stays with the provider of the session', async () => {
		const { start, request, ended, summary, solving } = await setup()
		solving.control.unsolved = 1
		await start(request({ blindRetry: true, solving: { provider: 'astap', strategy: 'assisted' } }))

		await ended()
		expect(summary().state).toBe('completed')
		expect(solving.requests[1]).toMatchObject({ provider: 'astap', strategy: 'blind' })
		expect(solving.requests.slice(2).every(({ provider, strategy }) => provider === 'astap' && strategy === 'assisted')).toBeTrue()
	})

	test('a solver that fails is told apart from a frame without a solution', async () => {
		const { start, request, ended, summary, solving } = await setup()
		solving.control.error = new PlateSolvingError('invalidSolution', 'The solution is not usable')
		await start(request())

		await ended()
		expect(summary().state).toBe('failed')
		expect(summary().attempts[0]).toMatchObject({ outcome: 'invalid', error: 'The solution is not usable' })
		expect(summary().warnings).toHaveLength(2)
	})

	test('a correction over the maximum ends the session without moving', async () => {
		const { start, request, ended, summary, solving, commander } = await setup()
		solving.control.dx = deg(3)
		const goTo = spyOn(commander, 'goTo')
		await start(request())

		await ended()
		expect(summary()).toMatchObject({ state: 'failed', refusal: 'tooLarge', positionVerified: false })
		expect(goTo).toHaveBeenCalledTimes(1)
	})

	test('a correction below the horizon ends the session without moving', async () => {
		const { start, request, ended, summary, commander, mounts } = await setup()
		const goTo = spyOn(commander, 'goTo')
		const refusal = spyOn(mounts, 'refusal')
		refusal
			.mockImplementationOnce(() => undefined)
			.mockImplementationOnce(() => undefined)
			.mockImplementation(() => ['The target is below the horizon or is not a valid coordinate', 422, 'invalidParameter'])
		await start(request())

		await ended()
		expect(summary()).toMatchObject({ state: 'failed', refusal: 'belowHorizon' })
		expect(goTo).toHaveBeenCalledTimes(1)
	})

	test('a pier side change between corrections ends the session', async () => {
		const { start, request, ended, summary, mount, solving, commander } = await setup()
		const goTo = spyOn(commander, 'goTo')
		solving.control.onSolve = () => Object.assign(mount, { pierSide: mount.pierSide === 'EAST' ? 'WEST' : 'EAST' })
		await start(request())

		await ended()
		expect(summary()).toMatchObject({ state: 'failed', refusal: 'pierSide' })
		expect(goTo).toHaveBeenCalledTimes(1)
	})

	test('a target below the horizon is refused before anything starts', async () => {
		const { sessions, id, cameraId, request, offsetTarget, events } = await setup()
		const { rightAscension, declination } = offsetTarget(0)
		const response = await sessions.start(id, cameraId, request({ target: { frame: 'J2000', rightAscension: normalizeAngle(rightAscension + Math.PI), declination: -declination } }))

		expect(response.status).toBe(422)
		expect(((await response.json()) as { code: string }).code).toBe('invalidParameter')
		expect(events).toBeEmpty()
	})

	test('a plate solver that is not configured is refused', async () => {
		const { sessions, id, cameraId, request, solving } = await setup()
		solving.control.configured = false
		expect((await sessions.start(id, cameraId, request())).status).toBe(422)
	})

	const GUIDING = { sessionId: 'g1', state: 'guiding' } as GuidingSessionSummary

	test('guiding that may pulse the mount refuses a session asked not to touch it, and a measurement, which moves nothing', async () => {
		const { sessions, id, cameraId, request, guiding } = await setup()
		guiding.runs = [GUIDING]

		for (const body of [request({ guiding: 'requireIdle' }), request({ mode: 'verifyOnly' })]) {
			const response = await sessions.start(id, cameraId, body)
			expect(response.status).toBe(409)
			expect(((await response.json()) as { code: string }).code).toBe('guidingActive')
		}

		expect(guiding.holds).toBe(0)
		expect(guiding.calls).toBeEmpty()
	})

	test('guiding its owner paused, or that is calibrating, is never taken over', async () => {
		const { sessions, id, cameraId, request, guiding } = await setup()

		for (const state of ['paused', 'calibrating'] as const) {
			guiding.runs = [{ ...GUIDING, state }]
			expect((await sessions.start(id, cameraId, request())).status).toBe(409)
		}

		expect(guiding.calls).toBeEmpty()
	})

	test('guiding is stopped before the motion and restored after the mount was released', async () => {
		const { start, request, ended, summary, guiding, events } = await setup()
		guiding.runs = [GUIDING]
		await start(request())

		await ended()
		expect(guiding.calls).toEqual(['suspend:false', 'restore:true:true'])
		expect(summary()).toMatchObject({ state: 'completed', positionVerified: true, readyForImaging: true, guidingRestoration: 'restored' })
		const steps = events.map((event) => event.session.step)
		expect(steps.indexOf('stoppingGuiding')).toBeLessThan(steps.indexOf('slewing'))
		expect(steps.lastIndexOf('restoringGuiding')).toBeGreaterThan(steps.lastIndexOf('solving'))
	})

	test('a position verified with guiding that did not come back is not ready for imaging', async () => {
		for (const restoration of ['failed', 'externallyChanged'] as const) {
			const { start, request, ended, summary, guiding } = await setup()
			guiding.runs = [GUIDING]
			guiding.restoration = restoration
			await start(request())

			await ended()
			expect(summary()).toMatchObject({ state: 'completed', positionVerified: true, readyForImaging: false, guidingRestoration: restoration })
			expect(summary().warnings).toHaveLength(1)
		}
	})

	test('guiding that does not stop ends the session before the mount is taken', async () => {
		const { start, request, ended, summary, guiding, commander } = await setup()
		const goTo = spyOn(commander, 'goTo')
		guiding.runs = [GUIDING]
		guiding.suspend = failedOperationResult('unexpectedState', 'The guide output was not released')
		await start(request())

		await ended()
		expect(summary()).toMatchObject({ state: 'failed', error: 'The guide output was not released', guidingRestoration: 'notNeeded' })
		expect(goTo).not.toHaveBeenCalled()
		expect(guiding.calls).toEqual(['suspend:false'])
	})

	test('guiding it stopped is restored after a failure and a stop too', async () => {
		const { start, request, ended, summary, guiding, solving, sessions } = await setup()
		guiding.runs = [GUIDING]
		solving.control.stall = true
		const { sessionId } = await start(request())

		await waitUntil(() => summary().step === 'solving')
		sessions.stop(sessionId)
		await ended()
		expect(summary()).toMatchObject({ state: 'cancelled', guidingRestoration: 'restored', readyForImaging: false })
		expect(guiding.calls.at(-1)).toStartWith('restore:')
	})

	test('a stop during the restoration ends it, with guiding told apart', async () => {
		const { start, request, ended, summary, guiding, sessions } = await setup()
		guiding.runs = [GUIDING]
		const { promise, resolve } = Promise.withResolvers<void>()
		guiding.restoring = promise
		guiding.restoration = 'failed'
		const { sessionId } = await start(request())

		await waitUntil(() => summary().step === 'restoringGuiding')
		guiding.signal!.addEventListener('abort', () => resolve(), { once: true })
		await waitUntil(() => guiding.signal !== undefined)
		sessions.stop(sessionId)
		await ended()
		expect(guiding.signal!.aborted).toBeTrue()
		expect(summary()).toMatchObject({ positionVerified: true, readyForImaging: false, guidingRestoration: 'failed' })
	})

	test('a blocked mount leaves guiding off', async () => {
		const { start, request, summary, commander, mount, guiding } = await setup()
		guiding.runs = [GUIDING]
		spyOn(commander, 'goTo').mockImplementation(() => {
			Object.assign(mount, { slewing: true })
			return Promise.resolve(failedOperationResult('timeout', 'the mount did not stop'))
		})
		await start(request())

		await waitUntil(() => summary().state === 'blocked')
		expect(summary().guidingRestoration).toBe('failed')
		expect(guiding.calls).toEqual(['suspend:false'])
		Object.assign(mount, { slewing: false })
	})

	test('the guide outputs stay held until the operation ends', async () => {
		const { start, request, ended, guiding, solving, sessions, summary } = await setup()
		solving.control.stall = true
		const { sessionId } = await start(request())

		await waitUntil(() => summary().step === 'solving')
		expect(guiding.holds).toBe(1)
		expect(guiding.released).toBe(0)
		sessions.stop(sessionId)
		await ended()
		expect(guiding.released).toBe(1)
	})

	test('an active model corrects the first slew once and never a correction', async () => {
		const planned: MountCorrectionPlan[] = []
		const plans: unknown[] = []
		const { start, request, ended, summary } = await setup({
			plan: (_, target) => {
				plans.push(target)
				const plan: MountCorrectionPlan = { status: 'corrected', target: target as never, options: { tolerance: 0 }, pierSide: 'WEST', modelId: 'model', revisionId: 'revision' }
				planned.push(plan)
				return plan
			},
			suspend: () => {},
			observed: () => {},
		})

		await start(request())
		await ended()
		expect(summary()).toMatchObject({ state: 'completed', model: { modelId: 'model', revisionId: 'revision' } })
		expect(summary().attempts.length).toBeGreaterThan(1)
		expect(plans).toHaveLength(1)
	})

	test('a target the model refuses moves nothing', async () => {
		const { start, request, ended, summary, commander } = await setup({ plan: () => ({ status: 'refused', error: 'The target is too far from the samples of the pointing model' }), suspend: () => {}, observed: () => {} })
		const goTo = spyOn(commander, 'goTo')
		await start(request())

		await ended()
		expect(summary()).toMatchObject({ state: 'failed', refusal: 'correctionRefused', error: 'The target is too far from the samples of the pointing model' })
		expect(summary().attempts).toBeEmpty()
		expect(goTo).not.toHaveBeenCalled()
	})

	test('a slew that fails with the mount still moving leaves the session blocked until it is dismissed', async () => {
		const { start, request, summary, commander, mount, sessions, released, events } = await setup()
		spyOn(commander, 'goTo').mockImplementation(() => {
			Object.assign(mount, { slewing: true })
			return Promise.resolve(failedOperationResult('timeout', 'the mount did not stop'))
		})
		const { sessionId } = await start(request())

		await waitUntil(() => summary().state === 'blocked')
		expect(summary()).toMatchObject({ reason: 'timeout', positionVerified: false })
		expect(summary().endedAt).toBeUndefined()
		expect(summary().error).toContain('could not be confirmed stopped')

		Object.assign(mount, { slewing: false })
		await waitUntil(released)
		expect(sessions.stop(sessionId).status).toBe(202)
		expect(summary()).toMatchObject({ state: 'cancelled' })
		expect(events.at(-1)?.session.endedAt).toBeDefined()
	})

	test('tracking the session started stays on after success and stops after a failure', async () => {
		const { start, request, ended, summary, commander, mount, solving, operations } = await setup()
		expect(await commander.setTracking(operations.coordinator, mount, false)).toMatchObject({ ok: true })
		await waitUntil(() => !mount.tracking)

		await start(request())
		await ended()
		expect(summary()).toMatchObject({ state: 'completed', trackingStarted: true })
		expect(mount.tracking).toBeTrue()

		expect(await commander.setTracking(operations.coordinator, mount, false)).toMatchObject({ ok: true })
		await waitUntil(() => !mount.tracking)
		solving.control.error = new Error('no solver')

		const before = summary().sessionId
		await start(request())
		await waitUntil(() => summary().sessionId !== before && summary().endedAt !== undefined)
		expect(summary()).toMatchObject({ state: 'failed', trackingStarted: true, trackingStopped: true })
		expect(mount.tracking).toBeFalse()
	})

	test('a correction of arcseconds completes on the simulated mount', async () => {
		const { start, request, ended, summary, solving } = await setup()
		solving.control.dx = arcsec(40)
		solving.control.dy = 0
		await start(request())

		await ended()
		expect(summary()).toMatchObject({ state: 'completed', positionVerified: true })
		expect(toArcsec(summary().finalSeparation!)).toBeLessThan(30)
	})
})
