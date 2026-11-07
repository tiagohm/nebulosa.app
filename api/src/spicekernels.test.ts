import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { SpkFile } from 'nebulosa/src/adapters/ephemeris/horizons'
import { AU_KM } from 'nebulosa/src/core/constants'
import { AppDatabase } from './database'
import { createSpiceKernelRoutes, MAX_SPICE_KERNEL_BYTES, SpiceKernelError, type SpiceKernelEvent, SpiceKernelLibrary, type SpiceKernelLibraryOptions, type SpkGenerator } from './spicekernels'
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
	expect(library.details(kernel.id).segments).toEqual([{ index: 0, name: 'SEGMENT 1', target: 1, center: 0, frame: 17, dataType: 2, start: 0, end: 10, supported: false, reason: 'frame' }])
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
	await first.library.setPolicy('offline')
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
	expect(snapshot.policy).toBe('offline')
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

test('the curated catalog lists the reviewed Jovian and Saturnian kernels within the size limit', async () => {
	const { library } = await started({})
	const catalog = library.catalog()
	expect(catalog.map((e) => e.id)).toEqual(['de440s', 'jup365-1990-2050', 'sat480', 'sat441'])
	const jovian = catalog[1]
	expect(jovian.url).toBe('https://naif.jpl.nasa.gov/pub/naif/JUICE/kernels/spk/jup365_19900101_20500101.bsp')
	expect(catalog[2].url).toBe('https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/sat480.bsp')
	expect(catalog[3].url).toBe('https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/sat441.bsp')
	// sat441 alone is larger than the former 256 MiB limit.
	expect(catalog[3].bytes).toBeGreaterThan(256 * 1024 * 1024)
	for (const entry of catalog) {
		expect(entry.bytes).toBeLessThanOrEqual(MAX_SPICE_KERNEL_BYTES)
		expect(entry.kernelId).toBeUndefined()
	}
})

test('a download larger than the limit fails without a trace', async () => {
	const { library, events, store } = await started({ fetch: () => Promise.resolve(new Response(stream(PLANETARY), { headers: { 'content-length': `${MAX_SPICE_KERNEL_BYTES + 1}` } })) })
	const end = await ended(events, library.download('de440s').jobId)

	expect(end).toMatchObject({ state: 'failed', code: 'tooLarge' })
	expect(store.kernels()).toHaveLength(0)
})

test('a Horizons generation must contain the requested body', async () => {
	const files: Record<string, SpkFile> = { '20000001': { spk: CERES.toString('base64') }, '20000002': { spk: CERES.toString('base64') }, '20000003': { error: 'No ephemeris for target "3 Juno"' } }
	const requested: number[] = []
	const generate: SpkGenerator = (id) => {
		requested.push(id)
		return Promise.resolve(files[id])
	}
	const { library, events } = await started({ generate })
	const start = Date.UTC(2026, 0, 1)
	const end = Date.UTC(2036, 0, 1)

	const ceres = await ended(events, library.generate({ spkId: '20000001', name: '1 Ceres', start, end }).jobId)
	expect(ceres.state).toBe('completed')
	expect(library.details(ceres.kernelId!)).toMatchObject({ name: '1 Ceres (20000001)', sourceKind: 'horizons', sourceRef: '20000001', requestedStart: start, requestedEnd: end, readiness: 'missingDependency' })

	expect(await ended(events, library.generate({ spkId: '20000002', start, end }).jobId)).toMatchObject({ state: 'failed', code: 'generationFailed', error: 'The generated kernel has no segment for 20000002.' })
	expect(await ended(events, library.generate({ spkId: '20000003', start, end }).jobId)).toMatchObject({ state: 'failed', code: 'generationFailed', error: 'No ephemeris for target "3 Juno"' })
	expect(requested).toEqual([20000001, 20000002, 20000003])
})

test('a running job can be cancelled', async () => {
	const generate: SpkGenerator = (_id, _start, _end, signal) =>
		new Promise((_, reject) => {
			signal?.addEventListener('abort', () => reject(signal.reason as Error))
		})
	const { library, events } = await started({ generate })
	const job = library.generate({ spkId: '20000001', start: 0, end: 1 })
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

	const policy = await routes['/api/spice-kernels/settings'].PATCH(new Request('http://localhost/api/spice-kernels/settings', { method: 'PATCH', body: JSON.stringify({ policy: 'spkOnly' }) }) as never)
	expect(((await policy.json()) as { policy: string }).policy).toBe('spkOnly')

	const missing = await routes['/api/spice-kernels/:id'].GET({ params: { id: 'unknown' } } as never)
	expect(missing.status).toBe(404)
	expect(await missing.json()).toEqual({ error: 'Unknown kernel.', code: 'notFound' })

	const deleted = await routes['/api/spice-kernels/:id'].DELETE({ params: { id: kernel.id } } as never)
	expect(deleted.status).toBe(204)
})
