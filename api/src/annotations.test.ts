import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { toDeg } from 'nebulosa/src/math/units/angle'
import { annotationCacheKey, type AnnotationEvent, type AnnotationJob, type AnnotationRequest, AnnotationService, type AnnotationSky, createAnnotationRoutes, observationContext } from './annotations'
import { ExternalToolsStore } from './externaltools'
import { ImageStore } from './images'
import { PlateSolvingService, type PlateSolveResult } from './platesolving'
import { fieldConstellations, fieldObjects } from './sky/catalog'
import type { SkyPosition } from './sky/ephemeris'
import { fixtureCatalog } from './sky/fixture'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-annotations-test-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

// Size of a FITS block, in bytes.
const BLOCK = 2880

// Side of the synthetic images, in pixels.
const SIZE = 100

// Position of M 42 in the fixture catalog, radians.
const M42 = { ra: 1.462971568107605, dec: -0.09409244358539581 }

// Pixel scale of the synthetic images, degrees: 36″/px, so an image spans 1°.
const SCALE = 0.01

const catalog = fixtureCatalog()

// Constellation figures of the stub sky: one through M 42, one far away.
const CONSTELLATIONS = {
	lines: [
		[
			[M42.ra - 0.01, M42.dec],
			[M42.ra + 0.01, M42.dec],
		],
		[
			[3, 0.5],
			[3.1, 0.5],
		],
	],
	boundaries: [],
	labels: [{ name: 'Orion', rightAscension: M42.ra, declination: M42.dec + 0.001 }],
}

let files = 0

// Formats a FITS card of a numeric value.
function card(key: string, value: number) {
	return `${key.padEnd(8)}= ${String(value).padStart(20)}`
}

// Formats a FITS card of a text value.
function text(key: string, value: string) {
	return `${key.padEnd(8)}= '${value}'`
}

// TAN WCS cards centered on a position in radians, rotated by angle degrees, mirrored when flipped.
function wcs(ra: number = M42.ra, dec: number = M42.dec, { angle = 0, flipped = false }: { angle?: number; flipped?: boolean } = {}) {
	const c = Math.cos((angle * Math.PI) / 180) * SCALE
	const s = Math.sin((angle * Math.PI) / 180) * SCALE
	const flip = flipped ? -1 : 1
	return [text('CTYPE1', 'RA---TAN'), text('CTYPE2', 'DEC--TAN'), card('CRVAL1', toDeg(ra)), card('CRVAL2', toDeg(dec)), card('CRPIX1', 50.5), card('CRPIX2', 50.5), card('CD1_1', -c * flip), card('CD1_2', s), card('CD2_1', s * flip), card('CD2_2', c)]
}

// Writes a SIZE×SIZE 8-bit FITS file with extra header cards and returns its path.
function writeImage(extra: readonly string[] = []) {
	const cards = ['SIMPLE  =                    T', card('BITPIX', 8), card('NAXIS', 2), card('NAXIS1', SIZE), card('NAXIS2', SIZE), ...extra, 'END']
	const header = Buffer.alloc(Math.ceil((cards.length * 80) / BLOCK) * BLOCK, ' ')
	for (const [i, line] of cards.entries()) header.write(line.padEnd(80), i * 80, 'latin1')
	const data = Buffer.alloc(Math.ceil((SIZE * SIZE) / BLOCK) * BLOCK, 10)
	const path = join(root, `image-${files++}.fits`)
	writeFileSync(path, Buffer.concat([header, data]))
	return path
}

// Position of a stub body: astrometric J2000 at `j2000`, apparent position far away, so a WCS fed the apparent one
// would miss it.
function position(time: number, j2000: readonly [number, number]): SkyPosition {
	return { time, source: 'local', center: 'geocentric', rightAscension: j2000[0] + 1, declination: j2000[1], rightAscensionJ2000: j2000[0], declinationJ2000: j2000[1], constellation: 'ORI' }
}

// Sky over the fixture catalog, with Jupiter at M 42 moving 0.001 rad per hour in right ascension and every other body
// far away; records the body requests.
function sky(calls: { code: string; time: number; observer?: unknown }[] = []): AnnotationSky {
	return {
		objects: (query) => fieldObjects(catalog, query),
		constellations: (ra, dec, radius) => fieldConstellations(CONSTELLATIONS, ra, dec, radius),
		body: (code, time, observer) => {
			calls.push({ code, time, observer })
			return Promise.resolve(position(time, code === '599' ? [M42.ra + ((time - Date.UTC(2026, 9, 27, 3)) / 3600000) * 0.001, M42.dec] : [0, -1]))
		},
	}
}

