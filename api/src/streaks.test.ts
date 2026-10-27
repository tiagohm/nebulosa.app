import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PI } from 'nebulosa/src/core/constants'
import { DEFAULT_STREAK_DETECTION_OPTIONS, type Streak } from 'nebulosa/src/imaging/analysis/streak/types'
import { ExternalToolsStore } from './externaltools'
import { ImageStore } from './images'
import { PlateSolvingService, type PlateSolveResult } from './platesolving'
import { DEFAULT_BUILTIN_SETTINGS, DEFAULT_STAR_ACCEPTANCE, StarDetectionService } from './stars'
import { countClasses, createStreakDetectionRoutes, MAX_QUEUED, streakCacheKey, type StreakDetectionEvent, type StreakDetectionJob, type StreakDetectionRequest, StreakDetectionService, type StreakDetectionServiceOptions } from './streaks'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-streaks-test-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

// Size of a FITS block, in bytes.
const BLOCK = 2880

// Side of the synthetic images, in pixels.
const SIZE = 256

// Endpoints of the synthetic streak, 0-based pixel coordinates.
const START = { x: 40, y: 60 }
const END = { x: 200, y: 120 }

// TAN WCS of the synthetic images: 2″/px around RA 10h, Dec +20°.
const WCS_CARDS = [
	"CTYPE1  = 'RA---TAN'",
	"CTYPE2  = 'DEC--TAN'",
	'CRVAL1  =                150.0',
	'CRVAL2  =                 20.0',
	'CRPIX1  =                128.5',
	'CRPIX2  =                128.5',
	'CD1_1   =      -0.000555555556',
	'CD1_2   =                  0.0',
	'CD2_1   =                  0.0',
	'CD2_2   =       0.000555555556',
]

let files = 0

// Formats a FITS card of a numeric value.
function card(key: string, value: number) {
	return `${key.padEnd(8)}= ${String(value).padStart(20)}`
}

// Returns the Gaussian profile, of peak 1, of a segment at a pixel: its distance to the segment, sigma in px.
function profile(x: number, y: number, sigma: number) {
	const dx = END.x - START.x
	const dy = END.y - START.y
	const t = Math.max(0, Math.min(1, ((x - START.x) * dx + (y - START.y) * dy) / (dx * dx + dy * dy)))
	const d2 = (x - START.x - t * dx) ** 2 + (y - START.y - t * dy) ** 2
	return Math.exp(-d2 / (2 * sigma * sigma))
}

// Writes a SIZE×SIZE FITS file of a background with deterministic noise, with the streak from START to END unless
// streak is false, and returns its path. cfa writes a 16-bit mosaic with that BAYERPAT; otherwise a 32-bit float image.
function writeStreakField({ streak = true, cfa, extra = [] }: { streak?: boolean; cfa?: string; extra?: readonly string[] } = {}) {
	const bitpix = cfa ? 16 : -32
	const cards = ['SIMPLE  =                    T', card('BITPIX', bitpix), 'NAXIS   =                    2', card('NAXIS1', SIZE), card('NAXIS2', SIZE), ...(cfa ? [`BAYERPAT= '${cfa.padEnd(8)}'`] : []), ...extra, 'END']
	const header = Buffer.alloc(Math.ceil((cards.length * 80) / BLOCK) * BLOCK, ' ')
	for (const [i, line] of cards.entries()) header.write(line.padEnd(80), i * 80, 'latin1')
	const bytes = bitpix === 16 ? 2 : 4
	const data = Buffer.alloc(Math.ceil((SIZE * SIZE * bytes) / BLOCK) * BLOCK)
	let seed = 4242

	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			seed = (seed * 1103515245 + 12345) % 2147483648
			const value = 0.1 + (seed / 2147483648 - 0.5) * 0.004 + (streak ? 0.2 * profile(x, y, 1.2) : 0)
			const offset = (y * SIZE + x) * bytes
			if (bitpix === 16) data.writeInt16BE(Math.round(value * 30000), offset)
			else data.writeFloatBE(value, offset)
		}
	}

	const path = join(root, `streak-${files++}.fits`)
	writeFileSync(path, Buffer.concat([header, data]))
	return path
}

// Creates a service over its own image store and plate solving and star detection services, recording its events.
function setup(options?: StreakDetectionServiceOptions) {
	const images = new ImageStore()
	const tools = new ExternalToolsStore(join(root, `settings-${files++}`, 'settings.json'))
	const plateSolving = new PlateSolvingService(images, tools, () => {})
	const stars = new StarDetectionService(images, tools, () => {})
	const events: StreakDetectionEvent[] = []
	const service = new StreakDetectionService(images, plateSolving, stars, (event) => events.push(event), options)
	return { images, tools, plateSolving, stars, service, events }
}

