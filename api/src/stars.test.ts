import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { DetectedStar } from 'nebulosa/src/imaging/stars/detector'
import { ExternalToolsStore } from './externaltools'
import type { ApiError } from './http'
import { ImageStore } from './images'
import {
	acceptStars,
	aggregateHfd,
	cacheKey,
	createStarDetectionRoutes,
	DEFAULT_ASTAP_SETTINGS,
	DEFAULT_BUILTIN_SETTINGS,
	DEFAULT_STAR_ACCEPTANCE,
	isAcceptedStar,
	MAX_QUEUED,
	StarDetectionError,
	type StarDetectionEvent,
	type StarDetectionJob,
	type StarDetectionRequest,
	type StarDetectionResult,
	StarDetectionService,
} from './stars'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-stars-test-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

const WINDOWS = process.platform === 'win32'

// Size of a FITS block, in bytes.
const BLOCK = 2880

// Centres of the synthetic stars, 0-based pixel coordinates, and their peak above the background.
const STARS = [
	{ x: 60, y: 50, peak: 0.6 },
	{ x: 150.3, y: 80.7, peak: 0.5 },
	{ x: 200.5, y: 200.25, peak: 0.4 },
	{ x: 90.75, y: 180.5, peak: 0.45 },
	{ x: 30.2, y: 220.8, peak: 0.35 },
] as const

let files = 0

// Writes a 256×256 32-bit float FITS file of Gaussian stars (sigma in px, 1.5 by default) at STARS over a background of 0.1
// with deterministic noise, and returns its path.
function writeStarField(sigma = 1.5) {
	const width = 256
	const height = 256
	const cards = ['SIMPLE  =                    T', 'BITPIX  =                  -32', 'NAXIS   =                    2', `NAXIS1  = ${String(width).padStart(20)}`, `NAXIS2  = ${String(height).padStart(20)}`, 'END']
	const header = Buffer.alloc(BLOCK, ' ')
	for (const [i, card] of cards.entries()) header.write(card.padEnd(80), i * 80, 'latin1')
	const data = Buffer.alloc(Math.ceil((width * height * 4) / BLOCK) * BLOCK)
	let seed = 12345

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			seed = (seed * 1103515245 + 12345) % 2147483648
			let value = 0.1 + (seed / 2147483648 - 0.5) * 0.004
			for (const star of STARS) value += star.peak * Math.exp(-((x - star.x) ** 2 + (y - star.y) ** 2) / (2 * sigma * sigma))
			data.writeFloatBE(value, (y * width + x) * 4)
		}
	}

	const path = join(root, `field-${files++}.fits`)
	writeFileSync(path, Buffer.concat([header, data]))
	return path
}

// Writes an executable behaving like ASTAP's -extract (the input is its second argument): it writes the
// given CSV lines next to the input, then sleeps and exits.
function fakeAstap(csv: readonly string[], sleep = 0, exitCode = 0) {
	const directory = join(root, `astap-${files++}`)
	mkdirSync(directory)

	if (WINDOWS) {
		const lines = ['@echo off', ...csv.map((line) => `echo ${line}>> "%~dpn2.csv"`), ...(sleep > 0 ? [`ping -n ${sleep + 1} 127.0.0.1 >nul`] : []), `exit /b ${exitCode}`]
		const path = join(directory, 'astap.cmd')
		writeFileSync(path, lines.join('\r\n'))
		return path
	}

	const lines = ['#!/bin/sh', 'base="${2%.*}"', ...csv.map((line) => `echo '${line}' >> "$base.csv"`), ...(sleep > 0 ? [`sleep ${sleep}`] : []), `exit ${exitCode}`]
	const path = join(directory, 'astap')
	writeFileSync(path, lines.join('\n'))
	chmodSync(path, 0o755)
	return path
}

