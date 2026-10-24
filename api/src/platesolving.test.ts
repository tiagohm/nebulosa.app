import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pixelScale } from 'nebulosa/src/astronomy/formulas'
import { readFits } from 'nebulosa/src/io/formats/fits/fits'
import { bufferSource } from 'nebulosa/src/io/io'
import { arcsec, deg, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { ExternalToolsStore } from './externaltools'
import { ImageStore } from './images'
import { createPlateSolvingRoutes, plateSolveCacheKey, type PlateSolutions, type PlateSolveJob, type PlateSolveRequest, type PlateSolvingEvent, PlateSolvingService, validatedSolution } from './platesolving'
import { DEFAULT_SEARCH_RADIUS, POINTING_KEYWORDS, resolvePlateSolveHints } from './platesolving.hints'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-plate-solving-test-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

const WINDOWS = process.platform === 'win32'

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

// A TAN solution of a 100×50 image without NAXIS1/NAXIS2, like the WCS of ASTAP.
const WCS = { CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN', CRPIX1: 50.5, CRPIX2: 25.5, CRVAL1: 42, CRVAL2: -17, CD1_1: 0.0005, CD1_2: 0, CD2_1: 0, CD2_2: 0.0005 } as const

// Encodes a header-only FITS file, as the solvers write their WCS.
function wcsFile(entries: Readonly<Record<string, string | number>>) {
	return headerBlock([...cards({ BITPIX: 8, NAXIS: 0 }), ...cards(entries)].toSpliced(0, 0, 'SIMPLE  =                    T'.padEnd(80)))
}

// Environment variable that makes a fake program exit at once, so settle can probe it.
const PROBE = 'NEBULOSA_FAKE_PROBE'

// Waits until a freshly written fake program can be started: on Windows a scanner may still hold the new file.
async function settle(executable: string) {
	const deadline = performance.now() + 5000

	while (true) {
		try {
			await Bun.spawn([executable], { env: { ...process.env, [PROBE]: '1' }, stdout: 'ignore', stderr: 'ignore' }).exited
			return
		} catch (error) {
			if (performance.now() >= deadline) throw error
			await Bun.sleep(20)
		}
	}
}

interface FakeAstap {
	// Lines of the .ini written for the -o base (the second argument).
	readonly ini?: readonly string[]
	// WCS written for the -o base.
	readonly wcs?: Readonly<Record<string, string | number>>
	readonly sleep?: number
	readonly exitCode?: number
}

// Writes an executable behaving like an ASTAP solve, recording its arguments in args.txt next to it.
async function fakeAstap({ ini, wcs, sleep = 0, exitCode = 0 }: FakeAstap) {
	const directory = join(root, `astap-${files++}`)
	mkdirSync(directory)
	const args = join(directory, 'args.txt')
	if (ini) writeFileSync(join(directory, 'out.ini'), ini.join('\n'))
	if (wcs) writeFileSync(join(directory, 'out.wcs'), wcsFile(wcs))

	if (WINDOWS) {
		const copies = [...(ini ? [`copy /y "${join(directory, 'out.ini')}" "%~dpn2.ini" >nul`] : []), ...(wcs ? [`copy /y "${join(directory, 'out.wcs')}" "%~dpn2.wcs" >nul`] : [])]
		const lines = ['@echo off', `if defined ${PROBE} exit /b 0`, `echo %*> "${args}"`, ...(sleep > 0 ? [`ping -n ${sleep + 1} 127.0.0.1 >nul`] : []), ...copies, `exit /b ${exitCode}`]
		const executable = join(directory, 'astap.cmd')
		writeFileSync(executable, lines.join('\r\n'))
		await settle(executable)
		return { executable, args }
	}

	const copies = [...(ini ? [`cp '${join(directory, 'out.ini')}' "$base.ini"`] : []), ...(wcs ? [`cp '${join(directory, 'out.wcs')}' "$base.wcs"`] : [])]
	const lines = ['#!/bin/sh', `[ -n "$${PROBE}" ] && exit 0`, `echo "$@" > '${args}'`, 'base="${2%.*}"', ...(sleep > 0 ? [`sleep ${sleep}`] : []), ...copies, `exit ${exitCode}`]
	const executable = join(directory, 'astap')
	writeFileSync(executable, lines.join('\n'))
	chmodSync(executable, 0o755)
	await settle(executable)
	return { executable, args }
}

// Writes an executable behaving like solve-field that writes a WCS into its --dir (the fifth argument).
async function fakeSolveField(wcs: Readonly<Record<string, string | number>>) {
	const directory = join(root, `solve-field-${files++}`)
	mkdirSync(directory)
	const args = join(directory, 'args.txt')
	writeFileSync(join(directory, 'out.wcs'), wcsFile(wcs))

	if (WINDOWS) {
		const lines = ['@echo off', `if defined ${PROBE} exit /b 0`, `echo %*> "${args}"`, 'mkdir "%~5" 2>nul', `copy /y "${join(directory, 'out.wcs')}" "%~5\\nebulosa.wcs" >nul`, 'exit /b 0']
		const executable = join(directory, 'solve-field.cmd')
		writeFileSync(executable, lines.join('\r\n'))
		await settle(executable)
		return { executable, args }
	}

	const lines = ['#!/bin/sh', `[ -n "$${PROBE}" ] && exit 0`, `echo "$@" > '${args}'`, 'mkdir -p "$5"', `cp '${join(directory, 'out.wcs')}' "$5/nebulosa.wcs"`, 'exit 0']
	const executable = join(directory, 'solve-field')
	writeFileSync(executable, lines.join('\n'))
	chmodSync(executable, 0o755)
	await settle(executable)
	return { executable, args }
}

// Behavior of a fake nova service.
interface FakeNova {
	// Answer of the upload.
	readonly upload?: Record<string, unknown>
	// Status of the job: success, failure, or solving forever.
	readonly job?: 'success' | 'failure' | 'solving'
	// WCS served for the job.
	readonly wcs?: Readonly<Record<string, string | number>>
}

// Starts a fake nova service that signs in the key "good", recording the paths it was asked for.
function fakeNova({ upload = { status: 'success', subid: 3 }, job = 'success', wcs = { ...WCS, IMAGEW: 100, IMAGEH: 50 } }: FakeNova = {}) {
	const paths: string[] = []
	let polls = 0

	const server = Bun.serve({
		port: 0,
		fetch(req) {
			const { pathname } = new URL(req.url)
			paths.push(pathname)
			if (pathname === '/api/login') return Response.json({ status: 'success', session: 'session-1' })
			if (pathname === '/api/upload') return Response.json(upload)
			// The job is created on the second poll of the submission.
			if (pathname === '/api/submissions/3') return Response.json({ jobs: ++polls > 1 ? [7] : [null] })
			if (pathname === '/api/jobs/7') return Response.json({ status: job })
			if (pathname === '/wcs_file/7') return new Response(wcsFile(wcs))
			return new Response(undefined, { status: 404 })
		},
	})

	return { server, paths }
}

// Creates a service over its own image store and settings file, recording its events. Nova is polled every 10 ms.
function setup() {
	const images = new ImageStore()
	const tools = new ExternalToolsStore(join(root, `settings-${files++}`, 'settings.json'))
	const events: PlateSolvingEvent[] = []
	const service = new PlateSolvingService(images, tools, (event) => events.push(event), { novaPollInterval: 10 })
	return { images, tools, service, events }
}

// Saves the settings of a local provider.
async function configure(tools: ExternalToolsStore, id: 'astap' | 'astrometryLocal', executable: string, config?: string) {
	const { revision } = await tools.get(id)
	await tools.save(id, { executable, timeout: 60000, ...(config && { config }) }, revision)
}

// Saves the endpoint of nova and signs in to it.
async function signIn(tools: ExternalToolsStore, endpoint: string) {
	const { revision } = await tools.get('nova')
	await tools.save('nova', { executable: '', timeout: 60000, endpoint }, revision)
	await tools.login('nova', 'good')
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

const ASSISTED: PlateSolveRequest = { provider: 'astap', strategy: 'assisted' }

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
		// ASTAP rebuilds NAXIS1 from CRPIX, one pixel short for an odd size.
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

	test('cache key leaves out the timeout', () => {
		const hints = resolvePlateSolveHints('assisted', { RA: 42, DEC: -17 }, {})
		expect(plateSolveCacheKey('i', ASSISTED, hints, { executable: 'astap', timeout: 1 })).toBe(plateSolveCacheKey('i', ASSISTED, hints, { executable: 'astap', timeout: 2 }))
		expect(plateSolveCacheKey('i', ASSISTED, hints, { executable: 'astap', timeout: 1 })).not.toBe(plateSolveCacheKey('i', { ...ASSISTED, strategy: 'blind' }, hints, { executable: 'astap', timeout: 1 }))
	})
})

describe('ASTAP', () => {
	test('solves an image around the header pointing and keeps the whole WCS', async () => {
		const { images, tools, service, events } = setup()
		const { executable, args } = await fakeAstap({ ini: ['PLTSOLVD=T'], wcs: WCS })
		await configure(tools, 'astap', executable)
		const info = await images.open(writeImage({ RA: 42, DEC: -17 }))

		const job = await submit(service, info.id, ASSISTED)
		const last = await ended(events, job.jobId)

		expect(last).toMatchObject({ state: 'completed', summary: { outcome: 'solved', parity: 'NORMAL' } })
		expect(toDeg(last.summary!.declination!)).toBeCloseTo(-17, 4)
		expect(last.hints.rightAscension!.source).toBe('header')
		expect(events.map((event) => event.job.stage)).toContain('solving')
		expect(JSON.stringify(events)).not.toContain('CD1_1')

		const result = service.result(job.jobId)!
		expect(result.solution).toMatchObject({ CTYPE1: 'RA---TAN', CD1_1: 0.0005, NAXIS1: 100, NAXIS2: 50 })
		expect(result.tool).toEqual({ executable, timeout: 60000 })
		expect(service.solutions(info.id)!.jobs.map((solved) => solved.jobId)).toEqual([job.jobId])

		const recorded = await Bun.file(args).text()
		expect(recorded).toContain('-ra 2.8')
		expect(recorded).toContain('-r 10')
	})

	test('answers a repeated request with the job running, then with its result', async () => {
		const { images, tools, service, events } = setup()
		const { executable } = await fakeAstap({ ini: ['PLTSOLVD=T'], wcs: WCS, sleep: 1 })
		await configure(tools, 'astap', executable)
		const info = await images.open(writeImage())

		const job = await submit(service, info.id, ASSISTED)
		expect(await service.submit(info.id, ASSISTED)).toMatchObject({ status: 'active', job: { jobId: job.jobId } })

		await ended(events, job.jobId)
		expect(await service.submit(info.id, ASSISTED)).toMatchObject({ status: 'cached', job: { jobId: job.jobId } })
		expect((await service.submit(info.id, { ...ASSISTED, strategy: 'blind' })).status).toBe('accepted')
	}, 20000)

	test('completes without a solution', async () => {
		const { images, tools, service, events } = setup()
		const { executable } = await fakeAstap({ ini: ['PLTSOLVD=F'], exitCode: 1 })
		await configure(tools, 'astap', executable)
		const info = await images.open(writeImage())

		const job = await submit(service, info.id, { provider: 'astap', strategy: 'blind' })

		expect(await ended(events, job.jobId)).toMatchObject({ state: 'completed', summary: { outcome: 'noSolution' } })
		expect(service.result(job.jobId)!.solution).toBeUndefined()
	})

	test('fails with the error of ASTAP', async () => {
		const { images, tools, service, events } = setup()
		const { executable } = await fakeAstap({ ini: ['ERROR=No star database found!'], exitCode: 32 })
		await configure(tools, 'astap', executable)
		const info = await images.open(writeImage())

		const job = await submit(service, info.id, ASSISTED)
		const last = await ended(events, job.jobId)

		expect(last).toMatchObject({ state: 'failed', code: 'failed' })
		expect(last.error).toContain('No star database found!')
	})

	test('refuses a solution of another image size', async () => {
		const { images, tools, service, events } = setup()
		const { executable } = await fakeAstap({ ini: ['PLTSOLVD=T'], wcs: { ...WCS, CRPIX1: 500.5, CRPIX2: 250.5 } })
		await configure(tools, 'astap', executable)
		const info = await images.open(writeImage())

		const job = await submit(service, info.id, ASSISTED)

		expect(await ended(events, job.jobId)).toMatchObject({ state: 'failed', code: 'invalidSolution' })
	})

	test('is killed when cancelled', async () => {
		const { images, tools, service, events } = setup()
		const { executable } = await fakeAstap({ sleep: 10 })
		await configure(tools, 'astap', executable)
		const info = await images.open(writeImage())

		const job = await submit(service, info.id, ASSISTED)
		while (service.job(job.jobId)?.stage !== 'solving') await Bun.sleep(10)
		expect(service.cancel(job.jobId)).toBeTrue()

		expect(await ended(events, job.jobId)).toMatchObject({ state: 'cancelled', code: 'cancelled' })
	}, 20000)

	test('a blind solve reads a copy without the header pointing', async () => {
		const { images } = setup()
		const info = await images.open(writeImage({ RA: 42, DEC: -17, OBJCTRA: '02 48 00', FOCALLEN: 400 }))

		const header = (await readFits(bufferSource(Buffer.from((await images.detectionFile(info.id, POINTING_KEYWORDS))!))))!.hdus[0].header

		expect(header.RA).toBeUndefined()
		expect(header.OBJCTRA).toBeUndefined()
		expect(header.FOCALLEN).toBe(400)
		expect(images.metadata(info.id)!.header.RA).toBe(42)
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

	test('resolves the result of a job with its origin, then the kept one', async () => {
		const { images, tools, service, events } = setup()
		const { executable } = await fakeAstap({ ini: ['PLTSOLVD=T'], wcs: WCS })
		await configure(tools, 'astap', executable)
		const info = await images.open(writeImage())
		const preparation = (await service.prepare(ASSISTED))!

		const result = await service.solve(info.id, preparation, undefined, ORIGIN)

		expect(result.solution).toMatchObject({ CTYPE1: 'RA---TAN' })
		expect(events.at(-1)!.job.origin).toEqual(ORIGIN)
		expect(await service.solve(info.id, preparation, undefined, ORIGIN)).toBe(result)
	})

	test('resolves a search without a solution', async () => {
		const { images, tools, service } = setup()
		const { executable } = await fakeAstap({ ini: ['PLTSOLVD=F'], exitCode: 1 })
		await configure(tools, 'astap', executable)
		const info = await images.open(writeImage())

		expect(await service.solve(info.id, { provider: 'astap', strategy: 'blind' })).toMatchObject({ outcome: 'noSolution' })
	})

	test('throws the code of a failed or cancelled job', async () => {
		const { images, tools, service } = setup()
		const { executable } = await fakeAstap({ ini: ['ERROR=No star database found!'], exitCode: 32 })
		await configure(tools, 'astap', executable)
		const info = await images.open(writeImage())

		expect(await rejection(service.solve(info.id, ASSISTED))).toMatchObject({ code: 'failed' })
		expect(await rejection(service.solve('missing', ASSISTED))).toMatchObject({ code: 'expired' })
		expect(await rejection(service.solve(info.id, { ...ASSISTED, strategy: 'blind' }, AbortSignal.abort()))).toMatchObject({ code: 'cancelled' })
	}, 20000)

	test('refuses a provider that is not configured', async () => {
		const { images, service } = setup()
		const info = await images.open(writeImage())

		expect(await rejection(service.solve(info.id, ASSISTED))).toMatchObject({ code: 'notConfigured' })
	})
})

describe('solve-field', () => {
	test('solves with its backend configuration', async () => {
		const { images, tools, service, events } = setup()
		const { executable, args } = await fakeSolveField({ ...WCS, IMAGEW: 100, IMAGEH: 50 })
		await configure(tools, 'astrometryLocal', executable, 'backend.cfg')
		const info = await images.open(writeImage())

		const job = await submit(service, info.id, { provider: 'astrometryLocal', strategy: 'blind', hints: { scale: arcsec(1.8) } })

		expect(await ended(events, job.jobId)).toMatchObject({ state: 'completed', summary: { outcome: 'solved' } })
		const recorded = await Bun.file(args).text()
		expect(recorded).toContain('--config backend.cfg')
		expect(recorded).toContain('--scale-units degwidth')
		expect(recorded).not.toContain('--ra')
	})
})

describe('nova', () => {
	test('uploads once and follows the submission and the job', async () => {
		const { server, paths } = fakeNova()
		using _ = server
		const { images, tools, service, events } = setup()
		await signIn(tools, server.url.origin)
		const info = await images.open(writeImage())

		const job = await submit(service, info.id, { provider: 'nova', strategy: 'blind' })
		const last = await ended(events, job.jobId)

		expect(last).toMatchObject({ state: 'completed', summary: { outcome: 'solved' }, remote: { submissionId: 3, jobId: 7 } })
		expect(events.map((event) => event.job.stage).filter(Boolean)).toEqual(expect.arrayContaining(['uploading', 'submitted', 'solving', 'retrieving']))
		expect(paths.filter((path) => path === '/api/upload')).toHaveLength(1)
		expect(service.result(job.jobId)!.tool).not.toHaveProperty('session')
	})

	test('completes without a solution when the remote job failed', async () => {
		const { server } = fakeNova({ job: 'failure' })
		using _ = server
		const { images, tools, service, events } = setup()
		await signIn(tools, server.url.origin)
		const info = await images.open(writeImage())

		const job = await submit(service, info.id, { provider: 'nova', strategy: 'blind' })

		expect(await ended(events, job.jobId)).toMatchObject({ state: 'completed', summary: { outcome: 'noSolution' } })
	})

	test('reports a refused session', async () => {
		const { server } = fakeNova({ upload: { status: 'error', errormessage: 'no session with key "session-1"' } })
		using _ = server
		const { images, tools, service, events } = setup()
		await signIn(tools, server.url.origin)
		const info = await images.open(writeImage())

		const job = await submit(service, info.id, { provider: 'nova', strategy: 'blind' })

		expect(await ended(events, job.jobId)).toMatchObject({ state: 'failed', code: 'sessionExpired' })
	})

	test('stops following the remote job when cancelled', async () => {
		const { server, paths } = fakeNova({ job: 'solving' })
		using _ = server
		const { images, tools, service, events } = setup()
		await signIn(tools, server.url.origin)
		const info = await images.open(writeImage())

		const job = await submit(service, info.id, { provider: 'nova', strategy: 'blind' })
		while (service.job(job.jobId)?.stage !== 'solving') await Bun.sleep(5)
		service.cancel(job.jobId)
		const last = await ended(events, job.jobId)

		expect(last).toMatchObject({ state: 'cancelled', code: 'cancelled', remote: { submissionId: 3, jobId: 7 } })
		expect(last.error).toContain('not stopped')
		expect(paths.filter((path) => path === '/api/upload')).toHaveLength(1)
	})

	test('gives up when the service cannot be reached', async () => {
		const { server } = fakeNova()
		const { images, tools, service, events } = setup()
		await signIn(tools, server.url.origin)
		await server.stop(true)
		const info = await images.open(writeImage())

		const job = await submit(service, info.id, { provider: 'nova', strategy: 'blind' })

		expect(await ended(events, job.jobId)).toMatchObject({ state: 'failed', code: 'network' })
	})

	test('is not configured until signed in', async () => {
		const { images, service } = setup()
		const info = await images.open(writeImage())
		expect((await service.submit(info.id, { provider: 'nova', strategy: 'blind' })).status).toBe('notConfigured')
	})
})

describe('routes', () => {
	test('submit, hints, and solutions of an image', async () => {
		const { images, tools, service, events } = setup()
		const routes = createPlateSolvingRoutes(service)
		const info = await images.open(writeImage({ RA: 42, DEC: -17, ...WCS }))

		const refused = await call(routes, '/api/images/:id/plate-solving', 'POST', { id: info.id }, ASSISTED)
		expect(refused.status).toBe(422)
		expect(await refused.json()).toMatchObject({ code: 'notConfigured' })

		const hints = await (await call(routes, '/api/images/:id/plate-solving/hints', 'GET', { id: info.id })).json()
		expect(hints).toMatchObject({ rightAscension: { source: 'header' }, radius: { source: 'default' } })

		const { executable } = await fakeAstap({ ini: ['PLTSOLVD=T'], wcs: WCS })
		await configure(tools, 'astap', executable)
		expect((await call(routes, '/api/images/:id/plate-solving', 'POST', { id: 'missing' }, ASSISTED)).status).toBe(404)
		const accepted = await call(routes, '/api/images/:id/plate-solving', 'POST', { id: info.id }, ASSISTED)
		expect(accepted.status).toBe(202)
		const job = (await accepted.json()) as PlateSolveJob
		await ended(events, job.jobId)

		const solutions = (await (await call(routes, '/api/images/:id/plate-solutions', 'GET', { id: info.id })).json()) as PlateSolutions
		expect(solutions.header).toMatchObject({ CTYPE1: 'RA---TAN', widthInPixels: 100 })
		expect(solutions.jobs.map((solved) => solved.jobId)).toEqual([job.jobId])

		expect((await call(routes, '/api/plate-solving/:jobId/result', 'GET', { jobId: job.jobId })).status).toBe(200)
		expect((await call(routes, '/api/plate-solving/:jobId/result', 'GET', { jobId: 'missing' })).status).toBe(404)
		expect((await call(routes, '/api/plate-solving/:jobId/cancel', 'POST', { jobId: job.jobId })).status).toBe(404)
		expect(((await (await call(routes, '/api/plate-solving', 'GET', {})).json()) as { jobs: PlateSolveJob[] }).jobs.map((known) => known.jobId)).toContain(job.jobId)
	})
})