// Creates a service over its own image store and a real plate solving service, recording its events.
function setup(annotationSky: AnnotationSky = sky()) {
	const images = new ImageStore()
	const tools = new ExternalToolsStore(join(root, `settings-${files++}`, 'settings.json'))
	const plateSolving = new PlateSolvingService(images, tools, () => {})
	const events: AnnotationEvent[] = []
	const service = new AnnotationService(images, plateSolving, annotationSky, (event) => events.push(event))
	return { images, service, events }
}

const REQUEST: AnnotationRequest = { kind: 'local', magnitudeLimit: 12 }

// Waits until a job ended and returns its last event.
async function ended(events: readonly AnnotationEvent[], jobId: string, timeout = 5000) {
	const deadline = performance.now() + timeout

	while (performance.now() < deadline) {
		const last = events.findLast((event) => event.job.jobId === jobId)?.job
		if (last && last.state !== 'queued' && last.state !== 'running') return last
		await Bun.sleep(5)
	}

	throw new Error(`job ${jobId} did not end`)
}

// Submits an annotation that must be accepted and returns its job.
function submit(service: AnnotationService, imageId: string, request: AnnotationRequest = REQUEST): AnnotationJob {
	const outcome = service.submit(imageId, request)
	if (outcome.status !== 'accepted') throw new Error(`not accepted: ${outcome.status}`)
	return outcome.job
}

// Runs an annotation to its completion and returns its result.
async function annotate(service: AnnotationService, events: readonly AnnotationEvent[], imageId: string, request: AnnotationRequest = REQUEST) {
	const job = submit(service, imageId, request)
	expect((await ended(events, job.jobId)).state).toBe('completed')
	return service.result(job.jobId)!
}

type Handler = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>

type AnnotationRoutes = ReturnType<typeof createAnnotationRoutes>

// Calls a route of the annotation API.
function call(routes: AnnotationRoutes, route: keyof AnnotationRoutes, method: 'GET' | 'POST', params: Record<string, string>, body?: unknown) {
	const handler = (routes[route] as unknown as Record<string, Handler>)[method]
	const req = Object.assign(new Request('http://localhost/', { method, body: body === undefined ? undefined : JSON.stringify(body) }), { params })
	return Promise.resolve(handler(req))
}

describe('observation context', () => {
	const header = (cards: Record<string, string | number>) => cards as FitsHeader

	test('the middle of the exposure from DATE-OBS', () => {
		expect(observationContext(header({ 'DATE-OBS': '2026-10-27T03:00:00' }), 30, REQUEST)).toEqual({ time: Date.UTC(2026, 9, 27, 3, 0, 15), origin: 'dateObs', approximate: false, exposure: 30, start: Date.UTC(2026, 9, 27, 3), end: Date.UTC(2026, 9, 27, 3, 0, 30), center: 'geocentric' })
		expect(observationContext(header({ 'DATE-OBS': '2026-10-27T03:00:00.250' }), undefined, REQUEST)).toEqual({ time: Date.UTC(2026, 9, 27, 3, 0, 0, 250), origin: 'dateObs', approximate: false, center: 'geocentric' })
	})

	test('the start from DATE-END only with the exposure', () => {
		const dateEnd = header({ 'DATE-END': '2026-10-27T03:01:00' })
		expect(observationContext(dateEnd, 60, REQUEST)).toMatchObject({ time: Date.UTC(2026, 9, 27, 3, 0, 30), origin: 'dateEnd', start: Date.UTC(2026, 9, 27, 3) })
		expect(observationContext(dateEnd, undefined, REQUEST)).toBeUndefined()
	})

	test('a date without a time is approximate', () => {
		expect(observationContext(header({ 'DATE-OBS': '2026-10-27' }), undefined, REQUEST)).toMatchObject({ time: Date.UTC(2026, 9, 27), approximate: true })
	})

	test('the instant of the request, centered on the exposure', () => {
		const time = Date.UTC(2020, 0, 1)
		expect(observationContext(header({ 'DATE-OBS': '2026-10-27T03:00:00' }), 10, { ...REQUEST, time, observer: { latitude: 1, longitude: 2, elevation: 3 } })).toEqual({ time, origin: 'request', approximate: false, exposure: 10, start: time - 5000, end: time + 5000, center: 'topocentric' })
	})

	test('none without a date', () => {
		expect(observationContext(header({ 'DATE-OBS': 'yesterday' }), 30, REQUEST)).toBeUndefined()
		expect(observationContext(header({}), 30, REQUEST)).toBeUndefined()
	})
})