// Creates a service over its own image store and settings file, recording its events.
function setup() {
	const images = new ImageStore()
	const tools = new ExternalToolsStore(join(root, `settings-${files++}`, 'settings.json'))
	const events: StarDetectionEvent[] = []
	const service = new StarDetectionService(images, tools, (event) => events.push(event))
	return { images, tools, service, events }
}

// Saves the ASTAP settings of a store.
async function configureAstap(tools: ExternalToolsStore, executable: string, timeout = 60000) {
	const { revision } = await tools.get('astap')
	await tools.save('astap', { executable, timeout }, revision)
}

const BUILTIN: StarDetectionRequest = { detector: DEFAULT_BUILTIN_SETTINGS, acceptance: DEFAULT_STAR_ACCEPTANCE }
const ASTAP: StarDetectionRequest = { detector: DEFAULT_ASTAP_SETTINGS, acceptance: DEFAULT_STAR_ACCEPTANCE }

// Waits until a job ended and returns its last event.
async function ended(events: readonly StarDetectionEvent[], jobId: string, timeout = 20000) {
	const deadline = performance.now() + timeout

	while (performance.now() < deadline) {
		const last = events.findLast((event) => event.job.jobId === jobId)?.job
		if (last && last.state !== 'queued' && last.state !== 'running') return last
		await Bun.sleep(10)
	}

	throw new Error(`job ${jobId} did not end`)
}

// Submits a manual detection that must be accepted and returns its job.
async function submit(service: StarDetectionService, imageId: string, request: StarDetectionRequest = BUILTIN): Promise<StarDetectionJob> {
	const outcome = await service.submit(imageId, request)
	if (outcome.status !== 'accepted') throw new Error(`not accepted: ${outcome.status}`)
	return outcome.job
}

// Returns the star of a result closest to a position.
function nearest(result: StarDetectionResult, x: number, y: number) {
	let best = result.stars[0]
	for (const star of result.stars) if (Math.hypot(star.x - x, star.y - y) < Math.hypot(best.x - x, best.y - y)) best = star
	return best
}

type Handler = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>

type StarDetectionRoutes = ReturnType<typeof createStarDetectionRoutes>

// Calls a route of the star detection API.
function call(routes: StarDetectionRoutes, route: keyof StarDetectionRoutes, method: 'GET' | 'POST', params: Record<string, string>, body?: unknown) {
	const handler = (routes[route] as unknown as Record<string, Handler>)[method]
	const req = Object.assign(new Request('http://localhost/', { method, body: body === undefined ? undefined : JSON.stringify(body) }), { params })
	return Promise.resolve(handler(req))
}

function star(patch: Partial<DetectedStar> = {}): DetectedStar {
	return { x: 10, y: 10, hfd: 3, snr: 20, flux: 100, ...patch }
}

describe('acceptance', () => {
	test('accepts finite positive measurements inside the image', () => {
		expect(isAcceptedStar(star(), 100, 50, DEFAULT_STAR_ACCEPTANCE)).toBeTrue()
		expect(isAcceptedStar(star({ x: -0.5, y: 49.4 }), 100, 50, DEFAULT_STAR_ACCEPTANCE)).toBeTrue()
	})

	test('rejects non-finite or non-positive measurements and positions outside the image', () => {
		for (const patch of [{ x: Number.NaN }, { y: Number.POSITIVE_INFINITY }, { x: -0.6 }, { x: 99.5 }, { y: 49.5 }, { hfd: 0 }, { hfd: Number.NaN }, { snr: 0 }, { snr: Number.NaN }, { flux: -1 }, { flux: Number.POSITIVE_INFINITY }]) {
			expect(isAcceptedStar(star(patch), 100, 50, DEFAULT_STAR_ACCEPTANCE)).toBeFalse()
		}
	})

	test('applies the SNR and HFD limits and the edge margin', () => {
		const acceptance = { minSNR: 10, minHfd: 2, maxHfd: 5, edgeMargin: 5 }
		expect(isAcceptedStar(star(), 100, 50, acceptance)).toBeTrue()
		expect(isAcceptedStar(star({ snr: 9 }), 100, 50, acceptance)).toBeFalse()
		expect(isAcceptedStar(star({ hfd: 1.9 }), 100, 50, acceptance)).toBeFalse()
		expect(isAcceptedStar(star({ hfd: 5.1 }), 100, 50, acceptance)).toBeFalse()
		expect(isAcceptedStar(star({ x: 4 }), 100, 50, acceptance)).toBeFalse()
		expect(isAcceptedStar(star({ y: 45 }), 100, 50, acceptance)).toBeFalse()
	})

	test('acceptStars is by index', () => {
		expect(acceptStars([star(), star({ hfd: -1 }), star()], 100, 50, DEFAULT_STAR_ACCEPTANCE)).toEqual([true, false, true])
	})
})