const REQUEST: StreakDetectionRequest = { settings: DEFAULT_STREAK_DETECTION_OPTIONS }

// Returns a request with other settings.
function withSettings(patch: Partial<StreakDetectionRequest['settings']>): StreakDetectionRequest {
	return { settings: { ...DEFAULT_STREAK_DETECTION_OPTIONS, ...patch } }
}

// Waits until a job ended and returns its last event.
async function ended(events: readonly StreakDetectionEvent[], jobId: string, timeout = 20000) {
	const deadline = performance.now() + timeout

	while (performance.now() < deadline) {
		const last = events.findLast((event) => event.job.jobId === jobId)?.job
		if (last && last.state !== 'queued' && last.state !== 'running') return last
		await Bun.sleep(10)
	}

	throw new Error(`job ${jobId} did not end`)
}

// Submits a detection that must be accepted and returns its job.
function submit(service: StreakDetectionService, imageId: string, request: StreakDetectionRequest = REQUEST): StreakDetectionJob {
	const outcome = service.submit(imageId, request)
	if (outcome.status !== 'accepted') throw new Error(`not accepted: ${outcome.status}`)
	return outcome.job
}

// Expects a streak to join START and END, in either order, within tolerance px.
function expectSegment(streak: Streak, tolerance: number) {
	const [left, right] = streak.start.x <= streak.end.x ? [streak.start, streak.end] : [streak.end, streak.start]
	expect(Math.abs(left.x - START.x)).toBeLessThan(tolerance)
	expect(Math.abs(left.y - START.y)).toBeLessThan(tolerance)
	expect(Math.abs(right.x - END.x)).toBeLessThan(tolerance)
	expect(Math.abs(right.y - END.y)).toBeLessThan(tolerance)
	expect(Math.abs(streak.angle - Math.atan2(END.y - START.y, END.x - START.x))).toBeLessThan(0.02)
}

type Handler = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>

type StreakDetectionRoutes = ReturnType<typeof createStreakDetectionRoutes>

// Calls a route of the streak detection API.
function call(routes: StreakDetectionRoutes, route: keyof StreakDetectionRoutes, method: 'GET' | 'POST', params: Record<string, string>, body?: unknown) {
	const handler = (routes[route] as unknown as Record<string, Handler>)[method]
	const req = Object.assign(new Request('http://localhost/', { method, body: body === undefined ? undefined : JSON.stringify(body) }), { params })
	return Promise.resolve(handler(req))
}

describe('cache key', () => {
	test('changes with the image, the settings, and the context jobs', () => {
		expect(streakCacheKey('a', REQUEST)).toBe(streakCacheKey('a', { settings: { ...DEFAULT_STREAK_DETECTION_OPTIONS } }))
		expect(streakCacheKey('a', REQUEST)).not.toBe(streakCacheKey('b', REQUEST))
		expect(streakCacheKey('a', REQUEST)).not.toBe(streakCacheKey('a', withSettings({ minSNR: 6 })))
		expect(streakCacheKey('a', REQUEST)).not.toBe(streakCacheKey('a', { ...REQUEST, plateSolveJobId: 'p' }))
		expect(streakCacheKey('a', REQUEST)).not.toBe(streakCacheKey('a', { ...REQUEST, starDetectionJobId: 's' }))
	})

	test('counts the classes', () => {
		const classification = (name: 'unknown' | 'satellite') => ({ class: name, confidence: 0, alternatives: [], evidence: [] })
		expect(countClasses([classification('unknown'), classification('satellite'), classification('unknown')])).toEqual({ unknown: 2, satellite: 1 })
	})
})

