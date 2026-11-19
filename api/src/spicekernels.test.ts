import { afterEach, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { SpkFile } from 'nebulosa/src/adapters/ephemeris/horizons'
import { type MPCOrbitSolution, orbitCartesianState, orbitToKeplerOrbit } from 'nebulosa/src/adapters/orbits/mpc'
import * as kernelSets from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import { AU_KM } from 'nebulosa/src/core/constants'
import { AppDatabase } from './database'
import { createSpiceKernelRoutes, type MpcOrbitReader, SpiceKernelError, spiceKernelWindow, type SpiceKernelEvent, SpiceKernelLibrary, type SpiceKernelLibraryOptions, type SpkGenerator } from './spicekernels'
import { spkFixture } from './spicekernels.fixture'
import type { SpiceKernelJob } from './spicekernels.jobs'
import { SpiceKernelRuntime } from './spicekernels.runtime'
import { SpiceKernelStore } from './spicekernels.store'
import { SsdRequestQueue } from './ssd'

const PLANETARY = spkFixture([
	{ center: 0, target: 10, start: -1e9, end: 1e9, position: [1000, 0, 0] },
	{ center: 0, target: 3, start: -1e9, end: 1e9, position: [0, 1.5e8, 0] },
	{ center: 3, target: 399, start: -1e9, end: 1e9, position: [0, 4000, 0] },
])

const CERES = spkFixture([{ center: 10, target: 20000001, start: -1e9, end: 1e9, position: [4e8, 0, 0] }])

const directories: string[] = []
const libraries: SpiceKernelLibrary[] = []

afterEach(() => {
	for (const library of libraries.splice(0)) {
		library[Symbol.dispose]()
		library.runtime[Symbol.dispose]()
	}

	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup(options: SpiceKernelLibraryOptions = {}, database = AppDatabase.memory(), directory?: string) {
	if (!directory) {
		directory = mkdtempSync(join(tmpdir(), 'nebulosa-spice-'))
		directories.push(directory)
	}

	const events: SpiceKernelEvent[] = []
	const store = new SpiceKernelStore(database, directory)
	const library = new SpiceKernelLibrary(store, new SpiceKernelRuntime(), (event) => events.push(event), new SsdRequestQueue(), options)
	libraries.push(library)
	return { library, store, events, database, directory }
}

function stream(bytes: Buffer) {
	return new Blob([new Uint8Array(bytes)]).stream()
}

async function started(options: SpiceKernelLibraryOptions = {}) {
	const context = setup(options)
	await context.library.start()
	return context
}

// Waits for a job to end, from the published events.
async function ended(events: readonly SpiceKernelEvent[], jobId: string): Promise<SpiceKernelJob> {
	for (let i = 0; i < 200; i++) {
		const job = events.findLast((e) => e.type === 'spiceKernels:jobUpdated' && e.job.jobId === jobId)
		if (job?.type === 'spiceKernels:jobUpdated' && (job.job.state === 'completed' || job.job.state === 'failed' || job.job.state === 'cancelled')) return job.job
		await Bun.sleep(10)
	}

	throw new Error('the job did not end')
}

test('a small body needs a planetary kernel before it is ready', async () => {
	const { library, events } = await started()
	const ceres = await library.importFile('ceres.bsp', stream(CERES))

	expect(ceres.alreadyInstalled).toBeFalse()
	expect(ceres.kernel).toMatchObject({ name: 'ceres.bsp', sourceKind: 'import', readiness: 'missingDependency', missingBodies: [10], targets: [20000001], segmentCount: 1 })
	expect(library.coverage(20000001, Date.UTC(2026, 0, 1))).toMatchObject({ available: false, reason: 'missing', body: 10 })

	const planetary = await library.importFile('C:\\kernels\\planets.bsp', stream(PLANETARY))
	expect(planetary.kernel.name).toBe('planets.bsp')

	const snapshot = library.snapshot()
	expect(snapshot.kernels.map((e) => [e.name, e.readiness, e.priority])).toEqual([
		['ceres.bsp', 'ready', 0],
		['planets.bsp', 'ready', 1],
	])
	expect(snapshot.bytes).toBe(CERES.byteLength + PLANETARY.byteLength)
	expect(snapshot.loading).toBeFalse()

	const coverage = library.coverage(20000001, Date.UTC(2026, 0, 1))
	expect(coverage).toMatchObject({ available: true, kernels: [ceres.kernel.id, planetary.kernel.id] })

	const state = library.runtime.current().set!.stateAt(20000001, { day: 2451545, fraction: 0, scale: 5 })
	expect(state.ok && state.state[0][0]).toBeCloseTo((4e8 + 1000) / AU_KM, 15)

	expect(events.every((e) => e.type === 'spiceKernels:changed' && e.epoch === snapshot.epoch)).toBeTrue()
	expect(events.map((e) => e.revision)).toEqual([1, 2, 3])
})

test('an identical file is installed once', async () => {
	const { library, store } = await started()
	const first = await library.importFile('a.bsp', stream(PLANETARY))
	const second = await library.importFile('b.bsp', stream(PLANETARY))

	expect(second.alreadyInstalled).toBeTrue()
	expect(second.kernel.id).toBe(first.kernel.id)
	expect(store.kernels()).toHaveLength(1)
	expect(readdirSync(join(store.directory, 'staging'))).toEqual([])
})

test('a file that is not an SPK is rejected without a trace', async () => {
	const { library, store } = await started()

	await expect(library.importFile('bad.bsp', stream(Buffer.alloc(4096)))).rejects.toThrow(SpiceKernelError)
	await expect(library.importFile('bad.bsp', stream(Buffer.alloc(4096)))).rejects.toMatchObject({ status: 422, code: 'invalidSpk' })

	expect(store.kernels()).toHaveLength(0)
	expect(readdirSync(join(store.directory, 'staging'))).toEqual([])
})

test('a file with only unsupported segments is stored but not usable', async () => {
	const { library } = await started()
	const { kernel } = await library.importFile('ecliptic.bsp', stream(spkFixture([{ center: 0, target: 1, start: 0, end: 10, position: [1, 0, 0], frame: 17 }])))

	expect(kernel).toMatchObject({ readiness: 'unsupported', targets: [], unsupportedSegments: 1 })
	expect(library.details(kernel.id).segments).toEqual([{ index: 0, name: 'SEGMENT 1', target: 1, center: 0, frame: 17, dataType: 2, start: 0, end: 10, supported: false, reason: 'frame', usage: 'full' }])
})

test('the load order and the enabled flag decide which kernel answers', async () => {
	const { library } = await started()
	const near = await library.importFile('near.bsp', stream(spkFixture([{ center: 0, target: 1, start: -1e9, end: 1e9, position: [100, 0, 0] }])))
	const far = await library.importFile('far.bsp', stream(spkFixture([{ center: 0, target: 1, start: -1e9, end: 1e9, position: [200, 0, 0] }])))
	const x = () => {
		const result = library.runtime.current().set?.stateAt(1, { day: 2451545, fraction: 0, scale: 5 })
		return result?.ok ? Math.round(result.state[0][0] * AU_KM) : undefined
	}

	expect(x()).toBe(200)
	const generation = library.runtime.current().generation

	await library.update(far.kernel.id, { priority: 0 })
	expect(x()).toBe(100)
	expect(library.runtime.current().generation).toBe(generation + 1)

	await library.update(near.kernel.id, { enabled: false })
	expect(x()).toBe(200)
	expect(library.details(near.kernel.id).readiness).toBe('disabled')

	await library.update(far.kernel.id, { enabled: false })
	expect(library.runtime.current().set).toBeUndefined()
	await expect(library.update('unknown', { enabled: true })).rejects.toMatchObject({ status: 404, code: 'notFound' })
})

// Two Saturnian kernels: the broad one, added last, covers Saturn and its barycenter longer than the accurate one.
const ACCURATE_SATURN = spkFixture([
	{ center: 0, target: 6, start: -1e9, end: 1e9, position: [1e9, 0, 0] },
	{ center: 6, target: 699, start: -5e8, end: 5e8, position: [100, 0, 0] },
])
const BROAD_SATURN = spkFixture([
	{ center: 0, target: 6, start: -2e9, end: 2e9, position: [1e9, 0, 0] },
	{ center: 6, target: 699, start: -2e9, end: 2e9, position: [300, 0, 0] },
])

// J2000 (2000-01-01 11:58:55.816 UTC), in Unix milliseconds.
const J2000_UNIX = Date.UTC(2000, 0, 1, 11, 58, 55, 816)

test('a preferred kernel answers its body where it covers, and the bodies tell which segment is used where', async () => {
	const { library, database, directory } = await started()
	const accurate = await library.importFile('accurate.bsp', stream(ACCURATE_SATURN))
	const broad = await library.importFile('broad.bsp', stream(BROAD_SATURN))
	const saturn = (time: number) => {
		const result = library.evaluate({ target: 699, center: 6, time })
		return result.ok ? Math.round(result.position[0]) : undefined
	}

	expect(saturn(J2000_UNIX)).toBe(300)
	let bodies = library.bodies().bodies
	let body = bodies.find((e) => e.body === 699)!
	expect(body.kernelIds).toEqual([broad.kernel.id, accurate.kernel.id])
	expect(body.segments.map((e) => [e.kernelId, e.usage])).toEqual([
		[broad.kernel.id, 'full'],
		[accurate.kernel.id, 'never'],
	])
	expect(body.preferredKernelId).toBeUndefined()

	const generation = library.runtime.current().generation
	const answer = await library.setPreference(699, { kernelId: accurate.kernel.id })
	expect(library.runtime.current().generation).toBe(generation + 1)
	body = answer.bodies.find((e) => e.body === 699)!
	expect(body.preferredKernelId).toBe(accurate.kernel.id)
	expect(body.segments.map((e) => [e.kernelId, e.preferred, e.usage])).toEqual([
		[accurate.kernel.id, true, 'full'],
		[broad.kernel.id, false, 'partial'],
	])
	expect(body.coverage.map((e) => [e.kernelId, e.start, e.end])).toEqual([
		[broad.kernel.id, -2e9, -5e8],
		[accurate.kernel.id, -5e8, 5e8],
		[broad.kernel.id, 5e8, 2e9],
	])
	// The preference is for Saturn alone: its barycenter still comes from the kernel added last.
	expect(answer.bodies.find((e) => e.body === 6)!.segments[0]).toMatchObject({ kernelId: broad.kernel.id, usage: 'full' })
	expect(saturn(J2000_UNIX)).toBe(100)
	// Outside the accurate kernel, the load order answers.
	expect(saturn(J2000_UNIX + 1e12)).toBe(300)

	// The preference survives a restart.
	library[Symbol.dispose]()
	library.runtime[Symbol.dispose]()
	libraries.splice(libraries.indexOf(library), 1)
	const restarted = setup({}, database, directory).library
	await restarted.start()
	expect(restarted.bodies().bodies.find((e) => e.body === 699)!.preferredKernelId).toBe(accurate.kernel.id)
	expect(restarted.runtime.current().set?.preferences).toEqual(new Map([[699, accurate.kernel.id]]))

	// Removing the preference, or deleting its kernel, returns the body to the load order.
	await restarted.setPreference(699, {})
	expect(restarted.bodies().bodies.find((e) => e.body === 699)!.preferredKernelId).toBeUndefined()
	await restarted.setPreference(699, { kernelId: accurate.kernel.id })
	await restarted.remove(accurate.kernel.id)
	bodies = restarted.bodies().bodies
	expect(bodies.find((e) => e.body === 699)!.preferredKernelId).toBeUndefined()
	await expect(restarted.setPreference(699, { kernelId: 'unknown' })).rejects.toMatchObject({ status: 404, code: 'notFound' })
})

test('a body is evaluated through the selection or from one chosen segment', async () => {
	const { library } = await started()
	await library.importFile('planets.bsp', stream(PLANETARY))
	const accurate = await library.importFile('accurate.bsp', stream(ACCURATE_SATURN))
	const broad = await library.importFile('broad.bsp', stream(BROAD_SATURN))

	const resolved = library.evaluate({ target: 699, center: 399, time: J2000_UNIX })
	if (!resolved.ok) throw new Error(resolved.reason)
	expect(resolved.position[0]).toBeCloseTo(1e9 + 300, 3)
	expect(resolved.position[1]).toBeCloseTo(-1.5e8 - 4000, 3)
	expect(resolved.distance).toBeCloseTo(Math.hypot(1e9 + 300, 1.5e8 + 4000), 3)
	expect(resolved.lightTime).toBeCloseTo((resolved.distance * 1000) / 299792458, 9)
	expect(resolved.velocity).toEqual([0, 0, 0])
	expect(resolved.tdbSeconds).toBeCloseTo(0, 3)
	expect(resolved.tdbJulianDate).toBeCloseTo(2451545, 8)
	expect(resolved.declination).toBeCloseTo(0, 12)
	expect(resolved.rightAscension).toBeCloseTo(2 * Math.PI - Math.atan2(1.5e8 + 4000, 1e9 + 300), 12)
	expect(resolved.source).toBeUndefined()
	expect(resolved.targetChain.map((e) => [e.body, e.kernelId])).toEqual([
		[699, broad.kernel.id],
		[6, broad.kernel.id],
	])
	expect(resolved.centerChain.map((e) => e.body)).toEqual([399, 3])

	// The lower segment of the accurate kernel, relative to its own center, then to the Earth.
	const own = library.evaluate({ target: 699, center: 6, time: J2000_UNIX, source: { kernelId: accurate.kernel.id, segment: 1 } })
	expect(own).toMatchObject({ ok: true, position: [100, 0, 0], source: { body: 699, center: 6, kernelId: accurate.kernel.id, segment: 1, preferred: false }, targetChain: [], centerChain: [] })
	const fromEarth = library.evaluate({ target: 699, center: 399, time: J2000_UNIX, source: { kernelId: accurate.kernel.id, segment: 1 } })
	expect(fromEarth.ok && resolved.position[0] - fromEarth.position[0]).toBeCloseTo(200, 3)

	expect(library.evaluate({ target: 699, center: 6, time: J2000_UNIX + 1e12, source: { kernelId: accurate.kernel.id, segment: 1 } })).toMatchObject({ ok: false, side: 'source', reason: 'coverage' })
	expect(library.evaluate({ target: 699, center: 6, time: J2000_UNIX, source: { kernelId: accurate.kernel.id, segment: 0 } })).toMatchObject({ ok: false, side: 'source', reason: 'missing' })
	expect(library.evaluate({ target: 699, center: 599, time: J2000_UNIX })).toMatchObject({ ok: false, side: 'center', reason: 'missing', body: 599 })
	expect(library.evaluate({ target: 599, center: 399, time: J2000_UNIX })).toMatchObject({ ok: false, side: 'target', reason: 'missing', body: 599 })
})

test('a deleted kernel leaves the set and its file is removed', async () => {
	const { library, store } = await started()
	const { kernel } = await library.importFile('planets.bsp', stream(PLANETARY))
	const path = store.objectPath(kernel.sha256)

	await library.remove(kernel.id)

	expect(await Bun.file(path).exists()).toBeFalse()
	expect(store.kernels()).toHaveLength(0)
	expect(library.runtime.current().set).toBeUndefined()
	expect(library.coverage(399, Date.now())).toMatchObject({ available: false, reason: 'missing' })
})

test('a restart reopens the kernels and reconciles what a previous run left', async () => {
	const database = AppDatabase.memory()
	const first = setup({}, database)
	await first.library.start()
	const planetary = await first.library.importFile('planets.bsp', stream(PLANETARY))
	const ceres = await first.library.importFile('ceres.bsp', stream(CERES))
	const other = await first.library.importFile('other.bsp', stream(spkFixture([{ center: 0, target: 5, start: 0, end: 10, position: [1, 0, 0] }])))
	await first.library.setOffline(true)
	first.library.runtime[Symbol.dispose]()

	// A crash left a staged file, the file of a kernel is gone, and another changed.
	await mkdir(join(first.directory, 'staging'), { recursive: true })
	await writeFile(join(first.directory, 'staging', 'left.part'), 'partial')
	rmSync(first.store.objectPath(ceres.kernel.sha256))
	writeFileSync(first.store.objectPath(other.kernel.sha256), spkFixture([{ center: 0, target: 6, start: 0, end: 10, position: [1, 0, 0] }]))

	const second = setup({}, database, first.directory)
	expect(second.library.snapshot().kernels.every((e) => e.readiness === 'loading')).toBeTrue()
	await second.library.start()

	const snapshot = second.library.snapshot()
	expect(snapshot.offline).toBeTrue()
	expect(Object.fromEntries(snapshot.kernels.map((e) => [e.id, e.readiness]))).toEqual({ [planetary.kernel.id]: 'ready', [ceres.kernel.id]: 'missing', [other.kernel.id]: 'invalid' })
	expect(snapshot.kernels.find((e) => e.id === other.kernel.id)?.failure).toBe('The file changed since it was added.')
	expect(readdirSync(join(first.directory, 'staging'))).toEqual([])
	expect(second.library.coverage(399, Date.now())).toMatchObject({ available: true, kernels: [planetary.kernel.id] })

	// Putting the original file back and verifying makes it ready again.
	writeFileSync(first.store.objectPath(other.kernel.sha256), spkFixture([{ center: 0, target: 5, start: 0, end: 10, position: [1, 0, 0] }]))
	expect((await second.library.verify(other.kernel.id)).readiness).toBe('ready')
})

test('a curated download is streamed, inspected, and installed', async () => {
	const requests: string[] = []
	const { library, events } = await started({
		fetch: (url) => {
			requests.push(url)
			return Promise.resolve(new Response(stream(PLANETARY), { headers: { 'content-length': `${PLANETARY.byteLength}` } }))
		},
	})

	const job = library.download('de440s')
	expect(library.download('de440s').jobId).toBe(job.jobId)
	const end = await ended(events, job.jobId)

	expect(requests).toEqual(['https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp'])
	expect(end).toMatchObject({ state: 'completed', alreadyInstalled: false, bytes: PLANETARY.byteLength, totalBytes: PLANETARY.byteLength })
	expect(library.details(end.kernelId!)).toMatchObject({ name: 'de440s.bsp', sourceKind: 'naif', sourceRef: 'de440s', readiness: 'ready' })
	expect(library.catalog()[0].kernelId).toBe(end.kernelId)
	expect(() => library.download('unknown')).toThrow('Unknown curated kernel.')
})

test('the curated catalog lists the reviewed kernels by system', async () => {
	const { library } = await started({})
	const catalog = library.catalog()
	expect(catalog.map((e) => e.id)).toEqual([
		'de440s',
		'de440',
		'de442s',
		'de442',
		'sb441-n16',
		'mar099s',
		'mar099',
		'jup365-1990-2050',
		'jup365',
		'jup347',
		'jup348',
		'jup349',
		'sat480',
		'sat441',
		'sat415',
		'sat393-daphnis',
		'sat456',
		'sat457',
		'sat455',
		'sat459',
		'ura184-part-3',
		'ura184-part-1',
		'ura184-part-2',
		'ura182',
		'ura117',
		'nep097',
		'nep098-part-1',
		'nep098-part-2',
		'nep098-part-3',
		'nep105',
		'nep104',
		'plu060',
	])
	expect(new Set(catalog.map((e) => e.name)).size).toBe(catalog.length)
	// Every system is one consecutive run, the planetary ephemerides first.
	expect([...new Set(catalog.map((e) => e.system))]).toEqual(['planets', 'asteroids', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'])
	expect(catalog.find((e) => e.id === 'jup365-1990-2050')?.url).toBe('https://naif.jpl.nasa.gov/pub/naif/JUICE/kernels/spk/jup365_19900101_20500101.bsp')
	expect(catalog.find((e) => e.id === 'ura182')?.url).toBe('https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp/ura182.bsp')
	// No size limit keeps a file out.
	expect(catalog.filter((e) => e.bytes > 1024 ** 3).map((e) => e.id)).toEqual(['mar099', 'jup365', 'ura184-part-1', 'ura184-part-2', 'nep098-part-2', 'nep098-part-3'])

	for (const entry of catalog) {
		expect(entry.url).toEndWith(`/${entry.name}`)
		expect(entry.url).toMatch(/^https:\/\/(naif|ssd)\.jpl\.nasa\.gov\//)
		expect(entry.startYear).toBeLessThan(entry.endYear)
		expect(entry.kernelId).toBeUndefined()
	}
})

test('a failed download names the host of the entry', async () => {
	const { library, events } = await started({ fetch: () => Promise.resolve(new Response(null, { status: 404 })) })
	const end = await ended(events, library.download('ura117').jobId)
	expect(end).toMatchObject({ state: 'failed', code: 'downloadFailed', error: 'ssd.jpl.nasa.gov answered 404.' })
})

// Stream of bytes in chunks of size bytes, one every interval milliseconds; with stallAfter chunks, it then sends nothing more.
function slowStream(bytes: Buffer, size: number, interval: number, stallAfter = Infinity) {
	let offset = 0
	let sent = 0

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (sent >= stallAfter) return await new Promise<void>(() => {})
			if (offset >= bytes.byteLength) return controller.close()
			await Bun.sleep(interval)
			controller.enqueue(new Uint8Array(bytes.subarray(offset, offset + size)))
			offset += size
			sent++
		},
	})
}

test('a download that stops sending fails without a trace', async () => {
	const { library, events, store } = await started({ downloadStallMs: 100, fetch: () => Promise.resolve(new Response(slowStream(PLANETARY, 1024, 0, 2))) })
	const end = await ended(events, library.download('de440s').jobId)

	expect(end).toMatchObject({ state: 'failed', code: 'downloadFailed', error: 'naif.jpl.nasa.gov sent nothing for 0 s.' })
	expect(store.kernels()).toHaveLength(0)
	expect(readdirSync(join(store.directory, 'staging'))).toEqual([])
})

test('a slow download that keeps sending outlasts the stall wait', async () => {
	const chunk = Math.ceil(PLANETARY.byteLength / 6)
	const { library, events } = await started({ downloadStallMs: 100, fetch: () => Promise.resolve(new Response(slowStream(PLANETARY, chunk, 40))) })
	const end = await ended(events, library.download('de440s').jobId)

	// Six chunks 40 ms apart take longer than the 100 ms stall wait.
	expect(end).toMatchObject({ state: 'completed', bytes: PLANETARY.byteLength })
})

test('a Horizons generation must contain the requested body', async () => {
	const files: Record<string, SpkFile> = { '20000001': { spk: CERES.toString('base64') }, '20000002': { spk: CERES.toString('base64') }, '20000003': { error: 'No ephemeris for target "3 Juno"' } }
	const requested: number[] = []
	const windows: unknown[] = []
	const generate: SpkGenerator = (id, start, end) => {
		requested.push(id)
		windows.push([start, end])
		return Promise.resolve(files[id])
	}
	// The window starts at the beginning of the UTC day of the clock and lasts the months asked.
	const { library, events } = await started({ generate, now: () => Date.UTC(2026, 0, 31, 15, 30) })
	const start = Date.UTC(2026, 0, 31)
	const end = Date.UTC(2027, 0, 31)

	const ceres = await ended(events, library.generate({ spkId: '20000001', name: '1 Ceres', months: 12 }).jobId)
	expect(ceres.state).toBe('completed')
	expect(library.details(ceres.kernelId!)).toMatchObject({ name: '1 Ceres (20000001)', sourceKind: 'horizons', sourceRef: '20000001', requestedStart: start, requestedEnd: end, readiness: 'missingDependency' })

	expect(await ended(events, library.generate({ spkId: '20000002', months: 12 }).jobId)).toMatchObject({ state: 'failed', code: 'generationFailed', error: 'The generated kernel has no segment for 20000002.' })
	expect(await ended(events, library.generate({ spkId: '20000003', months: 12 }).jobId)).toMatchObject({ state: 'failed', code: 'generationFailed', error: 'No ephemeris for target "3 Juno"' })
	expect(requested).toEqual([20000001, 20000002, 20000003])
	expect(windows[0]).toEqual([start, end])
	expect(spiceKernelWindow(Date.UTC(2026, 0, 31, 23, 59), 1)).toEqual({ start: Date.UTC(2026, 0, 31), end: Date.UTC(2026, 2, 3) })
})

// Every DE440 body an MPC integration needs, at rest: the Sun at the barycenter and the planets far from the orbit.
const DE440_BODIES = spkFixture([
	{ center: 0, target: 10, start: -1e9, end: 1e9, position: [0, 0, 0] },
	...[1, 2, 4, 5, 6, 7, 8, 9].map((target) => ({ center: 0, target, start: -1e9, end: 1e9, position: [0, 0, 6e9 + target * 1e8] as [number, number, number] })),
	{ center: 0, target: 3, start: -1e9, end: 1e9, position: [0, 0, -6e9] },
	{ center: 3, target: 399, start: -1e9, end: 1e9, position: [4000, 0, 0] },
	{ center: 3, target: 301, start: -1e9, end: 1e9, position: [-3.8e5, 0, 0] },
])

// An MPC solution at MJD 60000 TT on a near-circular ecliptic orbit of 2.7 AU, with a Yarkovsky coefficient.
const MPC_SOLUTION: MPCOrbitSolution = {
	car: { coefficientNames: ['x', 'y', 'z', 'vx', 'vy', 'vz', 'yarkovsky'], coefficients: [2.7, 0, 0.1, 0, 0.0104, 0.001, -0.0003] },
	epochData: { epoch: 60000, timeForm: 'MJD', timeSystem: 'TDT' },
	systemData: { referenceSystem: 'Ecliptic', referenceFrame: 'ICRF', ephemeris: 'DE431', forceModel: 'AST17' },
}

test('an MPC orbit is integrated over the planetary kernels into a kernel relative to the Sun', async () => {
	const asked: string[] = []
	const mpcOrbit: MpcOrbitReader = (designation) => {
		asked.push(designation)
		return Promise.resolve(designation === '4' ? MPC_SOLUTION : undefined)
	}
	const { library, events } = await started({ mpcOrbit, now: () => Date.UTC(2023, 0, 1, 8) })
	const start = Date.UTC(2023, 0, 1)
	const end = Date.UTC(2023, 6, 1)

	// Without a planetary kernel the integration cannot start.
	expect(await ended(events, library.generate({ spkId: '20000004', designation: '4', source: 'mpc', months: 6 }).jobId)).toMatchObject({ state: 'failed', code: 'missingDependency' })

	await library.importFile('de440-bodies.bsp', stream(DE440_BODIES))
	const job = await ended(events, library.generate({ spkId: '20000004', name: '4 Vesta', designation: '4', source: 'mpc', months: 6 }).jobId)
	expect(job.state).toBe('completed')

	const details = library.details(job.kernelId!)
	expect(details).toMatchObject({ name: '4 Vesta (20000004)', sourceKind: 'mpc', sourceRef: '20000004', requestedStart: start, requestedEnd: end, readiness: 'ready', targets: [20000004] })
	expect(details.segments).toMatchObject([{ target: 20000004, center: 10, dataType: 9 }])
	expect(details.provenance).toStartWith('MPC orbit of 4 at 2023-02-25 TT (DE431, AST17); integrated with the DE440 planets and Moon, 0 SB441-N16 asteroids')
	expect(details.provenance).toContain('Yarkovsky A2 = -3.000e-14 au/d²')

	// At the epoch the kernel holds the solution's state, rotated from the ecliptic to the equator.
	const epoch = Date.UTC(2023, 1, 25) - 69_184
	const state = orbitToKeplerOrbit(MPC_SOLUTION)!.at(orbitCartesianState(MPC_SOLUTION)!.epoch)[0]
	const evaluation = library.evaluate({ target: 20000004, center: 10, time: epoch })
	expect(evaluation.ok).toBeTrue()
	if (evaluation.ok) for (let i = 0; i < 3; i++) expect(evaluation.position[i] / AU_KM).toBeCloseTo(state[i], 6)

	// A body the MPC does not know fails without a kernel.
	expect(await ended(events, library.generate({ spkId: '20000099', designation: '99', source: 'mpc', months: 6 }).jobId)).toMatchObject({ state: 'failed', code: 'generationFailed', error: 'The MPC Orbit Database has no orbit of 99.' })
	expect(asked).toEqual(['4', '4', '99'])
})

// MPCORB lines of three numbered asteroids, as Soft00Bright.txt and NEA.txt publish them.
const ELEMENT_LINES = [
	'00001    3.35  0.15 K25BL 231.53975   73.29974   80.24963   10.58789  0.0795763  0.21429712   2.7656157  0 MPO950947  7369 126 1801-2025 0.69 M-v 30k MPC        0000              (1) Ceres',
	'00004    3.25  0.15 K25BL  26.80968  151.53712  103.70232    7.14406  0.0901676  0.27158812   2.3615413  0 MPO925791  7543 112 1821-2025 0.69 M-p 18k MPC        0000              (4) Vesta',
	'00433   10.39  0.15 K2669  62.51145  178.91814  304.26797   10.82855  0.2228780  0.55970463   1.4582437  0 E2026-TG8 18065  59 1893-2026 0.61 M-v 3Ek MPCORBFIT  1804    (433) Eros               20260919',
].join('\n')

test('imported elements are integrated by the workers into one kernel of one segment per asteroid', async () => {
	const fetch = (url: string) => Promise.resolve(new Response(url.endsWith('Soft00Bright.txt') ? ELEMENT_LINES : ''))
	const { library, events } = await started({ fetch, now: () => Date.UTC(2026, 10, 19, 21) })
	const preview = await library.downloadElements('bright-2026')
	expect(preview.objects.map((e) => e.number)).toEqual([1, 4, 433])
	expect(library.parseElements(ELEMENT_LINES)).toEqual(preview)
	expect(library.elementLists().length).toBe(14)
	await expect(library.downloadElements('unknown')).rejects.toThrow('Unknown element list.')

	const request = { label: 'Bright minor planets', sourceRef: 'bright-2026', objects: preview.objects, months: 1 } as const

	// Without a planetary kernel the workers stop at the first object.
	expect(await ended(events, library.integrateElements(request).jobId)).toMatchObject({ state: 'failed', code: 'missingDependency', unit: 'objects' })

	await library.importFile('de440-bodies.bsp', stream(DE440_BODIES))
	const job = await ended(events, library.integrateElements(request).jobId)
	expect(job).toMatchObject({ state: 'completed', kind: 'integrate', unit: 'objects', bytes: 3, totalBytes: 3 })

	const details = library.details(job.kernelId!)
	expect(details).toMatchObject({ name: 'Bright minor planets', sourceKind: 'elements', sourceRef: 'bright-2026', requestedStart: Date.UTC(2026, 10, 19), requestedEnd: Date.UTC(2026, 11, 19), readiness: 'ready', targets: [20000001, 20000004, 20000433] })
	expect(details.targetNames).toEqual({ 20000001: '(1) Ceres', 20000004: '(4) Vesta', 20000433: '(433) Eros' })
	expect(details.segments.map((e) => [e.target, e.center, e.dataType])).toEqual([
		[20000001, 10, 9],
		[20000004, 10, 9],
		[20000433, 10, 9],
	])
	expect(details.provenance).toStartWith('3 numbered asteroids of Bright minor planets at opposition in 2026, MPC 1-line elements at 2025-11-21 to 2026-06-09 TT')

	// At its epoch Eros is where its elements put it.
	const eros = library.evaluate({ target: 20000433, center: 10, time: Date.UTC(2026, 10, 20) })
	expect(eros.ok && eros.distance / AU_KM).toBeGreaterThan(1.1)

	// The photometry of the elements is recorded with the kernel for the magnitudes of the map, and leaves with it.
	expect(library.runtime.current().photometry?.get(20000433)).toEqual({ h: 10.39, g: 0.15 })
	expect(library.runtime.current().photometry?.size).toBe(3)
	await library.remove(job.kernelId!)
	expect(library.runtime.current().photometry?.size).toBe(0)

	expect(() => library.integrateElements({ ...request, objects: Array.from({ length: 10_001 }, () => preview.objects[0]) })).toThrow('At most 10000 objects can be integrated at once.')
})

test('a running job can be cancelled', async () => {
	const generate: SpkGenerator = (_id, _start, _end, signal) =>
		new Promise((_, reject) => {
			signal?.addEventListener('abort', () => reject(signal.reason as Error))
		})
	const { library, events } = await started({ generate })
	const job = library.generate({ spkId: '20000001', months: 1 })
	await Bun.sleep(20)

	library.cancel(job.jobId)
	expect((await ended(events, job.jobId)).state).toBe('cancelled')
	expect(() => library.cancel('unknown')).toThrow('Unknown job.')
})

test('the routes answer the snapshot, uploads, and errors', async () => {
	const { library } = await started()
	const routes = createSpiceKernelRoutes(library)

	const upload = await routes['/api/spice-kernels/import'].POST(new Request('http://localhost/api/spice-kernels/import?name=planets.bsp', { method: 'POST', body: new Uint8Array(PLANETARY), headers: { 'content-type': 'application/octet-stream' } }) as never)
	expect(upload.status).toBe(201)
	const { kernel } = (await upload.json()) as { kernel: { id: string } }

	const snapshot = (await routes['/api/spice-kernels'].GET().json()) as { kernels: unknown[] }
	expect(snapshot.kernels).toHaveLength(1)

	const settings = await routes['/api/spice-kernels/settings'].PATCH(new Request('http://localhost/api/spice-kernels/settings', { method: 'PATCH', body: JSON.stringify({ offline: true }) }) as never)
	expect(((await settings.json()) as { offline: boolean }).offline).toBeTrue()

	const missing = await routes['/api/spice-kernels/:id'].GET({ params: { id: 'unknown' } } as never)
	expect(missing.status).toBe(404)
	expect(await missing.json()).toEqual({ error: 'Unknown kernel.', code: 'notFound' })

	const bodies = (await routes['/api/spice-kernels/bodies'].GET().json()) as { bodies: { body: number }[] }
	expect(bodies.bodies.map((e) => e.body)).toEqual([3, 10, 399])

	const preferred = await routes['/api/spice-kernels/bodies/:body/preference'].PUT(Object.assign(new Request('http://localhost/api/spice-kernels/bodies/399/preference', { method: 'PUT', body: JSON.stringify({ kernelId: kernel.id }) }), { params: { body: '399' } }) as never)
	expect(((await preferred.json()) as { bodies: { body: number; preferredKernelId?: string }[] }).bodies.find((e) => e.body === 399)?.preferredKernelId).toBe(kernel.id)

	const evaluated = await routes['/api/spice-kernels/evaluate'].POST(new Request('http://localhost/api/spice-kernels/evaluate', { method: 'POST', body: JSON.stringify({ target: 399, center: 3, time: Date.UTC(2026, 0, 1) }) }) as never)
	const evaluation = (await evaluated.json()) as { ok: boolean; distance: number }
	expect(evaluation.ok).toBeTrue()
	expect(evaluation.distance).toBeCloseTo(4000, 6)

	const deleted = await routes['/api/spice-kernels/:id'].DELETE({ params: { id: kernel.id } } as never)
	expect(deleted.status).toBe(204)
})

test('a runtime disposed while it opens the kernels keeps none of them', async () => {
	const database = AppDatabase.memory()
	const first = setup({}, database)
	await first.library.start()
	await first.library.importFile('planets.bsp', stream(PLANETARY))
	first.library.runtime[Symbol.dispose]()

	const second = setup({}, database, first.directory)
	const started = second.library.start()
	second.library.runtime[Symbol.dispose]()
	await started

	expect(second.library.runtime.current().loading).toBeTrue()
	expect(second.library.runtime.current().set).toBeUndefined()
})

test('a set that cannot be prepared together keeps the kernels ready and the previous set in force', async () => {
	const { library } = setup()
	await library.start()
	const { kernel } = await library.importFile('planets.bsp', stream(PLANETARY))
	const { set } = library.runtime.current()
	const prepare = spyOn(kernelSets, 'prepareSpkKernelSet').mockRejectedValue(new Error('changed while read'))
	const error = spyOn(console, 'error').mockImplementation(() => undefined)

	try {
		await library.update(kernel.id, { priority: 5 })
		expect(prepare).toHaveBeenCalled()
		expect(library.runtime.current().set).toBe(set)
		expect(library.snapshot().kernels.find((e) => e.id === kernel.id)?.readiness).not.toBe('invalid')
	} finally {
		prepare.mockRestore()
		error.mockRestore()
	}
})

test('the support of each segment follows the toolkit at start and on verify', async () => {
	const database = AppDatabase.memory()
	const first = setup({}, database)
	await first.library.start()
	const { kernel } = await first.library.importFile('planets.bsp', stream(PLANETARY))
	first.library.runtime[Symbol.dispose]()

	// Recorded by a toolkit that could not evaluate the data type of the first segment.
	const forget = () => database.db.run("UPDATE spice_segments SET supported = 0, unsupported_reason = 'dataType' WHERE kernel_id = ? AND segment_index = 0", [kernel.id])
	forget()
	expect(first.store.segments(kernel.id)[0]).toMatchObject({ supported: false, reason: 'dataType' })

	const second = setup({}, database, first.directory)
	await second.library.start()
	expect(second.library.details(kernel.id)).toMatchObject({ unsupportedSegments: 0, segments: [{ supported: true }, { supported: true }, { supported: true }] })
	expect(second.store.segments(kernel.id)[0].reason).toBeUndefined()

	forget()
	expect((await second.library.verify(kernel.id)).unsupportedSegments).toBe(0)
})
