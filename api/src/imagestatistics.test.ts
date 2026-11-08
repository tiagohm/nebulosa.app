import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAX_QUEUED } from './analysis'
import { type DisplaySettings, ImageStore } from './images'
import { createImageStatisticsRoutes, type ImageStatisticsEvent, type ImageStatisticsJob, type ImageStatisticsRequest, ImageStatisticsService, statisticsCacheKey } from './imagestatistics'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-statistics-test-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

// Size of a FITS block, in bytes.
const BLOCK = 2880

// Display settings of a plain rendering.
const NEUTRAL: DisplaySettings = { debayer: { enabled: false }, stretch: { mode: 'auto', preset: 'medium', linked: true }, brightness: 1, contrast: 1, gamma: 1, saturation: 1, scnr: { enabled: false }, invert: false }

let files = 0

// Formats a FITS card of a numeric value.
function card(key: string, value: number) {
	return `${key.padEnd(8)}= ${String(value).padStart(20)}`
}

interface FitsOptions {
	readonly width: number
	readonly height: number
	readonly bitpix: 8 | 16 | -32
	readonly channels?: 1 | 3
	readonly extra?: readonly string[]
	// Stored value of sample (x, y, c): the code for integers (BZERO already removed for 16 bits), the float otherwise.
	readonly value: (x: number, y: number, c: number) => number
}

// Writes a FITS image and returns its path.
function writeFits({ width, height, bitpix, channels = 1, extra = [], value }: FitsOptions) {
	const axes = channels === 3 ? ['NAXIS   =                    3', card('NAXIS1', width), card('NAXIS2', height), card('NAXIS3', 3)] : ['NAXIS   =                    2', card('NAXIS1', width), card('NAXIS2', height)]
	const cards = ['SIMPLE  =                    T', card('BITPIX', bitpix), ...axes, ...extra, 'END']
	const header = Buffer.alloc(Math.ceil((cards.length * 80) / BLOCK) * BLOCK, ' ')
	for (const [i, line] of cards.entries()) header.write(line.padEnd(80), i * 80, 'latin1')
	const bytes = Math.abs(bitpix) / 8
	const data = Buffer.alloc(Math.ceil((width * height * channels * bytes) / BLOCK) * BLOCK)

	for (let c = 0, offset = 0; c < channels; c++) {
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++, offset += bytes) {
				const sample = value(x, y, c)
				if (bitpix === 8) data.writeUInt8(sample, offset)
				else if (bitpix === 16) data.writeInt16BE(sample, offset)
				else data.writeFloatBE(sample, offset)
			}
		}
	}

	const path = join(root, `statistics-${files++}.fits`)
	writeFileSync(path, Buffer.concat([header, data]))
	return path
}

// Unsigned 16-bit code of a pixel of the camera-like fixture.
function code(x: number, y: number) {
	return 1000 + ((x * 7 + y * 13) % 41)
}

// Writes an unsigned 16-bit frame (BZERO 32768) whose codes are code(x, y), optionally with a BAYERPAT.
function writeCameraFrame(width = 64, height = 48, bayer?: string) {
	return writeFits({ width, height, bitpix: 16, extra: ['BZERO   =                32768', ...(bayer ? [`BAYERPAT= '${bayer.padEnd(8)}'`] : [])], value: (x, y) => code(x, y) - 32768 })
}

// Writes a large floating-point frame whose scan spans many slices.
function writeLargeFrame() {
	return writeFits({ width: 2400, height: 1600, bitpix: -32, value: (x, y) => 0.1 + ((x * 31 + y * 17) % 97) / 1000 })
}

// Creates a service over its own image store, recording its events.
function setup() {
	const images = new ImageStore()
	const events: ImageStatisticsEvent[] = []
	const service = new ImageStatisticsService(images, (event) => events.push(event))
	return { images, service, events }
}

// Waits until a job ended and returns its last state.
async function ended(events: readonly ImageStatisticsEvent[], jobId: string, timeout = 20000) {
	const deadline = performance.now() + timeout

	while (performance.now() < deadline) {
		const last = events.findLast((event) => event.job.jobId === jobId)?.job
		if (last && last.state !== 'queued' && last.state !== 'running') return last
		await Bun.sleep(5)
	}

	throw new Error(`job ${jobId} did not end`)
}