describe('detection', () => {
	test('finds a streak at its position in a mono image and classifies it', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeStreakField())
		const job = submit(service, info.id)
		const last = await ended(events, job.jobId)

		expect(last.state).toBe('completed')
		expect(events.filter((event) => event.job.jobId === job.jobId).map((event) => event.job.state)).toEqual(['queued', 'running', 'completed'])
		for (const event of events) expect('streaks' in event.job).toBeFalse()

		const result = service.result(job.jobId)!
		expect(result).toMatchObject({ width: SIZE, height: SIZE, detectedCount: 1, classified: true })
		expect(result.streaks).toHaveLength(1)
		expect(result.classifications).toHaveLength(1)
		expectSegment(result.streaks[0], 3)
		expect(result.streaks[0].confidence).toBeGreaterThan(0)
		expect(last.summary!.classes).toEqual(countClasses(result.classifications!))
		expect(service.results(info.id).map((job) => job.jobId)).toEqual([job.jobId])
	})

	test('reports the geometry of a CFA mosaic in image pixels', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeStreakField({ cfa: 'RGGB' }))
		expect(info.cfa).toBe('RGGB')
		const job = submit(service, info.id)

		expect((await ended(events, job.jobId)).state).toBe('completed')
		const result = service.result(job.jobId)!
		expect(result.streaks).toHaveLength(1)
		expectSegment(result.streaks[0], 4)
	})

	test('an image without streaks is completed with none', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeStreakField({ streak: false }))
		const job = submit(service, info.id)
		const last = await ended(events, job.jobId)

		expect(last.state).toBe('completed')
		expect(last.summary).toMatchObject({ detectedCount: 0, classified: true, classes: {} })
		expect(service.result(job.jobId)!.streaks).toEqual([])
	})

	test('fails with the reason of the toolkit when it refuses the settings', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeStreakField())
		const job = submit(service, info.id, withSettings({ angleStep: PI / 4096, orientationTolerance: PI / 2 }))
		const last = await ended(events, job.jobId)

		expect(last).toMatchObject({ state: 'failed', code: 'detectionFailed' })
		expect(last.error).toContain('Hough')

		// The worker that refused the request still detects.
		const next = submit(service, info.id)
		expect((await ended(events, next.jobId)).state).toBe('completed')
	})

	test('fails with a timeout when the detection runs too long', async () => {
		const { images, service, events } = setup({ timeout: 1 })
		const info = await images.open(writeStreakField())
		const job = submit(service, info.id)
		expect(await ended(events, job.jobId)).toMatchObject({ state: 'failed', code: 'timeout' })
	})
})

describe('scheduling', () => {
	test('answers an equivalent request with the active job, then with the kept result', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeStreakField())
		const first = submit(service, info.id)

		const active = service.submit(info.id, REQUEST)
		expect(active).toEqual({ status: 'active', job: expect.objectContaining({ jobId: first.jobId }) })
		await ended(events, first.jobId)

		const cached = service.submit(info.id, REQUEST)
		expect(cached.status).toBe('cached')
		if (cached.status === 'cached') expect(cached.job.jobId).toBe(first.jobId)
		expect(service.submit(info.id, withSettings({ minLength: 20 })).status).toBe('accepted')
	})

	test('cancels a waiting and a running job, and keeps detecting afterwards', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeStreakField())
		const running = submit(service, info.id)
		const waiting = submit(service, info.id, withSettings({ minSNR: 6 }))

		expect(service.cancel(waiting.jobId)).toBeTrue()
		expect(service.cancel(running.jobId)).toBeTrue()
		expect(await ended(events, waiting.jobId)).toMatchObject({ state: 'cancelled', code: 'cancelled' })
		expect(await ended(events, running.jobId)).toMatchObject({ state: 'cancelled', code: 'cancelled' })
		expect(events.some((event) => event.job.jobId === waiting.jobId && event.job.state === 'running')).toBeFalse()
		expect(service.cancel(running.jobId)).toBeFalse()

		const next = submit(service, info.id, withSettings({ minSNR: 7 }))
		expect((await ended(events, next.jobId)).state).toBe('completed')
	})

	test('refuses jobs beyond the queue limit', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeStreakField())
		const outcomes = Array.from({ length: MAX_QUEUED + 4 }, (_, i) => service.submit(info.id, withSettings({ minLength: 12 + i })))

		expect(outcomes.filter((outcome) => outcome.status === 'queueFull').length).toBeGreaterThan(0)
		for (const outcome of outcomes) if (outcome.status === 'accepted') service.cancel(outcome.job.jobId)
		for (const outcome of outcomes) if (outcome.status === 'accepted') await ended(events, outcome.job.jobId)
	})

	test('keeps the pixels of an image closed while its job runs, then drops its result', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeStreakField())
		const job = submit(service, info.id)

		expect(images.close(info.id)).toBeTrue()
		expect(service.submit(info.id, REQUEST)).toEqual({ status: 'missing' })
		expect((await ended(events, job.jobId)).state).toBe('completed')
		expect(service.result(job.jobId)).toBeUndefined()
		expect(service.job(job.jobId)?.state).toBe('completed')
	})
})

