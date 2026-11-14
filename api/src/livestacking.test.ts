import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Client } from 'nebulosa/src/devices/indi/device'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { type FitsHeader, writeFits } from 'nebulosa/src/io/formats/fits/fits'
import { bufferSink } from 'nebulosa/src/io/io'
import type { CalibrationMetadata } from './calibrationlibrary.compatibility'
import type { CapturedFrame, CaptureFrameSink, CaptureRequest } from './captures'
import { AppDatabase } from './database'
import type { DeviceRegistry } from './devices'
import type { ImageInfo, ImageProvenance } from './images'
import { createLiveStackingRoutes, LiveStacking, type LiveStackingCounters, type LiveStackingEvent, type LiveStackingMasters, MAX_PENDING_PAYLOADS } from './livestacking'
import { InThreadProcessor, type LiveEngineFrame, type LiveEngineResult, type LiveStackingProcessor, type LiveStackingRecipe, LiveWorkerFailure, type LiveWorkerRequest, type LiveWorkerResponse } from './livestacking.engine'
import { LiveStackingStore } from './livestacking.store'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-livestacking-'))
const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

const SIZE = 96

// Star centers of a field, in pixels of a 96 × 96 frame.
const FIELD: readonly (readonly [number, number])[] = [
	[14, 18],
	[30, 70],
	[44, 22],
	[52, 48],
	[66, 80],
	[72, 30],
	[80, 60],
	[24, 44],
	[60, 12],
	[38, 84],
	[84, 16],
	[12, 82],
]

// Returns the bytes of a 16-bit FITS light of the field shifted by (dx, dy) pixels, scaled by signal, with keywords.
async function fits(dx: number, dy: number, keywords: FitsHeader = {}, signal = 1, seed = 1) {
	const raw = new Float64Array(SIZE * SIZE)
	let state = seed

	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			state = (state * 1103515245 + 12345) % 2147483648
			let value = 0.05 + (state / 2147483648) * 0.002
			for (const [cx, cy] of FIELD) value += 0.4 * Math.exp(-((x - cx - dx) ** 2 + (y - cy - dy) ** 2) / (2 * 1.4 ** 2))
			raw[y * SIZE + x] = value * signal
		}
	}

	const header: FitsHeader = { SIMPLE: true, BITPIX: 16, NAXIS: 2, NAXIS1: SIZE, NAXIS2: SIZE, BZERO: 32768, BSCALE: 1, IMAGETYP: 'Light Frame', EXPTIME: 60, GAIN: 100, ...keywords }
	const buffer = Buffer.alloc(4 * 2880 + SIZE * SIZE * 2)
	const sink = bufferSink(buffer)
	await writeFits(sink, [{ header, raw }], { type: false })
	return new Uint8Array(buffer.subarray(0, sink.position))
}

async function waitUntil(condition: () => boolean, timeout = 15000) {
	const start = Date.now()
	while (!condition()) {
		if (Date.now() - start > timeout) throw new Error('timeout')
		await Bun.sleep(5)
	}
}

// A capture request of a mode, snooping a wheel when asked.
function request(mode: 'preview-only' | 'preview-save', wheel = false): CaptureRequest {
	return { exposureMode: 'loop', count: 1, delay: 0, exposureTime: 60, frameType: 'LIGHT', gain: 100, offset: 0, binX: 1, binY: 1, subframe: false, x: 0, y: 0, width: SIZE, height: SIZE, frameFormat: '', output: { mode, format: 'FITS' }, ...(wheel && { snoop: { wheel: 'wheel' } }) }
}

// A captured frame of a capture session.
function captured(sessionId: string, generation: number, mode: 'preview-only' | 'preview-save' = 'preview-only', wheel = false): CapturedFrame {
	return { frameId: `${sessionId}:${generation}`, sessionId, generation, connectionId: 'c1', deviceId: 'cam', cameraName: 'Camera', time: Date.now(), request: request(mode, wheel) }
}

// Metadata of a master matching the test lights.
function masterMetadata(): CalibrationMetadata {
	const unknown = { value: undefined, evidence: 'unknown' } as const
	return {
		cameraId: 'catalog-camera',
		width: SIZE,
		height: SIZE,
		channels: 1,
		bitpix: 16,
		exposure: { value: 60000000, evidence: 'verified' },
		gain: { value: 100, evidence: 'verified' },
		offset: unknown,
		binX: unknown,
		binY: unknown,
		readoutMode: unknown,
		setTemperature: unknown,
		sensorTemperature: unknown,
		filter: unknown,
		telescope: unknown,
		focalLength: unknown,
	}
}