// Submits a scan that must be accepted and returns its job.
function submit(service: ImageStatisticsService, imageId: string, request: ImageStatisticsRequest = {}): ImageStatisticsJob {
	const outcome = service.submit(imageId, request)
	if (outcome.status !== 'accepted') throw new Error(`not accepted: ${outcome.status}`)
	return outcome.job
}

// Runs a scan to completion and returns its result.
async function measure(service: ImageStatisticsService, events: readonly ImageStatisticsEvent[], imageId: string, request: ImageStatisticsRequest = {}) {
	const job = submit(service, imageId, request)
	const last = await ended(events, job.jobId)
	expect(last.state).toBe('completed')
	return service.result(job.jobId)!
}

type Handler = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>

type StatisticsRoutes = ReturnType<typeof createImageStatisticsRoutes>

// Calls a route of the image statistics API.
function call(routes: StatisticsRoutes, route: keyof StatisticsRoutes, method: 'GET' | 'POST', params: Record<string, string>, body?: unknown) {
	const handler = (routes[route] as unknown as Record<string, Handler>)[method]
	const req = Object.assign(new Request('http://localhost/', { method, body: body === undefined ? undefined : JSON.stringify(body) }), { params })
	return Promise.resolve(handler(req))
}

describe('measurement', () => {
	test('reports an unsigned 16-bit frame in exact ADU with its numeric limits', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeCameraFrame())
		const result = await measure(service, events, info.id)
		const codes = Array.from({ length: 64 * 48 }, (_, i) => code(i % 64, Math.floor(i / 64))).toSorted((a, b) => a - b)
		const [mono] = result.planes

		expect(result.unit).toBe('adu')
		expect(result.rescaled).toBeFalse()
		expect(result.mosaic).toBeUndefined()
		expect(result.area).toEqual({ left: 0, top: 0, width: 64, height: 48 })
		expect(mono.plane).toBe('mono')
		expect(mono.quantileMethod).toBe('exact')
		expect(mono.finiteCount).toBe(64 * 48)
		expect(mono.min).toBeCloseTo(codes[0], 6)
		expect(mono.max).toBeCloseTo(codes.at(-1)!, 6)
		expect(mono.median).toBeCloseTo((codes[codes.length / 2 - 1] + codes[codes.length / 2]) / 2, 6)
		expect(mono.mean).toBeCloseTo(codes.reduce((a, b) => a + b, 0) / codes.length, 4)
		expect(mono.numericLimits).toEqual({ low: 0, high: 65535, lowCount: 0, highCount: 0 })
		expect(mono.histograms!.full.min).toBeCloseTo(codes[0], 6)
		expect(mono.histograms!.full.counts.reduce((a, b) => a + b, 0) + mono.histograms!.full.belowDomain + mono.histograms!.full.aboveDomain).toBe(64 * 48)
		expect(mono.background!.status).not.toBe('unavailable')
		expect(mono.background!.level).toBeGreaterThan(1000)
		images[Symbol.dispose]()
	})

	test('restores the source scale of a rescaled float image and drops unknown limits', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeFits({ width: 32, height: 32, bitpix: -32, value: (x) => -2 + x / 4 }))
		const result = await measure(service, events, info.id)
		const [mono] = result.planes

		expect(result.unit).toBe('source')
		expect(result.rescaled).toBeTrue()
		expect(mono.min).toBeCloseTo(-2, 5)
		expect(mono.max).toBeCloseTo(-2 + 31 / 4, 5)
		expect(mono.mean).toBeCloseTo(-2 + 15.5 / 4, 5)
		expect(mono.standardDeviation).toBeCloseTo(Math.sqrt((32 * 32 - 1) / 12) / 4, 4)
		expect(mono.numericLimits).toBeUndefined()
		images[Symbol.dispose]()
	})

	test('separates RGB channels and adds their luminance', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeFits({ width: 16, height: 16, bitpix: 8, channels: 3, value: (_x, _y, c) => [20, 40, 60][c] }))
		const result = await measure(service, events, info.id)

		expect(result.planes.map((plane) => plane.plane)).toEqual(['red', 'green', 'blue', 'luminance'])
		expect(result.planes[0].mean).toBeCloseTo(20, 4)
		expect(result.planes[2].median).toBeCloseTo(60, 6)
		expect(result.planes[3].mean).toBeCloseTo(0.2125 * 20 + 0.7154 * 40 + 0.0721 * 60, 4)
		expect(result.planes[3].background).toBeUndefined()
		expect(service.job(result.jobId)!.summary!.plane).toBe('luminance')
		images[Symbol.dispose]()
	})

	test('measures a trusted mosaic phase by phase, keeping phases inside an odd area', async () => {
		const { images, service, events } = setup()
		const level = (x: number, y: number) => [3000, 2000, 2010, 1000][((y & 1) << 1) | (x & 1)]
		const info = await images.open(writeFits({ width: 40, height: 30, bitpix: 16, extra: ['BZERO   =                32768', "BAYERPAT= 'RGGB    '"], value: (x, y) => level(x, y) - 32768 }))
		const area = { left: 3, top: 5, width: 11, height: 9 }
		const result = await measure(service, events, info.id, { area })

		expect(result.mosaic).toBe('trusted')
		expect(result.area).toEqual(area)
		expect(result.planes.map((plane) => [plane.plane, plane.median])).toEqual([
			['red', 3000],
			['green1', 2000],
			['green2', 2010],
			['blue', 1000],
		])
		expect(result.planes.reduce((a, plane) => a + plane.finiteCount, 0)).toBe(11 * 9)
		images[Symbol.dispose]()
	})

	test('measures an untrusted mosaic as one mono plane', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeCameraFrame(32, 32, 'XYZW'))
		const result = await measure(service, events, info.id)
		expect(result.mosaic).toBe('untrusted')
		expect(result.planes.map((plane) => plane.plane)).toEqual(['mono'])
		images[Symbol.dispose]()
	})
})

