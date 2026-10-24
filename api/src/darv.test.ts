import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MountCommander } from 'nebulosa/src/devices/commanders/mount'
import { isDeviceQuiescent } from 'nebulosa/src/devices/orchestration/device.lifecycle'
import { failedOperationResult, type OperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { deg, hour } from 'nebulosa/src/math/units/angle'
import { meter } from 'nebulosa/src/math/units/distance'
import type { DarvImageAnalysisResult, DarvTrailMeasurement } from 'nebulosa/src/observation/alignment/polaralignment.darv.analysis'
import type { DarvRunTiming } from 'nebulosa/src/observation/alignment/polaralignment.darv.runner'
import { CaptureFrameRegistry } from './captureframes'
import { CameraCaptures, type CaptureRequest } from './captures'
import { ConnectionManager } from './connection'
import { type DarvEvent, type DarvMeasurementRequest, type DarvRequest, type DarvSession, DarvSessions } from './darv'
import { type DarvAnalysis, darvAnalysis, DarvAnalyzer } from './darv.analysis'
import { ImageStore } from './images'
import { OperationRegistry } from './operations'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-darv-test-'))
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

// A measurement moving west for 1 s at 0.5°/s (SPEED_1 of the simulator) with small frames, with fields replaced.
function measurementRequest(patch: Partial<DarvMeasurementRequest> = {}): DarvMeasurementRequest {
	return {
		token: `token-${tokens++}`,
		capture: { gain: 0, offset: 0, binX: 1, binY: 1, subframe: true, x: 0, y: 0, width: 128, height: 128, frameFormat: '' },
		axis: 'azimuth',
		direction: 'WEST',
		slewRate: 'SPEED_1',
		legDuration: 1,
		...patch,
	}
}

function request(mount: { connectionId: string; deviceId: string }, patch: Partial<DarvRequest> = {}): DarvRequest {
	return { ...measurementRequest(), mount, ...patch }
}

const ANALYSIS: DarvAnalysis = {
	status: 'measured',
	driftMagnitude: 0.5,
	trailCount: 1,
	usableCount: 1,
	confidence: 0.8,
	diagnostics: ['missingAngularTransform', 'directionUnresolved'],
	trails: [{ start: { x: 1, y: 1 }, turn: { x: 50, y: 1 }, returnStart: { x: 50, y: 2 }, end: { x: 1, y: 3 }, driftMagnitude: 0.5, directionResolved: false, clipped: false, unresolved: false }],
}

// Analyzer standing for the worker: answers a fixed analysis and records what it was given.
function fakeAnalyzer() {
	const calls: { imageId: string; timing: DarvRunTiming; retained: boolean }[] = []
	let images: ImageStore | undefined

	const analyzer = {
		analyze: (imageId: string, timing: DarvRunTiming) => {
			calls.push({ imageId, timing, retained: images?.metadata(imageId) !== undefined })
			return Promise.resolve(ANALYSIS)
		},
	}

	return { analyzer, calls, attach: (store: ImageStore) => (images = store) }
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
	const analysis = fakeAnalyzer()
	analysis.attach(images)
	const events: DarvEvent[] = []
	const auxiliaryDir = mkdtempSync(join(root, 'auxiliary-'))
	const darv = new DarvSessions(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		commander,
		captures.capturer,
		images,
		frames,
		analysis.analyzer,
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
	expect(await commander.sync(operations.coordinator, mount, { type: 'JNOW', JNOW: { x: hour(5), y: deg(5) } })).toMatchObject({ ok: true })
	await waitUntil(() => Math.abs(mount.equatorialCoordinate.declination - deg(5)) < deg(0.1) && operations.available(mount))

	// Latest published summary.
	const summary = () => events.at(-1)?.session
	// Latest measurement of the latest summary.
	const latest = () => summary()?.measurements.at(-1)
	// Whether the latest measurement ended.
	const ended = () => latest()?.endedAt !== undefined && summary()?.state !== 'measuring'
	// States the latest measurement went through, without repetitions.
	const states = () => {
		const generation = latest()?.generation
		const seen: string[] = []
		for (const event of events) {
			const state = event.session.measurements.find((measurement) => measurement.generation === generation)?.state
			if (state && seen.at(-1) !== state) seen.push(state)
		}
		return seen
	}
	// Complete record of a session.
	const session = async (sessionId: string) => (await darv.session(sessionId).json()) as DarvSession
	// Whether the camera and the mount are free for a new operation.
	const released = () => operations.available(camera) && operations.available(mount)

	return { id, operations, images, frames, captures, commander, analysis, darv, events, auxiliaryDir, camera, cameraId, mount, mountDevice: { connectionId: id, deviceId: mountId }, summary, latest, ended, states, session, released }
}

// Starts a session and returns its ids.
async function start(darv: DarvSessions, connectionId: string, cameraId: string, body: DarvRequest) {
	const response = darv.start(connectionId, cameraId, body)
	expect(response.status).toBe(202)
	return (await response.json()) as { sessionId: string; operationId: string; generation: number }
}

describe('DARV sessions', () => {
	test('measures, releases the devices before the analysis, restores the slew rate, repeats, and finishes', async () => {
		const { id, cameraId, darv, mountDevice, mount, frames, analysis, summary, latest, ended, states, session, released, auxiliaryDir } = await setup()
		const { sessionId, generation } = await start(darv, id, cameraId, request(mountDevice))
		expect(generation).toBe(1)

		await waitUntil(ended, 60000)
		expect(states()).toEqual(['preparing', 'exposing', 'outbound', 'reversing', 'inbound', 'finishing', 'analyzing', 'ready'])
		expect(latest()).toMatchObject({ generation: 1, state: 'ready', exposure: 11, previousSlewRate: 'SPEED_2', slewRateRestored: true, frameId: `${sessionId}:1`, result: { status: 'measured', driftMagnitude: 0.5 } })
		expect(summary()!.state).toBe('idle')
		const { timing } = latest()!
		expect(timing!.outbound).toBeGreaterThanOrEqual(1)
		expect(timing!.leading + timing!.outbound + timing!.turnaround + timing!.inbound + timing!.trailing).toBeCloseTo(11, 6)
		expect(mount.slewRate).toBe('SPEED_2')
		expect(isDeviceQuiescent(mount)).toBeTrue()
		expect(released()).toBeTrue()
		expect(readdirSync(auxiliaryDir)).toEqual([])

		// The frame is the latest of the camera, taken by DARV, and was retained while it was analyzed.
		expect(frames.snapshot().sources[0].latestFrameId).toBe(`${sessionId}:1`)
		expect(analysis.calls).toEqual([{ imageId: latest()!.imageId!, timing: timing!, retained: true }])
		const record = await session(sessionId)
		expect(record.trails).toEqual([{ generation: 1, imageId: latest()!.imageId!, trails: ANALYSIS.trails }])
		expect('trails' in summary()!).toBeFalse()

		// A repetition after the adjustment keeps the session and may change the settings.
		const repeated = darv.repeat(sessionId, measurementRequest({ direction: 'EAST' }))
		expect(repeated.status).toBe(202)
		expect(await repeated.json()).toMatchObject({ sessionId, generation: 2 })
		await waitUntil(() => latest()?.generation === 2 && ended(), 60000)
		expect(latest()).toMatchObject({ state: 'ready', request: { direction: 'EAST' }, frameId: `${sessionId}:2` })
		expect(summary()!.measurements.map((measurement) => measurement.generation)).toEqual([1, 2])

		expect(darv.finish(sessionId).status).toBe(204)
		expect(summary()).toMatchObject({ state: 'finished' })
		expect(darv.repeat(sessionId, measurementRequest()).status).toBe(404)
		expect(darv.finish(sessionId).status).toBe(404)
	}, 120000)

	test('an abort during the outbound motion stops the mount, discards the exposure, and restores the slew rate', async () => {
		const { id, cameraId, darv, mountDevice, mount, analysis, latest, ended, released } = await setup()
		const { sessionId } = await start(darv, id, cameraId, request(mountDevice, { legDuration: 5 }))

		await waitUntil(() => latest()?.state === 'outbound', 30000)
		expect((await darv.abort(sessionId)).status).toBe(204)
		await waitUntil(ended)

		expect(latest()).toMatchObject({ state: 'aborted', slewRateRestored: true })
		expect(latest()!.frameId).toBeUndefined()
		expect(analysis.calls).toEqual([])
		expect(isDeviceQuiescent(mount)).toBeTrue()
		expect(mount.slewRate).toBe('SPEED_2')
		expect(released()).toBeTrue()
		expect((await darv.abort(sessionId)).status).toBe(409)
	}, 60000)

	test('the camera and the mount are held only while a measurement exposes', async () => {
		const { id, cameraId, darv, mountDevice, captures, latest, ended } = await setup()
		const { sessionId } = await start(darv, id, cameraId, request(mountDevice))
		await waitUntil(() => latest()?.state === 'exposing', 30000)

		expect(captures.start(id, cameraId, captureRequest()).status).toBe(409)
		expect(darv.start(id, cameraId, request(mountDevice)).status).toBe(409)
		expect(darv.repeat(sessionId, measurementRequest()).status).toBe(409)
		expect(darv.finish(sessionId).status).toBe(409)

		await waitUntil(ended, 60000)
		const capture = captures.start(id, cameraId, captureRequest())
		expect(capture.status).toBe(202)
	}, 90000)

	test('a measurement cannot start on a mount another operation holds', async () => {
		const { id, cameraId, darv, mountDevice, mount, operations, events } = await setup()
		const hold = operations.coordinator.start(
			'hold',
			[{ key: resourceKey(mount), device: mount }],
			(context) =>
				new Promise<OperationResult<void>>((resolve) => {
					context.signal.addEventListener('abort', () => resolve(failedOperationResult('aborted')), { once: true })
				}),
		)

		expect(darv.start(id, cameraId, request(mountDevice)).status).toBe(409)
		expect(events).toEqual([])
		await hold.cancel()
	}, 60000)

	test('a mount without the slew rate or without tracking is refused before anything starts', async () => {
		const { id, cameraId, darv, mountDevice, mount, commander, operations, events } = await setup()

		expect(darv.start(id, cameraId, request(mountDevice, { slewRate: 'WARP' })).status).toBe(422)
		expect(await commander.setTracking(operations.coordinator, mount, false)).toMatchObject({ ok: true })
		expect(darv.start(id, cameraId, request(mountDevice)).status).toBe(422)
		expect(events).toEqual([])
		expect(darv.session('unknown').status).toBe(404)
	}, 60000)

	test('a repeated token answers the measurement it started', async () => {
		const { id, cameraId, darv, mountDevice, ended, summary } = await setup()
		const body = request(mountDevice)
		const first = await start(darv, id, cameraId, body)
		const second = await start(darv, id, cameraId, body)

		expect(second).toEqual(first)
		expect(darv.snapshot().sessions).toHaveLength(1)
		await waitUntil(ended, 60000)
		expect(summary()!.measurements).toHaveLength(1)
		expect(summary()!.revision).toBeGreaterThan(1)
	}, 90000)
})

// A toolkit trail with fields replaced.
function trail(patch: Partial<DarvTrailMeasurement> = {}): DarvTrailMeasurement {
	const leg = { start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, length: 10, width: 2, angle: 0, rmsResidual: 0.1 }
	return {
		start: { x: 0, y: 0 },
		turn: { x: 10, y: 0 },
		returnStart: { x: 10, y: 1 },
		end: { x: 0, y: 2 },
		outbound: leg,
		inbound: leg,
		closure: [0, 2],
		directionResolved: false,
		driftMagnitude: 0.2,
		driftUnit: 'pixelsPerSecond',
		uncertainty: 0.01,
		confidence: 0.7,
		rmsResidual: 0.1,
		clipped: false,
		unresolved: false,
		...patch,
	}
}

describe('DARV analysis', () => {
	test('usable trails are measured, clipped ones only limited, and no trail is inconclusive', () => {
		const partial: DarvImageAnalysisResult = { status: 'partial', trails: [trail()], driftMagnitude: 0.2, driftUnit: 'pixelsPerSecond', inliers: 0, confidence: 0.7, diagnostics: ['missingAngularTransform', 'directionUnresolved'] }
		expect(darvAnalysis(partial)).toMatchObject({ status: 'measured', driftMagnitude: 0.2, trailCount: 1, usableCount: 1, confidence: 0.7 })

		const clipped: DarvImageAnalysisResult = { status: 'partial', trails: [trail({ clipped: true })], driftUnit: 'pixelsPerSecond', inliers: 0, confidence: 0, diagnostics: ['missingAngularTransform', 'trailClipped'] }
		const limited = darvAnalysis(clipped)
		expect(limited).toMatchObject({ status: 'limited', trailCount: 1, usableCount: 0, diagnostics: ['missingAngularTransform', 'trailClipped'] })
		expect('driftMagnitude' in limited).toBeFalse()

		const none: DarvImageAnalysisResult = { status: 'inconclusive', trails: [], driftUnit: 'pixelsPerSecond', inliers: 0, confidence: 0, diagnostics: ['missingAngularTransform', 'noStreaks'] }
		expect(darvAnalysis(none)).toEqual({ status: 'inconclusive', trailCount: 0, usableCount: 0, confidence: 0, diagnostics: ['missingAngularTransform', 'noStreaks'], trails: [] })
	})

	test('the worker analyzes a frame and an aborted analysis rejects', async () => {
		const width = 128
		const image = (): Image => ({ raw: new Float32Array(width * width).fill(0.1), header: {}, metadata: { width, height: width, channels: 1, stride: width, pixelCount: width * width, strideInBytes: width * 4, pixelSizeInBytes: 4, bitpix: -32, bayer: undefined } })
		const analyzer = new DarvAnalyzer({ detectionImage: (id: string) => Promise.resolve(id === 'frame' ? image() : undefined) })
		const timing: DarvRunTiming = { exposure: 11, leading: 3, outbound: 1, turnaround: 0.5, inbound: 1, trailing: 5.5 }

		const result = await analyzer.analyze('frame', timing, 'WEST', new AbortController().signal)
		expect(result).toMatchObject({ status: 'inconclusive', trailCount: 0 })
		expect(result.diagnostics).toContain('noStreaks')
		expect(result.diagnostics).not.toContain('invalidTiming')

		await expect(analyzer.analyze('released', timing, 'WEST', new AbortController().signal)).rejects.toThrow('released')
		const aborted = new AbortController()
		aborted.abort(new Error('aborted'))
		await expect(analyzer.analyze('frame', timing, 'WEST', aborted.signal)).rejects.toThrow('aborted')
	})
})
