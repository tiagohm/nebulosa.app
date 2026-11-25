import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pixelScale } from 'nebulosa/src/astronomy/formulas'
import { readFits } from 'nebulosa/src/io/formats/fits/fits'
import { bufferSource } from 'nebulosa/src/io/io'
import { arcsec, deg, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { AppDatabase } from './database'
import { ExternalToolsStore } from './externaltools'
import { ImageStore } from './images'
import { createPlateSolvingRoutes, plateSolveCacheKey, type PlateSolutions, type PlateSolveJob, type PlateSolveRequest, type PlateSolvingEvent, PlateSolvingService, validatedSolution } from './platesolving'
import { DEFAULT_SEARCH_RADIUS, resolvePlateSolveHints } from './platesolving.hints'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-plate-solving-test-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

let files = 0

// Header cards of an 80-character FITS card each.
function cards(entries: Readonly<Record<string, string | number>>) {
	return Object.entries(entries).map(([key, value]) => `${key.padEnd(8)}= ${typeof value === 'string' ? `'${value}'` : value}`.padEnd(80))
}

// Pads FITS header cards, END included, to whole 2880-byte blocks.
function headerBlock(lines: readonly string[]) {
	const text = [...lines, 'END'.padEnd(80)].join('')
	return Buffer.from(text.padEnd(Math.ceil(text.length / 2880) * 2880), 'latin1')
}

// Writes a 100×50 8-bit FITS image with extra header keywords and returns its path.
function writeImage(extra: Readonly<Record<string, string | number>> = {}) {
	const header = headerBlock(cards({ SIMPLE: 'T', BITPIX: 8, NAXIS: 2, NAXIS1: 100, NAXIS2: 50, ...extra }).map((card) => card.replace("'T'", 'T'.padStart(3))))
	const path = join(root, `image-${files++}.fits`)
	writeFileSync(path, Buffer.concat([header, Buffer.alloc(2880 * 2)]))
	return path
}

// A TAN solution of a 100×50 image without NAXIS1/NAXIS2.
const WCS = { CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN', CRPIX1: 50.5, CRPIX2: 25.5, CRVAL1: 42, CRVAL2: -17, CD1_1: 0.0005, CD1_2: 0, CD2_1: 0, CD2_2: 0.0005 } as const

// Creates a service over its own image store and settings, recording its events. Its index folder is empty, so every
// search ends at once without a solution.
function setup() {
	const images = new ImageStore()
	const indexes = join(root, `indexes-${files++}`)
	mkdirSync(indexes)
	const tools = new ExternalToolsStore(AppDatabase.memory(), undefined, undefined, indexes)
	const events: PlateSolvingEvent[] = []
	const service = new PlateSolvingService(images, tools, (event) => events.push(event))
	return { images, tools, service, events }
}

// Waits until a job ended and returns its last event.
async function ended(events: readonly PlateSolvingEvent[], jobId: string, timeout = 20000) {
	const deadline = performance.now() + timeout

	while (performance.now() < deadline) {
		const last = events.findLast((event) => event.job.jobId === jobId)?.job
		if (last && last.state !== 'queued' && last.state !== 'running') return last
		await Bun.sleep(10)
	}

	throw new Error(`job ${jobId} did not end`)
}

// Submits a manual solve that must be accepted and returns its job.
async function submit(service: PlateSolvingService, imageId: string, request: PlateSolveRequest): Promise<PlateSolveJob> {
	const outcome = await service.submit(imageId, request)
	if (outcome.status !== 'accepted') throw new Error(`not accepted: ${outcome.status}`)
	return outcome.job
}

type Handler = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>

type PlateSolvingRoutes = ReturnType<typeof createPlateSolvingRoutes>

// Calls a route of the plate solving API.
function call(routes: PlateSolvingRoutes, route: keyof PlateSolvingRoutes, method: 'GET' | 'POST', params: Record<string, string>, body?: unknown) {
	const handler = (routes[route] as unknown as Record<string, Handler>)[method]
	const req = Object.assign(new Request('http://localhost/', { method, body: body === undefined ? undefined : JSON.stringify(body) }), { params })
	return Promise.resolve(handler(req))
}

const ASSISTED: PlateSolveRequest = { strategy: 'assisted' }

describe('hints', () => {
	const header = { RA: 42, DEC: -17, XPIXSZ: 3.76, FOCALLEN: 400 }

	test('come from the header pointing and optics', () => {
		const hints = resolvePlateSolveHints('assisted', header, { focalLength: 400 })

		expect(toDeg(hints.rightAscension!.value)).toBeCloseTo(42, 9)
		expect(toDeg(hints.declination!.value)).toBeCloseTo(-17, 9)
		expect(hints.rightAscension!.source).toBe('header')
		expect(hints.radius).toEqual({ value: DEFAULT_SEARCH_RADIUS, source: 'default' })
		expect(toArcsec(hints.scale!.value)).toBeCloseTo(pixelScale(3.76, 400), 9)
		expect(hints.scale!.source).toBe('optics')
	})

	test('of the operator win', () => {
		const hints = resolvePlateSolveHints('assisted', header, { focalLength: 400 }, { rightAscension: deg(10), declination: deg(20), radius: deg(2), scale: arcsec(1) })

		expect(hints).toEqual({ rightAscension: { value: deg(10), source: 'user' }, declination: { value: deg(20), source: 'user' }, radius: { value: deg(2), source: 'user' }, scale: { value: arcsec(1), source: 'user' } })
	})

	test('of a blind solve keep only the scale', () => {
		expect(resolvePlateSolveHints('blind', header, { focalLength: 400 }, { rightAscension: deg(10), declination: deg(20) })).toEqual({ scale: { value: arcsec(pixelScale(3.76, 400)), source: 'optics' } })
	})

	test('are absent when the header has none', () => {
		expect(resolvePlateSolveHints('assisted', { RA: 42 }, {})).toEqual({})
	})
})

describe('solution', () => {
	test('is rebuilt with the size of the document', () => {
		// A header solved by ASTAP rebuilds NAXIS1 from CRPIX, one pixel short for an odd size.
		const solution = validatedSolution({ ...WCS, NAXIS1: 100, NAXIS2: 50 }, 101, 50)!

		expect(solution.widthInPixels).toBe(101)
		expect(solution.NAXIS1).toBe(101)
		expect(toDeg(solution.declination)).toBeCloseTo(-17, 4)
	})

	test('of another image or projection is refused', () => {
		expect(validatedSolution({ ...WCS, NAXIS1: 100, NAXIS2: 50 }, 200, 100)).toBeUndefined()
		expect(validatedSolution({ ...WCS, NAXIS1: 100, NAXIS2: 50, CTYPE1: 'GLON-TAN', CTYPE2: 'GLAT-TAN' }, 100, 50)).toBeUndefined()
	})

	test('derived fields of a solution are not read back as its header', () => {
		const solution = validatedSolution({ ...WCS, NAXIS1: 100, NAXIS2: 50 }, 100, 50)!
		expect(validatedSolution({ ...solution, widthInPixels: 7, rightAscension: 0 }, 100, 50)).toEqual(solution)
	})

	test('cache key follows the request, the folders, the pixels, and the index bands, but not the timeout', () => {
		const hints = resolvePlateSolveHints('assisted', { RA: 42, DEC: -17 }, {})
		const tool = { executable: '', timeout: 1, indexDirectory: '/indexes', catalogDirectory: '' }
		expect(plateSolveCacheKey('i', ASSISTED, hints, tool)).toBe(plateSolveCacheKey('i', ASSISTED, hints, { ...tool, timeout: 2 }))
		expect(plateSolveCacheKey('i', ASSISTED, hints, tool)).not.toBe(plateSolveCacheKey('i', { ...ASSISTED, strategy: 'blind' }, hints, tool))
		expect(plateSolveCacheKey('i', ASSISTED, hints, tool)).not.toBe(plateSolveCacheKey('i', { ...ASSISTED, scaleTolerance: 0.1 }, hints, tool))
		expect(plateSolveCacheKey('i', ASSISTED, hints, tool)).not.toBe(plateSolveCacheKey('i', ASSISTED, hints, { ...tool, catalogDirectory: '/astap' }))
		expect(plateSolveCacheKey('i', ASSISTED, hints, tool)).not.toBe(plateSolveCacheKey('i', ASSISTED, hints, tool, 'dark:7:digest'))
		expect(plateSolveCacheKey('i', ASSISTED, hints, tool, '', 0)).not.toBe(plateSolveCacheKey('i', ASSISTED, hints, tool, '', 1))
	})
})

describe('awaited solve', () => {
	// Resolves to the error a promise rejects with, or undefined when it resolves.
	async function rejection(promise: Promise<unknown>) {
		try {
			await promise
			return undefined
		} catch (error) {
			return error
		}
	}

	const ORIGIN = { kind: 'tppa', sessionId: 's1', connectionId: 'c', deviceId: 'cam', frameId: 's1:1', point: 1 } as const

	test('resolves the result of a job with its origin, the settings it ran with, and then the kept one', async () => {
		const { images, tools, service, events } = setup()
		const info = await images.open(writeImage())
		const preparation = await service.prepare(ASSISTED)

		const result = await service.solve(info.id, preparation, undefined, ORIGIN)

		expect(result).toMatchObject({ outcome: 'noSolution', tool: (await tools.resolve('nebulosa'))! })
		expect(result.warnings).toContain('A search without a solution may need index files or a star database covering this field and scale.')
		expect(events.at(-1)!.job.origin).toEqual(ORIGIN)
		expect(await service.solve(info.id, preparation, undefined, ORIGIN)).toBe(result)
	})

	test('throws the code of a job that could not run or was cancelled', async () => {
		const { images, service } = setup()
		const info = await images.open(writeImage())

		expect(await rejection(service.solve('missing', ASSISTED))).toMatchObject({ code: 'expired' })
		expect(await rejection(service.solve(info.id, { ...ASSISTED, strategy: 'blind' }, AbortSignal.abort()))).toMatchObject({ code: 'cancelled' })
	})
})

describe('routes', () => {
	test('submit, hints, and solutions of an image', async () => {
		const { images, service, events } = setup()
		const routes = createPlateSolvingRoutes(service)
		const info = await images.open(writeImage({ RA: 42, DEC: -17, ...WCS }))

		const hints = await (await call(routes, '/api/images/:id/plate-solving/hints', 'GET', { id: info.id })).json()
		expect(hints).toMatchObject({ rightAscension: { source: 'header' }, radius: { source: 'default' } })

		expect((await call(routes, '/api/images/:id/plate-solving', 'POST', { id: 'missing' }, ASSISTED)).status).toBe(404)
		const accepted = await call(routes, '/api/images/:id/plate-solving', 'POST', { id: info.id }, ASSISTED)
		expect(accepted.status).toBe(202)
		const job = (await accepted.json()) as PlateSolveJob
		expect((await ended(events, job.jobId)).summary).toMatchObject({ outcome: 'noSolution' })
		// An equivalent request is answered with the kept result.
		expect((await call(routes, '/api/images/:id/plate-solving', 'POST', { id: info.id }, ASSISTED)).status).toBe(200)

		const solutions = (await (await call(routes, '/api/images/:id/plate-solutions', 'GET', { id: info.id })).json()) as PlateSolutions
		expect(solutions.header).toMatchObject({ CTYPE1: 'RA---TAN', widthInPixels: 100 })
		expect(solutions.jobs.map((solved) => solved.jobId)).toEqual([job.jobId])

		expect((await call(routes, '/api/plate-solving/:jobId/result', 'GET', { jobId: job.jobId })).status).toBe(200)
		expect((await call(routes, '/api/plate-solving/:jobId/result', 'GET', { jobId: 'missing' })).status).toBe(404)
		expect((await call(routes, '/api/plate-solving/:jobId/cancel', 'POST', { jobId: job.jobId })).status).toBe(404)
		expect(((await (await call(routes, '/api/plate-solving', 'GET', {})).json()) as { jobs: PlateSolveJob[] }).jobs.map((known) => known.jobId)).toContain(job.jobId)
	})
})