// Sets up a service over fake captures, a camera c1/cam, masters, and image store, with an in-thread engine.
function setup(options: { processor?: (recipe: LiveStackingRecipe) => LiveStackingProcessor; masters?: Partial<LiveStackingMasters>; memoryBudget?: number; adopting?: Promise<void> } = {}) {
	let sink: CaptureFrameSink | undefined
	const captures = {
		listenFrames: (value: CaptureFrameSink) => {
			sink = value
			return () => (sink = undefined)
		},
	}
	const devices = { camera: (_: Client, deviceId: string) => (deviceId === 'cam' ? { name: 'Camera' } : undefined) } as unknown as DeviceRegistry
	const leases: string[] = []
	const masters: LiveStackingMasters = { pinnedMaster: () => Promise.resolve(undefined), lease: (references) => (leases.push(references.map(({ masterId }) => masterId).join(',')), () => undefined), ...options.masters }
	const closed: string[] = []
	let documents = 0
	const adopted: { readonly image: Image; readonly provenance: ImageProvenance }[] = []
	const images = {
		adopt: async (image: Image, provenance: ImageProvenance) => {
			adopted.push({ image, provenance })
			const id = `doc-${++documents}`
			await options.adopting
			return { origin: 'derived', id, name: 'stack', width: SIZE, height: SIZE, channels: 1, header: {} } as unknown as ImageInfo
		},
		close: (id: string) => (closed.push(id), true),
	}
	const directory = mkdtempSync(join(root, 'store-'))
	const store = new LiveStackingStore(AppDatabase.memory(), directory)
	const events: LiveStackingEvent[] = []
	const stacking = new LiveStacking(
		captures,
		devices,
		(id) => (id === 'c1' ? ({} as Client) : undefined),
		masters,
		images,
		store,
		(event) => events.push(event),
		{ processor: options.processor ?? ((recipe) => new InThreadProcessor(recipe)), memoryBudget: options.memoryBudget, catalog: { cameraOf: ({ connectionId, deviceId }) => (connectionId === 'c1' && deviceId === 'cam' ? 'catalog-camera' : undefined) } },
	)
	disposables.push(stacking)
	const start = (token = 't1', extra: object = {}) => stacking.start('c1', 'cam', { token, ...extra }).session.sessionId

	// Delivers a frame as the capture service does: after the gate of its next exposure let it go.
	const deliver = async (frame: CapturedFrame, bytes?: Uint8Array<ArrayBuffer>) => {
		await sink!.gate(frame.connectionId, frame.deviceId, new AbortController().signal)
		sink!.captured(frame, bytes)
	}

	return { stacking, sink: () => sink!, deliver, store, directory, events, start, leases, closed, adopted }
}

// Whether the counters of a session reconcile: every received frame is in exactly one other count.
function reconciled(counters: LiveStackingCounters) {
	return counters.received === counters.queued + counters.processing + counters.held + counters.accepted + counters.rejected + counters.skipped + counters.deliveryFailed
}