describe('scheduling', () => {
	test('answers an equivalent request with the active or cached job, and a new area with a new job', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeCameraFrame())
		const job = submit(service, info.id)
		expect(service.submit(info.id, {})).toEqual({ status: 'active', job: expect.objectContaining({ jobId: job.jobId }) })
		await ended(events, job.jobId)
		expect(service.submit(info.id, {})).toEqual({ status: 'cached', job: expect.objectContaining({ jobId: job.jobId, state: 'completed' }) })
		expect(service.submit(info.id, { area: { left: 0, top: 0, width: 8, height: 8 } }).status).toBe('accepted')
		expect(statisticsCacheKey(info.id, {})).not.toBe(statisticsCacheKey(info.id, { area: { left: 0, top: 0, width: 8, height: 8 } }))
		expect(service.submit('unknown', {})).toEqual({ status: 'missing' })
		images[Symbol.dispose]()
	})

	test('refuses a submission when the queue is full', async () => {
		const { images, service } = setup()
		const info = await images.open(writeCameraFrame())
		for (let i = 0; i <= MAX_QUEUED; i++) submit(service, info.id, { area: { left: 0, top: 0, width: 1, height: i + 1 } })
		expect(service.submit(info.id, { area: { left: 1, top: 1, width: 1, height: 1 } })).toEqual({ status: 'queueFull' })
		service[Symbol.dispose]()
		images[Symbol.dispose]()
	})

	test('cancels a queued job and a running scan, publishing no result and releasing the image', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeLargeFrame())
		const running = submit(service, info.id)
		const queued = submit(service, info.id, { area: { left: 0, top: 0, width: 10, height: 10 } })
		expect(service.cancel(queued.jobId)).toBeTrue()
		expect((await ended(events, queued.jobId)).state).toBe('cancelled')

		while (service.job(running.jobId)?.state === 'queued') await Bun.sleep(1)
		expect(service.cancel(running.jobId)).toBeTrue()
		const last = await ended(events, running.jobId)
		expect(last.state).toBe('cancelled')
		expect(last.summary).toBeUndefined()
		expect(service.result(running.jobId)).toBeUndefined()
		expect(service.cancel(running.jobId)).toBeFalse()

		images.close(info.id)
		expect(images.metadata(info.id)).toBeUndefined()
		images[Symbol.dispose]()
	})

	test('stops a running scan of the store when its signal aborts', async () => {
		const images = new ImageStore()
		const info = await images.open(writeLargeFrame())
		const controller = new AbortController()
		const scan = images.statistics(info.id, undefined, controller.signal)
		await Bun.sleep(2)
		controller.abort()
		expect((await scan).status).toBe('cancelled')
		expect((await images.statistics('unknown', undefined)).status).toBe('missing')
		images[Symbol.dispose]()
	})

	test('keeps rendering while a large scan runs', async () => {
		const images = new ImageStore()
		const large = await images.open(writeLargeFrame())
		const small = await images.open(writeCameraFrame())
		let scanned = 0
		let rendered = 0
		const scan = images.statistics(large.id, undefined).then(() => (scanned = performance.now()))
		const render = images.render(small.id, { settings: NEUTRAL }).then((outcome) => {
			rendered = performance.now()
			return outcome
		})
		expect((await render).status).toBe('rendered')
		await scan
		expect(rendered).toBeLessThan(scanned)
		images[Symbol.dispose]()
	})

	test('completes a job whose image is closed while it runs, then releases the pixels', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeLargeFrame())
		const job = submit(service, info.id)
		images.close(info.id)
		expect(images.metadata(info.id)).toBeDefined()
		expect((await ended(events, job.jobId)).state).toBe('completed')
		expect(images.metadata(info.id)).toBeUndefined()
		expect(service.result(job.jobId)).toBeUndefined()
		images[Symbol.dispose]()
	})

	test('publishes jobs without planes', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeCameraFrame())
		await ended(events, submit(service, info.id).jobId)
		expect(events.map((event) => event.job.state)).toEqual(['queued', 'running', 'completed'])
		for (const event of events) expect(Object.keys(event.job)).not.toContain('planes')
		expect(events.at(-1)!.job.summary!.median).toBeGreaterThan(1000)
		images[Symbol.dispose]()
	})
})

