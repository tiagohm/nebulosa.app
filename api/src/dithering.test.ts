import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { GuideOutputCommander } from 'nebulosa/src/devices/commanders/guideoutput'
import { MountCommander } from 'nebulosa/src/devices/commanders/mount'
import { expectedPierSide } from 'nebulosa/src/devices/indi/device'
import { successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { mulberry32 } from 'nebulosa/src/math/numerical/random'
import { arcsec, deg, normalizeAngle } from 'nebulosa/src/math/units/angle'
import { CaptureFrameRegistry } from './captureframes'
import { CameraCaptures, type CaptureEvent, type CaptureSession, type CaptureStartRequest } from './captures'
import { refusal } from './commands'
import { ConnectionManager } from './connection'
import { AppDatabase } from './database'
import { type CaptureDither, CaptureDithering, type CaptureDitheringGuiding, ditherBoundary } from './dithering'
import type { GuidingCommandStatus, GuidingDitherRequest, GuidingSessionSummary } from './guiding'
import { ImageStore } from './images'
import type { MeridianFlipMonitor, MeridianMechanicalAssessment } from './meridianflip'
import { OperationRegistry } from './operations'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-dithering-'))
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

const SESSION_ID = 'guiding-session'

const GUIDED: CaptureDither = { method: 'guided', everyFrames: 3, guidingSessionId: SESSION_ID, amount: { unit: 'guidePixel', value: 5 }, raOnly: false, settle: { pixels: 1.5, time: 1, timeout: 10 } }

// A fixed capture of small, short, previewed LIGHT frames that dithers, with fields replaced.
function request(patch: Partial<CaptureStartRequest> = {}): CaptureStartRequest {
	return {
		token: crypto.randomUUID(),
		exposureMode: 'fixed',
		count: 7,
		delay: 0,
		exposureTime: 0.01,
		frameType: 'LIGHT',
		gain: 0,
		offset: 0,
		binX: 1,
		binY: 1,
		subframe: true,
		x: 0,
		y: 0,
		width: 16,
		height: 16,
		frameFormat: '',
		output: { mode: 'preview-only', format: 'FITS' },
		dither: GUIDED,
		...patch,
	}
}

// Guiding sessions of one guiding session, whose dithers settle once settle allows them, recording what they were asked.
function fakeGuiding() {
	const dithers: { readonly request: GuidingDitherRequest; readonly generation: number }[] = []
	let state: GuidingSessionSummary['state'] = 'guiding'
	let claimed = false
	let claims = 0
	let outcome: (request: GuidingDitherRequest) => Promise<GuidingCommandStatus> = () => Promise.resolve({ commandId: 'command', command: 'dither', state: 'succeeded' })
	let captured = () => 0
	let runs: readonly GuidingSessionSummary[] = []
	const holds: string[] = []

	const guiding: CaptureDitheringGuiding = {
		runsOn: () => runs,
		hold: (connectionId) => {
			holds.push(connectionId)
			let held = true
			return {
				[Symbol.dispose]: () => {
					if (held) holds.splice(holds.indexOf(connectionId), 1)
					held = false
				},
			}
		},
		summaryOf: (sessionId) => (sessionId === SESSION_ID ? ({ sessionId, cameraName: 'Guide Camera', state } as GuidingSessionSummary) : undefined),
		claimDither: (sessionId) => {
			if (sessionId !== SESSION_ID) return refusal('No guiding session is running with this id', 404, 'notFound')
			if (claimed) return refusal('Camera Acquisition is dithering with this guiding session', 409, 'busy')
			claimed = true
			claims++
			return {
				ok: true,
				admitDither: (request) => {
					dithers.push({ request, generation: captured() + 1 })
					return { ok: true, commandId: request.token, repeated: false, settled: outcome(request) }
				},
				[Symbol.dispose]: () => {
					claimed = false
				},
			}
		},
	}

	return {
		guiding,
		dithers,
		claimed: () => claimed,
		claims: () => claims,
		holds,
		setRuns: (value: readonly GuidingSessionSummary[]) => (runs = value),
		setState: (value: GuidingSessionSummary['state']) => (state = value),
		setOutcome: (value: typeof outcome) => (outcome = value),
		follow: (value: () => number) => (captured = value),
	}
}

async function setup() {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const operations = new OperationRegistry(manager.devices, () => {})
	disposables.push(operations)
	const images = new ImageStore()
	const frames = new CaptureFrameRegistry(images, () => {}, { database: AppDatabase.memory(), connected: () => true })
	disposables.push(frames)
	const fake = fakeGuiding()
	const mountCommander = new MountCommander(manager.devices.mounts)
	const guideOutputCommander = new GuideOutputCommander(manager.devices.guideOutputs, operations.arbiter)
	disposables.push(guideOutputCommander)
	const resolve = (connectionId: string) => manager.client(connectionId)
	const meridian: { mechanical?: MeridianMechanicalAssessment } = {}
	const meridianFlip = { monitor: () => (meridian.mechanical ? ({ mechanical: meridian.mechanical } as MeridianFlipMonitor) : undefined) }
	const dithering = new CaptureDithering(manager.devices, resolve, operations, fake.guiding, { mount: mountCommander, guideOutput: guideOutputCommander }, meridianFlip, mulberry32(7))
	const events: CaptureEvent[] = []
	const captures = new CameraCaptures(manager.devices, resolve, operations, images, frames, (event) => events.push(event), mkdtempSync(join(root, 'default-')), dithering)
	disposables.push(captures)
	const cameraId = manager.devices.list(client).find((device) => device.type === 'camera')!.id
	const mountId = manager.devices.list(client).find((device) => device.type === 'mount')!.id
	manager.devices.switch(client, cameraId, true)
	manager.devices.switch(client, mountId, true)
	const camera = manager.devices.camera(client, cameraId)!
	const mount = manager.devices.device(client, 'mount', mountId)!
	await waitUntil(() => camera.connected && camera.frame.width.max > 0 && operations.available(camera) && mount.connected && mount.canPulseGuide && operations.available(mount))
	await waitUntil(() => manager.devices.list(client).some((device) => device.type === 'guideOutput' && device.name === mount.name))
	const guideOutputId = manager.devices.list(client).find((device) => device.type === 'guideOutput' && device.name === mount.name)!.id
	const cameraGuideOutputId = manager.devices.list(client).find((device) => device.type === 'guideOutput' && device.name === camera.name)?.id

	const sessions = () => events.flatMap((event) => (event.type === 'capture:updated' ? [event.session] : []))
	fake.follow(() => sessions().at(-1)?.captured ?? 0)

	// Admits a capture and fails the test when it is refused.
	const admit = (capture: CaptureStartRequest) => {
		const admission = captures.admit(id, cameraId, capture)
		if (!admission.ok) throw new Error(admission.error)
		return admission
	}

	return { manager, client, id, cameraId, captures, operations, camera, mount, mountId, guideOutputId, cameraGuideOutputId, mountCommander, meridian, fake, sessions, admit }
}

describe('dither boundary', () => {
	test('dithers before the frame that follows every everyFrames frames, never before the first', () => {
		const boundaries = (count: number, every: number) => Array.from({ length: count }, (_, index) => index + 1).filter((generation) => ditherBoundary(generation, every))
		expect(boundaries(7, 3)).toEqual([4, 7])
		expect(boundaries(3, 3)).toEqual([])
		expect(boundaries(2, 3)).toEqual([])
		expect(boundaries(4, 1)).toEqual([2, 3, 4])
	})
})

describe('guided dithering of a capture', () => {
	test('dithers through its guiding session before frames 4 and 7 of 7, and only then exposes', async () => {
		const { admit, fake, sessions, captures } = await setup()
		const capture = request()
		const admitted = admit(capture)

		const ended = await admitted.ended
		expect(ended).toMatchObject({ phase: 'completed', captured: 7, dither: { completed: 2, settling: false } })
		expect(fake.dithers.map(({ generation }) => generation)).toEqual([4, 7])
		expect(fake.dithers.map(({ request }) => request.token)).toEqual([`${capture.token}:dither:4`, `${capture.token}:dither:7`])
		expect(fake.dithers[0].request).toMatchObject({ amount: GUIDED.amount, raOnly: false, settle: GUIDED.settle })
		// Each dither is a phase of its own between two frames, and the next exposure starts after it.
		const phases = sessions().map((session) => session.phase)
		const transitions = phases.filter((phase, index) => phase !== phases[index - 1])
		expect(transitions.filter((phase) => phase === 'dithering')).toHaveLength(2)
		expect(transitions.filter((phase, index) => transitions[index - 1] === 'dithering')).toEqual(['exposing', 'exposing'])
		expect(fake.claimed()).toBeFalse()

		// A repeated token answers the capture it started, without a second claim.
		expect(captures.admit(ended.connectionId, ended.deviceId, capture)).toMatchObject({ ok: true, repeated: true, sessionId: admitted.sessionId })
		expect(fake.claims()).toBe(1)
	})

	test('a loop dithering every frame dithers before each frame after the first', async () => {
		const { admit, fake, captures, sessions } = await setup()
		const admitted = admit(request({ exposureMode: 'loop', dither: { ...GUIDED, everyFrames: 1 } }))
		await waitUntil(() => (sessions().at(-1)?.captured ?? 0) >= 3)
		captures.stopSession(admitted.sessionId)
		const ended = await admitted.ended
		expect(ended.phase).toBe('stopped')
		expect(fake.dithers.map(({ generation }) => generation)).toEqual(Array.from({ length: fake.dithers.length }, (_, index) => index + 2))
	})

	test('a single exposure and a dark frame never dither, and a fixed count short of the boundary never does', async () => {
		const { admit, fake } = await setup()
		expect(await admit(request({ exposureMode: 'single', count: 1 })).ended).toMatchObject({ phase: 'completed', captured: 1 })
		expect(await admit(request({ frameType: 'DARK' })).ended).toMatchObject({ phase: 'completed', captured: 7 })
		const short = await admit(request({ count: 3 })).ended
		expect(short).toMatchObject({ phase: 'completed', captured: 3, dither: { completed: 0 } })
		expect(fake.dithers).toBeEmpty()
		expect(fake.claims()).toBe(1)
	})

	test('a failed dither ends the capture with its error, keeping the frames taken', async () => {
		const { admit, fake } = await setup()
		fake.setOutcome(() => Promise.resolve({ commandId: 'command', command: 'dither', state: 'failed', reason: 'timeout', error: 'the guider did not settle in time' }))
		const capture = request({ output: { mode: 'preview-save', directory: mkdtempSync(join(root, 'frames-')), format: 'FITS' } })

		const ended: CaptureSession = await admit(capture).ended
		expect(ended).toMatchObject({ phase: 'failed', reason: 'timeout', error: 'Dither failed: the guider did not settle in time', captured: 3, saved: 3, dither: { completed: 0, error: 'Dither failed: the guider did not settle in time' } })
		expect(readdirSync(capture.output.directory!)).toHaveLength(3)
		expect(fake.claimed()).toBeFalse()
	})

	test('an abort while the guider settles ends the capture at once and gives the dithers back', async () => {
		const { admit, fake, captures, sessions } = await setup()
		fake.setOutcome(() => new Promise(() => {}))
		const admitted = admit(request({ dither: { ...GUIDED, everyFrames: 1 } }))
		await waitUntil(() => sessions().at(-1)?.phase === 'dithering')

		expect(await captures.abortSession(admitted.sessionId)).toBe('aborted')
		expect(await admitted.ended).toMatchObject({ phase: 'aborted', captured: 1, dither: { completed: 0 } })
		expect(fake.claimed()).toBeFalse()
	})

	test('a guiding session that is not guiding, unknown, or dithered by another claimant refuses the capture', async () => {
		const { id, cameraId, captures, fake } = await setup()

		fake.setState('looping')
		expect(captures.admit(id, cameraId, request())).toMatchObject({ ok: false, status: 409, code: 'notGuiding' })
		fake.setState('guiding')
		expect(captures.admit(id, cameraId, request({ dither: { ...GUIDED, guidingSessionId: 'unknown' } }))).toMatchObject({ ok: false, status: 404, code: 'notFound' })

		const claim = fake.guiding.claimDither(SESSION_ID, 'Sequencer')
		expect(captures.admit(id, cameraId, request())).toMatchObject({ ok: false, status: 409, code: 'busy' })
		if (claim.ok) claim[Symbol.dispose]()
		expect(captures.start(id, cameraId, request({ count: 1 })).status).toBe(202)
	})
})

describe('mount dithering of a capture', () => {
	type Setup = Awaited<ReturnType<typeof setup>>

	const pulse = ({ id, mountId, guideOutputId }: Setup, patch: Partial<CaptureDither> = {}): CaptureDither =>
		({
			method: 'mount',
			everyFrames: 1,
			mount: { connectionId: id, deviceId: mountId },
			movement: 'pulse',
			guideOutput: { connectionId: id, deviceId: guideOutputId },
			amount: 10,
			raOnly: false,
			pattern: 'random',
			settleTime: 0,
			maxPulseDuration: 5000,
			rightAscensionDirection: 'EAST',
			declinationDirection: 'NORTH',
			...patch,
		}) as CaptureDither

	// The setup with its mount synced away from the celestial pole, where the simulator starts and no dither can move it.
	const pointed = async () => {
		const context = await setup()
		expect(await context.mountCommander.sync(context.operations.coordinator, context.mount, { type: 'JNOW', JNOW: { x: 1, y: 0.5 } })).toMatchObject({ ok: true })
		return context
	}

	// Whether a manual operation could take the mount now.
	const manual = async ({ operations, mount }: Setup) => (await operations.coordinator.start('manual', [{ key: resourceKey(mount), device: mount }], () => Promise.resolve(successfulOperationResult(undefined))).result).ok

	test('pulses the mount before each frame after the first, refusing manual motions and guiding until it ends', async () => {
		const context = await pointed()
		const { admit, mount, operations, fake, id, sessions } = context
		const before = { ...mount.equatorialCoordinate }
		const admitted = admit(request({ count: 3, exposureTime: 0.5, dither: pulse(context) }))

		await waitUntil(() => sessions().at(-1)?.phase === 'exposing')
		expect(await manual(context)).toBeFalse()
		expect(fake.holds).toEqual([id])

		expect(await admitted.ended).toMatchObject({ phase: 'completed', captured: 3, dither: { completed: 2, settling: false } })
		expect(mount.equatorialCoordinate).not.toEqual(before)
		expect(operations.available(mount)).toBeTrue()
		expect(fake.holds).toEqual([])
		expect(await manual(context)).toBeTrue()
	})

	test('slews the tracking mount by a small exact GoTo', async () => {
		const context = await pointed()
		const { admit, mount, operations, mountCommander } = context
		expect(await mountCommander.setTracking(operations.coordinator, mount, true)).toMatchObject({ ok: true })
		const before = { ...mount.equatorialCoordinate }

		const ended = await admit(request({ count: 2, dither: pulse(context, { movement: 'slew', settleTime: 0.1 }) })).ended
		expect(ended).toMatchObject({ phase: 'completed', captured: 2, dither: { completed: 1 } })
		expect(mount.equatorialCoordinate).not.toEqual(before)
		expect(operations.available(mount)).toBeTrue()
	})

	test('a GoTo dither is refused while the Meridian Flip Monitor reports a flip candidate', async () => {
		const context = await pointed()
		const { id, cameraId, captures, mount, operations, mountCommander, meridian, fake } = context
		expect(await mountCommander.setTracking(operations.coordinator, mount, true)).toMatchObject({ ok: true })

		meridian.mechanical = 'flipCandidate'
		expect(captures.admit(id, cameraId, request({ dither: pulse(context, { movement: 'slew' }) }))).toMatchObject({ ok: false, status: 409, code: 'meridianFlip' })
		// Pulses never flip a mount, so they are not refused for it.
		meridian.mechanical = 'flipCandidate'
		const pulsed = captures.admit(id, cameraId, request({ count: 1, dither: pulse(context) }))
		expect(pulsed.ok).toBeTrue()
		if (pulsed.ok) await pulsed.ended
		expect(operations.available(mount)).toBeTrue()
		expect(fake.holds).toEqual([])
	})

	test('a GoTo dither that would cross the meridian fails the capture without moving the mount', async () => {
		const context = await setup()
		const { admit, mount, operations, mountCommander } = context
		// Just west of the meridian the mount points from the east side; a dither east of it would cross to the west side.
		const lst = localSiderealTime(timeUnix(Date.now() / 1000, true), mount.geographicCoordinate.longitude)
		expect(await mountCommander.sync(operations.coordinator, mount, { type: 'JNOW', JNOW: { x: normalizeAngle(lst - arcsec(30)), y: deg(20) } })).toMatchObject({ ok: true })
		expect(await mountCommander.setTracking(operations.coordinator, mount, true)).toMatchObject({ ok: true })
		await waitUntil(() => mount.pierSide === expectedPierSide(mount.equatorialCoordinate.rightAscension, mount.equatorialCoordinate.declination, lst))
		const pierSide = mount.pierSide

		// The first spiral step goes north, the second east, across the meridian.
		const ended = await admit(request({ count: 3, dither: pulse(context, { movement: 'slew', pattern: 'spiral', amount: 120, settleTime: 0 }) })).ended
		expect(ended).toMatchObject({ phase: 'failed', reason: 'unexpectedState', captured: 2, dither: { completed: 1 } })
		expect(ended.error).toContain('would cross the meridian')
		expect(mount.pierSide).toBe(pierSide)
		expect(operations.available(mount)).toBeTrue()
	})

	test('a GoTo dither after which the mount reports another pier side fails the capture', async () => {
		const context = await pointed()
		const { admit, mount, operations, mountCommander, sessions } = context
		expect(await mountCommander.setTracking(operations.coordinator, mount, true)).toMatchObject({ ok: true })
		const pierSide = mount.pierSide
		const admitted = admit(request({ count: 3, dither: pulse(context, { movement: 'slew', settleTime: 1 }) }))

		// A driver flipping on its own reports the other side while the dither settles.
		await waitUntil(() => sessions().at(-1)?.dither?.settling === true)
		mount.pierSide = pierSide === 'EAST' ? 'WEST' : 'EAST'
		const ended = await admitted.ended
		expect(ended).toMatchObject({ phase: 'failed', reason: 'unexpectedState', captured: 1, dither: { completed: 0 } })
		expect(ended.error).toContain('changed its pier side')
	})

	test('an abort during the mechanical settle ends the capture and frees the mount', async () => {
		const context = await pointed()
		const { admit, captures, operations, mount, sessions } = context
		const admitted = admit(request({ count: 3, dither: pulse(context, { settleTime: 60 }) }))

		await waitUntil(() => sessions().at(-1)?.dither?.settling === true)
		expect(await captures.abortSession(admitted.sessionId)).toBe('aborted')
		expect(await admitted.ended).toMatchObject({ phase: 'aborted', captured: 1, dither: { completed: 0, settling: false } })
		expect(operations.available(mount)).toBeTrue()
	})

	test('a mount lost between two dithers fails the capture as disconnected', async () => {
		const context = await pointed()
		const { admit, manager, client, mountId, sessions } = context
		const admitted = admit(request({ count: 3, exposureTime: 1, dither: pulse(context) }))

		await waitUntil(() => sessions().at(-1)?.dither?.completed === 1)
		manager.devices.switch(client, mountId, false)
		expect(await admitted.ended).toMatchObject({ phase: 'failed', reason: 'disconnected', captured: 2, dither: { completed: 1 } })
	})

	test('a pulse longer than the limit fails the capture without moving the mount', async () => {
		const context = await pointed()
		const { admit, mount } = context
		const before = { ...mount.equatorialCoordinate }
		const ended = await admit(request({ count: 2, dither: pulse(context, { maxPulseDuration: 1, amount: 120 }) })).ended
		expect(ended).toMatchObject({ phase: 'failed', reason: 'unexpectedState', captured: 1 })
		expect(ended.error).toStartWith('Dither failed: ')
		expect(mount.equatorialCoordinate).toEqual(before)
	})

	test('guiding on the connection, a busy mount, or the capture camera as guide output refuse the capture', async () => {
		const context = await setup()
		const { id, cameraId, captures, fake, operations, mount, cameraGuideOutputId } = context

		fake.setRuns([{ sessionId: 'running' } as GuidingSessionSummary])
		expect(captures.admit(id, cameraId, request({ dither: pulse(context) }))).toMatchObject({ ok: false, status: 409, code: 'guidingActive' })
		fake.setRuns([])

		const held = Promise.withResolvers<void>()
		const holder = operations.coordinator.start('manual', [{ key: resourceKey(mount), device: mount }], async () => {
			await held.promise
			return successfulOperationResult(undefined)
		})
		expect(captures.admit(id, cameraId, request({ dither: pulse(context) }))).toMatchObject({ ok: false, status: 409, code: 'busy' })
		held.resolve()
		await holder.result

		expect(captures.admit(id, cameraId, request({ dither: pulse(context, { mount: { connectionId: id, deviceId: 'unknown' } }) }))).toMatchObject({ ok: false, status: 404 })
		if (cameraGuideOutputId) expect(captures.admit(id, cameraId, request({ dither: pulse(context, { guideOutput: { connectionId: id, deviceId: cameraGuideOutputId } }) }))).toMatchObject({ ok: false, status: 409, code: 'busy' })
		expect(operations.available(mount)).toBeTrue()
		expect(fake.holds).toEqual([])
	})
})