describe('classification context', () => {
	test('uses the WCS and the acquisition data of the header', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeStreakField({ extra: [...WCS_CARDS, "DATE-OBS= '2026-10-27T03:00:00'", card('EXPTIME', 30)] }))
		const job = submit(service, info.id)

		expect(job.context).toEqual({ wcs: 'header', exposure: 30, date: '2026-10-27T03:00:00.000Z' })
		expect((await ended(events, job.jobId)).state).toBe('completed')
		expect(service.result(job.jobId)!.context).toEqual(job.context)
	})

	test('has no WCS nor acquisition data when the header has none', async () => {
		const { images, service } = setup()
		const info = await images.open(writeStreakField())
		expect(submit(service, info.id).context).toEqual({})
	})

	test('uses the accepted stars of a completed star detection of the same image', async () => {
		const { images, stars, service, events } = setup()
		const info = await images.open(writeStreakField())
		const detection = await stars.measure(info.id, { detector: DEFAULT_BUILTIN_SETTINGS, acceptance: DEFAULT_STAR_ACCEPTANCE })
		const accepted = detection.accepted.filter(Boolean).length
		const job = submit(service, info.id, { ...REQUEST, starDetectionJobId: detection.jobId })

		expect(job.context).toEqual({ starDetectionJobId: detection.jobId, starCount: accepted })
		expect((await ended(events, job.jobId)).state).toBe('completed')
	})

	test('uses the solution of a plate solving job of the same image', async () => {
		const images = new ImageStore()
		const info = await images.open(writeStreakField())
		const solved = { jobId: 'p', imageId: info.id, solution: { CTYPE1: 'RA---TAN' } } as unknown as PlateSolveResult
		const plateSolving = { result: (jobId: string) => (jobId === 'p' ? solved : undefined), solutions: () => ({ jobs: [] }) }
		const service = new StreakDetectionService(images, plateSolving, { result: () => undefined }, () => {})

		const outcome = service.submit(info.id, { ...REQUEST, plateSolveJobId: 'p' })
		expect(outcome.status).toBe('accepted')
		if (outcome.status === 'accepted') expect(outcome.job.context).toEqual({ wcs: 'plateSolve', plateSolveJobId: 'p' })
		if (outcome.status === 'accepted') service.cancel(outcome.job.jobId)
	})

	test('refuses context jobs that are unknown, of another image, or without a solution', async () => {
		const images = new ImageStore()
		const info = await images.open(writeStreakField())
		const results: Record<string, PlateSolveResult> = {
			other: { jobId: 'other', imageId: 'another', solution: {} } as unknown as PlateSolveResult,
			unsolved: { jobId: 'unsolved', imageId: info.id } as unknown as PlateSolveResult,
		}
		const plateSolving = { result: (jobId: string) => results[jobId], solutions: () => ({ jobs: [] }) }
		const service = new StreakDetectionService(images, plateSolving, { result: () => undefined }, () => {})

		for (const plateSolveJobId of ['unknown', 'other', 'unsolved']) expect(service.submit(info.id, { ...REQUEST, plateSolveJobId }).status).toBe('contextUnavailable')
		expect(service.submit(info.id, { ...REQUEST, starDetectionJobId: 'unknown' }).status).toBe('contextUnavailable')
	})
})

describe('routes', () => {
	test('submit, job, result, snapshot, and cancel', async () => {
		const { images, service, events } = setup()
		const routes = createStreakDetectionRoutes(service)
		const info = await images.open(writeStreakField())

		expect((await call(routes, '/api/images/:id/streaks', 'POST', { id: 'missing' }, REQUEST)).status).toBe(404)
		const unavailable = await call(routes, '/api/images/:id/streaks', 'POST', { id: info.id }, { ...REQUEST, starDetectionJobId: 'unknown' })
		expect(unavailable.status).toBe(422)
		expect(await unavailable.json()).toMatchObject({ code: 'contextUnavailable' })

		const accepted = await call(routes, '/api/images/:id/streaks', 'POST', { id: info.id }, REQUEST)
		expect(accepted.status).toBe(202)
		const job = (await accepted.json()) as StreakDetectionJob
		expect((await call(routes, '/api/images/:id/streaks', 'POST', { id: info.id }, REQUEST)).status).toBe(202)
		expect((await call(routes, '/api/streaks/:jobId/result', 'GET', { jobId: job.jobId })).status).toBe(404)
		await ended(events, job.jobId)

		expect((await call(routes, '/api/images/:id/streaks', 'POST', { id: info.id }, REQUEST)).status).toBe(200)
		expect(((await (await call(routes, '/api/streaks/:jobId/result', 'GET', { jobId: job.jobId })).json()) as { streaks: unknown[] }).streaks).toHaveLength(1)
		expect(((await (await call(routes, '/api/streaks/:jobId', 'GET', { jobId: job.jobId })).json()) as StreakDetectionJob).state).toBe('completed')
		expect((await call(routes, '/api/streaks/:jobId', 'GET', { jobId: 'unknown' })).status).toBe(404)
		expect(((await (await call(routes, '/api/streaks', 'GET', {})).json()) as { jobs: StreakDetectionJob[] }).jobs.map((job) => job.jobId)).toContain(job.jobId)
		expect(((await (await call(routes, '/api/images/:id/streaks', 'GET', { id: info.id })).json()) as StreakDetectionJob[]).map((job) => job.jobId)).toEqual([job.jobId])
		expect((await call(routes, '/api/streaks/:jobId/cancel', 'POST', { jobId: job.jobId })).status).toBe(404)
	})
})