describe('routes', () => {
	test('submits, lists, reads, and cancels through the API', async () => {
		const { images, service, events } = setup()
		const routes = createImageStatisticsRoutes(service)
		const info = await images.open(writeCameraFrame())

		const accepted = await call(routes, '/api/images/:id/statistics', 'POST', { id: info.id }, {})
		expect(accepted.status).toBe(202)
		const job = (await accepted.json()) as ImageStatisticsJob
		await ended(events, job.jobId)

		expect((await call(routes, '/api/images/:id/statistics', 'POST', { id: info.id }, {})).status).toBe(200)
		expect(((await (await call(routes, '/api/images/:id/statistics', 'GET', { id: info.id })).json()) as ImageStatisticsJob[]).map((j) => j.jobId)).toEqual([job.jobId])
		expect((await call(routes, '/api/statistics/:jobId', 'GET', { jobId: job.jobId })).status).toBe(200)
		expect((await call(routes, '/api/statistics/:jobId/result', 'GET', { jobId: job.jobId })).status).toBe(200)
		expect(((await (await call(routes, '/api/statistics', 'GET', {})).json()) as { jobs: unknown[] }).jobs).toHaveLength(1)

		expect((await call(routes, '/api/images/:id/statistics', 'POST', { id: 'unknown' }, {})).status).toBe(404)
		expect((await call(routes, '/api/statistics/:jobId', 'GET', { jobId: 'unknown' })).status).toBe(404)
		const expired = await call(routes, '/api/statistics/:jobId/result', 'GET', { jobId: 'unknown' })
		expect(expired.status).toBe(404)
		expect(((await expired.json()) as { code: string }).code).toBe('expired')
		expect((await call(routes, '/api/statistics/:jobId/cancel', 'POST', { jobId: job.jobId })).status).toBe(404)
		images[Symbol.dispose]()
	})
})