describe('live stacking', () => {
	test('every preview-only frame of several captures is integrated once, by filter, into stacks of one field', async () => {
		const { stacking, sink, deliver, start } = setup()
		const sessionId = start()
		const feed = async (capture: string, generation: number, filter: string, dx: number, signal = 1) => deliver(captured(capture, generation), await fits(dx, generation % 3, { FILTER: filter }, signal, generation))

		for (let i = 1; i <= 3; i++) await feed('cap-1', i, 'Ha', i)
		await feed('cap-1', 3, 'Ha', 3)
		for (let i = 1; i <= 2; i++) await feed('cap-2', i, 'OIII', -i, 0.3)
		for (let i = 1; i <= 2; i++) await feed('cap-3', i, 'Ha', i + 1)
		await waitUntil(() => stacking.session(sessionId).counters.accepted === 7)

		const session = stacking.session(sessionId)
		expect(session.counters).toMatchObject({ received: 7, accepted: 7, queued: 0, processing: 0 })
		expect(reconciled(session.counters)).toBeTrue()
		expect(session.fields).toHaveLength(1)
		expect(session.cohorts.map((cohort) => [cohort.filter, cohort.accepted, cohort.fieldId === session.fields[0].fieldId])).toEqual([
			['Ha', 5, true],
			['OIII', 2, true],
		])
		expect(session.cohorts[0].acquisition).toMatchObject({ width: SIZE, height: SIZE, exposure: 60, gain: 100 })
		expect(session.cohorts[0].exposure).toBe(300)
	})

	test('a saved frame is read only once its file is written, and a failed write or an ended capture fails it', async () => {
		const { stacking, sink, deliver, start, directory } = setup()
		const sessionId = start()
		const path = join(directory, 'frame.fit')
		writeFileSync(path, await fits(0, 0, { FILTER: 'L' }))

		await deliver(captured('cap', 1, 'preview-save'))
		await Bun.sleep(50)
		expect(stacking.session(sessionId).counters).toMatchObject({ received: 1, queued: 1, accepted: 0 })

		sink().saved('cap:1', path)
		await waitUntil(() => stacking.session(sessionId).counters.accepted === 1)

		await deliver(captured('cap', 2, 'preview-save'))
		sink().saveFailed('cap:2')
		await deliver(captured('cap', 3, 'preview-save'))
		sink().captureEnded('cap', 'c1', 'cam')

		const { counters, capture } = stacking.session(sessionId)
		expect(counters).toMatchObject({ received: 3, accepted: 1, deliveryFailed: 2, queued: 0 })
		expect(capture).toEqual({ sessionId: 'cap', outputMode: 'preview-save', ended: true })
	})

	test('acquisition changes start other stacks, and a header that cannot be grouped is skipped', async () => {
		const { stacking, sink, deliver, start } = setup()
		const sessionId = start('t1', { calibration: { filters: {}, otherwise: 'uncalibrated' } })

		await deliver(captured('cap', 1), await fits(0, 0, { FILTER: 'Ha' }))
		await deliver(captured('cap', 2), await fits(1, 0, { FILTER: 'Ha', GAIN: 200 }))
		await deliver(captured('cap', 3), await fits(0, 1, { FILTER: 'Ha', EXPTIME: 120 }))
		await waitUntil(() => stacking.session(sessionId).counters.accepted === 3)
		expect(stacking.session(sessionId).cohorts.map((cohort) => [cohort.acquisition.gain, cohort.acquisition.exposure])).toEqual([
			[100, 60],
			[200, 60],
			[100, 120],
		])

		const wheel = captured('wheel', 1, 'preview-only', true)
		await deliver(wheel, await fits(0, 0))
		await deliver(captured('dark', 1), await fits(0, 0, { IMAGETYP: 'Dark Frame' }))
		await waitUntil(() => stacking.session(sessionId).counters.skipped === 2)
	})

	test('frames of a filter without masters are skipped when asked, and chosen masters that no longer exist reject them', async () => {
		const { stacking, sink, deliver, start } = setup()
		const sessionId = start('t1', { calibration: { filters: { Ha: { dark: { masterId: 7, digest: 'abc' } } }, otherwise: 'skip' } })

		await deliver(captured('cap', 1), await fits(0, 0, { FILTER: 'OIII' }))
		await deliver(captured('cap', 2), await fits(0, 0, { FILTER: 'Ha' }))
		await waitUntil(() => stacking.session(sessionId).counters.received === 2 && stacking.session(sessionId).counters.processing + stacking.session(sessionId).counters.queued === 0)

		expect(stacking.session(sessionId).counters).toMatchObject({ skipped: 1, rejected: 1 })
	})

	test('chosen masters are checked against each frame and leased while it is read', async () => {
		const pinnedMaster = (reference: { masterId: number }) => Promise.resolve({ kind: reference.masterId === 1 ? ('dark' as const) : ('flat' as const), metadata: masterMetadata(), path: '/missing/master.fit', units: 'DN' as const, fullScaleDn: 65535 })
		const { stacking, sink, deliver, start, leases } = setup({ masters: { pinnedMaster } })
		const sessionId = start('t1', { calibration: { filters: { Ha: { dark: { masterId: 1, digest: 'a' } }, OIII: { dark: { masterId: 2, digest: 'b' } } }, otherwise: 'uncalibrated' } })

		await deliver(captured('cap', 1), await fits(0, 0, { FILTER: 'OIII' }))
		await deliver(captured('cap', 2), await fits(0, 0, { FILTER: 'Ha' }))
		await waitUntil(() => stacking.session(sessionId).counters.rejected === 2)

		expect(leases).toEqual(['1'])
	})

	test('a duplicated frame counts once, and a paused session skips the frames that arrive', async () => {
		const { stacking, sink, deliver, start } = setup()
		const sessionId = start()
		const bytes = await fits(0, 0, { FILTER: 'L' })

		await deliver(captured('cap', 1), bytes)
		await deliver(captured('cap', 1), bytes)
		stacking.pause(sessionId)
		await deliver(captured('cap', 2), await fits(1, 1, { FILTER: 'L' }))
		await waitUntil(() => stacking.session(sessionId).counters.accepted === 1)

		expect(stacking.session(sessionId)).toMatchObject({ state: 'paused', counters: { received: 2, accepted: 1, skipped: 1 } })
		stacking.resume(sessionId)
		expect(stacking.session(sessionId).state).toBe('waiting')
	})

	test('the gate holds the next exposure while preview-only frames fill the queue, and lets it go when one is integrated or the capture stops', async () => {
		// Integrations waiting to be let through, in order.
		const waiting: (() => void)[] = []

		// An engine whose integrations wait to be let through.
		const processor = (recipe: LiveStackingRecipe) => {
			const inner = new InThreadProcessor(recipe)
			return Object.assign(Object.create(inner) as LiveStackingProcessor, {
				integrate: async (frame: LiveEngineFrame) => {
					await new Promise<void>((resolve) => {
						waiting.push(resolve)
					})
					return inner.integrate(frame)
				},
				[Symbol.dispose]: () => inner[Symbol.dispose](),
			})
		}

		const { stacking, sink, deliver, start } = setup({ processor })
		const sessionId = start()
		expect(sink().gate('c1', 'cam', new AbortController().signal)).toBeUndefined()

		for (let i = 1; i <= MAX_PENDING_PAYLOADS; i++) await deliver(captured('cap', i), await fits(i, 0, { FILTER: 'L' }))
		await waitUntil(() => waiting.length === 1)

		const gate = sink().gate('c1', 'cam', new AbortController().signal)
		expect(gate).toBeInstanceOf(Promise)
		let passed = false
		void gate!.then(() => (passed = true))
		await Bun.sleep(50)
		expect(passed).toBeFalse()

		waiting[0]()
		await waitUntil(() => passed)

		await waitUntil(() => waiting.length === 2)
		await deliver(captured('cap', 3), await fits(3, 0, { FILTER: 'L' }))
		const stopped = new AbortController()
		const held = sink().gate('c1', 'cam', stopped.signal)
		expect(held).toBeInstanceOf(Promise)
		stopped.abort()
		await held

		waiting[1]()
		await waitUntil(() => waiting.length === 3)
		waiting[2]()
		await waitUntil(() => stacking.session(sessionId).counters.accepted === 3)
	})

	test('a failed worker fails the session and its frames, never the capture', async () => {
		const processor = (recipe: LiveStackingRecipe) => Object.assign(new InThreadProcessor(recipe), { integrate: (): Promise<LiveEngineResult> => Promise.reject(new LiveWorkerFailure('The live stacking worker crashed')) })
		const { stacking, sink, deliver, start } = setup({ processor })
		const sessionId = start()

		await deliver(captured('cap', 1), await fits(0, 0, { FILTER: 'L' }))
		await waitUntil(() => stacking.session(sessionId).state === 'failed')
		expect(sink().wants('c1', 'cam')).toBeTrue()
		expect(sink().gate('c1', 'cam', new AbortController().signal)).toBeUndefined()
		await deliver(captured('cap', 2), await fits(0, 0, { FILTER: 'L' }))

		const session = stacking.session(sessionId)
		expect(session).toMatchObject({ state: 'failed', error: 'The live stacking worker crashed', counters: { received: 2, deliveryFailed: 2 } })
		expect(() => stacking.reset(sessionId)).toThrow()
	})

	test('one session per camera: its token returns it, another conflicts, and a stopped one is replaced', async () => {
		const { stacking, sink, deliver, start } = setup()
		const first = start('a')
		expect(stacking.start('c1', 'cam', { token: 'a' })).toMatchObject({ created: false, session: { sessionId: first } })
		expect(() => stacking.start('c1', 'cam', { token: 'b' })).toThrow('Live Stacking already runs for this camera')
		expect(() => stacking.start('c1', 'other', { token: 'b' })).toThrow('Camera not found')

		await deliver(captured('cap', 1), await fits(0, 0, { FILTER: 'L' }))
		stacking.stop(first)
		await waitUntil(() => stacking.session(first).state === 'stopped')
		expect(stacking.session(first).counters.accepted).toBe(1)
		expect(sink().wants('c1', 'cam')).toBeFalse()

		const second = start('b')
		expect(second).not.toBe(first)
		expect(() => stacking.session(first)).toThrow('Live Stacking session not found')
	})

	test('an export while a frame is integrated describes the frames its pixels hold', async () => {
		// Answers each integration only once hold settles, after the engine integrated it in order.
		class HeldProcessor extends InThreadProcessor {
			hold?: Promise<void>
			integrations = 0

			protected override async send(request: LiveWorkerRequest): Promise<LiveWorkerResponse> {
				if (request.type === 'integrate') this.integrations++
				const response = await super.send(request)
				if (request.type === 'integrate') await this.hold
				return response
			}
		}

		let processor: HeldProcessor | undefined
		const { stacking, deliver, start } = setup({ processor: (recipe) => (processor = new HeldProcessor(recipe)) })
		const sessionId = start()
		await deliver(captured('cap', 1), await fits(0, 0, { FILTER: 'Ha' }))
		await waitUntil(() => stacking.session(sessionId).counters.accepted === 1)
		const [cohort] = stacking.session(sessionId).cohorts

		const hold = Promise.withResolvers<void>()
		processor!.hold = hold.promise
		await deliver(captured('cap', 2), await fits(2, 1, { FILTER: 'Ha' }, 1, 2))
		await waitUntil(() => processor!.integrations === 2)
		const exported = stacking.export(sessionId, { cohortId: cohort.cohortId })
		await Bun.sleep(20)
		hold.resolve()

		expect(await exported).toMatchObject({ frames: 2, exposure: 120, cohorts: [{ frames: 2 }] })
	})

	test('a stack of preview-only frames is saved as a product, listed, opened by path, and deleted', async () => {
		const { stacking, sink, deliver, start, events } = setup()
		const sessionId = start()
		await deliver(captured('cap', 1), await fits(0, 0, { FILTER: 'Ha' }))
		await deliver(captured('cap', 2), await fits(2, 1, { FILTER: 'Ha' }, 1, 2))
		await waitUntil(() => stacking.session(sessionId).counters.accepted === 2)
		const [cohort] = stacking.session(sessionId).cohorts

		const product = await stacking.export(sessionId, { cohortId: cohort.cohortId })
		expect(product).toMatchObject({ kind: 'stack', name: 'Ha', frames: 2, exposure: 120, width: SIZE, height: SIZE, channels: 1, cohorts: [{ cohortId: cohort.cohortId, filter: 'Ha', frames: 2 }] })
		expect(existsSync(product.path)).toBeTrue()
		expect(existsSync(product.coveragePath!)).toBeTrue()
		expect((await stacking.products()).map((saved) => saved.productId)).toEqual([product.productId])
		expect(stacking.session(sessionId).products).toEqual([product.productId])
		expect(events.some((event) => event.type === 'liveStacking:products')).toBeTrue()

		await stacking.deleteProduct(product.productId)
		expect(existsSync(product.path)).toBeFalse()
		expect(await stacking.products()).toEqual([])
	})

	test('a view is a snapshot document kept between frames, and a reset closes it and forgets the stacks', async () => {
		const { stacking, sink, deliver, start, closed, adopted } = setup()
		const sessionId = start()
		await deliver(captured('cap', 1), await fits(0, 0, { FILTER: 'Ha' }))
		await waitUntil(() => stacking.session(sessionId).counters.accepted === 1)
		const [cohort] = stacking.session(sessionId).cohorts

		const view = await stacking.view(sessionId, { cohortId: cohort.cohortId })
		expect(view).toMatchObject({ revision: 1, frames: 1, info: { id: 'doc-1' } })
		expect(await stacking.view(sessionId, { cohortId: cohort.cohortId })).toBe(view)

		// A saved snapshot describes its stack, not its first frame.
		const [{ image, provenance }] = adopted
		expect(image.header).toMatchObject({ NAXIS1: SIZE, NAXIS2: SIZE, FILTER: 'Ha', NCOMBINE: 1, EXPTIME: 60, TOTALEXP: 60, GAIN: 100 })
		expect(String(image.header.HISTORY)).toContain('0 marks pixels no frame covered')
		expect(provenance).toMatchObject({ kind: 'liveStacking', sourceName: 'Ha', frames: 1, stacks: [{ filter: 'Ha', field: 1, accepted: 1, exposure: 60, acquisition: { exposure: 60, gain: 100 } }] })

		await stacking.reset(sessionId)
		expect(closed).toEqual(['doc-1'])
		expect(stacking.session(sessionId)).toMatchObject({ cohorts: [], fields: [], counters: { received: 0, accepted: 0 } })
	})

	test('a view whose session is reset while its document is adopted closes that document', async () => {
		const adopting = Promise.withResolvers<void>()
		const { stacking, deliver, start, closed, adopted } = setup({ adopting: adopting.promise })
		const sessionId = start()
		await deliver(captured('cap', 1), await fits(0, 0, { FILTER: 'Ha' }))
		await waitUntil(() => stacking.session(sessionId).counters.accepted === 1)
		const [cohort] = stacking.session(sessionId).cohorts

		const view = stacking.view(sessionId, { cohortId: cohort.cohortId })
		await waitUntil(() => adopted.length === 1)
		await stacking.reset(sessionId)
		adopting.resolve()

		await expect(view).rejects.toMatchObject({ code: 'notFound' })
		expect(closed).toEqual(['doc-1'])
	})

	test('the next start finishes interrupted products and sets aside unknown directories', async () => {
		const { stacking, store } = setup()
		const product = {
			productId: 'gone',
			sessionId: 's',
			connectionId: 'c1',
			deviceId: 'cam',
			cameraName: 'Camera',
			kind: 'stack',
			name: 'L',
			createdAt: 1,
			contentDigest: 'x',
			bytes: 10,
			width: 1,
			height: 1,
			channels: 1,
			frames: 1,
			exposure: 1,
			recipe: { method: 'average', weighting: 'quality', normalization: 'none', interpolation: 'nearest', minStars: 6, minOverlap: 0 },
			cohorts: [],
		} as const
		store.beginProduct(product)
		mkdirSync(store.productDirectory('stray'), { recursive: true })
		mkdirSync(store.stagingDirectory('left'), { recursive: true })

		await stacking.ready()
		expect(store.hasProduct('gone')).toBeFalse()
		expect(readdirSync(store.orphanedDirectory).some((name) => name.startsWith('stray-'))).toBeTrue()
		expect(existsSync(store.stagingDirectory('left'))).toBeFalse()
	})

	test('routes answer the session, its commands, and stable error codes', async () => {
		const { stacking } = setup()
		const routes = createLiveStackingRoutes(stacking)
		const started = await routes['/api/connections/:id/cameras/:deviceId/live-stacking'].POST({ params: { id: 'c1', deviceId: 'cam' }, json: () => Promise.resolve({ token: 'x' }) } as never)
		expect(started.status).toBe(201)
		const { sessionId } = (await started.json()) as { sessionId: string }

		const again = await routes['/api/connections/:id/cameras/:deviceId/live-stacking'].POST({ params: { id: 'c1', deviceId: 'cam' }, json: () => Promise.resolve({ token: 'y' }) } as never)
		expect(again.status).toBe(409)
		expect(await again.json()).toMatchObject({ code: 'sessionConflict' })

		const close = await routes['/api/live-stacking/sessions/:sessionId'].DELETE({ params: { sessionId } } as never)
		expect(close.status).toBe(409)
		expect(await close.json()).toMatchObject({ code: 'invalidState' })

		const missing = await routes['/api/live-stacking/sessions/:sessionId/pause'].POST({ params: { sessionId: 'nope' } } as never)
		expect(missing.status).toBe(404)
		expect(((await routes['/api/live-stacking'].GET().json()) as { sessions: unknown[] }).sessions).toHaveLength(1)
	})
})