describe('aggregate HFD', () => {
	test('is the median of the accepted stars', () => {
		const stars = [star({ hfd: 4 }), star({ hfd: 2 }), star({ hfd: 100 }), star({ hfd: 3 })]
		expect(aggregateHfd(stars, [true, true, false, true])).toBe(3)
		expect(aggregateHfd(stars, [true, true, true, true])).toBe(3.5)
	})

	test('is unavailable with fewer than three accepted stars', () => {
		expect(aggregateHfd([], [])).toBeUndefined()
		expect(aggregateHfd([star(), star()], [true, true])).toBeUndefined()
		expect(aggregateHfd([star(), star(), star()], [true, true, false])).toBeUndefined()
	})

	test('is deterministic', () => {
		const stars = [star({ hfd: 2.5 }), star({ hfd: 1.5 }), star({ hfd: 3.25 })]
		expect(aggregateHfd(stars, [true, true, true])).toBe(aggregateHfd(stars.toReversed(), [true, true, true]))
	})
})

describe('cache key', () => {
	test('changes with the settings and the ASTAP executable but not its timeout', () => {
		expect(cacheKey('a', BUILTIN)).toBe(cacheKey('a', { ...BUILTIN }))
		expect(cacheKey('a', BUILTIN)).not.toBe(cacheKey('b', BUILTIN))
		expect(cacheKey('a', BUILTIN)).not.toBe(cacheKey('a', { ...BUILTIN, detector: { ...DEFAULT_BUILTIN_SETTINGS, minSNR: 5 } }))
		expect(cacheKey('a', BUILTIN)).not.toBe(cacheKey('a', { ...BUILTIN, acceptance: { ...DEFAULT_STAR_ACCEPTANCE, edgeMargin: 1 } }))
		expect(cacheKey('a', ASTAP, { executable: 'x', timeout: 1000 })).toBe(cacheKey('a', ASTAP, { executable: 'x', timeout: 2000 }))
		expect(cacheKey('a', ASTAP, { executable: 'x', timeout: 1000 })).not.toBe(cacheKey('a', ASTAP, { executable: 'y', timeout: 1000 }))
	})
})