describe('service', () => {
	test('annotates the catalog objects through the WCS of the header', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeImage(wcs()))
		const result = await annotate(service, events, info.id)

		expect(result.wcs).toEqual({ source: 'header' })
		expect(result.solution.CTYPE1).toBe('RA---TAN')
		expect(result.field.rightAscension).toBeCloseTo(M42.ra, 6)
		expect(result.field.radius).toBeCloseTo((Math.SQRT2 * 0.5 * Math.PI) / 180, 4)
		expect(result.objects.map((e) => e.id)).toEqual(['catalog:1001879'])
		expect(result.objects[0]).toMatchObject({ ref: { kind: 'catalog', id: 1001879 }, layer: 'deepSky', name: 'Great Orion Nebula', typeName: 'HII Region', magnitude: 4 })
		expect(result.counts).toEqual({ star: 0, deepSky: 1, solarSystem: 0 })
		expect(result.constellations.lines).toHaveLength(1)
		expect(result.constellations.labels.map((e) => e.code)).toEqual(['ORI'])
		expect(result.observation).toBeUndefined()
		expect(result.warnings[0]).toContain('observation time is unknown')
		expect(result).toMatchObject({ width: SIZE, height: SIZE, truncated: false })
	})

	test('keeps a deep-sky object whose extent reaches the image', async () => {
		const { images, service, events } = setup()
		// M 42 reaches 0.75° from its center; the image spans 0.5° on each side of its own.
		const near = await images.open(writeImage(wcs(M42.ra + (1.1 * Math.PI) / 180 / Math.cos(M42.dec))))
		const far = await images.open(writeImage(wcs(M42.ra + (1.4 * Math.PI) / 180 / Math.cos(M42.dec))))

		expect((await annotate(service, events, near.id)).objects.map((e) => e.id)).toEqual(['catalog:1001879'])
		expect((await annotate(service, events, far.id)).objects).toBeEmpty()
	})

	test('rotated and mirrored WCS', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeImage(wcs(M42.ra, M42.dec, { angle: 37, flipped: true })))
		expect((await annotate(service, events, info.id)).objects.map((e) => e.id)).toEqual(['catalog:1001879'])
	})

	test('adds the solar-system bodies at the middle of the exposure with their J2000 positions', async () => {
		const calls: { code: string; time: number; observer?: unknown }[] = []
		const { images, service, events } = setup(sky(calls))
		const info = await images.open(writeImage([...wcs(), text('DATE-OBS', '2026-10-27T03:00:00'), card('EXPTIME', 3600)]))
		const observer = { latitude: -23, longitude: -46, elevation: 700 }
		const result = await annotate(service, events, info.id, { ...REQUEST, observer })
		const jupiter = result.objects.find((e) => e.id === 'body:599')!

		expect(result.observation).toMatchObject({ time: Date.UTC(2026, 9, 27, 3, 30), origin: 'dateObs', center: 'topocentric' })
		expect(jupiter).toMatchObject({ ref: { kind: 'body', code: '599' }, layer: 'solarSystem', name: 'Jupiter', typeName: 'Planet', declination: M42.dec })
		expect(jupiter.rightAscension).toBeCloseTo(M42.ra + 0.0005, 9)
		expect(jupiter.motion!.start[0]).toBeCloseTo(M42.ra, 9)
		expect(jupiter.motion!.end[0]).toBeCloseTo(M42.ra + 0.001, 9)
		expect(result.objects.map((e) => e.layer)).toEqual(['solarSystem', 'deepSky'])
		expect(result.counts.solarSystem).toBe(1)
		expect(calls.every((e) => e.observer === observer)).toBeTrue()
		expect(calls.filter((e) => e.code === '10').map((e) => e.time)).toEqual([Date.UTC(2026, 9, 27, 3, 30)])
	})

	test('the bodies seen from the center of the Earth without an observer', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeImage([...wcs(), text('DATE-OBS', '2026-10-27T03:30:00')]))
		const result = await annotate(service, events, info.id)

		expect(result.observation?.center).toBe('geocentric')
		expect(result.objects.find((e) => e.id === 'body:599')?.motion).toBeUndefined()
		expect(result.warnings.some((e) => e.includes('center of the Earth'))).toBeTrue()
	})

	test('refuses an image without a usable WCS', async () => {
		const { images, service } = setup()
		const info = await images.open(writeImage())
		expect(service.submit(info.id, REQUEST)).toMatchObject({ status: 'contextUnavailable' })
		expect(service.submit('unknown', REQUEST)).toEqual({ status: 'missing' })
	})

	test('uses the solution of a plate solving job of the same image', async () => {
		const images = new ImageStore()
		const info = await images.open(writeImage())
		const header = await images.open(writeImage(wcs()))
		const solution = new PlateSolvingService(images, new ExternalToolsStore(join(root, `settings-${files++}`, 'settings.json')), () => {}).solutions(header.id)!.header!
		const results: Record<string, PlateSolveResult> = {
			solved: { jobId: 'solved', imageId: info.id, solution } as unknown as PlateSolveResult,
			other: { jobId: 'other', imageId: 'another', solution } as unknown as PlateSolveResult,
			unsolved: { jobId: 'unsolved', imageId: info.id } as unknown as PlateSolveResult,
		}
		const events: AnnotationEvent[] = []
		const service = new AnnotationService(images, { result: (jobId) => results[jobId], solutions: () => ({ jobs: [] }) }, sky(), (event) => events.push(event))

		for (const plateSolveJobId of ['unknown', 'other', 'unsolved']) expect(service.submit(info.id, { ...REQUEST, plateSolveJobId }).status).toBe('contextUnavailable')
		const result = await annotate(service, events, info.id, { ...REQUEST, plateSolveJobId: 'solved' })
		expect(result.wcs).toEqual({ source: 'plateSolve', plateSolveJobId: 'solved' })
		expect(result.objects.map((e) => e.id)).toEqual(['catalog:1001879'])
	})

	test('answers an equivalent request instead of running again', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeImage(wcs()))
		const job = submit(service, info.id)

		expect(service.submit(info.id, REQUEST)).toEqual({ status: 'active', job: service.job(job.jobId)! })
		await ended(events, job.jobId)
		expect(service.submit(info.id, REQUEST)).toMatchObject({ status: 'cached', job: { jobId: job.jobId } })
		expect(service.submit(info.id, { ...REQUEST, magnitudeLimit: 10 }).status).toBe('accepted')
		expect(annotationCacheKey(info.id, REQUEST)).not.toBe(annotationCacheKey(info.id, { ...REQUEST, observer: { latitude: 0, longitude: 0, elevation: 0 } }))
	})

	test('cancels a waiting job', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeImage(wcs()))
		const first = submit(service, info.id)
		const second = submit(service, info.id, { ...REQUEST, magnitudeLimit: 5 })

		expect(service.cancel(second.jobId)).toBeTrue()
		expect(await ended(events, second.jobId)).toMatchObject({ state: 'cancelled', code: 'cancelled' })
		expect((await ended(events, first.jobId)).state).toBe('completed')
		expect(service.cancel(first.jobId)).toBeFalse()
	})

	test('drops the results of a released image', async () => {
		const { images, service, events } = setup()
		const info = await images.open(writeImage(wcs()))
		const { jobId } = await annotate(service, events, info.id)

		images.close(info.id)
		expect(service.result(jobId)).toBeUndefined()
		expect(service.results(info.id)).toBeEmpty()
	})
})