describe('built-in detection', () => {
	test('finds the stars of a known field at their positions', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeStarField())
		const job = await submit(service, info.id)
		const last = await ended(events, job.jobId)

		expect(last.state).toBe('completed')
		expect(events.filter((event) => event.job.jobId === job.jobId).map((event) => event.job.state)).toEqual(['queued', 'running', 'completed'])
		expect(last.summary!.measurement).toBe('ok')

		const result = service.result(job.jobId)!
		expect(result.width).toBe(256)
		expect(result.height).toBe(256)
		expect(result.detectedCount).toBeGreaterThanOrEqual(STARS.length)
		expect(result.accepted).toHaveLength(result.stars.length)

		for (const { x, y } of STARS) {
			const found = nearest(result, x, y)
			expect(Math.abs(found.x - x)).toBeLessThan(0.2)
			expect(Math.abs(found.y - y)).toBeLessThan(0.2)
			expect(found.hfd).toBeGreaterThan(1)
		}

		expect(result.aggregateHfd).toBeGreaterThan(1)
		expect(service.results(info.id).map((job) => job.jobId)).toEqual([job.jobId])
	})

	test('answers an equivalent request from the kept result and runs a different one', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeStarField())
		const first = await submit(service, info.id)
		await ended(events, first.jobId)

		const again = await service.submit(info.id, BUILTIN)
		expect(again.status).toBe('cached')
		if (again.status === 'cached') expect(again.job.jobId).toBe(first.jobId)

		const other = await service.submit(info.id, { ...BUILTIN, acceptance: { ...DEFAULT_STAR_ACCEPTANCE, minSNR: 1 } })
		expect(other.status).toBe('accepted')
	})

	test('an image without stars is completed with no measurement, never an HFD of 0', async () => {
		const { images, service, events } = setup()
		const cards = ['SIMPLE  =                    T', 'BITPIX  =                    8', 'NAXIS   =                    2', 'NAXIS1  =                   64', 'NAXIS2  =                   64', 'END']
		const header = Buffer.alloc(BLOCK, ' ')
		for (const [i, card] of cards.entries()) header.write(card.padEnd(80), i * 80, 'latin1')
		const path = join(root, `flat-${files++}.fits`)
		writeFileSync(path, Buffer.concat([header, Buffer.alloc(2 * BLOCK, 100)]))
		const info = await images.open(path)
		const job = await submit(service, info.id)
		const last = await ended(events, job.jobId)

		expect(last.state).toBe('completed')
		expect(last.summary).toMatchObject({ detectedCount: 0, acceptedCount: 0, measurement: 'noStars' })
		expect(last.summary!.aggregateHfd).toBeUndefined()
	})

	test('runs one detection at a time and keeps the others waiting', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeStarField())
		const jobs = await Promise.all([1, 2, 3].map((minSNR) => submit(service, info.id, { ...BUILTIN, detector: { ...DEFAULT_BUILTIN_SETTINGS, minSNR } })))
		for (const job of jobs) expect((await ended(events, job.jobId)).state).toBe('completed')

		let running = 0
		let most = 0

		for (const { job } of events) {
			if (job.state === 'running') most = Math.max(most, ++running)
			else if (job.state !== 'queued') running--
		}

		expect(most).toBe(1)
	})

	test('cancels a waiting and a running job, and keeps detecting afterwards', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeStarField())
		const running = await submit(service, info.id)
		const waiting = await submit(service, info.id, { ...BUILTIN, detector: { ...DEFAULT_BUILTIN_SETTINGS, minSNR: 1 } })

		expect(service.cancel(waiting.jobId)).toBeTrue()
		expect(service.cancel(running.jobId)).toBeTrue()
		expect(await ended(events, waiting.jobId)).toMatchObject({ state: 'cancelled', code: 'cancelled' })
		expect(await ended(events, running.jobId)).toMatchObject({ state: 'cancelled', code: 'cancelled' })
		expect(service.cancel(running.jobId)).toBeFalse()

		const next = await submit(service, info.id, { ...BUILTIN, detector: { ...DEFAULT_BUILTIN_SETTINGS, minSNR: 2 } })
		expect((await ended(events, next.jobId)).state).toBe('completed')
	})

	test('refuses jobs beyond the queue limit', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeStarField())
		const outcomes = await Promise.all(Array.from({ length: MAX_QUEUED + 4 }, (_, i) => service.submit(info.id, { ...BUILTIN, detector: { ...DEFAULT_BUILTIN_SETTINGS, minSNR: i } })))

		expect(outcomes.filter((outcome) => outcome.status === 'queueFull').length).toBeGreaterThan(0)
		for (const outcome of outcomes) if (outcome.status === 'accepted') service.cancel(outcome.job.jobId)
		for (const outcome of outcomes) if (outcome.status === 'accepted') await ended(events, outcome.job.jobId)
	})

	test('keeps the pixels of an image closed while its job waits, then drops its results', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeStarField())
		const first = await submit(service, info.id)
		const second = await submit(service, info.id, { ...BUILTIN, detector: { ...DEFAULT_BUILTIN_SETTINGS, minSNR: 1 } })

		expect(images.close(info.id)).toBeTrue()
		expect(await service.submit(info.id, BUILTIN)).toEqual({ status: 'missing' })
		expect((await ended(events, first.jobId)).state).toBe('completed')
		expect((await ended(events, second.jobId)).state).toBe('completed')

		// The last job released the image, and its results with it.
		expect(service.result(second.jobId)).toBeUndefined()
		expect(service.results(info.id)).toEqual([])
		expect(service.job(second.jobId)?.state).toBe('completed')
	})

	test('measure resolves to the result and rejects once cancelled', async () => {
		const { images, service } = setup()
		const info = await images.open(writeStarField())
		const result = await service.measure(info.id, BUILTIN)

		expect(result.measurement).toBe('ok')
		expect(result.aggregateHfd).toBeGreaterThan(1)

		const controller = new AbortController()
		const measuring = service.measure(info.id, { ...BUILTIN, detector: { ...DEFAULT_BUILTIN_SETTINGS, minSNR: 1 } }, controller.signal)
		controller.abort()
		const error = await measuring.catch((error: unknown) => error)

		expect(error).toBeInstanceOf(StarDetectionError)
		expect((error as StarDetectionError).code).toBe('cancelled')
	})

	test('a larger maximum radius measures the HFD of defocused stars the fixed aperture cannot', async () => {
		const { images, service } = setup()
		const info = await images.open(writeStarField(4))
		const fixed = await service.measure(info.id, BUILTIN)
		const grown = await service.measure(info.id, { ...BUILTIN, detector: { ...DEFAULT_BUILTIN_SETTINGS, maximumRadius: 32 } })

		// A Gaussian of sigma 4 px has an HFD of about 2.355 × 4 = 9.4 px.
		expect(grown.aggregateHfd).toBeGreaterThan(8.5)
		expect(grown.aggregateHfd).toBeLessThan(10.5)
		expect(fixed.aggregateHfd === undefined || fixed.aggregateHfd < grown.aggregateHfd! - 1).toBeTrue()
	})

	test('measure declares its origin on the job', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeStarField())
		const origin = { kind: 'autofocus', sessionId: 's', connectionId: 'c', deviceId: 'd', frameId: 'op:1', capture: 1 } as const
		await service.measure(info.id, BUILTIN, undefined, origin)

		expect(events.at(-1)!.job.origin).toEqual(origin)
	})
})

describe('ASTAP detection', () => {
	test('runs the configured executable on a copy of the image and removes it', async () => {
		const { images, tools, service, events } = setup()
		await configureAstap(tools, fakeAstap(['x,y,hfd,snr,flux', '61,51,2.5,40,1000', '151.3,81.7,3,30,800', '201.5,201.25,2.75,20,500']))
		const before = readdirSync(tmpdir()).filter((name) => name.startsWith('nebulosa-stars-')).length
		const info = await images.open(writeStarField())
		const job = await submit(service, info.id, ASTAP)
		const last = await ended(events, job.jobId)

		expect(last.state).toBe('completed')
		const result = service.result(job.jobId)!
		expect(result.stars[0]).toEqual({ x: 60, y: 50, hfd: 2.5, snr: 40, flux: 1000 })
		expect(result.aggregateHfd).toBe(2.75)
		expect(result.tool?.executable).toContain('astap')
		expect(readdirSync(tmpdir()).filter((name) => name.startsWith('nebulosa-stars-')).length).toBeLessThanOrEqual(before)
	})

	test('is refused when ASTAP is not configured', async () => {
		const { images, service } = setup()
		const info = await images.open(writeStarField())
		expect(await service.submit(info.id, ASTAP)).toEqual({ status: 'astapUnavailable' })

		const response = await call(createStarDetectionRoutes(service), '/api/images/:id/stars', 'POST', { id: info.id }, ASTAP)
		expect(response.status).toBe(422)
		expect(((await response.json()) as { code: string }).code).toBe('astapUnavailable')
	})

	test('reports a missing executable, a timeout, and a failed run', async () => {
		const { images, tools, service, events } = setup()
		const info = await images.open(writeStarField())

		await configureAstap(tools, join(root, 'missing', WINDOWS ? 'astap.exe' : 'astap'))
		const missing = await submit(service, info.id, ASTAP)
		expect(await ended(events, missing.jobId)).toMatchObject({ state: 'failed', code: 'astapUnavailable' })

		await configureAstap(tools, fakeAstap([], 5), 1000)
		const slow = await submit(service, info.id, { ...ASTAP, detector: { ...DEFAULT_ASTAP_SETTINGS, minSNR: 1 } })
		expect(await ended(events, slow.jobId)).toMatchObject({ state: 'failed', code: 'astapTimeout' })

		await configureAstap(tools, fakeAstap([], 0, 1))
		const failed = await submit(service, info.id, { ...ASTAP, detector: { ...DEFAULT_ASTAP_SETTINGS, minSNR: 2 } })
		expect(await ended(events, failed.jobId)).toMatchObject({ state: 'failed', code: 'astapFailed' })
	}, 30000)

	test('a job keeps the settings it was submitted with', async () => {
		const { images, tools, service, events } = setup()
		const info = await images.open(writeStarField())
		await configureAstap(tools, fakeAstap(['x,y,hfd,snr,flux', '11,11,2,10,100'], 1))
		const job = await submit(service, info.id, ASTAP)
		await configureAstap(tools, join(root, 'missing', 'astap'))

		expect((await ended(events, job.jobId)).state).toBe('completed')
	}, 15000)
})