describe('routes', () => {
	test('submit, job, result, snapshot, and cancel', async () => {
		const { images, service, events } = setup()
		const routes = createAnnotationRoutes(service)
		const info = await images.open(writeImage(wcs()))

		const submitted = await call(routes, '/api/images/:id/annotations', 'POST', { id: info.id }, REQUEST)
		expect(submitted.status).toBe(202)
		const job = (await submitted.json()) as AnnotationJob
		await ended(events, job.jobId)

		expect((await call(routes, '/api/images/:id/annotations', 'POST', { id: info.id }, REQUEST)).status).toBe(200)
		expect(((await (await call(routes, '/api/images/:id/annotations', 'GET', { id: info.id })).json()) as AnnotationJob[]).map((e) => e.jobId)).toEqual([job.jobId])
		expect(((await (await call(routes, '/api/annotations/:jobId', 'GET', { jobId: job.jobId })).json()) as AnnotationJob).state).toBe('completed')
		expect(((await (await call(routes, '/api/annotations/:jobId/result', 'GET', { jobId: job.jobId })).json()) as { objects: unknown[] }).objects).toHaveLength(1)
		expect(((await (await call(routes, '/api/annotations', 'GET', {})).json()) as { jobs: AnnotationJob[] }).jobs.map((e) => e.jobId)).toContain(job.jobId)
		expect((await call(routes, '/api/annotations/:jobId/cancel', 'POST', { jobId: job.jobId })).status).toBe(404)
		expect(events.every((e) => e.type === 'annotations:updated' && !('objects' in e.job))).toBeTrue()
	})

	test('errors', async () => {
		const { images, service } = setup()
		const routes = createAnnotationRoutes(service)
		const info = await images.open(writeImage())

		expect((await call(routes, '/api/images/:id/annotations', 'POST', { id: 'unknown' }, REQUEST)).status).toBe(404)
		const unavailable = await call(routes, '/api/images/:id/annotations', 'POST', { id: info.id }, REQUEST)
		expect(unavailable.status).toBe(422)
		expect(((await unavailable.json()) as { code: string }).code).toBe('contextUnavailable')
		expect((await call(routes, '/api/annotations/:jobId', 'GET', { jobId: 'unknown' })).status).toBe(404)
		const expired = await call(routes, '/api/annotations/:jobId/result', 'GET', { jobId: 'unknown' })
		expect(expired.status).toBe(404)
		expect(((await expired.json()) as { code: string }).code).toBe('expired')
	})
})