describe('routes', () => {
	test('submit, read, list, and cancel', async () => {
		const { images, service, events } = setup()
		const routes = createStarDetectionRoutes(service)
		const info = await images.open(writeStarField())

		const accepted = await call(routes, '/api/images/:id/stars', 'POST', { id: info.id }, BUILTIN)
		expect(accepted.status).toBe(202)
		const job = (await accepted.json()) as StarDetectionJob
		await ended(events, job.jobId)

		expect((await call(routes, '/api/images/:id/stars', 'POST', { id: info.id }, BUILTIN)).status).toBe(200)
		expect((await call(routes, '/api/stars/:jobId', 'GET', { jobId: job.jobId })).status).toBe(200)
		expect(((await (await call(routes, '/api/stars/:jobId/result', 'GET', { jobId: job.jobId })).json()) as StarDetectionResult).stars.length).toBeGreaterThan(0)
		expect(((await (await call(routes, '/api/images/:id/stars', 'GET', { id: info.id })).json()) as StarDetectionJob[]).map((job) => job.jobId)).toEqual([job.jobId])
		expect(((await (await call(routes, '/api/stars', 'GET', {})).json()) as { jobs: StarDetectionJob[] }).jobs.map((job) => job.jobId)).toContain(job.jobId)
		expect((await call(routes, '/api/images/:id/stars', 'POST', { id: 'unknown' }, BUILTIN)).status).toBe(404)
		expect((await call(routes, '/api/stars/:jobId/result', 'GET', { jobId: 'unknown' })).status).toBe(404)
		const cancelled = await call(routes, '/api/stars/:jobId/cancel', 'POST', { jobId: job.jobId })
		expect(cancelled.status).toBe(404)
		expect(((await cancelled.json()) as ApiError).code).toBe('notFound')
	})
})
